"use strict";

// Which project the canvas in a browser is: remembered beside the autosaved
// canvas, so a reload keeps who it is, and what it publishes is known as
// that project (lib/open-project.js).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { createOpenProject, KEY } = require("../lib/open-project");

function fakeStorage(initial) {
  const held = Object.assign({}, initial);
  return {
    held,
    getItem: (key) => (key in held ? held[key] : null),
    setItem: (key, value) => {
      held[key] = String(value);
    },
    removeItem: (key) => {
      delete held[key];
    },
  };
}

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("a canvas is nobody until it is opened, saved or published; then a reload remembers who", () => {
  const storage = fakeStorage();
  const open = createOpenProject(storage);
  assert.deepStrictEqual(open.get(), { id: null, name: "", saved: false });

  open.set({ id: "p-abc123def456", name: "  Lobby visitors ", saved: true });
  assert.deepStrictEqual(open.get(), { id: "p-abc123def456", name: "Lobby visitors", saved: true });

  // Another page load, the same browser.
  assert.deepStrictEqual(createOpenProject(storage).get(), { id: "p-abc123def456", name: "Lobby visitors", saved: true });
});

test("publishing a canvas that is nobody gives it an id, once, and keeps it", () => {
  let made = 0;
  const storage = fakeStorage();
  const open = createOpenProject(storage, { newId: () => "p-made" + ++made });
  assert.strictEqual(open.ensureId(), "p-made1");
  assert.strictEqual(open.ensureId(), "p-made1", "the same id the second time");
  assert.strictEqual(createOpenProject(storage).get().id, "p-made1");
  assert.strictEqual(open.get().saved, false, "published, not saved: its first save keeps the id");
});

test("a template on the canvas is nobody's, though it may bring a name", () => {
  const storage = fakeStorage();
  const open = createOpenProject(storage);
  open.set({ id: "p-abc123def456", name: "Lobby", saved: true });
  open.clear();
  assert.deepStrictEqual(open.get(), { id: null, name: "", saved: false });
  assert.ok(!(KEY in storage.held), "nothing is left behind");
  open.clear("Boombox");
  assert.deepStrictEqual(createOpenProject(storage).get(), { id: null, name: "Boombox", saved: false });
});

test("what is in the browser's storage is not trusted, and a storage that throws costs only the memory", () => {
  for (const junk of ["not json", JSON.stringify({ id: "../../etc", name: 42, saved: "yes" }), JSON.stringify([1, 2]), "null"]) {
    assert.deepStrictEqual(createOpenProject(fakeStorage({ [KEY]: junk })).get(), { id: null, name: "", saved: false }, junk);
  }
  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("full");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
  const open = createOpenProject(broken);
  assert.deepStrictEqual(open.get(), { id: null, name: "", saved: false });
  open.set({ id: "p-abc123def456", name: "Lobby", saved: true });
  assert.strictEqual(open.get().id, "p-abc123def456", "kept for as long as the page lives");
});

test("the editor says who the canvas is wherever a project arrives or leaves", () => {
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /var openProject = createOpenProject\(window\.localStorage\);/);
  // A reload brings the name back with the canvas.
  assert.match(editor, /if \(projectName && !projectName\.value\) projectName\.value = openProject\.get\(\)\.name;/);
  // From the library: who it is comes with what is in it.
  assert.match(editor, /fetch\("\/load\/" \+ encodeURIComponent\(id\) \+ "\?envelope=1"\)/);
  assert.match(editor, /openProject\.set\(\{ id: answer\.id, name: answer\.name, saved: true \}\);/);
  // From a file: the id the file carries, or a new one the next Save writes into it.
  assert.match(editor, /openProject\.set\(\{ id: projectFormat\.isProjectId\(parsed\.id\) \? parsed\.id : openProject\.newId\(\), name: openedFile\.name, saved: true \}\);/);
  // To a file: the id travels in it, and is kept only once the file is written.
  assert.match(editor, /projectFormat\.stampProject\(\{ name: name, data: data, grapesjs: grapesjs\.version, id: id \}\)/);
  assert.match(editor, /var asNew = !!\(how && how\.asNew\) && openProject\.get\(\)\.saved;/, "Save as makes another project only of one saved before");
  assert.strictEqual((editor.match(/\bsaved\(\);/g) || []).length, 3, "after the download, after writing the held file, after the picked one");
  // A template is nobody's.
  assert.match(editor, /editor\.UndoManager\.clear\(\);\s*\/\/ A template on the canvas[^\n]*\n\s*openProject\.clear\(\);/);
});

test("the Publish window is told who the canvas is, and Edit puts a live interface's project back on it", () => {
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /project: function \(\) \{\s*var now = openProject\.get\(\);/);
  assert.match(editor, /adopt: function \(as\) \{/);
  assert.match(editor, /source: function \(name, id\) \{\s*return projectRecord\(name, id\);/);
  assert.match(editor, /openProject\.set\(\{ id: project\.id, name: openedFile\.name, saved: false \}\);/, "no file is held: its first Save keeps who it is");
  assert.match(editor, /you will lose all unsaved changes in the current project/);

  const dialog = read("public/src/export_dialog.js");
  // Update is one click on the project's own address; anything else is asked about.
  assert.match(dialog, /address: mine \? mine\.id : fileStem\(typed\),/);
  assert.match(dialog, /publishButton\.textContent = mine \? "Update" : "Publish on the local network";/);
  assert.match(dialog, /if \(answer\.confirm\) \{/);
  assert.match(dialog, /publish\(as, true\);/);
  assert.match(dialog, /project: \{ id: as\.id, name: as\.name \},\s*source: options\.source \? options\.source\(as\.name, as\.id\) : undefined,/);
  assert.match(dialog, /if \(options\.adopt\) options\.adopt\(\{ id: as\.id, name: as\.name \}\);/);
  assert.match(dialog, /fetch\("\/published\/" \+ encodeURIComponent\(page\.id\) \+ "\/project"\)/);
  assert.match(dialog, /if \(page\.editable && !isMine && options\.openProject\) \{/, "no Edit for the one on the canvas, nor for a page with no copy");
});

test("deleting a library project that is live asks whether its interface goes too", () => {
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /return page\.project === row\.id;/);
  assert.match(editor, /text: "Delete and take it down"/);
  assert.match(editor, /text: live \? "Delete, keep it live" : "Confirm"/);
  assert.match(editor, /if \(takeDown && live && !data\.error\) fetch\("\/published\/" \+ encodeURIComponent\(live\.id\), \{ method: "DELETE" \}\)/);
});

test("the Publish button's dot can be taken off again: the button is found by its class, not by a tooltip the dot changes", () => {
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /return document\.querySelector\("\.gjs-pn-options \.oscar-publish-btn"\);/);
  assert.match(read("public/src/oscar_editor.js"), /className: "oscar-publish-btn",/);
});
