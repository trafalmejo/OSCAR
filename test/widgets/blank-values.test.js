"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { button } = require("../../lib/widgets/button");
const { slider } = require("../../lib/widgets/slider");
const { mount } = require("../helpers/widgets");

// --- a blank-looking value ---------------------------------------------------

test("a button whose value is only a space stays silent instead of sending 0", () => {
  // Reproduced on master before the fix: pressing sent f 0 -- a blackout.
  const { el, ctx } = mount(button, { mode: "toggle", argType: "f", valueOn: "  ", valueOff: "1" });
  el.fire("click");
  assert.deepStrictEqual(ctx.sent, [], "nothing on the wire");
});

test("the panel refuses a value that is only whitespace", () => {
  const { checkNumber } = require("../../lib/widgets/fields");
  assert.ok(button.checks.valueOn("  ", { argType: "f" }), "button Value ON");
  assert.ok(slider.checks.value("  ", { min: 0, max: 100 }), "slider Value");
  assert.ok(checkNumber("Min X")("  "), "pad range");
  assert.strictEqual(checkNumber("Min X")("5"), null, "a real number is still accepted");
});
