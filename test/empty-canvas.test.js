"use strict";

// A new project is a blank page, and a blank page says nothing: the editor
// draws a hint over an empty canvas, and opens the right column on the
// Blocks, so a new project shows what to drag in and where from.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8").replace(/\r\n/g, "\n");
const editor = read("public", "src", "oscar_editor.js");
const theme = read("public", "css", "oscar_theme.css");

test("an empty canvas says what to do, and the words are the editor's, not the project's", () => {
  assert.match(editor, /emptyHint\.className = "oscar-canvas-empty";/);
  assert.match(editor, /canvas\.appendChild\(emptyHint\);/, "drawn over the canvas, outside the frame: never saved, published or exported");
  assert.match(editor, /This project is empty/);
  assert.match(editor, /Drag a control in from the right, or open a template from File\./);
  assert.match(editor, /var empty = !!wrapper && wrapper\.components\(\)\.length === 0;/, "empty is what the project store calls empty");
  assert.match(editor, /emptyHint\.style\.display = empty && !editor\.Commands\.isActive\("preview"\) \? "" : "none";/, "gone with the first control, and in preview");
  assert.match(editor, /editor\.on\("load component:add component:remove command:run:preview command:stop:preview", paintEmptyHint\);/, "repainted whenever that can change");
  assert.match(theme, /\.oscar-canvas-empty \{\n  position: absolute;\n  inset: 0;\n  z-index: 1;[\s\S]{0,200}pointer-events: none;/, "a control is dropped straight through it");
  assert.match(theme, /\.oscar-canvas-empty-card \{[\s\S]{0,300}background: color-mix\(in srgb, var\(--o-panel\) 92%, transparent\);/, "on a card of the editor's colours: the canvas beneath may be white or black");
});

test("a new project opens the right column on the Blocks", () => {
  assert.match(editor, /function showBlocks\(\) \{\n    var button = pn\.getButton\("views", "open-blocks"\);\n    if \(button && !button\.get\("active"\)\) button\.set\("active", true\);/);
  assert.match(editor, /function newProject\(\) \{\n    projectSync\.begin\("", function \(\) \{\n      loadTemplate\(""\);\n      showBlocks\(\);/, "File > New project");
  assert.match(editor, /loadTemplate\(html\);\n          showBlocks\(\);/, "and a template, which is a new project too");
});
