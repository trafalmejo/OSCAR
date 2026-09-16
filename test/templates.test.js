"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { listTemplates, titleOf } = require("../lib/templates");
const styles = require("../lib/widget-styles");
const { checkMessage } = require("../lib/widgets/fields");
const { button } = require("../lib/widgets/button");
const { slider } = require("../lib/widgets/slider");
const { xypad } = require("../lib/widgets/xypad");
const { parsed } = require("../public/src/adapters/grapesjs");

const DIR = path.join(__dirname, "..", "public", "templates");
const PUBLIC = path.join(__dirname, "..", "public");

// ---- the list ---------------------------------------------------------------

test("templates are listed by their title, and anything else in the folder is ignored", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-templates-"));
  fs.writeFileSync(path.join(dir, "zeta.html"), "<!doctype html><title>Zeta Board</title>");
  fs.writeFileSync(path.join(dir, "alpha.html"), "<!doctype html><title> Alpha Board </title>");
  fs.writeFileSync(path.join(dir, "untitled.html"), "<!doctype html><p>no title</p>");
  fs.writeFileSync(path.join(dir, "notes.txt"), "not a template");
  fs.writeFileSync(path.join(dir, "Bad Name.html"), "<title>Bad</title>");

  const rows = await listTemplates(dir);
  assert.deepStrictEqual(
    rows.map((r) => [r._id, r.name, r.url, r.template]),
    [
      ["alpha", "Alpha Board", "templates/alpha.html", true],
      ["untitled", "untitled", "templates/untitled.html", true],
      ["zeta", "Zeta Board", "templates/zeta.html", true],
    ]
  );
  assert.ok(rows.every((r) => r.size > 0));
});

test("a missing templates folder means no templates, not an error", async () => {
  assert.deepStrictEqual(await listTemplates(path.join(os.tmpdir(), "oscar-no-such-folder")), []);
  assert.strictEqual(titleOf("<p>none</p>"), "");
});

test("OSCAR ships the Live Visuals Controller, at an address the editor can fetch", async () => {
  const rows = await listTemplates(DIR);
  const lvc = rows.find((r) => r._id === "live-visuals-controller");
  assert.ok(lvc, "listed");
  assert.strictEqual(lvc.name, "Live Visuals Controller");
  assert.ok(fs.existsSync(path.join(PUBLIC, lvc.url)), "served from public/");
});

// ---- every shipped template ---------------------------------------------------

/** Opening tags from <body> on, with their attributes. Enough for these files. */
function bodyTags(html) {
  const markup = html.replace(/<!--[\s\S]*?-->/g, "");
  const body = markup.slice(markup.search(/<body\b/i));
  return [...body.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)].map((m) => ({
    tag: m[1].toLowerCase(),
    attrs: Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
  }));
}

/** data-gjs-min-x becomes minX, as the editor's parser is configured to read it. */
function settingsOf(attrs) {
  const out = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (!name.startsWith("data-gjs-")) continue;
    out[name.slice("data-gjs-".length).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return out;
}

function widgetFor(part) {
  if (part.tag === "button") return button;
  if (part.tag === "input" && part.attrs.type === "range") return slider;
  if (/\boscar-xypad\b/.test(part.attrs.class || "")) return xypad;
  return null;
}

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(DIR, file), "utf8");
  const tags = bodyTags(html);
  const body = tags[0];
  const parts = tags.slice(1);

  test(file + ": is a whole document, and its body names a style OSCAR has", () => {
    assert.match(html, /^<!doctype html>/i);
    assert.ok(titleOf(html), "has a title for the Load list");
    assert.strictEqual(body.tag, "body");
    assert.ok(styles.isStyle(body.attrs[styles.STYLE_ATTRIBUTE]), "a style OSCAR has");
    assert.ok(styles.isAppearance(body.attrs[styles.APPEARANCE_ATTRIBUTE]), "light or dark");
  });

  test(file + ": every part has its own id and moves through the layout when dragged", () => {
    const ids = parts.map((p) => p.attrs.id);
    assert.deepStrictEqual(ids.filter((id) => !id), [], "parts without an id");
    assert.deepStrictEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], "repeated ids");
    // Without this the editor's absolute mode pulls a dragged part out of the grid.
    const loose = parts.filter((p) => p.attrs["data-gjs-dmode"] !== "flow").map((p) => p.attrs.id);
    assert.deepStrictEqual(loose, [], "parts that would be dragged out of the layout");
  });

  test(file + ": every widget setting is one the widget has, and every address is sendable", () => {
    for (const part of parts) {
      const widget = widgetFor(part);
      const settings = settingsOf(part.attrs);
      delete settings.dmode;
      if (!widget) {
        assert.deepStrictEqual(settings, {}, part.attrs.id + " is not a widget");
        continue;
      }
      for (const key of Object.keys(settings)) {
        assert.ok(key in widget.defaults, part.attrs.id + ": " + key + " is not a " + widget.name + " setting");
      }
      assert.strictEqual(checkMessage(settings.message), null, part.attrs.id + " has an OSC address");
      if (widget === slider) {
        const value = Number(settings.value);
        assert.ok(value >= Number(settings.min) && value <= Number(settings.max), part.attrs.id + " starts in range");
        assert.strictEqual(part.attrs.orient, settings.orientation, part.attrs.id + " draws the way it is set");
      }
    }
  });

  test(file + ": rearranges at the widths of the editor's Tablet and Mobile views", () => {
    // An edit made in one of those views lands in a query of exactly that width.
    const queries = [...new Set([...html.matchAll(/@media\s*([^{]+)\{/g)].map((m) => m[1].trim()))];
    assert.deepStrictEqual(queries.sort(), ["(max-width: 480px)", "(max-width: 992px)"]);
  });
}

// ---- reading a template in the editor -----------------------------------------

function element(tagName, text, attrs) {
  return {
    tagName,
    textContent: text,
    classList: { contains: (name) => ((attrs && attrs.class) || "").split(" ").includes(name) },
    getAttribute: (name) => (attrs && attrs[name] !== undefined ? attrs[name] : null),
  };
}

test("a button read from HTML is named after its text", () => {
  assert.deepStrictEqual(parsed(button, element("BUTTON", "  Strobe ")), { type: "oscar-button", label: "Strobe" });
  // An empty button keeps the default label rather than an empty one.
  assert.deepStrictEqual(parsed(button, element("BUTTON", "")), { type: "oscar-button" });
  assert.deepStrictEqual(parsed(slider, element("INPUT", "", { type: "range" })), { type: "oscar-slider" });
  assert.strictEqual(parsed(slider, element("INPUT", "", { type: "text" })), undefined);
});
