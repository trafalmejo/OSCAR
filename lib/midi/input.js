"use strict";

/**
 * MIDI in: the ports OSCAR listens on, and what is heard through them.
 *
 * A port is only opened while somebody wants it. On Windows a MIDI input
 * belongs to whichever program opened it first, so an OSCAR that opened every
 * controller in the building at start would take them away from the software
 * they were plugged in for. Who wants what is said with want(); the ports are
 * then matched to it now and every CHECK_MS after, which is how a controller
 * plugged in mid-show is picked up and an unplugged one is let go of.
 */

const { readMidi } = require("./spec");

const CHECK_MS = 3000;

/**
 * @param {object} driver what lib/midi/driver.js loaded
 * @param {object} options
 * @param {(heard: object, port: string) => void} options.onMessage a note, controller, program or bend, as readMidi() says it
 * @param {(event: "open"|"closed", name: string) => void} [options.onEvent]
 * @param {(err: Error) => void} [options.onError]
 * @param {Function} [options.setInterval] for tests
 * @param {Function} [options.clearInterval]
 */
function createMidiInput(driver, options) {
  const opts = options || {};
  const every = opts.setInterval || setInterval;
  const stop = opts.clearInterval || clearInterval;
  const open = new Map(); // port name -> the open port
  let wanted = []; // parts of names, lower case; "" wants every port
  let timer = null;
  let heard = 0;
  let error = null;

  function wants(name) {
    const lower = name.toLowerCase();
    return wanted.some((part) => lower.indexOf(part) !== -1);
  }

  function letGo(name) {
    const port = open.get(name);
    if (!port) return;
    open.delete(name);
    try {
      port.close();
    } catch (err) {
      // Already gone, which is usually why.
    }
    if (opts.onEvent) opts.onEvent("closed", name);
  }

  /** Make the open ports the wanted ones that are there. */
  function check() {
    if (!driver || !driver.supported) return;
    let names;
    try {
      names = driver.inputs();
    } catch (err) {
      error = String((err && err.message) || err);
      return;
    }
    for (const name of Array.from(open.keys())) {
      if (names.indexOf(name) === -1 || !wants(name)) letGo(name);
    }
    for (const name of names) {
      if (open.has(name) || !wants(name)) continue;
      try {
        const port = driver.openInput(name, function (bytes) {
          const message = readMidi(bytes);
          if (!message) return;
          heard++;
          opts.onMessage(message, name);
        });
        if (!port) continue;
        open.set(name, port);
        error = null;
        if (opts.onEvent) opts.onEvent("open", name);
      } catch (err) {
        // Held by another program, most often. Tried again at the next check.
        const first = error === null;
        error = name + ": " + String((err && err.message) || err);
        if (first && opts.onError) opts.onError(new Error(error));
      }
    }
  }

  /**
   * Say which ports are wanted: a list of names or parts of names, "" for
   * every port, [] for none. Replaces what was wanted before.
   */
  function want(parts) {
    const next = Array.from(new Set((parts || []).map((part) => String(part || "").trim().toLowerCase())));
    const same = next.length === wanted.length && next.every((part) => wanted.indexOf(part) !== -1);
    wanted = next;
    if (!wanted.length) {
      if (timer) stop(timer);
      timer = null;
      for (const name of Array.from(open.keys())) letGo(name);
      return;
    }
    if (!timer) {
      timer = every(check, CHECK_MS);
      if (timer && typeof timer.unref === "function") timer.unref();
    }
    if (!same || !open.size) check();
  }

  function status() {
    return { listening: Array.from(open.keys()), heard: heard, inputError: error };
  }

  return { want: want, check: check, status: status, close: () => want([]) };
}

module.exports = { createMidiInput: createMidiInput, CHECK_MS: CHECK_MS };
