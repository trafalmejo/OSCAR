"use strict";

/**
 * The bridge: a widget whose Send when also fires on data in.
 *
 * Each out protocol carries a "Send when" (fields.js): "user", a hand, which
 * is every widget's old behaviour and the default; or "data", a hand or
 * whatever Data in (OSC or MIDI) put the widget in. With "data" anywhere,
 * the widget is a bridge -- a MIDI knob drives Resolume, a sensor's OSC
 * drives a fixture -- and whoever serves the surface does the sending, once:
 * the server for published surfaces (lib/surfaces.js), the page itself for a
 * downloaded file (adapters/standalone.js). The canvas and the preview only
 * follow, so a surface open in the editor while published drives nothing
 * twice.
 *
 * Two things stand between a bridge and a loop. The guard (per protocol,
 * default on) passes on only a change that changed the value, so software
 * that echoes what it receives moves nothing and nothing is re-sent; it can
 * be unticked for triggers where a repeat is the event. And whatever the
 * guard says, no widget bridges more than BRIDGE_CEILING sends a second: the
 * floor under a loop with the guard off.
 */

const BRIDGE_WINDOW_MS = 1000;
const BRIDGE_CEILING = 200;

/**
 * Which protocols this widget bridges, or null for one that does not.
 * Tolerant of configs from before the setting existed: only the exact word
 * "data" bridges.
 */
function bridgePlan(config) {
  if (!config) return null;
  const plan = {
    osc: config.oscSendWhen === "data",
    midi: config.midiSendWhen === "data",
    dmx: config.dmxSendWhen === "data",
  };
  return plan.osc || plan.midi || plan.dmx ? plan : null;
}

module.exports = { bridgePlan, BRIDGE_WINDOW_MS, BRIDGE_CEILING };
