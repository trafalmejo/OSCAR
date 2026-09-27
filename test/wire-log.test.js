"use strict";

// The network log records what crossed the wire: one row per kind of
// traffic per moment, with what it carried, where it went or came from, and
// -- written on that same row -- who caused it or who followed it.

const test = require("node:test");
const assert = require("node:assert");

const { createWireLog } = require("../lib/wire-log");
const { oscValue, midiOut, midiIn, dmxOut, dmxTo } = require("../lib/activity");

function setUp() {
  let clock = 1000;
  let timers = [];
  const emitted = [];
  const flashes = [];
  const log = createWireLog({
    emit: (row) => emitted.push(row),
    flash: (dir) => flashes.push(dir),
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { fn, at: clock + ms };
      timers.push(t);
      return t;
    },
  });
  const advance = (ms) => {
    clock += ms;
    const due = timers.filter((t) => t.at <= clock);
    timers = timers.filter((t) => t.at > clock);
    due.forEach((t) => t.fn());
  };
  return { log, emitted, flashes, advance };
}

test("repeats in one moment are one row: a count, the latest value, the latest time", () => {
  const { log, emitted, advance } = setUp();
  log.out({ protocol: "osc", what: "/dim", value: "0.1", to: "10.0.0.5:7000", origin: "canvas" });
  advance(50);
  log.out({ protocol: "osc", what: "/dim", value: "0.9", to: "10.0.0.5:7000", origin: "canvas" });
  advance(300);
  assert.strictEqual(emitted.length, 1);
  assert.deepStrictEqual(
    { what: emitted[0].what, value: emitted[0].value, n: emitted[0].n, at: emitted[0].at, to: emitted[0].to, origin: emitted[0].origin },
    { what: "/dim", value: "0.9", n: 2, at: 1050, to: "10.0.0.5:7000", origin: "canvas" }
  );
});

test("the same address to two places, or from two senders, is two rows", () => {
  const { log, emitted, advance } = setUp();
  log.out({ protocol: "osc", what: "/dim", to: "10.0.0.5:7000" });
  log.out({ protocol: "osc", what: "/dim", to: "10.0.0.6:7000" });
  log.arrive({ protocol: "osc", what: "/dim", device: "10.0.0.5" });
  log.arrive({ protocol: "osc", what: "/dim", device: "10.0.0.6" });
  advance(300);
  assert.strictEqual(emitted.length, 4);
});

test("an arrival counts messages, not the widgets it moved, and names every surface that follows it", () => {
  const { log, emitted, advance } = setUp();
  const one = log.arrive({ protocol: "osc", what: "/dim", value: "1", device: "10.0.0.9" });
  one.followedBy("stage");
  one.followedBy("stage"); // a second widget on the same surface
  one.followedBy("lobby");
  advance(300);
  assert.strictEqual(emitted.length, 1, "one row for one message");
  assert.strictEqual(emitted[0].n, 1);
  assert.deepStrictEqual(emitted[0].surfaces, ["stage", "lobby"]);
  assert.strictEqual(emitted[0].device, "10.0.0.9");
});

test("the canvas's word lands on the row it is about, even after it was shown, and only once", () => {
  const { log, emitted, advance } = setUp();
  log.arrive({ protocol: "osc", what: "/dim", device: "10.0.0.9" });
  advance(300);
  assert.strictEqual(emitted.length, 1);
  assert.ok(!emitted[0].canvas, "not yet followed");
  assert.strictEqual(log.canvasHeard("osc", "/dim"), true);
  assert.strictEqual(emitted.length, 2, "an update, not a new row");
  assert.strictEqual(emitted[1].id, emitted[0].id);
  assert.strictEqual(emitted[1].canvas, true);
  log.canvasHeard("osc", "/dim"); // a second editor
  assert.strictEqual(emitted.length, 2, "a second editor changes nothing");
  assert.strictEqual(log.rows().length, 1, "and the backlog holds one row");
});

test("the canvas's word about nothing that arrived, or long ago, is not a row", () => {
  const { log, emitted, advance } = setUp();
  assert.strictEqual(log.canvasHeard("osc", "/never"), false);
  log.arrive({ protocol: "osc", what: "/old" });
  advance(300);
  advance(5000);
  assert.strictEqual(log.canvasHeard("osc", "/old"), false, "too late to be about it");
  assert.strictEqual(emitted.length, 1);
});

