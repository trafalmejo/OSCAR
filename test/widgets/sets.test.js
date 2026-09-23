"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { parseSets, checkSets, driveSets } = require("../../lib/widgets/sets");
const { button } = require("../../lib/widgets/button");
const { slider } = require("../../lib/widgets/slider");
const { registerDrivable, driveOne } = require("../../public/src/adapters/drive");
const { fakeElement, fakeContext } = require("../helpers/fake-dom");

test("a list of controls and states: numbers, on and off, a pad's pair; and what cannot be read is named", () => {
  assert.deepStrictEqual(parseSets("fader-4=255, fader-5 = 0,go=on, pad=128;64 ,stop=OFF"), {
    entries: [
      { id: "fader-4", state: { value: 255 } },
      { id: "fader-5", state: { value: 0 } },
      { id: "go", state: { on: true } },
      { id: "pad", state: { x: 128, y: 64 } },
      { id: "stop", state: { on: false } },
    ],
    problem: null,
  });
  assert.deepStrictEqual(parseSets(""), { entries: [], problem: null });
  assert.deepStrictEqual(parseSets(null).entries, []);
  assert.match(parseSets("fader-4").problem, /id, =, and a value/);
  assert.match(parseSets("bad id=1").problem, /not a control's id/);
  assert.match(parseSets("fader-4=loud").problem, /number, on, off/);
  assert.strictEqual(checkSets("a=1, b=on"), null);
  assert.strictEqual(checkSets("  "), null);
  assert.notStrictEqual(checkSets("a=1, b"), null);
  assert.strictEqual(button.checks.setsOn, checkSets);
  assert.strictEqual(button.defaults.setsOn, "");
});

test("driving goes through the host, which may not offer it", () => {
  const driven = [];
  assert.strictEqual(driveSets({ drive: (id, state) => (driven.push([id, state]), id !== "nowhere") }, "a=1, nowhere=2, b=on"), 2);
  assert.deepStrictEqual(driven, [["a", { value: 1 }], ["nowhere", { value: 2 }], ["b", { on: true }]]);
  assert.strictEqual(driveSets({}, "a=1"), 0, "a host with no other controls to speak of");
});

/** A control attached the way a page attaches it: registered before attach, so its onShared is kept. */
function mountRegistered(register, id, widget, overrides) {
  const config = Object.assign({}, widget.defaults, overrides);
  const el = fakeElement();
  const ctx = fakeContext(config);
  registerDrivable(register, id, ctx, widget, () => config);
  widget.attach(el, ctx);
  return { el, ctx, config };
}

test("a button works the faders it names, as a hand would: they move, send and share; nothing happens on a state it merely adopts", () => {
  const register = {};
  const fader = mountRegistered(register, "fader-4", slider, { min: 0, max: 255, value: 10, oscEnabled: false, dmxEnabled: true, dmxChannel: 4 });
  const other = mountRegistered(register, "other", slider, { message: "/other" });
  const key = mountRegistered(register, "key", button, { mode: "toggle", oscEnabled: false, setsOn: "fader-4=255, ghost=1", setsOff: "fader-4=0" });

  key.el.fire("click");
  assert.strictEqual(fader.config.value, 255, "the fader moved");
  assert.deepStrictEqual(fader.ctx.sent.map((m) => m.dmx && m.dmx.levels), [[255]], "and sent its own DMX");
  assert.deepStrictEqual(fader.ctx.shared, [{ value: 255 }], "and the other devices see it move");
  assert.deepStrictEqual(other.ctx.sent, [], "a fader not named is left alone");

  key.el.fire("click");
  assert.strictEqual(fader.config.value, 0);
  assert.deepStrictEqual(fader.ctx.sent.map((m) => m.dmx.levels), [[255], [0]]);

  // The button adopting another device's state passes nothing on: that device's button did.
  fader.ctx.sent.length = 0;
  key.ctx.receiveShared({ on: true });
  assert.deepStrictEqual(fader.ctx.sent, []);

  assert.strictEqual(driveOne(register, "ghost", { value: 1 }), false, "a control that is not there");
  assert.strictEqual(driveOne(register, "fader-4", { value: "loud" }), false, "a state it cannot take");
});
