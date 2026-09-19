"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { slider } = require("../../lib/widgets/slider");
const { mount, withWindow } = require("../helpers/widgets");

test("the slider sends its position, and honours the argument type", () => {
  const { el, ctx } = mount(slider, { min: 0, max: 100, argType: "i" });
  el.value = "66.7";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "i", value: 67 }]);
});

test("Invert mirrors the value while the thumb stays put", () => {
  const { el, ctx } = mount(slider, { min: 0, max: 100, invert: true, argType: "f" });
  el.value = "25";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "f", value: 75 }]);
  assert.strictEqual(el.value, "25", "the thumb is not moved by the send");
});

test("the slider restores its saved position instead of the browser midpoint", () => {
  const { el } = mount(slider, { min: 0, max: 100, value: 40 });
  assert.strictEqual(el.value, "40");
});

test("a disabled slider moves but stays silent", () => {
  const { el, ctx } = mount(slider, { enabled: false });
  el.value = "50";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent, []);
});

test("editing the range re-applies it to the thumb", () => {
  const { el, ctx } = mount(slider, { min: 0, max: 100, value: 40 });
  ctx.edit("max", 200);
  assert.strictEqual(el.max, "200");
});

test("the orientation setting lands on the element, where the CSS reads it", () => {
  // public/assets/css/toggle.css turns input[orient=vertical] on its side.
  const { el, ctx } = mount(slider, { orientation: "vertical" });
  assert.strictEqual(el.getAttribute("orient"), "vertical");
  ctx.edit("orientation", "horizontal");
  assert.strictEqual(el.getAttribute("orient"), "horizontal");
});

test("the panel refuses a value outside the range", () => {
  assert.ok(slider.checks.value("150", { min: 0, max: 100 }));
  assert.strictEqual(slider.checks.value("50", { min: 0, max: 100 }), null);
  assert.ok(slider.checks.value("abc", { min: 0, max: 100 }));
});

test("the panel refuses a blank value, which the wire would otherwise read as zero", () => {
  for (const blank of ["", " ", "  ", null]) {
    assert.ok(slider.checks.value(blank, { min: 0, max: 100 }), JSON.stringify(blank));
    assert.ok(slider.checks.min(blank), "min " + JSON.stringify(blank));
    assert.ok(slider.checks.max(blank), "max " + JSON.stringify(blank));
  }
});

test("a vertical slider stays vertical after the host rewrites its element", () => {
  // Adding a class in the Style Manager made GrapesJS re-apply its copy of
  // the attributes, and the slider flipped flat while the setting said vertical.
  const { el, rewrite } = mount(slider, { orientation: "vertical", min: 0, max: 255, value: 200 });
  assert.strictEqual(el.getAttribute("orient"), "vertical");

  rewrite();
  assert.strictEqual(el.getAttribute("orient"), "vertical");
  assert.strictEqual(el.max, "255", "the range comes back with it");
  assert.strictEqual(el.value, "200", "and the thumb, which a lost max would have clamped");
});

test("the definition carries no copy of what the settings decide", () => {
  // A default orient, min or max in the attributes is exactly what the host
  // would re-apply over the real ones.
  for (const key of ["orient", "min", "max"]) {
    assert.ok(!(key in slider.attributes), key + " is set by attach, not declared");
  }
});

// --- DMX --------------------------------------------------------------------

test("on DMX the slider sends its level as 0-255 within its own range", () => {
  const { el, ctx } = mount(slider, { transport: "dmx", min: 0, max: 100, dmxChannel: 5 });
  el.value = "50";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent, [{ dmx: { protocol: "artnet", host: "", universe: 1, channel: 5, levels: [128] } }]);
});

test("a slider labelled in other units still means full at the top", () => {
  const { el, ctx } = mount(slider, { transport: "dmx", min: 20, max: 2000 });
  el.value = "2000";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent[0].dmx.levels, [255]);
  el.value = "20";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent[1].dmx.levels, [0]);
});

