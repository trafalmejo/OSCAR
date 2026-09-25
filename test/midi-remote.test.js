"use strict";

// The supervised MIDI driver (lib/midi/remote.js + worker.js): the same
// surface createMidi() gives the server, with the native code in a child
// process that is restarted when it dies. The fake hardware lives in
// test/helpers/fake-midi-driver.js and is loaded inside the worker by env.

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { createRemoteMidi } = require("../lib/midi/remote");

const FAKE = path.join(__dirname, "helpers", "fake-midi-driver.js");

function until(check, ms, what) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    (function look() {
      if (check()) return resolve();
      if (Date.now() - started > ms) return reject(new Error("waited in vain for " + what()));
      setTimeout(look, 40);
    })();
  });
}

function supervised(t, options) {
  process.env.OSCAR_MIDI_TEST_DRIVER = FAKE;
  const events = [];
  const errors = [];
  const midi = createRemoteMidi(
    Object.assign(
      {
        onEvent: (event, name) => events.push([event, name]),
        onError: (err) => errors.push(String(err.message || err)),
        respawnMs: 150,
      },
      options
    )
  );
  t.after(() => {
    midi.close();
    delete process.env.OSCAR_MIDI_TEST_DRIVER;
  });
  return { midi, events, errors };
}

test("the worker boots, the ports flow, and a send makes its round trip back in", async (t) => {
  const { midi } = supervised(t);
  await until(() => midi.supported, 8000, () => "the worker to boot");
  await until(() => midi.ports().outputs.indexOf("Fake Out") !== -1, 4000, () => "the ports: " + JSON.stringify(midi.ports()));

  const heard = [];
  midi.onMessage((message, port, first) => heard.push([message, port, first]));
  midi.listenFor([""]);

  // A controller message out; the fake echoes it back through the input.
  assert.strictEqual(midi.send({ port: "", messages: [[0xb0, 7, 96]] }), true);
  await until(() => heard.length > 0, 8000, () => "the echo");
  assert.strictEqual(heard[0][0].type, "cc");
  assert.strictEqual(heard[0][0].number, 7);
  assert.strictEqual(heard[0][1], "Fake In");

  assert.strictEqual(midi.send({ port: "", messages: "garbage" }), false, "the gate is local and still strict");
  assert.strictEqual(midi.status().driver, "supervised");
});

test("a crash in the native code costs a moment of MIDI, never the server: respawned, re-told, still listening", async (t) => {
  const { midi, errors } = supervised(t);
  await until(() => midi.supported, 8000, () => "the worker to boot");
  midi.listenFor([""]);

  const heard = [];
  midi.onMessage(() => heard.push(1));

  // "die" aborts the worker the way RtMidi aborts on a stale Windows handle.
  midi.send({ port: "die", messages: [[0xb0, 1, 1]] });
  await until(() => errors.some((e) => /MIDI driver stopped/.test(e)), 8000, () => "the crash to be reported: " + errors.join("; "));
  assert.match(errors.find((e) => /MIDI driver stopped/.test(e)), /The show is unaffected/);

  // The supervisor brings a new worker up and tells it what the widgets wanted.
  await until(() => midi.supported, 8000, () => "the respawn");
  assert.ok(midi.status().restarts >= 1);

  await until(
    () => {
      midi.send({ port: "", messages: [[0xb0, 2, 3]] });
      return heard.length > 0;
    },
    8000,
    () => "listening to resume after the respawn"
  );
});

test("a learner waiting on a worker that dies learns nothing, honestly", async (t) => {
  const { midi } = supervised(t);
  await until(() => midi.supported, 8000, () => "the worker to boot");

  let told = "waiting";
  midi.learn((result) => (told = result), 30000);
  midi.send({ port: "die", messages: [[0xb0, 1, 1]] });
  await until(() => told !== "waiting", 8000, () => "the learner to be answered");
  assert.strictEqual(told, null);
});
