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

// --- slider fill -------------------------------------------------------------
// toggle.css draws the filled part of the track from --oscar-fill, because a
// native range input cannot style "the part before the thumb" in Chromium.

const fill = (el) => el.style.properties["--oscar-fill"];

test("the fill starts where the saved value puts the thumb", () => {
  assert.strictEqual(fill(mount(slider, { min: 0, max: 100, value: 40 }).el), "40.00%");
  assert.strictEqual(fill(mount(slider, { min: -50, max: 50, value: 0 }).el), "50.00%");
});

test("the fill follows the thumb as it is dragged", () => {
  const { el } = mount(slider, { min: 0, max: 200, value: 0 });
  el.value = "150";
  el.fire("input");
  assert.strictEqual(fill(el), "75.00%");
});

test("the fill follows the thumb, not the inverted value that is sent", () => {
  // With Invert on, 25 on the track sends 75; the fill belongs under the finger.
  const { el, ctx } = mount(slider, { min: 0, max: 100, invert: true, argType: "f" });
  el.value = "25";
  el.fire("input");
  assert.strictEqual(fill(el), "25.00%");
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "f", value: 75 }]);
});

test("a range with no width shows an empty track rather than breaking", () => {
  assert.strictEqual(fill(mount(slider, { min: 10, max: 10, value: 10 }).el), "0.00%");
});

test("editing the range repaints the fill", () => {
  const { el, ctx } = mount(slider, { min: 0, max: 100, value: 50 });
  ctx.edit("max", 200);
  assert.strictEqual(fill(el), "25.00%");
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

// --- a blank-looking value ---------------------------------------------------

test("a button whose value is only a space stays silent instead of sending 0", () => {
  // Reproduced on master before the fix: pressing sent f 0 -- a blackout.
  const { el, ctx } = mount(button, { mode: "toggle", argType: "f", valueOn: "  ", valueOff: "1" });
  el.fire("click");
  assert.deepStrictEqual(ctx.sent, [], "nothing on the wire");
});

test("the panel refuses a value that is only whitespace", () => {
  const { checkNumber } = require("../lib/widgets/fields");
  assert.ok(button.checks.valueOn("  ", { argType: "f" }), "button Value ON");
  assert.ok(slider.checks.value("  ", { min: 0, max: 100 }), "slider Value");
  assert.ok(checkNumber("Min X")("  "), "pad range");
  assert.strictEqual(checkNumber("Min X")("5"), null, "a real number is still accepted");
});
