"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { button } = require("../lib/widgets/button");
const { slider } = require("../lib/widgets/slider");
const { xypad } = require("../lib/widgets/xypad");
const { outgoing } = require("../lib/widgets/outgoing");
const { WIDGETS } = require("../lib/widgets");
const { fakeElement, fakeContext } = require("./helpers/fake-dom");

/** A widget wired to a fake element, ready to be poked. */
function mount(widget, overrides) {
  const el = fakeElement(overrides && overrides.rect);
  const ctx = fakeContext(Object.assign({}, widget.defaults, overrides));
  const detach = widget.attach(el, ctx);
  return { el, ctx, detach };
}

// --- the Enabled switch -----------------------------------------------------

test("a disabled widget sends nothing at all", () => {
  const message = outgoing({ enabled: false, ip: "1.2.3.4", port: 7000, message: "/x", argType: "f" }, 1);
  assert.strictEqual(message, null);
});

test("Enabled is off by default nowhere -- a widget you drop works immediately", () => {
  for (const widget of WIDGETS) {
    assert.strictEqual(widget.defaults.enabled, true, widget.name);
  }
});

test("a disabled button stays silent however it is pressed", () => {
  const { el, ctx } = mount(button, { enabled: false, mode: "toggle" });
  el.fire("click");
  el.fire("click");
  assert.deepStrictEqual(ctx.sent, []);
});

// --- button modes -----------------------------------------------------------

test("momentary sends ON while held and OFF on release", () => {
  const { el, ctx } = mount(button, { valueOn: "1", valueOff: "0", argType: "i" });

  el.fire("pointerdown");
  assert.deepStrictEqual(ctx.sent.map((m) => m.args), [[{ type: "i", value: 1 }]]);

  el.fire("pointerup");
  assert.deepStrictEqual(ctx.sent.map((m) => m.args), [
    [{ type: "i", value: 1 }],
    [{ type: "i", value: 0 }],
  ]);
});

test("momentary holds for as long as the finger does, not a fixed 250ms", () => {
  // The old button fired OFF on a timer, so a long hold released itself
  // mid-show while the finger was still down.
  const { el, ctx } = mount(button);
  el.fire("pointerdown");
  assert.strictEqual(ctx.sent.length, 1, "nothing follows until release");
});

test("toggle alternates, and shows its state without touching the model", () => {
  const { el, ctx } = mount(button, { mode: "toggle", valueOn: "1", valueOff: "0", argType: "i" });

  el.fire("click");
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "i", value: 1 }]);
  assert.strictEqual(el.classList.contains("toggle"), false, "class goes on the element");
  assert.strictEqual(ctx.classes.toggle, true);

  el.fire("click");
  assert.deepStrictEqual(ctx.sent[1].args, [{ type: "i", value: 0 }]);
  assert.strictEqual(ctx.classes.toggle, false);
});

test("a click in momentary mode does not double-fire after a press", () => {
  // A touch produces pointerdown, pointerup and then a synthetic click.
  const { el, ctx } = mount(button);
  el.fire("pointerdown");
  el.fire("pointerup");
  el.fire("click");
  assert.strictEqual(ctx.sent.length, 2, "one ON and one OFF, not three messages");
});

test("a repeated key does not retrigger, because downstream a repeat is a retrigger", () => {
  const { el, ctx } = mount(button);
  el.fire("keydown", { key: " " });
  el.fire("keydown", { key: " ", repeat: true });
  el.fire("keydown", { key: " ", repeat: true });
  assert.strictEqual(ctx.sent.length, 1);

  el.fire("keyup", { key: " " });
  assert.strictEqual(ctx.sent.length, 2);
});

test("pointercancel releases, so a drag off the button cannot strand it on", () => {
  const { el, ctx } = mount(button);
  el.fire("pointerdown");
  el.fire("pointercancel");
  assert.strictEqual(ctx.sent.length, 2);
  assert.strictEqual(ctx.classes.toggle, false);
});

test("releasing without a press sends nothing", () => {
  const { el, ctx } = mount(button);
  el.fire("pointerup");
  assert.deepStrictEqual(ctx.sent, []);
});

// --- button values ----------------------------------------------------------

test("Value OFF is configurable, not hardcoded to zero", () => {
  const { el, ctx } = mount(button, {
    mode: "toggle",
    valueOn: "3",
    valueOff: "7",
    argType: "i",
    message: "/clip",
  });

  el.fire("click");
  el.fire("click");
  assert.deepStrictEqual(
    ctx.sent.map((m) => m.args[0].value),
    [3, 7]
  );
  assert.deepStrictEqual(ctx.sent.map((m) => m.address), ["/clip", "/clip"]);
});

