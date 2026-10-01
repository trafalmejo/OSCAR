"use strict";

// Which project the canvas in a browser is, and how it stands against what
// OSCAR holds: remembered beside the canvas, so a reload picks up where it
// was (lib/open-project.js). And the editor's wiring of it: the title in the
// top bar, saving as you edit, and what the Publish window is told.

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

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const NOBODY = { id: null, name: "", rev: 0, dirty: false, fresh: false };

test("a canvas is nobody until it is a project; then a reload remembers who, at which revision, and what is unsent", () => {
  const storage = fakeStorage();
  const open = createOpenProject(storage);
  assert.deepStrictEqual(open.get(), NOBODY);

  open.set({ id: "p-abc123def456", name: "  Lobby visitors ", rev: 4, dirty: true });
  assert.deepStrictEqual(open.get(), { id: "p-abc123def456", name: "Lobby visitors", rev: 4, dirty: true, fresh: false });

  // Another page load, the same browser.
  assert.deepStrictEqual(createOpenProject(storage).get(), { id: "p-abc123def456", name: "Lobby visitors", rev: 4, dirty: true, fresh: false });
});

test("a template on the canvas is nobody's and says so across a reload, so it is not taken for work from before", () => {
  const storage = fakeStorage();
  const open = createOpenProject(storage);
  open.set({ id: "p-abc123def456", name: "Lobby", rev: 2 });
  open.clear("Boombox");
  assert.deepStrictEqual(open.get(), { id: null, name: "Boombox", rev: 0, dirty: false, fresh: true });
  assert.deepStrictEqual(createOpenProject(storage).get(), { id: null, name: "Boombox", rev: 0, dirty: false, fresh: true }, "fresh outlives the reload");
  open.clear();
  assert.strictEqual(createOpenProject(storage).get().fresh, true, "with no name too: the key is always written");
  assert.ok(KEY in storage.held);
});

test("a new id is random, and not kept until something makes it the project's", () => {
  let made = 0;
  const open = createOpenProject(fakeStorage(), { newId: () => "p-made" + ++made });
  assert.strictEqual(open.newId(), "p-made1");
  assert.strictEqual(open.newId(), "p-made2");
  assert.strictEqual(open.get().id, null);
});

