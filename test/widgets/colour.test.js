"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { colour, parseHex, normaliseHex, fromWire } = require("../../lib/widgets/colour");
const { mount, lastArgs, withWindow } = require("../helpers/widgets");

/** Open the picker, land on `hex`, and dismiss it. */
function pick(el, hex) {
  el.value = hex;
  el.fire("input");
  el.fire("change");
}

// --- reading a colour -------------------------------------------------------

test("a hex code is read with or without its hash, short or long, in any case", () => {
  assert.deepStrictEqual(parseHex("#ff8800"), [255, 136, 0]);
  assert.deepStrictEqual(parseHex("FF8800"), [255, 136, 0]);
  assert.deepStrictEqual(parseHex("#f80"), [255, 136, 0]);
  assert.deepStrictEqual(parseHex(" f80 "), [255, 136, 0]);
  assert.strictEqual(normaliseHex("#F80"), "#ff8800", "and lands in the one form the swatch holds");
});

test("a hex code with an alpha on the end is read without it", () => {
  // Some software writes #rrggbbaa; the swatch has nowhere to show an alpha.
  assert.deepStrictEqual(parseHex("#ff880080"), [255, 136, 0]);
  assert.deepStrictEqual(parseHex("#f80c"), [255, 136, 0]);
});

test("anything that is not a hex code reads as nothing, never as black", () => {
  for (const bad of ["", " ", "#", "red", "#ff880", "#gg0000", "#ff88001", 0, null, undefined, 255, ["#ff0000"]]) {
    assert.strictEqual(parseHex(bad), null, JSON.stringify(bad));
  }
});

// --- sending ----------------------------------------------------------------

test("the picker sends red, green and blue as 0-1 floats by default", () => {
  const { el, ctx } = mount(colour);
  pick(el, "#ff8800");
  assert.strictEqual(ctx.sent[0].address, "/colour");
  assert.deepStrictEqual(ctx.sent[0].args, [
    { type: "f", value: 1 },
    { type: "f", value: 0.5333 },
    { type: "f", value: 0 },
  ]);
});

test("Range 0-255 sends the bytes, and the argument type can make them ints", () => {
  const floats = mount(colour, { scale: "byte" });
  pick(floats.el, "#ff8800");
  assert.deepStrictEqual(lastArgs(floats.ctx), [
    { type: "f", value: 255 },
    { type: "f", value: 136 },
    { type: "f", value: 0 },
  ]);

  const ints = mount(colour, { scale: "byte", argType: "i" });
  pick(ints.el, "#ff8800");
  assert.deepStrictEqual(lastArgs(ints.ctx), [
    { type: "i", value: 255 },
    { type: "i", value: 136 },
    { type: "i", value: 0 },
  ]);
});

test("Send as r, g, b, a appends the configured alpha on the same range", () => {
  const unit = mount(colour, { format: "rgba", alpha: 0.5 });
  pick(unit.el, "#000000");
  assert.deepStrictEqual(lastArgs(unit.ctx).map((a) => a.value), [0, 0, 0, 0.5]);

  const byte = mount(colour, { format: "rgba", alpha: "0.5", scale: "byte" });
  pick(byte.el, "#ffffff");
  assert.deepStrictEqual(lastArgs(byte.ctx).map((a) => a.value), [255, 255, 255, 128]);
});

test("a blank alpha silences the message rather than sending 0, which is fully transparent", () => {
  // Number("") is 0. A cleared Alpha field going out as 0 would fade the
  // layer to nothing, and look exactly like someone meaning it.
  for (const blank of ["", " ", null, undefined, "abc"]) {
    const { el, ctx } = mount(colour, { format: "rgba", alpha: blank });
    pick(el, "#ff0000");
    assert.deepStrictEqual(ctx.sent, [], JSON.stringify(blank));
  }
});

test("an alpha past either end pins there, as a level does", () => {
  const { el, ctx } = mount(colour, { format: "rgba", alpha: 1.5 });
  pick(el, "#ff0000");
  assert.strictEqual(lastArgs(ctx)[3].value, 1);
});

test("Send as hex sends the string, whatever the argument type says", () => {
  const { el, ctx } = mount(colour, { format: "hex", argType: "i" });
  pick(el, "#FF8800");
  assert.deepStrictEqual(lastArgs(ctx), [{ type: "s", value: "#ff8800" }]);
});

