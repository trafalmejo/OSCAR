"use strict";

// lib/telemetry-targets.js: what a published interface talks to, recognised
// from a fixed list and named by the list. Nothing a person typed is ever
// in the answer: a name from the list, or "other".

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { targetsOf, oscTarget, midiTarget, NAMES } = require("../lib/telemetry-targets");
const { byName } = require("../lib/widgets");
const { EVENTS } = require("../lib/telemetry");

const control = (widget, settings) => ({ id: "x", widget, config: Object.assign({}, byName[widget].defaults, settings) });

test("OSC software is known by its words first, and by its port second", () => {
  assert.strictEqual(oscTarget("/composition/layers/1/clips/2/connect", 9999), "resolume", "the words win over an unknown port");
  assert.strictEqual(oscTarget("/cue/3/go", 1), "qlab");
  assert.strictEqual(oscTarget("/live/track/set/volume", 1), "ableton");
  assert.strictEqual(oscTarget("/td/level", 1), "touchdesigner");
  assert.strictEqual(oscTarget("/ch/01/mix/fader", 1), "x32", "two digits: the X32's channels");
  assert.strictEqual(oscTarget("/ch/1/fader", 7000), "resolume", "one digit is not the X32; the port decides");
  assert.strictEqual(oscTarget("/anything", 53000), "qlab");
  assert.strictEqual(oscTarget("/my/own/thing", 9000), "other", "an unknown port and unknown words: other, and no more");
  assert.strictEqual(oscTarget("", null), "other");
});

test("MIDI gear is known by the words in its port's name, and a port nobody named is nothing", () => {
  assert.strictEqual(midiTarget("LPD8 mk2"), "akai");
  assert.strictEqual(midiTarget("Launchpad X"), "launchpad");
  assert.strictEqual(midiTarget("loopMIDI Port 1"), "loopmidi");
  assert.strictEqual(midiTarget("IAC Driver Bus 1"), "iac");
  assert.strictEqual(midiTarget("Microsoft GS Wavetable Synth"), "windows-synth");
  assert.strictEqual(midiTarget("X-Touch Compact"), "behringer");
  assert.strictEqual(midiTarget("Daniel's keyboard"), "other", "a name the list does not know is other: the name itself never leaves");
  assert.strictEqual(midiTarget(""), null, "the first port there is: no device named");
  assert.strictEqual(midiTarget("All MIDI inputs"), null);
});

test("a published interface's targets: each kind once per target, in and out alike, nothing typed in the answer", () => {
  const widgets = [
    control("oscar-slider", { message: "/composition/layers/1/video/opacity", ip: "192.168.1.50", port: 7000 }),
    control("oscar-button", { message: "/composition/connect", ip: "192.168.1.50", port: 7000 }),
    control("oscar-meter", { message: "/cue/1/level", listen: true }),
    control("oscar-button", { message: "/x", ip: "10.0.0.9", port: 9000, midiEnabled: true, midiPort: "LPD8 mk2" }),
    control("oscar-slider", { message: "/y", oscEnabled: false, midiListen: true, midiInPort: "Launchpad X", dmxEnabled: true, dmxProtocol: "usbpro" }),
    control("oscar-colour", { message: "/z", oscVia: "serial", dmxEnabled: true, dmxProtocol: "artnet" }),
  ];
  const found = targetsOf(widgets).map((t) => t.kind + ":" + t.target).sort();
  assert.deepStrictEqual(found, ["dmx:artnet", "dmx:usb-pro", "midi:akai", "midi:launchpad", "osc:other", "osc:qlab", "osc:resolume"]);
  const text = JSON.stringify(targetsOf(widgets));
  for (const typed of ["192.168", "7000", "9000", "LPD8", "Launchpad X", "/composition", "/cue"]) {
    assert.ok(!text.includes(typed), typed + " must not be in what is sent");
  }
  assert.deepStrictEqual(targetsOf([]), []);
  assert.deepStrictEqual(targetsOf([control("oscar-button", { message: "/a", oscEnabled: false })]), [], "a control that sends nothing names nothing");
});

test("every name the file can say is in its list, the event is whitelisted, and the server sends it at publish", () => {
  assert.ok(NAMES.includes("other") && NAMES.includes("resolume") && NAMES.includes("launchpad"));
  assert.deepStrictEqual(NAMES, [...new Set(NAMES)].sort(), "no name twice");
  for (const name of NAMES) assert.match(name, /^[a-z0-9-]+$/, name + " is a plain word, not a thing somebody typed");
  assert.deepStrictEqual(EVENTS.target_seen, ["kind", "target"]);
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").replace(/\r\n/g, "\n");
  assert.match(server, /targetsOf\(widgets\)\.forEach\(\(seen\) => telemetry\.tell\("target_seen", seen\)\);/, "one event per distinct target, beside the protocol booleans");
});
