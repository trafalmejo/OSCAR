"use strict";

/**
 * What a published page is on a phone: a thing that can sit on the home
 * screen, fill the screen, come back from sleep, and say which tablet it is.
 *
 * The pieces live where they belong -- lib/published.js, routes/index.js,
 * lib/activity.js, oscar_socket.js, relay_socket.js, adapters/standalone.js
 * -- and are checked here together because they are one promise.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const express = require("express");

const { PublishedStore, markServed, manifestFor } = require("../lib/published");
const { ProjectStore } = require("../lib/projects");
const { socketOrigin, deviceName } = require("../lib/activity");
const createRouter = require("../routes/index");
const relaySocket = require("../public/src/relay_socket");
const standalone = require("../public/src/adapters/standalone");
const { WIDGET_SELECTOR } = require("../lib/export/config");
const { fakeElement } = require("./helpers/fake-dom");

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

const PAGE =
  "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>Main Stage</title></head><body>" +
  '<button id="b1" data-oscar="oscar-button">Go</button>' +
  "<script>\nwindow.OSCAR_EXPORT = {\"host\":\"192.168.0.5\",\"port\":8081};\n</script></body></html>";

// ---- the home screen -----------------------------------------------------------

test("a served page carries what a phone reads to put it on the home screen; the stored page and a downloaded file do not", () => {
  const served = markServed(PAGE, 18301, "main-stage");
  const head = served.slice(0, served.indexOf("</head>"));
  assert.ok(head.includes('<link rel="manifest" href="/show/main-stage.webmanifest">'), "the manifest, in the head");
  assert.ok(head.includes('<meta name="apple-mobile-web-app-capable" content="yes">'), "iOS's word for opening without Safari");
  assert.ok(head.includes('<meta name="mobile-web-app-capable" content="yes">'));
  assert.ok(head.includes('<meta name="apple-mobile-web-app-status-bar-style" content="black">'), "the clock stays above the page, not over a control");
  assert.ok(head.includes('<link rel="apple-touch-icon" href="/images/oscar-circle.png">'));
  assert.ok(served.includes('window.OSCAR_SERVED = {"port":18301};'), "and still says who served it");
  // Without an id -- an older caller -- the page is marked as served and nothing more.
  assert.ok(!markServed(PAGE, 18301).includes("manifest"));
  // An id that is not one adds nothing: it would be written into a URL.
  for (const bad of ["../x", "Main Stage", "", null, 7]) assert.ok(!markServed(PAGE, 18301, bad).includes("manifest"), String(bad));
  // A page with no head to put it in is served as it is.
  const headless = PAGE.replace(/<head>.*<\/head>/, "");
  assert.ok(markServed(headless, 18301, "main-stage").includes("OSCAR_SERVED") && !markServed(headless, 18301, "main-stage").includes("manifest"));
});

test("the manifest names the surface by its project, falling back to its address, and makes it an app of its own", () => {
  const m = manifestFor("main-stage", "Main Stage");
  assert.strictEqual(m.name, "Main Stage");
  assert.strictEqual(m.id, "/show/main-stage", "two surfaces on one phone are two icons");
  assert.strictEqual(m.start_url, "/show/main-stage");
  assert.strictEqual(m.scope, "/show/");
  assert.strictEqual(m.display, "standalone");
  assert.ok(m.icons.length && m.icons[0].src === "/images/oscar-circle.png");
  assert.strictEqual(manifestFor("main-stage", "").name, "main-stage");
  assert.strictEqual(manifestFor("main-stage", "  ").name, "main-stage");
  assert.strictEqual(manifestFor("main-stage", undefined).name, "main-stage");
});

async function withServer(run, options = {}) {
  const publicDir = tmp("oscar-phone-public-");
  const runtime = path.join(publicDir, "runtime.js");
  const socketio = path.join(publicDir, "socketio.js");
  fs.writeFileSync(runtime, "/* runtime */");
  fs.writeFileSync(socketio, "/* socket.io */");
  const published = new PublishedStore(tmp("oscar-phone-published-"));
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use(
    "/",
    createRouter({
      store: new ProjectStore(tmp("oscar-phone-projects-")),
      serverIP: () => "192.168.0.5",
      socketPort: () => 18301,
      published,
      exportFiles: { runtime, socketio, widgetCss: [] },
      devicesOn: options.devicesOn,
      namesOn: options.namesOn,
    })
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port, published);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET /show/<id>.webmanifest answers beside the page, named after the project, and 404s where there is no page", async () => {
  await withServer(async (base, store) => {
    await store.save("Main Stage", PAGE, { project: { id: "p-1", name: "Main Stage" } });
    const res = await fetch(base + "/show/main-stage.webmanifest");
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get("content-type"), /application\/manifest\+json/);
    assert.strictEqual(res.headers.get("cache-control"), "no-store", "a project renamed and published again shows its new name");
    const manifest = JSON.parse(await res.text());
    assert.strictEqual(manifest.name, "Main Stage");
    assert.strictEqual(manifest.start_url, "/show/main-stage");

    // Published with no project kept beside it: named by its address.
    await store.save("Lobby", PAGE, null);
    assert.strictEqual(JSON.parse(await (await fetch(base + "/show/lobby.webmanifest")).text()).name, "lobby");

    assert.strictEqual((await fetch(base + "/show/nothing-here.webmanifest")).status, 404);
    assert.strictEqual((await fetch(base + "/show/..%2Fsecret.webmanifest")).status, 404);

    // And the page itself now links to it.
    const page = await (await fetch(base + "/show/main-stage")).text();
    assert.ok(page.includes('<link rel="manifest" href="/show/main-stage.webmanifest">'));
  });
});

