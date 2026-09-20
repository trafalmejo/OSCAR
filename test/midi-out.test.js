"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { midiMessages, midiRequest, sendsMidi } = require("../lib/midi/spec");
const { buildRequest } = require("../lib/midi/request");
const { createMidiOutput, RETRY_MS } = require("../lib/midi/output");
const { indexOfPort } = require("../lib/midi/driver");
const { createMidi } = require("../lib/midi");
const { WIDGETS } = require("../lib/widgets");
const { outgoing, only } = require("../lib/widgets/outgoing");
const { createSurfaces } = require("../lib/surfaces");
const { PublishedStore } = require("../lib/published");
const { exportAttributes } = require("../lib/export/config");

const midi = (extra) => Object.assign({ midiEnabled: true, midiPort: "", midiChannel: 1, midiType: "cc", midiNumber: 7 }, extra);

// ---- a gesture becomes bytes ---------------------------------------------------

test("a level becomes a controller, a note, a bend or a program, on the channel asked for", () => {
  assert.deepStrictEqual(midiMessages(midi(), 50, 0.5), [[0xb0, 7, 64]]);
  assert.deepStrictEqual(midiMessages(midi({ midiChannel: 10 }), 100, 1), [[0xb9, 7, 127]], "channel 10 is 9 on the wire");
  assert.deepStrictEqual(midiMessages(midi({ midiType: "note", midiNumber: 60 }), 1, 1), [[0x90, 60, 127]]);
  assert.deepStrictEqual(midiMessages(midi({ midiType: "note", midiNumber: 60 }), 0, 0), [[0x80, 60, 0]], "off is said as note off, not velocity 0");
  assert.deepStrictEqual(midiMessages(midi({ midiType: "pitch" }), 0, 0.5), [[0xe0, 0x00, 0x40]], "the middle of 14 bits: no bend");
  assert.deepStrictEqual(midiMessages(midi({ midiType: "pitch" }), 0, 1), [[0xe0, 0x7f, 0x7f]]);
});

test("a widget with several values takes the numbers that follow, and one that runs past 127 sends nothing", () => {
  assert.deepStrictEqual(midiMessages(midi({ midiNumber: 20 }), [0, 0], [0, 1]), [[0xb0, 20, 0], [0xb0, 21, 127]]);
  assert.deepStrictEqual(midiMessages(midi({ midiNumber: 126 }), [0, 0, 0], [1, 1, 1]), null, "half a colour is another colour");
});

test("a program is a position in a list: a whole number is sent as it is, anything else as a level", () => {
  const program = midi({ midiType: "program" });
  assert.deepStrictEqual(midiMessages(program, 3, 0.66), [[0xc0, 3]]);
  assert.deepStrictEqual(midiMessages(program, "12", 0.1), [[0xc0, 12]]);
  assert.deepStrictEqual(midiMessages(program, "Storm", 1), [[0xc0, 127]], "no number to send, so the level");
  assert.deepStrictEqual(midiMessages(program, 300, 0.5), [[0xc0, 64]], "out of range is not clipped into somebody else's program");
});

test("what cannot be worked out is silence, never number 0 on channel 1", () => {
  assert.strictEqual(midiMessages(midi({ midiChannel: 17 }), 0, 0.5), null);
  assert.strictEqual(midiMessages(midi({ midiChannel: "" }), 0, 0.5), null);
  assert.strictEqual(midiMessages(midi({ midiNumber: 128 }), 0, 0.5), null);
  assert.strictEqual(midiMessages(midi({ midiNumber: 1.5 }), 0, 0.5), null);
  assert.strictEqual(midiMessages(midi({ midiType: "sysex" }), 0, 0.5), null);
  assert.strictEqual(midiMessages(midi(), 0, undefined), null, "a widget that gave no level");
  assert.strictEqual(midiMessages(midi(), 0, 1.2), null);
  assert.strictEqual(sendsMidi({}), false, "off unless switched on");
  assert.deepStrictEqual(midiRequest(midi({ midiPort: "  Launchpad " }), 0, 0).port, "Launchpad");
});

// ---- the gate ------------------------------------------------------------------------

