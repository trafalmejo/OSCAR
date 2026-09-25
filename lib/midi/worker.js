"use strict";

/**
 * The MIDI driver, alone in a process of its own.
 *
 * RtMidi's Windows backend can abort inside the native code -- waking from
 * sleep with a stale input handle does it -- and a native abort takes its
 * whole process down, past any JavaScript guard. So the process it takes
 * down is this one: a worker holding nothing but the driver, speaking to
 * OSCAR over process messages, supervised and restarted by
 * lib/midi/remote.js. OSCAR loses at most a moment of MIDI; the show, the
 * sockets and the DMX stream feel nothing.
 *
 * The protocol, parent to worker:
 *   { t: "send", request }        one widget's MIDI, already gated
 *   { t: "listenFor", parts }     which input ports the widgets want
 *   { t: "learn", id, timeout }   the next thing anybody plays
 *   { t: "learn-stop", id }       stop waiting
 *   { t: "ports" }                push a fresh ports/status snapshot
 *   { t: "close" }                close and exit
 *
 * Worker to parent:
 *   { t: "boot", supported, status }   once, when the driver is up
 *   { t: "message", heard, port, first }
 *   { t: "event", event, name }        output/input port events
 *   { t: "error", message }
 *   { t: "learned", id, result }
 *   { t: "status", status }            after "ports", and on port events
 *
 * A fake driver for the tests comes in by env: OSCAR_MIDI_TEST_DRIVER names
 * a module whose export is what loadDriver() returns.
 */

const { createMidi, loadDriver } = require("./index");

function say(message) {
  if (typeof process.send === "function") {
    try {
      process.send(message);
    } catch (err) {
      /* the parent is gone; the exit handler below follows */
    }
  }
}

const driver = process.env.OSCAR_MIDI_TEST_DRIVER
  ? require(process.env.OSCAR_MIDI_TEST_DRIVER)
  : loadDriver();

const midi = createMidi({
  driver: driver,
  onEvent: (event, name) => {
    say({ t: "event", event: event, name: name });
    say({ t: "status", status: midi.status() });
  },
  onError: (err) => say({ t: "error", message: String((err && err.message) || err) }),
});

midi.onMessage((heard, port, first) => say({ t: "message", heard: heard, port: port, first: first }));

const learns = new Map(); // id -> stop()

process.on("message", (msg) => {
  if (!msg || typeof msg !== "object") return;
  switch (msg.t) {
    case "send":
      midi.send(msg.request);
      return;
    case "listenFor":
      midi.listenFor(msg.parts);
      return;
    case "learn": {
      const stop = midi.learn((result) => {
        learns.delete(msg.id);
        say({ t: "learned", id: msg.id, result: result });
      }, msg.timeout);
      learns.set(msg.id, stop);
      return;
    }
    case "learn-stop": {
      const stop = learns.get(msg.id);
      if (stop) stop();
      return;
    }
    case "ports":
      say({ t: "status", status: midi.status() });
      return;
    case "close":
      midi.close();
      process.exit(0);
      return;
    default:
      return;
  }
});

// The parent dying must not leave a worker holding MIDI ports nobody owns.
process.on("disconnect", () => {
  midi.close();
  process.exit(0);
});

say({ t: "boot", supported: midi.supported, status: midi.status() });