test("a MIDI word matches its port; an OSC word matches any sender", () => {
  const { log, emitted, advance } = setUp();
  log.arrive({ protocol: "midi", what: "cc 7 ch 1", device: "LPD8" });
  log.arrive({ protocol: "midi", what: "cc 7 ch 1", device: "nanoKONTROL" });
  advance(300);
  log.canvasHeard("midi", "cc 7 ch 1", "LPD8");
  const byDevice = {};
  for (const row of emitted) byDevice[row.device] = row;
  assert.strictEqual(byDevice.LPD8.canvas, true);
  assert.ok(!byDevice.nanoKONTROL.canvas);
});

test("what was refused is a row, marked, and lights nothing", () => {
  const { log, emitted, flashes, advance } = setUp();
  log.out({ protocol: "osc", what: "/bad", to: "10.0.0.5:99999", dropped: "malformed" });
  log.arrive({ protocol: "osc", what: "(not OSC)", device: "10.0.0.7", dropped: "unreadable" });
  advance(300);
  assert.deepStrictEqual(emitted.map((r) => r.dropped), ["malformed", "unreadable"]);
  assert.deepStrictEqual(flashes, []);
});

test("the lights: OUT for what went out, IN for what something followed, at most every 200 ms", () => {
  const { log, flashes, advance } = setUp();
  log.out({ protocol: "osc", what: "/a", to: "x" });
  log.out({ protocol: "osc", what: "/b", to: "x" });
  assert.deepStrictEqual(flashes, ["out"], "throttled");
  log.arrive({ protocol: "osc", what: "/nobody" });
  assert.deepStrictEqual(flashes, ["out"], "an arrival nothing follows lights nothing");
  log.arrive({ protocol: "osc", what: "/dim" }).followedBy("stage");
  assert.deepStrictEqual(flashes, ["out", "in"]);
  advance(250);
  log.canvasHeard("osc", "/dim");
  assert.deepStrictEqual(flashes, ["out", "in", "in"], "the canvas following lights IN too");
});

test("rows are kept in the order things happened, and no more than the cap", () => {
  const { log, advance } = setUp();
  for (let i = 0; i < 250; i++) {
    log.out({ protocol: "osc", what: "/n" + i, to: "x" });
    advance(301);
  }
  const rows = log.rows();
  assert.strictEqual(rows.length, 200);
  assert.strictEqual(rows[rows.length - 1].what, "/n249");
  assert.ok(rows.every((row, i) => i === 0 || rows[i - 1].at <= row.at));
});

test("the words: values as people read them, and where things went", () => {
  assert.strictEqual(oscValue([{ type: "f", value: 186.73228346456693 }, { type: "s", value: "go" }]), '186.732 "go"');
  assert.strictEqual(oscValue(0.5), "0.5");
  assert.deepStrictEqual(midiOut({ port: "IAC Bus 1", messages: [[0xb0, 7, 64]] }), { what: "cc 7 ch 1", value: "64", to: "IAC Bus 1" });
  assert.deepStrictEqual(midiOut({ port: "", messages: [[0x91, 60, 100], [0x81, 60, 0]] }), { what: "note on 60 ch 2", value: "100 (+1 more)", to: "the first port" });
  assert.deepStrictEqual(midiOut({ port: "x", messages: [[0xe0, 0, 64]] }), { what: "bend ch 1", value: "8192", to: "x" });
  assert.deepStrictEqual(midiOut({ port: "x", messages: [[0x12]] }), { what: "bytes 18", value: "", to: "x" }, "what is not MIDI OSCAR knows is its bytes");
  assert.deepStrictEqual(midiIn({ type: "cc", channel: 1, number: 36, unit: 1 }), { what: "cc 36 ch 1", value: "127" });
  assert.deepStrictEqual(dmxOut({ protocol: "artnet", host: "10.0.0.50", universe: 0, channel: 5, levels: [255, 0, 40] }), { what: "u 0 · ch 5–7", value: "255 0 40", to: "Art-Net 10.0.0.50" });
  assert.strictEqual(dmxTo("sacn", ""), "sACN multicast");
  assert.strictEqual(dmxTo("usbpro", ""), "USB (Enttec Pro, DMXKing)");
});
