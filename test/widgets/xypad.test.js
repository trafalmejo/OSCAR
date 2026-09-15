"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { xypad } = require("../../lib/widgets/xypad");
const { mount, lastArgs, withWindow } = require("../helpers/widgets");

const SQUARE = { left: 0, top: 0, width: 100, height: 100 };

test("the pad sends both values in one message by default", () => {
  const { el, ctx } = mount(xypad, {
    rect: SQUARE,
    minX: 0,
    maxX: 100,
    minY: 0,
    maxY: 100,
    argType: "f",
  });

  el.fire("pointerdown", { clientX: 30, clientY: 80 });
  el.fire("pointerup", { clientX: 30, clientY: 80 });

  const last = ctx.sent[ctx.sent.length - 1];
  assert.strictEqual(last.address, "/pad");
  // Y reads upward: 80px down a 100px pad is 20.
  assert.deepStrictEqual(last.args, [
    { type: "f", value: 30 },
    { type: "f", value: 20 },
  ]);
});

test("two-message mode splits into /x and /y", () => {
  const { el, ctx } = mount(xypad, { rect: SQUARE, sendMode: "two", argType: "f" });

  el.fire("pointerdown", { clientX: 10, clientY: 90 });
  el.fire("pointerup", { clientX: 10, clientY: 90 });

  const addresses = ctx.sent.map((m) => m.address);
  assert.ok(addresses.includes("/pad/x"));
  assert.ok(addresses.includes("/pad/y"));
});

test("a disabled pad stays silent", () => {
  const { el, ctx } = mount(xypad, { enabled: false });
  el.fire("pointerdown", { clientX: 10, clientY: 10 });
  el.fire("pointerup", { clientX: 10, clientY: 10 });
  assert.deepStrictEqual(ctx.sent, []);
});

test("the pad clamps to its edges rather than running past them", () => {
  const { el, ctx } = mount(xypad, { rect: SQUARE, minX: 0, maxX: 100, argType: "f" });

  el.fire("pointerdown", { clientX: -50, clientY: 500 });
  el.fire("pointerup", { clientX: -50, clientY: 500 });

  assert.deepStrictEqual(lastArgs(ctx), [
    { type: "f", value: 0 },
    { type: "f", value: 0 },
  ]);
});

test("a move without a press does nothing, so a hover never sends", () => {
  const { el, ctx } = mount(xypad, { rect: SQUARE });
  el.fire("pointermove", { clientX: 50, clientY: 50 });
  assert.deepStrictEqual(ctx.sent, []);
});

test("the handle is placed from the saved position on load", () => {
  const { el } = mount(xypad, { minX: 0, maxX: 100, minY: 0, maxY: 100, x: 25, y: 75 });
  assert.strictEqual(el.style.properties["--oscar-x"], "25.00%");
  // Y reads upward, so 75 sits a quarter of the way down.
  assert.strictEqual(el.style.properties["--oscar-y"], "25.00%");
});

test("the handle stays where it was dragged after the host rewrites the element", () => {
  // The position is an inline property, which goes with the style attribute
  // when GrapesJS re-applies its copy of the attributes.
  const { el, rewrite } = mount(xypad, { rect: SQUARE, minX: 0, maxX: 100, minY: 0, maxY: 100 });
  el.fire("pointerdown", { clientX: 30, clientY: 80 });
  el.fire("pointerup", { clientX: 30, clientY: 80 });
  assert.strictEqual(el.style.properties["--oscar-x"], "30.00%");

  rewrite();
  assert.strictEqual(el.style.properties["--oscar-x"], "30.00%");
  assert.strictEqual(el.style.properties["--oscar-y"], "80.00%");
});

// --- DMX --------------------------------------------------------------------

test("on DMX, X lands on the first channel and Y on the next: pan and tilt", () => {
  const { el, ctx } = mount(xypad, { rect: SQUARE, transport: "dmx", dmxChannel: 20 });
  el.fire("pointerdown", { clientX: 100, clientY: 75 });
  el.fire("pointerup", { clientX: 100, clientY: 75 });
  const last = ctx.sent[ctx.sent.length - 1];
  assert.deepStrictEqual(last, { dmx: { protocol: "artnet", host: "", universe: 1, channel: 20, levels: [255, 64] } });
});

