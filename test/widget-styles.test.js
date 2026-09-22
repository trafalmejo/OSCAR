"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const styles = require("../lib/widget-styles");

const CSS = path.join(__dirname, "..", "public", "assets", "css");
const read = (rel) => fs.readFileSync(path.join(CSS, rel), "utf8");

test("the styles on offer are the ones asked for, with unique ids", () => {
  const ids = styles.STYLES.map((s) => s.id);
  assert.deepStrictEqual(ids, ["default", "amber-minimal", "cyberpunk", "supabase", "tangerine", "neon", "hud"]);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.ok(styles.isStyle(styles.DEFAULT_STYLE));
  assert.ok(styles.isAppearance(styles.DEFAULT_APPEARANCE));
});

test("every style in the registry has a file, and every file is in the registry", () => {
  const files = fs.readdirSync(path.join(CSS, "styles")).map((f) => f.replace(/\.css$/, ""));
  assert.deepStrictEqual(files.sort(), styles.STYLES.map((s) => s.id).sort());
});

test("every style defines itself for light and for dark", () => {
  for (const { id } of styles.STYLES) {
    const css = read("styles/" + id + ".css");
    assert.ok(css.includes('[data-osc-style="' + id + '"]'), id + " light");
    assert.ok(css.includes('[data-osc-style="' + id + '"][data-osc-appearance="dark"]'), id + " dark");
  }
  // A surface that never picked a style still has to look like something.
  assert.match(read("styles/default.css"), /:root,\s*\[data-osc-style="default"\]/);
});

test("every token a widget draws with is given a value by every style", () => {
  // A style that forgot one would leave that part of a widget unpainted --
  // no error anywhere, just a transparent button or an invisible track.
  const widgets = read("toggle.css");
  const used = new Set([...widgets.matchAll(/var\((--osc-[a-z-]+)\)/g)].map((m) => m[1]));
  const ownSizes = new Set([...widgets.matchAll(/(--osc-[a-z-]+)\s*:/g)].map((m) => m[1]));

  for (const { id } of styles.STYLES) {
    const defined = new Set([...read("styles/" + id + ".css").matchAll(/(--osc-[a-z-]+)\s*:/g)].map((m) => m[1]));
    const missing = [...used].filter((token) => !defined.has(token) && !ownSizes.has(token));
    assert.deepStrictEqual(missing, [], id + " leaves tokens undefined");
  }
});

test("the canvas loads fonts first, then every style, then the widgets", () => {
  const refs = styles.canvasStylesheets();
  const firstStyle = refs.findIndex((r) => r.startsWith("assets/css/styles/"));
  assert.ok(refs.slice(0, firstStyle).every((r) => r.startsWith("node_modules/@fontsource-variable/")));
  assert.strictEqual(refs.filter((r) => r.startsWith("assets/css/styles/")).length, styles.STYLES.length);
  assert.strictEqual(refs[refs.length - 1], "assets/css/toggle.css");
  // Each bundled font is loaded once, however many styles use it.
  assert.strictEqual(new Set(refs).size, refs.length);
});

test("the surface rule keeps GrapesJS's own protected defaults", () => {
  // Setting protectedCss replaces GrapesJS's default rather than adding to it.
  assert.match(styles.SURFACE_CSS, /\*\s*\{\s*box-sizing:\s*border-box;\s*\}/);
  assert.match(styles.SURFACE_CSS, /body\s*\{\s*margin:\s*0;\s*\}/);
  assert.match(styles.SURFACE_CSS, /background-color:\s*var\(--osc-background\)/);
});

test("Reset to style takes away how a widget looks and keeps where it is", () => {
  const style = {
    position: "absolute",
    left: "24px",
    top: "80px",
    width: "300px",
    height: "120px",
    padding: "8px",
    "background-color": "#00ff00",
    color: "red",
    border: "2px solid black",
    "border-radius": "0px",
    "box-shadow": "none",
    "font-family": "Georgia",
    "letter-spacing": "2px",
    opacity: "0.5",
    "--osc-primary": "hotpink",
  };
  assert.deepStrictEqual(styles.withoutAppearance(style), {
    position: "absolute",
    left: "24px",
    top: "80px",
    width: "300px",
    height: "120px",
    padding: "8px",
  });
  assert.deepStrictEqual(styles.withoutAppearance(undefined), {});
});

