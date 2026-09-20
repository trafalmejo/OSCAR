"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { widgetsIn, createSurfaces } = require("../lib/surfaces");
const { PublishedStore } = require("../lib/published");
const { SharedState } = require("../lib/shared-state");
const { exportAttributes } = require("../lib/export/config");
const { byName, WIDGETS } = require("../lib/widgets");

/** A widget's markup as the export writes it: settings in a quoted, escaped attribute. */
function tag(name, id, settings, inner) {
  const definition = byName[name];
  const config = Object.assign({}, definition.defaults, settings);
  const attributes = exportAttributes(name, (key) => config[key]);
  const text = Object.entries(Object.assign(id ? { id } : {}, attributes))
    .map(([key, value]) => key + '="' + String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"')
    .join(" ");
  return "<" + definition.tag + " " + text + ">" + (inner || "") + "</" + definition.tag + ">";
}

const PAGE =
  "<!doctype html><html><body>" +
  tag("oscar-button", "house", { label: "House lights", message: "/house", ip: "10.0.0.9", port: 9000, mode: "toggle", valueOn: "1", valueOff: "0" }, "House lights") +
  tag("oscar-slider", "dim", { message: "/dim", min: 0, max: 100, dmxEnabled: true, dmxChannel: 12, dmxUniverse: 3 }) +
  tag("oscar-dropdown", "scene", { message: "/scene", options: "Sunrise=1, Storm=2", value: "1", argType: "i" }) +
  tag("oscar-number-input", "bpm", { message: "/bpm", min: 20, max: 300, step: 1, value: 120, argType: "i" }) +
  tag("oscar-slider", "off", { message: "/off", enabled: false }) +
  tag("oscar-meter", "level", { message: "/level" }) +
  tag("oscar-slider", "", { message: "/no-id" }) +
  '<div id="broken" data-oscar="oscar-slider" data-oscar-config="{not json">' +
  "</body></html>";

async function setUp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-surfaces-"));
  const published = new PublishedStore(dir);
  await published.save("Lobby", PAGE);
  const osc = [];
  const dmx = [];
  const told = [];
  const shared = { store: new SharedState() };
  const surfaces = createSurfaces({
    published,
    sendOSC: (ip, port, address, args) => osc.push({ ip, port, address, args }),
    sendDMX: (request) => dmx.push(request),
    shared,
    io: { emit: (event, payload) => told.push([event, payload]) },
  });
  return { surfaces, published, osc, dmx, told, shared };
}

test("the widgets that can be driven are read off the published page, by id", () => {
  const found = widgetsIn(PAGE);
  // Not the meter (it has no drive), not the one with no id, not the broken one.
  assert.deepStrictEqual(found.map((w) => [w.id, w.widget]), [
    ["house", "oscar-button"],
    ["dim", "oscar-slider"],
    ["scene", "oscar-dropdown"],
    ["bpm", "oscar-number-input"],
    ["off", "oscar-slider"],
  ]);
  assert.strictEqual(found[0].name, "House lights");
  assert.strictEqual(found[1].name, "Slider /dim", "with no label, what it sends to");
  assert.deepStrictEqual(found[0].input, { kind: "on" });
  assert.deepStrictEqual(found[1].input, { kind: "value", min: 0, max: 100, step: null });
  assert.deepStrictEqual(found[2].input, { kind: "choice", options: [{ label: "Sunrise", value: "1" }, { label: "Storm", value: "2" }] });
  assert.deepStrictEqual(found[3].input, { kind: "value", min: 20, max: 300, step: 1 });
  assert.deepStrictEqual(widgetsIn(""), []);
  assert.deepStrictEqual(widgetsIn(null), []);
});

test("what a caller is told about a widget never includes where it sends", async () => {
  const { surfaces } = await setUp();
  const listed = await surfaces.list();
  assert.deepStrictEqual(listed.map((s) => s.id), ["lobby"]);
  const widgets = await surfaces.widgets("lobby");
  assert.deepStrictEqual(Object.keys(widgets[0]).sort(), ["id", "input", "name", "widget"]);
  assert.ok(!JSON.stringify(widgets).includes("10.0.0.9"));
  assert.strictEqual(await surfaces.widgets("nowhere"), null);
});