test("in two-message mode the OSC goes out twice but the DMX frame once, with both axes", () => {
  // Pan and tilt are one position; a half-updated block would swing the
  // head through somewhere nobody pointed at.
  const { el, ctx } = mount(xypad, { rect: SQUARE, transport: "both", sendMode: "two" });
  el.fire("pointerdown", { clientX: 50, clientY: 50 });
  el.fire("pointerup", { clientX: 50, clientY: 50 });
  const osc = ctx.sent.filter((m) => m.address);
  const dmx = ctx.sent.filter((m) => m.dmx);
  assert.deepStrictEqual(osc.map((m) => m.address).slice(-2), ["/pad/x", "/pad/y"]);
  assert.ok(osc.every((m) => !("dmx" in m)), "no OSC message carries a DMX half");
  assert.strictEqual(dmx.length, ctx.sent.length - osc.length);
  assert.deepStrictEqual(dmx[dmx.length - 1].dmx.levels, [128, 128]);
});

test("in two-message mode on DMX alone, nothing goes to OSC", () => {
  const { el, ctx } = mount(xypad, { rect: SQUARE, transport: "dmx", sendMode: "two" });
  el.fire("pointerdown", { clientX: 0, clientY: 100 });
  el.fire("pointerup", { clientX: 0, clientY: 100 });
  assert.ok(ctx.sent.length >= 1);
  assert.ok(ctx.sent.every((m) => m.dmx && !("address" in m)));
  assert.deepStrictEqual(ctx.sent[ctx.sent.length - 1].dmx.levels, [0, 0]);
});

test("the pad's DMX levels follow its own ranges and inversions", () => {
  const { el, ctx } = mount(xypad, { rect: SQUARE, transport: "dmx", minX: -1, maxX: 1, minY: 0, maxY: 10, invertY: true });
  el.fire("pointerdown", { clientX: 50, clientY: 0 });
  el.fire("pointerup", { clientX: 50, clientY: 0 });
  // X at the centre of -1..1 is 0, halfway; Y inverted at the top is 0.
  assert.deepStrictEqual(ctx.sent[ctx.sent.length - 1].dmx.levels, [128, 0]);
});

test("a pad over more channels than two repeats tilt; over fewer it is refused", () => {
  const wide = mount(xypad, { rect: SQUARE, transport: "dmx", dmxCount: 3 });
  wide.el.fire("pointerdown", { clientX: 100, clientY: 100 });
  wide.el.fire("pointerup", { clientX: 100, clientY: 100 });
  assert.deepStrictEqual(wide.ctx.sent[wide.ctx.sent.length - 1].dmx.levels, [255, 0, 0]);

  const narrow = mount(xypad, { rect: SQUARE, transport: "dmx", dmxCount: 1 });
  narrow.el.fire("pointerdown", { clientX: 100, clientY: 100 });
  narrow.el.fire("pointerup", { clientX: 100, clientY: 100 });
  assert.deepStrictEqual(narrow.ctx.sent, [], "half a position is no position");
  assert.ok(xypad.checks.dmxCount(1, { dmxChannel: 1 }), "and the panel says so");
});

test("Output is OSC by default, so a saved pad sends exactly what it always did", () => {
  assert.strictEqual(xypad.defaults.transport, "osc");
  assert.strictEqual(xypad.defaults.dmxCount, 2, "and its block is two channels wide when it is switched");
});

// --- following the rig ------------------------------------------------------

test("an incoming position moves the handle and the stored values, and sends nothing back", () => {
  const { el, ctx } = mount(xypad, { listen: true, minX: 0, maxX: 100, minY: 0, maxY: 100 });
  ctx.receive("/pad", [25, 75]);
  assert.strictEqual(ctx.config.x, 25);
  assert.strictEqual(ctx.config.y, 75);
  assert.strictEqual(el.style.properties["--oscar-x"], "25.00%");
  assert.strictEqual(el.style.properties["--oscar-y"], "25.00%", "Y reads upward");
  assert.deepStrictEqual(ctx.sent, []);
});

