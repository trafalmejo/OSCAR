"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { protocolsOf, ORDER } = require("../lib/protocols");
const { exportAttributes } = require("../lib/export/config");
const { byName } = require("../lib/widgets");

/** One widget as an export writes it, with the settings given over its defaults. */
function tag(name, id, overrides) {
  const widget = byName[name];
  const config = Object.assign({}, widget.defaults, overrides);
  const attrs = Object.assign({ id }, widget.attributes || {}, exportAttributes(name, (k) => config[k]));
  const text = Object.keys(attrs)
    .map((k) => k + '="' + String(attrs[k]).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"')
    .join(" ");
  return "<" + widget.tag + " " + text + "></" + widget.tag + ">";
}

test("a page's protocols are what its switched-on widgets send or listen on: osc, midi, dmx, in that order", () => {
  assert.deepStrictEqual(ORDER, ["osc", "midi", "dmx"]);
  const osc = tag("oscar-button", "go", { message: "/go" });
  assert.deepStrictEqual(protocolsOf("<body>" + osc + "</body>"), ["osc"]);

  const dmx = tag("oscar-slider", "f1", { oscEnabled: false, dmxEnabled: true, dmxProtocol: "artnet", dmxUniverse: 1, dmxChannel: 1, dmxCount: 1 });
  const midi = tag("oscar-slider", "f2", { oscEnabled: false, midiEnabled: true, midiPort: "any", midiChannel: 1, midiKind: "cc", midiNumber: 1 });
  assert.deepStrictEqual(protocolsOf("<body>" + dmx + midi + osc + "</body>"), ["osc", "midi", "dmx"], "every protocol found, in the fixed order");

  // Listening counts too: a meter is an OSC widget, a pad that follows a controller is a MIDI one.
  const meter = tag("oscar-meter", "level", { message: "/level" });
  assert.deepStrictEqual(protocolsOf("<body>" + meter + "</body>"), ["osc"]);
  const mirror = tag("oscar-button", "pad1", { oscEnabled: false, midiEnabled: false, midiListen: true, midiInPort: "LPD8", midiChannel: 1, midiType: "note", midiNumber: 40 });
  assert.deepStrictEqual(protocolsOf("<body>" + mirror + "</body>"), ["midi"]);

  // Switched off, or set to neither send nor listen, counts for nothing.
  const off = tag("oscar-button", "mute", { enabled: false, message: "/mute" });
  const deaf = tag("oscar-button", "idle", { oscEnabled: false, listen: false });
  assert.deepStrictEqual(protocolsOf("<body>" + off + deaf + "</body>"), []);
  assert.deepStrictEqual(protocolsOf(""), []);
  assert.deepStrictEqual(protocolsOf("<body><p>no widgets</p></body>"), []);
});
