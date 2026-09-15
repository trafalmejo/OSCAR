"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { slider } = require("../../lib/widgets/slider");
const { mount } = require("../helpers/widgets");

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