test("Invert mirrors the DMX level with the OSC value", () => {
  const { el, ctx } = mount(slider, { transport: "both", min: 0, max: 100, invert: true });
  el.value = "25";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "f", value: 75 }]);
  assert.deepStrictEqual(ctx.sent[0].dmx.levels, [191]);
});

test("a slider over several channels dims them all", () => {
  const { el, ctx } = mount(slider, { transport: "dmx", dmxCount: 3 });
  el.value = "100";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent[0].dmx.levels, [255, 255, 255]);
});

test("a slider with a degenerate range sends no level rather than zero", () => {
  const { el, ctx } = mount(slider, { transport: "dmx", min: 5, max: 5 });
  el.value = "5";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent, []);
});

test("Output is OSC by default, so a saved slider sends exactly what it always did", () => {
  assert.strictEqual(slider.defaults.transport, "osc");
  const { el, ctx } = mount(slider);
  el.value = "50";
  el.fire("input");
  assert.ok(!("dmx" in ctx.sent[0]));
  assert.strictEqual(ctx.sent[0].address, "/slider1");
});

// --- following the rig ------------------------------------------------------

test("an incoming value moves the thumb and the stored value, and sends nothing back", () => {
  const { el, ctx } = mount(slider, { listen: true, min: 0, max: 100, value: 0 });
  ctx.receive("/slider1", [50]);
  assert.strictEqual(el.value, "50", "the thumb followed");
  assert.strictEqual(ctx.config.value, 50, "and so did the stored value");
  assert.deepStrictEqual(ctx.sent, [], "nothing went back out");
});

test("a slider with Listen off ignores the network entirely", () => {
  const { el, ctx } = mount(slider, { min: 0, max: 100, value: 0 });
  ctx.receive("/slider1", [50]);
  assert.strictEqual(el.value, "0");
  assert.deepStrictEqual(ctx.sent, []);
});

test("a listening slider answers to its own address, literally, and to patterns that reach it", () => {
  const { el, ctx } = mount(slider, { listen: true, message: "/fader/1", min: 0, max: 100, value: 0 });
  ctx.receive("/fader/2", [50]);
  assert.strictEqual(el.value, "0");
  ctx.receive("/fader/*", [30]);
  assert.strictEqual(el.value, "30");
  ctx.receive("/fader/1", [60]);
  assert.strictEqual(el.value, "60");
});

test("a value the slider cannot read is ignored, never taken as zero", () => {
  const { el, ctx } = mount(slider, { listen: true, min: 0, max: 100, value: 40 });
  for (const args of [[], [null], ["abc"], [""], [" "], [true], [NaN], [{}]]) {
    ctx.receive("/slider1", args);
    assert.strictEqual(el.value, "40", JSON.stringify(args));
    assert.strictEqual(ctx.config.value, 40, JSON.stringify(args));
  }
  ctx.receive("/slider1", ["55"]);
  assert.strictEqual(el.value, "55", "a number spelled as text is a number");
});

test("an incoming value is kept inside the range, so the thumb and the value agree", () => {
  const { el, ctx } = mount(slider, { listen: true, min: 0, max: 100, value: 40 });
  ctx.receive("/slider1", [150]);
  assert.strictEqual(ctx.config.value, 100);
  assert.strictEqual(el.value, "100");
  ctx.receive("/slider1", [-5]);
  assert.strictEqual(ctx.config.value, 0);
});

test("with Invert on, the value received is the wire value and the thumb mirrors it", () => {
  // The rig echoes what was sent, which was already mirrored; storing it as
  // sent and mirroring for display keeps a round trip from drifting.
  const { el, ctx } = mount(slider, { listen: true, invert: true, min: 0, max: 100, value: 0 });
  ctx.receive("/slider1", [75]);
  assert.strictEqual(ctx.config.value, 75);
  assert.strictEqual(el.value, "25");
});

