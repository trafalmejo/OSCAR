"use strict";

/**
 * What MIDI is, as far as a widget needs to know: the kinds of message, their
 * ranges, and how a gesture becomes bytes.
 *
 * Safe for a browser bundle, as lib/dmx/spec.js is: no native module, no
 * Buffer. The widgets and the settings panel require this file and nothing
 * else under lib/midi.
 */

const CHANNELS = 16;
const MAX_DATA = 127;
const MAX_BEND = 16383;

/** The kinds of message a widget can send, in the order the panel offers them. */
const TYPES = [
  { id: "cc", name: "Control change" },
  { id: "note", name: "Note" },
  { id: "program", name: "Program change" },
  { id: "pitch", name: "Pitch bend" },
];

const STATUS = { noteOff: 0x80, noteOn: 0x90, cc: 0xb0, program: 0xc0, pitch: 0xe0 };

function isOn(value) {
  return value === true || value === "true";
}

/** Whether these settings put MIDI on the wire. Off unless switched on. */
function sendsMidi(config) {
  return isOn(config && config.midiEnabled);
}

function typeOf(id) {
  for (const type of TYPES) if (type.id === id) return type;
  return null;
}

/** A whole number within [min, max], or null. Never rounded into range: a wrong channel plays the wrong synth. */
function whole(value, min, max) {
  if (value === "" || value === null || value === undefined || typeof value === "boolean") return null;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

/** One gesture as a list of 0..1, or null if any of it is not a number in that range. */
function unitsOf(units) {
  const list = Array.isArray(units) ? units : [units];
  if (!list.length) return null;
  for (const unit of list) {
    if (typeof unit !== "number" || !isFinite(unit) || unit < 0 || unit > 1) return null;
  }
  return list;
}

/**
 * The bytes for one gesture: a list of messages, or null for silence.
 *
 * `units` is the gesture as 0..1, the reading DMX is scaled from too
 * (lib/widgets/outgoing.js). A widget with several values -- a pad's two, a
 * colour's three -- sends each on the next number up: controllers 20 and 21,
 * or notes 60, 61 and 62. Program change and pitch bend have no number to
 * count up from, so they carry the first value alone.
 *
 * A program is a position in a list, not a level, so a whole number from 0
 * to 127 in `raw` is sent as it is: a dropdown whose options are 0, 1, 2
 * picks programs 0, 1, 2. Anything else falls back to the level.
 *
 * Null, never a guess, as for DMX: a note or a controller that cannot be
 * worked out is not sent as number 0, which is somebody else's.
 */
function midiMessages(config, raw, units) {
  const type = typeOf(config && config.midiType);
  const channel = whole(config && config.midiChannel, 1, CHANNELS);
  const values = unitsOf(units);
  if (!type || channel === null || !values) return null;
  const ch = channel - 1;

  if (type.id === "program") {
    const first = Array.isArray(raw) ? raw[0] : raw;
    const picked = whole(first, 0, MAX_DATA);
    return [[STATUS.program | ch, picked !== null ? picked : Math.round(values[0] * MAX_DATA)]];
  }
  if (type.id === "pitch") {
    const bend = Math.round(values[0] * MAX_BEND);
    return [[STATUS.pitch | ch, bend & 0x7f, bend >> 7]];
  }

  const number = whole(config.midiNumber, 0, MAX_DATA);
  if (number === null || number + values.length - 1 > MAX_DATA) return null;
  return values.map(function (unit, i) {
    const level = Math.round(unit * MAX_DATA);
    if (type.id === "cc") return [STATUS.cc | ch, number + i, level];
    // A note at velocity 0 is a note off to most instruments and a very
    // quiet note to a few. Said outright, there is nothing to disagree on.
    return level > 0 ? [STATUS.noteOn | ch, number + i, level] : [STATUS.noteOff | ch, number + i, 0];
  });
}

/**
 * What arrived, in the words the settings use, or null for anything that is
 * not a note, a controller, a program or a bend.
 *
 *   { type, channel, number, unit }
 *
 * `unit` is the level as 0..1, the reading a widget's range is scaled from.
 * A note off, and a note on at velocity 0, which means the same, are a note
 * at 0. A program has no level of its own: its number is its position.
 */
function readMidi(bytes) {
  if (!bytes || typeof bytes.length !== "number" || bytes.length < 2) return null;
  const status = bytes[0] & 0xf0;
  const channel = (bytes[0] & 0x0f) + 1;
  const a = bytes[1];
  const b = bytes.length > 2 ? bytes[2] : 0;
  if (!(bytes[0] >= 0x80 && bytes[0] <= 0xef) || a > MAX_DATA || b > MAX_DATA) return null;
  if (status === STATUS.noteOn) return { type: "note", channel: channel, number: a, unit: b / MAX_DATA };
  if (status === STATUS.noteOff) return { type: "note", channel: channel, number: a, unit: 0 };
  if (status === STATUS.cc) return { type: "cc", channel: channel, number: a, unit: b / MAX_DATA };
  if (status === STATUS.program) return { type: "program", channel: channel, number: a, unit: a / MAX_DATA };
  if (status === STATUS.pitch) return { type: "pitch", channel: channel, number: 0, unit: ((b << 7) | a) / MAX_BEND };
  return null;
}

/**
 * What an In port setting says to listen on. Blank is the first port there
 * is, as a blank Out port is the first there is to send to. Every port has to
 * be asked for in words, because on Windows a port OSCAR has open is taken
 * from every other program. "*" and "all" are taken to mean it too.
 */
const ALL_INPUTS = "All MIDI inputs";
const ALL = "*";

/** "*" for every port, "" for the first, otherwise the part of a name asked for, lower case. */
function inputWanted(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === ALL || text === "all" || text === ALL_INPUTS.toLowerCase()) return ALL;
  return text;
}

