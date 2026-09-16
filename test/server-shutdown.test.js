"use strict";

/**
 * The server, forked the way the packaged app forks it, shutting down when
 * asked over IPC.
 *
 * On Windows the app cannot deliver a signal (its kill() is TerminateProcess,
 * which runs nothing in the server), so the shutdown that releases the DMX
 * channels has to be reachable another way. This starts a real server.js and
 * checks that the message, and the channel closing without one, both run it
 * and end the process cleanly.
 *
 * Every port is picked free at the moment of the test: a fixed one collides
 * with whatever else is running on the machine, and a server that cannot
 * bind is a different failure from the one being tested.
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const dgram = require("node:dgram");
const { fork } = require("node:child_process");

const SERVER = path.join(__dirname, "..", "server.js");
const START_MS = 20000;
const EXIT_MS = 10000;

function freeTcpPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function freeUdpPort() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", reject);
    socket.bind(0, () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}

async function startServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-shutdown-"));
  const env = Object.assign({}, process.env, {
    OSCAR_HTTP_PORT: String(await freeTcpPort()),
    OSCAR_SOCKET_PORT: String(await freeTcpPort()),
    OSCAR_OSC_IN_PORT: String(await freeUdpPort()),
    OSCAR_LAN_PORT: String(await freeUdpPort()),
    OSCAR_LOCAL_PORT: String(await freeUdpPort()),
    OSCAR_DMX_PORT: "0",
    OSCAR_PROJECTS_DIR: path.join(dir, "projects"),
    OSCAR_SETTINGS_FILE: path.join(dir, "settings.json"),
    OSCAR_NO_OPEN: "1",
    OSCAR_NO_UPDATE_CHECK: "1",
  });

  const child = fork(SERVER, [], {
    env,
    // Electron forks with no node flags of its own; the test runner's must
    // not leak into the server either.
    execArgv: [],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));

  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));

  // Whatever happens, no server outlives its test.
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the server did not start:\n" + output)), START_MS);
    child.on("message", (msg) => {
      if (msg && msg.type === "ready") {
        clearTimeout(timer);
        resolve(msg);
      }
    });
    exited.then(() => {
      clearTimeout(timer);
      reject(new Error("the server stopped before it was ready:\n" + output));
    });
  });

  const exit = () =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the server did not exit:\n" + output)), EXIT_MS);
      exited.then((result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });

  return { child, exit, output: () => output };
}

test("a shutdown message over the IPC channel runs the server's shutdown and ends it", async (t) => {
  const server = await startServer(t);
  server.child.send({ type: "shutdown" });
  const { code } = await server.exit();
  assert.strictEqual(code, 0);
  assert.match(server.output(), /Shutting OSCAR down/);
});

test("the channel closing without a request is taken as the app being gone, and the server follows it", async (t) => {
  const server = await startServer(t);
  server.child.disconnect();
  const { code } = await server.exit();
  assert.strictEqual(code, 0);
  assert.match(server.output(), /Shutting OSCAR down/);
});
