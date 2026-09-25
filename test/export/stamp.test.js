"use strict";

// The surface stamp: the editor's word for "the published copy is older than
// your canvas" (lib/export/stamp.js). Two pages with the same widgets, set
// the same way, share a stamp; what a hand changes as it plays does not count.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { surfaceStamp, VOLATILE } = require("../../lib/export/stamp");
const { byName } = require("../../lib/widgets");
const { exportAttributes } = require("../../lib/export/config");

function tag(name, id, settings) {
  const definition = byName[name];
  const config = Object.assign({}, definition.defaults, settings);
  const attributes = Object.assign({ id }, exportAttributes(name, (key) => config[key]));
  const text = Object.entries(attributes)
    .map(([k, v]) => k + '="' + String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"')
    .join(" ");
  return "<" + definition.tag + " " + text + "></" + definition.tag + ">";
}

test("the same controls stamp the same, whatever wraps them; a setting moves the stamp, a hand does not", () => {
  const fader = tag("oscar-slider", "f1", { message: "/a", value: 10 });
  const bare = surfaceStamp("<body>" + fader + "</body>");
  assert.ok(bare, "widgets stamp");
  assert.strictEqual(surfaceStamp("<!doctype html><html><head><style>.x{}</style></head><body><div>" + fader + "</div><script>1</script></body></html>"), bare, "the page around the widgets is not the surface");

  // What a hand replaces as it plays is left out, key by key.
  assert.deepStrictEqual(VOLATILE, ["value", "x", "y"]);
  assert.strictEqual(surfaceStamp("<body>" + tag("oscar-slider", "f1", { message: "/a", value: 99 }) + "</body>"), bare, "a moved fader is not a stale surface");

  // A setting is the surface: master off, another address, a bridge.
  for (const changed of [{ message: "/b" }, { enabled: false }, { dmxSendWhen: "data" }, { listen: true }]) {
    assert.notStrictEqual(surfaceStamp("<body>" + tag("oscar-slider", "f1", Object.assign({ message: "/a" }, changed)) + "</body>"), bare, JSON.stringify(changed));
  }
  // So is the widget's id, its kind, and which widgets there are.
  assert.notStrictEqual(surfaceStamp("<body>" + tag("oscar-slider", "f2", { message: "/a" }) + "</body>"), bare);
  assert.notStrictEqual(surfaceStamp("<body>" + tag("oscar-button", "f1", { message: "/a" }) + "</body>"), bare);
  assert.notStrictEqual(surfaceStamp("<body>" + fader + tag("oscar-button", "go", {}) + "</body>"), bare);

  assert.strictEqual(surfaceStamp("<body><p>nothing here</p></body>"), "", "no widgets, no stamp");
  assert.strictEqual(surfaceStamp(null), "");
});

test("the dialog says it on the copy this canvas would publish over, and the toolbar wears the dot", () => {
  const dialog = fs.readFileSync(path.join(__dirname, "..", "..", "public", "src", "export_dialog.js"), "utf8");
  assert.match(dialog, /page\.id === currentStem\(\)/, "only the surface this canvas would replace is judged");
  assert.match(dialog, /"outdated"/);
  assert.match(dialog, /refreshPublished\(\)\.then\(restamp\)/, "the dot does not wait for the dialog");
  assert.match(dialog, /oscar-publish-stale/);
  assert.match(dialog, /editor\.on\("update"/, "the dot follows edits");
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "public", "css", "oscar_export.css"), "utf8");
  assert.match(css, /\.gjs-pn-btn\.oscar-publish-stale \{\s*background-image: radial-gradient/);
});
