"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "public");

// Each page and the script that boots GrapesJS on it.
const PAGES = {
  "index.ejs": "src/oscar_editor.js",
  "preview.ejs": "src/oscar_preview.js",
};

function read(rel) {
  return fs.readFileSync(path.join(PUBLIC, rel), "utf8");
}

function assetRefs(template) {
  const html = read(template);
  const refs = [];
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = m[1];
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith("data:")) continue;
    refs.push(ref);
  }
  return refs;
}

function scriptRefs(template) {
  return [...read(template).matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
}

// A missing script or stylesheet is not an error anyone sees -- the page just
// loads without it. OSCAR shipped 2.0 with the tooltip plugin pointing at a
// file that no longer exists.
for (const template of Object.keys(PAGES)) {
  test(template + ": every script and stylesheet it references exists", (t) => {
    if (!fs.existsSync(path.join(PUBLIC, "node_modules"))) {
      t.skip("browser libraries not installed (run npm install)");
      return;
    }
    const missing = assetRefs(template).filter((ref) => !fs.existsSync(path.join(PUBLIC, ref)));
    assert.deepStrictEqual(missing, [], "referenced but not on disk");
  });
}

// GrapesJS resolves a plugin listed by name by looking up window[name]. A
// package's npm name and the global it registers can differ --
// grapesjs-blocks-basic registers as "gjs-blocks-basic" -- and a mismatch
// just means the plugin silently never loads.
function globalsDefinedBy(template) {
  const names = new Set();
  for (const ref of scriptRefs(template)) {
    const file = path.join(PUBLIC, ref);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    // UMD bundles:  root["name"] = factory()
    for (const m of src.slice(0, 2000).matchAll(/\[["']([\w-]+)["']\]\s*=/g)) names.add(m[1]);
    // OSCAR's own plugins are plain top-level functions.
    for (const m of src.matchAll(/^function\s+([\w$]+)\s*\(/gm)) names.add(m[1]);
  }
  return names;
}

function pluginNames(entry) {
  const block = read(entry).match(/plugins:\s*\[([\s\S]*?)\]/);
  assert.ok(block, entry + " has a plugins list");
  return [...block[1].matchAll(/["']([\w-]+)["']/g)].map((m) => m[1]);
}

for (const [template, entry] of Object.entries(PAGES)) {
  test(template + ": every GrapesJS plugin it lists is defined by a loaded script", (t) => {
    if (!fs.existsSync(path.join(PUBLIC, "node_modules"))) {
      t.skip("browser libraries not installed (run npm install)");
      return;
    }
    const available = globalsDefinedBy(template);
    const unresolved = pluginNames(entry).filter((name) => !available.has(name));
    assert.deepStrictEqual(unresolved, [], "plugins no loaded script registers");
  });
}

// The canvas is a separate document: its stylesheets come from the style
// registry, not from the page template, so the template test above never sees
// them. A missing one leaves every widget unstyled.
for (const [template, entry] of Object.entries(PAGES)) {
  test(template + ": loads the canvas stylesheets from the style registry", () => {
    assert.match(read(entry), /canvas:\s*\{\s*styles:\s*widgetStyles\.canvasStylesheets\(\)\s*\}/);
    assert.match(read(entry), /protectedCss:\s*widgetStyles\.SURFACE_CSS/);
  });
}

test("every stylesheet the canvas loads exists", (t) => {
  const { canvasStylesheets } = require("../lib/widget-styles");
  const refs = canvasStylesheets();
  assert.strictEqual(refs[refs.length - 1], "assets/css/toggle.css", "the widgets load after the styles");
  const missing = refs.filter((ref) => !fs.existsSync(path.join(PUBLIC, ref)));
  if (missing.some((ref) => ref.startsWith("node_modules/")) && !fs.existsSync(path.join(PUBLIC, "node_modules"))) {
    t.skip("browser libraries not installed (run npm install)");
    return;
  }
  assert.deepStrictEqual(missing, [], "canvas stylesheets not on disk");
});

// Widget defaults must stay overridable. GrapesJS writes Style Manager edits as
// unlayered CSS, which beats any layered rule whatever its specificity -- but
// only if the defaults really are inside a layer. One rule written outside a
// layer, in the widgets or in any style, would silently start beating
// people's own styling.
const LAYERED = ["assets/css/toggle.css"].concat(
  fs.readdirSync(path.join(PUBLIC, "assets/css/styles")).map((file) => "assets/css/styles/" + file)
);

for (const file of LAYERED) {
  test(file + ": every rule sits inside a cascade layer", () => {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    // Walk the top level only: every block opened there must be an @layer.
    const outside = [];
    let depth = 0;
    let prelude = "";
    for (const ch of css) {
      if (ch === "{") {
        if (depth === 0 && !prelude.trim().startsWith("@layer")) outside.push(prelude.trim());
        depth++;
        prelude = "";
      } else if (ch === "}") {
        depth--;
        prelude = "";
      } else if (depth === 0) {
        // A top-level statement such as "@layer a, b;" ends at its semicolon.
        prelude = ch === ";" ? "" : prelude + ch;
      }
    }
    assert.deepStrictEqual(outside, [], "rules outside any @layer");
    // Whichever file the canvas reads first fixes the layer order, so every
    // one of them states it.
    assert.match(css, /@layer\s+oscar\.tokens\s*,\s*oscar\.widgets\s*;/, "layer order is declared up front");
  });
}

// OSCAR runs at venues with no internet. A font or stylesheet fetched from a
// CDN would fail there without an error, and every measurement in the theme
// would shift to a fallback face.
for (const template of Object.keys(PAGES)) {
  test(template + ": loads every stylesheet from OSCAR itself, never from the internet", () => {
    const remote = [...read(template).matchAll(/<link[^>]*\bhref="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((ref) => /^(https?:)?\/\//.test(ref));
    assert.deepStrictEqual(remote, [], "stylesheets loaded from another host");
  });

  test(template + ": the theme loads after the vendor stylesheets, so its tokens win", () => {
    const links = [...read(template).matchAll(/<link[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);
    const theme = links.indexOf("css/oscar_theme.css");
    assert.ok(theme !== -1, "oscar_theme.css is loaded");
    const vendor = links.filter((ref) => ref.startsWith("node_modules/"));
    for (const ref of vendor) {
      assert.ok(links.indexOf(ref) < theme, ref + " loads before the theme");
    }
  });

  // GrapesJS injects Font Awesome from a CDN at runtime unless told not to,
  // so the template test above cannot see it. Every tablet on the preview
  // page would make that request, and it fails without a word offline.
  test(template + ": tells GrapesJS not to fetch its icon font from the internet", () => {
    assert.match(read(PAGES[template]), /cssIcons:\s*""/);
  });

  // Bootstrap was replaced by the theme: its reset set the page's fonts,
  // colours and line-height, and every themed rule had to fight it.
  test(template + ": does not load Bootstrap, Popper or bootstrap-table", () => {
    const refs = assetRefs(template).join("\n");
    assert.doesNotMatch(refs, /bootstrap|popper/i);
  });
}

// The page a tablet opens is for driving a show, never for editing it. With a
// select tool there, GrapesJS cancels every click in the canvas, and a colour
// picker -- which opens as the default action of a click -- never opens.
test("preview.ejs: the page has no select tool to cancel an operator's clicks", () => {
  assert.match(read("src/oscar_preview.js"), /defaultCommand:\s*""/);
  assert.doesNotMatch(read("src/oscar_editor.js"), /defaultCommand:\s*""/, "the editor keeps its select tool");
});
