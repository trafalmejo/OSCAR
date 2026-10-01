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

test("a .oscar file in the projects folder is a project: listed, read, and removed like one", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-dot-oscar-"));
  const store = new ProjectStore(dir);
  await store.save("From The Library", { pages: [] });
  fs.writeFileSync(path.join(dir, "shared-desk.oscar"), JSON.stringify({ name: "Shared Desk", updatedAt: "2026-09-25T00:00:00Z", pages: [] }));
  fs.writeFileSync(path.join(dir, "notes.txt"), "not a project");

  const rows = await store.list();
  assert.deepStrictEqual(rows.map((r) => r.name).sort(), ["From The Library", "Shared Desk"]);
  assert.strictEqual((await store.read("shared-desk")).name, "Shared Desk");
  assert.strictEqual(await store.remove("shared-desk"), true);
  assert.strictEqual(await store.read("shared-desk"), null);
});

test("the list says which project each file is: its own id, or one made from the file it is in", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-projects-ids-"));
  const store = new ProjectStore(dir);
  await store.save("Lobby", { pages: [{}] }, { id: "p-abc123def456" });
  await store.save("Old Show", { pages: [{}] });
  const rows = await store.list();
  const byFile = Object.fromEntries(rows.map((row) => [row._id, row.id]));
  assert.deepStrictEqual(byFile, { lobby: "p-abc123def456", "old-show": "library-old-show" });
  assert.strictEqual((await store.read("lobby")).id, "p-abc123def456");
});

// ---- a project by who it is: it lives in OSCAR, and its title can change -------------

const PAGE = { pages: [{ name: "Page 1", frames: [{ component: { type: "wrapper" } }] }], styles: [] };

function freshStore() {
  return new ProjectStore(fs.mkdtempSync(path.join(os.tmpdir(), "oscar-projects-byid-")), { oscarVersion: "2.1.0" });
}

test("a new project has an id of its own, is kept in the file its id names, and starts at revision 1", async () => {
  const store = freshStore();
  const made = await store.create("Lobby visitors", PAGE, { grapesjs: "0.22" });
  assert.match(made.id, /^p-[a-z0-9]{12}$/);
  assert.deepStrictEqual([made.name, made.rev], ["Lobby visitors", 1]);
  assert.deepStrictEqual(fs.readdirSync(store.dir), [made.id + ".json"]);
  const found = await store.readById(made.id);
  assert.deepStrictEqual([found.id, found.name, found.rev, found.record.oscar, found.record.id], [made.id, "Lobby visitors", 1, "2.1.0", made.id]);
  assert.strictEqual((await store.create("", PAGE)).name, "Untitled", "one with no title is Untitled");
  assert.strictEqual(await store.readById("p-nosuchproj00"), null);
  assert.strictEqual(await store.readById("../escape"), null);
});

test("renaming a project changes its title and nothing else: the same id, the same file", async () => {
  const store = freshStore();
  const made = await store.create("Lobby", PAGE);
  const renamed = await store.write(made.id, { name: "Main hall" });
  assert.deepStrictEqual(renamed, { id: made.id, name: "Main hall", rev: 2 });
  assert.deepStrictEqual(fs.readdirSync(store.dir), [made.id + ".json"], "nothing moved");
  assert.deepStrictEqual((await store.readById(made.id)).record.data, PAGE, "and its content is as it was");
  assert.strictEqual((await store.list())[0].name, "Main hall");
});

test("a save made from an older copy is refused, and nothing is written over", async () => {
  const store = freshStore();
  const made = await store.create("Lobby", PAGE);
  const mine = Object.assign({}, PAGE, { styles: [{ selectors: ["#mine"] }] });
  const theirs = Object.assign({}, PAGE, { styles: [{ selectors: ["#theirs"] }] });

  assert.strictEqual((await store.write(made.id, { data: theirs, baseRev: 1 })).rev, 2, "the first window saves");
  const refused = await store.write(made.id, { data: mine, baseRev: 1 });
  assert.deepStrictEqual(refused, { conflict: true, rev: 2, name: "Lobby" }, "the second saw revision 1, which is no longer what is there");
  assert.deepStrictEqual((await store.readById(made.id)).record.data, theirs);

  // Having looked again, it saves.
  assert.strictEqual((await store.write(made.id, { data: mine, baseRev: 2 })).rev, 3);
  // With no revision named the write goes through, as replacing a project does.
  assert.strictEqual((await store.write(made.id, { data: theirs })).rev, 4);
  assert.strictEqual(await store.write("p-nosuchproj00", { data: mine }), null);
});

test("two saves for one project take turns: the second is judged against what the first wrote", async () => {
  const store = freshStore();
  const made = await store.create("Lobby", PAGE);
  const answers = await Promise.all([store.write(made.id, { name: "First", baseRev: 1 }), store.write(made.id, { name: "Second", baseRev: 1 })]);
  assert.deepStrictEqual(answers.map((a) => (a.conflict ? "refused" : a.name)), ["First", "refused"]);
  assert.strictEqual((await store.readById(made.id)).rev, 2);
});

test("a project from before is found by the id it is known by, and written back where it was", async () => {
  const store = freshStore();
  await store.save("Old Show", PAGE); // old-show.json, no id inside
  const [row] = await store.list();
  assert.strictEqual(row.id, "library-old-show");
  const found = await store.readById("library-old-show");
  assert.deepStrictEqual([found.name, found.rev], ["Old Show", 0]);

  const written = await store.write("library-old-show", { name: "Older Show", baseRev: 0 });
  assert.deepStrictEqual(written, { id: "library-old-show", name: "Older Show", rev: 1 });
  assert.deepStrictEqual(fs.readdirSync(store.dir), ["old-show.json"], "the file somebody put here keeps its place");
  assert.strictEqual((await store.read("old-show")).id, "library-old-show", "and now says who it is");

  // An .oscar file dropped into the folder is a project too.
  fs.writeFileSync(path.join(store.dir, "from-a-friend.oscar"), JSON.stringify({ format: 2, name: "From a friend", id: "p-friend000001", data: PAGE }));
  assert.strictEqual((await store.readById("p-friend000001")).name, "From a friend");
  await store.write("p-friend000001", { name: "Mine now" });
  assert.ok(fs.readdirSync(store.dir).includes("from-a-friend.oscar"));
});

test("a file brought in keeps who it says it is, unless that project is already here", async () => {
  const store = freshStore();
  const first = await store.create("Lobby", PAGE, { id: "p-fromafile001" });
  assert.strictEqual(first.id, "p-fromafile001");
  const second = await store.create("Lobby", PAGE, { id: "p-fromafile001" });
  assert.notStrictEqual(second.id, "p-fromafile001", "the id is taken: this one is another project");
  assert.strictEqual((await store.create("Lobby", PAGE, { id: "../escape" })).id.indexOf("p-"), 0);
});

test("a copy is another project; deleting one leaves the other", async () => {
  const store = freshStore();
  const made = await store.create("Lobby", PAGE);
  const copy = await store.duplicate(made.id);
  assert.deepStrictEqual([copy.name, copy.rev, copy.id !== made.id], ["Copy of Lobby", 1, true]);
  assert.strictEqual(await store.removeById(made.id), true);
  assert.strictEqual(await store.removeById(made.id), false);
  assert.deepStrictEqual((await store.list()).map((row) => row.id), [copy.id]);
  assert.strictEqual(await store.duplicate("p-nosuchproj00"), null);
});