test("only whole, well-formed channel messages get past the gate", () => {
  assert.deepStrictEqual(buildRequest({ port: " IAC ", messages: [[0xb0, 7, 64], [0xc3, 5]] }), { port: "IAC", messages: [[0xb0, 7, 64], [0xc3, 5]] });
  assert.deepStrictEqual(buildRequest({ messages: [[0x90, 60, 1]] }).port, "", "no port named means the first there is");

  const bad = [
    null,
    "note on",
    { port: "x" },
    { port: "x", messages: [] },
    { port: 7, messages: [[0xb0, 7, 64]] },
    { port: "x".repeat(201), messages: [[0xb0, 7, 64]] },
    { port: "x", messages: [[0xb0, 7]] }, // a controller with no value
    { port: "x", messages: [[0xc0, 5, 0]] }, // a program with one byte too many
    { port: "x", messages: [[0xb0, 7, 128]] },
    { port: "x", messages: [[0xb0, 7, 1.5]] },
    { port: "x", messages: [[0x40, 7, 64]] }, // not a status byte
    { port: "x", messages: [[0xf0, 0x7e, 0x7f]] }, // system exclusive
    { port: "x", messages: [[0xfc]] }, // stop, to a sequencer
    { port: "x", messages: [[0xb0, 7, 64], [0xf8]] }, // one bad message spoils the request
    { port: "x", messages: new Array(17).fill([0xb0, 7, 64]) },
  ];
  for (const input of bad) assert.strictEqual(buildRequest(input), null, JSON.stringify(input).slice(0, 60));
});

// ---- the ports kept open ------------------------------------------------------------------

/** A driver whose ports are `names`, which can be changed, and which records everything. */
function fakeDriver(names) {
  const driver = {
    supported: true,
    names: names.slice(),
    opened: 0,
    wire: [],
    closed: [],
    failNext: false,
    outputs: () => driver.names.slice(),
    inputs: () => [],
    openOutput(wanted) {
      driver.opened++;
      const index = indexOfPort(driver.names, wanted);
      if (index === -1) return null;
      const name = driver.names[index];
      return {
        name,
        send(bytes) {
          if (driver.failNext) {
            driver.failNext = false;
            throw new Error("the device is not connected");
          }
          driver.wire.push([name, bytes]);
        },
        close: () => driver.closed.push(name),
      };
    },
  };
  return driver;
}

test("a port is found by its name, by part of it, or by being the first", () => {
  const names = ["Microsoft GS Wavetable Synth", "2- Launchpad Mini", "loopMIDI Port 1"];
  assert.strictEqual(indexOfPort(names, "loopMIDI Port 1"), 2);
  assert.strictEqual(indexOfPort(names, "launchpad"), 1, "Windows numbers a port by the socket it is in");
  assert.strictEqual(indexOfPort(names, ""), 0);
  assert.strictEqual(indexOfPort(names, "Resolume"), -1);
  assert.strictEqual(indexOfPort([], ""), -1);
});

test("a port is opened once and kept; a missing one is asked after only now and then, and said once", () => {
  const driver = fakeDriver(["Launchpad"]);
  let clock = 0;
  const events = [];
  const errors = [];
  const out = createMidiOutput(driver, { now: () => clock, onEvent: (e, name) => events.push(e + " " + name), onError: (err) => errors.push(err.message) });

  for (let i = 0; i < 5; i++) assert.strictEqual(out.send({ port: "Launchpad", messages: [[0xb0, 7, i]] }), true);
  assert.strictEqual(driver.opened, 1, "opening a port takes long enough to hear");
  assert.deepStrictEqual(events, ["open Launchpad"]);
  assert.strictEqual(driver.wire.length, 5);

  // A fader against a port that is not there: sixty sends a second.
  for (let i = 0; i < 60; i++) assert.strictEqual(out.send({ port: "Resolume", messages: [[0xb0, 7, i]] }), false);
  assert.strictEqual(driver.opened, 2, "listing the system's ports is slow; it is not done per move");
  assert.deepStrictEqual(errors, ['There is no MIDI port called "Resolume"'], "and nobody is told sixty times");

  // It is plugged in. The next look, after the wait, finds it.
  driver.names.push("Resolume Arena");
  clock += RETRY_MS;
  assert.strictEqual(out.send({ port: "Resolume", messages: [[0xb0, 7, 1]] }), true);
  assert.deepStrictEqual(out.status(), { open: ["Launchpad", "Resolume Arena"], sent: 6, dropped: 60, error: null });
});

