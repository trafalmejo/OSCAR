"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { SharedState, MAX_WIDGETS, MAX_KEYS } = require("../lib/shared-state");

test("a device that changes something gets a state worth telling the others about", () => {
  const state = new SharedState();
  assert.deepStrictEqual(state.apply("w1", { value: 50 }), { value: 50 });
  assert.deepStrictEqual(state.get("w1"), { value: 50 });
});

test("repeating a value changes nothing, so nothing is broadcast", () => {
  // This is the guard that stops two tablets trading the same value between
  // them for the rest of the evening: B is told 50, B says 50 back, and the
  // second 50 goes no further than here.
  const state = new SharedState();
  state.apply("w1", { value: 50 });
  assert.strictEqual(state.apply("w1", { value: 50 }), null, "no news");
  assert.strictEqual(state.apply("w1", { value: 51 }).value, 51, "a real change still passes");
});

test("an echo dies on the first hop even when it arrives as part of a patch", () => {
  const state = new SharedState();
  state.apply("pad", { x: 1, y: 2 });
  assert.strictEqual(state.apply("pad", { x: 1, y: 2 }), null);
  // One axis moving is still news, and carries the axis that did not with it.
  assert.deepStrictEqual(state.apply("pad", { x: 1, y: 3 }), { x: 1, y: 3 });
});

test("a patch adds to what a widget already holds rather than replacing it", () => {
  const state = new SharedState();
  state.apply("w1", { value: 10 });
  assert.deepStrictEqual(state.apply("w1", { on: true }), { value: 10, on: true });
});

test("a device joining late is handed everything at once", () => {
  const state = new SharedState();
  state.apply("a", { on: true });
  state.apply("b", { value: 3 });

  assert.deepStrictEqual(state.snapshot(), { a: { on: true }, b: { value: 3 } });
});

test("the snapshot is a copy, so a caller cannot edit the registry through it", () => {
  const state = new SharedState();
  state.apply("a", { on: true });

  const snapshot = state.snapshot();
  snapshot.a.on = false;
  assert.strictEqual(state.get("a").on, true);
});

test("a new layout wipes the state, because the old widget ids may not exist in it", () => {
  const state = new SharedState();
  state.apply("a", { on: true });
  state.clear();
  assert.deepStrictEqual(state.snapshot(), {});
  assert.strictEqual(state.get("a"), null);
});

test("only what a widget is doing is shared, not arbitrary data", () => {
  const state = new SharedState();
  assert.strictEqual(state.apply("w1", { value: { nested: 1 } }), null);
  assert.strictEqual(state.apply("w1", { value: [1, 2] }), null);
  assert.strictEqual(state.apply("w1", { value: NaN }), null, "a value that is not a number");
  assert.strictEqual(state.apply("w1", { value: Infinity }), null);
  assert.strictEqual(state.apply("w1", "not a patch"), null);
  assert.strictEqual(state.apply("w1", [1]), null);
  assert.strictEqual(state.apply("", { value: 1 }), null);
  assert.strictEqual(state.apply(null, { value: 1 }), null);
  assert.strictEqual(state.size, 0, "none of that reached the registry");
});

test("null is a state a widget may hold, and false is not nothing", () => {
  const state = new SharedState();
  assert.deepStrictEqual(state.apply("w1", { on: false }), { on: false });
  assert.strictEqual(state.apply("w1", { on: false }), null, "and repeating it is still no news");
});

test("a page cannot fill memory by inventing widgets", () => {
  const state = new SharedState();
  for (let i = 0; i < MAX_WIDGETS + 50; i++) state.apply("w" + i, { value: i });
  assert.strictEqual(state.size, MAX_WIDGETS);

  // A widget already in the registry still works.
  assert.deepStrictEqual(state.apply("w0", { value: 999 }), { value: 999 });
});

test("nor by inventing keys on one widget", () => {
  const state = new SharedState();
  for (let i = 0; i < MAX_KEYS + 10; i++) state.apply("w1", { ["k" + i]: i });
  assert.strictEqual(Object.keys(state.get("w1")).length, MAX_KEYS);
});
