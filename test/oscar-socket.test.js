"use strict";

/**
 * The browser's end of the socket, for what the devices share.
 *
 * public/src/oscar_socket.js is a plain script -- a global function handed to
 * GrapesJS by name -- so it is run here in a context of its own, with a
 * stand-in for the socket.io client that records what the page emitted and
 * lets a test play the server.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "public", "src", "oscar_socket.js"), "utf8");

/** A page with the plugin loaded; `options` are the plugin's. */
function page(options) {
  const handlers = {};
  const socket = {
    emitted: [],
    emit(event, payload) {
      // As the wire would carry it.
      this.emitted.push({ event, payload: JSON.parse(JSON.stringify(payload)) });
    },
    on(event, fn) {
      (handlers[event] = handlers[event] || []).push(fn);
    },
    /** The server, or the transport, saying something to this page. */
    hears(event, payload) {
      for (const fn of handlers[event] || []) fn(payload);
    },
    states() {
      return this.emitted.filter((m) => m.event === "state:set").map((m) => m.payload);
    },
  };
  const context = {
    io: () => socket,
    window: { location: { hostname: "localhost" } },
    console: { log() {}, warn() {} },
  };
  vm.createContext(context);
  vm.runInContext(SOURCE + "\nthis.oscar_socket = oscar_socket;", context);
  const editor = {};
  context.oscar_socket(editor, Object.assign({ ipserver: "localhost", socketPort: 18201 }, options));
  return { editor, socket };
}

/** What JSON.parse makes of a snapshot carrying these ids, "__proto__" included. */
function wire(json) {
  return JSON.parse(json);
}

test("the editor is not a device on the surface: it is offered neither half of sharing", () => {
  // It used to be one. A tablet operator moving a fader then rewrote the
  // stored value in the designer's open project, which the next save kept;
  // and a project the tablets were never pushed could move their controls
  // through an id that happened to match.
  const { editor, socket } = page({});
  assert.strictEqual(editor.shareState, undefined);
  assert.strictEqual(editor.onSharedState, undefined);
  assert.strictEqual(typeof editor.sendOSC, "function", "the bridge to the rig is still there");
  assert.strictEqual(typeof editor.onOscIn, "function");
  assert.doesNotThrow(() => socket.hears("state:all", { w1: { value: 1 } }));
  assert.doesNotThrow(() => socket.hears("state:changed", { id: "w1", state: { value: 2 } }));
});

test("a page showing the surface shares, follows, and hands a late widget what is already known", () => {
  const { editor, socket } = page({ surface: true });
  socket.hears("connect");
  socket.hears("state:all", { w1: { value: 37 } });

  const seen = [];
  const stop = editor.onSharedState("w1", (state) => seen.push(state));
  assert.deepStrictEqual(seen, [{ value: 37 }], "attached after the snapshot, caught up on subscribe");

  socket.hears("state:changed", { id: "w1", state: { value: 40 } });
  assert.deepStrictEqual(seen[1], { value: 40 });

  editor.shareState("w1", { value: 41 }, { heard: false });
  editor.shareState("w1", { value: 42 }, { heard: true });
  editor.shareState("b1", { on: true }, { release: { on: false } });
  assert.deepStrictEqual(socket.states(), [
    { id: "w1", state: { value: 41 } },
    { id: "w1", state: { value: 42 }, heard: true },
    { id: "b1", state: { on: true }, release: { on: false } },
  ]);

  stop();
  socket.hears("state:changed", { id: "w1", state: { value: 50 } });
  assert.strictEqual(seen.length, 2);
});

test("an id that names something on every plain object is only ever a record here", () => {
  // With plain objects for the caches, "constructor" found Object instead of
  // a list of listeners and delivery threw; "__proto__" replaced the cache's
  // prototype, so every id a widget asked about afterwards looked known.
  const { editor, socket } = page({ surface: true });
  socket.hears("connect");
  assert.doesNotThrow(() => socket.hears("state:changed", { id: "constructor", state: { value: 1 } }));
  assert.doesNotThrow(() => socket.hears("state:changed", { id: "__proto__", state: { value: 64 } }));
  assert.doesNotThrow(() => socket.hears("state:all", wire('{"__proto__":{"value":64},"toString":{"value":2}}')));

  const seen = [];
  editor.onSharedState("value", (state) => seen.push(state));
  editor.onSharedState("w1", (state) => seen.push(state));
  assert.deepStrictEqual(seen, [], "a widget nobody reported on is handed nothing");

  editor.onSharedState("toString", (state) => seen.push(state));
  assert.deepStrictEqual(seen, [{ value: 2 }]);
});

test("after a reconnect the page tells the server what it no longer knows, and takes the server's word for the rest", () => {
  // The server restarted mid-show and came back with nothing. The tablets
  // kept what they were showing and said nothing, so the next one to join
  // started from the project's defaults beside tablets showing the live state.
  const { editor, socket } = page({ surface: true });
  socket.hears("connect");
  socket.hears("state:all", { fader: { value: 10 }, pad: { x: 1, y: 2 } });
  socket.hears("state:changed", { id: "fader", state: { value: 20 } });
  editor.shareState("toggle", { on: true });
  socket.emitted.length = 0;

  const seen = [];
  editor.onSharedState("pad", (state) => seen.push(state));
  seen.length = 0;

  socket.hears("connect");
  socket.hears("state:all", { pad: { x: 5, y: 6 } });

  assert.deepStrictEqual(
    socket.states().sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "fader", state: { value: 20 } },
      { id: "toggle", state: { on: true } },
    ],
    "told again: what another device set, and what this one did"
  );
  assert.deepStrictEqual(seen, [{ x: 5, y: 6 }], "what the server does know wins, and is not argued with");

  // Still known here afterwards, for a widget that attaches later.
  const late = [];
  editor.onSharedState("fader", (state) => late.push(state));
  assert.deepStrictEqual(late, [{ value: 20 }]);
});

test("a press held across a server restart is told again with its release", () => {
  const { editor, socket } = page({ surface: true });
  socket.hears("connect");
  socket.hears("state:all", {});
  editor.shareState("b1", { on: true }, { release: { on: false } });
  socket.emitted.length = 0;
  socket.hears("connect");
  socket.hears("state:all", {});
  assert.deepStrictEqual(socket.states(), [{ id: "b1", state: { on: true }, release: { on: false } }]);
});

test("a new layout is not a reconnect: the page forgets, and tells the server nothing", () => {
  const { editor, socket } = page({ surface: true });
  socket.hears("connect");
  socket.hears("state:all", { fader: { value: 10 } });
  editor.shareState("toggle", { on: true });
  socket.emitted.length = 0;

  socket.hears("state:all", {});
  assert.deepStrictEqual(socket.states(), [], "the old ids may not exist in the new layout");
  const seen = [];
  editor.onSharedState("fader", (state) => seen.push(state));
  editor.onSharedState("toggle", (state) => seen.push(state));
  assert.deepStrictEqual(seen, []);

  // And the first connect is not a reconnect either.
  const fresh = page({ surface: true });
  fresh.socket.hears("connect");
  fresh.socket.hears("state:all", {});
  assert.deepStrictEqual(fresh.socket.states(), []);
});
