"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { button } = require("../../lib/widgets/button");
const { mount, withWindow } = require("../helpers/widgets");

// --- modes ------------------------------------------------------------------

test("momentary sends ON while held and OFF on release", () => {
  const { el, ctx } = mount(button, { valueOn: "1", valueOff: "0", argType: "i" });

  el.fire("pointerdown");
  assert.deepStrictEqual(ctx.sent.map((m) => m.args), [[{ type: "i", value: 1 }]]);

  el.fire("pointerup");
  assert.deepStrictEqual(ctx.sent.map((m) => m.args), [
    [{ type: "i", value: 1 }],
    [{ type: "i", value: 0 }],
  ]);
});

test("momentary holds for as long as the finger does, not a fixed 250ms", () => {
  // The old button fired OFF on a timer, so a long hold released itself
  // mid-show while the finger was still down.
  const { el, ctx } = mount(button);
  el.fire("pointerdown");
  assert.strictEqual(ctx.sent.length, 1, "nothing follows until release");
});

test("toggle alternates, and shows its state without touching the model", () => {
  const { el, ctx } = mount(button, { mode: "toggle", valueOn: "1", valueOff: "0", argType: "i" });

  el.fire("click");
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "i", value: 1 }]);
  assert.strictEqual(el.classList.contains("toggle"), false, "class goes on the element");
  assert.strictEqual(ctx.classes.toggle, true);

  el.fire("click");
  assert.deepStrictEqual(ctx.sent[1].args, [{ type: "i", value: 0 }]);
  assert.strictEqual(ctx.classes.toggle, false);
});

test("a click in momentary mode does not double-fire after a press", () => {
  // A touch produces pointerdown, pointerup and then a synthetic click.
  const { el, ctx } = mount(button);
  el.fire("pointerdown");
  el.fire("pointerup");
  el.fire("click");
  assert.strictEqual(ctx.sent.length, 2, "one ON and one OFF, not three messages");
});

test("a repeated key does not retrigger, because downstream a repeat is a retrigger", () => {
  const { el, ctx } = mount(button);
  el.fire("keydown", { key: " " });
  el.fire("keydown", { key: " ", repeat: true });
  el.fire("keydown", { key: " ", repeat: true });
  assert.strictEqual(ctx.sent.length, 1);

  el.fire("keyup", { key: " " });
  assert.strictEqual(ctx.sent.length, 2);
});

test("pointercancel releases, so a drag off the button cannot strand it on", () => {
  const { el, ctx } = mount(button);
  el.fire("pointerdown");
  el.fire("pointercancel");
  assert.strictEqual(ctx.sent.length, 2);
  assert.strictEqual(ctx.classes.toggle, false);
});

test("releasing without a press sends nothing", () => {
  const { el, ctx } = mount(button);
  el.fire("pointerup");
  assert.deepStrictEqual(ctx.sent, []);
});

test("a disabled button stays silent however it is pressed", () => {
  const { el, ctx } = mount(button, { enabled: false, mode: "toggle" });
  el.fire("click");
  el.fire("click");
  assert.deepStrictEqual(ctx.sent, []);
});

// --- values -----------------------------------------------------------------

test("Value OFF is configurable, not hardcoded to zero", () => {
  const { el, ctx } = mount(button, {
    mode: "toggle",
    valueOn: "3",
    valueOff: "7",
    argType: "i",
    message: "/clip",
  });

  el.fire("click");
  el.fire("click");
  assert.deepStrictEqual(
    ctx.sent.map((m) => m.args[0].value),
    [3, 7]
  );
  assert.deepStrictEqual(ctx.sent.map((m) => m.address), ["/clip", "/clip"]);
});

