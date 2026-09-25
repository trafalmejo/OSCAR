"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const { API, OPTIONAL, extensionIds, loadExtensions, none } = require("../lib/extensions");
const features = require("../lib/features");
const { ProjectStore } = require("../lib/projects");
const createRouter = require("../routes/index");

const SAMPLE = path.join(__dirname, "..", "examples", "sample-extension");
const ROOT = path.join(__dirname, "..");

/** Collects what would have been printed. */
function quietLog() {
  const lines = [];
  return { lines, log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) };
}

/** Load plain objects as though they were modules. */
function loadFakes(modules, log) {
  const ids = Object.keys(modules).map((id) => ({ id, optional: false }));
  return loadExtensions(ids, {
    log: log || quietLog(),
    load: (id) => {
      const found = modules[id];
      if (found instanceof Error) throw found;
      return found;
    },
  });
}

const valid = (extra) => Object.assign({ name: "one", version: "1.2.3", oscarApi: API }, extra);

// ---- which to load -------------------------------------------------------------

test("OSCAR looks for its optional extensions, plus any it is asked for, and can be run bare", () => {
  assert.deepStrictEqual(extensionIds({}), OPTIONAL.map((id) => ({ id, optional: true })));
  assert.deepStrictEqual(extensionIds({ OSCAR_EXTENSIONS: " ./mine , other-ext " }).slice(0, 2), [
    { id: "./mine", optional: false },
    { id: "other-ext", optional: false },
  ]);
  // Asked for by name, an optional one stops being optional: a typo should be heard.
  assert.deepStrictEqual(extensionIds({ OSCAR_EXTENSIONS: OPTIONAL[0] }), [{ id: OPTIONAL[0], optional: false }]);
  assert.deepStrictEqual(extensionIds({ OSCAR_EXTENSIONS: "./mine", OSCAR_NO_EXTENSIONS: "1" }), []);
});

test("an optional extension that is not installed is not news; one asked for is", () => {
  const notFound = (id) => Object.assign(new Error("Cannot find module '" + id + "'"), { code: "MODULE_NOT_FOUND" });
  const log = quietLog();
  const found = loadExtensions(
    [
      { id: "@oscar/pro", optional: true },
      { id: "./typo", optional: false },
    ],
    { log, load: (id) => { throw notFound(id); } }
  );
  assert.deepStrictEqual(found.list(), []);
  assert.strictEqual(log.lines.length, 1);
  assert.match(log.lines[0], /\.\/typo could not be loaded/);
});

test("an optional extension that is installed but broken is reported, not hidden", () => {
  const log = quietLog();
  // Its own require of something missing: MODULE_NOT_FOUND, but not for itself.
  const inner = Object.assign(new Error("Cannot find module 'left-pad'"), { code: "MODULE_NOT_FOUND" });
  loadExtensions([{ id: "@oscar/pro", optional: true }], { log, load: () => { throw inner; } });
  assert.match(log.lines[0], /@oscar\/pro could not be loaded: Cannot find module 'left-pad'/);
});

// ---- what is let in --------------------------------------------------------------

test("a module that is not a usable extension is left out, with the reason, and the rest load", () => {
  const log = quietLog();
  const found = loadFakes(
    {
      "not-an-object": "nope",
      "bad-name": valid({ name: "Has Spaces" }),
      "old-api": valid({ name: "old", oscarApi: API + 1 }),
      "bad-server": valid({ name: "srv", server: "yes" }),
      "files-without-folder": valid({ name: "nofolder", editor: { scripts: ["a.js"] } }),
      "climbing-out": valid({ name: "climb", publicDir: "/p", editor: { scripts: ["../../server.js"] } }),
      "a-url": valid({ name: "url", publicDir: "/p", editor: { scripts: ["https://example.com/a.js"] } }),
      "throws-on-load": new Error("boom"),
      good: valid({ name: "good" }),
      "same-name": valid({ name: "good" }),
    },
    log
  );
  assert.deepStrictEqual(found.list(), [{ name: "good", version: "1.2.3" }]);
  assert.strictEqual(log.lines.length, 9, log.lines.join("\n"));
  assert.ok(log.lines.some((l) => /old-api.*API/.test(l)));
  assert.ok(log.lines.some((l) => /same-name.*already called good/.test(l)));
  assert.ok(log.lines.some((l) => /throws-on-load.*boom/.test(l)));
});

