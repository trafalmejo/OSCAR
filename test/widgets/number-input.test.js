"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { numberInput } = require("../../lib/widgets/number-input");
const { mount, lastArgs, withWindow } = require("../helpers/widgets");

/** Type into the box the way a browser reports it: one input event per key. */
function type(el, text) {
  for (let i = 1; i <= text.length; i++) {
    el.value = text.slice(0, i);
    el.fire("input");
  }
}

/** A click on the stepper arrow: the pointer is down while the value changes. */
function step(el, value) {
  el.fire("pointerdown");
  el.value = value;
  el.fire("input");
  el.fire("pointerup");
}

// --- when a value goes out ---------------------------------------------------

test("typing 12.5 sends neither 1 nor 12; Enter sends 12.5 once", () => {
  const { el, ctx } = mount(numberInput, { argType: "f" });
  type(el, "12.5");
  assert.deepStrictEqual(ctx.sent, [], "no keystroke went out");

  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(ctx.sent.map((m) => m.args), [[{ type: "f", value: 12.5 }]]);
  assert.strictEqual(ctx.sent[0].address, "/number1");
  assert.strictEqual(ctx.config.value, 12.5, "stored as a number");
});

test("leaving the box commits, and the change after Enter does not double up", () => {
  const { el, ctx } = mount(numberInput);
  type(el, "7");
  el.fire("change");
  assert.strictEqual(ctx.sent.length, 1);

  type(el, "8");
  el.fire("keydown", { key: "Enter" });
  el.fire("change");
  assert.strictEqual(ctx.sent.length, 2);
  assert.deepStrictEqual(lastArgs(ctx), [{ type: "f", value: 8 }]);
});

test("Enter re-sends an unchanged value", () => {
  const { el, ctx } = mount(numberInput, { value: 5 });
  el.fire("keydown", { key: "Enter" });
  el.fire("keydown", { key: "Enter" });
  assert.strictEqual(ctx.sent.length, 2);
});

test("a click on the stepper arrow is a finished value and goes out at once", () => {
  const { el, ctx } = mount(numberInput, { value: 5, argType: "i" });
  step(el, "6");
  assert.deepStrictEqual(lastArgs(ctx), [{ type: "i", value: 6 }]);
  // The browser fires change for the step as well; it is the same value.
  el.fire("change");
  assert.strictEqual(ctx.sent.length, 1);
});

test("typing after a stepper click is typing again", () => {
  const { el, ctx } = mount(numberInput, { value: 5 });
  step(el, "6");
  type(el, "60");
  assert.strictEqual(ctx.sent.length, 1, "the pointer was up, so the keystrokes waited");
});

test("an int argument type rounds, as the wire does", () => {
  const { el, ctx } = mount(numberInput, { argType: "i" });
  el.value = "12.5";
  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(lastArgs(ctx), [{ type: "i", value: 13 }]);
});

test("an empty or half-typed box sends nothing, never zero", () => {
  const { el, ctx } = mount(numberInput, { value: 5 });
  for (const text of ["", " ", "-", "1e", "abc"]) {
    el.value = text;
    el.fire("keydown", { key: "Enter" });
    el.fire("change");
    assert.strictEqual(el.value, text, "the text stays so it can be finished: " + JSON.stringify(text));
  }
  assert.deepStrictEqual(ctx.sent, []);
  assert.strictEqual(ctx.config.value, 5, "and the stored value is untouched");
});

test("a value outside Min-Max is refused, not clamped: the rig goes nowhere nobody typed", () => {
  const { el, ctx } = mount(numberInput, { min: 0, max: 255 });
  el.value = "300";
  el.fire("keydown", { key: "Enter" });
  el.value = "-1";
  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(ctx.sent, []);
  assert.strictEqual(el.value, "-1", "the text stays");

  el.value = "255";
  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(lastArgs(ctx), [{ type: "f", value: 255 }], "the limit itself is inside");
});

test("one limit alone is honoured; blank means no limit", () => {
  const { el, ctx } = mount(numberInput, { min: "", max: 10 });
  el.value = "-1000";
  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(lastArgs(ctx), [{ type: "f", value: -1000 }]);
  el.value = "11";
  el.fire("keydown", { key: "Enter" });
  assert.strictEqual(ctx.sent.length, 1);
});

test("a value off the step is refused, and the step is measured from Min", () => {
  const { el, ctx } = mount(numberInput, { min: 1, max: "", step: 2 });
  el.value = "4";
  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(ctx.sent, []);
  el.value = "5";
  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(lastArgs(ctx), [{ type: "f", value: 5 }]);

  // 0.3 is not three of 0.1 in floating point, but it is on the step.
  const fine = mount(numberInput, { step: 0.1 });
  fine.el.value = "0.3";
  fine.el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(lastArgs(fine.ctx), [{ type: "f", value: 0.3 }]);
});