test("what is in the browser's storage is not trusted, and a storage that throws costs only the memory", () => {
  for (const junk of ["not json", JSON.stringify({ id: "../../etc", name: 42, rev: "seven", dirty: "yes", fresh: 1 }), JSON.stringify([1, 2]), "null", JSON.stringify({ rev: -3 })]) {
    assert.deepStrictEqual(createOpenProject(fakeStorage({ [KEY]: junk })).get(), NOBODY, junk);
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
  assert.deepStrictEqual(open.get(), NOBODY);
  open.set({ id: "p-abc123def456", name: "Lobby", rev: 1 });
  assert.strictEqual(open.get().id, "p-abc123def456", "kept for as long as the page lives");
});

// ---- the editor's wiring ---------------------------------------------------------------

test("every change is saved in OSCAR as it is made: the editor hands its canvas to the sync, and has no Save", () => {
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /var openProject = createOpenProject\(window\.localStorage\);/);
  assert.match(editor, /var projectSync = createProjectSync\(\{\s*pointer: openProject,\s*api: projectApi,/);
  // Tidied as a saved project is, so what is compared and sent is what would be stored.
  assert.match(editor, /getData: function \(\) \{\s*return projectFormat\.namePages\(projectFormat\.stripEditorState\(editor\.getProjectData\(\)\)\);/);
  assert.match(editor, /editor\.on\("update", function \(\) \{\s*projectSync\.changed\(\);/, "any change to the project is a change to save");
  assert.match(editor, /editor\.onReady\(function \(\) \{\s*projectSync\.start\(\);/, "and what this browser holds is squared with OSCAR as the editor opens");
  // By id, with a revision, so a save from a window that is behind is refused (routes/index.js).
  assert.match(editor, /write: function \(id, body\) \{\s*return projectCall\("PUT", "\/projects\/" \+ encodeURIComponent\(id\), body\);/);
  // Ctrl+S is in everybody's fingers: it sends what is waiting, and the browser's own Save does not open.
  assert.match(editor, /String\(event\.key\)\.toLowerCase\(\) === "s"\) \{\s*event\.preventDefault\(\);\s*projectSync\.flush\(\);/);
  // The canvas stays in the browser as it did: it is what is kept until OSCAR confirms.
  assert.match(editor, /storageManager: \{\s*type: "local",\s*autosave: true,/);
});

test("the title sits in the top bar beside File and Edit, with how the project stands; clicking it renames", () => {
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /id: "oscar-title",\s*className: "oscar-title-btn",/);
  assert.match(editor, /onBarClick\("\.oscar-title-btn", function \(\) \{\s*renameProject\(\);/);
  assert.match(editor, /if \(el\) el\.textContent = openProject\.get\(\)\.name \|\| "Untitled";/, "a project with no title yet is Untitled; the title is set as text, never as markup");
  assert.match(editor, /projectSync\.rename\(this\.\$content\.find\("input"\)\.val\(\)\);/);
  assert.match(editor, /value="' \+ plain\(openProject\.get\(\)\.name \|\| "Untitled"\) \+ '"/, "the field opens holding the title, with what could end the attribute taken out");
  for (const words of ['saving: ["Saving\\u2026",', 'saved: ["Saved",', 'unsaved: ["Not saved",', 'conflict: ["Changed elsewhere",']) {
    assert.ok(editor.includes(words), words);
  }
  const theme = read("public/css/oscar_theme.css");
  assert.match(theme, /\.gjs-pn-btn\.oscar-title-btn,\n\.gjs-pn-btn\.oscar-title-btn:hover \{[^}]*text-overflow: ellipsis;/, "a long title ends in an ellipsis rather than push the bar about");
  assert.match(theme, /\.gjs-pn-btn\.oscar-save-state\[data-state="unsaved"\],/);
});

test("a project changed somewhere else is the person's call: keep this window's, or load the other", () => {
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /title: "Changed somewhere else",/);
  assert.match(editor, /text: "Keep this window's",\s*action: function \(\) \{\s*resolve\("mine"\);/);
  assert.match(editor, /text: "Load the other one",\s*action: function \(\) \{\s*resolve\("theirs"\);/);
});

test("the projects window opens a project, or starts one from a template; nothing asks about unsaved changes", () => {
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /projectSync\.open\(row\.id\)\.then\(/, "a project, by who it is");
  assert.match(editor, /if \(row\.template\) \{\s*openTemplate\(row\.url, row\.name\);/, "a template, named after itself");
  assert.match(editor, /return projectSync\.begin\(name \|\| "", function \(\) \{\s*loadTemplate\(html\);/, "which is nobody until its first change");
  assert.match(editor, /\} else if \(row\.id && row\.id === openProject\.get\(\)\.id\) \{/, "the one on the canvas is marked in the list");
  // The Showcase on a first launch is a template like any other.
  assert.match(editor, /load: function \(html\) \{\s*projectSync\.begin\("", function \(\) \{\s*loadTemplate\(html\);/);
  assert.match(editor, /function newProject\(\) \{\s*projectSync\.begin\("", function \(\) \{\s*loadTemplate\(""\);/);
});

test("with no close-without-saving, there are two ways back: as it was when opened, and as it is published", () => {
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /sessionStorage\.setItem\(OPENED_KEY, JSON\.stringify\(\{ id: id, data: data \}\)\);/, "kept for this tab, as the project is opened");
  assert.match(editor, /return held && held\.id === openProject\.get\(\)\.id && isProjectData\(held\.data\) \? held\.data : null;/, "and only offered for the project it is a copy of");
  assert.match(editor, /revertWith\(data, "it was when this window opened it"\);/);
  assert.match(editor, /return id && page\.project === id && page\.editable;/, "the published version is the copy kept beside its live interface");
  assert.match(editor, /projectSync\.replaceWith\(data\);/, "either way it is put in the same project, and saved");
});

test("deleting the project on the canvas does not save it back: the canvas starts again as nobody", () => {
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /url: row\.id \? "\/projects\/" \+ encodeURIComponent\(row\.id\) : "\/remove\/" \+ row\._id \}\);/, "deleted by who it is");
  assert.match(editor, /if \(!draft && !data\.error && row\.id && row\.id === openProject\.get\(\)\.id\) \{\s*projectSync\.begin\(\s*"",\s*function \(\) \{\s*loadTemplate\(""\);\s*\},\s*\{ discard: true \}/);
  assert.match(editor, /return page\.project === row\.id;/, "one that is live asks whether its interface goes too");
  assert.match(editor, /text: "Delete and take it down"/);
});

test("the Publish window is told who the canvas is, and a canvas that is nobody becomes a project as it opens", () => {
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /beforeOpen: function \(\) \{\s*return projectSync\.materialise\(\);/);
  assert.match(editor, /project: function \(\) \{\s*var now = openProject\.get\(\);\s*return \{ id: now\.id, name: now\.name \|\| "Untitled" \};/);
  assert.match(editor, /source: function \(name, id\) \{\s*return projectRecord\(name, id\);/);
  // Edit from a live interface's row: its project; one no longer in OSCAR comes back from the copy kept with the interface.
  assert.match(editor, /projectSync\s*\.open\(project\.id\)\s*\.then\(null, function \(\) \{\s*return importProject\(\{ id: project\.id, name: project\.name, data: project\.data \}\);/);

  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /Promise\.resolve\(\)\s*\.then\(options\.beforeOpen\)\s*\.then\(open, open\);/, "the window opens whether or not that could be done");
  assert.match(dialog, /address: mine \? mine\.id : fileStem\(typed\),/);
  assert.match(dialog, /publishButton\.textContent = mine \? "Update" : "Publish on the local network";/);
  assert.match(dialog, /if \(answer\.confirm\) \{/);
  assert.match(dialog, /project: \{ id: as\.id, name: as\.name \},\s*source: options\.source \? options\.source\(as\.name, as\.id\) : undefined,/);
  assert.match(dialog, /fetch\("\/published\/" \+ encodeURIComponent\(page\.id\) \+ "\/project"\)/);
  assert.match(dialog, /if \(page\.editable && !isMine && options\.openProject\) \{/, "no Edit for the one on the canvas, nor for a page with no copy");
});

test("the Publish button's dot can be taken off again: the button is found by its class, not by a tooltip the dot changes", () => {
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /return document\.querySelector\("\.gjs-pn-options \.oscar-publish-btn"\);/);
  assert.match(read("public/src/oscar_editor.js"), /className: "oscar-publish-btn",/);
});
