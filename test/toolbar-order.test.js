"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { PLACEMENTS, moveAfter, arrange } = require("../lib/toolbar-order");

// The order the editor's scripts add their buttons in.
const ADDED = [
  "sw-visibility", "preview", "fullscreen", "export-template", "undo", "redo",
  "gjs-open-import-webpage", "canvas-clear", "open-styles", "open-save", "open-pages",
  "open-load", "oscar-export", "toggle-lock", "open-serial", "open-info",
];

test("the lock sits beside Push to preview, and Pages beside the widget style", () => {
  const order = arrange(ADDED);
  assert.strictEqual(order[order.indexOf("preview") + 1], "toggle-lock");
  assert.strictEqual(order[order.indexOf("open-styles") + 1], "open-pages");
  assert.deepStrictEqual(order.slice().sort(), ADDED.slice().sort(), "nothing added, nothing lost");
  assert.deepStrictEqual(order.filter((id) => id !== "toggle-lock" && id !== "open-pages"),
    ADDED.filter((id) => id !== "toggle-lock" && id !== "open-pages"), "and the rest keep their order");
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
