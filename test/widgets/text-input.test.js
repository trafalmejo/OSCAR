"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { textInput } = require("../../lib/widgets/text-input");
const { mount, lastArgs } = require("../helpers/widgets");

/** Type into the box the way a browser reports it: one input event per key. */
function type(el, text) {
  for (let i = 1; i <= text.length; i++) {
    el.value = text.slice(0, i);
    el.fire("input");
  }
}

// --- when a value goes out ---------------------------------------------------

test("typing sends nothing; Enter sends the whole value once", () => {
  const { el, ctx } = mount(textInput, { argType: "s" });
  type(el, "clip A");
  assert.deepStrictEqual(ctx.sent, [], "no keystroke went out");

  el.fire("keydown", { key: "Enter" });
  assert.strictEqual(ctx.sent.length, 1);
  assert.deepStrictEqual(lastArgs(ctx), [{ type: "s", value: "clip A" }]);
  assert.strictEqual(ctx.sent[0].address, "/text1");
  assert.strictEqual(ctx.config.value, "clip A", "and the value is stored");
});

test("the change a browser fires right after Enter is not a second send", () => {
  const { el, ctx } = mount(textInput);
  type(el, "go");
  el.fire("keydown", { key: "Enter" });
  el.fire("change");
  assert.strictEqual(ctx.sent.length, 1);
});

test("Enter re-sends an unchanged value, because re-sending a cue is normal", () => {
  const { el, ctx } = mount(textInput, { value: "go" });
  el.fire("keydown", { key: "Enter" });
  el.fire("keydown", { key: "Enter" });
  assert.strictEqual(ctx.sent.length, 2);
});

test("leaving the box commits what was typed", () => {
  const { el, ctx } = mount(textInput);
  type(el, "next");
  el.fire("change");
  assert.deepStrictEqual(lastArgs(ctx), [{ type: "s", value: "next" }]);
});

test("Enter is kept from submitting a surrounding form", () => {
  const { el } = mount(textInput);
  let prevented = false;
  el.fire("keydown", { key: "Enter", preventDefault: () => (prevented = true) });
  assert.ok(prevented);
});

test("other keys are not Enter", () => {
  const { el, ctx } = mount(textInput, { value: "go" });
  el.fire("keydown", { key: " " });
  el.fire("keydown", { key: "Tab" });
  assert.deepStrictEqual(ctx.sent, []);
});

test("the argument type is honoured, and a value it cannot carry stays off the wire", () => {
  const { el, ctx } = mount(textInput, { argType: "i" });
  el.value = "12";
  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(lastArgs(ctx), [{ type: "i", value: 12 }]);

  el.value = "abc";
  el.fire("keydown", { key: "Enter" });
  assert.strictEqual(ctx.sent.length, 1, "abc as an int is silence, not zero");
});

test("a blank box under a numeric type sends nothing, never zero", () => {
  for (const argType of ["i", "f"]) {
    const { el, ctx } = mount(textInput, { argType });
    for (const blank of ["", " ", "  "]) {
      el.value = blank;
      el.fire("keydown", { key: "Enter" });
    }
    assert.deepStrictEqual(ctx.sent, [], argType);
  }
});

test("a disabled box takes text but sends nothing", () => {
  const { el, ctx } = mount(textInput, { enabled: false });
  type(el, "go");
  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(ctx.sent, []);
});

test("the text box never drives DMX, and carries none of its settings", () => {
  assert.strictEqual(textInput.dmx, false);
  const keys = textInput.fields.map((f) => f.key);
  for (const key of ["transport", "dmxProtocol", "dmxChannel"]) assert.ok(!keys.includes(key), key);
  assert.ok(!("transport" in textInput.defaults));
});

// --- the element -------------------------------------------------------------

test("the stored value and placeholder are shown, and come back after a rewrite", () => {
  const { el, ctx, rewrite } = mount(textInput, { value: "hello", placeholder: "cue" });
  assert.strictEqual(el.value, "hello");
  assert.strictEqual(el.placeholder, "cue");

  ctx.edit("placeholder", "clip");
  assert.strictEqual(el.placeholder, "clip");

  el.placeholder = "";
  rewrite();
  assert.strictEqual(el.placeholder, "clip");
});

test("a value edited in the panel is shown but not sent", () => {
  const { el, ctx } = mount(textInput);
  ctx.edit("value", "from the panel");
  assert.strictEqual(el.value, "from the panel");
  assert.deepStrictEqual(ctx.sent, []);
});

