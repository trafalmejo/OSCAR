"use strict";

/**
 * MIDI: the server's entry point, as lib/dmx/index.js is DMX's.
 *
 * The widgets require spec.js directly, the only file here safe for a browser
 * bundle. The rest is the native driver (driver.js, the one file that touches
 * it), the gate a request passes on its way in (request.js), the ports kept
 * open for sending (output.js) and the ports listened on (input.js).
 */

const spec = require("./spec");
const { loadDriver, UNSUPPORTED } = require("./driver");
const { buildRequest } = require("./request");
const { createMidiOutput } = require("./output");
const { createMidiInput } = require("./input");

// How long Learn waits for somebody to touch a control.
const LEARN_MS = 15000;

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

  const listeners = [];
  const learners = new Set();
  let bridged = []; // the ports the widgets want, as listenFor() was told
  const input = createMidiInput(driver, {
    setInterval: opts.setInterval,
    clearInterval: opts.clearInterval,
    onError: opts.onError,
    onEvent: opts.onEvent ? (event, name) => opts.onEvent(event === "open" ? "listening" : "deaf", name) : null,
    onMessage: function (heard, port, first) {
      // Whoever is learning takes the message and nobody else does: the knob
      // being wiggled to bind a new widget must not also move an old one.
      if (learners.size) {
        for (const learner of Array.from(learners)) learner.done({ port: port, heard: heard });
        return;
      }
      for (const fn of listeners.slice()) fn(heard, port, first);
    },
  });

  function rewant() {
    input.want(learners.size ? ["*"] : bridged);
  }

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

  /** The ports, and how sending and listening have gone. For the diagnostics. */
  function status() {
    return Object.assign(ports(), output.status(), input.status());
  }

  /** Say which input ports the widgets want ("*" for every port, "" for the first, [] for none). Be told of what arrives with onMessage(). */
  function listenFor(parts) {
    bridged = (parts || []).slice();
    rewant();
  }

  /** fn(heard, port, first) for every note, controller, program and bend. Returns an unsubscribe function. */
  function onMessage(fn) {
    listeners.push(fn);
    return function () {
      const at = listeners.indexOf(fn);
      if (at !== -1) listeners.splice(at, 1);
    };
  }

  /**
   * The next thing anybody plays, on any port: fn({ port, heard }), or
   * fn(null) if nobody plays anything in time. Returns a way to stop waiting.
   */
  function learn(fn, timeout) {
    const wait = opts.setTimeout || setTimeout;
    const unwait = opts.clearTimeout || clearTimeout;
    const learner = {
      done: function (result) {
        if (!learners.delete(learner)) return;
        unwait(timer);
        rewant();
        fn(result);
      },
    };
    const timer = wait(() => learner.done(null), timeout || LEARN_MS);
    learners.add(learner);
    rewant();
    return () => learner.done(null);
  }

  function close() {
    output.close();
    input.close();
    if (typeof driver.close === "function") driver.close();
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

  return { supported: driver.supported === true, ports: ports, status: status, send: send, listenFor: listenFor, onMessage: onMessage, learn: learn, close: close };
}

module.exports = Object.assign({ createMidi: createMidi, loadDriver: loadDriver, buildRequest: buildRequest, LEARN_MS: LEARN_MS }, spec);
