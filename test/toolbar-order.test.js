"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { PLACEMENTS, moveAfter, moveBefore, arrange } = require("../lib/toolbar-order");

// The order the editor's scripts add their buttons in: the sizes join late
// (moved over from the left panel), Import is removed after the preset adds
// it, Open/Save live under File on the left, and Show borders, Fullscreen,
// See code, Clear canvas and the widget style live under Edit, Push to
// preview and About under File: none of those holds a seat here.
// The screen sizes have a panel of their own, centred over the canvas.
// Publish is the project's, on the left with its title; the server's address
// is the server's, and joins this half last, after the pills are painted.
const ADDED = [
  "open-pages", "oscar-live-pill", "oscar-mcp-pill", "toggle-lock", "ipButton",
];

test("the right half is OSCAR's: its address, the pills, the lock, Pages beside the lock", () => {
  const order = arrange(ADDED);
  assert.deepStrictEqual(
    order.slice(0, 4),
    ["ipButton", "oscar-live-pill", "oscar-mcp-pill", "toggle-lock"],
    "where OSCAR is, what it runs, its lock"
  );
  assert.strictEqual(order[order.indexOf("toggle-lock") + 1], "open-pages");
  // With Pages off there is no Pages button, and the lock ends the bar.
  const noPages = arrange(ADDED.filter((id) => id !== "open-pages"));
  assert.deepStrictEqual(noPages, ["ipButton", "oscar-live-pill", "oscar-mcp-pill", "toggle-lock"]);
  assert.ok(!PLACEMENTS.some((p) => p.id === "oscar-export"), "Publish has no seat on the server's half");
  for (const retired of ["gjs-open-import-webpage", "open-load", "open-save", "sw-visibility", "fullscreen", "export-template", "canvas-clear", "open-styles", "preview", "open-info"]) {
    assert.ok(!PLACEMENTS.some((p) => p.id === retired || p.after === retired || p.before === retired), "no placement names " + retired);
  }
  assert.deepStrictEqual(order.slice().sort(), ADDED.slice().sort(), "nothing added, nothing lost");
  const moved = PLACEMENTS.map((p) => p.id);
  assert.deepStrictEqual(order.filter((id) => !moved.includes(id)), ADDED.filter((id) => !moved.includes(id)), "and the rest keep their order");
});

test("a before-placement is moveAfter's mirror, and tolerates the missing the same way", () => {
  assert.deepStrictEqual(moveBefore(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
  assert.deepStrictEqual(moveBefore(["a", "b", "c"], "zz", "a"), ["a", "b", "c"]);
  assert.deepStrictEqual(moveBefore(["a", "b", "c"], "a", "zz"), ["a", "b", "c"]);
});

test("a move works in either direction and never changes what it was given", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepStrictEqual(moveAfter(ids, "d", "a"), ["a", "d", "b", "c"]);
  assert.deepStrictEqual(moveAfter(ids, "a", "c"), ["b", "c", "a", "d"]);
  assert.deepStrictEqual(moveAfter(ids, "b", "a"), ["a", "b", "c", "d"], "already there");
  assert.deepStrictEqual(ids, ["a", "b", "c", "d"]);
});

test("a button that is missing leaves the toolbar as it was, rather than throwing", () => {
  const ids = ["a", "b", "c"];
  assert.deepStrictEqual(moveAfter(ids, "zz", "a"), ids);
  assert.deepStrictEqual(moveAfter(ids, "a", "zz"), ids);
  assert.deepStrictEqual(moveAfter(ids, "a", "a"), ids);
  assert.deepStrictEqual(moveAfter(null, "a", "b"), []);
  assert.deepStrictEqual(arrange(["preview", "x"]), ["preview", "x"]);
});

test("every placement names a button the editor really adds", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "src", "oscar_editor.js"), "utf8");
  for (const { id, after, before } of PLACEMENTS) {
    for (const name of [id, after || before]) {
      // "preview" comes from the GrapesJS preset; the rest are OSCAR's own.
      assert.ok(name === "preview" || src.includes('"' + name + '"'), name + " is a button id in the editor");
    }
  }
});

