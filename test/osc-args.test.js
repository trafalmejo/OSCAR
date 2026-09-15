"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { toArgs, isSendable, toNumber, ARG_TYPES, NUMERIC_ARG_TYPES } = require("../lib/osc-args");
const { buildMessage } = require("../lib/osc-message");

test("each argument type produces the OSC type it promises", () => {
  assert.deepStrictEqual(toArgs("i", "7"), [{ type: "i", value: 7 }]);
  assert.deepStrictEqual(toArgs("f", "0.25"), [{ type: "f", value: 0.25 }]);
  assert.deepStrictEqual(toArgs("s", "blackout"), [{ type: "s", value: "blackout" }]);
  assert.deepStrictEqual(toArgs("none", "anything"), []);
});

test("int rounds rather than truncates", () => {
  // A slider two thirds up reads 67, not 66; someone typing 1.9 meant 2.
  assert.deepStrictEqual(toArgs("i", 1.9), [{ type: "i", value: 2 }]);
  assert.deepStrictEqual(toArgs("i", 66.7), [{ type: "i", value: 67 }]);
  assert.deepStrictEqual(toArgs("i", -1.5), [{ type: "i", value: -1 }]);
});

test("bool reads the words someone would actually type", () => {
  for (const off of ["0", "false", "FALSE", "off", "No", "", "  "]) {
    assert.deepStrictEqual(toArgs("bool", off), [{ type: "F" }], JSON.stringify(off));
  }
  for (const on of ["1", "true", "on", "yes", "go", "100"]) {
    assert.deepStrictEqual(toArgs("bool", on), [{ type: "T" }], JSON.stringify(on));
  }
});

test("a value that cannot be sent is refused, never coerced to zero", () => {
  // The whole point: 0 means "off" on a lighting rig, so guessing is worse
  // than silence. VibeOscar falls back to 0 here; OSCAR must not.
  for (const bad of ["abc", "", null, undefined, NaN, Infinity, true]) {
    assert.strictEqual(toArgs("f", bad), null, "f: " + String(bad));
    assert.strictEqual(toArgs("i", bad), null, "i: " + String(bad));
  }
});

test("blank text and wrapped values are refused too -- Number() reads them as zero", () => {
  // A stray space left in a field, or an empty list, is the same trap as an
  // empty string: Number("  ") and Number([]) are both 0.
  for (const bad of [" ", "  ", "\t", "\n", [], [[]], {}, [1]]) {
    assert.strictEqual(toArgs("f", bad), null, "f: " + JSON.stringify(bad));
    assert.strictEqual(toArgs("i", bad), null, "i: " + JSON.stringify(bad));
    assert.strictEqual(toNumber(bad), null, JSON.stringify(bad));
  }
  // Space around a real number is fine; it is only nothing-but-space that
  // hides a missing value.
  assert.deepStrictEqual(toArgs("f", " 5 "), [{ type: "f", value: 5 }]);
});

test("an int past 32 bits is refused rather than wrapped by the encoder", () => {
  assert.deepStrictEqual(toArgs("i", 2147483647), [{ type: "i", value: 2147483647 }]);
  assert.deepStrictEqual(toArgs("i", -2147483648), [{ type: "i", value: -2147483648 }]);
  for (const wide of [2147483648, -2147483649, 1e12, "1e12"]) {
    assert.strictEqual(toArgs("i", wide), null, String(wide));
  }
  // Rounding decides first: 2147483647.4 is still an int32.
  assert.deepStrictEqual(toArgs("i", 2147483647.4), [{ type: "i", value: 2147483647 }]);
  // A float has the range to carry it.
  assert.deepStrictEqual(toArgs("f", 1e12), [{ type: "f", value: 1e12 }]);
});

test("a string argument carries text a number never could", () => {
  assert.deepStrictEqual(toArgs("s", "not a number"), [{ type: "s", value: "not a number" }]);
  assert.deepStrictEqual(toArgs("s", ""), [{ type: "s", value: "" }]);
  assert.deepStrictEqual(toArgs("s", 12), [{ type: "s", value: "12" }]);
});

test("zero and negatives are real values and survive", () => {
  assert.deepStrictEqual(toArgs("f", 0), [{ type: "f", value: 0 }]);
  assert.deepStrictEqual(toArgs("i", 0), [{ type: "i", value: 0 }]);
  assert.deepStrictEqual(toArgs("f", -12.5), [{ type: "f", value: -12.5 }]);
});

test("isSendable agrees with toArgs, so the panel and the wire never disagree", () => {
  assert.strictEqual(isSendable("f", "abc"), false);
  assert.strictEqual(isSendable("s", "abc"), true);
  assert.strictEqual(isSendable("bool", "abc"), true);
  assert.strictEqual(isSendable("none", "abc"), true);
});

test("everything the pickers offer survives the encoder", () => {
  // A type offered in the settings panel that osc-message refuses would be a
  // dead option a user can select and then wonder why nothing happens.
  for (const { id } of ARG_TYPES.concat(NUMERIC_ARG_TYPES)) {
    const args = toArgs(id, "1");
    assert.notStrictEqual(args, null, id + " builds args");
    assert.ok(buildMessage("/x", args), id + " survives buildMessage");
  }
});
