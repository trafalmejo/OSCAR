"use strict";

/**
 * What every device showing the same surface agrees a widget is doing.
 *
 * Two tablets on one surface used to disagree the moment anyone touched
 * anything: one operator toggles a button, the other tablet still draws it
 * off, and its next press sends the edge that has already been sent. The
 * server keeps one record per widget, hands the lot to whoever connects, and
 * passes each change on to every device but the one that made it.
 *
 * This module is the record and nothing else: no sockets, no widgets, so it
 * can be tested in a line. The rule that keeps the devices from shouting at
 * each other lives here, in apply() returning null when a patch changes
 * nothing. The server broadcasts only on a real change, so a device
 * repeating back the value it was just handed goes no further than this
 * map, however many devices are on the surface.
 *
 * A widget is keyed by its component id, which is saved in the project, so
 * the same widget carries the same id on every device the layout was pushed
 * to. That is what lets two tablets recognise each other's state at all.
 */

// A surface with more widgets than this is not a surface; a page that
// invents ids would otherwise fill memory one record at a time.
const MAX_WIDGETS = 1000;
// A widget's state is a position or an on/off: a handful of keys, not a
// document.
const MAX_KEYS = 16;
const MAX_ID_LENGTH = 128;
const MAX_KEY_LENGTH = 64;
const MAX_STRING_LENGTH = 256;

// A key is a plain name. Refusing anything else keeps "__proto__" and its
// relatives out of the record objects, which would otherwise be the one way
// a client could reach past its own widget.
const KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Is this a value a widget can show? A number, a switch, a short word. A
 * value that is not finite is refused rather than stored as something
 * else: on a lighting rig a value nobody meant is a level nobody asked for.
 */
function isSharable(value) {
  switch (typeof value) {
    case "number":
      return Number.isFinite(value);
    case "boolean":
      return true;
    case "string":
      return value.length <= MAX_STRING_LENGTH;
    default:
      return false;
  }
}

function isId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH;
}

function isKey(key) {
  return typeof key === "string" && key.length <= MAX_KEY_LENGTH && KEY.test(key);
}

class SharedState {
  constructor() {
    this.byId = new Map();
  }

  /**
   * Merge a patch into one widget's record.
   *
   * @returns the widget's whole state if anything changed, or null when the
   *   patch said nothing new -- which is the caller's signal not to
   *   broadcast. Null is also the answer to anything malformed: a patch
   *   that is not an object, an id that is not a string, a value nothing
   *   can show. Those never reach the record, and they are never news.
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
      if (!isKey(key) || !isSharable(value)) continue;
      const known = Object.prototype.hasOwnProperty.call(next, key);
      if (!known && Object.keys(next).length >= MAX_KEYS) continue;
      if (known && next[key] === value) continue;
      next[key] = value;
      changed = true;
    }

    if (!changed) return null;
    this.byId.set(id, next);
    return Object.assign({}, next);
  }

  /** One widget's state, or null for a widget nothing has reported on. */
  get(id) {
    const state = this.byId.get(id);
    return state ? Object.assign({}, state) : null;
  }

  /** Every widget's state at once: what a device joining late is handed. */
  snapshot() {
    const all = {};
    for (const [id, state] of this.byId) all[id] = Object.assign({}, state);
    return all;
  }

  /**
   * Forget everything.
   *
   * A new layout makes the old records meaningless: the widget ids may not
   * even exist in it, and a stale position applied to a fresh surface is
   * worse than none at all.
   */
  clear() {
    this.byId.clear();
  }

  get size() {
    return this.byId.size;
  }
}

module.exports = { SharedState, isSharable, MAX_WIDGETS, MAX_KEYS, MAX_STRING_LENGTH };
