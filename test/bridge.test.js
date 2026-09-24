"use strict";

// The bridge: a widget whose Send when also fires on data in
// (lib/widgets/bridge.js). What it promises: the sending happens once, from
// whoever serves the surface; the guard passes on only changes; the ceiling
// holds a loop with the guard off; and by default nothing bridges, so every
// surface made before the setting existed behaves exactly as it did.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { byName } = require("../lib/widgets");
const { bridgePlan, BRIDGE_CEILING } = require("../lib/widgets/bridge");
const { createSurfaces } = require("../lib/surfaces");
const { PublishedStore } = require("../lib/published");
const { SharedState } = require("../lib/shared-state");
const { exportAttributes, readWidget } = require("../lib/export/config");
const { checkSendWhen } = require("../lib/widgets/fields");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

function tag(name, id, settings) {
  const definition = byName[name];
  const config = Object.assign({}, definition.defaults, settings);
  const attributes = Object.assign({ id }, exportAttributes(name, (key) => config[key]));
  const text = Object.entries(attributes)
    .map(([k, v]) => k + '="' + String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"')
    .join(" ");
  return "<" + definition.tag + " " + text + "></" + definition.tag + ">";
}

async function stage(widgets) {
  const published = new PublishedStore(fs.mkdtempSync(path.join(os.tmpdir(), "oscar-bridge-")));
  await published.save("Stage", "<body>" + widgets.join("") + "</body>");
  const sent = { osc: [], dmx: [], midi: [] };
  const told = [];
  let clock = 0;
  const surfaces = createSurfaces({
    published,
    sendOSC: (ip, port, address, args) => sent.osc.push([ip, port, address, args.map((a) => a.value)]),
    sendDMX: (request) => sent.dmx.push([request.source, request.levels]),
    sendMIDI: (request) => sent.midi.push(request),
    shared: { store: new SharedState() },
    io: { emit: (event, payload) => told.push([payload.id, payload.state]) },
    now: () => clock,
  });
  return { surfaces, sent, told, tick: (ms) => (clock += ms) };
}

const osc = (address, ...values) => ({ address, args: values.map((value) => ({ type: "f", value })) });

// ---- the setting itself --------------------------------------------------------------------

test("every widget with a way out carries Send when per protocol, defaulting to the user alone, guard on", () => {
  for (const name of Object.keys(byName)) {
    const widget = byName[name];
    const keys = widget.fields.map((f) => f.key);
    const sendsOsc = keys.includes("oscEnabled");
    assert.strictEqual(keys.includes("oscSendWhen"), sendsOsc, name + ": Send when goes exactly where a way out is");
    assert.strictEqual(keys.includes("oscLoopGuard"), sendsOsc, name);
    assert.strictEqual(keys.includes("midiSendWhen"), keys.includes("midiEnabled"), name);
    assert.strictEqual(keys.includes("dmxSendWhen"), keys.includes("dmxEnabled"), name);
    assert.ok(!keys.includes("dmxLoopGuard"), name + ": nothing comes in over DMX, so no guard");
    if (sendsOsc) {
      assert.strictEqual(widget.defaults.oscSendWhen, "user", name);
      assert.strictEqual(widget.defaults.oscLoopGuard, true, name);
    }
    assert.strictEqual(bridgePlan(widget.defaults), null, name + " does not bridge by default");
  }
  assert.strictEqual(checkSendWhen("user"), null);
  assert.strictEqual(checkSendWhen("data"), null);
  assert.match(checkSendWhen("sometimes"), /Send when/);
  assert.deepStrictEqual(bridgePlan({ oscSendWhen: "data" }), { osc: true, midi: false, dmx: false });
  assert.strictEqual(bridgePlan(null), null);
});

test("a page published before the setting existed still reads, as it always behaved", () => {
  const definition = byName["oscar-slider"];
  const config = Object.assign({}, definition.defaults, { listen: true });
  const attributes = exportAttributes("oscar-slider", (key) => config[key]);
  const settings = JSON.parse(attributes["data-oscar-config"]);
  for (const key of ["oscSendWhen", "oscLoopGuard", "midiSendWhen", "midiLoopGuard", "dmxSendWhen"]) delete settings[key];
  const el = {
    getAttribute: (name) =>
      name === "data-oscar" ? "oscar-slider" : name === "data-oscar-config" ? JSON.stringify(settings) : null,
  };
  const back = readWidget(el);
  assert.ok(back && !back.problem, JSON.stringify(back && back.problem));
  assert.strictEqual(back.config.oscSendWhen, "user", "the value that means: as it always was");
  assert.strictEqual(back.config.oscLoopGuard, true);
  assert.strictEqual(bridgePlan(back.config), null);
  // A key that is genuinely old is still damage.
  const damaged = Object.assign({}, settings);
  delete damaged.min;
  const el2 = {
    getAttribute: (name) =>
      name === "data-oscar" ? "oscar-slider" : name === "data-oscar-config" ? JSON.stringify(damaged) : null,
  };
  assert.match(readWidget(el2).problem, /has no "min"/);
});

// ---- OSC in, bridged out -------------------------------------------------------------------

test("OSC in drives a bridging widget as a hand would: translated, recorded, told, and only the halves its combos name", async () => {
  const { surfaces, sent, told } = await stage([
    tag("oscar-slider", "opacity", {
      message: "/sensor/near",
      ip: "10.0.0.9",
      port: 7000,
      min: 0,
      max: 1,
      listen: true,
      oscSendWhen: "data",
      dmxEnabled: true,
      dmxChannel: 4,
    }),
    tag("oscar-slider", "shy", { message: "/sensor/near", min: 0, max: 1, listen: true }),
  ]);
  assert.strictEqual(await surfaces.hearOsc(osc("/sensor/near", 0.5)), 2, "the bridge is driven; the plain listener is recorded, as ever");
  assert.deepStrictEqual(sent.osc, [["10.0.0.9", 7000, "/sensor/near", [0.5]]], "out through the widget's own settings, and only the bridge's");
  assert.deepStrictEqual(sent.dmx, [], "DMX's combo still says user only");
  assert.deepStrictEqual(sent.midi, []);
  assert.deepStrictEqual(told, [["opacity", { value: 0.5 }], ["shy", { value: 0.5 }]], "every device sees both move");

  // The guard: the same value again moves nothing and sends nothing.
  assert.strictEqual(await surfaces.hearOsc(osc("/sensor/near", 0.5)), 0, "unchanged everywhere");
  assert.strictEqual(sent.osc.length, 1);
  // A new value goes out again.
  await surfaces.hearOsc(osc("/sensor/near", 0.75));
  assert.strictEqual(sent.osc.length, 2);
});

test("with the guard unticked a repeat is the event and goes out; the ceiling still holds the floor", async () => {
  const { surfaces, sent, tick } = await stage([
    tag("oscar-button", "go", {
      message: "/go",
      mode: "toggle",
      listen: true,
      oscSendWhen: "data",
      oscLoopGuard: false,
    }),
  ]);
  await surfaces.hearOsc(osc("/go", 1));
  await surfaces.hearOsc(osc("/go", 1));
  await surfaces.hearOsc(osc("/go", 1));
  assert.strictEqual(sent.osc.length, 3, "three arrivals, three sends: a repeat is the event");

  for (let i = 0; i < BRIDGE_CEILING + 50; i++) await surfaces.hearOsc(osc("/go", 1));
  assert.strictEqual(sent.osc.length, BRIDGE_CEILING, "no widget bridges past the ceiling in one second");
  tick(1100);
  await surfaces.hearOsc(osc("/go", 1));
  assert.strictEqual(sent.osc.length, BRIDGE_CEILING + 1, "a new second is a new allowance");
});

test("OSC in reaches MIDI out and DMX out through their own combos, and never the protocols left on user", async () => {
  const { surfaces, sent } = await stage([
    tag("oscar-slider", "wash", {
      message: "/wash",
      min: 0,
      max: 127,
      listen: true,
      oscSendWhen: "user",
      dmxEnabled: true,
      dmxChannel: 10,
      dmxSendWhen: "data",
      midiEnabled: true,
      midiSendWhen: "data",
      midiNumber: 20,
    }),
  ]);
  assert.strictEqual(await surfaces.hearOsc(osc("/wash", 127)), 1);
  assert.deepStrictEqual(sent.osc, [], "OSC's own combo says user only");
  assert.deepStrictEqual(sent.dmx, [["wash", [255]]]);
  assert.strictEqual(sent.midi.length, 1);
});

// ---- where the pieces live -----------------------------------------------------------------

test("the editor confirms only the pair that can loop, same protocol both ways, and Undo puts the setting back", () => {
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /\{ input: "listen", when: "oscSendWhen", protocol: "OSC" \}/);
  assert.match(editor, /\{ input: "midiListen", when: "midiSendWhen", protocol: "MIDI" \}/);
  assert.ok(!editor.includes("dmxSendWhen"), "DMX has no way in, so no question, and a cross-protocol bridge asks nothing");
  assert.match(editor, /editor\.getSelected\(\) !== model/, "a project loading is not a hand in the panel");
  assert.match(editor, /beforePairs\.indexOf\(candidate\) === -1/, "only a pair this very change created asks");
  assert.match(editor, /title: "This can loop"/);
  assert.match(editor, /model\.set\(changed, before\)/, "Undo reverts the very setting that was changed");
});

test("the export dialog says a file bridges for itself, one copy only; the features switch is gone", () => {
  assert.match(read("public/partials/export.ejs"), /one copy<\/strong> only: every\s+open copy sends/);
  assert.ok(!read("lib/features.js").includes("MIDI_BRIDGE"), "the global switch is retired");
  assert.ok(!read("server.js").includes("MIDI_BRIDGE"));
});
