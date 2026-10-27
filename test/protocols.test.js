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

test("a page's protocols are what its switched-on widgets send: osc, midi, dmx, in that order", () => {
  assert.deepStrictEqual(ORDER, ["osc", "midi", "dmx"]);
  const osc = tag("oscar-button", "go", { message: "/go" });
  assert.deepStrictEqual(protocolsOf("<body>" + osc + "</body>"), ["osc"]);

  const dmx = tag("oscar-slider", "f1", { oscEnabled: false, dmxEnabled: true, dmxProtocol: "artnet", dmxUniverse: 1, dmxChannel: 1, dmxCount: 1 });
  const midi = tag("oscar-slider", "f2", { oscEnabled: false, midiEnabled: true, midiPort: "any", midiChannel: 1, midiKind: "cc", midiNumber: 1 });
  assert.deepStrictEqual(protocolsOf("<body>" + dmx + midi + osc + "</body>"), ["osc", "midi", "dmx"], "every protocol found, in the fixed order");

  // Switched off, or receive-only, counts for nothing.
  const off = tag("oscar-button", "mute", { enabled: false, message: "/mute" });
  const meter = tag("oscar-meter", "level", { message: "/level" });
  const cue = tag("oscar-feedback", "cue", { message: "/cue" });
  assert.deepStrictEqual(protocolsOf("<body>" + off + meter + cue + "</body>"), []);
  assert.deepStrictEqual(protocolsOf(""), []);
  assert.deepStrictEqual(protocolsOf("<body><p>no widgets</p></body>"), []);
});
