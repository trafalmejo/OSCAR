"use strict";

/**
 * The MIDI section of a widget's settings: its fields, their defaults and
 * their validators. What a widget spreads into its definition to speak MIDI,
 * the way dmxFields(), dmxDefaults() and dmxChecks() in fields.js make it
 * speak DMX.
 *
 * It runs both ways, like OSC, and the two directions share Channel, Type and
 * Number: the knob that moves a fader is the knob a motorised controller
 * expects to hear back about. They do not share a port, because a computer
 * names its MIDI inputs and its outputs apart. What coming in does to a widget
 * is in midi-in.js.
 */

const { field, checkSendWhen, sendWhenField, loopGuardField } = require("./fields");
const { TYPES, CHANNELS, MAX_DATA, ALL_INPUTS, whole } = require("../midi/spec");

const DATA_OUT_HINT = "Send this widget's value as MIDI when it is used.";

const DATA_IN_HINT =
  "Follow a MIDI controller: a knob, fader or pad moves this widget. What comes in is not sent back out " +
  "unless a Send when says so. Learn fills in the settings below from the next control you touch.";

const IN_PORT_HINT =
  "The MIDI port to listen on. Ticking Data in picks the first port there is, and Learn the one you touch. " +
  "\"All MIDI inputs\" listens on every port, which on Windows takes them all from other programs.";

const PORT_HINT = "The MIDI port to send to, out of the ones this computer has.";

// What a port setting offers before the ports are known, and whatever they
// are: the first there is, which is what no value means, and for listening
// every one of them. A host that knows the ports adds them (`source`), and
// keeps the widget's own port in the list when it is unplugged.
const FIRST_PORT = { id: "", name: "First port" };
const IN_PORTS = [FIRST_PORT, { id: ALL_INPUTS, name: ALL_INPUTS }];
const OUT_PORTS = [FIRST_PORT];

const NUMBER_HINT =
  "The controller or note number, 0 to 127. A widget with several values uses the numbers that follow: " +
  "a pad set to 20 sends X on 20 and Y on 21. Program change and pitch bend do not use it.";

/**
 * @param {{sends?: boolean}} [options] `sends: false` for a widget that only
 *        follows, a meter: Data in and the port to listen on, and no way out.
 */
function midiFields(options) {
  const only = { section: "midi" };
  const sends = !(options && options.sends === false);
  // Ordered as OSC's section is: each direction's checkbox first, its port
  // right with it, so ticking a direction unfolds its own port beneath it.
  return [
    field("midiListen", "Data in", "checkbox", Object.assign({ hint: DATA_IN_HINT }, only)),
    field("midiInPort", "In port", "select", Object.assign({ dir: "in", options: IN_PORTS, hint: IN_PORT_HINT, source: "midi-inputs" }, only)),
    sends ? field("midiEnabled", "Data out", "checkbox", Object.assign({ hint: DATA_OUT_HINT }, only)) : null,
    sends ? sendWhenField("midiSendWhen", "midi") : null,
    sends ? loopGuardField("midiLoopGuard", "midi", "midiSendWhen") : null,
    sends ? field("midiPort", "Out port", "select", Object.assign({ dir: "out", options: OUT_PORTS, hint: PORT_HINT, source: "midi-outputs" }, only)) : null,
    // Channel, Type and Number are the two directions' shared vocabulary:
    // the knob that moves a fader is the knob a motorised controller hears
    // back about. On screen while either direction is.
    field("midiChannel", "Channel", "number", Object.assign({ dir: "both", min: 1, max: CHANNELS }, only)),
    field("midiType", "Type", "select", Object.assign({ dir: "both", options: TYPES }, only)),
    field("midiNumber", "Number", "number", Object.assign({ dir: "both", min: 0, max: MAX_DATA, hint: NUMBER_HINT }, only)),
  ].filter(Boolean);
}

/** @param {string} [type] what suits the widget: "note" for a button, "program" for a list */
function midiDefaults(type) {
  return { midiListen: false, midiEnabled: false, midiSendWhen: "user", midiLoopGuard: true, midiInPort: "", midiPort: "", midiChannel: 1, midiType: type || "cc", midiNumber: type === "note" ? 60 : 1 };
}

function checkChannel(value) {
  return whole(value, 1, CHANNELS) === null ? "A MIDI channel is a whole number between 1 and " + CHANNELS : null;
}

function checkType(value) {
  return TYPES.some((type) => type.id === value) ? null : "Unknown kind of MIDI message: " + value;
}

/** @param {number} values how many values the widget sends at once; they take that many numbers in a row */
function checkNumber(values) {
  const count = values || 1;
  return function (value) {
    const number = whole(value, 0, MAX_DATA);
    if (number === null) return "A MIDI controller or note number is a whole number between 0 and " + MAX_DATA;
    if (number + count - 1 > MAX_DATA) {
      return "This widget sends " + count + " values, on " + number + " and the numbers after it, and they run past " + MAX_DATA;
    }
    return null;
  };
}

function checkPort(value) {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && value.length <= 200 ? null : "A MIDI port is named in at most 200 characters";
}

/** The validators that go with midiFields(); `options` as given to it. */
function midiChecks(values, options) {
  const checks = { midiInPort: checkPort, midiChannel: checkChannel, midiType: checkType, midiNumber: checkNumber(values) };
  // A check for a setting the widget does not have is a check nothing runs.
  if (!(options && options.sends === false)) {
    checks.midiPort = checkPort;
    checks.midiSendWhen = checkSendWhen;
  }
  return checks;
}

module.exports = { midiFields: midiFields, midiDefaults: midiDefaults, midiChecks: midiChecks };
