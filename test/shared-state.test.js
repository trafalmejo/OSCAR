"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { SharedState, isSharable, MAX_WIDGETS, MAX_KEYS, MAX_STRING_LENGTH } = require("../lib/shared-state");

test("a change is news: apply returns the widget's whole state", () => {
  const state = new SharedState();
  assert.deepStrictEqual(state.apply("w1", { value: 50 }), { value: 50 });
  assert.deepStrictEqual(state.get("w1"), { value: 50 });
});

test("repeating a value is no news, so nothing is broadcast", () => {
  // The guard that stops two tablets trading the same value between them
  // for the rest of the evening: B is told 50, B says 50 back, and the
  // second 50 goes no further than here.
  const state = new SharedState();
  state.apply("w1", { value: 50 });
  assert.strictEqual(state.apply("w1", { value: 50 }), null);
  assert.deepStrictEqual(state.apply("w1", { value: 51 }), { value: 51 }, "a real change still passes");
});

test("an echo dies even when it arrives as a whole record", () => {
  const state = new SharedState();
  state.apply("pad", { x: 1, y: 2 });
  assert.strictEqual(state.apply("pad", { x: 1, y: 2 }), null);
  // One axis moving is news, and carries the axis that did not with it.
  assert.deepStrictEqual(state.apply("pad", { x: 1, y: 3 }), { x: 1, y: 3 });
});

test("a patch adds to what a widget already holds rather than replacing it", () => {
  const state = new SharedState();
  state.apply("w1", { value: 10 });
  assert.deepStrictEqual(state.apply("w1", { on: true }), { value: 10, on: true });
});

test("false is a state and not nothing, and repeating it is still no news", () => {
  const state = new SharedState();
  assert.deepStrictEqual(state.apply("w1", { on: false }), { on: false });
  assert.strictEqual(state.apply("w1", { on: false }), null);
  assert.deepStrictEqual(state.apply("w1", { on: true }), { on: true });
});

test("a device joining late is handed everything at once", () => {
  const state = new SharedState();
  state.apply("a", { on: true });
  state.apply("b", { value: 3 });
  assert.deepStrictEqual(state.snapshot(), { a: { on: true }, b: { value: 3 } });
  assert.deepStrictEqual(new SharedState().snapshot(), {}, "or nothing, when nothing has happened");
});

test("what apply, get and snapshot hand out are copies: the record cannot be edited through them", () => {
  const state = new SharedState();
  const applied = state.apply("a", { on: true });
  applied.on = false;
  state.snapshot().a.on = false;
  state.get("a").on = false;
  assert.strictEqual(state.get("a").on, true);
});

test("a new layout wipes every record, because the old widget ids may not exist in it", () => {
  const state = new SharedState();
  state.apply("a", { on: true });
  state.clear();
  assert.deepStrictEqual(state.snapshot(), {});
  assert.strictEqual(state.get("a"), null);
  assert.strictEqual(state.size, 0);
});

test("only what a widget shows is kept: a number, a switch, a short word", () => {
  assert.strictEqual(isSharable(1.5), true);
  assert.strictEqual(isSharable(false), true);
  assert.strictEqual(isSharable("go"), true);
  assert.strictEqual(isSharable("x".repeat(MAX_STRING_LENGTH)), true);
  assert.strictEqual(isSharable("x".repeat(MAX_STRING_LENGTH + 1)), false);
  assert.strictEqual(isSharable(NaN), false, "not a number is not a level");
  assert.strictEqual(isSharable(Infinity), false);
  assert.strictEqual(isSharable(null), false);
  assert.strictEqual(isSharable(undefined), false);
  assert.strictEqual(isSharable({ nested: 1 }), false);
  assert.strictEqual(isSharable([1, 2]), false);
  assert.strictEqual(isSharable(() => 1), false);
});

