"use strict";

/**
 * How the packaged app stops the server it forked (lib/stop-server.js).
 *
 * The point of the module is that the server is asked, over IPC, and waited
 * for -- a kill runs none of its shutdown on Windows, so the DMX channels it
 * drives would be left mid-look -- with the kill kept only as the fallback.
 * The child here is a stand-in that records what was done to it.
 */

const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");

const { stopServer, STOP_TIMEOUT_MS } = require("../lib/stop-server");

function fakeChild(options) {
  const opts = Object.assign({ connected: true, answers: true }, options);
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.connected = opts.connected;
  child.sent = [];
  child.kills = 0;
  child.send = (msg) => {
    if (opts.sendThrows) throw new Error("channel closed");
    child.sent.push(msg);
    if (!opts.answers) return;
    setImmediate(() => {
      child.exitCode = 0;
      child.emit("exit", 0, null);
    });
  };
  child.kill = () => {
    child.kills++;
    setImmediate(() => {
      child.signalCode = "SIGTERM";
      child.emit("exit", null, "SIGTERM");
    });
  };
  return child;
}

test("the server is asked to shut down and waited for; a server that answers is never killed", async () => {
  const child = fakeChild();
  await stopServer(child);
  assert.deepStrictEqual(child.sent, [{ type: "shutdown" }]);
  assert.strictEqual(child.kills, 0);
  assert.strictEqual(child.listenerCount("exit"), 0, "nothing left listening");
});

test("a server that does not answer in time is killed, so a quit can never hang on it", async () => {
  const child = fakeChild({ answers: false });
  const started = Date.now();
  await stopServer(child, { timeoutMs: 20 });
  assert.deepStrictEqual(child.sent, [{ type: "shutdown" }], "it was asked first");
  assert.strictEqual(child.kills, 1);
  assert.ok(Date.now() - started < STOP_TIMEOUT_MS, "the test's own timeout was used");
});

test("a server with no channel to ask on, or one that has already gone, is handled without waiting", async () => {
  const gone = fakeChild();
  gone.exitCode = 0;
  await stopServer(gone);
  assert.deepStrictEqual(gone.sent, []);
  assert.strictEqual(gone.kills, 0);

  const mute = fakeChild({ connected: false });
  await stopServer(mute);
  assert.deepStrictEqual(mute.sent, []);
  assert.strictEqual(mute.kills, 1, "nothing to ask over: the kill is all there is");

  const broken = fakeChild({ sendThrows: true });
  await stopServer(broken);
  assert.strictEqual(broken.kills, 1, "a channel that fails on send is the same");

  await stopServer(null);
});