test("a disabled box takes a number but sends nothing", () => {
  const { el, ctx } = mount(numberInput, { enabled: false });
  el.value = "9";
  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(ctx.sent, []);
});

// --- the element -------------------------------------------------------------

test("the limits, step and value land on the element, and come back after a rewrite", () => {
  const { el, ctx, rewrite } = mount(numberInput, { min: 0, max: 100, step: 5, value: 40 });
  assert.strictEqual(el.min, "0");
  assert.strictEqual(el.max, "100");
  assert.strictEqual(el.step, "5");
  assert.strictEqual(el.value, "40");

  ctx.edit("max", 200);
  assert.strictEqual(el.max, "200");
  ctx.edit("step", "");
  assert.strictEqual(el.step, "any", "no step means any");
  ctx.edit("min", "");
  assert.strictEqual(el.min, "", "no limit means no attribute");

  el.max = "";
  rewrite();
  assert.strictEqual(el.max, "200");
});

test("a value edited in the panel is shown but not sent", () => {
  const { el, ctx } = mount(numberInput);
  ctx.edit("value", 33);
  assert.strictEqual(el.value, "33");
  el.fire("change");
  assert.deepStrictEqual(ctx.sent, []);
});

test("the definition carries no copy of what the settings decide", () => {
  for (const key of ["min", "max", "step", "value"]) {
    assert.ok(!(key in numberInput.attributes), key + " is set by attach, not declared");
  }
});

// --- the panel ---------------------------------------------------------------

test("the panel refuses a value that is not a number, or is outside the limits or off the step", () => {
  const { checks } = numberInput;
  assert.strictEqual(checks.value("50", { argType: "f", min: 0, max: 100 }), null);
  assert.match(checks.value("abc", { argType: "f" }), /has to be a number/);
  assert.match(checks.value("150", { argType: "f", min: 0, max: 100 }), /at most 100/);
  assert.match(checks.value("-1", { argType: "f", min: 0, max: "" }), /at least 0/);
  assert.match(checks.value("3", { argType: "f", min: "", max: "", step: 2 }), /steps from 0/);
  assert.strictEqual(checks.value("1e9", { argType: "f" }), null);
  for (const blank of ["", " ", null]) assert.ok(checks.value(blank, { argType: "f" }), JSON.stringify(blank));
});

test("the panel refuses a value the argument type cannot carry, from either side", () => {
  const { checks } = numberInput;
  assert.match(checks.value("3000000000", { argType: "i" }), /cannot be sent as i/);
  assert.strictEqual(checks.value("3000000000", { argType: "f" }), null);
  assert.match(checks.argType("i", { value: 3000000000 }), /cannot be sent as i/);
  assert.strictEqual(checks.argType("i", { value: 12.5 }), null);
});

test("a limit may be blank, must otherwise be a number, and the two must be the right way round", () => {
  const { checks } = numberInput;
  for (const blank of ["", null, undefined]) {
    assert.strictEqual(checks.min(blank, {}), null);
    assert.strictEqual(checks.max(blank, {}), null);
  }
  assert.match(checks.min("abc", {}), /number/);
  assert.match(checks.min(" ", {}), /number/);
  assert.strictEqual(checks.min("0", { max: 100 }), null);
  assert.match(checks.min("200", { max: 100 }), /at most Max/);
  assert.match(checks.max("-1", { min: 0 }), /at most Max/);
  assert.strictEqual(checks.max("100", { min: "" }), null);
});

test("a step may be blank, and is otherwise a number above zero", () => {
  const { checks } = numberInput;
  assert.strictEqual(checks.step(""), null);
  assert.strictEqual(checks.step("0.5"), null);
  assert.match(checks.step("0"), /above zero/);
  assert.match(checks.step("-1"), /above zero/);
  assert.match(checks.step("any"), /above zero/);
});

// --- DMX --------------------------------------------------------------------

test("with no range, the number typed is the DMX level", () => {
  const { el, ctx } = mount(numberInput, { transport: "dmx", dmxChannel: 3 });
  el.value = "128";
  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(ctx.sent, [{ dmx: { protocol: "artnet", host: "", universe: 1, channel: 3, levels: [128] } }]);
});

