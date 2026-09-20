"use strict";

/**
 * MIDI: the server's entry point, as lib/dmx/index.js is DMX's.
 *
 * The widgets require spec.js directly, the only file here safe for a browser
 * bundle. The rest is the native driver (driver.js, the one file that touches
 * it), the gate a request passes on its way in (request.js) and the ports
 * kept open for sending (output.js). Receiving comes next, in a file of its
 * own beside these.
 */

const spec = require("./spec");
const { loadDriver, UNSUPPORTED } = require("./driver");
const { buildRequest } = require("./request");
const { createMidiOutput } = require("./output");

/**
 * @param {object} [options]
 * @param {object} [options.driver] what loadDriver() returns; tests pass a fake
 * @param {Function} [options.onEvent] see output.js
 * @param {Function} [options.onError] see output.js
 */
function createMidi(options) {
  const opts = options || {};
  const driver = opts.driver || loadDriver();
  const output = createMidiOutput(driver, { now: opts.now, onEvent: opts.onEvent, onError: opts.onError });

  /**
   * The ports there are, by name. Never throws: a MIDI service that errors
   * while being asked is reported, not raised.
   *
   * @param {{inputs?: boolean}} [which] `inputs: false` leaves the inputs
   *   unasked. The library complains on stderr each time it is asked for
   *   inputs and there are none, and the editor asks on every selection.
   */
  function ports(which) {
    if (!driver.supported) return { supported: false, reason: driver.reason || UNSUPPORTED, outputs: [], inputs: [] };
    try {
      const inputs = which && which.inputs === false ? [] : driver.inputs();
      return { supported: true, reason: null, outputs: driver.outputs(), inputs: inputs };
    } catch (err) {
      return { supported: true, reason: String((err && err.message) || err), outputs: [], inputs: [] };
    }
  }

  /** The ports, and how sending has gone. For the diagnostics. */
  function status() {
    return Object.assign(ports(), output.status());
  }

  /**
   * Send what came off a socket, or what the server built itself.
   * @returns {boolean} false for a request that is not wholly right, and for one that could not be sent
   */
  function send(input) {
    const request = buildRequest(input);
    if (!request) return false;
    return output.send(request);
  }

  return { supported: driver.supported === true, ports: ports, status: status, send: send, close: output.close };
}

module.exports = Object.assign({ createMidi: createMidi, loadDriver: loadDriver, buildRequest: buildRequest }, spec);