test("a button can send strings, bools, or a bare address", () => {
  const cases = {
    s: [[{ type: "s", value: "go" }], [{ type: "s", value: "stop" }]],
    bool: [[{ type: "T" }], [{ type: "F" }]],
    none: [[], []],
  };

  for (const [argType, expected] of Object.entries(cases)) {
    const { el, ctx } = mount(button, {
      mode: "toggle",
      argType,
      valueOn: argType === "bool" ? "1" : "go",
      valueOff: argType === "bool" ? "0" : "stop",
    });
    el.fire("click");
    el.fire("click");
    assert.deepStrictEqual(
      ctx.sent.map((m) => m.args),
      expected,
      argType
    );
  }
});

test("an unsendable value drops the message rather than sending zero", () => {
  const { el, ctx } = mount(button, { mode: "toggle", argType: "f", valueOn: "abc", valueOff: "0" });
  el.fire("click");
  assert.deepStrictEqual(ctx.sent, [], "nothing on the wire");

  // And the OFF edge still works, so the button is not wedged.
  el.fire("click");
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "f", value: 0 }]);
});

test("the panel refuses a value the chosen type cannot carry", () => {
  assert.ok(button.checks.valueOn("abc", { argType: "f" }), "float rejects text");
  assert.strictEqual(button.checks.valueOn("abc", { argType: "s" }), null, "string accepts it");
  assert.strictEqual(button.checks.valueOn("1.5", { argType: "f" }), null);
});

test("a blank value is refused by the panel and dropped by the wire, never sent as zero", () => {
  // A space in Value ON with argType f went out as f 0: a blackout.
  for (const argType of ["f", "i"]) {
    assert.ok(button.checks.valueOn(" ", { argType }), argType + " panel");
    const { el, ctx } = mount(button, { mode: "toggle", argType, valueOn: " ", valueOff: "0" });
    el.fire("click");
    assert.deepStrictEqual(ctx.sent, [], argType + " wire");
  }
  // As a string, a space is a string.
  assert.strictEqual(button.checks.valueOn(" ", { argType: "s" }), null);
});

test("a toggle that is on still shows it after the host rewrites its element", () => {
  // Adding a class in the Style Manager wiped the on class: the button
  // painted as off while the rig stayed on, and the next click sent OFF from
  // a button that already looked off.
  const { el, ctx, rewrite } = mount(button, { mode: "toggle" });
  el.fire("click");
  assert.strictEqual(ctx.classes.toggle, true);

  rewrite();
  assert.strictEqual(ctx.classes.toggle, true, "on is painted again");

  el.fire("click");
  assert.strictEqual(ctx.classes.toggle, false);
  rewrite();
  assert.strictEqual(ctx.classes.toggle, false, "and off stays off");
});

test("detaching removes every listener it added", () => {
  const { el, ctx, detach } = mount(button);
  detach();
  el.fire("pointerdown");
  el.fire("click");
  assert.deepStrictEqual(ctx.sent, []);
  assert.strictEqual(el.listenerCount("pointerdown"), 0);
  assert.strictEqual(ctx.listening(), 0);
});

// --- DMX --------------------------------------------------------------------

test("on DMX a button is full while on and out while off, whatever its values say", () => {
  const { el, ctx } = mount(button, { transport: "dmx", valueOn: "go", valueOff: "stop", argType: "s" });
  el.fire("pointerdown");
  el.fire("pointerup");
  assert.deepStrictEqual(ctx.sent.map((m) => m.dmx.levels), [[255], [0]]);
  assert.ok(ctx.sent.every((m) => !("address" in m)), "and no OSC");
});

test("a toggle on DMX alternates full and out", () => {
  const { el, ctx } = mount(button, { transport: "dmx", mode: "toggle", dmxChannel: 12, dmxCount: 2 });
  el.fire("click");
  el.fire("click");
  assert.deepStrictEqual(ctx.sent.map((m) => m.dmx.levels), [[255, 255], [0, 0]]);
  assert.strictEqual(ctx.sent[0].dmx.channel, 12);
});

