"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { dropdown, parseOptions } = require("../../lib/widgets/dropdown");
const { mount, lastArgs } = require("../helpers/widgets");

/** Pick an option the way a browser reports it. */
function pick(el, value) {
  el.value = value;
  el.fire("input");
}

// --- the option list ---------------------------------------------------------

test("options are typed on one line, as label=value pairs or bare values", () => {
  assert.deepStrictEqual(parseOptions("Red=1, Green=2, Blue=3"), [
    { label: "Red", value: "1" },
    { label: "Green", value: "2" },
    { label: "Blue", value: "3" },
  ]);
  assert.deepStrictEqual(parseOptions("1, 2, 3"), [
    { label: "1", value: "1" },
    { label: "2", value: "2" },
    { label: "3", value: "3" },
  ]);
  assert.deepStrictEqual(parseOptions("Off=0; Full=255"), [
    { label: "Off", value: "0" },
    { label: "Full", value: "255" },
  ]);
  assert.deepStrictEqual(parseOptions(" a = x ,, =y , "), [
    { label: "a", value: "x" },
    { label: "y", value: "y" },
  ]);
  assert.deepStrictEqual(parseOptions(""), []);
  assert.deepStrictEqual(parseOptions(null), []);
});

test("the list is rendered from the setting on attach, and again when it is edited", () => {
  const { el, ctx } = mount(dropdown, { options: "Red=1, Green=2", value: "2" });
  assert.strictEqual(el.innerHTML, '<option value="1">Red</option><option value="2">Green</option>');
  assert.strictEqual(el.value, "2", "the stored selection is restored");

  ctx.edit("options", "A=a, B=b");
  assert.strictEqual(el.innerHTML, '<option value="a">A</option><option value="b">B</option>');
  assert.strictEqual(el.value, "a", "a selection the new list does not offer falls back to the first");
  assert.strictEqual(ctx.config.value, "a", "and is stored, so the box and the project agree");
  assert.deepStrictEqual(ctx.sent, [], "without sending");
});

test("the designer's text is content, never markup", () => {
  const { el } = mount(dropdown, { options: '<b>=1, a"b=2, x=<' });
  assert.strictEqual(
    el.innerHTML,
    '<option value="1">&lt;b&gt;</option><option value="2">a&quot;b</option><option value="&lt;">x</option>'
  );
});

test("the definition carries no options of its own; the setting is the one source", () => {
  assert.ok(!("options" in dropdown.attributes));
  assert.strictEqual(dropdown.text, undefined);
});

// --- when a value goes out ---------------------------------------------------

test("a pick sends the option's value, typed as asked", () => {
  const { el, ctx } = mount(dropdown, { options: "Red=1, Green=2", argType: "i" });
  pick(el, "2");
  assert.deepStrictEqual(ctx.sent.map((m) => m.args), [[{ type: "i", value: 2 }]]);
  assert.strictEqual(ctx.sent[0].address, "/dropdown1");
  assert.strictEqual(ctx.config.value, "2", "and the pick is stored");

  const words = mount(dropdown, { options: "play, stop", argType: "s" });
  pick(words.el, "stop");
  assert.deepStrictEqual(lastArgs(words.ctx), [{ type: "s", value: "stop" }]);
});

test("a value the argument type cannot carry stays off the wire", () => {
  const { el, ctx } = mount(dropdown, { options: "go, stop", argType: "i" });
  pick(el, "go");
  assert.deepStrictEqual(ctx.sent, []);
});

test("a disabled dropdown can be picked from but sends nothing", () => {
  const { el, ctx } = mount(dropdown, { enabled: false });
  pick(el, "2");
  assert.deepStrictEqual(ctx.sent, []);
});

// --- the panel ---------------------------------------------------------------

