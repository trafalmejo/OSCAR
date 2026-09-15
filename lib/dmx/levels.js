"use strict";

const { toNumber } = require("../osc-args");
const { MAX_LEVEL } = require("./spec");

/**
 * Turning what a control is worth into what a DMX slot can hold.
 *
 * Every function here returns null rather than a number it would have had to
 * invent. The reasoning is lib/osc-message.js's, and it bites harder here: a
 * slot is unsigned, 0 is a real command meaning "off", and Number(null),
 * Number("") and Number(false) are all 0. A value that arrived broken must
 * never reach a dimmer as a blackout.
 */

/** A whole number inside a range, or null. Universes and channels. */
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
 * Where a value sits within a control's own range, as 0..1, or null.
 *
 * The one place a widget's units -- 0-100, -1..1, 20-2000 Hz -- become
 * something a protocol can scale, so the widget keeps owning its range and
 * DMX never learns what a slider was labelled. Clamped: a value past either
 * end pins there, which is what the fixture can do anyway.
 *
 * A range of zero width cannot place anything. Returning 0 there would look
 * like a level; it is the absence of one.
 */
function unitOf(value, min, max) {
  const v = toNumber(value);
  const lo = toNumber(min);
  const hi = toNumber(max);
  if (v === null || lo === null || hi === null || hi === lo) return null;
  return clamp((v - lo) / (hi - lo), 0, 1);
}

/** 0..1 -> 0..255, clamped before rounding. Null stays null. */
function toLevel(unit) {
  const number = toNumber(unit);
  if (number === null) return null;
  return Math.round(clamp(number, 0, 1) * MAX_LEVEL);
}

/**
 * A list of 0..1 values -> levels, or null if any one of them fails.
 *
 * One bad coordinate spoils the set, the same way a half-built OSC message is
 * refused: pan without tilt puts a light somewhere nobody asked for.
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
 * Lay a widget's levels across the block of channels it was given, or null
 * when the block is too narrow to hold them.
 *
 * Values fill in order and the last one repeats to the end of the block, so
 * one slider over three channels dims an RGB fixture as a whole while a pad
 * over two lands on pan and tilt. A block narrower than the values would drop
 * a coordinate, and half a position is no position.
 */
function spread(levels, count) {
  if (!Array.isArray(levels) || !levels.length || count < levels.length) return null;
  const out = [];
  for (let i = 0; i < count; i++) out.push(levels[Math.min(i, levels.length - 1)]);
  return out;
}

module.exports = { toWhole, unitOf, toLevel, toLevels, spread, clamp };