test("on both, a value OSC cannot carry still drives the dimmer", () => {
  // "go" is a fine string and an impossible float; the DMX half does not
  // depend on it.
  const { el, ctx } = mount(button, { transport: "both", valueOn: "go", valueOff: "0", argType: "f" });
  el.fire("pointerdown");
  assert.deepStrictEqual(ctx.sent, [{ dmx: { protocol: "artnet", host: "", universe: 1, channel: 1, levels: [255] } }]);
  el.fire("pointerup");
  assert.strictEqual(ctx.sent[1].address, "/push1", "the release is sendable as a float, so both halves go");
  assert.deepStrictEqual(ctx.sent[1].dmx.levels, [0]);
});

test("Output is OSC by default, so a saved button sends exactly what it always did", () => {
  assert.strictEqual(button.defaults.transport, "osc");
  const { el, ctx } = mount(button);
  el.fire("pointerdown");
  assert.ok(!("dmx" in ctx.sent[0]));
});

// --- following the rig ------------------------------------------------------

test("a listening toggle adopts the state the rig reports, and sends nothing back", () => {
  const { ctx } = mount(button, { listen: true, mode: "toggle", valueOn: "1", valueOff: "0" });
  ctx.receive("/push1", [1]);
  assert.strictEqual(ctx.classes.toggle, true, "lit");
  assert.deepStrictEqual(ctx.sent, [], "nothing went back out");
  ctx.receive("/push1", [0]);
  assert.strictEqual(ctx.classes.toggle, false);
});

test("a toggle that adopted ON from the rig sends OFF on the next press", () => {
  // Otherwise the operator presses a lit button and the rig gets a second ON.
  const { el, ctx } = mount(button, { listen: true, mode: "toggle", valueOn: "1", valueOff: "0", argType: "i" });
  ctx.receive("/push1", [1]);
  el.fire("click");
  assert.deepStrictEqual(ctx.sent.map((m) => m.args[0].value), [0]);
});

test("a momentary button lights up from the rig but its state stays the finger's", () => {
  const { el, ctx } = mount(button, { listen: true, valueOn: "1", valueOff: "0", argType: "i" });
  ctx.receive("/push1", [1]);
  assert.strictEqual(ctx.classes.toggle, true, "lit");
  assert.deepStrictEqual(ctx.sent, []);

  // A press still sends a real ON edge -- the echo did not swallow it.
  el.fire("pointerdown");
  assert.deepStrictEqual(ctx.sent.map((m) => m.args[0].value), [1]);
  el.fire("pointerup");
  assert.deepStrictEqual(ctx.sent.map((m) => m.args[0].value), [1, 0]);
  assert.strictEqual(ctx.classes.toggle, false, "the release is the latest word; a stale echo does not keep it lit");
});

test("a held momentary button ignores the rig until it is released", () => {
  const { el, ctx } = mount(button, { listen: true, valueOn: "1", valueOff: "0" });
  el.fire("pointerdown");
  ctx.receive("/push1", [0]);
  assert.strictEqual(ctx.classes.toggle, true, "still lit under the finger");
  el.fire("pointerup");
  ctx.receive("/push1", [1]);
  assert.strictEqual(ctx.classes.toggle, true, "follows again once released");
});

test("the button reads its own Value ON and Value OFF coming back, whatever the type", () => {
  const { ctx } = mount(button, { listen: true, mode: "toggle", argType: "s", valueOn: "go", valueOff: "stop" });
  ctx.receive("/push1", ["go"]);
  assert.strictEqual(ctx.classes.toggle, true);
  ctx.receive("/push1", ["stop"]);
  assert.strictEqual(ctx.classes.toggle, false);
  ctx.receive("/push1", [true]);
  assert.strictEqual(ctx.classes.toggle, true, "a bool is itself");
  ctx.receive("/push1", [false]);
  ctx.receive("/push1", [0.7]);
  assert.strictEqual(ctx.classes.toggle, true, "a number is on unless it is zero");
});

