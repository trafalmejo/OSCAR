"use strict";

/**
 * What a MIDI message does to a widget: the state it puts it in.
 *
 * MIDI's Data in is OSC's Data in: the widget follows, and nothing is sent
 * on. Every page that shows the widget works the state out for itself, with
 * followMidi() below, and hands it to the widget the way another device's
 * state is handed to it, which is a door the widget cannot send through.
 *
 * With MIDI_BRIDGE on (lib/features.js) a knob is a hand instead: the widget
 * also sends its OSC and DMX (its MIDI it keeps to itself, or a virtual port
 * would hand the message straight back for ever). The same state then goes
 * to the widget's own drive() (see index.js), and the server does that, once,
 * however many pages are showing the surface.
 *
 * Each kind of widget reads a level its own way, by the `kind` its
 * driveInput() gives:
 *
 *   on        a note is on while it is held; a controller is on from halfway
 *             up. A button set to Toggle changes over each time it is pressed
 *             and ignores the release, as it does for a finger.
 *   value     the level, across the widget's Min to Max.
 *   choice    a program picks the option with that value, or failing that the
 *             option at that position; anything else picks by level.
 *   position  the first number is X, the next is Y. The other axis stays put.
 *   colour    red, green and blue on three numbers in a row. The others stay.
 */

const { toNumber } = require("../osc-args");
const { midiIndex } = require("../midi/spec");

const VALUES = { position: 2, colour: 3 };

/** How many values a widget listens for, on as many numbers in a row. */
function valuesOf(definition, config) {
  const input = definition && typeof definition.driveInput === "function" ? definition.driveInput(config || {}) : null;
  return (input && VALUES[input.kind]) || 1;
}

function across(unit, min, max) {
  const lo = toNumber(min);
  const hi = toNumber(max);
  if (lo === null || hi === null) return null;
  return lo + unit * (hi - lo);
}

function hexOf(rgb) {
  return "#" + rgb.map((v) => ("0" + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2)).join("");
}

function rgbOf(hex) {
  const found = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
  return found ? [1, 2, 3].map((i) => parseInt(found[i], 16)) : [0, 0, 0];
}

/**
 * @param {object} definition the widget's definition
 * @param {object} config     its settings
 * @param {object} heard      { type, channel, number, unit } from lib/midi/spec.js
 * @param {number} index      which of the widget's values this carries (midiIndex())
 * @param {object} [current]  the state the widget is showing now, if known
 * @returns {object|null} a state for definition.drive(), or null to leave the widget alone
 */
function stateFromMidi(definition, config, heard, index, current) {
  if (!definition || typeof definition.driveInput !== "function") return null;
  const input = definition.driveInput(config);
  if (!input || !heard) return null;
  const now = current || {};

  if (input.kind === "on") {
    const pressed = heard.type === "note" ? heard.unit > 0 : heard.unit >= 0.5;
    if (config.mode !== "toggle") return { on: pressed };
    return pressed ? { on: !now.on } : null;
  }

  if (input.kind === "value") {
    const value = across(heard.unit, input.min, input.max);
    return value === null ? null : { value: value };
  }

  if (input.kind === "choice") {
    const options = input.options || [];
    if (!options.length) return null;
    if (heard.type === "program") {
      const named = options.find((option) => String(option.value) === String(heard.number));
      const picked = named || options[heard.number];
      return picked ? { value: picked.value } : null;
    }
    return { value: options[Math.round(heard.unit * (options.length - 1))].value };
  }

  if (input.kind === "position") {
    const axis = index === 1 ? "y" : "x";
    const moved = index === 1 ? across(heard.unit, input.minY, input.maxY) : across(heard.unit, input.minX, input.maxX);
    // An axis nobody has touched yet starts in the middle, where the pad does.
    const x = toNumber(now.x) !== null ? toNumber(now.x) : across(0.5, input.minX, input.maxX);
    const y = toNumber(now.y) !== null ? toNumber(now.y) : across(0.5, input.minY, input.maxY);
    if (moved === null || x === null || y === null) return null;
    return axis === "x" ? { x: moved, y: y } : { x: x, y: moved };
  }

  if (input.kind === "colour") {
    const rgb = rgbOf(now.value);
    rgb[index] = heard.unit * 255;
    return { value: hexOf(rgb) };
  }

  return null;
}

/**
 * A page's half: a function that turns what arrived into a state for one
 * widget, or null when it is not that widget's.
 *
 * @param {object} definition the widget's definition
 * @param {() => object} read     its settings, read afresh: they are edited while it is live
 * @param {() => object} showing  what it shows now, for the values a message leaves alone
 * @returns {(heard: object, port: string, first: boolean) => object|null}
 */
function followMidi(definition, read, showing) {
  return function (heard, port, first) {
    const config = read();
    const index = midiIndex(config, heard, port, valuesOf(definition, config), first);
    if (index === -1) return null;
    return stateFromMidi(definition, config, heard, index, showing ? showing() : null);
  };
}

module.exports = { stateFromMidi: stateFromMidi, valuesOf: valuesOf, followMidi: followMidi };