test("a colour is stored as it is picked, in the form the swatch holds", () => {
  const { el, ctx } = mount(colour);
  pick(el, "#ABCDEF");
  assert.strictEqual(ctx.config.value, "#abcdef");
});

test("a disabled picker changes colour but stays silent", () => {
  const { el, ctx } = mount(colour, { enabled: false });
  pick(el, "#00ff00");
  assert.deepStrictEqual(ctx.sent, []);
});

test("a swatch value that cannot be read sends nothing and is not stored", () => {
  // Never happens in a browser, where a colour input always holds #rrggbb;
  // the guard is for a host that is not one.
  const { el, ctx } = mount(colour, { value: "#123456" });
  for (const bad of ["", "red", "#12"]) {
    pick(el, bad);
  }
  assert.deepStrictEqual(ctx.sent, []);
  assert.strictEqual(ctx.config.value, "#123456");
});

test("the panel refuses a colour that is not a hex code, and an alpha outside 0-1 or blank", () => {
  assert.strictEqual(colour.checks.value("#ff8800"), null);
  assert.strictEqual(colour.checks.value("f80"), null);
  assert.ok(colour.checks.value("red"));
  assert.ok(colour.checks.value(""));
  assert.strictEqual(colour.checks.alpha("0.5"), null);
  assert.strictEqual(colour.checks.alpha(0), null);
  assert.ok(colour.checks.alpha(2));
  assert.ok(colour.checks.alpha(-0.1));
  for (const blank of ["", " ", null]) assert.ok(colour.checks.alpha(blank), JSON.stringify(blank));
});

// --- one send per frame -----------------------------------------------------

test("a drag across the picker sends once per frame, and the dismissal sends the exact colour at once", () => {
  const frames = [];
  let cancelled = 0;
  global.requestAnimationFrame = (fn) => frames.push(fn) && frames.length;
  global.cancelAnimationFrame = () => cancelled++;
  try {
    const { el, ctx } = mount(colour, { format: "hex" });
    for (const hex of ["#100000", "#200000", "#300000"]) {
      el.value = hex;
      el.fire("input");
    }
    assert.deepStrictEqual(ctx.sent, [], "nothing goes out before the frame");
    assert.strictEqual(frames.length, 1, "and one frame is asked for, not three");

    frames.shift()();
    assert.deepStrictEqual(lastArgs(ctx), [{ type: "s", value: "#300000" }], "the frame sends the latest colour only");

    el.value = "#400000";
    el.fire("input");
    el.value = "#500000";
    el.fire("change");
    assert.deepStrictEqual(lastArgs(ctx), [{ type: "s", value: "#500000" }], "the dismissal does not wait for a frame");
    assert.strictEqual(cancelled, 1, "and cancels the one that was pending");
    assert.strictEqual(ctx.sent.length, 2);

    frames.length = 0;
  } finally {
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
  }
});

test("one pick is one colour: the dismissal does not repeat what the last move sent", () => {
  // Where there are no frames every move sends at once, so the change event
  // that follows would be a second copy of the same colour.
  const { el, ctx } = mount(colour, { format: "hex" });
  pick(el, "#ff0000");
  assert.strictEqual(ctx.sent.length, 1);

  pick(el, "#ff0000");
  assert.strictEqual(ctx.sent.length, 2, "but the same colour picked again later is news");

  el.value = "#00ff00";
  el.fire("input");
  el.value = "#0000ff";
  el.fire("change");
  assert.strictEqual(ctx.sent.length, 4, "and a dismissal on a different colour sends it");
  assert.deepStrictEqual(lastArgs(ctx), [{ type: "s", value: "#0000ff" }]);
});

test("a pending frame is dropped on detach, so a torn-down widget never sends", () => {
  const frames = [];
  let cancelled = 0;
  global.requestAnimationFrame = (fn) => frames.push(fn) && frames.length;
  global.cancelAnimationFrame = () => cancelled++;
  try {
    const { el, detach } = mount(colour);
    el.value = "#123456";
    el.fire("input");
    detach();
    assert.strictEqual(cancelled, 1);
  } finally {
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
  }
});

// --- the swatch -------------------------------------------------------------

test("the saved colour fills the swatch on load; an unreadable one leaves it alone", () => {
  // The native control falls back to black when handed a value it does not
  // understand, so a project saved with a bad hex would come back black.
  assert.strictEqual(mount(colour, { value: "#00ff00" }).el.value, "#00ff00");
  assert.strictEqual(mount(colour, { value: "0f0" }).el.value, "#00ff00", "in the form the control holds");
  assert.strictEqual(mount(colour, { value: "green" }).el.value, "");
});

