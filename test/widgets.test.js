"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { button } = require("../lib/widgets/button");
const { slider } = require("../lib/widgets/slider");
const { xypad } = require("../lib/widgets/xypad");
const { meter } = require("../lib/widgets/meter");
const { media, parseItems } = require("../lib/widgets/media");
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

// --- meter ------------------------------------------------------------------

/** The bar's length, as the CSS sees it. */
function level(el) {
  return el.style.properties["--oscar-level"];
}

function peak(el) {
  return el.style.properties["--oscar-peak"];
}

test("a level pushed in through the element hook shows on the bar", () => {
  // This is the hook whatever receives OSC is expected to call; if it moves,
  // the meter goes deaf without anything failing to compile.
  const { el } = mount(meter, { min: 0, max: 100, value: 0 });
  assert.strictEqual(typeof el.oscarSetLevel, "function");

  el.oscarSetLevel(75);
  assert.strictEqual(level(el), "75.00%");
});

test("the meter maps an arbitrary range onto the bar", () => {
  const { el } = mount(meter, { min: -60, max: 0, value: -60 });
  el.oscarSetLevel(-30);
  assert.strictEqual(level(el), "50.00%");
});

test("the meter clamps rather than running off the end of itself", () => {
  const { el } = mount(meter, { min: 0, max: 100 });
  el.oscarSetLevel(400);
  assert.strictEqual(level(el), "100.00%");
  el.oscarSetLevel(-400);
  assert.strictEqual(level(el), "0.00%");
});

test("an unreadable level leaves the bar where it was, never at zero", () => {
  // The display side of the rule the send path follows: an empty bar reports
  // silence, and reporting silence on a channel that may be at full is worse
  // than showing a stale reading.
  const { el } = mount(meter, { min: 0, max: 100 });
  el.oscarSetLevel(80);
  el.oscarSetLevel("not a number");
  assert.strictEqual(level(el), "80.00%");
  el.oscarSetLevel(null);
  assert.strictEqual(level(el), "80.00%");
});

test("the meter remembers its level, so a re-render does not reset it", () => {
  const { el, ctx } = mount(meter, { min: 0, max: 100 });
  el.oscarSetLevel(42);
  assert.strictEqual(ctx.config.value, 42);
});

test("a disabled meter freezes instead of dropping to the floor", () => {
  const { el } = mount(meter, { min: 0, max: 100, value: 30, enabled: false });
  assert.strictEqual(level(el), "30.00%");
  el.oscarSetLevel(90);
  assert.strictEqual(level(el), "30.00%");
});

test("the meter never puts anything on the wire -- it is a display", () => {
  const { el, ctx } = mount(meter, { min: 0, max: 100 });
  el.oscarSetLevel(10);
  el.oscarSetLevel(90);
  assert.deepStrictEqual(ctx.sent, []);
});

test("editing Value in the panel moves the bar, so a meter works standalone", () => {
  const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0 });
  ctx.edit("value", 25);
  assert.strictEqual(level(el), "25.00%");
});

test("the meter applies its saved level and orientation on attach", () => {
  const { el } = mount(meter, { min: 0, max: 100, value: 60, orientation: "vertical" });
  assert.strictEqual(level(el), "60.00%");
  assert.strictEqual(el.getAttribute("orient"), "vertical");
});

test("peak hold keeps the marker up while the level falls away under it", () => {
  const { el } = mount(meter, { min: 0, max: 100, peakHold: 5 });
  el.oscarSetLevel(90);
  el.oscarSetLevel(10);
  assert.strictEqual(level(el), "10.00%", "the bar follows the level");
  assert.strictEqual(peak(el), "90.00%", "the marker stays on the overshoot");
});

test("peak hold of zero turns the marker off entirely", () => {
  const { el, ctx } = mount(meter, { min: 0, max: 100, peakHold: 0 });
  el.oscarSetLevel(90);
  el.oscarSetLevel(10);
  assert.strictEqual(peak(el), "10.00%");
  assert.strictEqual(ctx.classes["oscar-peak"], false, "nothing is drawn");
});

test("detaching a meter takes its hook away rather than leaving a dead one", () => {
  const { el, detach } = mount(meter, {});
  detach();
  assert.strictEqual(el.oscarSetLevel, undefined);
});

test("the panel refuses a peak hold that is not a number of seconds", () => {
  assert.strictEqual(meter.checks.peakHold(0), null);
  assert.strictEqual(meter.checks.peakHold(1.5), null);
  assert.ok(meter.checks.peakHold(-1));
  assert.ok(meter.checks.peakHold("soon"));
});

// --- media browser ----------------------------------------------------------

test("items parse as label, label|value and label|value|image", () => {
  const items = parseItems("Intro; Waves|7; Forest|forest|images/forest.png");
  assert.deepStrictEqual(items, [
    // No value given means the tile sends its own position, which is how a
    // clip grid is addressed nearly everywhere.
    { label: "Intro", value: "1", image: "" },
    { label: "Waves", value: "7", image: "" },
    { label: "Forest", value: "forest", image: "images/forest.png" },
  ]);
});

test("items may be separated by newlines too, for a hand-edited project", () => {
  // A trait is a single-line input, so semicolons are what can be typed; a
  // file written by hand or by a script should still read as a list.
  const items = parseItems("Intro|1\nWaves|2\n\n");
  assert.deepStrictEqual(
    items.map((i) => i.label),
    ["Intro", "Waves"]
  );
});

test("a tile can be a picture with no label, but never an empty square", () => {
  // An unlabelled tile is a gallery of stills. A tile with neither a label nor
  // a picture is an invisible thing that fires a cue when brushed.
  assert.deepStrictEqual(parseItems("|4|images/still.png"), [
    { label: "", value: "4", image: "images/still.png" },
  ]);
  assert.deepStrictEqual(parseItems("; |; ||"), []);
});