test("a value the button cannot read is ignored, not taken as OFF", () => {
  const { ctx } = mount(button, { listen: true, mode: "toggle", valueOn: "1", valueOff: "0" });
  ctx.receive("/push1", [1]);
  for (const args of [[], [null], ["maybe"], [""], [" "], [{}]]) {
    ctx.receive("/push1", args);
    assert.strictEqual(ctx.classes.toggle, true, JSON.stringify(args));
  }
});

test("a blank Value ON or OFF matches nothing, so an empty string cannot light the button", () => {
  // Value ON is blank on a button that sends no argument; the empty string a
  // rig can send must not read as ON through it.
  const { ctx } = mount(button, { listen: true, mode: "toggle", argType: "none", valueOn: "", valueOff: "0" });
  for (const args of [[""], [" "], []]) {
    ctx.receive("/push1", args);
    assert.ok(!ctx.classes || !ctx.classes.toggle, JSON.stringify(args));
  }
  // A bare address is what a no-argument button sends on both edges, so it
  // carries no state and is not followed either.
  const both = mount(button, { listen: true, mode: "toggle", argType: "none", valueOn: "", valueOff: "" });
  both.ctx.receive("/push1", []);
  both.ctx.receive("/push1", [""]);
  assert.ok(!both.ctx.classes || !both.ctx.classes.toggle);
  // Numbers and bools still read as themselves through a blank Value ON.
  ctx.receive("/push1", [1]);
  assert.strictEqual(ctx.classes.toggle, true);
  ctx.receive("/push1", [false]);
  assert.strictEqual(ctx.classes.toggle, false);
});

test("a press that loses the window is released, and the rig is heard again", () => {
  withWindow((win) => {
    const { el, ctx, detach } = mount(button, { listen: true, valueOn: "1", valueOff: "0", argType: "i" });
    el.fire("pointerdown");
    win.fire("blur");
    assert.deepStrictEqual(ctx.sent.map((m) => m.args[0].value), [1, 0], "the release went out");
    ctx.receive("/push1", [1]);
    assert.strictEqual(ctx.classes.toggle, true, "lit from the rig");
    detach();
    assert.strictEqual(win.listenerCount("blur"), 0);
  });
});

test("a button with Enabled off is deaf as well as silent", () => {
  const { ctx } = mount(button, { enabled: false, listen: true, mode: "toggle" });
  ctx.receive("/push1", [1]);
  assert.ok(!ctx.classes || !ctx.classes.toggle);
});

test("a button with Listen off ignores the network", () => {
  const { ctx } = mount(button, { mode: "toggle" });
  ctx.receive("/push1", [1]);
  assert.ok(!ctx.classes || !ctx.classes.toggle);
});

test("a state adopted from the rig survives the host rewriting the element", () => {
  const { ctx, rewrite } = mount(button, { listen: true, mode: "toggle" });
  ctx.receive("/push1", [1]);
  rewrite();
  assert.strictEqual(ctx.classes.toggle, true);
});

test("Listen sits right after Message, and is off by default", () => {
  const keys = button.fields.map((f) => f.key);
  assert.strictEqual(keys[keys.indexOf("message") + 1], "listen");
  assert.strictEqual(button.defaults.listen, false);
});

// --- the other devices ------------------------------------------------------

test("a press is shared with the other devices, alongside the message", () => {
  const { el, ctx } = mount(button, { mode: "toggle" });
  el.fire("click");
  el.fire("click");
  assert.deepStrictEqual(ctx.shared, [{ on: true }, { on: false }]);

  const momentary = mount(button);
  momentary.el.fire("pointerdown");
  momentary.el.fire("pointerup");
  assert.deepStrictEqual(momentary.ctx.shared, [{ on: true }, { on: false }]);
  momentary.el.fire("pointerup");
  assert.strictEqual(momentary.ctx.shared.length, 2, "a release with no press is nothing to share");
});

