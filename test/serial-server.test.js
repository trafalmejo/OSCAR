"use strict";

/**
 * The real server.js with a serial port remembered that is not there.
 *
 * lib/serial.js is tested against a fake transport; this is the wiring. An
 * installation whose board is unplugged at boot is the ordinary bad morning,
 * and it has to start, say what it is waiting for, refuse to pretend a
 * message went anywhere, and still exit when asked -- a retry timer that
 * held the process open would hang the packaged app on quit.
 *
 * Nothing here needs a serial port, and nothing assumes this build can open
 * one: on a build without the driver the same requests must answer, and say
 * so.
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const dgram = require("node:dgram");
const http = require("node:http");
const { fork } = require("node:child_process");

const SERVER = path.join(__dirname, "..", "server.js");
const START_MS = 20000;
const EXIT_MS = 10000;
const NO_SUCH_PORT = process.platform === "win32" ? "COM254" : "/dev/oscar-no-such-port";

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

function getJson(port, route) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: port, path: route }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

function until(check, ms, what) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function poll() {
      if (check()) return resolve();
      if (Date.now() - started > ms) return reject(new Error("timed out waiting for " + what()));
      setTimeout(poll, 50);
    })();
  });
}

test("a server whose remembered board is unplugged starts, says so, drops honestly and still exits", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-serial-"));
  const settingsFile = path.join(dir, "settings.json");
  fs.writeFileSync(settingsFile, JSON.stringify({ locked: false, serial: { path: NO_SUCH_PORT, bitrate: 57600 } }));

  const httpPort = await freeTcpPort();
  const socketPort = await freeTcpPort();
  const env = Object.assign({}, process.env, {
    OSCAR_HTTP_PORT: String(httpPort),
    OSCAR_SOCKET_PORT: String(socketPort),
    OSCAR_OSC_IN_PORT: String(await freeUdpPort()),
    OSCAR_LAN_PORT: String(await freeUdpPort()),
    OSCAR_LOCAL_PORT: String(await freeUdpPort()),
    OSCAR_DMX_PORT: "0",
    OSCAR_PROJECTS_DIR: path.join(dir, "projects"),
    OSCAR_SETTINGS_FILE: settingsFile,
    OSCAR_NO_OPEN: "1",
    OSCAR_NO_UPDATE_CHECK: "1",
  });

  const child = fork(SERVER, [], { env, execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));

  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the server did not start:\n" + output)), START_MS);
    child.on("message", (msg) => {
      if (msg && msg.type === "ready") {
        clearTimeout(timer);
        resolve();
      }
    });
    exited.then(() => {
      clearTimeout(timer);
      reject(new Error("the server stopped before it was ready:\n" + output));
    });
  });

  const diagnostics = await getJson(httpPort, "/diagnostics");
  assert.strictEqual(diagnostics.status, 200);
  const serial = diagnostics.body.serial;
  assert.ok(serial, "diagnostics carries the serial state");
  assert.strictEqual(typeof serial.supported, "boolean");

  const report = await getJson(httpPort, "/serial");
  assert.strictEqual(report.status, 200);
  assert.ok(Array.isArray(report.body.ports));

  if (serial.supported) {
    // Remembered, asked for at the remembered rate, and not there.
    assert.strictEqual(report.body.path, NO_SUCH_PORT);
    assert.strictEqual(report.body.bitrate, 57600);
    await until(
      () => /Serial: waiting for /.test(output),
      5000,
      () => "the banner to say what it is waiting for:\n" + output
    );
  } else {
    assert.match(String(report.body.reason), /No serial support in this build/);
    assert.match(output, /Serial: NOT sending to the remembered port/);
  }

  // A widget aimed at the cable, with the empty Port the settings allow
  // there. The browser libraries are optional in a checkout, like elsewhere.
  let ioClient = null;
  try {
    ioClient = require(path.join(__dirname, "..", "public", "node_modules", "socket.io-client"));
  } catch (err) {
    /* not installed: the HTTP half above still ran */
  }
  if (ioClient) {
    const socket = ioClient.io("http://127.0.0.1:" + socketPort, { transports: ["websocket"], reconnection: false });
    t.after(() => socket.close());
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    socket.emit("osc", { ip: "serial", port: "", address: "/push1", args: [{ type: "i", value: 1 }] });
    await until(
      () => /Not sent to serial: \/push1/.test(output),
      5000,
      () => "the drop to be reported:\n" + output
    );
    // Dropped, and not quietly sent to a host called "serial" instead.
    assert.doesNotMatch(output, /Sending \/push1/);
    const after = await getJson(httpPort, "/serial");
    assert.strictEqual(after.body.dropped, 1);
    socket.close();
  }

  child.send({ type: "shutdown" });
  let exitTimer;
  const code = await Promise.race([
    exited,
    new Promise((resolve, reject) => {
      exitTimer = setTimeout(() => reject(new Error("the server did not exit:\n" + output)), EXIT_MS);
    }),
  ]);
  clearTimeout(exitTimer);
  assert.strictEqual(code, 0);

  // Shutting down lets go of the port without forgetting it.
  const saved = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  assert.deepStrictEqual(saved.serial, { path: NO_SUCH_PORT, bitrate: 57600 });
});
