"use strict";

/**
 * Stop the forked server the way that lets it clean up.
 *
 * The packaged app used to call child.kill(). On Windows that is
 * TerminateProcess: no signal is delivered, the server's shutdown never runs,
 * and the DMX channels it was driving are neither zeroed nor terminated --
 * the stream simply stops mid-look. On macOS and Linux kill() is SIGTERM,
 * but Electron did not wait, so the release packets raced the app's exit.
 *
 * So the server is asked over the IPC channel it was forked with (server.js
 * answers a { type: "shutdown" } message by running its shutdown), and the
 * caller waits for it to exit. The kill stays as the fallback for a server
 * that does not answer in time, so a quit can never hang on it.
 */

const STOP_TIMEOUT_MS = 3000;

/**
 * @param {import("child_process").ChildProcess} child
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<void>} resolves once the server has exited, or once it
 *   has been killed for not exiting; never rejects
 */
function stopServer(child, options) {
  const timeoutMs = (options && options.timeoutMs) || STOP_TIMEOUT_MS;

  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();

    let timer = null;
    const done = () => {
      clearTimeout(timer);
      child.removeListener("exit", done);
      resolve();
    };
    const kill = () => {
      try {
        child.kill();
      } catch (err) {
        // Already gone; the exit event (or the resolve below) covers it.
      }
      done();
    };

    child.once("exit", done);

    if (!child.connected) return kill();
    try {
      child.send({ type: "shutdown" });
    } catch (err) {
      return kill();
    }
    timer = setTimeout(kill, timeoutMs);
  });
}

module.exports = { stopServer, STOP_TIMEOUT_MS };
