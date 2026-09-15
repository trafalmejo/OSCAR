"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { unitOf, toLevel, toLevels, toWhole, spread } = require("../lib/dmx/levels");
const { buildRequest, readSource } = require("../lib/dmx/request");
const { sacnMulticast, defaultHost, protocol } = require("../lib/dmx/spec");

// --- the rule that matters most ---------------------------------------------

test("nothing unreadable ever becomes a level", () => {
  // Number(null), Number("") and Number(false) are all 0, and 0 on a dimmer is
  // a blackout. Every one of these has to come back as "no value", so the
  // caller drops the update and the rig stays where the operator left it.
  for (const bad of [null, undefined, "", NaN, "abc", {}, [], true, false, Infinity]) {
    assert.strictEqual(toLevel(bad), null, JSON.stringify(bad) + " must not scale");
  }
});

test("one unreadable value spoils the set, rather than being filled in", () => {
  // A pad sending pan without tilt puts a light somewhere nobody asked for.
  assert.deepStrictEqual(toLevels([0.5, 0.25]), [128, 64]);
  assert.strictEqual(toLevels([0.5, null]), null);
  assert.strictEqual(toLevels([]), null);
});

test("a range that cannot be scaled is no value, not a value of zero", () => {
  assert.strictEqual(unitOf(5, 10, 10), null, "a range of zero width");
  assert.strictEqual(unitOf(5, "", 100), null);
  assert.strictEqual(unitOf(null, 0, 100), null);
});

// --- scaling ----------------------------------------------------------------

test("a control's travel maps onto a channel's full travel", () => {
  assert.strictEqual(toLevel(unitOf(0, 0, 100)), 0);
  assert.strictEqual(toLevel(unitOf(50, 0, 100)), 128);
  assert.strictEqual(toLevel(unitOf(100, 0, 100)), 255);

  // Whatever the control is labelled: the bottom is out and the top is full.
  assert.strictEqual(toLevel(unitOf(20, 20, 2000)), 0);
  assert.strictEqual(toLevel(unitOf(2000, 20, 2000)), 255);
  // And a range that runs downwards still reads as a position within it.
  assert.strictEqual(toLevel(unitOf(1, 1, -1)), 0);
  assert.strictEqual(toLevel(unitOf(-1, 1, -1)), 255);
});

test("a value past the end of its range pins, because that is what a fixture can do", () => {
  // This is a real value that overshot, not a value we failed to read: the
  // difference between clamping and dropping is the whole of the safety rule.
  assert.strictEqual(toLevel(1.4), 255);
  assert.strictEqual(toLevel(-0.2), 0);
  assert.strictEqual(unitOf(500, 0, 100), 1);
});

test("levels are whole numbers, because a DMX slot is one byte", () => {
  for (const unit of [0, 0.1, 0.333, 0.5, 0.999, 1]) {
    const level = toLevel(unit);
    assert.ok(Number.isInteger(level) && level >= 0 && level <= 255, unit + " -> " + level);
  }
});

// --- laying values across a block -------------------------------------------

test("one value fills its whole block, so a fader can dim a fixture as a unit", () => {
  assert.deepStrictEqual(spread([200], 3), [200, 200, 200]);
});

test("two values land on consecutive channels, which is pan and tilt", () => {
  assert.deepStrictEqual(spread([10, 20], 2), [10, 20]);
  // A longer block repeats the last value rather than leaving a gap at zero.
  assert.deepStrictEqual(spread([10, 20], 4), [10, 20, 20, 20]);
  // A shorter block truncates; the settings panel is where that gets refused.
  assert.deepStrictEqual(spread([10, 20], 1), [10]);
});

// --- whole numbers ----------------------------------------------------------

test("universes and channels have to be whole numbers inside their range", () => {
  assert.strictEqual(toWhole(5, 1, 512), 5);
  assert.strictEqual(toWhole("5", 1, 512), 5);
  assert.strictEqual(toWhole(5.5, 1, 512), null, "half a channel is not a channel");
  assert.strictEqual(toWhole(0, 1, 512), null);
  assert.strictEqual(toWhole(513, 1, 512), null);
  assert.strictEqual(toWhole("", 1, 512), null);
  assert.strictEqual(toWhole(null, 1, 512), null);
});

