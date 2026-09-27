"use strict";

// Open and Save against the real file system: a project is one .oscar file
// the person can put anywhere, the File menu at the bar's left edge gathers
// every way in and out, and the old library window stays for templates.
// These hold the editor's wiring to that design.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const editor = fs.readFileSync(path.join(__dirname, "..", "public", "src", "oscar_editor.js"), "utf8").replace(/\r\n/g, "\n");

test("Save goes to the file system: ask once, then write the same file silently", () => {
  assert.match(editor, /window\.showSaveFilePicker/, "a real Save As dialog where the browser has one");
  assert.match(editor, /suggestedName: slugName\(name\) \+ "\.oscar"/, "the file is a .oscar");
  assert.match(editor, /if \(openedFile\.handle\) \{/, "saving again writes the opened file, silently");
  assert.match(editor, /a\.download = slugName\(name\) \+ "\.oscar";/, "a browser without pickers still gets the file");
  assert.match(editor, /projectFormat\.stampProject\(/, "stamped like the library's own save: one format, not two");
});

test("File holds every way in and out: three opens, two saves, and Publish", () => {
  assert.ok(editor.indexOf("function showFileMenu()") !== -1);
  for (const item of ["Open a file\\u2026", "Open a template\\u2026", "Import HTML/CSS\\u2026", "Save as\\u2026", "Publish\\u2026"]) {
    assert.ok(editor.indexOf(item) !== -1, "the menu offers: " + item);
  }
  assert.ok(editor.indexOf('editor.runCommand("oscar-export");') !== -1, "Publish opens the publish window");
  assert.ok(editor.indexOf('{ label: "Save", run: oscarSaveToFile }') !== -1, "and a plain Save");
  assert.match(editor, /label: "File",/, "a word, not an icon");
  assert.match(editor, /\.gjs-pn-devices-c \.oscar-file-btn/, "anchored where the button actually lives -- the old menu died of a stale anchor");
  assert.match(editor, /editor\.runCommand\("open-projects", \{ type: "Load" \}\)/, "the template way opens the window that always existed");
  assert.match(editor, /editor\.runCommand\("gjs-open-import-webpage"\)/, "the paste box lives on behind the menu");
  assert.match(editor, /pn\.removeButton\("options", "gjs-open-import-webpage"\)/, "and its toolbar seat is retired");
  assert.match(editor, /function oscarSaveAs\(\) \{\n    openedFile\.handle = null;/, "Save as always asks where");
  assert.match(editor, /oscar-open-menu-rule/, "opens and saves are parted by a rule");
});

test("opening a file guards the person: format skew refused honestly, changes never lost silently", () => {
  assert.match(editor, /parsed\.oscarFormat > projectFormat\.CURRENT_FORMAT/, "a newer OSCAR's file is refused, not mangled");
  assert.match(editor, /saved by a newer OSCAR \(format " \+ parsed\.oscarFormat/, "and the refusal says why");
  assert.match(editor, /is not an OSCAR 2 project, so it cannot be opened\. Your current project has not been changed\./, "a wrong file changes nothing");
  assert.match(editor, /you will lose all unsaved changes in the current project/, "opening always asks first");
  assert.match(editor, /accept = "\.oscar,\.json,\.html,\.htm"/, "and .html templates come through the same door");
});

test("the bar's geography: File first at the left, the screen sizes centred over the canvas", () => {
  const order = require("../lib/toolbar-order");
  assert.ok(!order.PLACEMENTS.some((p) => /^set-device-/.test(p.id)), "the sizes are not placed on the right half");
  // Created with its buttons in it: a panel added empty never draws buttons added later.
  assert.match(editor, /pn\.addPanel\(\{ id: "oscar-sizes", visible: true, buttons: sizeButtons \}\);/, "they have a panel of their own, made with them in it");
  assert.match(editor, /pn\.removeButton\("devices-c", id\);/, "the sizes leave the left panel whole");
  assert.match(editor, /var wanted = \["oscar-file", "oscar-edit", "ipButton"\]/, "the left half reads File, Edit, the address; the pills lead the right");
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
  assert.match(edits, /\.concat\(extraItems\("edit"\)\)/, "an extension's items join Lock editing");
  assert.match(file, /\{ rule: true \},\n    \]\n[^\n]*\n[^\n]*\n      \.concat\(extraItems\("file"\)\)\n      \.concat\(\[\n[^\n]*\n      \{\n        label: "About OSCAR",/, "and File's open the last group, just above About");
  const pro = fs.readFileSync(path.join(__dirname, "..", "..", "oscar-pro", "public", "editor.js"), "utf8");
  assert.match(pro, /label: signedIn \? "Log out(…|\\u2026)" : "Log in(…|\\u2026)",/, "Pro's Log in or Log out, as the account stands");
  assert.match(pro, /offerSignIn\(!!account\.signedIn\);/, "following the account");
  assert.match(editor, /\["sw-visibility", "fullscreen", "export-template", "canvas-clear", "preview"\]\.forEach/, "the eye leaves the bar");
  assert.ok(editor.indexOf('id: "open-info"') === -1, "the jellyfish is not added");
  assert.match(editor, /addMenuItem: function \(menu, item\) \{/, "extensions get a place in the menus");
  assert.match(editor, /if \(!menuExtras\[menu\]\) throw new Error\('A menu item goes in "file" or "edit"'\);/);
});

test("Show borders is remembered: turned off, it stays off after a refresh", () => {
  assert.match(editor, /localStorage\.setItem\(BORDERS_KEY, on \? "on" : "off"\);/, "the choice is kept when made");
  assert.match(editor, /return localStorage\.getItem\(BORDERS_KEY\) !== "off";/, "on until turned off once");
  assert.match(editor, /else if \(!bordersWanted\(\) && active\) editor\.stopCommand\("sw-visibility"\);/, "and put back as it was left at startup");
  assert.doesNotMatch(editor, /editor\.onReady\(function \(\) \{\n    if \(!editor\.Commands\.isActive\("sw-visibility"\)\) editor\.runCommand\("sw-visibility"\);\n  \}\);/, "not forced on at every start");
});

test("a double-clicked project opens through the same guarded door, once", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /app\.on\("open-file"/, "macOS hands the file by event");
  assert.match(main, /OSCAR_OPEN_FILE: fileToOpen/, "the server is told which file");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").replace(/\r\n/g, "\n");
  assert.match(server, /takeBootFile: \(\) => \{\n      const taken = bootFile;\n      bootFile = null;/, "claimed once: a refresh opens nothing");
  assert.match(server, /stat\.size <= 200 \* 1024 \* 1024/, "a sanity ceiling refuses only the renamed-video accident, not a media-heavy project");
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "index.js"), "utf8").replace(/\r\n/g, "\n");
  assert.match(routes, /router\.get\("\/boot-file", editorOnly/, "handed over on the editor's own terms");
  assert.match(editor, /fetch\("\/boot-file"\)/, "the editor asks at startup");
  assert.match(editor, /openPicked\(file\.name, file\.text, null\)/, "and the ordinary Open flow, confirmation included, takes over");
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.deepStrictEqual(pkg.build.fileAssociations[0].ext, "oscar", "the installer registers .oscar for double-clicking");
});