test("GET /show lists what is served, by name, leaving out what is switched off, locked or not", async () => {
  await withServer(async (base, store) => {
    assert.deepStrictEqual(await (await fetch(base + "/show")).json(), []);
    await store.save("Main Stage", PAGE, { project: { id: "p-1", name: "Main Stage" } });
    await store.save("Lobby", PAGE, null);
    await store.save("Old Bar", PAGE, null);
    await store.setAccess("old-bar", "off");
    const res = await fetch(base + "/show");
    assert.strictEqual(res.headers.get("cache-control"), "no-store");
    assert.deepStrictEqual(await res.json(), [
      { id: "lobby", path: "/show/lobby", name: "lobby" },
      { id: "main-stage", path: "/show/main-stage", name: "Main Stage" },
    ]);
    // Nothing the editor's list carries: no project id, no stamp, no devices.
    for (const row of await (await fetch(base + "/show")).json()) assert.deepStrictEqual(Object.keys(row).sort(), ["id", "name", "path"]);
  });
});

// ---- which tablet ----------------------------------------------------------------

test("a page that names its device is known by that name, with its address kept", () => {
  assert.deepStrictEqual(socketOrigin("show:stage-left", "::ffff:192.168.1.31", "Bar left"), {
    origin: "local",
    surface: "stage-left",
    device: "Bar left (192.168.1.31)",
  });
  assert.deepStrictEqual(socketOrigin("show:stage-left", "::ffff:192.168.1.31", "  Bar left  ").device, "Bar left (192.168.1.31)", "trimmed");
  assert.deepStrictEqual(socketOrigin("show:stage-left", "::ffff:192.168.1.31", undefined).device, "192.168.1.31", "unnamed: as before");
  assert.deepStrictEqual(socketOrigin("canvas", "::1", "Bar left"), { origin: "canvas" }, "the editor carries no device, named or not");
});

test("a name is one short printable line, or it is nothing", () => {
  assert.strictEqual(deviceName("Bar left"), "Bar left");
  assert.strictEqual(deviceName("Tablette nº 2 · côté jardin"), "Tablette nº 2 · côté jardin");
  assert.strictEqual(deviceName(""), undefined);
  assert.strictEqual(deviceName("   "), undefined);
  assert.strictEqual(deviceName("a".repeat(41)), undefined, "too long to be a label");
  assert.strictEqual(deviceName("a".repeat(40)), "a".repeat(40));
  assert.strictEqual(deviceName("two\nlines"), undefined);
  assert.strictEqual(deviceName("bell\u0007"), undefined);
  assert.strictEqual(deviceName(["Bar left"]), undefined, "a repeated query parameter is not a string");
  assert.strictEqual(deviceName(7), undefined);
});

