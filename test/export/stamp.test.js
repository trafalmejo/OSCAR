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

test("with its styles, the stamp is of the whole page: a visual edit counts, a hand on a fader still does not", () => {
  const fader = tag("oscar-slider", "f1", { message: "/a", value: 10 });
  const page = (html, css) => surfaceStamp("<body><h1>Lobby</h1>" + html + "</body>", css);
  const whole = page(fader, ".x { color: red; }");
  assert.ok(whole);
  assert.notStrictEqual(whole, surfaceStamp("<body><h1>Lobby</h1>" + fader + "</body>"), "the page's stamp is not the widgets' alone");

  // What the canvas sends to publish is what it is compared with later, byte for byte.
  assert.strictEqual(page(fader, ".x { color: red; }"), whole);
  // A colour, a heading, a wrapper: changes to publish.
  assert.notStrictEqual(page(fader, ".x { color: blue; }"), whole, "a style");
  assert.notStrictEqual(surfaceStamp("<body><h1>Foyer</h1>" + fader + "</body>", ".x { color: red; }"), whole, "a heading");
  assert.notStrictEqual(surfaceStamp("<body><h1>Lobby</h1><div>" + fader + "</div></body>", ".x { color: red; }"), whole, "a wrapper");
  // A fader moved on the canvas is not a change to publish.
  assert.strictEqual(page(tag("oscar-slider", "f1", { message: "/a", value: 99 }), ".x { color: red; }"), whole, "a moved fader");
  // A setting still is.
  assert.notStrictEqual(page(tag("oscar-slider", "f1", { message: "/b", value: 10 }), ".x { color: red; }"), whole);
  // No styles at all is still a page, told apart from the widgets-only form.
  assert.notStrictEqual(page(fader, ""), surfaceStamp("<body><h1>Lobby</h1>" + fader + "</body>"));
  assert.strictEqual(surfaceStamp("<body><p>nothing here</p></body>", ".x {}"), "", "no widgets, no stamp, styles or not");
});

test("the window says it of the interface published from this project, and the toolbar wears the dot", () => {
  const dialog = fs.readFileSync(path.join(__dirname, "..", "..", "public", "src", "export_dialog.js"), "utf8");
  assert.match(dialog, /var mine = publishedMine\(\);\s*if \(!mine \|\| !mine\.stamp \|\| canvasStamp === null\) return false;\s*return mine\.stamp !== canvasStamp;/, "only the interface published from this project is judged");
  assert.match(dialog, /function paintStale\(\) \{\s*paintFoot\(\);/, "and the card's foot follows the canvas while the window is open");
  assert.match(dialog, /if \(known\[i\]\.project === id\) return known\[i\];/, "matched by which project it is, never by name");
  assert.match(dialog, /"Changes not published"/);
  assert.match(dialog, /refreshPublished\(\)\.then\(restamp\)/, "the dot does not wait for the dialog");
  assert.match(dialog, /oscar-publish-stale/);
  assert.match(dialog, /editor\.on\("update"/, "the dot follows edits");
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "public", "css", "oscar_export.css"), "utf8");
  assert.match(css, /\.gjs-pn-btn\.oscar-publish-stale \{\s*background-image: radial-gradient/);
});
