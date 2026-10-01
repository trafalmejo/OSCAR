"use strict";

// installation_map (lib/mcp/installation.js): the installation as OSCAR
// knows it, for an assistant. Worked out from the published interfaces'
// settings and this computer's own ports; nothing is sent to make it.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { installationMap, FTDI } = require("../lib/mcp/installation");
const { buildTools } = require("../lib/mcp/tools");
const { byName } = require("../lib/widgets");
const { exportAttributes } = require("../lib/export/config");
const { PublishedStore } = require("../lib/published");
const { lanAddresses } = require("../lib/net");

/** A control as a published page holds it: the widget's defaults, and what was set. */
const control = (widget, id, settings) => ({ id, widget, config: Object.assign({}, byName[widget].defaults, settings) });

const here = {
  addresses: [{ name: "Ethernet", address: "192.168.1.10", virtual: false }],
  ports: { http: 8080, socket: 8081 },
  oscIn: { port: 8880, listening: true, why: null },
  midi: { supported: true, outputs: ["LPD8"], inputs: ["LPD8"] },
  serialPorts: [{ path: "COM3", manufacturer: "FTDI", vendorId: "0403" }],
};

test("every destination, with the controls behind it: OSC by host and port, MIDI by port, DMX by output and universe", () => {
  const map = installationMap(
    Object.assign({}, here, {
      surfaces: [
        {
          id: "stage",
          name: "Stage",
          access: "network",
          widgets: [
            control("oscar-slider", "dim", { message: "/dim", ip: "192.168.1.50", port: 7000, dmxEnabled: true, dmxProtocol: "artnet", dmxUniverse: 0, dmxChannel: 1, dmxCount: 3 }),
            control("oscar-button", "go", { message: "/go", ip: "192.168.1.50", port: 7000, midiEnabled: true, midiPort: "LPD8", midiChannel: 2, midiType: "note", midiNumber: 36 }),
            control("oscar-button", "local", { message: "/local" }),
            control("oscar-meter", "level", { message: "/level", listen: true, midiListen: true, midiInPort: "LPD8", midiNumber: 7 }),
            control("oscar-button", "quiet", { message: "/quiet", oscEnabled: false }),
          ],
        },
        { id: "lobby", name: "Lobby", access: "off", widgets: [control("oscar-colour", "wash", { message: "/wash", ip: "192.168.1.50", port: 7000, dmxEnabled: true, dmxProtocol: "usbpro", dmxHost: "", dmxChannel: 10 })] },
      ],
    })
  );

  assert.deepStrictEqual(map.interfaces, [
    { id: "stage", name: "Stage", access: "network", controls: 5 },
    { id: "lobby", name: "Lobby", access: "off", controls: 1 },
  ], "one that is switched off is still part of the installation: its bridges run");

  const resolume = map.talksTo.osc.find((t) => t.to === "192.168.1.50:7000");
  assert.deepStrictEqual(resolume.controls.map((c) => [c.interface, c.control, c.address]), [["stage", "dim", "/dim"], ["stage", "go", "/go"], ["lobby", "wash", "/wash"]], "one destination, every control that sends to it, whichever interface it is on");
  assert.strictEqual(resolume.thisComputer, false);
  const local = map.talksTo.osc.find((t) => t.host === "localhost");
  assert.ok(local && local.thisComputer, "localhost is said to be this computer");
  const own = installationMap(Object.assign({}, here, { surfaces: [{ id: "s", widgets: [control("oscar-button", "b", { message: "/b", ip: "192.168.1.10", port: 7000 })] }] }));
  assert.strictEqual(own.talksTo.osc[0].thisComputer, true, "and so is this computer's own network address");
  assert.ok(!map.talksTo.osc.some((t) => t.controls.some((c) => c.control === "quiet")), "OSC switched off on a control is not a destination");
  assert.ok(!map.talksTo.osc.some((t) => t.controls.some((c) => c.control === "level")), "a meter sends nothing");

  assert.deepStrictEqual(map.talksTo.midi, [{ port: "LPD8", controls: [{ channel: 2, type: "note", number: 36, interface: "stage", name: "Stage", control: "go", widget: "oscar-button" }] }]);
  assert.deepStrictEqual(map.listensFor.osc.map((f) => [f.address, f.controls[0].control]), [["/level", "level"]]);
  assert.strictEqual(map.listensFor.midi[0].port, "LPD8");

  const artnet = map.talksTo.dmx.find((d) => d.protocol === "artnet");
  assert.strictEqual(artnet.universe, 0);
  assert.strictEqual(artnet.node, "(broadcast: every node)");
  assert.strictEqual(artnet.controls[0].channels, "1-3", "the block a control drives: first channel and how many");
  const usb = map.talksTo.dmx.find((d) => d.protocol === "usbpro");
  assert.strictEqual(usb.interface, "(first USB DMX interface)");
  assert.strictEqual(usb.controls[0].channels, "10-12", "a colour is three channels");
  assert.strictEqual(usb.universe, undefined, "a USB interface carries one universe, so none is named");

  assert.deepStrictEqual(map.computer.usb, [{ port: "COM3", maker: "FTDI", likelyDmx: true }]);
  assert.strictEqual(FTDI, "0403");
  assert.deepStrictEqual(map.computer.oscIn, { port: 8880, listening: true });
  assert.deepStrictEqual(map.notices, [], "nothing here fails to add up");
  assert.match(map.note, /Nothing was sent onto the network/);
});

