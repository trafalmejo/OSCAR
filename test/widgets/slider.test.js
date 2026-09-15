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
