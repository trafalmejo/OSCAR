"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { readMidi, midiIndex } = require("../lib/midi/spec");
const { createMidi } = require("../lib/midi");
const { stateFromMidi, valuesOf } = require("../lib/widgets/midi-in");
const { byName } = require("../lib/widgets");
const { createSurfaces } = require("../lib/surfaces");
const { PublishedStore } = require("../lib/published");
const { SharedState } = require("../lib/shared-state");
const { exportAttributes } = require("../lib/export/config");

// ---- what arrived, in the settings' words ---------------------------------------

test("bytes are read as a note, a controller, a program or a bend, and nothing else", () => {
  assert.deepStrictEqual(readMidi([0xb2, 21, 127]), { type: "cc", channel: 3, number: 21, unit: 1 });
  assert.deepStrictEqual(readMidi([0x90, 60, 0]), { type: "note", channel: 1, number: 60, unit: 0 }, "a note on at velocity 0 is a note off");
  assert.deepStrictEqual(readMidi([0x80, 60, 64]), { type: "note", channel: 1, number: 60, unit: 0 });
  assert.strictEqual(readMidi([0x9f, 36, 127]).channel, 16);
  assert.deepStrictEqual(readMidi([0xc0, 5]), { type: "program", channel: 1, number: 5, unit: 5 / 127 });
  assert.strictEqual(readMidi([0xe0, 0x7f, 0x7f]).unit, 1);
  assert.strictEqual(readMidi([0xe0, 0x00, 0x40]).unit, 8192 / 16383);
  for (const bytes of [[0xf8], [0xf0, 1, 2, 0xf7], [0xa0, 60, 10], [0xd0, 10], [0xb0], [], null, [0xb0, 200, 1]]) {
    assert.strictEqual(readMidi(bytes), null, JSON.stringify(bytes));
  }
});

test("a message is a widget's when type, channel, number and port all say so", () => {
  const config = { enabled: true, midiListen: true, midiType: "cc", midiChannel: 3, midiNumber: 20, midiInPort: "" };
  const cc = (number, channel) => ({ type: "cc", channel: channel || 3, number, unit: 0.5 });

  assert.strictEqual(midiIndex(config, cc(20), "nanoKONTROL2", 1), 0);
  assert.strictEqual(midiIndex(config, cc(21), "x", 1), -1);
  assert.deepStrictEqual([20, 21, 22, 23].map((n) => midiIndex(config, cc(n), "x", 3)), [0, 1, 2, -1], "a colour listens on three in a row");
  assert.strictEqual(midiIndex(config, cc(20, 4), "x", 1), -1, "another channel is another instrument");
  assert.strictEqual(midiIndex(config, { type: "note", channel: 3, number: 20, unit: 1 }, "x", 1), -1);

  const named = Object.assign({}, config, { midiInPort: "kontrol" });
  assert.strictEqual(midiIndex(named, cc(20), "nanoKONTROL2 1 SLIDER/KNOB", 1), 0, "part of a name, whatever the case");
  assert.strictEqual(midiIndex(named, cc(20), "Launchpad Mini", 1), -1);

  assert.strictEqual(midiIndex(Object.assign({}, config, { midiListen: false }), cc(20), "x", 1), -1);
  assert.strictEqual(midiIndex(Object.assign({}, config, { enabled: false }), cc(20), "x", 1), -1, "the master switch makes a widget deaf too");
  assert.strictEqual(midiIndex(Object.assign({}, config, { midiType: "pitch" }), { type: "pitch", channel: 3, number: 0, unit: 1 }, "x", 1), 0, "a bend has no number to match");
});

// ---- what it does to each kind of widget ----------------------------------------------

const widget = (name, settings) => [byName[name], Object.assign({}, byName[name].defaults, settings)];
const cc = (unit, number) => ({ type: "cc", channel: 1, number: number || 1, unit });
const note = (unit) => ({ type: "note", channel: 1, number: 60, unit });

test("a fader and a number box take the level across their own range", () => {
  const [slider, config] = widget("oscar-slider", { min: 20, max: 2000 });
  assert.deepStrictEqual(stateFromMidi(slider, config, cc(0), 0), { value: 20 });
  assert.deepStrictEqual(stateFromMidi(slider, config, cc(1), 0), { value: 2000 });
  assert.deepStrictEqual(stateFromMidi(slider, config, cc(0.5), 0), { value: 1010 });
  const [number, settings] = widget("oscar-number-input", { min: 0, max: 10 });
  assert.deepStrictEqual(stateFromMidi(number, settings, cc(1), 0), { value: 10 });
  assert.strictEqual(valuesOf(slider, config), 1);
});

