"use strict";

/**
 * MIDI out: the ports OSCAR has open, and what is sent through them.
 *
 * A port is opened the first time a widget sends to it and kept open, since
 * opening one takes long enough to hear. One that stops answering -- the
 * instrument was unplugged -- is let go of and looked for again, but not on
 * every move of a fader: asking the system to list its ports is slow, and a
 * missing port is asked after at most once every RETRY_MS.
 */

const RETRY_MS = 2000;

/**
 * @param {object} driver what lib/midi/driver.js loaded
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @param {(event: "open"|"closed", name: string) => void} [options.onEvent]
 * @param {(err: Error, missed: number) => void} [options.onError] told of the first failure in a run, and how many went unreported before it
 */
function createMidiOutput(driver, options) {
  const opts = options || {};
  const now = opts.now || Date.now;
  const open = new Map(); // what a widget asked for -> the open port
  const missing = new Map(); // what a widget asked for -> when it was last looked for
  let sent = 0;
  let dropped = 0;
  let unreported = 0;
  let error = null;

  function fail(err) {
    dropped++;
    error = String((err && err.message) || err);
    // A fader against a missing port fails sixty times a second. Say it once.
    if (unreported === 0 && opts.onError) opts.onError(err instanceof Error ? err : new Error(error), 0);
    unreported++;
  }

  function portFor(wanted) {
    if (open.has(wanted)) return open.get(wanted);
    const last = missing.get(wanted);
    if (last !== undefined && now() - last < RETRY_MS) return null;
    const port = driver.openOutput(wanted);
    if (!port) {
      missing.set(wanted, now());
      return null;
    }
    missing.delete(wanted);
    open.set(wanted, port);
    unreported = 0;
    if (opts.onEvent) opts.onEvent("open", port.name);
    return port;
  }

  function letGo(wanted) {
    const port = open.get(wanted);
    if (!port) return;
    open.delete(wanted);
    try {
      port.close();
    } catch (err) {
      // Already gone, which is why it is being let go of.
    }
    if (opts.onEvent) opts.onEvent("closed", port.name);
  }

  /** Send one checked request (lib/midi/request.js). True if every message left. */
  function send(request) {
    if (!driver || !driver.supported) {
      dropped++;
      return false;
    }
    let port;
    try {
      port = portFor(request.port);
    } catch (err) {
      fail(err);
      return false;
    }
    if (!port) {
      fail(new Error(request.port ? 'There is no MIDI port called "' + request.port + '"' : "There is no MIDI port to send to"));
      return false;
    }
    try {
      for (const message of request.messages) port.send(message);
      sent += request.messages.length;
      error = null;
      return true;
    } catch (err) {
      // Unplugged mid-show. Dropped, so the next send looks for it afresh.
      letGo(request.port);
      missing.set(request.port, now());
      fail(err);
      return false;
    }
  }

  function status() {
    return { open: Array.from(open.values(), (port) => port.name), sent: sent, dropped: dropped, error: error };
  }

  function close() {
    for (const wanted of Array.from(open.keys())) letGo(wanted);
  }

  return { send: send, status: status, close: close };
}

module.exports = { createMidiOutput: createMidiOutput, RETRY_MS: RETRY_MS };
