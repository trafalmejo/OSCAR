"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ProjectStore, slugify } = require("../lib/projects");

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-test-"));
  return { store: new ProjectStore(dir), dir };
}

test("slugify makes filesystem-safe names", () => {
  assert.strictEqual(slugify("My Live Show"), "my-live-show");
  assert.strictEqual(slugify("  Set #2 / Main  "), "set-2-main");
  assert.strictEqual(slugify(""), "untitled");
  assert.strictEqual(slugify(null), "untitled");
});

test("slugify strips path traversal", () => {
  for (const evil of ["../../etc/passwd", "..\\..\\windows", "./../secret"]) {
    const slug = slugify(evil);
    assert.ok(!slug.includes(".."), evil + " -> " + slug);
    assert.ok(!slug.includes("/"), evil + " -> " + slug);
    assert.ok(!slug.includes("\\"), evil + " -> " + slug);
  }
});

test("save then read round-trips project data", async () => {
  const { store } = tempStore();
  const data = { "gjs-components": '[{"type":"button"}]', "gjs-styles": "[]" };

  const id = await store.save("My Live Show", data);
  assert.strictEqual(id, "my-live-show");

  const record = await store.read(id);
  assert.strictEqual(record.name, "My Live Show");
  assert.deepStrictEqual(record.data, data);
  assert.ok(record.updatedAt, "records carry a timestamp");
});

test("list reports every saved project", async () => {
  const { store } = tempStore();
  await store.save("Alpha", { a: 1 });
  await store.save("Beta", { b: 2 });

  const list = await store.list();
  assert.strictEqual(list.length, 2);

  const names = list.map((p) => p.name).sort();
  assert.deepStrictEqual(names, ["Alpha", "Beta"]);

  for (const project of list) {
    assert.ok(project._id, "has an id");
    assert.ok(project.size > 0, "has a size");
    assert.match(project.date, /^\d{4}-\d{2}-\d{2}$/, "has an ISO date");
  }
});

test("saving the same name overwrites rather than duplicating", async () => {
  const { store } = tempStore();
  await store.save("Show", { version: 1 });
  await store.save("Show", { version: 2 });

  const list = await store.list();
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual((await store.read("show")).data, { version: 2 });
});

test("exists and remove behave", async () => {
  const { store } = tempStore();
  await store.save("Gone Soon", {});

  assert.strictEqual(await store.exists("gone-soon"), true);
  assert.strictEqual(await store.remove("gone-soon"), true);
  assert.strictEqual(await store.exists("gone-soon"), false);
  assert.strictEqual(await store.remove("gone-soon"), false, "removing twice is not an error");
});

test("ids that escape the projects folder are refused", async () => {
  const { store, dir } = tempStore();
  const outside = path.join(dir, "..", "outside.json");
  fs.writeFileSync(outside, JSON.stringify({ name: "outside", data: { secret: true } }));

  for (const evil of ["../outside", "..\\outside", "/etc/passwd", "a/../../outside", "."]) {
    assert.strictEqual(await store.read(evil), null, "read " + evil);
    assert.strictEqual(await store.exists(evil), false, "exists " + evil);
    assert.strictEqual(await store.remove(evil), false, "remove " + evil);
  }

  assert.ok(fs.existsSync(outside), "the file outside the store survived");
});

test("a corrupt project file does not break the listing", async () => {
  const { store, dir } = tempStore();
  await store.save("Good", { ok: true });
  fs.writeFileSync(path.join(dir, "broken.json"), "{ this is not json");

  const list = await store.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, "Good");
});

test("save leaves no temp files behind", async () => {
  const { store, dir } = tempStore();
  await store.save("Clean", { ok: true });

  const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
  assert.deepStrictEqual(leftovers, []);
});