test("the panel refuses an empty list, and an option the argument type cannot carry", () => {
  const { checks } = dropdown;
  assert.match(checks.options("", { argType: "i" }), /Red=1, Green=2, Blue=3/);
  assert.match(checks.options(" , ", { argType: "i" }), /Red=1/);
  assert.strictEqual(checks.options("Red=1, Green=2", { argType: "i" }), null);
  assert.match(checks.options("Red, Green", { argType: "i" }), /"Red" cannot be sent as i/);
  assert.strictEqual(checks.options("Red, Green", { argType: "s" }), null);
});

test("switching the argument type over options it cannot carry is refused", () => {
  const { checks } = dropdown;
  assert.match(checks.argType("f", { options: "Red, Green", value: "Red" }), /"Red" cannot be sent as f/);
  assert.strictEqual(checks.argType("s", { options: "Red, Green", value: "Red" }), null);
  assert.strictEqual(checks.argType("i", { options: "1, 2", value: "1" }), null);
});

test("the selection has to be one of the options", () => {
  const { checks } = dropdown;
  assert.strictEqual(checks.value("2", { options: "Red=1, Green=2", argType: "i" }), null);
  assert.match(checks.value("3", { options: "Red=1, Green=2", argType: "i" }), /not one of the options/);
});

// --- DMX --------------------------------------------------------------------

test("on DMX the option's value is the level, 0-255", () => {
  const { el, ctx } = mount(dropdown, { transport: "dmx", options: "Off=0, Half=128, Full=255", dmxChannel: 7 });
  pick(el, "128");
  assert.deepStrictEqual(ctx.sent, [{ dmx: { protocol: "artnet", host: "", universe: 1, channel: 7, levels: [128] } }]);
});

test("an option that is not a number drives no DMX, and is not sent as a blackout", () => {
  const { el, ctx } = mount(dropdown, { transport: "both", options: "play, stop", argType: "s" });
  pick(el, "play");
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "s", value: "play" }]);
  assert.ok(!("dmx" in ctx.sent[0]));
});

test("Output is OSC by default", () => {
  assert.strictEqual(dropdown.defaults.transport, "osc");
});

// --- following the rig ---------------------------------------------------------

test("an incoming value selects the option that sends it, and goes no further", () => {
  const { el, ctx } = mount(dropdown, { listen: true, options: "Red=1, Green=2", value: "1" });
  ctx.receive("/dropdown1", [2]);
  assert.strictEqual(el.value, "2", "an int finds the option whose text it is");
  assert.strictEqual(ctx.config.value, "2");
  assert.deepStrictEqual(ctx.sent, []);

  ctx.receive("/dropdown1", ["1"]);
  assert.strictEqual(el.value, "1");
});

test("a value no option sends leaves the dropdown where it was", () => {
  const { el, ctx } = mount(dropdown, { listen: true, options: "Red=1, Green=2", value: "1" });
  for (const args of [[3], ["Red"], [], [null], [{}], [true], [""]]) {
    ctx.receive("/dropdown1", args);
    assert.strictEqual(el.value, "1", JSON.stringify(args));
    assert.strictEqual(ctx.config.value, "1", JSON.stringify(args));
  }
});

test("Listen sits right after Message, and is off by default", () => {
  const keys = dropdown.fields.map((f) => f.key);
  assert.strictEqual(keys[keys.indexOf("message") + 1], "listen");
  assert.strictEqual(dropdown.defaults.listen, false);
});

test("detaching lets go of everything", () => {
  const { el, ctx, detach } = mount(dropdown, { listen: true });
  detach();
  pick(el, "2");
  ctx.receive("/dropdown1", [3]);
  assert.deepStrictEqual(ctx.sent, []);
  assert.strictEqual(ctx.listening(), 0);
  assert.strictEqual(el.listenerCount("input"), 0);
});

// --- review fixes -------------------------------------------------------------