test("the grid draws one tile per item, with a thumbnail and a label", () => {
  const { el } = mount(media, { items: "Intro|1|images/intro.png; Waves|2", showLabels: true });

  assert.strictEqual(el.children.length, 2);
  assert.strictEqual(el.children[0].children[0].getAttribute("src"), "images/intro.png");
  assert.strictEqual(el.children[0].children[1].textContent, "Intro");
  // No image configured means no <img> at all, rather than a broken one.
  assert.strictEqual(el.children[1].children.length, 1);
  assert.strictEqual(el.children[1].children[0].textContent, "Waves");
});

test("Show labels off leaves the pictures to speak for themselves", () => {
  const { el } = mount(media, { items: "Intro|1|a.png", showLabels: false });
  assert.strictEqual(el.children[0].children.length, 1, "the image only");
});

test("picking a tile sends its value and marks it as the choice", () => {
  const { el, ctx } = mount(media, { items: "Intro|1; Waves|7", argType: "i", message: "/clip" });

  el.children[1].fire("click");

  assert.deepStrictEqual(ctx.sent, [
    { ip: "localhost", port: 7000, address: "/clip", args: [{ type: "i", value: 7 }] },
  ]);
  assert.strictEqual(ctx.config.selected, 2, "stored 1-based, like the values");
  assert.strictEqual(el.children[1].classList.contains("oscar-selected"), true);
  assert.strictEqual(el.children[0].classList.contains("oscar-selected"), false);
});

test("a second pick moves the highlight rather than adding another", () => {
  const { el } = mount(media, { items: "A|1; B|2; C|3" });
  el.children[2].fire("click");
  el.children[0].fire("click");

  assert.deepStrictEqual(
    el.children.map((tile) => tile.classList.contains("oscar-selected")),
    [true, false, false]
  );
});

test("picking the same tile again still sends -- relaunching a clip is real", () => {
  const { el, ctx } = mount(media, { items: "Intro|1" });
  el.children[0].fire("click");
  el.children[0].fire("click");
  assert.strictEqual(ctx.sent.length, 2);
});

test("a tile with no value of its own sends its position", () => {
  const { el, ctx } = mount(media, { items: "Intro; Waves; Forest", argType: "i" });
  el.children[2].fire("click");
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "i", value: 3 }]);
});

test("the gallery can send names instead of indices", () => {
  const { el, ctx } = mount(media, { items: "Intro|intro; Waves|waves", argType: "s" });
  el.children[0].fire("click");
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "s", value: "intro" }]);
});

test("a name that cannot be sent as an int drops the message, it does not send zero", () => {
  const { el, ctx } = mount(media, { items: "Intro|intro", argType: "i" });
  el.children[0].fire("click");
  assert.deepStrictEqual(ctx.sent, [], "nothing on the wire");
});

test("a disabled gallery still shows a choice but stays silent", () => {
  const { el, ctx } = mount(media, { items: "A|1; B|2", enabled: false });
  el.children[1].fire("click");
  assert.deepStrictEqual(ctx.sent, []);
  assert.strictEqual(el.children[1].classList.contains("oscar-selected"), true);
});

test("the saved selection is showing before anyone touches the grid", () => {
  const { el } = mount(media, { items: "A|1; B|2; C|3", selected: 2 });
  assert.strictEqual(el.children[1].classList.contains("oscar-selected"), true);
});

test("Columns lands on the element, so the grid is the shape it was set to", () => {
  const { el, ctx } = mount(media, { items: "A; B; C; D", columns: 4 });
  assert.strictEqual(el.style.properties["grid-template-columns"], "repeat(4, 1fr)");

  ctx.edit("columns", 2);
  assert.strictEqual(el.style.properties["grid-template-columns"], "repeat(2, 1fr)");
});

test("editing Items rebuilds the grid instead of stacking a second one on top", () => {
  const { el, ctx } = mount(media, { items: "A|1; B|2" });
  assert.strictEqual(el.children.length, 2);

  ctx.edit("items", "A|1; B|2; C|3");
  assert.strictEqual(el.children.length, 3);
  assert.strictEqual(el.children[2].children[0].textContent, "C");
});

test("a rebuilt grid does not leave the old tiles still sending", () => {
  const { el, ctx } = mount(media, { items: "A|1; B|2" });
  const orphan = el.children[0];

  ctx.edit("items", "C|3");
  orphan.fire("click");
  assert.deepStrictEqual(ctx.sent, [], "a tile that is gone cannot be tapped");
});

test("detaching takes every tile back out of the element", () => {
  const { el, detach } = mount(media, { items: "A|1; B|2" });
  detach();
  assert.strictEqual(el.children.length, 0);
});

test("an empty gallery is a work in progress, not an error", () => {
  const { el } = mount(media, { items: "" });
  assert.strictEqual(el.children.length, 0);
  assert.strictEqual(media.checks.items("", { argType: "i" }), null);
});

test("the panel warns about an item the chosen type cannot carry", () => {
  assert.ok(media.checks.items("Intro|intro", { argType: "i" }), "int rejects a name");
  assert.strictEqual(media.checks.items("Intro|intro", { argType: "s" }), null);
  assert.strictEqual(media.checks.items("Intro|1; Waves|2", { argType: "i" }), null);
  assert.ok(media.checks.items("|||", { argType: "i" }), "nothing usable in there");
});

test("the panel refuses a column count no grid could have", () => {
  assert.strictEqual(media.checks.columns(3), null);
  assert.ok(media.checks.columns(0));
  assert.ok(media.checks.columns(2.5));
  assert.ok(media.checks.columns(99));
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