test("a button can send strings, bools, or a bare address", () => {
  const cases = {
    s: [[{ type: "s", value: "go" }], [{ type: "s", value: "stop" }]],
    bool: [[{ type: "T" }], [{ type: "F" }]],
    none: [[], []],
  };

  for (const [argType, expected] of Object.entries(cases)) {
    const { el, ctx } = mount(button, {
      mode: "toggle",
      argType,
      valueOn: argType === "bool" ? "1" : "go",
      valueOff: argType === "bool" ? "0" : "stop",
    });
    el.fire("click");
    el.fire("click");
    assert.deepStrictEqual(
      ctx.sent.map((m) => m.args),
      expected,
      argType
    );
  }
});

test("an unsendable value drops the message rather than sending zero", () => {
  const { el, ctx } = mount(button, { mode: "toggle", argType: "f", valueOn: "abc", valueOff: "0" });
  el.fire("click");
  assert.deepStrictEqual(ctx.sent, [], "nothing on the wire");

  // And the OFF edge still works, so the button is not wedged.
  el.fire("click");
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "f", value: 0 }]);
});

test("the panel refuses a value the chosen type cannot carry", () => {
  assert.ok(button.checks.valueOn("abc", { argType: "f" }), "float rejects text");
  assert.strictEqual(button.checks.valueOn("abc", { argType: "s" }), null, "string accepts it");
  assert.strictEqual(button.checks.valueOn("1.5", { argType: "f" }), null);
});

// --- slider -----------------------------------------------------------------

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

// --- xy pad -----------------------------------------------------------------

test("the pad sends both values in one message by default", () => {
  const { el, ctx } = mount(xypad, {
    rect: { left: 0, top: 0, width: 100, height: 100 },
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
  const { el, ctx } = mount(xypad, {
    rect: { left: 0, top: 0, width: 100, height: 100 },
    sendMode: "two",
    argType: "f",
  });

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
  const { el, ctx } = mount(xypad, {
    rect: { left: 0, top: 0, width: 100, height: 100 },
    minX: 0,
    maxX: 100,
    argType: "f",
  });

  el.fire("pointerdown", { clientX: -50, clientY: 500 });
  el.fire("pointerup", { clientX: -50, clientY: 500 });

  const last = ctx.sent[ctx.sent.length - 1];
  assert.deepStrictEqual(last.args, [
    { type: "f", value: 0 },
    { type: "f", value: 0 },
  ]);
});

// --- DMX --------------------------------------------------------------------

test("a widget left on OSC puts nothing on the DMX wire", () => {
  // The default has to be exactly the OSCAR that existed before DMX did, or
  // every saved project starts driving channel 1 of universe 1 on load.
  for (const widget of WIDGETS) {
    assert.strictEqual(widget.defaults.transport, "osc", widget.name);
  }

  const { el, ctx } = mount(slider, { min: 0, max: 100 });
  el.value = "50";
  el.fire("input");
  assert.strictEqual(ctx.sent[0].dmx, undefined);
});

test("a slider on DMX scales its own travel onto the channel's", () => {
  const { el, ctx } = mount(slider, {
    transport: "dmx",
    min: 0,
    max: 100,
    dmxChannel: 12,
    dmxUniverse: 3,
    dmxProtocol: "sacn",
    dmxHost: "10.0.0.7",
  });

  el.value = "66.7";
  el.fire("input");

  assert.deepStrictEqual(ctx.sent[0].dmx, {
    protocol: "sacn",
    host: "10.0.0.7",
    universe: 3,
    channel: 12,
    levels: [170],
    source: "widget-1",
  });
  assert.strictEqual(ctx.sent[0].address, undefined, "and no OSC, because DMX is all it was asked for");
});

test("OSC and DMX travel together when a widget is set to both", () => {
  const { el, ctx } = mount(slider, { transport: "both", min: 0, max: 100, argType: "f" });

  el.value = "100";
  el.fire("input");

  const message = ctx.sent[0];
  assert.deepStrictEqual(message.args, [{ type: "f", value: 100 }]);
  assert.deepStrictEqual(message.dmx.levels, [255]);
});

test("Invert flips DMX as well as OSC, because it is one fader", () => {
  const { el, ctx } = mount(slider, { transport: "dmx", min: 0, max: 100, invert: true });
  el.value = "0";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent[0].dmx.levels, [255]);
});

test("one value covers the whole block, so a fader dims a fixture as a unit", () => {
  const { el, ctx } = mount(slider, { transport: "dmx", min: 0, max: 100, dmxCount: 3 });
  el.value = "100";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent[0].dmx.levels, [255, 255, 255]);
});

