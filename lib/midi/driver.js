"use strict";

/**
 * The one file that touches the native MIDI library.
 *
 * MIDI is not a network protocol: it goes through the operating system's own
 * MIDI ports, which Node cannot reach without a compiled module. Everything
 * else in lib/midi is handed what this returns, so a test, or a build where
 * the module would not load, swaps this and nothing more.
 */

const UNSUPPORTED = "This build of OSCAR cannot use MIDI.";

function realLibrary() {
  return require("@julusian/midi");
}

/** The names of the ports one direction has, asked of a port that is thrown away after. */
function namesOf(Port) {
  const port = new Port();
  try {
    const names = [];
    for (let i = 0; i < port.getPortCount(); i++) names.push(String(port.getPortName(i)));
    return names;
  } finally {
    // The library keeps a handle on the system's MIDI service until told to let go.
    if (typeof port.destroy === "function") port.destroy();
  }
}

/**
 * Whatever MIDI this computer offers.
 *
 * The require is inside the try: on a platform with no prebuilt binary, or a
 * Linux with no ALSA, it throws, and OSCAR has to start all the same.
 *
 * @param {() => object} [load] where the library comes from; tests pass a fake
 * @returns {{supported: true, outputs: () => string[], inputs: () => string[]} | {supported: false, reason: string}}
 */
function loadDriver(load) {
  try {
    const library = (load || realLibrary)();
    return {
      supported: true,
      outputs: () => namesOf(library.Output),
      inputs: () => namesOf(library.Input),
    };
  } catch (err) {
    return { supported: false, reason: UNSUPPORTED + " (" + String((err && err.message) || err) + ")" };
  }
}

module.exports = { loadDriver: loadDriver, UNSUPPORTED: UNSUPPORTED };
