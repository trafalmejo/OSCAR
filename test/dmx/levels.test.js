"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { toWhole, unitOf, toLevel, toLevels, spread } = require("../../lib/dmx/levels");
const { protocol, defaultHost, sacnMulticast } = require("../../lib/dmx/spec");

test("a value is placed within its range as 0..1", () => {
  assert.strictEqual(unitOf(50, 0, 100), 0.5);
  assert.strictEqual(unitOf(0, 0, 100), 0);
  assert.strictEqual(unitOf(100, 0, 100), 1);
  assert.strictEqual(unitOf(0, -1, 1), 0.5, "a signed range");
  assert.strictEqual(unitOf(25, 100, 0), 0.75, "a range written backwards still reads from min to max");
  assert.strictEqual(unitOf("50", "0", "100"), 0.5, "numbers spelled as text are numbers");
});

test("a value past either end of its range pins there", () => {
  assert.strictEqual(unitOf(150, 0, 100), 1);
  assert.strictEqual(unitOf(-5, 0, 100), 0);
});

test("a degenerate range is no value, not zero", () => {
  // Number(x - x) / 0 is NaN or Infinity; either would be a blackout or a
  // full-on that nobody asked for.
  assert.strictEqual(unitOf(5, 5, 5), null);
  assert.strictEqual(unitOf(0, 0, 0), null);
});

test("a value that cannot be read is null, never 0", () => {
  for (const bad of [null, undefined, "", " ", "abc", NaN, Infinity, true, false, {}, []]) {
    assert.strictEqual(unitOf(bad, 0, 100), null, "value " + JSON.stringify(bad));
    assert.strictEqual(unitOf(50, bad, 100), null, "min " + JSON.stringify(bad));
    assert.strictEqual(unitOf(50, 0, bad), null, "max " + JSON.stringify(bad));
    assert.strictEqual(toLevel(bad), null, "level " + JSON.stringify(bad));
    assert.strictEqual(toWhole(bad, 0, 512), null, "whole " + JSON.stringify(bad));
  }
});

test("0..1 becomes 0..255, rounded, and clamped on the way", () => {
  assert.strictEqual(toLevel(0), 0);
  assert.strictEqual(toLevel(1), 255);
  assert.strictEqual(toLevel(0.5), 128);
  assert.strictEqual(toLevel(0.499), 127);
  assert.strictEqual(toLevel(2), 255);
  assert.strictEqual(toLevel(-1), 0);
  assert.strictEqual(toLevel("0.25"), 64);
});

test("one unreadable value in a set spoils the set", () => {
  assert.deepStrictEqual(toLevels([0, 0.5, 1]), [0, 128, 255]);
  assert.deepStrictEqual(toLevels(1), [255], "a bare value is a list of one");
  assert.strictEqual(toLevels([0.5, null]), null);
  assert.strictEqual(toLevels([0.5, "abc"]), null);
  assert.strictEqual(toLevels([]), null, "no values is no level");
});

test("levels fill a block in order and the last one repeats; a block too narrow is refused", () => {
  assert.deepStrictEqual(spread([200], 3), [200, 200, 200], "one slider dims an RGB fixture as a whole");
  assert.deepStrictEqual(spread([10, 20], 2), [10, 20], "a pad lands on pan and tilt");
  assert.deepStrictEqual(spread([10, 20], 3), [10, 20, 20]);
  assert.strictEqual(spread([10, 20], 1), null, "half a position is no position");
  assert.strictEqual(spread([], 1), null);
});

test("a whole number in range, or nothing", () => {
  assert.strictEqual(toWhole(1, 1, 512), 1);
  assert.strictEqual(toWhole("512", 1, 512), 512);
  assert.strictEqual(toWhole(513, 1, 512), null);
  assert.strictEqual(toWhole(0, 1, 512), null);
  assert.strictEqual(toWhole(1.5, 1, 512), null, "a channel is not a fraction");
  assert.strictEqual(toWhole("3 ", 1, 512), 3, "surrounding space is fine, as it is for OSC");
});

test("the protocols know their ports, universe ranges and where a blank node sends", () => {
  assert.strictEqual(protocol("artnet").port, 6454);
  assert.strictEqual(protocol("sacn").port, 5568);
  assert.deepStrictEqual([protocol("artnet").minUniverse, protocol("artnet").maxUniverse], [0, 32767]);
  assert.deepStrictEqual([protocol("sacn").minUniverse, protocol("sacn").maxUniverse], [1, 63999]);
  assert.strictEqual(protocol("dmx512"), null);
  assert.strictEqual(defaultHost("artnet", 3), "255.255.255.255");
  assert.strictEqual(defaultHost("sacn", 1), "239.255.0.1");
  assert.strictEqual(sacnMulticast(300), "239.255.1.44");
  assert.strictEqual(sacnMulticast(63999), "239.255.249.255");
});