test("a hand on the thumb outranks the network until it lets go", () => {
  const { el, ctx } = mount(slider, { listen: true, min: 0, max: 100, value: 10 });
  el.fire("pointerdown");
  el.value = "20";
  el.fire("input");
  ctx.receive("/slider1", [90]);
  assert.strictEqual(el.value, "20", "the thumb stayed under the finger");
  assert.strictEqual(ctx.config.value, 20);

  el.fire("pointerup");
  ctx.receive("/slider1", [90]);
  assert.strictEqual(el.value, "90", "and follows again once released");
});

test("a cancelled drag also lets the network back in", () => {
  const { el, ctx } = mount(slider, { listen: true, min: 0, max: 100, value: 10 });
  el.fire("pointerdown");
  el.fire("pointercancel");
  ctx.receive("/slider1", [90]);
  assert.strictEqual(el.value, "90");
});

test("a drag that loses the window also lets the network back in", () => {
  withWindow((win) => {
    const { el, ctx, detach } = mount(slider, { listen: true, min: 0, max: 100, value: 10 });
    el.fire("pointerdown");
    win.fire("blur");
    ctx.receive("/slider1", [90]);
    assert.strictEqual(el.value, "90");
    detach();
    assert.strictEqual(win.listenerCount("blur"), 0);
  });
});

test("a slider with Enabled off is deaf as well as silent", () => {
  // Enabled is the master switch: a surface is switched off to be laid out
  // while the rig is live, and a thumb jumping under the pointer is not.
  const { el, ctx } = mount(slider, { enabled: false, listen: true, min: 0, max: 100, value: 10 });
  ctx.receive("/slider1", [90]);
  assert.strictEqual(el.value, "10");
  assert.strictEqual(ctx.config.value, 10);
  ctx.edit("enabled", true);
  ctx.receive("/slider1", [90]);
  assert.strictEqual(el.value, "90", "and follows again once switched on");
});

test("Listen sits right after Message, and is off by default", () => {
  const keys = slider.fields.map((f) => f.key);
  assert.strictEqual(keys[keys.indexOf("message") + 1], "listen");
  assert.strictEqual(slider.defaults.listen, false);
});

test("detaching stops the slider following the rig", () => {
  const { el, ctx, detach } = mount(slider, { listen: true, min: 0, max: 100, value: 10 });
  detach();
  ctx.receive("/slider1", [90]);
  assert.strictEqual(el.value, "10");
  assert.strictEqual(ctx.listening(), 0);
  assert.strictEqual(el.listenerCount("pointerdown"), 0);
});

// --- the other devices ------------------------------------------------------

test("a move is shared with the other devices, alongside the message", () => {
  const { el, ctx } = mount(slider, { min: 0, max: 100, invert: true });
  el.value = "30";
  el.fire("input");
  assert.deepStrictEqual(ctx.shared, [{ value: 70 }], "the value sent, which Invert mirrored");
  assert.strictEqual(ctx.sent.length, 1);
});

test("a value another device shows moves the thumb, and is neither sent nor shared again", () => {
  const { el, ctx } = mount(slider, { min: 0, max: 100, value: 10 });
  ctx.receiveShared({ value: 55 });
  assert.strictEqual(el.value, "55");
  assert.strictEqual(ctx.config.value, 55);
  assert.deepStrictEqual(ctx.sent, []);
  assert.deepStrictEqual(ctx.shared, []);
});

test("sharing is not gated on Listen or Enabled", () => {
  const { el, ctx } = mount(slider, { enabled: false, listen: false, min: 0, max: 100, value: 10 });
  ctx.receiveShared({ value: 55 });
  assert.strictEqual(el.value, "55", "followed with Listen off and Enabled off");
  el.value = "20";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent, [], "silent while disabled");
  assert.deepStrictEqual(ctx.shared, [{ value: 20 }], "but still shared");
});