test("the names reach the Running window beside the count, and only the names", async () => {
  const on = { "main-stage": ["Bar left", "Bar right"] };
  await withServer(
    async (base, store) => {
      await store.save("Main Stage", PAGE, null);
      const [row] = await (await fetch(base + "/published")).json();
      assert.strictEqual(row.devices, 3);
      assert.deepStrictEqual(row.named, ["Bar left", "Bar right"], "the third gave no name");
    },
    { devicesOn: () => 3, namesOn: (id) => on[id] || [] }
  );
});

test("the page's socket carries the device's name in its handshake, and nothing when it has none", () => {
  const SOURCE = fs.readFileSync(path.join(__dirname, "..", "public", "src", "oscar_socket.js"), "utf8");
  function handshake(options) {
    const made = [];
    const context = {
      io: (url, opts) => {
        made.push({ url, opts });
        return { on() {}, emit() {} };
      },
      window: { location: { hostname: "localhost" } },
      console: { log() {}, warn() {} },
    };
    vm.createContext(context);
    vm.runInContext(SOURCE + "\nthis.oscar_socket = oscar_socket;", context);
    context.oscar_socket({}, Object.assign({ ipserver: "localhost", socketPort: 18201 }, options));
    // As the wire would carry it: an object made in the vm has a prototype of its own.
    return made[0].opts.query === undefined ? undefined : JSON.parse(JSON.stringify(made[0].opts.query));
  }
  assert.deepStrictEqual(handshake({ from: "show:main-stage", device: "Bar left" }), { from: "show:main-stage", device: "Bar left" });
  assert.deepStrictEqual(handshake({ from: "show:main-stage" }), { from: "show:main-stage" });
  assert.deepStrictEqual(handshake({ from: "show:main-stage", device: "" }), { from: "show:main-stage" });
  assert.strictEqual(handshake({}), undefined);
});

test("the runtime reads the name off the page's address and keeps it on the device", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "src", "oscar_runtime.js"), "utf8");
  assert.match(source, /get\("device"\)/, "?device= on the address");
  assert.match(source, /storage\.setItem\(KEY, said\)/, "kept for the next open");
  assert.match(source, /storage\.removeItem\(KEY\)/, "and forgotten with ?device=");
  assert.match(source, /device: device, surface: true, from: pageFrom\(window\.location\)/, "handed to the socket");
  assert.match(source, /window: window,/, "the page can hear itself being shown again");
});

// ---- back from sleep ---------------------------------------------------------------

test("a relay socket can be dropped and made again at once, retry or no retry", () => {
  const made = [];
  let timers = [];
  function FakeSocket(url) {
    this.url = url;
    this.readyState = 0;
    this.closed = false;
    made.push(this);
  }
  FakeSocket.prototype.send = function () {};
  FakeSocket.prototype.close = function () {
    this.closed = true;
    this.readyState = 3;
    if (this.onclose) this.onclose();
  };
  const socket = relaySocket("wss://relay.test/r/lobby/ws", {
    WebSocket: FakeSocket,
    setTimeout: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      timers = timers.filter((x) => x !== t);
    },
    now: () => 0,
  });
  const heard = [];
  socket.on("connect", () => heard.push("connect"));
  socket.on("disconnect", () => heard.push("disconnect"));

  // Online all the way through, then the phone sleeps: the socket looks fine and is not.
  made[0].readyState = 1;
  made[0].onopen();
  made[0].onmessage({ data: JSON.stringify({ t: "host", online: true }) });
  assert.deepStrictEqual(heard, ["connect"]);
  socket.reconnect();
  assert.strictEqual(made.length, 2, "a new connection, now");
  assert.strictEqual(made[0].closed, true, "the old one let go");
  assert.deepStrictEqual(heard, ["connect", "disconnect"], "and the page told, once, not once per handler of the old socket");
  made[1].readyState = 1;
  made[1].onopen();
  made[1].onmessage({ data: JSON.stringify({ t: "host", online: true }) });
  assert.deepStrictEqual(heard, ["connect", "disconnect", "connect"]);

  // Dropped and waiting out a retry: the wait is replaced by a connection now.
  made[1].close();
  const waiting = timers.length; // the retry, and the latency readout's own timer
  socket.reconnect();
  assert.strictEqual(made.length, 3);
  assert.strictEqual(timers.length, waiting - 1, "the retry is gone, not left behind to double the connection");

  socket.close();
  socket.reconnect();
  assert.strictEqual(made.length, 3, "a closed socket stays closed");
});