test("sharing is not gated on Listen, or on Enabled: two tablets agreeing needs no switch", () => {
  const { el, ctx } = mount(button, { mode: "toggle", enabled: false });
  el.fire("click");
  assert.deepStrictEqual(ctx.sent, [], "disabled, so silent");
  assert.deepStrictEqual(ctx.shared, [{ on: true }], "but what it shows is still shared");

  const quiet = mount(button, { mode: "toggle", listen: false });
  quiet.ctx.receiveShared({ on: true });
  assert.strictEqual(quiet.ctx.classes.toggle, true, "and what the others show is still followed");
});

test("a toggle adopts what another device shows, sends nothing, shares nothing, and next sends the opposite edge", () => {
  const { el, ctx } = mount(button, { mode: "toggle", valueOn: "1", valueOff: "0", argType: "i" });
  ctx.receiveShared({ on: true });
  assert.strictEqual(ctx.classes.toggle, true);
  assert.deepStrictEqual(ctx.sent, []);
  assert.deepStrictEqual(ctx.shared, []);

  el.fire("click");
  assert.deepStrictEqual(ctx.sent.map((m) => m.args[0].value), [0], "OFF, not ON again");
  assert.deepStrictEqual(ctx.shared, [{ on: false }]);
});

test("a momentary button lights up with the finger on another device, and the finger here outranks it", () => {
  const { el, ctx } = mount(button);
  ctx.receiveShared({ on: true });
  assert.strictEqual(ctx.classes.toggle, true, "lit: someone is holding it");
  ctx.receiveShared({ on: false });
  assert.strictEqual(ctx.classes.toggle, false);

  el.fire("pointerdown");
  ctx.receiveShared({ on: false });
  assert.strictEqual(ctx.classes.toggle, true, "the finger here is down, so it stays lit");
  el.fire("pointerup");
  assert.strictEqual(ctx.sent.length, 2, "and the release still sends");
  assert.strictEqual(ctx.classes.toggle, false);
});

test("an edge adopted from the rig is shared once, so a device joining later starts where the rig left it", () => {
  const { ctx } = mount(button, { listen: true, mode: "toggle" });
  ctx.receive("/push1", [1]);
  assert.deepStrictEqual(ctx.shared, [{ on: true }]);
  assert.deepStrictEqual(ctx.sent, []);

  // A momentary button under a finger takes nothing from the rig, and so
  // has nothing to pass on.
  const held = mount(button, { listen: true });
  held.el.fire("pointerdown");
  held.ctx.receive("/push1", [0]);
  assert.deepStrictEqual(held.ctx.shared, [{ on: true }], "only the press itself");
});

test("a shared state the button cannot read is ignored, never taken as off", () => {
  const { ctx } = mount(button, { mode: "toggle" });
  ctx.receiveShared({ on: true });
  for (const state of [{}, { on: null }, { on: "false" }, { on: 0 }, { value: 1 }, { on: undefined }]) {
    ctx.receiveShared(state);
    assert.strictEqual(ctx.classes.toggle, true, JSON.stringify(state));
  }
});

test("a host with no other devices to speak of is fine: the button neither shares nor subscribes", () => {
  const { fakeElement, fakeContext } = require("../helpers/fake-dom");
  const ctx = fakeContext(Object.assign({}, button.defaults, { mode: "toggle" }));
  delete ctx.share;
  delete ctx.onShared;
  const el = fakeElement();
  const detach = button.attach(el, ctx);
  el.fire("click");
  assert.strictEqual(ctx.sent.length, 1);
  detach();
  assert.strictEqual(ctx.listening(), 0);
});

test("detaching stops the button following the other devices", () => {
  const { ctx, detach } = mount(button, { mode: "toggle" });
  detach();
  ctx.receiveShared({ on: true });
  assert.ok(!ctx.classes || !ctx.classes.toggle);
  assert.strictEqual(ctx.listening(), 0);
});
