"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { contextFor, attachAll, createTransport } = require("../public/src/adapters/standalone");
const { exportAttributes } = require("../lib/export/config");
const { button } = require("../lib/widgets/button");
const { slider } = require("../lib/widgets/slider");
const { fakeElement } = require("./helpers/fake-dom");

/**
 * The standalone adapter is browser code, but it is browser code that touches
 * no globals at load time -- which is what lets it be driven from Node exactly
 * as the widgets themselves are.
 */

function exported(name, config) {
  const el = fakeElement();
  const attributes = exportAttributes(name, Object.assign({}, config));
  for (const key of Object.keys(attributes)) el.setAttribute(key, attributes[key]);
  return el;
}

/** A page holding the given elements, answering the one query attachAll makes. */
function fakePage(elements) {
  return {
    querySelectorAll() {
      return elements;
    },
  };
}

/** A transport that records rather than connects. */
function recorder() {
  return {
    sent: [],
    send(ip, port, address, args) {
      this.sent.push({ ip, port, address, args });
      return true;
    },
  };
}

// --- an exported page drives the real widgets -------------------------------

test("a control exported with a target sends to that target, not to the defaults", () => {
  const el = exported(button.name, {
    ...button.defaults,
    ip: "10.0.0.9",
    port: 9000,
    message: "/cue/1/go",
    argType: "i",
    valueOn: "1",
  });
  const transport = recorder();

  attachAll(fakePage([el]), transport);
  el.fire("pointerdown");

  assert.deepStrictEqual(transport.sent, [
    { ip: "10.0.0.9", port: 9000, address: "/cue/1/go", args: [{ type: "i", value: 1 }] },
  ]);
});

test("a slider exported inverted stays inverted off the page", () => {
  const el = exported(slider.name, { ...slider.defaults, invert: true, min: 0, max: 100 });
  const transport = recorder();

  attachAll(fakePage([el]), transport);
  el.value = "25";
  el.fire("input");

  assert.strictEqual(transport.sent[0].args[0].value, 75);
});

test("a disabled control is still silent once exported", () => {
  const el = exported(button.name, { ...button.defaults, enabled: false });
  const transport = recorder();

  attachAll(fakePage([el]), transport);
  el.fire("pointerdown");

  assert.deepStrictEqual(transport.sent, []);
});

test("a value the argument type cannot carry is dropped, not sent as zero", () => {
  // Same rule as everywhere else in OSCAR: on a rig, 0 means "off", so a
  // message that cannot be built is not sent at all.
  const el = exported(button.name, { ...button.defaults, argType: "f", valueOn: "abc" });
  const transport = recorder();

  attachAll(fakePage([el]), transport);
  el.fire("pointerdown");

  assert.deepStrictEqual(transport.sent, []);
});

test("a control whose settings cannot be read is left inactive, and the rest still work", () => {
  const broken = fakeElement();
  broken.setAttribute("data-oscar", slider.name);
  broken.setAttribute("data-oscar-config", "{oops");

  const working = exported(button.name, button.defaults);
  const transport = recorder();

  const wired = attachAll(fakePage([broken, working]), transport);

  assert.strictEqual(wired.attached, 1);
  assert.strictEqual(wired.skipped, 1);

  broken.fire("input");
  assert.deepStrictEqual(transport.sent, [], "the broken one is not wired to anything");

  working.fire("pointerdown");
  assert.strictEqual(transport.sent.length, 1, "the working one still sends");
});

test("detaching unwires every control", () => {
  const el = exported(button.name, button.defaults);
  const transport = recorder();

  attachAll(fakePage([el]), transport).detach();
  el.fire("pointerdown");

  assert.deepStrictEqual(transport.sent, []);
});

// --- the ctx contract -------------------------------------------------------

test("the standalone ctx honours the same contract the editor's does", () => {
  const el = fakeElement();
  const config = { ip: "1.2.3.4" };
  const transport = recorder();
  const ctx = contextFor(el, config, transport);

  assert.strictEqual(ctx.get("ip"), "1.2.3.4");

  ctx.set("value", 12);
  assert.strictEqual(ctx.get("value"), 12);

  ctx.setClass("toggle", true);
  assert.strictEqual(el.classList.contains("toggle"), true);
  ctx.setClass("toggle", false);
  assert.strictEqual(el.classList.contains("toggle"), false);

  // Null means stay silent, exactly as in the GrapesJS adapter.
  ctx.send(null);
  assert.deepStrictEqual(transport.sent, []);

  // onChange has nothing to subscribe to here, but still answers with the
  // unsubscribe the widgets call on detach.
  assert.strictEqual(typeof ctx.onChange(["min"], () => {}), "function");
});

test("settings a widget writes back stay in the page and never in the markup", () => {
  // An exported file is the configuration. A surface that rewrote its own
  // markup would come up somewhere different every time it was opened.
  const el = exported(slider.name, { ...slider.defaults, value: 0 });
  const before = el.getAttribute("data-oscar-config");

  attachAll(fakePage([el]), recorder());
  el.value = "42";
  el.fire("input");

  assert.strictEqual(el.getAttribute("data-oscar-config"), before);
});

// --- the transport ----------------------------------------------------------

/** Just enough socket.io to see what the transport does with it. */
function fakeIo() {
  const handlers = {};
  const socket = {
    connected: false,
    emitted: [],
    on(event, fn) {
      handlers[event] = fn;
    },
    emit(event, payload) {
      this.emitted.push({ event, payload });
    },
    fire(event) {
      if (handlers[event]) handlers[event]();
    },
  };
  const io = (url, options) => {
    io.url = url;
    io.options = options;
    return socket;
  };
  io.socket = socket;
  return io;
}

test("the transport dials the host and port baked into the export", () => {
  const io = fakeIo();
  createTransport(io, { host: "192.168.1.7", port: 8081 });
  assert.strictEqual(io.url, "http://192.168.1.7:8081");
});

test("messages are dropped while the bridge is away, not queued up for later", () => {
  // socket.io buffers by default, so a reconnection would replay every
  // position a slider passed through while it was offline, all at once and
  // minutes late. A press that did not happen is the lesser harm.
  const io = fakeIo();
  const transport = createTransport(io, { host: "localhost", port: 8081 });

  assert.strictEqual(transport.send("1.2.3.4", 7000, "/x", [1]), false);
  assert.deepStrictEqual(io.socket.emitted, []);

  io.socket.connected = true;
  assert.strictEqual(transport.send("1.2.3.4", 7000, "/x", [1]), true);
  assert.deepStrictEqual(io.socket.emitted, [
    { event: "osc", payload: { ip: "1.2.3.4", port: 7000, address: "/x", args: [1] } },
  ]);
});

test("the connection state is reported so the page can say it is not connected", () => {
  const io = fakeIo();
  const states = [];
  createTransport(io, { host: "localhost", port: 8081 }, { onStatus: (s) => states.push(s) });

  io.socket.fire("connect");
  io.socket.fire("disconnect");
  io.socket.fire("connect_error");

  assert.deepStrictEqual(states, ["connected", "disconnected", "disconnected"]);
});
