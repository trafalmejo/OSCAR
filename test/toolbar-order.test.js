"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { PLACEMENTS, moveAfter, moveBefore, arrange } = require("../lib/toolbar-order");

// The order the editor's scripts add their buttons in: the sizes join late
// (moved over from the left panel), Import is removed after the preset adds
// it, and Open/Save live under File on the left, holding no seat here.
const ADDED = [
  "sw-visibility", "preview", "fullscreen", "export-template", "undo", "redo",
  "canvas-clear", "open-styles", "open-pages", "oscar-export", "toggle-lock", "open-info",
  "set-device-desktop", "set-device-tablet", "set-device-mobile",
];

test("the sizes lead the right half, the lock sits beside Push to preview, Pages beside the widget style", () => {
  const order = arrange(ADDED);
  assert.deepStrictEqual(order.slice(0, 4), ["set-device-desktop", "set-device-tablet", "set-device-mobile", "sw-visibility"], "the pill of sizes, ahead of everything");
  assert.strictEqual(order[order.indexOf("preview") + 1], "toggle-lock");
  assert.strictEqual(order[order.indexOf("open-styles") + 1], "open-pages");
  for (const retired of ["gjs-open-import-webpage", "open-load", "open-save"]) {
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
  for (const { id, after } of PLACEMENTS) {
    for (const name of [id, after]) {
      // "preview" comes from the GrapesJS preset; the rest are OSCAR's own.
      assert.ok(name === "preview" || src.includes('"' + name + '"'), name + " is a button id in the editor");
    }
  }
});

test("Publish and Import are told apart by their arrows: out is up, in is down", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "src", "oscar_editor.js"), "utf8");
  // Both used to draw the same down arrow, side by side or not.
  const upload = /upload:\s*"([^"]+)"/.exec(src);
  assert.ok(upload, "there is an upload icon");
  assert.match(src, /id:\s*"oscar-export",\s*label:\s*icon\("upload"\)/, "and Publish uses it");
  // The preset's Import icon, which stays as GrapesJS draws it.
  assert.notStrictEqual(upload[1], "M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z");
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
