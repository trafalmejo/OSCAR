"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  CURRENT_FORMAT,
  MIGRATIONS,
  isGrapesProject,
  detectFormat,
  openProject,
  stampProject,
} = require("../lib/project-format");

const project = () => ({
  pages: [{ frames: [{ component: { type: "wrapper", components: [] } }] }],
  styles: [],
  assets: [],
});

test("a saved file records the format and what wrote it", () => {
  const record = stampProject({
    name: "My Show",
    data: project(),
    oscar: "2.1.0",
    grapesjs: "0.23.6",
  });

  assert.strictEqual(record.format, CURRENT_FORMAT);
  assert.strictEqual(record.oscar, "2.1.0");
  assert.strictEqual(record.grapesjs, "0.23.6");
  assert.strictEqual(record.name, "My Show");
  assert.ok(record.updatedAt, "and when");
  assert.deepStrictEqual(record.data, project());
});

test("a stamped file opens straight away", () => {
  const record = stampProject({ name: "X", data: project(), oscar: "2.1.0" });
  const opened = openProject(record);

  assert.strictEqual(opened.status, "ok");
  assert.strictEqual(opened.migrated, false);
  assert.deepStrictEqual(opened.data, project());
});

test("a file saved before stamping is treated as format 0 and still opens", () => {
  // What OSCAR 2.0 wrote: no format field.
  const legacy = { name: "Old Show", updatedAt: "2026-09-04T00:00:00Z", data: project() };

  assert.strictEqual(detectFormat(legacy), 0);
  const opened = openProject(legacy);
  assert.strictEqual(opened.status, "ok");
  assert.strictEqual(opened.from, 0);
  assert.strictEqual(opened.migrated, CURRENT_FORMAT > 0);
  assert.deepStrictEqual(opened.data, project());
});

test("a file from a NEWER OSCAR is refused, not opened", () => {
  // The dangerous case: the shape still looks fine, so opening it would drop
  // whatever this version doesn't understand and save the loss back.
  const future = {
    format: CURRENT_FORMAT + 1,
    oscar: "9.9.9",
    name: "From the future",
    data: project(),
  };

  const opened = openProject(future);
  assert.strictEqual(opened.status, "too-new");
  assert.strictEqual(opened.savedBy, "9.9.9", "so the message can name the version");
  assert.strictEqual(opened.data, undefined, "no data is handed back to be mangled");
});

test("a 1.x-era file is unreadable rather than half-loaded", () => {
  const ancient = {
    name: "OSCAR 1 project",
    data: { "gjs-components": "[]", "gjs-styles": "[]" },
  };
  assert.strictEqual(openProject(ancient).status, "unreadable");
});

test("junk is unreadable", () => {
  for (const record of [null, undefined, 42, "hello", {}, { data: {} }, { data: { pages: [] } }]) {
    assert.strictEqual(openProject(record).status, "unreadable", JSON.stringify(record));
  }
});

test("isGrapesProject only accepts project data with pages", () => {
  assert.strictEqual(isGrapesProject(project()), true);
  assert.strictEqual(isGrapesProject({ pages: [] }), false);
  assert.strictEqual(isGrapesProject({ "gjs-components": "[]" }), false);
  assert.strictEqual(isGrapesProject(null), false);
});

test("every format below the current one has a migration to the next", () => {
  for (let version = 0; version < CURRENT_FORMAT; version++) {
    assert.strictEqual(
      typeof MIGRATIONS[version],
      "function",
      "format " + version + " has no way to reach " + (version + 1)
    );
  }
});

test("a round trip through stamp and open preserves the project exactly", () => {
  const original = project();
  const record = JSON.parse(JSON.stringify(stampProject({ name: "Trip", data: original })));
  const opened = openProject(record);

  assert.strictEqual(opened.status, "ok");
  assert.deepStrictEqual(opened.data, original);
});