test("Publish sits with the project on the left; the server's address with the server on the right", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "src", "oscar_editor.js"), "utf8");
  assert.match(src, /pn\.addButton\("devices-c", \{\s*id: "oscar-export",/, "Publish is added to the left panel");
  assert.match(src, /pn\.addButton\("options", \{\s*id: "ipButton",/, "the address to the right one");
  assert.match(src, /"data-tooltip": "Publish your interface", "data-tooltip-pos": "bottom"/, "and Publish carries its own tooltip, now that the right half's labels pass it by");
  // The right half is the fuller one now: on a laptop the address keeps its numbers and drops its words.
  assert.match(src, /'<span class="oscar-ip-word">Server IP: <\/span>' \+\s*ipServer \+\s*\(oscInPort \? '<span class="oscar-ip-port"> · <span class="oscar-ip-word">Listening Port: <\/span>' \+ oscInPort \+ "<\/span>" : ""\)/);
  const theme = fs.readFileSync(path.join(__dirname, "..", "public", "css", "oscar_theme.css"), "utf8").replace(/\r\n/g, "\n");
  assert.match(theme, /@media \(max-width: 1720px\) \{\n  \.oscar-ip-label \.oscar-ip-word \{\n    display: none;/, "so it does not run under the screen sizes");
  assert.match(theme, /@media \(max-width: 1400px\) \{\n  \.oscar-ip-label \.oscar-ip-port \{\n    display: none;/, "and on a small laptop the address alone stays");
});

test("Publish is an arrow leaving its box, not Import's arrow", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "src", "oscar_editor.js"), "utf8");
  const publish = /publish:\s*"([^"]+)"/.exec(src);
  assert.ok(publish, "there is a publish icon");
  assert.ok(publish[1].indexOf("M12,1L8,5H11V14H13V5H16M18,23H6") === 0, "mdi-export-variant: an arrow out of a box");
  assert.match(src, /id: "oscar-export",\s*className: "oscar-publish-btn",[\s\S]{0,80}label: icon\("publish"\) \+ '<span class="oscar-bar-pill-word">Publish<\/span>',/, "and Publish uses it, with its word, as a pill");
  const theme = fs.readFileSync(path.join(__dirname, "..", "public", "css", "oscar_theme.css"), "utf8").replace(/\r\n/g, "\n");
  assert.match(theme, /\.gjs-pn-btn\.oscar-lock-btn,\n\.gjs-pn-btn\.oscar-publish-btn \{\n  display: inline-flex;[\s\S]{0,200}border-radius: 999px;/, "the padlock and Publish are pills like the live pills");
  assert.match(theme, /\.gjs-pn-btn\.oscar-locked,\n\.gjs-pn-btn\.oscar-locked:hover \{\n  background-color: var\(--o-accent-subtle\);\n  border-color: var\(--o-accent\);/, "and a locked padlock's pill says so in colour");
  // The preset's Import icon, which stays as GrapesJS draws it.
  assert.notStrictEqual(publish[1], "M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z");
});

test("an extension's button can be placed beside one of OSCAR's, and taken away again", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "src", "oscar_editor.js"), "utf8");
  assert.match(src, /function arrangeToolbar\(placements\)/);
  assert.match(src, /toolbarOrder\.arrange\(ids, placements\)/);
  assert.match(src, /if \(button\.after\) arrangeToolbar\(\[\{ id: button\.id, after: String\(button\.after\) \}\]\);/);
  assert.match(src, /removeToolbarButton: function \(id\)/);
  // A placement for a button that is there moves only that one.
  assert.deepStrictEqual(arrange(["a", "open-styles", "b", "ext"], [{ id: "ext", after: "open-styles" }]), ["a", "open-styles", "ext", "b"]);
});
