"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { readDocument, attributesOf } = require("../lib/html-document");
const { withSurfaceStyle } = require("../lib/widget-styles");

test("a document becomes its CSS and its body, and never its head", () => {
  const doc = readDocument(
    "<!doctype html><html><head><title>T</title><link rel=\"stylesheet\" href=\"x.css\">" +
      "<style>.a { color: red; }</style></head>" +
      '<body data-osc-style="cyberpunk" class=\'wide\' hidden><style>.b { margin: 0; }</style>' +
      "<button>Go</button></body></html>"
  );
  assert.strictEqual(doc.html, "<style>\n.a { color: red; }\n.b { margin: 0; }\n</style>\n<button>Go</button>");
  assert.deepStrictEqual(doc.bodyAttributes, { "data-osc-style": "cyberpunk", class: "wide", hidden: "" });
  assert.doesNotMatch(doc.html, /title|link/);
});

test("a fragment is left for GrapesJS to read as it is", () => {
  assert.strictEqual(readDocument("<button>Go</button><style>.a{}</style>"), null);
  assert.strictEqual(readDocument(undefined), null);
});

test("a <body> written inside a comment is not the body", () => {
  const doc = readDocument("<!-- style goes on <body> --><body data-osc-appearance=dark><p>x</p></body>");
  assert.deepStrictEqual(doc.bodyAttributes, { "data-osc-appearance": "dark" });
  assert.strictEqual(doc.html, "<p>x</p>");
});

test("an unclosed body runs to the end", () => {
  assert.strictEqual(readDocument("<body><p>x</p>").html, "<p>x</p>");
  assert.deepStrictEqual(attributesOf(' a="1" B=\'2\' c=3 d'), { a: "1", b: "2", c: "3", d: "" });
});

test("an import takes the style its body names, and only a style OSCAR has", () => {
  const surface = { id: "irqz", "data-osc-style": "tangerine", "data-osc-appearance": "light" };
  assert.deepStrictEqual(withSurfaceStyle(surface, { "data-osc-style": "supabase", "data-osc-appearance": "dark" }), {
    id: "irqz",
    "data-osc-style": "supabase",
    "data-osc-appearance": "dark",
  });
  // Importing replaces the surface, so no style named means no style kept.
  assert.deepStrictEqual(withSurfaceStyle(surface, {}), { id: "irqz" });
  assert.deepStrictEqual(withSurfaceStyle(surface, { "data-osc-style": "comic-sans", "data-osc-appearance": "dim" }), {
    id: "irqz",
  });
  assert.strictEqual(surface["data-osc-style"], "tangerine", "the surface's own attributes are not changed");
});

test("the shipped template reads as its widgets and CSS, with its style", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "templates", "live-visuals-controller.html"), "utf8");
  const doc = readDocument(html);
  assert.deepStrictEqual(doc.bodyAttributes, { "data-osc-style": "default", "data-osc-appearance": "dark" });
  assert.match(doc.html, /^<style>\n\/\* ---- desktop/);
  assert.match(doc.html, /<div id="lvc" class="lvc"/);
  assert.doesNotMatch(doc.html, /<title>|<head>|<body/);
});