test("a button is held by a note, and a toggle changes over on each press and ignores the release", () => {
  const [button, hold] = widget("oscar-button", {});
  assert.deepStrictEqual(stateFromMidi(button, hold, note(0.8), 0), { on: true });
  assert.deepStrictEqual(stateFromMidi(button, hold, note(0), 0), { on: false });
  assert.deepStrictEqual(stateFromMidi(button, hold, cc(0.4), 0), { on: false }, "a controller is on from halfway up");
  assert.deepStrictEqual(stateFromMidi(button, hold, cc(0.6), 0), { on: true });

  const toggle = Object.assign({}, hold, { mode: "toggle" });
  assert.deepStrictEqual(stateFromMidi(button, toggle, note(1), 0, { on: false }), { on: true });
  assert.strictEqual(stateFromMidi(button, toggle, note(0), 0, { on: true }), null, "letting go of the pad is not a second press");
  assert.deepStrictEqual(stateFromMidi(button, toggle, note(1), 0, { on: true }), { on: false });
});

test("a program picks a dropdown's option by its value, then by its place; a level picks along the list", () => {
  const [dropdown, config] = widget("oscar-dropdown", { options: "Sunrise=10, Storm=20, Neon=30" });
  const program = (number) => ({ type: "program", channel: 1, number, unit: number / 127 });
  assert.deepStrictEqual(stateFromMidi(dropdown, config, program(20), 0), { value: "20" });
  assert.deepStrictEqual(stateFromMidi(dropdown, config, program(2), 0), { value: "30" }, "no option is worth 2, so the third one");
  assert.strictEqual(stateFromMidi(dropdown, config, program(90), 0), null);
  assert.deepStrictEqual(stateFromMidi(dropdown, config, cc(0), 0), { value: "10" });
  assert.deepStrictEqual(stateFromMidi(dropdown, config, cc(1), 0), { value: "30" });
});

test("a pad and a colour take one value at a time, and what was not touched stays where it was", () => {
  const [pad, config] = widget("oscar-xypad", { minX: 0, maxX: 1, minY: -1, maxY: 1 });
  assert.strictEqual(valuesOf(pad, config), 2);
  assert.deepStrictEqual(stateFromMidi(pad, config, cc(1), 0, { x: 0.2, y: 0.5 }), { x: 1, y: 0.5 });
  assert.deepStrictEqual(stateFromMidi(pad, config, cc(0), 1, { x: 0.2, y: 0.5 }), { x: 0.2, y: -1 });
  assert.deepStrictEqual(stateFromMidi(pad, config, cc(1), 0), { x: 1, y: 0 }, "an axis nobody has touched starts in the middle");

  const [colour, settings] = widget("oscar-colour", {});
  assert.strictEqual(valuesOf(colour, settings), 3);
  assert.deepStrictEqual(stateFromMidi(colour, settings, cc(1), 1, { value: "#102030" }), { value: "#10ff30" });
  assert.deepStrictEqual(stateFromMidi(colour, settings, cc(1), 0), { value: "#ff0000" });

  const [text, plain] = widget("oscar-text-input", {});
  assert.strictEqual(stateFromMidi(text, plain, cc(1), 0), null, "nothing to do with a level");
});

// ---- the server does the moving, once ------------------------------------------------------