test("driving a widget sends what a finger would, to where the surface says", async () => {
  const { surfaces, osc, dmx, told, shared } = await setUp();

  assert.deepStrictEqual(await surfaces.drive("lobby", "house", { on: true }), { ok: true, state: { on: true }, sent: true });
  assert.deepStrictEqual(osc[0], { ip: "10.0.0.9", port: 9000, address: "/house", args: [{ type: "i", value: 1 }] });

  // A fader on OSC and DMX at once: both leave, and the DMX names its widget,
  // so its channels are released with it like any other.
  await surfaces.drive("lobby", "dim", { value: 50 });
  assert.strictEqual(osc[1].address, "/dim");
  assert.deepStrictEqual(dmx[0], { source: "dim", protocol: "artnet", host: "", universe: 3, channel: 12, levels: [128] });

  // Every tablet showing the surface follows.
  assert.deepStrictEqual(told[0], ["state:changed", { id: "house", state: { on: true } }]);
  assert.deepStrictEqual(shared.store.snapshot().dim, { value: 50 });

  // The same state again is sent again (a cue is a cue) but is no news to the tablets.
  const before = told.length;
  await surfaces.drive("lobby", "house", { on: true });
  assert.strictEqual(osc.length, 3);
  assert.strictEqual(told.length, before);
});

test("a value is held to the widget's own range and choices, whoever asks", async () => {
  const { surfaces, osc } = await setUp();
  assert.deepStrictEqual((await surfaces.drive("lobby", "dim", { value: 99999 })).state, { value: 100 });
  assert.deepStrictEqual((await surfaces.drive("lobby", "dim", { value: -5 })).state, { value: 0 });
  assert.deepStrictEqual((await surfaces.drive("lobby", "bpm", { value: 120.6 })).state, { value: 121 });
  assert.deepStrictEqual((await surfaces.drive("lobby", "scene", { value: "2" })).state, { value: "2" });
  const sent = osc.length;

  for (const [id, state] of [["scene", { value: "9" }], ["dim", { value: "loud" }], ["dim", {}], ["dim", null], ["house", { on: "yes" }], ["house", { value: 1 }]]) {
    const result = await surfaces.drive("lobby", id, state);
    assert.strictEqual(result.ok, false, id + " " + JSON.stringify(state));
    assert.match(result.reason, /cannot be set to that/);
  }
  assert.strictEqual(osc.length, sent, "and nothing went out for any of them");
});

test("nothing a caller adds to the state can change where a message goes", async () => {
  const { surfaces, osc, dmx } = await setUp();
  const hostile = { value: 10, ip: "192.168.1.1", port: 22, message: "/elsewhere", address: "/elsewhere", dmxChannel: 1, dmxUniverse: 0, dmxHost: "10.9.9.9", enabled: true, config: { ip: "6.6.6.6" } };
  const result = await surfaces.drive("lobby", "dim", hostile);
  assert.deepStrictEqual(result.state, { value: 10 }, "only the value is taken from it");
  assert.deepStrictEqual([osc[0].ip, osc[0].port, osc[0].address], ["localhost", 7000, "/dim"]);
  assert.deepStrictEqual([dmx[0].universe, dmx[0].channel, dmx[0].host], [3, 12, ""]);

  // Nor can it reach a widget that is not on the surface, or is not drivable.
  for (const id of ["level", "broken", "__proto__", "constructor", "", undefined]) {
    assert.strictEqual((await surfaces.drive("lobby", id, { value: 1 })).ok, false, String(id));
  }
  assert.strictEqual((await surfaces.drive("../../etc", "dim", { value: 1 })).ok, false);
  assert.strictEqual(osc.length, 1);
});

test("a widget that is switched off shows the state and sends nothing", async () => {
  const { surfaces, osc, shared } = await setUp();
  assert.deepStrictEqual(await surfaces.drive("lobby", "off", { value: 40 }), { ok: true, state: { value: 40 }, sent: false });
  assert.strictEqual(osc.length, 0);
  assert.deepStrictEqual(shared.store.snapshot().off, { value: 40 });
});

test("publishing again is picked up, without reading the page on every call", async () => {
  const { surfaces, published } = await setUp();
  let reads = 0;
  const read = published.read.bind(published);
  published.read = (id) => { reads += 1; return read(id); };
  await surfaces.widgets("lobby");
  await surfaces.widgets("lobby");
  await surfaces.drive("lobby", "dim", { value: 1 });
  assert.strictEqual(reads, 1);

  await new Promise((resolve) => setTimeout(resolve, 20));
  await published.save("Lobby", PAGE.replace('id="dim"', 'id="dimmer"'));
  assert.ok((await surfaces.widgets("lobby")).some((w) => w.id === "dimmer"));
  assert.strictEqual(reads, 2);
});