// ---- the four things an extension can do ----------------------------------------------

test("an extension can switch on a feature OSCAR has, and no other", () => {
  assert.deepStrictEqual(none().features(), features.DEFAULTS);
  const log = quietLog();
  const found = loadFakes({ a: valid({ features: { PAGES: true, TELEPORT: true, ALSO: "yes" } }) }, log);
  assert.deepStrictEqual(found.features(), Object.assign({}, features.DEFAULTS, { PAGES: true }));
  assert.strictEqual(log.lines.length, 2, "both the unknown feature and the non-boolean are mentioned");
});

test("in a browser the switches answer with what the server wrote into the page", () => {
  assert.strictEqual(features.PAGES, features.DEFAULTS.PAGES);
  global.window = { OSCAR_FEATURES: { PAGES: !features.DEFAULTS.PAGES } };
  try {
    assert.strictEqual(features.PAGES, !features.DEFAULTS.PAGES);
    global.window.OSCAR_FEATURES = { PAGES: "yes" };
    assert.strictEqual(features.PAGES, features.DEFAULTS.PAGES, "only a real boolean counts");
  } finally {
    delete global.window;
  }
});

test("templates and editor files are given addresses under the extension's own name", () => {
  let dir = null;
  const found = loadFakes({
    a: valid({ name: "alpha", templatesDir: () => dir, publicDir: "/p", editor: { scripts: ["js/a.js"], styles: ["a.css"] } }),
    b: valid({ name: "beta", templatesDir: "/beta/templates" }),
    c: valid({ name: "gamma", templatesDir: () => { throw new Error("not yet"); } }),
  });
  // A folder that is not known yet is simply not a source yet.
  assert.deepStrictEqual(found.templateSources().map((s) => s.name), ["beta"]);
  dir = "/alpha/templates";
  assert.deepStrictEqual(found.templateSources(), [
    { name: "alpha", dir: "/alpha/templates", urlPrefix: "x/alpha/templates/" },
    { name: "beta", dir: "/beta/templates", urlPrefix: "x/beta/templates/" },
  ]);
  assert.deepStrictEqual(found.editorAssets(), { scripts: ["x/alpha/js/a.js"], styles: ["x/alpha/a.css"] });
});

test("one extension failing to start does not stop the next, and only what started is stopped", async () => {
  const log = quietLog();
  const order = [];
  const found = loadFakes(
    {
      a: valid({ name: "first", server: (host) => { host.onShutdown(() => order.push("first stopped")); throw new Error("no licence"); } }),
      b: valid({ name: "second", server: (host) => { order.push("second got api " + host.api + " and " + host.version); host.onShutdown(async () => { order.push("second stopped"); }); } }),
      c: valid({ name: "third", server: (host) => host.onShutdown(() => { throw new Error("late"); }) }),
    },
    log
  );
  found.start({ version: "9.9.9" });
  await found.stop();
  await found.stop();
  assert.deepStrictEqual(order, ["second got api " + API + " and 9.9.9", "second stopped"]);
  assert.ok(log.lines.some((l) => /first failed to start.*no licence/.test(l)));
  assert.ok(log.lines.some((l) => /third failed while shutting down: late/.test(l)));
});

// ---- end to end, with the sample extension ------------------------------------------------

