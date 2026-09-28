"use strict";

/**
 * A published bridge works with no browser anywhere.
 *
 * The promise lib/widgets/bridge.js makes, tested on a real server.js with no
 * page connected: nothing asks for anything except the published surface.
 * Found broken on a Raspberry Pi (2026-09-28): the MIDI input a published
 * bridge listened on opened only while a browser tab happened to want the
 * same port, because the server asked "if (midi.supported)" once at start,
 * before the MIDI worker had booted and said yes.
 *
 * The MIDI hardware is test/helpers/fake-midi-driver.js, loaded inside the
 * worker by env: one input, "Fake In". OSC is real UDP on loopback.
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const dgram = require("node:dgram");
const { fork } = require("node:child_process");
const osc = require("osc");

const { PublishedStore } = require("../lib/published");
const { exportAttributes } = require("../lib/export/config");
const { byName } = require("../lib/widgets");

const SERVER = path.join(__dirname, "..", "server.js");
const FAKE_MIDI = path.join(__dirname, "helpers", "fake-midi-driver.js");
const START_MS = 20000;
const WAIT_MS = 15000;

function freePort(kind) {
  return new Promise((resolve, reject) => {
    if (kind === "udp") {
      const socket = dgram.createSocket("udp4");
      socket.once("error", reject);
      socket.bind(0, () => {
        const port = socket.address().port;
        socket.close(() => resolve(port));
      });
      return;
    }
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

/** A widget's markup as the export writes it (as test/surfaces.test.js does). */
function tag(name, id, settings) {
  const definition = byName[name];
  const config = Object.assign({}, definition.defaults, settings);
  const attributes = exportAttributes(name, (key) => config[key]);
  const text = Object.entries(Object.assign({ id }, attributes))
    .map(([key, value]) => key + '="' + String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"')
    .join(" ");
  return "<" + definition.tag + " " + text + "></" + definition.tag + ">";
}

function until(check, what) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    (function look() {
      if (check()) return resolve();
      if (Date.now() - started > WAIT_MS) return reject(new Error("waited in vain for " + what()));
      setTimeout(look, 50);
    })();
  });
}

/** server.js with one published page, the fake MIDI driver, and no browser. */
async function startServer(t, page) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-unattended-"));
  const projects = path.join(dir, "projects");
  await new PublishedStore(path.join(projects, "published")).save("Rig", page);

  const oscIn = await freePort("udp");
  const env = Object.assign({}, process.env, {
    OSCAR_HTTP_PORT: String(await freePort("tcp")),
    OSCAR_SOCKET_PORT: String(await freePort("tcp")),
    OSCAR_OSC_IN_PORT: String(oscIn),
    OSCAR_LAN_PORT: String(await freePort("udp")),
    OSCAR_LOCAL_PORT: String(await freePort("udp")),
    OSCAR_DMX_PORT: "0",
    OSCAR_PROJECTS_DIR: projects,
    OSCAR_SETTINGS_FILE: path.join(dir, "settings.json"),
    OSCAR_NO_OPEN: "1",
    OSCAR_NO_UPDATE_CHECK: "1",
    OSCAR_NO_TELEMETRY: "1",
    OSCAR_MIDI_TEST_DRIVER: FAKE_MIDI,
  });
  const child = fork(SERVER, [], { env, execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
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
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("the server stopped before it was ready:\n" + output));
    });
  });
  return { oscIn, output: () => output };
}

test("a published MIDI bridge opens its input with no page connected", async (t) => {
  const page =
    "<!doctype html><html><body>" +
    tag("oscar-slider", "fader", {
      midiListen: true,
      midiInPort: "Fake In",
      midiType: "cc",
      midiNumber: 7,
      dmxEnabled: true,
      dmxSendWhen: "data",
    }) +
    "</body></html>";
  const server = await startServer(t, page);

  // No socket, no browser: only the published surface can have asked.
  await until(() => /MIDI: listening to Fake In/.test(server.output()), () => "the input to open:\n" + server.output());
});

test("a published OSC bridge passes on what comes in with no page connected", async (t) => {
  const out = dgram.createSocket("udp4");
  const received = [];
  out.on("message", (buffer) => received.push(osc.readPacket(buffer, { metadata: false })));
  await new Promise((resolve) => out.bind(0, "127.0.0.1", resolve));
  t.after(() => out.close());

  const page =
    "<!doctype html><html><body>" +
    tag("oscar-slider", "sensor", {
      message: "/sensor",
      listen: true,
      oscEnabled: true,
      oscSendWhen: "data",
      ip: "127.0.0.1",
      port: out.address().port,
      min: 0,
      max: 1,
    }) +
    "</body></html>";
  const server = await startServer(t, page);

  const send = dgram.createSocket("udp4");
  t.after(() => send.close());
  const packet = Buffer.from(osc.writePacket({ address: "/sensor", args: [{ type: "f", value: 0.5 }] }));
  // Sent until it is passed on: the published store is read on the first message.
  await until(() => {
    if (!received.length) send.send(packet, server.oscIn, "127.0.0.1");
    return received.length > 0;
  }, () => "the bridged message:\n" + server.output());

  assert.strictEqual(received[0].address, "/sensor");
  assert.strictEqual(received[0].args[0], 0.5);
});
