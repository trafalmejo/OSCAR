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
