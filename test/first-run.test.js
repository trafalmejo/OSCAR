"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { isFirstRun, openWelcome, WELCOME, AUTOSAVE_KEY } = require("../public/src/first_run");

const storage = (items) => ({ getItem: (key) => (key in items ? items[key] : null) });

test("the first time is when this browser has never held an OSCAR canvas, and only then", () => {
  assert.strictEqual(isFirstRun(storage({})), true);
  assert.strictEqual(isFirstRun(storage({ "gjs-html": "<p>from OSCAR 1</p>" })), true, "an older OSCAR's data is not this one's canvas");
  assert.strictEqual(isFirstRun(storage({ [AUTOSAVE_KEY]: "{}" })), false, "a canvas cleared on purpose stays cleared");
  assert.strictEqual(isFirstRun(storage({ [AUTOSAVE_KEY]: '{"pages":[]}' })), false);
  // When it cannot be told, an empty canvas: never a template over somebody's work.
  assert.strictEqual(isFirstRun(null), false);
  assert.strictEqual(isFirstRun({ getItem: () => { throw new Error("SecurityError"); } }), false);
});

test("the welcome is a template OSCAR ships, at the address the editor fetches it from", () => {
  assert.ok(fs.existsSync(path.join(__dirname, "..", "public", WELCOME)), WELCOME);
  assert.match(WELCOME, /oscar-showcase\.html$/);
});

test("the welcome is opened the way Load opens a template, quietly, and not over anything", async () => {
  const loaded = [];
  const page = (body, ok) => () => Promise.resolve({ ok: ok !== false, status: ok === false ? 404 : 200, text: () => Promise.resolve(body) });

  assert.strictEqual(await openWelcome({ fetch: page("<body>showcase</body>"), load: (html) => loaded.push(html) }), true);
  assert.deepStrictEqual(loaded, ["<body>showcase</body>"]);

  // Somebody was quick and dropped a button while it was being fetched.
  assert.strictEqual(await openWelcome({ fetch: page("<body>x</body>"), load: (html) => loaded.push(html), untouched: () => false }), false);
  // It cannot be fetched: an empty canvas, and nothing said.
  assert.strictEqual(await openWelcome({ fetch: page("", false), load: (html) => loaded.push(html) }), false);
  assert.strictEqual(await openWelcome({ fetch: () => Promise.reject(new Error("offline")), load: (html) => loaded.push(html) }), false);
  assert.strictEqual(loaded.length, 1);
});

test("the editor asks before it starts, because starting is what writes the first autosave", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "src", "oscar_editor.js"), "utf8");
  const asked = source.indexOf("welcome.isFirstRun(");
  const started = source.indexOf("editor = grapesjs.init(");
  assert.ok(asked !== -1 && started !== -1 && asked < started);
  assert.match(source, /key: welcome\.AUTOSAVE_KEY/, "one name for the key, so the question and the autosave cannot drift apart");
});
