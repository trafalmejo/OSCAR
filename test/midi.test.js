"use strict";

const test = require("node:test");
const assert = require("node:assert");
const express = require("express");

const { createMidi, loadDriver } = require("../lib/midi");
const createRouter = require("../routes/index");

/** A MIDI library with these ports, that counts what it is asked to let go of. */
function fakeLibrary(outputs, inputs, log) {
  const port = (names) =>
    class {
      getPortCount() { return names.length; }
      getPortName(i) { return names[i]; }
      destroy() { if (log) log.push("destroy"); }
    };
  return { Output: port(outputs), Input: port(inputs) };
}

test("the ports this computer has are listed by name, off one port kept for asking, which is let go of at the end", () => {
  const log = [];
  let made = 0;
  const library = fakeLibrary(["IAC Bus 1", "Launchpad"], ["Launchpad"], log);
  const count = (Port) => class extends Port { constructor() { super(); made++; } };
  const driver = loadDriver(() => ({ Output: count(library.Output), Input: count(library.Input) }));
  const midi = createMidi({ driver });
  assert.strictEqual(midi.supported, true);
  for (let i = 0; i < 3; i++) {
    assert.deepStrictEqual(midi.ports(), { supported: true, reason: null, outputs: ["IAC Bus 1", "Launchpad"], inputs: ["Launchpad"] });
  }
  // Making a port is the slow part, and the part the library complains
  // about on stderr when nothing is plugged in. Once each, however often asked.
  assert.strictEqual(made, 2);
  assert.deepStrictEqual(log, []);
  midi.close();
  assert.deepStrictEqual(log, ["destroy", "destroy"], "a probe that is kept for ever holds the system's MIDI service open");
});

test("a build where the library will not load says so, and OSCAR carries on", () => {
  const driver = loadDriver(() => { throw new Error("no native build was found"); });
  assert.strictEqual(driver.supported, false);
  const status = createMidi({ driver }).status();
  assert.strictEqual(status.supported, false);
  assert.match(status.reason, /cannot use MIDI.*no native build was found/);
  assert.deepStrictEqual([status.outputs, status.inputs], [[], []]);
});

test("a MIDI service that fails while being asked is reported, never thrown", () => {
  const driver = { supported: true, outputs: () => { throw new Error("ALSA went away"); }, inputs: () => [] };
  const status = createMidi({ driver }).ports();
  assert.strictEqual(status.reason, "ALSA went away");
  assert.deepStrictEqual(status.outputs, []);
});

test("the real library loads on this platform, or says why not", (t) => {
  // Not an assertion about hardware: a build machine has none. What matters
  // is that asking never throws, and the answer is in the run's log.
  const status = createMidi().status();
  t.diagnostic("MIDI here: " + JSON.stringify(status));
  assert.strictEqual(typeof status.supported, "boolean");
  assert.ok(Array.isArray(status.outputs) && Array.isArray(status.inputs));
});

// ---- what a device that may not edit is told ---------------------------------

async function diagnosticsAs({ locked, remote }) {
  const app = express();
  if (remote) {
    app.use((req, res, next) => {
      Object.defineProperty(req, "socket", { value: { remoteAddress: "192.168.1.55" }, writable: true });
      next();
    });
  }
  app.use("/", createRouter({
    store: {},
    serverIP: () => "192.168.0.5",
    lock: { isLocked: () => locked, setLocked: () => {} },
    diagnostics: () => ({ midi: { supported: true, reason: null, outputs: ["Launchpad", "IAC Bus 1"], inputs: ["Launchpad"] } }),
  }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    return (await (await fetch("http://127.0.0.1:" + server.address().port + "/diagnostics")).json()).midi;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("a tablet on a locked OSCAR learns how many MIDI ports there are, not what is plugged in", async () => {
  assert.deepStrictEqual((await diagnosticsAs({ locked: false, remote: true })).outputs, ["Launchpad", "IAC Bus 1"]);
  assert.deepStrictEqual((await diagnosticsAs({ locked: true, remote: false })).outputs, ["Launchpad", "IAC Bus 1"], "this computer always may");
  const hidden = await diagnosticsAs({ locked: true, remote: true });
  assert.deepStrictEqual([hidden.outputs, hidden.inputs], [[null, null], [null]]);
  assert.strictEqual(hidden.supported, true);
});

test("the inputs can be left unasked, for a caller that only wants somewhere to send", () => {
  let asked = 0;
  const driver = { supported: true, outputs: () => ["Launchpad"], inputs: () => { asked++; return []; } };
  assert.deepStrictEqual(createMidi({ driver }).ports({ inputs: false }), { supported: true, reason: null, outputs: ["Launchpad"], inputs: [] });
  assert.strictEqual(asked, 0);
});
