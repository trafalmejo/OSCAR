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

test("File holds every way in and out: three opens, a rule, two saves", () => {
  assert.ok(editor.indexOf("function showFileMenu()") !== -1);
  for (const item of ["Open a file\\u2026", "Open a template\\u2026", "Paste HTML / CSS\\u2026", "Save as\\u2026"]) {
    assert.ok(editor.indexOf(item) !== -1, "the menu offers: " + item);
  }
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

test("the bar's geography: File first at the left, the screen sizes pilled at the right", () => {
  const order = require("../lib/toolbar-order");
  assert.deepStrictEqual(
    order.arrange(["x", "sw-visibility", "set-device-desktop", "set-device-tablet", "set-device-mobile"], order.PLACEMENTS).slice(1, 4),
    ["set-device-desktop", "set-device-tablet", "set-device-mobile"],
    "the sizes lead the right half, ahead of Show borders"
  );
  assert.match(editor, /moveButton\("devices-c", "options", id\);/, "the sizes cross panels whole");
  assert.match(editor, /var wanted = \["oscar-file", "oscar-mcp-pill", "oscar-live-pill", "ipButton"\]/, "the left half's order: File first");
  assert.match(editor, /pill\.className = "oscar-devices-pill";/, "the sizes wear one pill");
  assert.match(editor, /pillDevices\(\);\n  \}/, "and every re-arrange puts the pill back");
  const theme = fs.readFileSync(path.join(__dirname, "..", "public", "css", "oscar_theme.css"), "utf8").replace(/\r\n/g, "\n");
  assert.match(theme, /\.oscar-devices-pill \.gjs-pn-btn \{\n  margin: 0;\n  padding: 2px;\n  border-radius: 999px;/, "the chosen size rounds with its pill");
  assert.match(theme, /\.oscar-open-menu \{\n  position: fixed;\n[\s\S]{0,120}z-index: 10000;/, "the menu sits above every layer");
});
