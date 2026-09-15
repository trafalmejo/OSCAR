"use strict";

/**
 * What every device showing the same surface agrees on.
 *
 * Two tablets used to disagree the moment anyone touched anything: one operator
 * toggles a button, the other tablet still draws it off, and its next press
 * sends the edge that has already been sent. The server keeps one copy of each
 * widget's state, hands it to whoever connects, and passes changes on.
 *
 * The rule that keeps this from becoming a shouting match is `apply` returning
 * null when nothing actually changed. A broadcast only follows a real change,
 * so an echo -- a device repeating back the value it was just given -- dies on
 * arrival instead of bouncing to the other device and back again forever.
 */

// A surface with more widgets than this is not a surface; it is a page that has
// gone wrong or a client filling memory on purpose.
const MAX_WIDGETS = 1000;
const MAX_KEYS = 32;

/**
 * State is what a widget is *doing*: a position, an on/off. Anything shaped
 * like structured data is a client trying to use this as storage.
 */
function isSharable(value) {
  if (value === null) return true;
  const type = typeof value;
  if (type === "number") return Number.isFinite(value);
  if (type === "string") return value.length <= 256;
  return type === "boolean";
}

function isId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 128;
}

class SharedState {
  constructor() {
    this.byId = new Map();
  }

  /**
   * Merge a patch into one widget's state.
   *
   * @returns the widget's full state if it changed, or null if the patch said
   * nothing new -- which is the caller's signal not to broadcast.
   */
  apply(id, patch) {
    if (!isId(id)) return null;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return null;

    const current = this.byId.get(id);
    if (!current && this.byId.size >= MAX_WIDGETS) return null;

    const next = Object.assign({}, current);
    let changed = false;

    for (const key of Object.keys(patch)) {
      const value = patch[key];
      if (!isSharable(value)) continue;
      if (!Object.prototype.hasOwnProperty.call(next, key) && Object.keys(next).length >= MAX_KEYS) {
        continue;
      }
      // Object.is rather than ===, so a repeated NaN is not treated as a change
      // and -0 does not masquerade as one either.
      if (Object.prototype.hasOwnProperty.call(next, key) && Object.is(next[key], value)) continue;
      next[key] = value;
      changed = true;
    }

    if (!changed) return null;

    this.byId.set(id, next);
    return next;
  }

  /** One widget's state, or null. */
  get(id) {
    const state = this.byId.get(id);
    return state ? Object.assign({}, state) : null;
  }

  /** Everything a device joining late needs to catch up. */
  snapshot() {
    const all = {};
    for (const [id, state] of this.byId) all[id] = Object.assign({}, state);
    return all;
  }

  /**
   * Forget everything.
   *
   * A new layout pushed to the tablets makes the old state meaningless: the
   * widget ids may not even exist any more, and a stale position applied to a
   * fresh surface is worse than no position at all.
   */
  clear() {
    this.byId.clear();
  }

  get size() {
    return this.byId.size;
  }
}

module.exports = { SharedState, MAX_WIDGETS, MAX_KEYS };