test("a port unplugged mid-show is let go of, and found again when it comes back", () => {
  const driver = fakeDriver(["Launchpad"]);
  let clock = 0;
  const out = createMidiOutput(driver, { now: () => clock });
  out.send({ port: "", messages: [[0x90, 60, 100]] });

  driver.failNext = true;
  driver.names = [];
  assert.strictEqual(out.send({ port: "", messages: [[0x80, 60, 0]] }), false);
  assert.deepStrictEqual(driver.closed, ["Launchpad"]);
  assert.match(out.status().error, /not connected/);

  driver.names = ["Launchpad"];
  clock += RETRY_MS;
  assert.strictEqual(out.send({ port: "", messages: [[0x80, 60, 0]] }), true);
  assert.strictEqual(out.status().error, null);

  out.close();
  assert.deepStrictEqual(driver.closed, ["Launchpad", "Launchpad"], "quitting leaves no port held");
});

test("OSCAR with no MIDI driver refuses quietly, and a malformed request never reaches a port", () => {
  const none = createMidi({ driver: { supported: false, reason: "no native build" } });
  assert.strictEqual(none.send({ port: "", messages: [[0xb0, 7, 64]] }), false);
  assert.strictEqual(none.status().supported, false);

  const driver = fakeDriver(["Launchpad"]);
  const some = createMidi({ driver });
  assert.strictEqual(some.send({ port: "", messages: [[0xf0, 1, 2]] }), false);
  assert.strictEqual(driver.opened, 0);
  assert.strictEqual(some.send({ port: "", messages: [[0xb0, 7, 64]] }), true);
  assert.deepStrictEqual(driver.wire, [["Launchpad", [0xb0, 7, 64]]]);
});

// ---- the widgets -------------------------------------------------------------------------------

test("every widget that can drive DMX can send MIDI, off by default, with the kind of message that suits it", () => {
  const kinds = {};
  for (const widget of WIDGETS.filter((w) => w.dmx)) {
    const keys = widget.fields.map((f) => f.key);
    for (const key of ["midiEnabled", "midiPort", "midiChannel", "midiType", "midiNumber"]) {
      assert.ok(keys.includes(key), widget.name + " has " + key);
      assert.ok(key in widget.defaults, widget.name + " has a default for " + key);
    }
    assert.strictEqual(widget.defaults.midiEnabled, false, widget.name);
    assert.ok(widget.fields.filter((f) => /^midi/.test(f.key)).every((f) => f.section === "midi"));
    assert.strictEqual(typeof widget.checks.midiNumber, "function", widget.name);
    kinds[widget.name] = widget.defaults.midiType;
  }
  assert.deepStrictEqual(kinds, {
    "oscar-button": "note",
    "oscar-slider": "cc",
    "oscar-xypad": "cc",
    "oscar-colour": "cc",
    "oscar-dropdown": "program",
    "oscar-number-input": "cc",
  });
  // A widget with no level to send has no MIDI section.
  for (const widget of WIDGETS.filter((w) => !w.dmx)) assert.ok(!widget.fields.some((f) => f.section === "midi"), widget.name);
});

test("the settings panel refuses what the wire would refuse", () => {
  const colour = WIDGETS.find((w) => w.name === "oscar-colour");
  assert.strictEqual(colour.checks.midiNumber(20, {}), null);
  assert.match(colour.checks.midiNumber(126, {}), /3 values.*run past 127/);
  assert.match(colour.checks.midiNumber("x", {}), /whole number between 0 and 127/);
  assert.match(colour.checks.midiChannel(0, {}), /between 1 and 16/);
  assert.match(colour.checks.midiType("sysex", {}), /Unknown kind/);
  assert.strictEqual(colour.checks.midiPort("", {}), null);
});