test("a block that would run past channel 512 is cut to what fits", () => {
  // The panel refuses this while someone is looking; a hand-edited project file
  // arrives here instead, and a packet claiming channel 513 is one no node reads.
  const { el, ctx } = mount(slider, {
    transport: "dmx",
    min: 0,
    max: 100,
    dmxChannel: 511,
    dmxCount: 8,
  });
  el.value = "100";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent[0].dmx.levels, [255, 255]);
});

test("a button bumps its channels to full and back out", () => {
  const { el, ctx } = mount(button, { transport: "dmx", mode: "toggle", dmxChannel: 5 });

  el.fire("click");
  assert.deepStrictEqual(ctx.sent[0].dmx.levels, [255]);
  assert.strictEqual(ctx.sent[0].dmx.channel, 5);

  el.fire("click");
  assert.deepStrictEqual(ctx.sent[1].dmx.levels, [0], "a deliberate zero is a real instruction");
});

test("a button whose OSC value cannot be sent still drives DMX", () => {
  // The two halves fail independently: "go" is unsendable as a float and
  // perfectly sendable as a level.
  const { el, ctx } = mount(button, {
    transport: "both",
    mode: "toggle",
    argType: "f",
    valueOn: "go",
  });

  el.fire("click");
  assert.strictEqual(ctx.sent[0].address, undefined, "the OSC half was dropped");
  assert.deepStrictEqual(ctx.sent[0].dmx.levels, [255]);
});

test("an XY pad lands on two consecutive channels, which is pan and tilt", () => {
  const { el, ctx } = mount(xypad, {
    rect: { left: 0, top: 0, width: 100, height: 100 },
    transport: "dmx",
    dmxChannel: 20,
  });

  el.fire("pointerdown", { clientX: 30, clientY: 80 });
  el.fire("pointerup", { clientX: 30, clientY: 80 });

  const dmx = ctx.sent[ctx.sent.length - 1].dmx;
  assert.strictEqual(dmx.channel, 20);
  // X is 30% across; Y reads upward, so 80px down a 100px pad is 20%.
  assert.deepStrictEqual(dmx.levels, [77, 51]);
});

test("a pad splitting into /x and /y still claims its channels exactly once", () => {
  // Two DMX requests under one widget id would replace rather than add, so X
  // would be erased by Y and the light would only ever tilt.
  const { el, ctx } = mount(xypad, {
    rect: { left: 0, top: 0, width: 100, height: 100 },
    transport: "both",
    sendMode: "two",
  });

  el.fire("pointerdown", { clientX: 30, clientY: 80 });
  el.fire("pointerup", { clientX: 30, clientY: 80 });

  const dmx = ctx.sent.filter((m) => m.dmx);
  const osc = ctx.sent.filter((m) => m.address);
  assert.deepStrictEqual([...new Set(osc.map((m) => m.address))].sort(), ["/pad/x", "/pad/y"]);
  // One DMX claim per position rather than one per OSC address, and it carries
  // both axes.
  assert.strictEqual(dmx.length, osc.length / 2);
  assert.deepStrictEqual(dmx[dmx.length - 1].dmx.levels, [77, 51]);
});

test("a value that cannot be read sends nothing at all, never a zero", () => {
  // The whole of the DMX safety rule in one test: a range that cannot be
  // scaled produces no level, and no level means the rig holds where it is.
  const { el, ctx } = mount(slider, { transport: "dmx", min: 50, max: 50 });
  el.value = "50";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent, []);

  const pad = mount(xypad, {
    rect: { left: 0, top: 0, width: 100, height: 100 },
    transport: "dmx",
    minY: "",
    maxY: "",
  });
  pad.el.fire("pointerdown", { clientX: 10, clientY: 10 });
  pad.el.fire("pointerup", { clientX: 10, clientY: 10 });
  assert.deepStrictEqual(pad.ctx.sent, [], "one unreadable axis drops the pair");
});

test("a disabled widget is silent on DMX too", () => {
  const { el, ctx } = mount(slider, { enabled: false, transport: "dmx" });
  el.value = "50";
  el.fire("input");
  assert.deepStrictEqual(ctx.sent, []);
});