test("on DMX every option has to be a level, and Output is judged from both sides", () => {
  const { checks } = dropdown;
  for (const transport of ["dmx", "both"]) {
    assert.match(checks.options("A=abc", { argType: "s", transport }), /not a DMX level/);
    assert.match(checks.options("A=300", { argType: "i", transport }), /0 to 255/);
    assert.match(checks.options("A=-5", { argType: "i", transport }), /0 to 255/);
    assert.match(checks.transport(transport, { options: "A=abc", argType: "s", transport }), /not a DMX level/);
    assert.strictEqual(checks.options("Off=0, Full=255", { argType: "i", transport }), null);
  }
  assert.strictEqual(checks.options("A=abc", { argType: "s", transport: "osc" }), null);
  assert.strictEqual(checks.transport("osc", { options: "A=abc", argType: "s", transport: "osc" }), null);
});

test("an option that is not a level puts nothing on DMX, never the nearest end", () => {
  // A project file edited by hand gets past the panel; the send path holds.
  const { el, ctx } = mount(dropdown, { options: "A=300, B=-5, C=7", value: "7", transport: "dmx" });
  for (const value of ["300", "-5"]) {
    el.value = value;
    el.fire("input");
  }
  assert.deepStrictEqual(ctx.sent, [], "300 is not full and -5 is not a blackout");
});

test("two options may not send the same value", () => {
  assert.match(dropdown.checks.options("a=1, b=1, c=3", { argType: "i" }), /Two options send "1"/);
});

test("a label may hold an equals sign; the value is what follows the last one", () => {
  assert.deepStrictEqual(parseOptions("EQ=flat=1, Gain=+3=2"), [
    { label: "EQ=flat", value: "1" },
    { label: "Gain=+3", value: "2" },
  ]);
});

test("arrowing through a closed list sends only the row it stops on", () => {
  const { el, ctx } = mount(dropdown, { options: "a=1, b=2, c=3", value: "1" });
  for (const value of ["2", "3"]) {
    el.fire("keydown", { key: "ArrowDown" });
    el.value = value;
    el.fire("input");
  }
  assert.deepStrictEqual(ctx.sent, [], "b was passed, not chosen");
  assert.strictEqual(ctx.config.value, "1");

  el.fire("keydown", { key: "Enter" });
  assert.deepStrictEqual(ctx.sent.map((m) => m.args), [[{ type: "i", value: 3 }]]);
  assert.strictEqual(ctx.config.value, "3");
  el.fire("blur");
  assert.strictEqual(ctx.sent.length, 1, "already sent; leaving adds nothing");
});

test("leaving the list sends the row the keyboard stopped on", () => {
  const { el, ctx } = mount(dropdown, { options: "a=1, b=2, c=3", value: "1" });
  el.fire("keydown", { key: "ArrowDown" });
  el.value = "2";
  el.fire("input");
  el.fire("blur");
  assert.deepStrictEqual(lastArgs(ctx), [{ type: "i", value: 2 }]);
});

test("a pointer pick after keyboard use goes out at once, as does one made with Enter in an open list", () => {
  const { el, ctx } = mount(dropdown, { options: "a=1, b=2, c=3", value: "1" });
  el.fire("keydown", { key: "ArrowDown" });
  el.fire("pointerdown");
  el.value = "3";
  el.fire("input");
  assert.strictEqual(ctx.sent.length, 1);

  el.fire("keydown", { key: "ArrowUp" });
  el.fire("keydown", { key: "Enter" });
  el.value = "2";
  el.fire("input");
  assert.strictEqual(ctx.sent.length, 2);
});

test("a row passed by keyboard is dropped once the rig has spoken", () => {
  const { el, ctx } = mount(dropdown, { options: "a=1, b=2, c=3", value: "1", listen: true });
  el.fire("keydown", { key: "ArrowDown" });
  el.value = "2";
  el.fire("input");
  ctx.receive("/dropdown1", [3]);
  el.fire("blur");
  assert.deepStrictEqual(ctx.sent, []);
  assert.strictEqual(ctx.config.value, "3");
});
