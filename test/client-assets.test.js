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