test("drive and driveInput come as a pair, and drive never sends or stores", () => {
  for (const widget of WIDGETS) {
    assert.strictEqual(typeof widget.drive, typeof widget.driveInput, widget.name + " has one without the other");
    if (!widget.drive) continue;
    assert.ok(widget.sends, widget.name + " is driven but says it sends nothing");
    const config = Object.freeze(Object.assign({}, widget.defaults));
    const input = widget.driveInput(config);
    // Frozen settings: a drive() that stored anything would throw here.
    const first = {
      on: () => ({ on: true }),
      value: () => ({ value: input.min === null ? 0 : input.min }),
      choice: () => ({ value: input.options[0].value }),
      position: () => ({ x: input.minX, y: input.minY }),
      colour: () => ({ value: "#336699" }),
      text: () => ({ value: "hello" }),
    };
    assert.ok(first[input.kind], widget.name + " asks for a kind of input nothing knows how to offer: " + input.kind);
    const state = first[input.kind]();
    const driven = widget.drive(config, state);
    assert.ok(driven && driven.state && ("message" in driven || Array.isArray(driven.messages)), widget.name + " could not be driven to its own first value");
  }
});

test("every widget that sends can be driven, so a phone on a relay is never stuck with half a surface", () => {
  const stuck = WIDGETS.filter((w) => w.sends && typeof w.drive !== "function").map((w) => w.name);
  assert.deepStrictEqual(stuck, []);
});

test("a pad, a colour, a line of text and a tile, driven", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-surfaces-"));
  const published = new PublishedStore(dir);
  await published.save(
    "Stage",
    "<body>" +
      tag("oscar-xypad", "pan", { message: "/pos", sendMode: "two", minX: 0, maxX: 1, minY: 0, maxY: 1 }) +
      tag("oscar-colour", "wash", { message: "/wash", format: "hex" }) +
      tag("oscar-text-input", "caption", { message: "/caption", argType: "s" }) +
      tag("oscar-media-browser", "clips", { message: "/clip", items: "Forest|7; Waves|12", argType: "i" }) +
      "</body>"
  );
  const osc = [];
  const surfaces = createSurfaces({ published, sendOSC: (ip, port, address, args) => osc.push([address, args.map((a) => a.value)]), sendDMX: () => {} });

  assert.deepStrictEqual((await surfaces.widgets("stage")).map((w) => w.input.kind), ["position", "colour", "text", "choice"]);

  // A pad sending its axes apart sends both, in order, each held to its range.
  assert.deepStrictEqual((await surfaces.drive("stage", "pan", { x: 7, y: 0.25 })).state, { x: 1, y: 0.25 });
  assert.deepStrictEqual(osc.splice(0), [["/pos/x", [1]], ["/pos/y", [0.25]]]);
  assert.strictEqual((await surfaces.drive("stage", "pan", { x: 0.5 })).ok, false, "half a position is not a position");

  assert.deepStrictEqual((await surfaces.drive("stage", "wash", { value: "#F80" })).state, { value: "#ff8800" });
  assert.deepStrictEqual(osc.splice(0), [["/wash", ["#ff8800"]]]);
  assert.strictEqual((await surfaces.drive("stage", "wash", { value: "javascript:alert(1)" })).ok, false);

  assert.strictEqual((await surfaces.drive("stage", "caption", { value: "Doors at eight" })).ok, true);
  assert.deepStrictEqual(osc.splice(0), [["/caption", ["Doors at eight"]]]);
  for (const bad of ["", "   ", "x".repeat(201), 42, null]) assert.strictEqual((await surfaces.drive("stage", "caption", { value: bad })).ok, false, String(bad).slice(0, 12));

  assert.deepStrictEqual((await surfaces.drive("stage", "clips", { value: 12 })).state, { value: "12" });
  assert.deepStrictEqual(osc.splice(0), [["/clip", [12]]]);
  assert.strictEqual((await surfaces.drive("stage", "clips", { value: "99" })).ok, false, "only a tile the surface has");
  assert.deepStrictEqual(osc, []);
});