test("MIDI is a third half of what a widget sends, beside OSC and DMX and independent of both", () => {
  const slider = WIDGETS.find((w) => w.name === "oscar-slider");
  const base = Object.assign({}, slider.defaults, { midiNumber: 7 });

  assert.strictEqual(outgoing(base, 50, 0.5).midi, undefined, "off by default");
  const all = outgoing(Object.assign({}, base, { midiEnabled: true, dmxEnabled: true }), 50, 0.5);
  assert.deepStrictEqual(all.midi, { port: "", messages: [[0xb0, 7, 64]] });
  assert.ok(all.address && all.dmx, "and the other two still go");

  const alone = outgoing(Object.assign({}, base, { midiEnabled: true, oscEnabled: false }), 50, 0.5);
  assert.deepStrictEqual(Object.keys(alone), ["midi"]);
  assert.strictEqual(outgoing(Object.assign({}, base, { midiEnabled: true, enabled: false }), 50, 0.5), null, "the master switch is over MIDI too");
  // A bad channel silences MIDI and nothing else.
  assert.deepStrictEqual(Object.keys(outgoing(Object.assign({}, base, { midiEnabled: true, midiChannel: 99 }), 50, 0.5)), ["ip", "port", "address", "args"]);
});

test("a pad sending two OSC messages still sends its MIDI once, with the DMX half", () => {
  const config = { enabled: true, oscEnabled: true, dmxEnabled: false, midiEnabled: true };
  assert.strictEqual(only(config, "osc").midiEnabled, false);
  const levels = only(config, "dmx");
  assert.deepStrictEqual([levels.oscEnabled, levels.dmxEnabled, levels.midiEnabled], [false, false, true]);
  assert.strictEqual(only({ enabled: true, oscEnabled: true }, "dmx"), null, "nothing to send there at all");

  const pad = WIDGETS.find((w) => w.name === "oscar-xypad");
  const driven = pad.drive(Object.assign({}, pad.defaults, { sendMode: "two", midiEnabled: true, midiNumber: 20 }), { x: pad.defaults.maxX, y: pad.defaults.minY });
  const halves = driven.messages.filter(Boolean);
  assert.strictEqual(halves.filter((m) => m.midi).length, 1);
  assert.strictEqual(halves.filter((m) => m.address).length, 2);
});