test("reconnectNow speaks socket.io's pair where there is no reconnect of the socket's own", () => {
  const said = [];
  standalone.reconnectNow({ disconnect: () => said.push("disconnect"), connect: () => said.push("connect") });
  assert.deepStrictEqual(said, ["disconnect", "connect"]);
  standalone.reconnectNow({ reconnect: () => said.push("reconnect"), disconnect: () => said.push("no"), connect: () => said.push("no") });
  assert.deepStrictEqual(said, ["disconnect", "connect", "reconnect"]);
  standalone.reconnectNow({});
  standalone.reconnectNow(null);
});

/** A document and window a page can be started in, that hear events. */
function phonePage() {
  const listeners = {};
  const body = { children: [], appendChild: (el) => body.children.push(el) };
  const listen = (type, fn) => (listeners[type] = listeners[type] || []).push(fn);
  const doc = {
    body,
    visibilityState: "visible",
    createElement: () => fakeElement(),
    querySelectorAll(selector) {
      assert.strictEqual(selector, WIDGET_SELECTOR);
      return [];
    },
    addEventListener: listen,
    removeEventListener() {},
    fire: (type) => (listeners[type] || []).forEach((fn) => fn({})),
  };
  const win = { addEventListener: listen, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
  return { doc, win };
}

/** The bridge oscar_socket() builds, with a socket that can be dropped and remade. */
function sleepyBridge() {
  const handlers = {};
  const said = [];
  const bridge = {
    socket: {
      connected: true,
      on(event, fn) {
        (handlers[event] = handlers[event] || []).push(fn);
      },
      disconnect: () => said.push("disconnect"),
      connect: () => said.push("connect"),
      fire(event) {
        (handlers[event] || []).forEach((fn) => fn({}));
      },
    },
    syncSharedState: () => said.push("sync"),
    said,
  };
  return bridge;
}

test("a started page watches for being shown again, on OSCAR's network and through a relay alike", () => {
  const timers = [];
  const real = global.setTimeout;
  global.setTimeout = (fn, ms) => {
    timers.push({ fn, ms });
    return { unref() {} };
  };
  try {
    const { doc, win } = phonePage();
    const bridge = sleepyBridge();
    const started = standalone.start({ document: doc, window: win, baked: { host: "192.168.0.5", port: 8081 }, search: "", connect: () => bridge });
    assert.ok(started.waking, "watching");
    assert.strictEqual(started.fullscreen, null, "a mouse: no full screen button");

    doc.fire("visibilitychange");
    assert.deepStrictEqual(bridge.said, ["sync"], "connected, so asked for the snapshot");
    bridge.socket.fire("state:all");
    const probe = timers.find((t) => t.ms === 3000);
    assert.ok(probe, "given a few seconds to answer");

    bridge.socket.connected = false;
    timers.length = 0;
    // A later wake, past the settling time.
    started.waking.wake();
    assert.deepStrictEqual(bridge.said, ["sync"], "within the settling time: one wake");

    const relayPage = phonePage();
    const relayBridge = sleepyBridge();
    const onRelay = standalone.start({
      document: relayPage.doc,
      window: relayPage.win,
      relay: { url: "wss://relay.test/s/room/ws" },
      connectRelay: () => relayBridge,
    });
    assert.ok(onRelay.waking, "a visitor's phone sleeps too");
  } finally {
    global.setTimeout = real;
  }
});

test("without a window the page starts as it always did", () => {
  const { doc } = phonePage();
  const bridge = sleepyBridge();
  const started = standalone.start({ document: doc, baked: { host: "192.168.0.5", port: 8081 }, search: "", connect: () => bridge });
  assert.ok(started.bridge === bridge);
  assert.strictEqual(started.fullscreen, null);
  started.waking.stop();
});