function tag(name, id, settings) {
  const definition = byName[name];
  const config = Object.assign({}, definition.defaults, settings);
  const attributes = Object.assign({ id }, exportAttributes(name, (key) => config[key]));
  const text = Object.entries(attributes).map(([k, v]) => k + '="' + String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"').join(" ");
  return "<" + definition.tag + " " + text + "></" + definition.tag + ">";
}

async function stage(widgets) {
  const published = new PublishedStore(fs.mkdtempSync(path.join(os.tmpdir(), "oscar-midi-in-")));
  await published.save("Stage", "<body>" + widgets.join("") + "</body>");
  const sent = { osc: [], dmx: [], midi: [] };
  const told = [];
  let clock = 0;
  const surfaces = createSurfaces({
    published,
    sendOSC: (ip, port, address, args) => sent.osc.push([address, args.map((a) => a.value)]),
    sendDMX: (request) => sent.dmx.push(request.levels),
    sendMIDI: (request) => sent.midi.push(request),
    shared: { store: new SharedState() },
    io: { emit: (event, payload) => told.push([event, payload.id, payload.state]) },
    now: () => clock,
  });
  return { surfaces, published, sent, told, tick: (ms) => { clock += ms; } };
}

test("a knob works a published fader as a hand would: it moves on every device, sends its OSC and DMX, and says nothing back in MIDI", async () => {
  const { surfaces, sent, told } = await stage([
    tag("oscar-slider", "master", { message: "/master", min: 0, max: 100, dmxEnabled: true, midiListen: true, midiEnabled: true, midiNumber: 7 }),
    tag("oscar-slider", "other", { message: "/other", midiListen: true, midiNumber: 8 }),
    tag("oscar-slider", "deaf", { message: "/deaf", midiNumber: 7 }),
  ]);

  assert.deepStrictEqual(await surfaces.midiPorts(), [""], "the first port there is, since no widget names one");
  assert.strictEqual(await surfaces.hearMidi({ type: "cc", channel: 1, number: 7, unit: 1 }, "nanoKONTROL2"), 1);
  assert.deepStrictEqual(sent.osc, [["/master", [100]]]);
  assert.deepStrictEqual(sent.dmx, [[255]]);
  assert.deepStrictEqual(sent.midi, [], "through a virtual port its own answer would come straight back in, for ever");
  assert.deepStrictEqual(told, [["state:changed", "master", { value: 100 }]]);

  // A hand on the same fader still sends MIDI: only what came in by MIDI keeps quiet.
  await surfaces.drive("stage", "master", { value: 50 });
  assert.strictEqual(sent.midi.length, 1);

  assert.strictEqual(await surfaces.hearMidi({ type: "cc", channel: 1, number: 99, unit: 1 }, "x"), 0, "nobody's");
});

test("a pad follows two knobs, each moving its own axis from where the other left it", async () => {
  const { surfaces, sent } = await stage([tag("oscar-xypad", "pan", { message: "/pos", minX: 0, maxX: 1, minY: 0, maxY: 1, midiListen: true, midiNumber: 20 })]);
  await surfaces.hearMidi({ type: "cc", channel: 1, number: 20, unit: 1 }, "x");
  await surfaces.hearMidi({ type: "cc", channel: 1, number: 21, unit: 0 }, "x");
  assert.deepStrictEqual(sent.osc, [["/pos", [1, 0.5]], ["/pos", [1, 0]]]);
});

test("the ports to open are the ones the published widgets name, and a surface published since is noticed", async () => {
  const { surfaces, published, tick } = await stage([tag("oscar-slider", "a", { midiListen: true, midiInPort: "Launchpad" })]);
  assert.deepStrictEqual(await surfaces.midiPorts(), ["launchpad"]);

  await published.save("Booth", "<body>" + tag("oscar-button", "go", { midiListen: true, midiInPort: " nano " }) + "</body>");
  assert.deepStrictEqual(await surfaces.midiPorts(), ["launchpad"], "the folder is not read again for every turn of a knob");
  tick(2000);
  assert.deepStrictEqual((await surfaces.midiPorts()).sort(), ["launchpad", "nano"]);
});

// ---- the ports listened on, and Learn -----------------------------------------------------------

/** A driver with these inputs, whose ports can be played. */
function fakeDriver(names) {
  const driver = {
    supported: true,
    names: names.slice(),
    open: {},
    log: [],
    outputs: () => [],
    inputs: () => driver.names.slice(),
    openOutput: () => null,
    openInput(name, onMessage) {
      if (driver.names.indexOf(name) === -1) return null;
      if (driver.busy === name) throw new Error("the port is in use");
      driver.open[name] = onMessage;
      driver.log.push("open " + name);
      return { name, close: () => { delete driver.open[name]; driver.log.push("close " + name); } };
    },
    play: (name, bytes) => driver.open[name] && driver.open[name](bytes),
  };
  return driver;
}

function timers() {
  const t = { ticks: [], waits: [] };
  t.options = {
    setInterval: (fn) => { t.ticks.push(fn); return { unref() {} }; },
    clearInterval: () => { t.ticks.length = 0; },
    setTimeout: (fn) => { t.waits.push(fn); return t.waits.length; },
    clearTimeout: () => {},
  };
  return t;
}

test("a port is only opened while a widget wants it, because on Windows opening it takes it from everyone else", () => {
  const driver = fakeDriver(["Launchpad Mini", "nanoKONTROL2"]);
  const t = timers();
  const midi = createMidi(Object.assign({ driver }, t.options));
  const heard = [];
  midi.onMessage((message, port) => heard.push([port, message.type, message.number]));

  assert.deepStrictEqual(driver.log, [], "nothing at start");
  midi.listenFor(["launchpad"]);
  assert.deepStrictEqual(driver.log, ["open Launchpad Mini"]);
  driver.play("Launchpad Mini", [0x90, 36, 100]);
  driver.play("Launchpad Mini", [0xf8]);
  assert.deepStrictEqual(heard, [["Launchpad Mini", "note", 36]], "clock is not a widget's business");

  // Every port, which has to be asked for. Then one is unplugged: noticed at the next look.
  midi.listenFor(["*"]);
  assert.deepStrictEqual(driver.log.slice(1), ["open nanoKONTROL2"]);
  driver.names = ["nanoKONTROL2"];
  t.ticks[0]();
  assert.deepStrictEqual(driver.log.slice(2), ["close Launchpad Mini"]);

  midi.listenFor([]);
  assert.deepStrictEqual(midi.status().listening, []);
  assert.strictEqual(t.ticks.length, 0, "and nothing is left ticking");
});

test("a port another program holds is said once, and tried again", () => {
  const driver = fakeDriver(["Launchpad"]);
  driver.busy = "Launchpad";
  const t = timers();
  const errors = [];
  const midi = createMidi(Object.assign({ driver, onError: (err) => errors.push(err.message) }, t.options));
  midi.listenFor([""]);
  t.ticks[0]();
  assert.deepStrictEqual(errors, ["Launchpad: the port is in use"]);
  driver.busy = null;
  t.ticks[0]();
  assert.deepStrictEqual(midi.status().listening, ["Launchpad"]);
  assert.strictEqual(midi.status().inputError, null);
});

test("Learn hears the next thing played on any port, keeps it from the widgets, and gives the ports back after", () => {
  const driver = fakeDriver(["Launchpad", "nanoKONTROL2"]);
  const t = timers();
  const midi = createMidi(Object.assign({ driver }, t.options));
  const moved = [];
  midi.onMessage((message) => moved.push(message.number));
  midi.listenFor(["launchpad"]);

  const learned = [];
  midi.learn((result) => learned.push(result));
  assert.deepStrictEqual(midi.status().listening.sort(), ["Launchpad", "nanoKONTROL2"], "every port, while learning");
  driver.play("nanoKONTROL2", [0xb2, 21, 64]);
  assert.deepStrictEqual(learned, [{ port: "nanoKONTROL2", heard: { type: "cc", channel: 3, number: 21, unit: 64 / 127 } }]);
  assert.deepStrictEqual(moved, [], "the knob being taught to a new widget does not also move an old one");
  assert.deepStrictEqual(midi.status().listening, ["Launchpad"], "and the controller is handed back to whoever else wants it");

  driver.play("Launchpad", [0xb0, 5, 1]);
  assert.deepStrictEqual(moved, [5]);

  // Nobody plays anything.
  midi.learn((result) => learned.push(result));
  t.waits[t.waits.length - 1]();
  assert.strictEqual(learned[1], null);

  // Called off.
  const stop = midi.learn((result) => learned.push(result));
  stop();
  assert.strictEqual(learned[2], null);
  assert.deepStrictEqual(midi.status().listening, ["Launchpad"]);
});

// ---- a page follows, and sends nothing on -----------------------------------------------------------

const { midiSource } = require("../lib/widgets/midi-source");
const standalone = require("../public/src/adapters/standalone");

/** What oscar_socket.js builds, as far as MIDI goes: play(heard, port) delivers a message. */
function midiHost() {
  const host = { listeners: [], wanted: {}, shared: [], sent: [] };
  host.onMidiIn = (fn) => {
    host.listeners.push(fn);
    return () => { host.listeners = host.listeners.filter((other) => other !== fn); };
  };
  host.wantMidi = (key, part) => {
    if (part === null) delete host.wanted[key];
    else host.wanted[key] = part;
  };
  host.shareState = (id, state, how) => host.shared.push([id, state, how]);
  host.sendOSC = (...args) => host.sent.push(args);
  host.play = (heard, port) => host.listeners.slice().forEach((fn) => fn(heard, port));
  return host;
}

test("MIDI's Data in is OSC's: the widget follows the knob, and what came in is never sent out", () => {
  const slider = byName["oscar-slider"];
  const config = Object.assign({}, slider.defaults, { min: 0, max: 100, midiListen: true, midiNumber: 7, midiEnabled: true, dmxEnabled: true });
  const host = midiHost();
  const el = { classList: { contains: () => false, add() {}, remove() {} } };
  const ctx = standalone.contextFor(el, config, host, "master", null, slider);

  const states = [];
  let answered = null;
  const stop = ctx.onShared((state) => {
    states.push(state);
    // A widget that tried to send what it was handed is refused by the host.
    ctx.send({ ip: "10.0.0.2", port: 7000, address: "/master", args: [] });
    answered = host.sent.length;
  });

  host.play({ type: "cc", channel: 1, number: 7, unit: 0.5 }, "nanoKONTROL2");
  assert.deepStrictEqual(states, [{ value: 50 }]);
  assert.strictEqual(answered, 0, "not as OSC, not as DMX, not as MIDI");
  assert.deepStrictEqual(host.shared, [["master", { value: 50 }, { heard: true }]], "kept for a device that joins later; nobody is told, since every page heard it");

  host.play({ type: "cc", channel: 1, number: 8, unit: 1 }, "nanoKONTROL2");
  assert.strictEqual(states.length, 1, "somebody else's knob");

  stop();
  host.play({ type: "cc", channel: 1, number: 7, unit: 1 }, "x");
  assert.strictEqual(states.length, 1);
  assert.deepStrictEqual(host.wanted, {}, "and the port is no longer asked for");
});

test("a page asks only for the inputs its widgets listen on, and keeps that up to date as they are edited", () => {
  const slider = byName["oscar-slider"];
  const host = midiHost();
  const config = Object.assign({}, slider.defaults, { midiListen: false, midiInPort: " Launchpad " });
  let changed = null;
  const source = midiSource(host, slider, "fader", () => config, () => ({}), (deliver) => deliver(), (fn) => { changed = fn; return () => {}; });
  source(() => {});
  assert.deepStrictEqual(host.wanted, {}, "Data in is off: no port is taken from anyone");

  config.midiListen = true;
  changed();
  assert.deepStrictEqual(host.wanted, { fader: "launchpad" });
  config.midiInPort = "";
  changed();
  assert.deepStrictEqual(host.wanted, { fader: "" }, "the first port there is");
  config.midiInPort = "All MIDI inputs";
  changed();
  assert.deepStrictEqual(host.wanted, { fader: "*" }, "every port, because somebody asked for every port");
  config.enabled = false;
  changed();
  assert.deepStrictEqual(host.wanted, {}, "the master switch makes it deaf");

  // A widget with no MIDI section, and a host that cannot hear, get nothing.
  assert.strictEqual(midiSource(host, byName["oscar-meter"], "m", () => ({}), null, (d) => d()), null);
  assert.strictEqual(midiSource({}, slider, "f", () => config, null, (d) => d()), null);
});

test("sending onward is a switch, and it is off", () => {
  const features = require("../lib/features");
  assert.strictEqual(features.MIDI_BRIDGE, false);
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /if \(features\.MIDI_BRIDGE\) surfaces\.hearMidi\(/, "the server drives published widgets only with the switch on");
  assert.match(server, /io\.emit\("midi:in", \{ heard, port, first \}\);/, "and tells the pages either way");
});

test("a blank In port is the first port, as a blank Out port is; every port has to be asked for in words", () => {
  const { inputWanted, ALL_INPUTS } = require("../lib/midi/spec");
  assert.strictEqual(ALL_INPUTS, "All MIDI inputs");
  for (const said of ["All MIDI inputs", " all midi INPUTS ", "*", "all"]) assert.strictEqual(inputWanted(said), "*", said);
  assert.deepStrictEqual(["", "  ", null, undefined].map(inputWanted), ["", "", "", ""]);
  assert.strictEqual(inputWanted(" nanoKONTROL "), "nanokontrol");

  const config = (midiInPort) => ({ enabled: true, midiListen: true, midiType: "cc", midiChannel: 1, midiNumber: 7, midiInPort });
  const heard = { type: "cc", channel: 1, number: 7, unit: 1 };
  // Two controllers open, because another widget asked for the second.
  assert.strictEqual(midiIndex(config(""), heard, "nanoKONTROL2", 1, true), 0, "the first port there is");
  assert.strictEqual(midiIndex(config(""), heard, "Launchpad Mini", 1, false), -1, "not the second, which was opened for somebody else");
  assert.strictEqual(midiIndex(config("All MIDI inputs"), heard, "Launchpad Mini", 1, false), 0);
  assert.strictEqual(midiIndex(config("launch"), heard, "Launchpad Mini", 1, false), 0);

  // And only the first is opened for it.
  const driver = fakeDriver(["nanoKONTROL2", "Launchpad Mini"]);
  const midi = createMidi(Object.assign({ driver }, timers().options));
  const from = [];
  midi.onMessage((message, port, first) => from.push([port, first]));
  midi.listenFor([""]);
  assert.deepStrictEqual(driver.log, ["open nanoKONTROL2"]);
  driver.play("nanoKONTROL2", [0xb0, 7, 1]);
  assert.deepStrictEqual(from, [["nanoKONTROL2", true]]);
});
