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
  assert.strictEqual(state.apply("one-more", { value: 1 }), null, "refused, and no news");
  // A widget already in the record still works.
  assert.deepStrictEqual(state.apply("w0", { value: 999 }), { value: 999 });
});

test("nor by inventing keys on one widget", () => {
  const state = new SharedState();
  for (let i = 0; i < MAX_KEYS + 10; i++) state.apply("w1", { ["k" + i]: i });
  assert.strictEqual(Object.keys(state.get("w1")).length, MAX_KEYS);
  assert.strictEqual(state.apply("w1", { another: 1 }), null);
  assert.deepStrictEqual(state.apply("w1", { k0: 100 }).k0, 100, "a known key still changes");
});
