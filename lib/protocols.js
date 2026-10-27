"use strict";

/**
 * What a published page drives: "osc", "midi", "dmx", from the settings
 * written onto its widgets. The phone app shows these as bubbles on each
 * row of its list, so a person knows before opening whether an interface
 * is a lighting desk or an OSC panel, and whether it needs OSCAR in the
 * loop at all (MIDI and DMX do; OSC alone can go straight from the phone).
 *
 * A widget counts for a protocol when it is switched on and set to send
 * on it. Widgets that only receive (a meter, the feedback cue) count for
 * nothing. The order is fixed, so the bubbles read the same everywhere.
 */

const { allWidgetsIn } = require("./surfaces");
const { sendsOsc, sendsDmx, sendsMidi } = require("./widgets/fields");

const ORDER = ["osc", "midi", "dmx"];

function isOff(value) {
  return value === false || value === "false";
}

/**
 * @param {string} html a page as lib/export built it
 * @returns {string[]} a subset of ["osc", "midi", "dmx"], in that order
 */
function protocolsOf(html) {
  const found = new Set();
  for (const { definition, config } of allWidgetsIn(html)) {
    if (!config || isOff(config.enabled)) continue;
    if (definition.sends && sendsOsc(config)) found.add("osc");
    if (definition.sends && sendsMidi(config)) found.add("midi");
    if (definition.dmx && sendsDmx(config)) found.add("dmx");
  }
  return ORDER.filter((p) => found.has(p));
}

module.exports = { protocolsOf, ORDER };