test("a value adopted from the rig is shared once, so a device joining later starts where the rig left it", () => {
  const { ctx } = mount(slider, { listen: true, min: 0, max: 100, value: 10 });
  ctx.receive("/slider1", [150]);
  assert.deepStrictEqual(ctx.shared, [{ value: 100 }], "the value kept, inside the range");
  assert.deepStrictEqual(ctx.sent, []);
  ctx.receive("/slider1", ["abc"]);
  assert.strictEqual(ctx.shared.length, 1, "nothing to share for a value that was not taken");
});

test("a hand on the thumb outranks the other devices until it lets go", () => {
  const { el, ctx } = mount(slider, { min: 0, max: 100, value: 10 });
  el.fire("pointerdown");
  ctx.receiveShared({ value: 90 });
  assert.strictEqual(el.value, "10");
  assert.strictEqual(ctx.config.value, 10);
  el.fire("pointerup");
  ctx.receiveShared({ value: 90 });
  assert.strictEqual(el.value, "90");
});

test("a shared value is kept inside the range, and one the slider cannot read is ignored, never taken as zero", () => {
  const { el, ctx } = mount(slider, { min: 0, max: 100, value: 10 });
  ctx.receiveShared({ value: 500 });
  assert.strictEqual(el.value, "100");
  for (const state of [{}, { value: null }, { value: "" }, { value: "  " }, { value: "abc" }, { on: true }, { value: [5] }]) {
    ctx.receiveShared(state);
    assert.strictEqual(el.value, "100", JSON.stringify(state));
    assert.strictEqual(ctx.config.value, 100);
  }
  ctx.receiveShared({ value: "42" });
  assert.strictEqual(el.value, "42", "text that spells a number is a number");
});

test("a host with no other devices to speak of is fine: the slider neither shares nor subscribes", () => {
  const { fakeElement, fakeContext } = require("../helpers/fake-dom");
  const ctx = fakeContext(Object.assign({}, slider.defaults));
  delete ctx.share;
  delete ctx.onShared;
  const el = fakeElement();
  const detach = slider.attach(el, ctx);
  el.value = "40";
  el.fire("input");
  assert.strictEqual(ctx.sent.length, 1);
  detach();
  assert.strictEqual(ctx.listening(), 0);
});

test("what another device said under a resting finger is caught up with when it lifts, without a send or a share", () => {
  // The other devices are told of a change once. Dropped for good, it left
  // this thumb out of step with theirs until somebody moved it again.
  const { el, ctx } = mount(slider, { min: 0, max: 100, value: 10 });
  el.fire("pointerdown");
  ctx.receiveShared({ value: 90 });
  ctx.receiveShared({ value: "" });
  assert.strictEqual(el.value, "10", "the finger still outranks it");
  el.fire("pointerup");
  assert.strictEqual(el.value, "90");
  assert.strictEqual(ctx.config.value, 90);
  assert.deepStrictEqual(ctx.sent, [], "a value from outside never goes back out");
  assert.deepStrictEqual(ctx.shared, []);
});

test("a hand that moved after the other device spoke has the last word", () => {
  const { el, ctx } = mount(slider, { min: 0, max: 100, value: 10 });
  el.fire("pointerdown");
  ctx.receiveShared({ value: 90 });
  el.value = "30";
  el.fire("input");
  el.fire("pointerup");
  assert.strictEqual(el.value, "30");
  assert.strictEqual(ctx.config.value, 30);
});

test("a value from the rig is shared as heard, a value from a hand is not", () => {
  const { el, ctx } = mount(slider, { min: 0, max: 100, listen: true });
  ctx.receive("/slider1", [35]);
  el.value = "40";
  el.fire("input");
  assert.deepStrictEqual(ctx.shared, [{ value: 35 }, { value: 40 }]);
  assert.deepStrictEqual(ctx.sharedHow, [{ heard: true }, null]);
});

test("detaching stops the slider following the other devices", () => {
  const { el, ctx, detach } = mount(slider, { min: 0, max: 100, value: 10 });
  detach();
  ctx.receiveShared({ value: 90 });
  assert.strictEqual(el.value, "10");
  assert.strictEqual(ctx.listening(), 0);
});
