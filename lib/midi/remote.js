"use strict";

/**
 * MIDI, supervised: the same surface createMidi() gives the server, with the
 * driver in a child process (worker.js) that is restarted when it dies.
 *
 * Why: the native backend can abort -- waking from sleep does it on Windows
 * -- and an abort ends the process it happens in. In the child, that costs a
 * moment of MIDI; in the server, it cost the whole show, twice. So the
 * server talks to a supervisor, and the supervisor keeps a worker alive:
 * respawned on a crash, told again which ports the widgets wanted, and held
 * back by a cool-down when it crashes over and over, so a machine whose MIDI
 * is broken plays the rest of the show instead of a crash loop.
 *
 * The surface stays synchronous where the server reads it synchronously:
 * ports() and status() answer from the worker's last snapshot, refreshed on
 * every ask; send() gates locally (buildRequest is pure) and hands on.
 */

const { fork } = require("node:child_process");
const path = require("node:path");
const { buildRequest } = require("./request");

const WORKER = path.join(__dirname, "worker.js");
/** How long after a crash the next worker starts. */
const RESPAWN_MS = 1000;
/** Crashes within WINDOW_MS that count as "over and over", and the rest it earns. */
const CRASH_WINDOW_MS = 60000;
const CRASH_LIMIT = 5;
const COOLDOWN_MS = 60000;

/**
 * @param {object} [options]
 *   onEvent(event, name)   as createMidi's
 *   onError(err)           as createMidi's
 *   workerPath, respawnMs, cooldownMs, now   for tests
 */
function createRemoteMidi(options) {
  const opts = options || {};
  const now = opts.now || Date.now;
  const onEvent = opts.onEvent || function () {};
  const onError = opts.onError || function () {};

  let child = null;
  let closing = false;
  let snapshot = { supported: false, reason: "The MIDI driver is starting.", outputs: [], inputs: [] };
  let restarts = 0;
  let crashes = []; // timestamps inside the window
  let respawnTimer = null;
  let bridged = []; // what listenFor() last said, re-told to every new worker
  const listeners = [];
  const learns = new Map(); // id -> fn
  let learnId = 0;

  const remote = {
    supported: false,

    ports(which) {
      poke({ t: "ports" });
      const at = { supported: snapshot.supported, reason: snapshot.reason || null, outputs: snapshot.outputs || [], inputs: snapshot.inputs || [] };
      if (which && which.inputs === false) at.inputs = [];
      return at;
    },

    /** The worker's last word on itself, plus the supervisor's: how often it has been restarted. */
    status() {
      poke({ t: "ports" });
      return Object.assign({}, snapshot, { driver: "supervised", restarts: restarts });
    },

    send(input) {
      const request = buildRequest(input);
      if (!request) return false;
      return poke({ t: "send", request: request });
    },

    listenFor(parts) {
      bridged = (parts || []).slice();
      poke({ t: "listenFor", parts: bridged });
    },

    onMessage(fn) {
      listeners.push(fn);
      return function () {
        const at = listeners.indexOf(fn);
        if (at !== -1) listeners.splice(at, 1);
      };
    },

    learn(fn, timeout) {
      const id = ++learnId;
      learns.set(id, fn);
      poke({ t: "learn", id: id, timeout: timeout });
      return function () {
        if (learns.delete(id)) poke({ t: "learn-stop", id: id });
      };
    },

    close() {
      closing = true;
      if (respawnTimer) clearTimeout(respawnTimer);
      if (child) {
        poke({ t: "close" });
        const dying = child;
        setTimeout(() => {
          if (dying.exitCode === null && dying.signalCode === null) dying.kill();
        }, 500).unref();
      }
    },
  };

  function poke(message) {
    if (!child || !child.connected) return false;
    try {
      child.send(message);
      return true;
    } catch (err) {
      return false;
    }
  }

  function heard(msg) {
    if (!msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "boot":
        remote.supported = msg.supported === true;
        snapshot = msg.status || snapshot;
        // The widgets' wants survive the worker that died with them.
        if (bridged.length) poke({ t: "listenFor", parts: bridged });
        return;
      case "status":
        snapshot = msg.status || snapshot;
        return;
      case "message":
        for (const fn of listeners.slice()) fn(msg.heard, msg.port, msg.first);
        return;
      case "event":
        onEvent(msg.event, msg.name);
        return;
      case "error":
        onError(new Error(msg.message));
        return;
      case "learned": {
        const fn = learns.get(msg.id);
        if (fn) {
          learns.delete(msg.id);
          fn(msg.result || null);
        }
        return;
      }
      default:
        return;
    }
  }

  function spawn() {
    respawnTimer = null;
    child = fork(opts.workerPath || WORKER, [], {
      // Nothing but what the worker needs; the fake driver for tests rides the env.
      env: process.env,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    child.on("message", heard);
    child.on("exit", (code, signal) => {
      child = null;
      if (closing) return;
      // A learner waiting on a worker that died learns nothing, honestly.
      for (const [id, fn] of Array.from(learns)) {
        learns.delete(id);
        fn(null);
      }
      const at = now();
      crashes = crashes.filter((t) => at - t < CRASH_WINDOW_MS);
      crashes.push(at);
      restarts++;
      const wait = crashes.length >= CRASH_LIMIT ? opts.cooldownMs || COOLDOWN_MS : opts.respawnMs || RESPAWN_MS;
      snapshot = Object.assign({}, snapshot, {
        supported: false,
        reason:
          "The MIDI driver stopped (" + (signal || "code " + code) + ") and restarts in " + Math.round(wait / 1000) + "s." +
          (crashes.length >= CRASH_LIMIT ? " It keeps stopping, so it now waits longer between tries." : ""),
      });
      remote.supported = false;
      onError(new Error("MIDI driver stopped (" + (signal || "code " + code) + "); restarting. The show is unaffected."));
      respawnTimer = setTimeout(spawn, wait);
      if (respawnTimer.unref) respawnTimer.unref();
    });
  }

  spawn();
  return remote;
}

module.exports = { createRemoteMidi, RESPAWN_MS, CRASH_LIMIT, COOLDOWN_MS };