test("a schedule or a phone on the relay drives MIDI through the server, as it drives OSC and DMX", async () => {
  const button = WIDGETS.find((w) => w.name === "oscar-button");
  const config = Object.assign({}, button.defaults, { midiEnabled: true, midiNumber: 36, oscEnabled: false });
  const attributes = Object.assign({ id: "kick" }, exportAttributes("oscar-button", (key) => config[key]));
  const text = Object.entries(attributes).map(([k, v]) => k + "='" + String(v).replace(/'/g, "&#39;") + "'").join(" ");
  const published = new PublishedStore(fs.mkdtempSync(path.join(os.tmpdir(), "oscar-midi-")));
  await published.save("Stage", "<body><button " + text + ">Kick</button></body>");

  const sent = [];
  const surfaces = createSurfaces({ published, sendOSC: () => sent.push("osc"), sendDMX: () => sent.push("dmx"), sendMIDI: (request) => sent.push(request) });
  const result = await surfaces.drive("stage", "kick", { on: true });
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.deepStrictEqual(sent, [{ port: "", messages: [[0x90, 36, 127]] }]);
});

// ---- the editor ------------------------------------------------------------------------------------

test("the MIDI section is there while the switch is on, and gone, with nothing else, while it is off", () => {
  const { visibleFields } = require("../public/src/adapters/grapesjs");
  const slider = WIDGETS.find((w) => w.name === "oscar-slider");
  const sections = () => Array.from(new Set(visibleFields(slider, slider.defaults).map((f) => f.section || "widget")));

  assert.deepStrictEqual(sections(), ["widget", "osc", "dmx", "midi"]);
  global.window = { OSCAR_FEATURES: { MIDI: false } };
  try {
    assert.deepStrictEqual(sections(), ["widget", "osc", "dmx"]);
    // Hidden, not disarmed: a widget already set to send MIDI still does.
    assert.ok(outgoing(Object.assign({}, slider.defaults, { midiEnabled: true }), 50, 0.5).midi);
  } finally {
    delete global.window;
  }
});

test("the port settings are dropdowns: the first port, for listening every port, the ports there are, and the widget's own if it is unplugged", () => {
  const { suggest, choicesFor, toTrait } = require("../public/src/adapters/grapesjs");
  const slider = WIDGETS.find((w) => w.name === "oscar-slider");
  const inPort = slider.fields.find((f) => f.key === "midiInPort");
  const outPort = slider.fields.find((f) => f.key === "midiPort");
  assert.deepStrictEqual([inPort.type, outPort.type], ["select", "select"]);

  suggest("midi-inputs", ["nanoKONTROL2", "Launchpad Mini"]);
  suggest("midi-outputs", ["Launchpad Mini"]);
  const names = (field, value) => choicesFor(field, value).map((option) => option.name);
  assert.deepStrictEqual(names(inPort, ""), ["First port", "All MIDI inputs", "nanoKONTROL2", "Launchpad Mini"]);
  assert.deepStrictEqual(names(outPort, ""), ["First port", "Launchpad Mini"], "there is no sending to every port");
  assert.deepStrictEqual(toTrait(inPort, { midiInPort: "All MIDI inputs" }).options.length, 4, "a choice that is offered is not added again");

  // Unplugged for the night: still this widget's port, and shown as it is. A
  // dropdown that could not show it would show another, and the next edit would save that.
  const unplugged = choicesFor(inPort, "Faderfox");
  assert.deepStrictEqual(unplugged[unplugged.length - 1], { id: "Faderfox", name: "Faderfox (not connected)" });
});

test("the dropdown of the selected widget is redrawn when a port is plugged in, and not otherwise", () => {
  const { suggest } = require("../public/src/adapters/grapesjs");
  const slider = WIDGETS.find((w) => w.name === "oscar-slider");
  const values = Object.assign({ type: "oscar-slider" }, slider.defaults, { midiListen: true });
  let redrawn = 0;
  const model = { get: (k) => (k === "traits" ? model.traits : values[k]), set: (k, traits) => { if (k === "traits") { redrawn++; model.traits = traits; } } };
  const editor = { getSelected: () => model };

  suggest("midi-inputs", ["nanoKONTROL2"], editor);
  assert.strictEqual(redrawn, 1);
  const options = model.traits.find((t) => t.name === "midiInPort").options.map((o) => o.name);
  assert.ok(options.includes("nanoKONTROL2") && options.includes("All MIDI inputs"));
  assert.strictEqual(model.traits.find((t) => t.name === "midiInPort").category.open, true, "a section that is only listening stays open through it");

  suggest("midi-inputs", ["nanoKONTROL2"], editor);
  assert.strictEqual(redrawn, 1, "asked on every selection; redrawn only on a change");
  suggest("midi-inputs", ["nanoKONTROL2", "Launchpad Mini"], editor);
  assert.strictEqual(redrawn, 2);

  // A widget with no port settings is left alone.
  const meter = { get: (k) => (k === "type" ? "oscar-meter" : undefined), set: () => { redrawn = 99; } };
  suggest("midi-inputs", [], { getSelected: () => meter });
  assert.strictEqual(redrawn, 2);
});

test("GET /midi/ports names the ports for the editor, and for nobody a locked OSCAR would turn away", async () => {
  const express = require("express");
  const createRouter = require("../routes/index");
  const ask = async (locked, remote) => {
    const app = express();
    if (remote) {
      app.use((req, res, next) => {
        Object.defineProperty(req, "socket", { value: { remoteAddress: "192.168.1.55" }, writable: true });
        next();
      });
    }
    app.use("/", createRouter({ store: {}, serverIP: () => "192.168.0.5", lock: { isLocked: () => locked, setLocked: () => {} }, midiPorts: () => ({ supported: true, reason: null, outputs: ["Launchpad"], inputs: [] }) }));
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    try {
      const res = await fetch("http://127.0.0.1:" + server.address().port + "/midi/ports");
      return [res.status, res.ok ? (await res.json()).outputs : null];
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };
  assert.deepStrictEqual(await ask(false, true), [200, ["Launchpad"]]);
  assert.deepStrictEqual(await ask(true, false), [200, ["Launchpad"]]);
  assert.strictEqual((await ask(true, true))[0], 403);
});