test("on DMX with no range, a number that is not a level is refused, never pinned", () => {
  for (const transport of ["dmx", "both"]) {
    const { el, ctx } = mount(numberInput, { transport, value: 10 });
    for (const typed of ["-1", "300", "255.5"]) {
      el.value = typed;
      el.fire("keydown", { key: "Enter" });
    }
    assert.deepStrictEqual(ctx.sent, [], transport + ": -1 is not a blackout and 300 is not full");
    assert.strictEqual(ctx.config.value, 10);
    assert.strictEqual(el.min, "0", "the browser marks it, as it does for Min and Max");
    assert.strictEqual(el.max, "255");
  }

  // One limit alone does not make a range, so 0-255 still binds.
  const { el, ctx } = mount(numberInput, { transport: "dmx", min: 10, value: 10 });
  assert.strictEqual(el.min, "10");
  assert.strictEqual(el.max, "255");
  el.value = "300";
  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(ctx.sent, []);

  // On OSC alone there is no such limit.
  const osc = mount(numberInput);
  osc.el.value = "300";
  osc.el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(lastArgs(osc.ctx), [{ type: "f", value: 300 }]);
});

test("the panel refuses what would leave a DMX box holding a number that is not a level", () => {
  const { checks } = numberInput;
  assert.match(checks.value(300, { transport: "dmx", argType: "f" }), /DMX level is 0-255/);
  assert.match(checks.value(-1, { transport: "both", argType: "f" }), /at least 0/);
  assert.strictEqual(checks.value(300, { transport: "dmx", min: 0, max: 1000, argType: "f" }), null);
  assert.match(checks.transport("dmx", { transport: "dmx", value: 300, argType: "f" }), /change the value first/);
  assert.strictEqual(checks.transport("osc", { transport: "osc", value: 300, argType: "f" }), null);
  // Clearing Max takes the range away and brings 0-255 back.
  assert.match(checks.max("", { transport: "dmx", min: 0, max: "", value: 300, argType: "f" }), /change the value first/);
});

test("with Min and Max set, the level is where the number sits between them", () => {
  const { el, ctx } = mount(numberInput, { transport: "both", min: 0, max: 100 });
  el.value = "50";
  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "f", value: 50 }]);
  assert.deepStrictEqual(ctx.sent[0].dmx.levels, [128]);
});

test("Output is OSC by default, so a number box sends no DMX until asked", () => {
  assert.strictEqual(numberInput.defaults.transport, "osc");
  const { el, ctx } = mount(numberInput);
  el.value = "1";
  el.fire("keydown", { key: "Enter" });
  assert.ok(!("dmx" in ctx.sent[0]));
});

// --- following the rig ---------------------------------------------------------

test("an incoming value fills the box, kept inside the limits, and goes no further", () => {
  const { el, ctx } = mount(numberInput, { listen: true, min: 0, max: 100, value: 0 });
  ctx.receive("/number1", [50]);
  assert.strictEqual(el.value, "50");
  assert.strictEqual(ctx.config.value, 50);
  assert.deepStrictEqual(ctx.sent, []);

  ctx.receive("/number1", [150]);
  assert.strictEqual(el.value, "100");
  ctx.receive("/number1", ["-5"]);
  assert.strictEqual(el.value, "0", "a number spelled as text is a number");
});

test("a value the box cannot read is ignored, never taken as zero", () => {
  const { el, ctx } = mount(numberInput, { listen: true, value: 40 });
  for (const args of [[], [null], ["abc"], [""], [" "], [true], [NaN], [{}]]) {
    ctx.receive("/number1", args);
    assert.strictEqual(el.value, "40", JSON.stringify(args));
    assert.strictEqual(ctx.config.value, 40, JSON.stringify(args));
  }
});

test("a box being typed into is left alone by the network until it commits", () => {
  const { el, ctx } = mount(numberInput, { listen: true, value: 0 });
  type(el, "12");
  ctx.receive("/number1", [99]);
  assert.strictEqual(el.value, "12");
  el.fire("keydown", { key: "Enter" });
  ctx.receive("/number1", [99]);
  assert.strictEqual(el.value, "99");
});

test("a value put in the box by the network is not resent when the box is left", () => {
  const { el, ctx } = mount(numberInput, { listen: true });
  ctx.receive("/number1", [7]);
  el.fire("change");
  assert.deepStrictEqual(ctx.sent, []);
});

test("Listen sits right after Message, and is off by default", () => {
  const keys = numberInput.fields.map((f) => f.key);
  assert.strictEqual(keys[keys.indexOf("message") + 1], "listen");
  assert.strictEqual(numberInput.defaults.listen, false);
});

