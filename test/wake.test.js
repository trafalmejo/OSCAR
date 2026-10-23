"use strict";

/**
 * A page coming back from sleep (public/src/adapters/wake.js), driven with
 * a document and a window that fire what the test says, and a socket that
 * is whatever the test says it is.
 */

const test = require("node:test");
const assert = require("node:assert");

const { watchWake, PROBE_MS, SETTLE_MS } = require("../public/src/adapters/wake");

function target() {
  const listeners = {};
  return {
    visibilityState: "visible",
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    fire(type, event) {
      for (const fn of listeners[type] || []) fn(event || {});
    },
    count() {
      return Object.values(listeners).reduce((n, fns) => n + fns.length, 0);
    },
  };
}

function setUp(options) {
  let time = 0;
  let timers = [];
  const doc = target();
  const win = target();
  const said = [];
  let synced = null;
  const state = { connected: options && options.connected === false ? false : true };
  const watching = watchWake({
    doc,
    win,
    connected: () => state.connected,
    reconnect: () => said.push("reconnect"),
    sync: () => said.push("sync"),
    onSynced: (fn) => (synced = fn),
    setTimeout: (fn, ms) => {
      const t = { fn, at: time + ms };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      timers = timers.filter((x) => x !== t);
    },
    now: () => time,
  });
  function advance(ms) {
    const until = time + ms;
    for (;;) {
      const next = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      timers = timers.filter((t) => t !== next);
      time = next.at;
      next.fn();
    }
    time = until;
  }
  return { doc, win, said, state, watching, advance, answer: () => synced() };
}

test("shown again with the socket away, the page connects now, not after the back-off", () => {
  const { doc, said, state } = setUp({ connected: false });
  doc.fire("visibilitychange");
  assert.deepStrictEqual(said, ["reconnect"]);
  assert.strictEqual(state.connected, false, "the test's socket is still what it was; the real one is socket.io's business");
});

test("shown again with the socket connected, the page asks for the snapshot, and a prompt answer is the end of it", () => {
  const { doc, said, advance, answer } = setUp();
  doc.fire("visibilitychange");
  assert.deepStrictEqual(said, ["sync"]);
  advance(PROBE_MS / 2);
  answer();
  advance(PROBE_MS);
  assert.deepStrictEqual(said, ["sync"], "answered in time: nothing to reconnect");
});

test("a socket that says connected but answers nothing is dead, and is made again", () => {
  const { doc, said, advance } = setUp();
  doc.fire("visibilitychange");
  advance(PROBE_MS - 1);
  assert.deepStrictEqual(said, ["sync"]);
  advance(1);
  assert.deepStrictEqual(said, ["sync", "reconnect"]);
});

test("one unlock is one wake, however many events it fires", () => {
  const { doc, win, said, advance } = setUp();
  doc.fire("visibilitychange");
  win.fire("pageshow", { persisted: true });
  win.fire("online");
  assert.deepStrictEqual(said, ["sync"]);
  // And while a probe is out, a later wake does not start a second one.
  advance(SETTLE_MS + 1);
  doc.fire("visibilitychange");
  assert.deepStrictEqual(said, ["sync"]);
});

test("hidden is not a wake, and neither is a plain load", () => {
  const { doc, win, said } = setUp();
  doc.visibilityState = "hidden";
  doc.fire("visibilitychange");
  win.fire("pageshow", { persisted: false });
  win.fire("pageshow");
  assert.deepStrictEqual(said, []);
});

test("without a window, or a document that cannot be listened to, the page runs as before", () => {
  const said = [];
  const watching = watchWake({
    doc: { body: {} },
    connected: () => true,
    reconnect: () => said.push("reconnect"),
    sync: () => said.push("sync"),
    onSynced: () => {},
  });
  watching.wake();
  assert.deepStrictEqual(said, ["sync"], "a wake can still be asked for by hand");
  watching.stop();
});

test("stopped, it lets go of the page and a probe in flight comes to nothing", () => {
  const { doc, win, said, watching, advance } = setUp();
  doc.fire("visibilitychange");
  watching.stop();
  advance(PROBE_MS * 2);
  assert.deepStrictEqual(said, ["sync"]);
  assert.strictEqual(doc.count() + win.count(), 0);
  doc.fire("visibilitychange");
  assert.deepStrictEqual(said, ["sync"]);
});
