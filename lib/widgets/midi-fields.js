"use strict";

/**
 * The MIDI section of a widget's settings: its fields, their defaults and
 * their validators. What a widget spreads into its definition to speak MIDI,
 * the way dmxFields(), dmxDefaults() and dmxChecks() in fields.js make it
 * speak DMX.
 *
 * MIDI only runs one way for now, from the widget to the instrument, so the
 * section has the one direction, named as the other sections name theirs.
 */

const { field } = require("./fields");
const { TYPES, CHANNELS, MAX_DATA, whole } = require("../midi/spec");

const DATA_OUT_HINT = "Send this widget's value as MIDI when it is used.";

const PORT_HINT =
  "The MIDI port to send to, as this computer names it. Part of the name is enough. " +
  "Leave it blank for the first port there is.";

const NUMBER_HINT =
  "The controller or note number, 0 to 127. A widget with several values uses the numbers that follow: " +
  "a pad set to 20 sends X on 20 and Y on 21. Program change and pitch bend do not use it.";

function midiFields() {
  const only = { section: "midi" };
  return [
    field("midiEnabled", "Data out", "checkbox", Object.assign({ hint: DATA_OUT_HINT }, only)),
    // `source` names a list the host may offer as suggestions. It stays a
    // text field: a port unplugged for the night is still this widget's port.
    field("midiPort", "Port", "text", Object.assign({ placeholder: "first port", hint: PORT_HINT, source: "midi-outputs" }, only)),
    field("midiChannel", "Channel", "number", Object.assign({ min: 1, max: CHANNELS }, only)),
    field("midiType", "Type", "select", Object.assign({ options: TYPES }, only)),
    field("midiNumber", "Number", "number", Object.assign({ min: 0, max: MAX_DATA, hint: NUMBER_HINT }, only)),
  ];
}

/** @param {string} [type] what suits the widget: "note" for a button, "program" for a list */
function midiDefaults(type) {
  return { midiEnabled: false, midiPort: "", midiChannel: 1, midiType: type || "cc", midiNumber: type === "note" ? 60 : 1 };
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

/** The validators that go with midiFields(). */
function midiChecks(values) {
  return { midiPort: checkPort, midiChannel: checkChannel, midiType: checkType, midiNumber: checkNumber(values) };
}

module.exports = { midiFields: midiFields, midiDefaults: midiDefaults, midiChecks: midiChecks };
