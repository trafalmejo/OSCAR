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
const { WIDGETS } = require("../lib/widgets");
const { parsed, matches } = require("../public/src/adapters/grapesjs");

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
  // A script's text is code, not markup: "i<n" is not a tag.
  const markup = html.replace(/<!--[\s\S]*?-->/g, "").replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, "$1$2");
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

/**
 * The widget a tag becomes, decided the way the editor decides it: by the
 * adapter's own matches(), over every registered widget. A widget added
 * later is recognised here with no change to this file.
 */
function widgetFor(part) {
  const classes = (part.attrs.class || "").split(" ");
  const el = {
    tagName: part.tag.toUpperCase(),
    getAttribute: (name) => (name in part.attrs ? part.attrs[name] : null),
    classList: { contains: (name) => classes.includes(name) },
  };
  return WIDGETS.find((widget) => matches(widget, el)) || null;
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
      // A setting the widget's own panel would refuse must not ship in a template.
      const config = Object.assign({}, widget.defaults, settings);
      for (const [key, value] of Object.entries(settings)) {
        const check = widget.checks && widget.checks[key];
        if (check) assert.strictEqual(check(value, config), null, part.attrs.id + ": " + key + "=" + JSON.stringify(value));
      }
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
    // Only the queries about width are about layout. One about the viewer,
    // such as asking for less motion, has nothing to do with the editor's views.
    const widths = queries.filter((query) => /width/.test(query));
    assert.deepStrictEqual(widths.sort(), ["(max-width: 480px)", "(max-width: 992px)"]);
  });

  test(file + ": a script is in the body, where OSCAR keeps it", () => {
    // The head of an imported document is thrown away, and a script with it.
    const head = html.slice(0, html.search(/<body\b/i)).replace(/<!--[\s\S]*?-->/g, "");
    assert.ok(!/<script\b/i.test(head), "a script in the head never runs");
  });

  test(file + ": anything that moves stands still for someone who has asked for less motion", () => {
    if (!/@keyframes/.test(html)) return;
    const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(html);
    assert.ok(reduced, "there is a reduced-motion query");
    // Every class given an animation is named in it.
    const animated = [...html.matchAll(/\n(\.[\w-]+)\s*\{[^}]*\banimation:/g)].map((m) => m[1]);
    assert.ok(animated.length > 0);
    for (const selector of animated) assert.ok(reduced[1].includes(selector), selector + " keeps moving");
    assert.match(reduced[1], /animation:\s*none/);
  });
}

test("the Showcase follows a picked widget style: outside its own tokens, no colour is fixed", () => {
  const html = fs.readFileSync(path.join(DIR, "oscar-showcase.html"), "utf8");
  assert.match(html, /<body data-osc-style="own"/, "starts on Page's own");
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  // Its tokens are written for "own" only, so any other choice takes over.
  assert.ok(css.includes('[data-osc-style="own"] {'));
  assert.ok(!/\[data-osc-style\]\s*\{/.test(css), "a rule for every style would pin the look again");
  const fixed = css
    .split("\n")
    .filter((line) => !/^\s*--osc-/.test(line))
    .filter((line) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(line));
  assert.deepStrictEqual(fixed, [], "colours that would not change with the style");
});

// Every rule in a stylesheet as [selector, body], media queries opened up.
function rulesOf(css) {
  const rules = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open === -1) break;
    let depth = 1;
    let close = open + 1;
    for (; depth; close++) depth += text[close] === "{" ? 1 : text[close] === "}" ? -1 : 0;
    const selector = text.slice(i, open).trim();
    const body = text.slice(open + 1, close - 1);
    if (/^@media/.test(selector)) rules.push(...rulesOf(body));
    else rules.push([selector, body]);
    i = close;
  }
  return rules;
}

test("a template that starts on Page's own can still be given a widget style: its fixed colours are for \"own\" alone", () => {
  const OWN = '[data-osc-style="own"]';
  let checked = 0;
  for (const file of fs.readdirSync(DIR).filter((name) => name.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(DIR, file), "utf8");
    if (!/<body data-osc-style="own"/.test(html)) continue;
    checked++;
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
    for (const [selector, body] of rulesOf(css)) {
      if (selector === OWN || /^@font-face/.test(selector)) continue;
      if (!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(body)) continue;
      // A comma inside :has() or :not() is not the end of a selector.
      const each = selector.split(/,(?![^(]*\))/).map((part) => part.trim());
      for (const part of each) assert.ok(part.startsWith(OWN), file + ": " + part + " fixes a colour under every style");
    }
  }
  assert.ok(checked >= 8, "the Showcase and the seven objects");
});

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
