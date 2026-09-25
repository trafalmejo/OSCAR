"use strict";

// Telemetry (lib/telemetry.js): anonymous counts, and the file is the whole
// contract -- the whitelist, the switch, the kill switch, the batching, the
// silence on failure. These tests hold every one of those promises.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { createTelemetry, crashWords, EVENTS, KEY } = require("../lib/telemetry");

function fakeSettings(initial) {
  const held = Object.assign({}, initial);
  return {
    get: (k) => held[k],
    set: (k, v) => (held[k] = v),
    held,
  };
}

function bench(options) {
  const posts = [];
  const settings = fakeSettings((options && options.settings) || {});
  const telemetry = createTelemetry({
    settings,
    key: options && "key" in options ? options.key : "phc_test",
    flushMs: 5,
    env: (options && options.env) || {},
    now: () => new Date("2026-09-25T20:00:00Z"),
    fetchFn: (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return options && options.fail ? Promise.reject(new Error("down")) : Promise.resolve({ ok: true });
    },
  });
  return { telemetry, posts, settings };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

test("a listed event goes out as one anonymous batch; the id is minted once and kept", async () => {
  const { telemetry, posts, settings } = bench();
  assert.strictEqual(telemetry.tell("app_start", { version: "2.1.0", os: "win32", arch: "x64" }), true);
  assert.strictEqual(telemetry.tell("mcp_tool_called", { tool: "status" }), true);
  await settle();

  assert.strictEqual(posts.length, 1, "one batch, not one request per event");
  assert.match(posts[0].url, /\/batch\/$/);
  const batch = posts[0].body.batch;
  assert.strictEqual(batch.length, 2);
  assert.strictEqual(batch[0].event, "app_start");
  assert.strictEqual(batch[0].properties.version, "2.1.0");
  assert.strictEqual(batch[0].properties.$process_person_profile, false, "no person profile: anonymous by construction");
  assert.match(batch[0].distinct_id, /^[0-9a-f]{32}$/, "a random id, nothing machine-derived");
  assert.strictEqual(batch[0].distinct_id, settings.get("telemetryId"), "kept, so deleting it makes a new somebody");
});

test("the whitelist is the whole truth: unknown events and stray properties never exist", async () => {
  const { telemetry, posts } = bench();
  assert.strictEqual(telemetry.tell("secret_event", { anything: 1 }), false);
  telemetry.tell("app_start", { version: "2.1.0", ip: "192.168.2.11", project: "my show", os: "win32" });
  await settle();
  const properties = posts[0].body.batch[0].properties;
  assert.strictEqual(properties.ip, undefined, "an unlisted property is dropped before it exists");
  assert.strictEqual(properties.project, undefined);
  assert.strictEqual(properties.version, "2.1.0");
});

test("long strings are capped: no free text can ride a listed property", async () => {
  const { telemetry, posts } = bench();
  telemetry.tell("template_loaded", { template: "x".repeat(500) });
  await settle();
  assert.strictEqual(posts[0].body.batch[0].properties.template.length, 60);
});

test("off is off, three ways: the switch, the env, and a build with no key", async () => {
  const bySwitch = bench({ settings: { telemetry: false } });
  assert.strictEqual(bySwitch.telemetry.tell("app_start", {}), false);
  assert.strictEqual(bySwitch.telemetry.enabled(), false);

  const byEnv = bench({ env: { OSCAR_NO_TELEMETRY: "1" } });
  assert.strictEqual(byEnv.telemetry.tell("app_start", {}), false);
  assert.strictEqual(byEnv.telemetry.wired(), false);

  const noKey = bench({ key: "" });
  assert.strictEqual(noKey.telemetry.tell("app_start", {}), false);
  assert.strictEqual(noKey.telemetry.wired(), false);

  await settle();
  for (const b of [bySwitch, byEnv, noKey]) assert.strictEqual(b.posts.length, 0, "nothing leaves");
});

test("a failed send is dropped in silence, and the queue never grows without bound", async () => {
  const failing = bench({ fail: true });
  failing.telemetry.tell("app_start", { version: "1" });
  await settle();
  assert.strictEqual(failing.posts.length, 1, "tried once");
  failing.telemetry.close();
  await settle();
  assert.strictEqual(failing.posts.length, 1, "no retry loop: dropped");

  const { telemetry, posts } = bench();
  for (let i = 0; i < 300; i++) telemetry.tell("mcp_tool_called", { tool: "status" });
  telemetry.close();
  await settle();
  assert.ok(posts[posts.length - 1].body.batch.length <= 100, "capped");
});

test("close flushes what is queued, for quitting", async () => {
  const { telemetry, posts } = bench();
  telemetry.tell("surface_published", { widgets: 9, osc: true, midi: false, dmx: true });
  telemetry.close();
  await settle();
  assert.strictEqual(posts.length, 1);
  assert.deepStrictEqual(posts[0].body.batch[0].properties.widgets, 9);
});

// ---- the wiring, read from the sources --------------------------------------

const readSource = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8").replace(/\r\n/g, "\n");

test("the events OSCAR speaks are few, named, and where they claim to be", () => {
  assert.deepStrictEqual(Object.keys(EVENTS).sort(), ["app_error", "app_start", "draft_loaded", "mcp_tool_called", "surface_published", "template_loaded"]);
  const server = readSource("server.js");
  assert.match(server, /telemetry\.tell\("app_start", \{ version: pkg\.version, os: process\.platform, arch: process\.arch \}\)/);
  assert.match(server, /osc: widgets\.some/, "the publish event carries booleans, never an address");
  assert.match(server, /telemetry\.tell\(opened\[1\] === "drafts" \? "draft_loaded" : "template_loaded"/);
  assert.match(server, /onToolCall: \(tool\) => telemetry\.tell\("mcp_tool_called", \{ tool \}\)/);
  const routes = readSource("routes", "index.js");
  assert.match(routes, /router\.get\("\/telemetry-state", editorOnly/);
  assert.match(routes, /router\.post\("\/telemetry-state", editorOnly/);
  const editor = readSource("public", "src", "oscar_editor.js");
  assert.match(editor, /if \(!state \|\| !state\.wired\) return;/, "the About row hides when the build cannot speak");
  const about = readSource("public", "partials", "about.ejs");
  assert.match(about, /lib\/telemetry\.js/, "the label links to the whole truth");
});

test("no key is baked in yet, or the key is a public write-only one", () => {
  // The PostHog project key is write-only by design (phc_...); anything
  // else here would be a leaked secret.
  assert.ok(KEY === "" || /^phc_[A-Za-z0-9]+$/.test(KEY), "only ever empty or a public phc_ key");
});

test("a crash is two words: its class, and the first OSCAR frame -- never the message", () => {
  const err = new TypeError("ENOENT: C:\\Users\\somebody\\secret-show\\file");
  err.stack =
    "TypeError: ENOENT: C:\\Users\\somebody\\secret-show\\file\n" +
    "    at Object.readFileSync (node:fs:453:20)\n" +
    "    at flushLiveLog (C:\\Users\\somebody\\Documents\\OSCAR\\lib\\midi\\remote.js:184:11)\n" +
    "    at listOnTimeout (node:internal/timers:594:17)";
  const words = crashWords(err);
  assert.deepStrictEqual(words, { kind: "TypeError", where: "lib/midi/remote.js:184" });
  assert.ok(!JSON.stringify(words).includes("somebody"), "no path, no message, no username");

  assert.deepStrictEqual(crashWords(new Error("x")).kind, "Error");
  assert.strictEqual(crashWords({ stack: "at nowhere (node:internal:1:1)" }).where, "elsewhere", "a crash outside OSCAR's code says only that");
  assert.strictEqual(crashWords(null).kind, "Error", "a non-Error throw is still countable");

  const server = readSource("server.js");
  assert.match(server, /process\.on\("uncaughtException", \(err\) => \{\n  console\.error\(err\);/, "the crash is still printed, then counted");
  assert.match(server, /setTimeout\(\(\) => process\.exit\(1\), 400\)/, "and the process still dies, after a short grace for the batch");
  assert.match(server, /throw reason instanceof Error/, "a rejection nobody caught is the same crash by another door");
});