// --- addressing -------------------------------------------------------------

test("each sACN universe has its own multicast group", () => {
  assert.strictEqual(sacnMulticast(1), "239.255.0.1");
  assert.strictEqual(sacnMulticast(256), "239.255.1.0");
  assert.strictEqual(sacnMulticast(63999), "239.255.249.255");
});

test("a blank node falls back to how each protocol finds its receivers", () => {
  assert.strictEqual(defaultHost("artnet", 1), "255.255.255.255", "Art-Net broadcasts");
  assert.strictEqual(defaultHost("sacn", 7), "239.255.0.7", "sACN multicasts");
});

test("the two protocols disagree about universe numbering, and OSCAR knows it", () => {
  // Art-Net's Port-Address starts at 0; E1.31 reserves 0 and 64000 upwards.
  assert.strictEqual(protocol("artnet").minUniverse, 0);
  assert.strictEqual(protocol("sacn").minUniverse, 1);
  assert.strictEqual(protocol("sacn").maxUniverse, 63999);
  assert.strictEqual(protocol("e131"), null);
});

// --- the server-side gate ---------------------------------------------------

function request(overrides) {
  return Object.assign(
    { protocol: "artnet", host: "", universe: 1, channel: 10, levels: [255], source: "w1" },
    overrides
  );
}

test("a well-formed request comes back normalised", () => {
  assert.deepStrictEqual(buildRequest(request()), {
    protocol: "artnet",
    host: "",
    universe: 1,
    channel: 10,
    levels: [255],
    source: "w1",
  });
});

test("the gate refuses rather than repairs", () => {
  const refused = {
    "no protocol": { protocol: undefined },
    "an invented protocol": { protocol: "dmx512" },
    "universe 0 on sACN": { protocol: "sacn", universe: 0 },
    "a universe past the end": { protocol: "artnet", universe: 32768 },
    "a fractional universe": { universe: 1.5 },
    "channel 0": { channel: 0 },
    "channel 513": { channel: 513 },
    "no levels": { levels: [] },
    "levels that are not a list": { levels: 255 },
    "a level above 255": { levels: [256] },
    "a negative level": { levels: [-1] },
    "a fractional level": { levels: [12.5] },
    "a null level": { levels: [null] },
    "a blank level": { levels: [""] },
    "a boolean level": { levels: [true] },
    "a block running off the end": { channel: 511, levels: [1, 2, 3] },
    "a host that is not a host": { host: "10.0.0.1; rm -rf /" },
    "a host that is not a string": { host: 7 },
    "a source with odd characters": { source: "a/b" },
  };

  for (const [why, overrides] of Object.entries(refused)) {
    assert.strictEqual(buildRequest(request(overrides)), null, why);
  }

  assert.strictEqual(buildRequest(null), null);
  assert.strictEqual(buildRequest("all channels to full"), null);
  assert.strictEqual(buildRequest([]), null);
});

test("universe 0 is fine on Art-Net and only on Art-Net", () => {
  assert.ok(buildRequest(request({ protocol: "artnet", universe: 0 })));
  assert.strictEqual(buildRequest(request({ protocol: "sacn", universe: 0 })), null);
});

test("a level of 0 is a real instruction and passes", () => {
  // Dropping unreadable values must not turn into refusing deliberate blackouts.
  assert.deepStrictEqual(buildRequest(request({ levels: [0] })).levels, [0]);
});

test("a request with no source is one source, not a free-for-all", () => {
  assert.strictEqual(buildRequest(request({ source: undefined })).source, "default");
  assert.strictEqual(readSource("widget-abc"), "widget-abc");
  assert.strictEqual(readSource("../../etc"), null);
});

test("a named node is kept as given; a blank one is left for the sender to resolve", () => {
  assert.strictEqual(buildRequest(request({ host: " 10.0.0.9 " })).host, "10.0.0.9");
  assert.strictEqual(buildRequest(request({ host: "artnode.local" })).host, "artnode.local");
  assert.strictEqual(buildRequest(request({ host: "  " })).host, "");
});
