"use strict";

const { toNumber } = require("../osc-args");

/**
 * What a button sets on the other controls of its surface.
 *
 * A program key on a lighting desk does not light a channel of its own: it
 * puts the faders where the look wants them, and the faders do the rest. A
 * button's "When on, sets" and "When off, sets" are that: a list of controls
 * and the state to put each in, as a hand would -- the control moves, sends
 * what it sends, and the other devices see it move.
 *
 *   fader-4=255, fader-5=0, go=on, pad=128,64
 *
 * A number is a slider's, a number box's or a dropdown's value; on and off
 * are a button's; two numbers are a pad's x and y. The control is named by
 * its id, the one the editor pins into the project (adapters/grapesjs.js).
 * Parsed here, driven by the host (ctx.drive), which knows the controls.
 */

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * @returns {{ entries: Array<{ id: string, state: object }>, problem: string|null }}
 *   every pair that could be read, and the first that could not
 */
function parseSets(text) {
  const entries = [];
  const source = text === null || text === undefined ? "" : String(text);
  for (const raw of source.split(",").reduce(joinPads, [])) {
    const pair = raw.trim();
    if (!pair) continue;
    const at = pair.indexOf("=");
    if (at === -1) return { entries, problem: "Each entry is a control's id, =, and a value: " + pair };
    const id = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (!ID.test(id)) return { entries, problem: "That is not a control's id: " + id };
    const state = readState(value);
    if (!state) return { entries, problem: "A value is a number, on, off, or x;y for a pad: " + pair };
    entries.push({ id, state });
  }
  return { entries, problem: null };
}

/** A pad's two numbers are written x;y, so a comma stays the list's. */
function joinPads(list, part) {
  list.push(part);
  return list;
}

function readState(value) {
  const word = value.toLowerCase();
  if (word === "on" || word === "off") return { on: word === "on" };
  const pair = value.split(";");
  if (pair.length === 2) {
    const x = toNumber(pair[0]);
    const y = toNumber(pair[1]);
    return x === null || y === null ? null : { x, y };
  }
  const number = toNumber(value);
  return number === null ? null : { value: number };
}

/** The validator for the two fields: a complaint, or null. Blank is fine: the button sets nothing. */
function checkSets(text) {
  return parseSets(text).problem;
}

/** Drive every control a list names, through the host. Returns how many were. */
function driveSets(ctx, text) {
  if (typeof ctx.drive !== "function") return 0;
  let moved = 0;
  for (const entry of parseSets(text).entries) {
    if (ctx.drive(entry.id, entry.state)) moved++;
  }
  return moved;
}

module.exports = { parseSets, checkSets, driveSets };