test("detaching lets go of everything", () => {
  const { el, ctx, detach } = mount(numberInput, { listen: true, value: 1 });
  detach();
  el.value = "2";
  el.fire("keydown", { key: "Enter" });
  ctx.receive("/number1", [9]);
  assert.deepStrictEqual(ctx.sent, []);
  assert.strictEqual(el.value, "2");
  assert.strictEqual(ctx.listening(), 0);
  for (const type of ["keydown", "change", "input", "pointerdown", "pointerup"]) {
    assert.strictEqual(el.listenerCount(type), 0, type);
  }
});

// --- review fixes -------------------------------------------------------------

test("a press released outside the box does not turn later typing into cues", () => {
  withWindow((win) => {
    const { el, ctx, detach } = mount(numberInput, { transport: "both", min: 0, max: 100 });
    // Dragging to select the text: down on the box, up somewhere else, so
    // the box itself never hears the release.
    el.fire("pointerdown");
    win.fire("pointerup");
    type(el, "50");
    assert.deepStrictEqual(ctx.sent, [], "the half-typed 5 stayed off the wire");

    el.fire("keydown", { key: "Enter" });
    assert.strictEqual(ctx.sent.length, 1);
    assert.deepStrictEqual(ctx.sent[0].dmx.levels, [128]);

    detach();
    for (const kind of ["pointerup", "pointercancel", "blur"]) assert.strictEqual(win.listenerCount(kind), 0, kind);
  });
});

test("typing is never a step, even with the pointer still down", () => {
  const { el, ctx } = mount(numberInput);
  el.fire("pointerdown");
  for (const text of ["1", "12", "12.5"]) {
    el.value = text;
    el.fire("input", { inputType: "insertText" });
  }
  el.value = "12.";
  el.fire("input", { inputType: "deleteContentBackward" });
  assert.deepStrictEqual(ctx.sent, []);

  // A real step, which says nothing about insertion, still goes at once.
  el.value = "13";
  el.fire("input");
  assert.strictEqual(ctx.sent.length, 1);
});

test("leaving the box ends a hold the box never saw released", () => {
  const { el, ctx } = mount(numberInput);
  el.fire("pointerdown");
  el.fire("blur");
  type(el, "12");
  assert.deepStrictEqual(ctx.sent, []);
});

test("a number the argument type cannot carry is not stored either", () => {
  const { el, ctx } = mount(numberInput, { argType: "i", value: 5 });
  el.value = "3000000000";
  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(ctx.sent, []);
  assert.strictEqual(ctx.config.value, 5, "the project never holds what its own panel would refuse");
  assert.notStrictEqual(numberInput.checks.value(3000000000, { argType: "i" }), null);
});

test("an incoming value is brought onto the step, so Enter can send it back", () => {
  const { el, ctx } = mount(numberInput, { listen: true, min: 0, max: 100, step: 5 });
  ctx.receive("/number1", [7]);
  assert.strictEqual(ctx.config.value, 5);
  assert.strictEqual(el.value, "5");
  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(lastArgs(ctx), [{ type: "f", value: 5 }]);

  // Rounding up must not leave the range: 99 is nearer 100, 100 is off a
  // step of 30 from 0, and the last step inside is 90.
  const coarse = mount(numberInput, { listen: true, min: 0, max: 100, step: 30 });
  coarse.ctx.receive("/number1", [99]);
  assert.strictEqual(coarse.ctx.config.value, 90);

  const fine = mount(numberInput, { listen: true, step: 0.1 });
  fine.ctx.receive("/number1", [0.31]);
  assert.strictEqual(fine.ctx.config.value, 0.3, "not 0.30000000000000004");
});

test("an incoming value no step can rescue is ignored", () => {
  const { ctx } = mount(numberInput, { listen: true, argType: "i", value: 42 });
  ctx.receive("/number1", [3000000000]);
  assert.strictEqual(ctx.config.value, 42);
});

test("a limit or a step that would strand the current Value is refused", () => {
  const { checks } = numberInput;
  assert.match(checks.min(10, { min: 10, max: "", step: "", value: 0, argType: "f" }), /at least 10; change the value first/);
  assert.match(checks.max(5, { min: "", max: 5, step: "", value: 9, argType: "f" }), /at most 5; change the value first/);
  assert.match(checks.step(5, { min: "", max: "", step: 5, value: 7, argType: "f" }), /steps from 0; change the value first/);
  assert.match(checks.min(1, { min: 1, max: "", step: 5, value: 5, argType: "f" }), /steps from 1/, "Min moves the base the step counts from");
  assert.strictEqual(checks.min(0, { min: 0, max: 100, step: 5, value: 10, argType: "f" }), null);
  assert.strictEqual(checks.step("", { min: "", max: "", step: "", value: 7, argType: "f" }), null);
});
