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

function namesOn(port) {
  const names = [];
  for (let i = 0; i < port.getPortCount(); i++) names.push(String(port.getPortName(i)));
  return names;
}

/**
 * The names of the ports one direction has.
 *
 * Asked of one port kept for the purpose, never opened. Making a port is what
 * is slow, and what makes the library complain on stderr when there is nothing
 * plugged in; counting again on the same one is neither, and sees what was
 * plugged in since.
 */
function lister(Port) {
  let probe = null;
  const names = function () {
    if (!probe) probe = new Port();
    return namesOn(probe);
  };
  names.close = function () {
    // The library keeps a handle on the system's MIDI service until told to let go.
    if (probe && typeof probe.destroy === "function") probe.destroy();
    probe = null;
  };
  return names;
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
    const names = namesOn(port);
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
 * An open way in: { name, close() }, or null if there is no port of exactly
 * that name. `onMessage` is handed the bytes of each message as it arrives.
 */
function openInput(library, name, onMessage) {
  const port = new library.Input();
  let open = false;
  try {
    const index = namesOn(port).indexOf(name);
    if (index === -1) return null;
    port.on("message", function (delta, bytes) {
      onMessage(bytes);
    });
    port.openPort(index);
    open = true;
    return {
      name: name,
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
    const outputs = lister(library.Output);
    const inputs = lister(library.Input);
    return {
      supported: true,
      outputs: outputs,
      inputs: inputs,
      openOutput: (wanted) => openOutput(library, wanted),
      openInput: (name, onMessage) => openInput(library, name, onMessage),
      close: () => {
        outputs.close();
        inputs.close();
      },
    };
  } catch (err) {
    return { supported: false, reason: UNSUPPORTED + " (" + String((err && err.message) || err) + ")" };
  }
}

module.exports = { loadDriver: loadDriver, indexOfPort: indexOfPort, UNSUPPORTED: UNSUPPORTED };