test("every widget can be pointed at DMX, in the same words", () => {
  for (const widget of WIDGETS) {
    const keys = widget.fields.map((f) => f.key);
    for (const required of [
      "transport",
      "dmxProtocol",
      "dmxHost",
      "dmxUniverse",
      "dmxChannel",
      "dmxCount",
    ]) {
      assert.ok(keys.includes(required), widget.name + " has " + required);
    }
  }
});

test("the panel refuses a universe the chosen protocol does not have", () => {
  const check = slider.checks.dmxUniverse;
  assert.strictEqual(check(0, { dmxProtocol: "artnet" }), null, "Art-Net starts at 0");
  assert.ok(check(0, { dmxProtocol: "sacn" }), "E1.31 reserves universe 0");
  assert.ok(check(40000, { dmxProtocol: "artnet" }));
  assert.strictEqual(check(40000, { dmxProtocol: "sacn" }), null);
  assert.ok(check("", { dmxProtocol: "artnet" }));
});

test("the panel refuses a channel block that runs off the end of the universe", () => {
  assert.strictEqual(slider.checks.dmxChannel(512), null);
  assert.ok(slider.checks.dmxChannel(513));
  assert.ok(slider.checks.dmxChannel(0));
  assert.strictEqual(slider.checks.dmxCount(4, { dmxChannel: 509 }), null);
  assert.ok(slider.checks.dmxCount(5, { dmxChannel: 509 }), "509 + 5 is past 512");
});

test("the DMX settings stay out of the way until a widget is pointed at DMX", () => {
  // Every widget would otherwise gain six fields that most surfaces never use.
  const { visibleFields, revealKeys } = require("../public/src/adapters/grapesjs");

  const keysWhen = (transport) =>
    visibleFields(slider, Object.assign({}, slider.defaults, { transport })).map((f) => f.key);

  assert.ok(!keysWhen("osc").includes("dmxUniverse"), "hidden on an OSC widget");
  assert.ok(keysWhen("dmx").includes("dmxUniverse"));
  assert.ok(keysWhen("both").includes("dmxUniverse"));
  assert.ok(keysWhen("osc").includes("transport"), "but the switch itself is always there");

  assert.deepStrictEqual(revealKeys(slider), ["transport"], "and the adapter knows what to watch");
});

// --- shared shape -----------------------------------------------------------

test("Enabled leads on every widget, above even the label", () => {
  // Whether a control is live matters more than what it is called, and a
  // master switch buried mid-panel is one you do not find mid-show.
  for (const widget of WIDGETS) {
    assert.strictEqual(widget.fields[0].key, "enabled", widget.name);
  }
});

test("every widget offers the same four settings, so they feel like one instrument", () => {
  for (const widget of WIDGETS) {
    const keys = widget.fields.map((f) => f.key);
    for (const required of ["enabled", "ip", "port", "message", "argType"]) {
      assert.ok(keys.includes(required), widget.name + " has " + required);
    }
  }
});

test("every field a widget declares has a default behind it", () => {
  // A trait with no default renders empty and writes undefined into the
  // project the first time it is touched.
  for (const widget of WIDGETS) {
    for (const field of widget.fields) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(widget.defaults, field.key),
        widget.name + " has a default for " + field.key
      );
    }
  }
});

test("every select offers its own default as one of the options", () => {
  for (const widget of WIDGETS) {
    for (const field of widget.fields) {
      if (field.type !== "select") continue;
      const ids = field.options.map((o) => o.id);
      assert.ok(
        ids.includes(widget.defaults[field.key]),
        widget.name + "." + field.key + " default is selectable"
      );
    }
  }
});

test("widget definitions stay free of the editor", () => {
  // The point of lib/widgets: swapping GrapesJS means rewriting one adapter.
  // Comments may name it -- they are how the seam is documented; code may not.
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "..", "lib", "widgets");

  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  for (const file of fs.readdirSync(dir)) {
    const code = stripComments(fs.readFileSync(path.join(dir, file), "utf8"));
    assert.ok(!/grapesjs/i.test(code), file + " depends on GrapesJS");
    // Nor on anything else that only exists inside an editor.
    assert.ok(!/\beditor\./.test(code), file + " reaches for an editor");
  }
});

test("only the adapter knows which editor OSCAR uses", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = path.join(__dirname, "..", "public", "src");

  const offenders = fs
    .readdirSync(src)
    .filter((f) => f.startsWith("oscar_") && f.endsWith(".js"))
    .filter((f) => /DomComponents|BlockManager/.test(fs.readFileSync(path.join(src, f), "utf8")));

  assert.deepStrictEqual(offenders, [], "these register components outside the adapter");
});
