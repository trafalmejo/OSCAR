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

// --- listening to OSC coming back -------------------------------------------
//
// The rule these all circle: a value that arrived from outside may move a
// widget, and may never leave it again as an outgoing message. OSCAR sending
// back what the target software just told it, to software that echoes its own
// state, is a loop that only ends when someone pulls a cable.

test("no widget ever answers an incoming message with an outgoing one", () => {
  for (const widget of WIDGETS) {
    const { ctx } = mount(widget, { listen: true });
    ctx.receive(widget.defaults.message, [1, 1]);
    assert.deepStrictEqual(ctx.sent, [], widget.name + " sent something back");
  }
});

test("Listen is off by default everywhere, so nothing starts moving on its own", () => {
  for (const widget of WIDGETS) {
    assert.strictEqual(widget.defaults.listen, false, widget.name);
  }
});

test("an incoming value moves the slider without sending anything", () => {
  const { el, ctx } = mount(slider, { listen: true, min: 0, max: 100, value: 0 });
  ctx.receive("/slider1", [50]);

  assert.strictEqual(el.value, "50", "the thumb followed");
  assert.strictEqual(ctx.config.value, 50, "and so did the stored value");
  assert.deepStrictEqual(ctx.sent, [], "nothing went back out");
});

test("a slider with Listen off ignores the network entirely", () => {
  const { el, ctx } = mount(slider, { min: 0, max: 100, value: 0 });
  ctx.receive("/slider1", [50]);
  assert.strictEqual(el.value, "0");
  assert.deepStrictEqual(ctx.sent, []);
});

test("a listening slider only answers to its own address", () => {
  const { el, ctx } = mount(slider, { listen: true, message: "/slider1", value: 0 });
  ctx.receive("/slider2", [50]);
  assert.strictEqual(el.value, "0");
});

test("an unreadable incoming value never becomes zero", () => {
  // The same rule as the send path: on a lighting rig, 0 is "off", and a
  // guessed 0 is a blackout nobody asked for.
  const { el, ctx } = mount(slider, { listen: true, min: 0, max: 100, value: 40 });

  for (const junk of ["", null, "abc", true, undefined]) {
    ctx.receive("/slider1", [junk]);
    assert.strictEqual(ctx.config.value, 40, String(junk) + " moved the slider");
  }
  assert.strictEqual(el.value, "40");
});

test("an incoming value is held inside the slider's range", () => {
  const { ctx } = mount(slider, { listen: true, min: 0, max: 100, value: 0 });
  ctx.receive("/slider1", [500]);
  assert.strictEqual(ctx.config.value, 100);
});

test("an inverted slider puts an incoming value where the send path would read it", () => {
  const { el, ctx } = mount(slider, { listen: true, min: 0, max: 100, invert: true, value: 0 });
  ctx.receive("/slider1", [75]);
  assert.strictEqual(ctx.config.value, 75, "the value is the one on the wire");
  assert.strictEqual(el.value, "25", "the thumb mirrors it");
});

test("an incoming message moves the pad's handle, and sends nothing", () => {
  const { ctx } = mount(xypad, { listen: true, minX: 0, maxX: 100, minY: 0, maxY: 100 });
  ctx.receive("/pad", [30, 70]);

  assert.strictEqual(ctx.config.x, 30);
  assert.strictEqual(ctx.config.y, 70);
  assert.deepStrictEqual(ctx.sent, []);
});

test("in two-message mode the pad listens on /x and /y separately", () => {
  const { ctx } = mount(xypad, { listen: true, sendMode: "two" });

  ctx.receive("/pad/x", [30]);
  assert.strictEqual(ctx.config.x, 30);
  assert.strictEqual(ctx.config.y, 0, "the other axis was left alone");

  ctx.receive("/pad/y", [70]);
  assert.strictEqual(ctx.config.y, 70);
  assert.deepStrictEqual(ctx.sent, []);

  // The one-message address means nothing in this mode.
  ctx.receive("/pad", [1, 2]);
  assert.strictEqual(ctx.config.x, 30);
});

test("a hand on the pad outranks the network", () => {
  const { el, ctx } = mount(xypad, {
    listen: true,
    rect: { left: 0, top: 0, width: 100, height: 100 },
  });

  el.fire("pointerdown", { clientX: 30, clientY: 80 });
  ctx.receive("/pad", [90, 90]);
  assert.strictEqual(ctx.config.x, 30, "the handle did not jump out from under the finger");
});

test("a listening button lights up from the network without sending", () => {
  const { ctx } = mount(button, { listen: true, mode: "toggle", valueOn: "1", valueOff: "0" });

  ctx.receive("/push1", [1]);
  assert.strictEqual(ctx.classes.toggle, true);
  assert.deepStrictEqual(ctx.sent, []);

  ctx.receive("/push1", [0]);
  assert.strictEqual(ctx.classes.toggle, false);
  assert.deepStrictEqual(ctx.sent, []);
});

