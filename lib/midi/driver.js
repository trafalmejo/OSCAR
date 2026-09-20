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
 * Which of `names` a widget's Port setting means, or -1.
 *
 * The exact name first. Then any port whose name contains what was typed,
 * whatever the case, because Windows numbers its ports ("loopMIDI Port 1",
 * and "2- Launchpad" on a second socket) and nobody should have to retype a
 * widget's Port for having moved a cable. Blank means the first port there is.
 */
function indexOfPort(names, wanted) {
  const want = String(wanted || "").trim();
  if (!want) return names.length ? 0 : -1;
  const exact = names.indexOf(want);
  if (exact !== -1) return exact;
  const lower = want.toLowerCase();
  for (let i = 0; i < names.length; i++) if (names[i].toLowerCase().indexOf(lower) !== -1) return i;
  return -1;
}

/** An open way out: { name, send(bytes), close() }, or null if no port answers to `wanted`. */
function openOutput(library, wanted) {
  const port = new library.Output();
  let open = false;
  try {
    const names = [];
    for (let i = 0; i < port.getPortCount(); i++) names.push(String(port.getPortName(i)));
    const index = indexOfPort(names, wanted);
    if (index === -1) return null;
    port.openPort(index);
    open = true;
    return {
      name: names[index],
      send: (bytes) => port.sendMessage(bytes),
      close: () => {
        if (typeof port.closePort === "function") port.closePort();
        if (typeof port.destroy === "function") port.destroy();
      },
    };
  } finally {
    if (!open && typeof port.destroy === "function") port.destroy();
  }
}

/**
 * Whatever MIDI this computer offers.
 *
 * The require is inside the try: on a platform with no prebuilt binary, or a
 * Linux with no ALSA, it throws, and OSCAR has to start all the same.
 *
 * @param {() => object} [load] where the library comes from; tests pass a fake
 * @returns {{supported: true, outputs: () => string[], inputs: () => string[], openOutput: (wanted: string) => object|null} | {supported: false, reason: string}}
 */
function loadDriver(load) {
  try {
    const library = (load || realLibrary)();
    return {
      supported: true,
      outputs: () => namesOf(library.Output),
      inputs: () => namesOf(library.Input),
      openOutput: (wanted) => openOutput(library, wanted),
    };
  } catch (err) {
    return { supported: false, reason: UNSUPPORTED + " (" + String((err && err.message) || err) + ")" };
  }
}

module.exports = { loadDriver: loadDriver, indexOfPort: indexOfPort, UNSUPPORTED: UNSUPPORTED };