test("a Colour typed into the panel reaches the swatch", () => {
  const { el, ctx } = mount(colour);
  ctx.edit("value", "#0000ff");
  assert.strictEqual(el.value, "#0000ff");
});

test("the swatch keeps its colour after the host rewrites the element", () => {
  const { el, rewrite } = mount(colour, { value: "#0000ff" });
  el.value = "";
  rewrite();
  assert.strictEqual(el.value, "#0000ff");
});

// --- DMX --------------------------------------------------------------------

test("on DMX, red, green and blue land on three consecutive channels", () => {
  const { el, ctx } = mount(colour, { transport: "dmx", dmxChannel: 10 });
  pick(el, "#ff8800");
  assert.deepStrictEqual(ctx.sent, [
    { dmx: { protocol: "artnet", host: "", universe: 1, channel: 10, levels: [255, 136, 0] } },
  ]);
});

test("the DMX block is three channels wide by default, blue repeats across a wider one, and a narrower one is refused", () => {
  assert.strictEqual(colour.defaults.dmxCount, 3);
  assert.strictEqual(colour.defaults.transport, "osc", "and OSC is the output until someone says otherwise");

  const wide = mount(colour, { transport: "dmx", dmxCount: 5 });
  pick(wide.el, "#ff8800");
  assert.deepStrictEqual(lastArgs(wide.ctx), undefined, "a DMX-only message has no args");
  assert.deepStrictEqual(wide.ctx.sent[0].dmx.levels, [255, 136, 0, 0, 0]);

  const narrow = mount(colour, { transport: "dmx", dmxCount: 2 });
  pick(narrow.el, "#ff8800");
  assert.deepStrictEqual(narrow.ctx.sent, [], "two channels cannot hold a colour");
  assert.ok(colour.checks.dmxCount(2, { dmxChannel: 1 }), "and the panel says so");
});

test("the DMX levels are the colour whatever the OSC format or range says", () => {
  for (const overrides of [{ format: "hex" }, { format: "rgba", scale: "byte" }, { scale: "byte" }]) {
    const { el, ctx } = mount(colour, Object.assign({ transport: "dmx" }, overrides));
    pick(el, "#8000ff");
    assert.deepStrictEqual(ctx.sent[0].dmx.levels, [128, 0, 255], JSON.stringify(overrides));
  }
});

test("alpha never reaches the fixture, and an unreadable alpha silences OSC but not DMX", () => {
  // A fixture has no alpha; a blank Alpha is no reason to stop driving it.
  const { el, ctx } = mount(colour, { transport: "both", format: "rgba", alpha: "" });
  pick(el, "#ff0000");
  assert.deepStrictEqual(ctx.sent, [{ dmx: { protocol: "artnet", host: "", universe: 1, channel: 1, levels: [255, 0, 0] } }]);

  const both = mount(colour, { transport: "both", format: "rgba", alpha: 0.5 });
  pick(both.el, "#ff0000");
  assert.strictEqual(both.ctx.sent[0].args.length, 4, "OSC carries the alpha");
  assert.deepStrictEqual(both.ctx.sent[0].dmx.levels, [255, 0, 0], "DMX does not");
});

// --- following the rig ------------------------------------------------------

test("an incoming hex string fills the swatch and sends nothing back", () => {
  const { el, ctx } = mount(colour, { listen: true });
  ctx.receive("/colour", ["#00FF00"]);
  assert.strictEqual(el.value, "#00ff00");
  assert.strictEqual(ctx.config.value, "#00ff00");
  assert.deepStrictEqual(ctx.sent, []);
});

test("incoming channels are read on the configured range, and an alpha is ignored", () => {
  const unit = mount(colour, { listen: true });
  unit.ctx.receive("/colour", [1, 0.5, 0, 0.25]);
  assert.strictEqual(unit.el.value, "#ff8000");

  const byte = mount(colour, { listen: true, scale: "byte" });
  byte.ctx.receive("/colour", [255, 128, 0]);
  assert.strictEqual(byte.el.value, "#ff8000");
  byte.ctx.receive("/colour", ["0", "255", "0"]);
  assert.strictEqual(byte.el.value, "#00ff00", "numbers spelled as text are numbers");
  assert.deepStrictEqual(byte.ctx.sent, []);
});