test("a value put in the box by the panel is not resent by the change that follows", () => {
  const { el, ctx } = mount(textInput);
  ctx.edit("value", "same");
  el.fire("change");
  assert.deepStrictEqual(ctx.sent, []);
});

// --- the panel ---------------------------------------------------------------

test("the panel refuses a value the argument type cannot carry", () => {
  assert.strictEqual(textInput.checks.value("abc", { argType: "s" }), null);
  assert.match(textInput.checks.value("abc", { argType: "f" }), /cannot be sent as f/);
  assert.strictEqual(textInput.checks.value("1.5", { argType: "i" }), null, "an int rounds, as it does on the wire");
  assert.strictEqual(textInput.checks.value("12", { argType: "i" }), null);
  assert.strictEqual(textInput.checks.value("", { argType: "f" }), null, "a float box may start empty");
  assert.strictEqual(textInput.checks.value(" ", { argType: "i" }), null);
  assert.strictEqual(textInput.checks.value("anything", { argType: "none" }), null);
});

test("switching the argument type over a value it cannot carry is refused too", () => {
  // Otherwise GO sits in a box that has just been switched to float, and the
  // widget is silently dead.
  assert.match(textInput.checks.argType("f", { value: "GO" }), /"GO" cannot be sent as f/);
  assert.strictEqual(textInput.checks.argType("s", { value: "GO" }), null);
  assert.strictEqual(textInput.checks.argType("f", { value: "1.5" }), null);
  assert.strictEqual(textInput.checks.argType("f", { value: "" }), null, "an empty box can become a float box");
});

// --- following the rig ---------------------------------------------------------

test("an incoming value fills the box and goes no further", () => {
  const { el, ctx } = mount(textInput, { listen: true });
  ctx.receive("/text1", ["clip B"]);
  assert.strictEqual(el.value, "clip B");
  assert.strictEqual(ctx.config.value, "clip B");
  assert.deepStrictEqual(ctx.sent, []);

  ctx.receive("/text1", [12.5]);
  assert.strictEqual(el.value, "12.5", "a number is shown as its text");
});

test("a value the box cannot show is ignored", () => {
  const { el, ctx } = mount(textInput, { listen: true, value: "kept" });
  for (const args of [[], [null], [{}]]) {
    ctx.receive("/text1", args);
    assert.strictEqual(el.value, "kept", JSON.stringify(args));
  }
});

test("a box being typed into is left alone by the network until it commits", () => {
  const { el, ctx } = mount(textInput, { listen: true, value: "" });
  type(el, "cue 1");
  ctx.receive("/text1", ["echo"]);
  assert.strictEqual(el.value, "cue 1", "the half-typed value stayed under the fingers");
  assert.strictEqual(ctx.config.value, "");

  el.fire("keydown", { key: "Enter" });
  ctx.receive("/text1", ["echo"]);
  assert.strictEqual(el.value, "echo", "and follows again once committed");
});

test("leaving a box mid-edit ends the edit, so the network fills it again", () => {
  const { el, ctx } = mount(textInput, { listen: true, value: "" });
  type(el, "cu");
  el.fire("blur");
  ctx.receive("/text1", ["echo"]);
  assert.strictEqual(el.value, "echo");
});

test("a value put in the box by the network is not resent when the box is left", () => {
  const { el, ctx } = mount(textInput, { listen: true });
  ctx.receive("/text1", ["echo"]);
  el.fire("change");
  assert.deepStrictEqual(ctx.sent, []);
});

test("Listen sits right after Message, and is off by default", () => {
  const keys = textInput.fields.map((f) => f.key);
  assert.strictEqual(keys[keys.indexOf("message") + 1], "listen");
  assert.strictEqual(textInput.defaults.listen, false);
});

test("detaching lets go of everything", () => {
  const { el, ctx, detach } = mount(textInput, { listen: true });
  detach();
  el.value = "go";
  el.fire("keydown", { key: "Enter" });
  ctx.receive("/text1", ["echo"]);
  assert.deepStrictEqual(ctx.sent, []);
  assert.strictEqual(el.value, "go");
  assert.strictEqual(ctx.listening(), 0);
  for (const type of ["keydown", "change", "input", "blur"]) assert.strictEqual(el.listenerCount(type), 0, type);
});
