"use strict";

const test = require("node:test");
const assert = require("node:assert");

const relaySocket = require("../public/src/relay_socket");

/** A WebSocket and a clock that only do what the test tells them to. */
function setUp() {
  const made = [];
  let timers = [];
  let time = 0;
  function FakeSocket(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    made.push(this);
  }
  FakeSocket.prototype.send = function (text) { this.sent.push(JSON.parse(text)); };
  FakeSocket.prototype.close = function () { this.readyState = 3; if (this.onclose) this.onclose(); };
  FakeSocket.prototype.open = function () { this.readyState = 1; this.onopen(); };
  FakeSocket.prototype.say = function (message) { this.onmessage({ data: typeof message === "string" ? message : JSON.stringify(message) }); };

  const socket = relaySocket("wss://relay.test/r/lobby/ws", {
    WebSocket: FakeSocket,
    setTimeout: (fn, ms) => { const t = { fn, at: time + ms }; timers.push(t); return t; },
    clearTimeout: (t) => { timers = timers.filter((x) => x !== t); },
    now: () => time,
  });
  const heard = [];
  for (const event of ["connect", "disconnect", "state:all", "state:changed", "osc:in", "relay:latency", "relay:full"]) {
    socket.on(event, (payload) => heard.push(payload === undefined ? [event] : [event, payload]));
  }
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
  return { socket, made, heard, advance, ws: () => made[made.length - 1] };
}

/** Connected all the way through: the relay is open and OSCAR is at the other end. */
function online() {
  const s = setUp();
  s.ws().open();
  s.ws().say({ t: "host", online: true });
  s.ws().sent.length = 0;
  s.heard.length = 0;
  return s;
}

test("connected means OSCAR is there, not merely the relay", () => {
  const { socket, ws, heard } = setUp();
  ws().open();
  assert.strictEqual(socket.connected, false, "the relay alone is nobody to talk to");
  ws().say({ t: "host", online: true });
  assert.strictEqual(socket.connected, true);
  assert.deepStrictEqual(heard, [["connect"]]);
  assert.deepStrictEqual(ws().sent[0], { t: "sync" }, "and the first thing asked for is what everything is showing");
  ws().say({ t: "host", online: false });
  assert.strictEqual(socket.connected, false);
  assert.deepStrictEqual(heard[1], ["disconnect"]);
});

test("all a page can say is: this control, this state", () => {
  const { socket, ws, advance } = online();
  socket.emit("state:set", { id: "dim", state: { value: 40 } });
  // A destination chosen by the page is not this device's to name.
  socket.emit("osc", { ip: "192.168.1.1", port: 22, address: "/elsewhere", args: [1] });
  socket.emit("dmx", { universe: 0, channel: 1, levels: [255] });
  socket.emit("dmx:stop", { source: "dim" });
  socket.emit("message", "x", "192.168.1.1", 22, "/elsewhere", "f", 1);
  advance(50);
  assert.deepStrictEqual(ws().sent, [{ t: "set", w: "dim", s: { value: 40 } }]);
});

test("a dragged fader sends where the finger is, not everywhere it has been", () => {
  const { socket, ws, advance } = online();
  for (let v = 0; v < 60; v++) socket.emit("state:set", { id: "dim", state: { value: v } });
  socket.emit("state:set", { id: "pan", state: { x: 0.1, y: 0.9 } });
  assert.deepStrictEqual(ws().sent, [], "nothing until the flush");
  advance(50);
  assert.deepStrictEqual(ws().sent, [{ t: "set", w: "dim", s: { value: 59 } }, { t: "set", w: "pan", s: { x: 0.1, y: 0.9 } }]);
  // A second of dragging is a couple of dozen messages, not sixty.
  ws().sent.length = 0;
  for (let ms = 0; ms < 1000; ms += 16) { socket.emit("state:set", { id: "dim", state: { value: ms } }); advance(16); }
  assert.ok(ws().sent.length <= 26, ws().sent.length + " messages in a second");
  assert.strictEqual(ws().sent[ws().sent.length - 1].s.value, 992, "and the last one is the last one");
});

test("a held button says what to show if this phone goes away, and what the rig said is not passed on", () => {
  const { socket, ws, advance } = online();
  socket.emit("state:set", { id: "flash", state: { on: true }, release: { on: false } });
  socket.emit("state:set", { id: "level", state: { value: 3 }, heard: true });
  advance(50);
  assert.deepStrictEqual(ws().sent, [{ t: "set", w: "flash", s: { on: true }, r: { on: false } }]);
});

test("a move made while OSCAR is away is dropped, not saved up for later", () => {
  const { socket, ws, advance } = online();
  ws().say({ t: "host", online: false });
  socket.emit("state:set", { id: "dim", state: { value: 100 } });
  advance(50);
  ws().say({ t: "host", online: true });
  advance(50);
  assert.deepStrictEqual(ws().sent.filter((m) => m.t === "set"), [], "the lights do not jump when it comes back");
});

test("what arrives is handed on as the events the page already knows", () => {
  const { ws, heard } = online();
  ws().say({ t: "all", states: { dim: { value: 5 } } });
  ws().say({ t: "state", w: "house", s: { on: true } });
  ws().say({ t: "osc", a: "/meter", v: [0.5] });
  assert.deepStrictEqual(heard, [
    ["state:all", { dim: { value: 5 } }],
    ["state:changed", { id: "house", state: { on: true } }],
    ["osc:in", { address: "/meter", args: [0.5] }],
  ]);
  // Rubbish is ignored rather than thrown on.
  for (const junk of ["not json", "null", "[]", { t: "state" }, { t: "osc", a: 5 }, { t: "launch-missiles" }]) ws().say(junk);
  assert.strictEqual(heard.length, 3);
});

test("the round trip to OSCAR is measured while connected, for the readout", () => {
  const { ws, heard, advance } = online();
  advance(10000);
  const echo = ws().sent.filter((m) => m.t === "echo")[0];
  assert.ok(echo, "asked once ten seconds in");
  advance(84);
  ws().say({ t: "echo", n: echo.n });
  assert.deepStrictEqual(heard[heard.length - 1], ["relay:latency", 84]);
});

test("a dropped connection comes back by itself, patiently; a full room more patiently still", () => {
  const { socket, made, ws, heard, advance } = online();
  ws().close();
  assert.deepStrictEqual(heard[0], ["disconnect"]);
  assert.strictEqual(made.length, 1);
  advance(1500);
  assert.strictEqual(made.length, 2, "again after about a second");
  ws().close();
  advance(1500);
  assert.strictEqual(made.length, 2, "then longer");
  advance(1500);
  assert.strictEqual(made.length, 3);

  ws().open();
  ws().say({ t: "full" });
  assert.strictEqual(socket.full, true);
  ws().close();
  advance(10000);
  assert.strictEqual(made.length, 3, "a full room is not hammered");
  advance(6000);
  assert.strictEqual(made.length, 4);

  socket.close();
  advance(60000);
  assert.strictEqual(made.length, 4, "and closed is closed");
});
