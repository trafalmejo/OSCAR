"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { xypad } = require("../../lib/widgets/xypad");
const { mount, lastArgs } = require("../helpers/widgets");

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
