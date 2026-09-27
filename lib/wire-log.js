"use strict";

/**
 * The network log: what OSCAR actually received and actually sent.
 *
 * Written where traffic meets the wire, not where it is caused. Every OSC
 * message that arrives is a row the moment it is read, with its sender; every
 * OSC message, DMX level change and MIDI message that goes out is a row once
 * it has been handed to the socket, port or stream, with where it went.
 * What OSCAR refused -- a malformed message either way, a packet that is not
 * OSC -- is a row too, marked dropped.
 *
 * Why something happened is written on the row it happened to, never as a
 * row of its own:
 *
 *   out  origin    whose move it was: canvas, local, internet, schedule, bridge
 *        surface   the published surface it was for; widget, which control
 *   in   surfaces  the published surfaces that follow it -- whether or not
 *                  the value changed, whether or not anyone was watching
 *        canvas    the editor's canvas followed it (the editor says so, a
 *                  moment later, and the row is updated)
 *
 * Repeats inside one flush (a fader ridden at 60 Hz) are one row with a count,
 * the time of the latest and the value it carried. A row keeps its id, so a
 * word that arrives after it was shown updates it in place. Rows are kept in
 * the order things happened, by their own time.
 *
 * @param {object} options
 * @param {(row: object) => void} options.emit      a row, new or updated
 * @param {(dir: "in"|"out") => void} [options.flash] a light, at most every 200 ms each
 * @param {() => number} [options.now]
 * @param {Function} [options.setTimer] @param {Function} [options.clearTimer]
 */
function createWireLog(options) {
  const emit = options.emit;
  const flash = options.flash || function () {};
  const now = options.now || Date.now;
  const setTimer = options.setTimer || setTimeout;
  const KEEP = options.keep || 200;
  const FLUSH_MS = options.flushMs || 300;
  // How long after its last message a row still takes a word about it.
  const ANNOTATE_MS = options.annotateMs || 2000;
  const FLASH_MS = 200;

  const boot = now().toString(36);
  let counter = 0;
  const rows = []; // shown, oldest first by time
  let pending = new Map(); // key -> row being gathered
  let timer = null;
  const flashedAt = { in: 0, out: 0 };

  function light(dir) {
    const at = now();
    if (at - flashedAt[dir] < FLASH_MS) return;
    flashedAt[dir] = at;
    flash(dir);
  }

  function place(row) {
    // Usually last; a row gathered a little longer lands where its time says.
    let at = rows.length;
    while (at > 0 && rows[at - 1].at > row.at) at--;
    rows.splice(at, 0, row);
    if (rows.length > KEEP) rows.splice(0, rows.length - KEEP);
  }

  function flush() {
    timer = null;
    const due = pending;
    pending = new Map();
    for (const row of due.values()) {
      row.shown = true;
      place(row);
      emit(publicRow(row));
    }
  }

  function gather(key, make, update) {
    let row = pending.get(key);
    if (row) {
      row.n += 1;
      row.at = now();
      update(row);
    } else {
      row = make();
      row.id = boot + "-" + ++counter;
      row.at = now();
      row.n = 1;
      pending.set(key, row);
      if (!timer) timer = setTimer(flush, FLUSH_MS);
    }
    return row;
  }

  function changed(row) {
    if (row.shown) emit(publicRow(row));
  }

  /** The row as it is sent and kept: no bookkeeping. */
  function publicRow(row) {
    const out = {};
    for (const key of Object.keys(row)) {
      if (key === "shown" || key === "surfaceSet") continue;
      if (row[key] === undefined || row[key] === false || row[key] === "") continue;
      if (Array.isArray(row[key]) && !row[key].length) continue;
      out[key] = Array.isArray(row[key]) ? row[key].slice() : row[key];
    }
    return out;
  }

  return {
    /**
     * Something went out, or was refused on its way out.
     * @param {{protocol: string, what: string, value?: string, to?: string, origin?: string,
     *          surface?: string, widget?: string, device?: string, dropped?: string}} event
     */
    out(event) {
      const key = ["out", event.protocol, event.what, event.to, event.origin, event.surface, event.widget, event.device, event.dropped].join("|");
      gather(
        key,
        () => ({ dir: "out", protocol: event.protocol, what: event.what, value: event.value, to: event.to, origin: event.origin, surface: event.surface, widget: event.widget, device: event.device, dropped: event.dropped }),
        (row) => {
          row.value = event.value;
        }
      );
      if (!event.dropped) light("out");
    },

    /**
     * Something arrived. Returns a handle to say, once known, who followed it.
     * @param {{protocol: string, what: string, value?: string, device?: string, dropped?: string}} event
     */
    arrive(event) {
      const key = ["in", event.protocol, event.what, event.device, event.dropped].join("|");
      const row = gather(
        key,
        () => ({ dir: "in", protocol: event.protocol, what: event.what, value: event.value, device: event.device, dropped: event.dropped, surfaces: [], surfaceSet: new Set(), canvas: false }),
        (held) => {
          held.value = event.value;
        }
      );
      return {
        /** A published surface follows this message. */
        followedBy(surfaceId) {
          light("in");
          if (row.surfaceSet.has(surfaceId)) return;
          row.surfaceSet.add(surfaceId);
          row.surfaces.push(surfaceId);
          changed(row);
        },
      };
    },

    /**
     * The editor's word that its canvas followed messages like this one.
     * It lands on the recent rows it is about; with nothing to land on --
     * the row has aged out, or never was -- it is not a row of its own.
     * A second editor saying the same thing changes nothing further.
     */
    canvasHeard(protocol, what, device) {
      const since = now() - ANNOTATE_MS;
      let landed = false;
      const candidates = [...pending.values()].concat(rows.slice(-KEEP));
      for (const row of candidates) {
        if (row.dir !== "in" || row.protocol !== protocol || row.what !== what || row.at < since || row.dropped) continue;
        if (device && row.device !== device) continue;
        landed = true;
        if (row.canvas) continue;
        row.canvas = true;
        changed(row);
      }
      if (landed) light("in");
      return landed;
    },

    /** What is kept, oldest first, for a window opening now. */
    rows() {
      return rows.map(publicRow);
    },
  };
}

module.exports = { createWireLog };
