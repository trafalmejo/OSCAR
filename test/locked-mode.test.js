"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const { ProjectStore } = require("../lib/projects");
const { Settings } = require("../lib/settings");
const { isLoopbackAddress } = require("../lib/net");
const createRouter = require("../routes/index");

/**
 * Tests connect over loopback, which is exactly the case locked mode lets
 * through -- so `remote: true` rewrites the source address to make the request
 * look like it came from a tablet on the Wi-Fi.
 */
async function withServer(run, { locked = false, remote = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-lock-"));
  const store = new ProjectStore(dir);
  const settings = new Settings(path.join(dir, "settings.json"));
  settings.set("locked", locked);

  const app = express();
  app.set("views", path.join(__dirname, "..", "public"));
  app.set("view engine", "ejs");
  app.use(express.json());

  if (remote) {
    app.use((req, res, next) => {
      Object.defineProperty(req, "socket", {
        value: { remoteAddress: "192.168.1.55" },
        writable: true,
      });
      next();
    });
  }

  app.use(
    "/",
    createRouter({
      store,
      serverIP: () => "192.168.0.5",
      lock: {
        isLocked: () => !!settings.get("locked"),
        setLocked: (v) => settings.set("locked", v),
      },
    })
  );

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  try {
    await run("http://127.0.0.1:" + server.address().port, settings);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, url, body) =>
  fetch(base + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("isLoopbackAddress recognises this machine, and only this machine", () => {
  for (const local of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.0.0.53"]) {
    assert.strictEqual(isLoopbackAddress(local), true, local);
  }
  for (const remote of ["192.168.1.55", "10.0.0.2", "8.8.8.8", "", null, undefined]) {
    assert.strictEqual(isLoopbackAddress(remote), false, String(remote));
  }
});

test("unlocked: the network can edit, as before", async () => {
  await withServer(
    async (base) => {
      assert.strictEqual((await fetch(base + "/projects")).status, 200);
      const saved = await (
        await post(base, "/save", { name: "From the network", pages: [{}] })
      ).json();
      assert.match(saved.msg, /Saved/);
    },
    { locked: false, remote: true }
  );
});

test("locked: another device can use the controls but not edit", async () => {
  await withServer(
    async (base) => {
      // The control surface stays reachable -- this is what the tablets need.
      assert.strictEqual((await fetch(base + "/preview")).status, 200);
      assert.strictEqual((await fetch(base + "/show/preview")).status, 200);
      assert.strictEqual((await fetch(base + "/connection")).status, 200);

      // The editor does not -- including which board the cable goes to, which
      // is not something a tablet should be able to move mid-show.
      for (const [method, url] of [
        ["GET", "/projects"],
        ["GET", "/load/anything"],
        ["GET", "/serial"],
        ["DELETE", "/remove/anything"],
      ]) {
        const res = await fetch(base + url, { method });
        assert.strictEqual(res.status, 403, method + " " + url);
        assert.match((await res.json()).error, /locked/i);
      }

      const save = await post(base, "/save", { name: "Nope", pages: [{}] });
      assert.strictEqual(save.status, 403, "saving is refused");

      const serial = await post(base, "/serial", { connect: false });
      assert.strictEqual(serial.status, 403, "so is unplugging the hardware");
    },
    { locked: true, remote: true }
  );
});

test("locked: visiting the editor sends you to the control surface", async () => {
  await withServer(
    async (base) => {
      const res = await fetch(base + "/", { redirect: "manual" });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get("location"), "/preview");
    },
    { locked: true, remote: true }
  );
});

test("locked: the computer running OSCAR still edits normally", async () => {
  await withServer(
    async (base) => {
      assert.strictEqual((await fetch(base + "/projects")).status, 200);
      const saved = await (await post(base, "/save", { name: "Local edit", pages: [{}] })).json();
      assert.match(saved.msg, /Saved/);
      assert.strictEqual((await fetch(base + "/", { redirect: "manual" })).status, 200);
    },
    { locked: true, remote: false }
  );
});

test("only this computer can change the lock", async () => {
  await withServer(
    async (base, settings) => {
      const res = await post(base, "/lock", { locked: true });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(settings.get("locked"), false, "the setting did not move");
    },
    { locked: false, remote: true }
  );

  await withServer(
    async (base, settings) => {
      const res = await (await post(base, "/lock", { locked: true })).json();
      assert.strictEqual(res.locked, true);
      assert.strictEqual(settings.get("locked"), true);
    },
    { locked: false, remote: false }
  );
});

test("GET /lock says whether this device may toggle it", async () => {
  await withServer(
    async (base) => {
      const state = await (await fetch(base + "/lock")).json();
      assert.strictEqual(state.locked, true);
      assert.strictEqual(state.canToggle, false, "a tablet is told it cannot");
    },
    { locked: true, remote: true }
  );
});

test("the lock survives a restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-lock-restart-"));
  const file = path.join(dir, "settings.json");

  new Settings(file).set("locked", true);
  assert.strictEqual(new Settings(file).get("locked"), true, "read back by a fresh instance");
});
