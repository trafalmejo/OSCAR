"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const { ProjectStore } = require("../lib/projects");
const createRouter = require("../routes/index");

async function withServer(run, deps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-serial-routes-"));
  const app = express();
  app.use(express.json());
  // The lock answers to loopback, and a test can only come from loopback, so
  // a header stands in for "this request came from a tablet".
  app.use((req, res, next) => {
    if (req.headers["x-test-remote"]) {
      // On the request, not the socket: keep-alive hands the same socket to the
      // next request, which may be the local one.
      Object.defineProperty(req, "socket", { value: { remoteAddress: "192.168.0.77" } });
    }
    next();
  });
  app.use("/", createRouter(Object.assign({ store: new ProjectStore(dir), serverIP: () => "192.168.0.5" }, deps)));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, body, headers) =>
  fetch(base + "/serial", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, headers),
    body: JSON.stringify(body),
  });

/** What serialControl() looks like to the router. */
function fakeSerial() {
  const calls = [];
  const state = { supported: true, reason: null, state: "idle", path: null, bitrate: 115200, sent: 0, dropped: 0, error: null };
  return {
    calls,
    state,
    status: () => Object.assign({}, state),
    list: async () => [{ path: "COM3", label: "COM3 -- Arduino" }],
    connect(portPath, bitrate) {
      calls.push(["connect", portPath, bitrate]);
      if (!portPath) return "Pick a serial port first.";
      state.state = "opening";
      state.path = portPath;
      return null;
    },
    disconnect() {
      calls.push(["disconnect"]);
      state.state = "idle";
      state.path = null;
    },
  };
}

test("GET /serial reports the link and the ports to choose from", async () => {
  const serial = fakeSerial();
  await withServer(async (base) => {
    const body = await (await fetch(base + "/serial")).json();
    assert.strictEqual(body.supported, true);
    assert.strictEqual(body.state, "idle");
    assert.deepStrictEqual(body.ports, [{ path: "COM3", label: "COM3 -- Arduino" }]);
  }, { serial });
});

test("POST /serial connects and disconnects", async () => {
  const serial = fakeSerial();
  await withServer(async (base) => {
    let res = await post(base, { action: "connect", path: "COM3", bitrate: 9600 });
    assert.strictEqual(res.status, 200);
    let body = await res.json();
    assert.strictEqual(body.state, "opening");
    assert.strictEqual(body.path, "COM3");
    assert.ok(Array.isArray(body.ports));

    res = await post(base, { action: "disconnect" });
    body = await res.json();
    assert.strictEqual(body.state, "idle");
    assert.deepStrictEqual(serial.calls, [["connect", "COM3", 9600], ["disconnect"]]);
  }, { serial });
});

test("POST /serial passes a complaint on as an error, with the state as it stands", async () => {
  await withServer(async (base) => {
    const res = await post(base, { action: "connect", path: "" });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Pick a serial port/);
    assert.strictEqual(body.state, "idle");
  }, { serial: fakeSerial() });
});

test("POST /serial refuses a request that does not say what it wants", async () => {
  const serial = fakeSerial();
  await withServer(async (base) => {
    for (const body of [{}, { action: "toggle" }, { path: "COM3" }]) {
      assert.strictEqual((await post(base, body)).status, 400);
    }
    assert.deepStrictEqual(serial.calls, []);
  }, { serial });
});

test("an OSCAR with no serial wired says so rather than failing", async () => {
  await withServer(async (base) => {
    const body = await (await fetch(base + "/serial")).json();
    assert.strictEqual(body.supported, false);
    assert.match(body.reason, /No serial support in this build/);
    assert.deepStrictEqual(body.ports, []);

    const res = await post(base, { action: "connect", path: "COM3" });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /No serial support in this build/);
  }, {});
});

test("a locked OSCAR lets only its own computer move the cable", async () => {
  const serial = fakeSerial();
  const lock = { isLocked: () => true, setLocked: () => {} };
  await withServer(async (base) => {
    const remote = { "x-test-remote": "1" };
    assert.strictEqual((await fetch(base + "/serial", { headers: remote })).status, 403);
    assert.strictEqual((await post(base, { action: "disconnect" }, remote)).status, 403);
    assert.deepStrictEqual(serial.calls, [], "a tablet must not be able to drop the board mid-show");

    assert.strictEqual((await fetch(base + "/serial")).status, 200);
    assert.strictEqual((await post(base, { action: "disconnect" })).status, 200);
  }, { serial, lock });
});

test("a locked OSCAR does not tell the network which port the board is on", async () => {
  const serial = fakeSerial();
  Object.assign(serial.state, { state: "waiting", path: "COM99", error: "Opening COM99: File not found", dropped: 3 });
  const diagnostics = () => ({ oscar: "1.2.3", serial: serial.status() });
  let locked = true;
  const lock = { isLocked: () => locked, setLocked: () => {} };
  await withServer(async (base) => {
    const remote = { "x-test-remote": "1" };
    const tablet = await (await fetch(base + "/diagnostics", { headers: remote })).json();
    assert.strictEqual(tablet.oscar, "1.2.3");
    assert.strictEqual(tablet.serial.path, null);
    assert.strictEqual(tablet.serial.error, null);
    assert.ok(JSON.stringify(tablet).indexOf("COM99") === -1, "the port name is nowhere in the answer");
    // What a bug report needs is still there.
    assert.strictEqual(tablet.serial.supported, true);
    assert.strictEqual(tablet.serial.state, "waiting");
    assert.strictEqual(tablet.serial.dropped, 3);

    // The computer running OSCAR, and anyone while unlocked, may edit and so may see.
    assert.strictEqual((await (await fetch(base + "/diagnostics")).json()).serial.path, "COM99");
    locked = false;
    assert.strictEqual((await (await fetch(base + "/diagnostics", { headers: remote })).json()).serial.path, "COM99");
  }, { serial, lock, diagnostics });
});

test("an unlocked OSCAR lets any editor on the network move the cable", async () => {
  const serial = fakeSerial();
  await withServer(async (base) => {
    const res = await post(base, { action: "connect", path: "COM3" }, { "x-test-remote": "1" });
    assert.strictEqual(res.status, 200);
  }, { serial, lock: { isLocked: () => false, setLocked: () => {} } });
});