test("a button recognises its own vocabulary coming back", () => {
  const { ctx } = mount(button, {
    listen: true,
    mode: "toggle",
    argType: "s",
    valueOn: "go",
    valueOff: "stop",
  });

  ctx.receive("/push1", ["go"]);
  assert.strictEqual(ctx.classes.toggle, true);

  // "stop" is not falsy by any general rule -- it is a non-empty string. It is
  // off because this button says it is off.
  ctx.receive("/push1", ["stop"]);
  assert.strictEqual(ctx.classes.toggle, false);
  assert.deepStrictEqual(ctx.sent, []);
});

test("a bare incoming address tells a button nothing, so it does nothing", () => {
  const { ctx } = mount(button, { listen: true, mode: "toggle" });
  ctx.receive("/push1", []);
  assert.strictEqual(ctx.classes, undefined, "not even a repaint");
});

test("what the rig says settles the next press, rather than fighting it", () => {
  const { el, ctx } = mount(button, {
    listen: true,
    mode: "toggle",
    valueOn: "1",
    valueOff: "0",
    argType: "i",
  });

  ctx.receive("/push1", [1]);
  el.fire("click");
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "i", value: 0 }], "the next press turns it off");
});

// --- several devices, one surface -------------------------------------------

test("a state from another device is adopted, sent nowhere, and not repeated back", () => {
  const { el, ctx } = mount(slider, { min: 0, max: 100, value: 0 });
  ctx.remote({ value: 70 });

  assert.strictEqual(el.value, "70");
  assert.deepStrictEqual(ctx.sent, [], "the other device already sent it");
  assert.deepStrictEqual(ctx.shared, [], "repeating it back is how a ping-pong starts");
});

test("state is shared whether or not the widget was asked to listen", () => {
  // Listen is about OSC coming back from the rig. Two tablets agreeing with
  // each other is not something anyone should have to switch on.
  const { el, ctx } = mount(slider, { min: 0, max: 100 });
  el.value = "60";
  el.fire("input");
  assert.deepStrictEqual(ctx.shared, [{ value: 60 }]);
});

test("the other tablet's toggle state is what the next press works from", () => {
  // The bug this exists for: one operator toggles a button on, the other
  // tablet still draws it off, and its next press sends ON a second time --
  // which downstream is a retrigger, not a no-op.
  const { el, ctx } = mount(button, {
    mode: "toggle",
    valueOn: "1",
    valueOff: "0",
    argType: "i",
  });

  ctx.remote({ on: true });
  assert.strictEqual(ctx.classes.toggle, true);
  assert.deepStrictEqual(ctx.sent, []);

  el.fire("click");
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "i", value: 0 }]);
});

test("a device told a state it already holds does nothing at all", () => {
  const { ctx } = mount(button, { mode: "toggle" });
  ctx.remote({ on: false });
  assert.deepStrictEqual(ctx.sent, []);
  assert.deepStrictEqual(ctx.shared, []);
});

test("the pad takes a position from another device without sending it on", () => {
  const { ctx } = mount(xypad, { minX: 0, maxX: 100, minY: 0, maxY: 100 });
  ctx.remote({ x: 25, y: 75 });

  assert.strictEqual(ctx.config.x, 25);
  assert.strictEqual(ctx.config.y, 75);
  assert.deepStrictEqual(ctx.sent, []);
  assert.deepStrictEqual(ctx.shared, []);
});

test("what the rig says is passed on, so a tablet joining later is not left behind", () => {
  const { ctx } = mount(slider, { listen: true, min: 0, max: 100, value: 0 });
  ctx.receive("/slider1", [50]);
  assert.deepStrictEqual(ctx.shared, [{ value: 50 }]);

  // Every listening tablet reports the same value, so the second report is
  // not a change and the server drops it. Saying it twice from here would be.
  ctx.receive("/slider1", [50]);
  assert.strictEqual(ctx.shared.length, 1);
});

test("detaching stops a widget hearing the network", () => {
  for (const widget of WIDGETS) {
    const { ctx, detach } = mount(widget, { listen: true });
    detach();
    ctx.receive(widget.defaults.message, [1, 1]);
    ctx.remote({ value: 9, on: true, x: 9, y: 9 });
    assert.deepStrictEqual(ctx.sent, [], widget.name);
    assert.deepStrictEqual(ctx.shared, [], widget.name + " still answering after detach");
  }
});

// --- shared shape -----------------------------------------------------------

test("Enabled leads on every widget, above even the label", () => {
  // Whether a control is live matters more than what it is called, and a
  // master switch buried mid-panel is one you do not find mid-show.
  for (const widget of WIDGETS) {
    assert.strictEqual(widget.fields[0].key, "enabled", widget.name);
  }
});

test("every widget offers the same settings, so they feel like one instrument", () => {
  for (const widget of WIDGETS) {
    const keys = widget.fields.map((f) => f.key);
    for (const required of ["enabled", "ip", "port", "message", "listen", "argType"]) {
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