test("in two-message mode each axis follows its own address", () => {
  const { el, ctx } = mount(xypad, { listen: true, sendMode: "two", minX: 0, maxX: 100, minY: 0, maxY: 100 });
  ctx.receive("/pad/x", [40]);
  assert.strictEqual(ctx.config.x, 40);
  assert.strictEqual(ctx.config.y, 0, "the other axis is untouched");
  ctx.receive("/pad/y", [60]);
  assert.strictEqual(ctx.config.y, 60);
  assert.strictEqual(el.style.properties["--oscar-y"], "40.00%");
  ctx.receive("/pad", [1, 2]);
  assert.strictEqual(ctx.config.x, 40, "the one-message shape is not listened to in this mode");
  assert.deepStrictEqual(ctx.sent, []);
});

test("half a position is no position", () => {
  // A handle moved along one axis only would misreport the other.
  const { ctx } = mount(xypad, { listen: true, x: 10, y: 10 });
  for (const args of [[50], [50, null], [50, "abc"], [], [null, 50], ["", 50], [true, 50]]) {
    ctx.receive("/pad", args);
    assert.strictEqual(ctx.config.x, 10, JSON.stringify(args));
    assert.strictEqual(ctx.config.y, 10, JSON.stringify(args));
  }
  ctx.receive("/pad", ["30", "40"]);
  assert.strictEqual(ctx.config.x, 30, "numbers spelled as text are numbers");
});

test("an incoming position is kept inside the pad's ranges", () => {
  const { ctx } = mount(xypad, { listen: true, minX: 0, maxX: 100, minY: -1, maxY: 1 });
  ctx.receive("/pad", [500, -7]);
  assert.strictEqual(ctx.config.x, 100);
  assert.strictEqual(ctx.config.y, -1);
});

test("a finger on the pad outranks the network until it lifts", () => {
  const { el, ctx } = mount(xypad, { rect: SQUARE, listen: true, minX: 0, maxX: 100, minY: 0, maxY: 100 });
  el.fire("pointerdown", { clientX: 30, clientY: 80 });
  el.fire("pointermove", { clientX: 35, clientY: 80 });
  ctx.receive("/pad", [90, 90]);
  assert.strictEqual(ctx.config.x, 35, "the handle stayed under the finger");
  assert.strictEqual(el.style.properties["--oscar-x"], "35.00%");

  el.fire("pointerup", { clientX: 35, clientY: 80 });
  ctx.receive("/pad", [90, 90]);
  assert.strictEqual(ctx.config.x, 90, "and follows again once released");
  assert.strictEqual(el.style.properties["--oscar-x"], "90.00%");
});

test("a drag that loses the window counts as released, so the pad is not left deaf", () => {
  // Alt-tab mid-drag: the pointerup lands on another window and never
  // reaches the pad. The slider and the button already treat blur as a
  // release; a pad that did not would ignore the rig until the next touch.
  withWindow((win) => {
    const { el, ctx, detach } = mount(xypad, { rect: SQUARE, listen: true, minX: 0, maxX: 100, minY: 0, maxY: 100 });
    el.fire("pointerdown", { clientX: 30, clientY: 80 });
    win.fire("blur");
    assert.deepStrictEqual(lastArgs(ctx), [
      { type: "f", value: 30 },
      { type: "f", value: 20 },
    ], "the position it had is what goes out");

    ctx.receive("/pad", [90, 90]);
    assert.strictEqual(ctx.config.x, 90, "the rig gets through again");
    assert.strictEqual(el.style.properties["--oscar-x"], "90.00%");

    detach();
    assert.strictEqual(win.listenerCount("blur"), 0, "and detach lets go of the window");
  });
});

test("a blur with no drag in progress sends nothing", () => {
  withWindow((win) => {
    const { ctx } = mount(xypad, { rect: SQUARE });
    win.fire("blur");
    assert.deepStrictEqual(ctx.sent, []);
  });
});

test("a pad with Listen off ignores the network", () => {
  const { ctx } = mount(xypad, { x: 10, y: 10 });
  ctx.receive("/pad", [50, 50]);
  assert.strictEqual(ctx.config.x, 10);
});

test("Listen sits right after Message, and is off by default", () => {
  const keys = xypad.fields.map((f) => f.key);
  assert.strictEqual(keys[keys.indexOf("message") + 1], "listen");
  assert.strictEqual(xypad.defaults.listen, false);
});

test("detaching stops the pad following the rig", () => {
  const { ctx, detach } = mount(xypad, { listen: true, x: 10, y: 10 });
  detach();
  ctx.receive("/pad", [50, 50]);
  assert.strictEqual(ctx.config.x, 10);
  assert.strictEqual(ctx.listening(), 0);
});