test("a channel past either end of the range pins there", () => {
  const { el, ctx } = mount(colour, { listen: true });
  ctx.receive("/colour", [7, -1, 0.5]);
  assert.strictEqual(el.value, "#ff0080");
});

test("anything unreadable leaves the swatch alone: the native control would turn it black", () => {
  const { el, ctx } = mount(colour, { listen: true, value: "#123456" });
  const unreadable = [[], [null], ["xyz"], ["red"], ["#12"], [1], [1, 1], [1, null, 1], ["", 0, 0], [true, 1, 1], [0.5, "abc", 0.5], [[1, 1, 1]]];
  for (const args of unreadable) {
    ctx.receive("/colour", args);
    assert.strictEqual(el.value, "#123456", JSON.stringify(args));
    assert.strictEqual(ctx.config.value, "#123456", JSON.stringify(args));
  }
  assert.strictEqual(fromWire(null), null);
  assert.strictEqual(fromWire("#ff0000"), null, "values arrive as a list, not a string");
});

test("a hand in the picker outranks the network until the picker is dismissed", () => {
  const { el, ctx } = mount(colour, { listen: true });
  el.value = "#ff0000";
  el.fire("input");
  ctx.receive("/colour", ["#00ff00"]);
  assert.strictEqual(el.value, "#ff0000", "the swatch stayed under the hand");
  assert.strictEqual(ctx.config.value, "#ff0000");

  el.fire("change");
  ctx.receive("/colour", ["#00ff00"]);
  assert.strictEqual(el.value, "#00ff00", "and follows again once dismissed");
});

test("a pick that loses the window counts as dismissed, so the picker is not left deaf", () => {
  withWindow((win) => {
    const { el, ctx, detach } = mount(colour, { listen: true, format: "hex" });
    el.value = "#ff0000";
    el.fire("input");
    ctx.sent.length = 0;
    win.fire("blur");
    assert.deepStrictEqual(ctx.sent, [], "the colour already went out; nothing is repeated");

    ctx.receive("/colour", ["#00ff00"]);
    assert.strictEqual(el.value, "#00ff00", "the rig gets through again");

    detach();
    assert.strictEqual(win.listenerCount("blur"), 0, "and detach lets go of the window");
  });
});

test("a blur with a colour still waiting on a frame sends it", () => {
  const frames = [];
  global.requestAnimationFrame = (fn) => frames.push(fn) && frames.length;
  global.cancelAnimationFrame = () => {};
  try {
    withWindow((win) => {
      const { el, ctx } = mount(colour, { format: "hex" });
      el.value = "#ff0000";
      el.fire("input");
      assert.deepStrictEqual(ctx.sent, []);
      win.fire("blur");
      assert.deepStrictEqual(lastArgs(ctx), [{ type: "s", value: "#ff0000" }]);
      frames.length = 0;
    });
  } finally {
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
  }
});

test("a blur with nothing picked sends nothing", () => {
  withWindow((win) => {
    const { el, ctx } = mount(colour);
    win.fire("blur");
    el.fire("blur");
    assert.deepStrictEqual(ctx.sent, []);
  });
});

test("a picker with Listen off ignores the network", () => {
  const { el, ctx } = mount(colour, { value: "#123456" });
  ctx.receive("/colour", ["#00ff00"]);
  assert.strictEqual(el.value, "#123456");
});

test("Listen sits right after Message and is off by default; Alpha shows only for r, g, b, a", () => {
  const keys = colour.fields.map((f) => f.key);
  assert.strictEqual(keys[keys.indexOf("message") + 1], "listen");
  assert.strictEqual(colour.defaults.listen, false);
  const alpha = colour.fields.find((f) => f.key === "alpha");
  assert.deepStrictEqual(alpha.showIf, { key: "format", in: ["rgba"] });
  const argType = colour.fields.find((f) => f.key === "argType");
  assert.deepStrictEqual(argType.showIf, { key: "format", in: ["rgb", "rgba"] }, "and a hex string has no argument type to choose");
});

test("detaching stops the picker following the rig", () => {
  const { el, ctx, detach } = mount(colour, { listen: true, value: "#123456" });
  detach();
  ctx.receive("/colour", ["#00ff00"]);
  assert.strictEqual(el.value, "#123456");
  assert.strictEqual(ctx.listening(), 0);
  assert.strictEqual(el.listenerCount("input") + el.listenerCount("change") + el.listenerCount("blur"), 0);
});