async function withOscar(extensions, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-ext-"));
  const app = express();
  app.set("views", path.join(ROOT, "public"));
  app.set("view engine", "ejs");
  app.use(express.json());
  extensions.mount(app, express.static);
  app.use("/", createRouter({ store: new ProjectStore(dir), serverIP: () => "10.0.0.2", extensions }));
  extensions.start({ version: "test", app, lock: { isLocked: () => false }, log: quietLog() });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await extensions.stop();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("the sample extension: its template is in the Load list and fetchable, its script is on the editor page, its route answers", async () => {
  const log = quietLog();
  const extensions = loadExtensions([{ id: SAMPLE, optional: false }], { log });
  assert.deepStrictEqual(log.lines, []);
  assert.deepStrictEqual(extensions.list(), [{ name: "sample", version: "0.1.0" }]);

  await withOscar(extensions, async (base) => {
    const list = await (await fetch(base + "/projects")).json();
    assert.deepStrictEqual(list.map((r) => [r._id, r.name, r.url, r.template]), [
      ["sample:sample-board", "Sample Board (from an extension)", "x/sample/templates/sample-board.html", true],
    ]);
    const template = await fetch(base + "/" + list[0].url);
    assert.strictEqual(template.status, 200);
    assert.match(await template.text(), /data-gjs-message="\/sample\/go"/);

    const editor = await (await fetch(base + "/")).text();
    assert.match(editor, /window\.OSCAR_FEATURES = \{"PAGES":false,"SERIAL":true,"MIDI":true\};/);
    assert.ok(editor.indexOf('src="x/sample/editor.js"') > editor.indexOf('src="src/bundle.js"'), "after OSCAR's own");
    assert.strictEqual((await fetch(base + "/x/sample/editor.js")).status, 200);

    // The surface gets the switches and none of the editor's additions.
    const preview = await (await fetch(base + "/preview")).text();
    assert.match(preview, /window\.OSCAR_FEATURES = /);
    assert.ok(!preview.includes("x/sample/"));

    assert.deepStrictEqual(await (await fetch(base + "/x/sample/hello")).json(), {
      hello: "from the sample extension",
      oscar: "test",
      locked: false,
    });
  });
});

test("with no extensions the pages are as they were, give or take the switches", async () => {
  await withOscar(none(), async (base) => {
    const editor = await (await fetch(base + "/")).text();
    assert.match(editor, /window\.OSCAR_FEATURES = \{"PAGES":false,"SERIAL":true,"MIDI":true\};/);
    assert.ok(!/(src|href)="x\//.test(editor));
    assert.strictEqual((await fetch(base + "/x/sample/hello")).status, 404);
  });
});

test("nothing in OSCAR names an extension: the dependency runs one way", () => {
  // The optional list in lib/extensions.js is the single place a name appears.
  const offenders = [];
  // extensions/ is where one is copied to be built into an installer: not OSCAR's, and ignored by git.
  const skip = new Set(["node_modules", ".git", "dist", "docs", "projects", "test", "examples", "extensions", "release-builds"]);
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|ejs)$/.test(entry.name) && !/bundle\.js$/.test(entry.name)) {
        if (full === path.join(ROOT, "lib", "extensions.js")) continue;
        if (/@oscar\/pro|oscar-pro/.test(fs.readFileSync(full, "utf8"))) offenders.push(path.relative(ROOT, full));
      }
    }
  })(ROOT);
  assert.deepStrictEqual(offenders, []);
});

test("an extension put in the folder beside OSCAR is found, which is how one gets into an installer", () => {
  const { bundled } = require("../lib/extensions");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-bundled-"));
  fs.mkdirSync(path.join(dir, "zeta"));
  fs.writeFileSync(path.join(dir, "zeta", "package.json"), "{}");
  fs.mkdirSync(path.join(dir, "alpha"));
  fs.writeFileSync(path.join(dir, "alpha", "package.json"), "{}");
  fs.mkdirSync(path.join(dir, "notes"));
  fs.writeFileSync(path.join(dir, "README.md"), "not a folder");

  assert.deepStrictEqual(bundled(dir), [
    { id: path.join(dir, "alpha"), optional: true },
    { id: path.join(dir, "zeta"), optional: true },
  ], "by name, and only folders that are packages");
  assert.deepStrictEqual(bundled(path.join(dir, "nowhere")), [], "no folder is plain OSCAR, not an error");

  const ids = extensionIds({}, dir).map((entry) => entry.id);
  assert.ok(ids.includes(path.join(dir, "alpha")) && ids.includes(path.join(dir, "zeta")));
  // Asked for by path as well: loaded once.
  const twice = extensionIds({ OSCAR_EXTENSIONS: path.join(dir, "alpha") }, dir).filter((entry) => entry.id === path.join(dir, "alpha"));
  assert.strictEqual(twice.length, 1);
  assert.deepStrictEqual(extensionIds({ OSCAR_NO_EXTENSIONS: "1" }, dir), [], "bare means bare");
});