test("only whole appearance property names count, not look-alikes", () => {
  for (const name of ["color", "background", "background-image", "border-top-left-radius", "outline-offset", "font-size", "text-align"]) {
    assert.strictEqual(styles.isAppearanceProperty(name), true, name);
  }
  for (const name of ["column-gap", "left", "width", "opacity-level", "colors", "min-height", "z-index"]) {
    assert.strictEqual(styles.isAppearanceProperty(name), false, name);
  }
});

test("the canvas body takes the surface's style, and loses it when there is none", () => {
  const attrs = {};
  const body = {
    setAttribute: (name, value) => { attrs[name] = value; },
    removeAttribute: (name) => { delete attrs[name]; },
  };
  styles.copyToBody({ id: "irqz", "data-osc-style": "cyberpunk", "data-osc-appearance": "dark" }, body);
  assert.deepStrictEqual(attrs, { "data-osc-style": "cyberpunk", "data-osc-appearance": "dark" });

  styles.copyToBody({ id: "irqz" }, body);
  assert.deepStrictEqual(attrs, {});
});

test("Reset to style is offered on the widgets and on the body, and nowhere else", () => {
  for (const type of ["oscar-button", "oscar-slider", "oscar-xypad", "wrapper"]) {
    assert.strictEqual(styles.offersReset(type), true, type);
  }
  for (const type of ["text", "image", "default", "", undefined]) {
    assert.strictEqual(styles.offersReset(type), false, String(type));
  }
});

test("a page can keep its own look: a choice in the picker with no file behind it", () => {
  assert.strictEqual(styles.CHOICES[styles.CHOICES.length - 1], styles.OWN_STYLE, "offered last, after the real styles");
  assert.ok(!styles.STYLES.includes(styles.OWN_STYLE), "not a style with a stylesheet to load");
  assert.ok(styles.isStyle(styles.OWN_STYLE.id), "and still a value a body may carry");
  assert.ok(!styles.canvasStylesheets().some((ref) => ref.includes("/" + styles.OWN_STYLE.id + ".css")));
  // Survives an import, like any other choice.
  const attrs = styles.withSurfaceStyle({}, { "data-osc-style": "own", "data-osc-appearance": "dark" });
  assert.deepStrictEqual(attrs, { "data-osc-style": "own", "data-osc-appearance": "dark" });
  // Default's values lie underneath, light and dark, so no widget goes unpainted.
  const css = read("styles/default.css");
  assert.ok(css.includes('[data-osc-style="own"]'));
  assert.ok(css.includes('[data-osc-style="own"][data-osc-appearance="dark"]'));
});

test("a style with a look of its own keeps it to itself: every rule it adds is for its own attribute", () => {
  let looked = 0;
  for (const { id } of styles.STYLES) {
    const css = read("styles/" + id + ".css");
    const widgets = /@layer oscar\.widgets \{([\s\S]*)\n\}/.exec(css);
    if (!widgets) continue;
    looked++;
    const body = widgets[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // A keyframes block is steps, not selectors; a media query wraps selectors, which are read as if it were not there.
      .replace(/@keyframes[^{]*\{[\s\S]*?\}\s*\}/g, "}")
      .replace(/@media[^{]*\{/g, "}");
    // A selector list: what stands between a closing brace (or the start) and the next opening one.
    const selectors = [...body.matchAll(/(?:^|\})\s*([^@{}]+?)\s*\{/g)].map((m) => m[1].trim());
    assert.ok(selectors.length > 0, id);
    const own = '[data-osc-style="' + id + '"]';
    for (const list of selectors) {
      for (const selector of list.split(",")) assert.ok(selector.trim().startsWith(own), id + ": " + selector);
    }
    // And no colour of its own outside the tokens: everything is drawn from them.
    const fixed = widgets[1].split("\n").filter((line) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(line));
    assert.deepStrictEqual(fixed, [], id);
    // Anything that moves stands still for someone who asked for less motion.
    if (/@keyframes/.test(widgets[1])) assert.match(widgets[1], /prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  }
  assert.deepStrictEqual(looked, 2, "neon and hud");
});