function isListening(config) {
  return isOn(config && config.midiListen);
}

/**
 * Whether what arrived is this widget's, and if so which of its values it
 * carries: 0 for the first, 1 for a pad's Y or a colour's green. -1 if not.
 *
 * The mirror of midiMessages(): a widget with several values listens on the
 * numbers it would send on. `port` is the name of the port it came in by, and
 * `first` whether that is the first port there is, which is the one a widget
 * with no In port named listens on.
 *
 * @param {number} values how many values the widget has
 */
function midiIndex(config, heard, port, values, first) {
  if (!config || !config.enabled || !isListening(config) || !heard) return -1;
  if (heard.type !== config.midiType) return -1;
  if (whole(config.midiChannel, 1, CHANNELS) !== heard.channel) return -1;
  const wanted = inputWanted(config.midiInPort);
  if (wanted === "" ? first === false : wanted !== ALL && String(port || "").toLowerCase().indexOf(wanted) === -1) return -1;
  if (heard.type === "program" || heard.type === "pitch") return 0;
  const lowest = whole(config.midiNumber, 0, MAX_DATA);
  if (lowest === null) return -1;
  const index = heard.number - lowest;
  return index >= 0 && index < (values || 1) ? index : -1;
}

/** The MIDI half of an outgoing message, or null: { port, messages }. */
function midiRequest(config, raw, units) {
  const messages = midiMessages(config, raw, units);
  if (!messages) return null;
  return { port: typeof config.midiPort === "string" ? config.midiPort.trim() : "", messages: messages };
}

module.exports = {
  CHANNELS: CHANNELS,
  MAX_DATA: MAX_DATA,
  TYPES: TYPES,
  STATUS: STATUS,
  sendsMidi: sendsMidi,
  whole: whole,
  midiMessages: midiMessages,
  midiRequest: midiRequest,
  readMidi: readMidi,
  isListening: isListening,
  midiIndex: midiIndex,
  ALL_INPUTS: ALL_INPUTS,
  inputWanted: inputWanted,
};
