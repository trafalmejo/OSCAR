"use strict";

/**
 * MIDI: the server's entry point, as lib/dmx/index.js is DMX's.
 *
 * So far it answers one question, for the diagnostics and for whoever is
 * finding out whether a packaged OSCAR can reach MIDI at all: is there a
 * driver, and which ports does it see. Sending and receiving come next, in
 * files of their own beside this one.
 */

const { loadDriver, UNSUPPORTED } = require("./driver");

/**
 * @param {object} [options]
 * @param {object} [options.driver] what loadDriver() returns; tests pass a fake
 */
function createMidi(options) {
  const driver = (options && options.driver) || loadDriver();

  /** Never throws: a MIDI service that errors while being asked is reported, not raised. */
  function status() {
    if (!driver.supported) return { supported: false, reason: driver.reason || UNSUPPORTED, outputs: [], inputs: [] };
    try {
      return { supported: true, reason: null, outputs: driver.outputs(), inputs: driver.inputs() };
    } catch (err) {
      return { supported: true, reason: String((err && err.message) || err), outputs: [], inputs: [] };
    }
  }

  return { supported: driver.supported === true, status: status };
}

module.exports = { createMidi: createMidi, loadDriver: loadDriver };
