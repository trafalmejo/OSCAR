"use strict";

const { MAX_LEVEL } = require("./spec");

/**
 * Turning what a control is worth into what a DMX slot can hold.
 *
 * Every function here returns null rather than a number it had to invent. The
 * reasoning is lib/osc-message.js's, and it matters more here: a DMX slot is
 * unsigned, 0 is a real command meaning "off", and Number(null), Number("") and
 * Number(false) are all 0. A value that arrived broken must not reach a dimmer
 * as a blackout.
 */

/** A number, or null -- never an accidental zero. */
function toNumber(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "boolean") return null;
  if (typeof raw === "object") return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

/** A whole number inside a range, or null. Used for universes and channels. */
function toWhole(raw, min, max) {
  const number = toNumber(raw);
  if (number === null || !Number.isInteger(number)) return null;
  if (number < min || number > max) return null;
  return number;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Where a control sits within its own range, as 0..1, or null.
 *
 * This is the one place a widget's units (0-100, -1..1, 20-2000Hz) are turned
 * into something protocol-neutral, so the widget keeps owning its range and
 * DMX never has to know what a slider was labelled.
 *
 * A range of zero width is not scalable. Returning 0 there would look like a
 * value; it is the absence of one.
 */
function unitOf(value, min, max) {
  const v = toNumber(value);
  const lo = toNumber(min);
  const hi = toNumber(max);
  if (v === null || lo === null || hi === null || hi === lo) return null;
  return clamp((v - lo) / (hi - lo), 0, 1);
}

/**
 * 0..1 -> 0..255.
 *
 * Clamped before rounding, deliberately: a control that overshoots its range
 * should pin at full or at zero, which is what the fixture can do anyway. That
 * is a different thing from a value that could not be read, which is null.
 */
function toLevel(unit) {
  const number = toNumber(unit);
  if (number === null) return null;
  return Math.round(clamp(number, 0, 1) * MAX_LEVEL);
}

/**
 * A list of 0..1 values -> a list of levels, or null if any one of them fails.
 *
 * One bad coordinate spoils the set, the same way a half-built OSC message is
 * refused: sending pan without tilt puts a light somewhere nobody asked for.
 */
function toLevels(units) {
  const list = Array.isArray(units) ? units : [units];
  if (!list.length) return null;

  const levels = [];
  for (const unit of list) {
    const level = toLevel(unit);
    if (level === null) return null;
    levels.push(level);
  }
  return levels;
}

/**
 * Lay a widget's levels across the channel block it was given.
 *
 * Values fill in order and the last one repeats to the end, so one slider over
 * three channels dims an RGB fixture as a whole, while an XY pad over two
 * channels lands on pan and tilt. A block shorter than the widget's values
 * truncates -- the settings panel is where that gets pointed out.
 */
function spread(levels, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(levels[Math.min(i, levels.length - 1)]);
  }
  return out;
}

module.exports = { toNumber, toWhole, unitOf, toLevel, toLevels, spread, clamp };