test("a value nothing can show never reaches the record, and is never news", () => {
  const state = new SharedState();
  assert.strictEqual(state.apply("w1", { value: { nested: 1 } }), null);
  assert.strictEqual(state.apply("w1", { value: [1, 2] }), null);
  assert.strictEqual(state.apply("w1", { value: NaN }), null);
  assert.strictEqual(state.apply("w1", { value: null }), null);
  assert.strictEqual(state.apply("w1", "not a patch"), null);
  assert.strictEqual(state.apply("w1", [1]), null);
  assert.strictEqual(state.apply("w1", null), null);
  assert.strictEqual(state.apply("", { value: 1 }), null);
  assert.strictEqual(state.apply(null, { value: 1 }), null);
  assert.strictEqual(state.apply(7, { value: 1 }), null);
  assert.strictEqual(state.apply("x".repeat(200), { value: 1 }), null);
  assert.strictEqual(state.size, 0, "none of that reached the record");

  // The good part of a mixed patch is kept; the bad part is dropped.
  assert.deepStrictEqual(state.apply("w1", { value: 1, junk: {} }), { value: 1 });
});

test("a key is a plain name, so a patch cannot reach past its own record", () => {
  const state = new SharedState();
  assert.strictEqual(state.apply("w1", JSON.parse('{"__proto__": {"polluted": true}}')), null);
  assert.strictEqual(state.apply("w1", { "": 1 }), null);
  assert.strictEqual(state.apply("w1", { "a b": 1 }), null);
  assert.strictEqual(state.apply("w1", { ["x".repeat(65)]: 1 }), null);
  assert.strictEqual(({}).polluted, undefined);
  assert.deepStrictEqual(state.apply("w1", { valueOn_2: 1 }), { valueOn_2: 1 });
});

test("a page cannot fill memory by inventing widgets", () => {
  const state = new SharedState();
  for (let i = 0; i < MAX_WIDGETS + 50; i++) state.apply("w" + i, { value: i });
  assert.strictEqual(state.size, MAX_WIDGETS);
  state.apply("one-more", { value: 1 });
  assert.strictEqual(state.size, MAX_WIDGETS, "and it stays full, not fuller");
});

test("a full store makes room for a real widget rather than refusing it", () => {
  // The flood used to win for good: every id not yet recorded was refused
  // until the next layout push, so a real widget touched for the first time
  // after it was neither broadcast nor in a late joiner's snapshot.
  const state = new SharedState();
  for (let i = 0; i < MAX_WIDGETS; i++) state.apply("junk" + i, { value: i });
  assert.deepStrictEqual(state.apply("fader", { value: 64 }), { value: 64 }, "news, so it is broadcast");
  assert.deepStrictEqual(state.snapshot().fader, { value: 64 }, "and a late joiner is handed it");
  assert.strictEqual(state.get("junk0"), null, "the record written longest ago made the room");
  assert.deepStrictEqual(state.get("junk1"), { value: 1 });
});

test("the record that makes room is the one written longest ago, not the one created first", () => {
  const state = new SharedState();
  state.apply("fader", { value: 1 });
  for (let i = 0; i < MAX_WIDGETS - 1; i++) state.apply("junk" + i, { value: i });
  // The fader is in use; the flood goes on.
  state.apply("fader", { value: 2 });
  for (let i = 0; i < 10; i++) state.apply("more" + i, { value: i });
  assert.deepStrictEqual(state.get("fader"), { value: 2 }, "a widget somebody is moving outlives the junk");
  assert.strictEqual(state.size, MAX_WIDGETS);
});

test("an id that is a plain object's prototype is refused, so live and late views cannot disagree", () => {
  const state = new SharedState();
  assert.strictEqual(state.apply("__proto__", { value: 1 }), null, "never broadcast");
  assert.strictEqual(state.size, 0, "and takes no room");
  // Ids that merely look alarming are own keys of the snapshot, and survive
  // the trip through JSON that socket.io gives them.
  state.apply("constructor", { value: 2 });
  const wire = JSON.parse(JSON.stringify(state.snapshot()));
  assert.deepStrictEqual(Object.keys(wire), ["constructor"]);
  assert.deepStrictEqual(wire.constructor, { value: 2 });
});

test("nor by inventing keys on one widget", () => {
  const state = new SharedState();
  for (let i = 0; i < MAX_KEYS + 10; i++) state.apply("w1", { ["k" + i]: i });
  assert.strictEqual(Object.keys(state.get("w1")).length, MAX_KEYS);
  assert.strictEqual(state.apply("w1", { another: 1 }), null);
  assert.deepStrictEqual(state.apply("w1", { k0: 100 }).k0, 100, "a known key still changes");
});
