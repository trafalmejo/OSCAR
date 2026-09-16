"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { toArgs, isSendable, ARG_TYPES, NUMERIC_ARG_TYPES } = require("../lib/osc-args");
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

test("a stray space or a wrapped value is refused, never read as zero", () => {
  // Number("  "), Number("\t") and Number([]) are all 0. A panel field left
  // holding a space would otherwise go out as 0 -- "off" on a lighting rig.
  for (const bad of ["  ", "\t", "\n", " \t\n ", [], [5], {}]) {
    assert.strictEqual(toArgs("f", bad), null, "f: " + JSON.stringify(bad));
    assert.strictEqual(toArgs("i", bad), null, "i: " + JSON.stringify(bad));
  }
});

test("a real number typed with a space around it is still that number", () => {
  // Refusing blanks must not refuse "5 " -- that is a typo, not a missing value.
  assert.deepStrictEqual(toArgs("f", " 5 "), [{ type: "f", value: 5 }]);
  assert.deepStrictEqual(toArgs("i", "\t12\n"), [{ type: "i", value: 12 }]);
});
