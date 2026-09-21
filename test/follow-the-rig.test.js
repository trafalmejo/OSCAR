"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { byName } = require("../lib/widgets");
const { createSurfaces, allWidgetsIn } = require("../lib/surfaces");
const { PublishedStore } = require("../lib/published");
const { SharedState } = require("../lib/shared-state");
const { exportAttributes } = require("../lib/export/config");
const { stateFromMidi, followMidi } = require("../lib/widgets/midi-in");

function tag(name, id, settings) {
  const definition = byName[name];
  const config = Object.assign({}, definition.defaults, settings);
  const attributes = Object.assign({ id }, exportAttributes(name, (key) => config[key]));
  const text = Object.entries(attributes)
    .map(([k, v]) => k + '="' + String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"')
    .join(" ");
  return "<" + definition.tag + " " + text + "></" + definition.tag + ">";
}

async function venue(widgets) {
  const published = new PublishedStore(fs.mkdtempSync(path.join(os.tmpdir(), "oscar-follow-")));
  await published.save("Stage", "<body>" + widgets.join("") + "</body>");
  const store = new SharedState();
  const sent = [];
  const told = [];
  const surfaces = createSurfaces({
    published,
    sendOSC: () => sent.push("osc"),
    sendDMX: () => sent.push("dmx"),
    sendMIDI: () => sent.push("midi"),
    shared: { store },
    io: { emit: (event) => told.push(event) },
  });
  return { surfaces, store, sent, told };
}

const osc = (address, ...values) => ({ address, args: values.map((value) => ({ type: "f", value })) });

// ---- the meter ---------------------------------------------------------------------

test("a meter follows a MIDI controller as it follows OSC: the level across its own range, and no way out", () => {
  const meter = byName["oscar-meter"];
  const config = Object.assign({}, meter.defaults, { min: -60, max: 0, midiListen: true, midiNumber: 7 });
  assert.deepStrictEqual(stateFromMidi(meter, config, { type: "cc", channel: 1, number: 7, unit: 1 }, 0), { value: 0 });
  assert.deepStrictEqual(stateFromMidi(meter, config, { type: "cc", channel: 1, number: 7, unit: 0 }, 0), { value: -60 });
  const follow = followMidi(meter, () => config, () => ({}));
  assert.deepStrictEqual(follow({ type: "cc", channel: 1, number: 7, unit: 0.5 }, "nanoKONTROL2", true), { value: -30 });
  assert.strictEqual(follow({ type: "cc", channel: 1, number: 8, unit: 0.5 }, "nanoKONTROL2", true), null);
  assert.strictEqual(meter.drive, undefined, "it still cannot be driven: it shows, it does not send");
});

test("a level handed to the meter, from a controller or from OSCAR on a phone's behalf, is a reading like any other", () => {
  const meter = byName["oscar-meter"];
  const config = Object.assign({}, meter.defaults, { min: 0, max: 100, peakHold: 5 });
  const style = {};
  const el = { style: { setProperty: (k, v) => { style[k] = v; } }, setAttribute() {}, classList: { add() {}, remove() {} } };
  let handed = null;
  const sent = [];
  const ctx = {
    get: (key) => config[key],
    set: (key, value) => { config[key] = value; },
    send: (message) => sent.push(message),
    setClass() {},
    onChange: () => () => {},
    onShared: (fn) => { handed = fn; return () => { handed = null; }; },
  };
  const detach = meter.attach(el, ctx);
  handed({ value: 62 });
  assert.deepStrictEqual([config.value, style["--oscar-level"], style["--oscar-peak"]], [62, "62.00%", "62.00%"], "the bar, and the peak marker with it");
  handed({ value: 20 });
  assert.deepStrictEqual([style["--oscar-level"], style["--oscar-peak"]], ["20.00%", "62.00%"], "the peak is held, as it is for OSC");
  handed({ on: true });
  assert.strictEqual(config.value, 20, "a state with no level in it is somebody else's");
  assert.deepStrictEqual(sent, []);
  detach();
  assert.strictEqual(handed, null);
});

// ---- the server follows the rig when no page can ---------------------------------------

test("every widget of a published page is known, the ones that cannot be driven included", async () => {
  const page = "<body>" + tag("oscar-slider", "fader", {}) + tag("oscar-meter", "level", {}) + "</body>";
  assert.deepStrictEqual(allWidgetsIn(page).map((w) => [w.id, w.widget]), [["fader", "oscar-slider"], ["level", "oscar-meter"]]);
  const { surfaces } = await venue([tag("oscar-slider", "fader", {}), tag("oscar-meter", "level", {})]);
  assert.deepStrictEqual((await surfaces.widgets("stage")).map((w) => w.id), ["fader"], "what can be driven");
  assert.deepStrictEqual(await surfaces.shown("stage"), ["fader", "level"], "what can be shown a state");
  assert.strictEqual(await surfaces.shown("nowhere"), null);
});

test("a surface published a moment ago is read afresh: it is made public straight after", async () => {
  const published = new PublishedStore(fs.mkdtempSync(path.join(os.tmpdir(), "oscar-follow-")));
  await published.save("Stage", "<body>" + tag("oscar-meter", "level", {}) + "</body>");
  const surfaces = createSurfaces({ published, sendOSC() {}, sendDMX() {}, sendMIDI() {}, shared: { store: new SharedState() }, io: { emit() {} } });
  await surfaces.followedMidiPorts(); // everything has just been read
  await published.save("Lobby", "<body>" + tag("oscar-meter", "door", {}) + "</body>");
  assert.deepStrictEqual(await surfaces.shown("lobby"), ["door"]);
});

test("the rig's level is recorded for a published meter, sent nowhere, and the network is not told what it heard for itself", async () => {
  const { surfaces, store, sent, told } = await venue([
    tag("oscar-meter", "level", { message: "/ch/1/level" }),
    tag("oscar-meter", "deaf", { message: "/ch/2/level", listen: false }),
    tag("oscar-meter", "off", { message: "/ch/3/level", enabled: false }),
  ]);
  const seen = [];
  surfaces.onState((id, state, info) => seen.push([id, state, info]));
  assert.strictEqual(surfaces.watched(), true);

  assert.strictEqual(await surfaces.hearOsc(osc("/ch/1/level", 0.62)), 1);
  assert.deepStrictEqual(seen, [["level", { value: 0.62 }, { heard: true }]], "a watcher is told, and told it came from the rig");
  assert.deepStrictEqual(store.get("level"), { value: 0.62 }, "kept for a phone that joins later");
  assert.deepStrictEqual([sent, told], [[], []]);

  assert.strictEqual(await surfaces.hearOsc(osc("/ch/1/level", 0.62)), 0, "the same level again is not news");
  assert.strictEqual(await surfaces.hearOsc(osc("/ch/2/level", 1)), 0, "Data in is off");
  assert.strictEqual(await surfaces.hearOsc(osc("/ch/3/level", 1)), 0, "the master switch makes it deaf");
  assert.strictEqual(await surfaces.hearOsc(osc("/ch/1/level", "loud")), 0, "an unreadable level holds the last one");
  assert.strictEqual(await surfaces.hearOsc(osc("/ch/9/level", 1)), 0);
  assert.deepStrictEqual(store.get("level"), { value: 0.62 });
});

test("MIDI is followed the same way, for any widget that listens: recorded, and nothing sent", async () => {
  const { surfaces, store, sent } = await venue([
    tag("oscar-meter", "level", { min: 0, max: 100, midiListen: true, midiNumber: 7 }),
    tag("oscar-slider", "fader", { min: 0, max: 10, midiListen: true, midiNumber: 8, midiEnabled: true }),
  ]);
  surfaces.onState(() => {});
  assert.deepStrictEqual(await surfaces.followedMidiPorts(), [""]);
  assert.strictEqual(await surfaces.followMidi({ type: "cc", channel: 1, number: 7, unit: 0.5 }, "x", true), 1);
  assert.strictEqual(await surfaces.followMidi({ type: "cc", channel: 1, number: 8, unit: 1 }, "x", true), 1);
  assert.deepStrictEqual([store.get("level"), store.get("fader")], [{ value: 50 }, { value: 10 }]);
  assert.deepStrictEqual(sent, [], "following is not driving: the fader sends nothing, not even with Data out on");
});

test("nobody watching, nothing followed: the server only does this work for somebody who cannot hear the rig", async () => {
  const { surfaces } = await venue([tag("oscar-meter", "level", {})]);
  assert.strictEqual(surfaces.watched(), false);
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /if \(surfaces && surfaces\.watched\(\)\) surfaces\.hearOsc\(message\)/);
  assert.strictEqual((server.match(/io\.emit\("osc:in"/g) || []).length, 1, "one place tells the pages, so one place follows");
});
