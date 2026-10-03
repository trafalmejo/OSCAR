"use strict";

// A project lives in OSCAR and is saved as it is edited; an .oscar file is a
// copy of one, written by Export a copy and brought in by Open a file. The
// File menu at the bar's left edge gathers every way in and out, and the
// projects window lists what is in OSCAR, with the templates. These hold
// the editor's wiring to that design.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const editor = fs.readFileSync(path.join(__dirname, "..", "public", "src", "oscar_editor.js"), "utf8").replace(/\r\n/g, "\n");

test("Export a copy writes an .oscar file wherever the person says; the project stays in OSCAR", () => {
  assert.match(editor, /function exportCopy\(\) \{\n    projectSync\.flush\(\)\.then\(function \(\) \{/, "what is waiting is saved first, so the file holds what the canvas shows");
  assert.match(editor, /window\.showSaveFilePicker/, "a real save dialog where the browser has one");
  assert.match(editor, /suggestedName: slugName\(name\) \+ "\.oscar"/, "the file is a .oscar, named after the project");
  assert.match(editor, /a\.download = slugName\(name\) \+ "\.oscar";/, "a browser without pickers still gets the file");
  assert.match(editor, /projectFormat\.stampProject\(\{ name: name, data: data, grapesjs: grapesjs\.version, id: id \}\)/, "stamped as OSCAR keeps a project, with who it is: brought back in, it is known");
  assert.ok(!/openedFile|oscarSaveToFile|oscarSaveAs/.test(editor), "no file is held, and nothing saves to one behind the person's back");
});

test("File holds every way in and out, and no Save: a new project, three opens, a copy, a file, two ways back, and Publish", () => {
  assert.ok(editor.indexOf("function showFileMenu()") !== -1);
  const menu = editor.slice(editor.indexOf("function showFileMenu()"), editor.indexOf("// A file double-clicked"));
  const labels = (menu.match(/label: "[^"]*"/g) || []).map((l) => l.slice(8, -1));
  assert.deepStrictEqual(labels, [
    "New project",
    "Open project or template\\u2026",
    "Open a file\\u2026",
    "Import HTML/CSS\\u2026",
    "Make a copy",
    "Export a copy\\u2026",
    "Revert to how it was when opened\\u2026",
    "Revert to the published version\\u2026",
    "Publish\\u2026",
    "Push to preview",
    "About OSCAR",
  ]);
  assert.ok(editor.indexOf('editor.runCommand("oscar-export");') !== -1, "Publish opens the publish window");
  assert.ok(!/label: "Save/.test(menu), "nothing to press to save: every change saves itself");
  assert.match(editor, /label: "File",/, "a word, not an icon");
  assert.match(editor, /\.gjs-pn-devices-c \.oscar-file-btn/, "anchored where the button actually lives -- the old menu died of a stale anchor");
  assert.match(editor, /editor\.runCommand\("open-projects", \{ type: "Load" \}\)/, "Open is the projects window, with the templates in it");
  assert.match(editor, /editor\.runCommand\("gjs-open-import-webpage"\)/, "the paste box lives on behind the menu");
  assert.match(editor, /pn\.removeButton\("options", "gjs-open-import-webpage"\)/, "and its toolbar seat is retired");
  assert.match(editor, /oscar-open-menu-rule/, "the groups are parted by a rule");
});

test("opening a file guards the person: format skew refused honestly, and a project already here is asked about", () => {
  assert.match(editor, /if \(opened\.status === "too-new"\) \{/, "a newer OSCAR's file is refused, not mangled");
  assert.match(editor, /saved by a newer OSCAR \(format " \+ opened\.format/, "and the refusal says why");
  assert.match(editor, /var data = opened\.status === "ok" \? opened\.data : null;\n    if \(!isProjectData\(data\)\) \{/, "the project is the answer's data, not the answer");
  assert.match(editor, /is not an OSCAR 2 project, so it cannot be opened\. Your current project has not been changed\./, "a wrong file changes nothing");
  assert.ok(!/you will lose all unsaved changes/.test(editor), "nothing warns of unsaved changes: there are none to lose");
  // A file comes in as a project. One that is already here: replace it, or keep both.
  assert.match(editor, /if \(res\.status === 409 && res\.body && res\.body\.exists\) \{/);
  assert.match(editor, /text: "Replace it",\s*btnClass: "btn-red",\s*action: function \(\) \{\s*importProject\(project, "replace"\);/);
  assert.match(editor, /text: "Keep both",\s*action: function \(\) \{\s*importProject\(project, "copy"\);/);
  assert.match(editor, /if \(res\.body\.id === openProject\.get\(\)\.id\) return projectSync\.reload\(\);/, "replacing the one on the canvas shows the file, and does not save the old canvas over it");
  assert.match(editor, /id: projectFormat\.isProjectId\(parsed\.id\) \? parsed\.id : undefined,/, "a file says who it is; one from before ids is a new project");
  assert.match(editor, /accept = "\.oscar,\.json,\.html,\.htm"/, "and .html templates come through the same door");
});

test("the bar's geography: File first at the left, the screen sizes centred over the canvas", () => {
  const order = require("../lib/toolbar-order");
  assert.ok(!order.PLACEMENTS.some((p) => /^set-device-/.test(p.id)), "the sizes are not placed on the right half");
  // Created with its buttons in it: a panel added empty never draws buttons added later.
  assert.match(editor, /pn\.addPanel\(\{ id: "oscar-sizes", visible: true, buttons: sizeButtons \}\);/, "they have a panel of their own, made with them in it");
  assert.match(editor, /pn\.removeButton\("devices-c", id\);/, "the sizes leave the left panel whole");
  assert.match(editor, /var wanted = \["oscar-file", "oscar-edit", "oscar-title", "oscar-export", "oscar-save-state"]/, "the left half is the project: File, Edit, its title, Publish, how it stands; the right half is OSCAR");
  const theme = fs.readFileSync(path.join(__dirname, "..", "public", "css", "oscar_theme.css"), "utf8").replace(/\r\n/g, "\n");
  assert.match(theme, /\.gjs-pn-panel\.gjs-pn-oscar-sizes \{\n  top: 0;\n  left: 42\.5%;\n  transform: translateX\(-50%\);/, "centred over the canvas (85% of the window), not the window");
  assert.match(theme, /\.gjs-pn-oscar-sizes \.gjs-pn-btn \{\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;/, "the icons sit squarely centred");
  assert.match(theme, /\.gjs-pn-panel\.gjs-pn-oscar-sizes\.gjs-hidden \{\n  display: none;\n\}/, "and they hide with every other panel in preview: their display: flex would otherwise win");
  assert.match(theme, /\.oscar-open-menu \{\n  position: fixed;\n[\s\S]{0,120}z-index: 10000;/, "the menu sits above every layer");
  const tooltip = fs.readFileSync(path.join(__dirname, "..", "public", "css", "oscar_tooltip.css"), "utf8").replace(/\r\n/g, "\n");
  assert.match(tooltip, /white-space: normal;\n  width: max-content;\n  max-width: 19rem;/, "tooltips wrap instead of cropping");
  assert.match(tooltip, /\.gjs-pn-devices-c \[data-tooltip-pos="bottom"\]::after \{\n  left: 0;/, "and the left edge's hang rightward");
});

test("Edit stands beside File: Undo and Redo under one word, their icons retired", () => {
  assert.match(editor, /label: "Edit",/, "a word, like File");
  assert.match(editor, /editor\.runCommand\("core:undo"\)/, "Undo runs the editor's own command");
  assert.match(editor, /editor\.runCommand\("core:redo"\)/, "and Redo its twin");
  assert.match(editor, /pn\.removeButton\("options", "undo"\);\n  pn\.removeButton\("options", "redo"\);/, "the icons retire early, before the left is wired");
  assert.match(editor, /function showBarMenu\(anchorSelector, items\)/, "File and Edit share one menu builder");
  assert.match(editor, /menu\.contains\(event\.target\) \|\| anchor\.contains\(event\.target\)/, "a second click on the word closes the menu instead of blinking it");
  assert.match(editor, /again stays chosen instead of toggling half-off\.\n      togglable: false,/, "a screen size is a choice, not a switch");
});

test("File holds Push to preview and About; Edit holds the lock and an extension's items; their bar buttons are gone", () => {
  const file = editor.slice(editor.indexOf("function showFileMenu()"), editor.indexOf("// A file double-clicked"));
  const edits = editor.slice(editor.indexOf("function showEditMenu()"), editor.indexOf("function showFileMenu()"));
  assert.match(file, /label: "Push to preview",\s*run: function \(\) \{\s*editor\.runCommand\("preview"\);/, "Push to preview runs the command itself: there is no eye to press");
  assert.ok(file.indexOf("About OSCAR") !== -1, "About under File");
  assert.ok(edits.indexOf("Push to preview") === -1, "not under Edit any more");
  // Where the pushed canvas shows was nowhere said: the item says it on hover, with the address.
  assert.match(file, /hint:\s*"Try the canvas without publishing it\. The controls work here, and a phone or tablet on this network shows it at http:\/\/" \+\s*ipServer \+\s*\(window\.location\.port \? ":" \+ window\.location\.port : ""\) \+\s*"\/preview",/);
  assert.match(editor, /if \(item\.hint\) \{\s*row\.setAttribute\("data-tooltip", item\.hint\);\s*row\.setAttribute\("data-tooltip-pos", "right"\);/, "a menu item's hint is a tooltip to the menu's right");
  assert.match(edits, /\.concat\(extraItems\("edit"\)\)/, "an extension's items join Lock editing");
  assert.match(file, /\{ rule: true \},\n    \]\n[^\n]*\n[^\n]*\n      \.concat\(extraItems\("file"\)\)\n      \.concat\(\[\n[^\n]*\n      \{\n        label: "About OSCAR",/, "and File's open the last group, just above About");
  // OSCAR Pro is private: its half is checked only where it sits next to this repo, never in CI.
  const proFile = path.join(__dirname, "..", "..", "oscar-pro", "public", "editor.js");
  const pro = fs.existsSync(proFile) ? fs.readFileSync(proFile, "utf8") : null;
  if (pro) assert.match(pro, /label: signedIn \? "Log out(…|\\u2026)" : "Log in(…|\\u2026)",/, "Pro's Log in or Log out, as the account stands");
  if (pro) assert.match(pro,/offerSignIn\(!!account\.signedIn\);/, "following the account");
  assert.match(editor, /\["sw-visibility", "fullscreen", "export-template", "canvas-clear", "preview"\]\.forEach/, "the eye leaves the bar");
  assert.ok(editor.indexOf('id: "open-info"') === -1, "the jellyfish is not added");
  assert.match(editor, /addMenuItem: function \(menu, item\) \{/, "extensions get a place in the menus");
  assert.match(editor, /if \(!menuExtras\[menu\]\) throw new Error\('A menu item goes in "file" or "edit"'\);/);
});

test("Show borders is remembered: off to begin with, and turned on it stays on after a refresh", () => {
  assert.match(editor, /localStorage\.setItem\(BORDERS_KEY, on \? "on" : "off"\);/, "the choice is kept when made");
  assert.match(editor, /return localStorage\.getItem\(BORDERS_KEY\) === "on";/, "off until turned on once: a new user's first sight is the Showcase, not dotted boxes");
  assert.match(editor, /\} catch \(err\) \{\n      return false;\n    \}/, "and off where nothing is remembered");
  assert.match(editor, /else if \(!bordersWanted\(\) && active\) editor\.stopCommand\("sw-visibility"\);/, "and put back as it was left at startup");
  assert.doesNotMatch(editor, /editor\.onReady\(function \(\) \{\n    if \(!editor\.Commands\.isActive\("sw-visibility"\)\) editor\.runCommand\("sw-visibility"\);\n  \}\);/, "not forced on at every start");
});

test("a double-clicked project comes in through the same door as a picked file, once", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /app\.on\("open-file"/, "macOS hands the file by event");
  assert.match(main, /OSCAR_OPEN_FILE: fileToOpen/, "the server is told which file");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").replace(/\r\n/g, "\n");
  assert.match(server, /takeBootFile: \(\) => \{\n      const taken = bootFile;\n      bootFile = null;/, "claimed once: a refresh opens nothing");
  assert.match(server, /stat\.size <= 200 \* 1024 \* 1024/, "a sanity ceiling refuses only the renamed-video accident, not a media-heavy project");
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "index.js"), "utf8").replace(/\r\n/g, "\n");
  assert.match(routes, /router\.get\("\/boot-file", editorOnly/, "handed over on the editor's own terms");
  assert.match(editor, /fetch\("\/boot-file"\)/, "the editor asks at startup");
  assert.match(editor, /openPicked\(file\.name, file\.text\)/, "and the ordinary Open a file flow takes over: it becomes a project in OSCAR");
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.deepStrictEqual(pkg.build.fileAssociations[0].ext, "oscar", "the installer registers .oscar for double-clicking");
});

// The round trip, not the source: what Save writes, Open must read. Open once
// checked openProject's answer for pages instead of the project inside it,
// and refused every file ("is not an OSCAR 2 project").
test("a project saved to a file opens again", () => {
  const projectFormat = require("../lib/project-format");
  const project = { assets: [], styles: [], pages: [{ name: "Page 1", frames: [{ component: { type: "wrapper", components: [] } }] }], symbols: [], dataSources: [] };
  const saved = JSON.parse(JSON.stringify(projectFormat.stampProject({ name: "DMX 9CH", data: projectFormat.stripEditorState(project), grapesjs: "0.23.6" })));
  const opened = projectFormat.openProject(saved);
  assert.strictEqual(opened.status, "ok");
  // The editor's own test, applied to what it now passes it.
  assert.strictEqual(projectFormat.isGrapesProject(opened.data), true, "the data inside the answer is a project");
  assert.strictEqual(projectFormat.isGrapesProject(opened), false, "the answer itself is not: checking it refused every file");
  // A file from a newer OSCAR says so, by the field files really carry.
  const newer = projectFormat.openProject(Object.assign({}, saved, { format: projectFormat.CURRENT_FORMAT + 1 }));
  assert.strictEqual(newer.status, "too-new");
  assert.strictEqual(newer.format, projectFormat.CURRENT_FORMAT + 1);
});