test("what does not add up is said: a port that is not there, OSC followed while deaf, channels driven twice", () => {
  const map = installationMap({
    addresses: [],
    ports: {},
    oscIn: { port: 8880, listening: false, why: "is already in use" },
    midi: { supported: true, outputs: ["LPD8"], inputs: [] },
    serialPorts: [],
    surfaces: [
      {
        id: "a",
        name: "A",
        widgets: [
          control("oscar-slider", "one", { message: "/one", listen: true, midiEnabled: true, midiPort: "Gone", dmxEnabled: true, dmxProtocol: "sacn", dmxUniverse: 1, dmxChannel: 1, dmxCount: 4 }),
          control("oscar-slider", "two", { message: "/two", midiListen: true, midiInPort: "Missing In", dmxEnabled: true, dmxProtocol: "sacn", dmxUniverse: 1, dmxChannel: 4 }),
          control("oscar-slider", "three", { message: "/three", midiListen: true, midiInPort: "All MIDI inputs", dmxEnabled: true, dmxProtocol: "sacn", dmxUniverse: 2, dmxChannel: 4 }),
          control("oscar-slider", "usb", { message: "/usb", dmxEnabled: true, dmxProtocol: "opendmx", dmxHost: "COM7", dmxChannel: 1 }),
        ],
      },
    ],
  });
  const said = map.notices.join("\n");
  assert.match(said, /"one" on "A" follows OSC at \/one, but OSCAR is not listening for OSC \(port 8880 is already in use\)\./);
  assert.match(said, /"one" on "A" sends MIDI to "Gone", which this computer does not have right now\./);
  assert.match(said, /"two" on "A" follows MIDI from "Missing In"/);
  assert.ok(!/"three" on "A" follows MIDI/.test(said), "All MIDI inputs is a choice, not a missing port");
  assert.match(said, /"one" on "A" and "two" on "A" both drive sACN universe 1, channel 4: whichever moved last decides the level\./);
  assert.ok(!/"three" on "A" and/.test(said) && !/and "three" on "A"/.test(said), "another universe is another output");
  assert.match(said, /"usb" on "A" sends DMX over USB, but no USB interface is plugged in\./);
  assert.deepStrictEqual(map.computer.oscIn, { port: 8880, listening: false, why: "is already in use" });

  const plugged = installationMap({ serialPorts: [{ path: "COM3", vendorId: "0403" }], surfaces: [{ id: "a", widgets: [control("oscar-slider", "usb", { message: "/usb", dmxEnabled: true, dmxProtocol: "opendmx", dmxHost: "COM7" })] }] });
  assert.match(plugged.notices.join("\n"), /sends DMX to the USB interface "COM7", which is not plugged in\./);
  assert.deepStrictEqual(installationMap({}).notices, [], "an OSCAR with nothing published has nothing to notice");
});

test("the tool reads the published interfaces and the computer, and a failing port list does not fail it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-map-"));
  const published = new PublishedStore(path.join(dir, "published"));
  const definition = byName["oscar-slider"];
  const config = Object.assign({}, definition.defaults, { message: "/dim", ip: "10.0.0.5", port: 9000 });
  const attributes = Object.assign({ id: "dim" }, definition.attributes || {}, exportAttributes("oscar-slider", (key) => config[key]));
  const tag = "<" + definition.tag + " " + Object.entries(attributes).map(([k, v]) => k + '="' + String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"').join(" ") + ">";
  await published.save("Stage", "<!doctype html><html><head><title>Stage</title></head><body>" + tag + "</body></html>");

  const tools = buildTools({
    published,
    httpPort: () => 8080,
    socketPort: () => 8081,
    oscInPort: () => 8880,
    midi: { ports: () => ({ supported: true, outputs: [], inputs: [] }) },
    addresses: () => [{ name: "Wi-Fi", address: "10.0.0.2", virtual: false }],
    oscIn: () => ({ port: 8880, listening: true, why: null }),
    serialPorts: async () => {
      throw new Error("no serial driver");
    },
  });
  const tool = tools.find((t) => t.name === "installation_map");
  assert.strictEqual(tool.annotations.readOnlyHint, true, "it only looks");
  assert.match(tool.description, /sends nothing onto\s+the network/, "and says it sends nothing");

  const map = await tool.handler({});
  assert.deepStrictEqual(map.computer.addresses, [{ name: "Wi-Fi", address: "10.0.0.2", virtual: false }]);
  assert.deepStrictEqual(map.computer.ports, { http: 8080, socket: 8081 });
  assert.deepStrictEqual(map.computer.usb, []);
  assert.strictEqual(map.talksTo.osc[0].to, "10.0.0.5:9000");
  assert.strictEqual(map.talksTo.osc[0].controls[0].control, "dim");

  // And nothing in it reaches for the wire: no socket, no send, no poll.
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "mcp", "installation.js"), "utf8");
  for (const forbidden of ["dgram", "createSocket", ".send(", "fetch(", "net.connect", "child_process"]) {
    assert.ok(source.indexOf(forbidden) === -1, "installation.js reaches for " + forbidden);
  }
});

test("this computer's addresses are listed with their adapters", () => {
  const found = lanAddresses();
  assert.ok(Array.isArray(found));
  for (const entry of found) {
    assert.match(entry.address, /^\d+\.\d+\.\d+\.\d+$/);
    assert.strictEqual(typeof entry.name, "string");
    assert.strictEqual(typeof entry.virtual, "boolean");
  }
});
