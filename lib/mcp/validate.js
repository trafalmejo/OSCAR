"use strict";

/**
 * Reading and judging a surface handed to OSCAR as HTML -- by an assistant
 * through the MCP server, though nothing here is assistant-specific.
 *
 * The judging is the widgets' own: every setting must be one the widget has,
 * and every value must pass the same per-field checks the settings panel
 * runs (`checks` in each definition, lib/widgets/index.js). An assistant
 * that gets a complaint back can correct itself; a surface that validates
 * here is one the editor will open without surprises.
 *
 * The parsing matches how the editor reads an imported file: opening tags
 * from <body> on, widgets recognised by the adapter's own matches(), and
 * data-gjs-min-x read as minX (the editor's parser configuration). The same
 * reading lives in test/templates.test.js, which holds OSCAR's own templates
 * to the same bar.
 */

const { WIDGETS } = require("../widgets");
const { checkMessage } = require("../widgets/fields");
const { matches } = require("../../public/src/adapters/grapesjs");

/** Opening tags from <body> on, with their attributes. */
function bodyTags(html) {
  // A script's text is code, not markup: "i<n" is not a tag.
  const markup = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, "$1$2");
  const at = markup.search(/<body\b/i);
  if (at === -1) return null;
  return [...markup.slice(at).matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)].map((m) => ({
    tag: m[1].toLowerCase(),
    attrs: Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
  }));
}

/** The entities an attribute value must escape, put back. */
function unescapeAttr(value) {
  return String(value).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
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

/** The widget a tag becomes, decided the way the editor decides it. */
function widgetFor(part) {
  const classes = (part.attrs.class || "").split(" ");
  const el = {
    tagName: part.tag.toUpperCase(),
    getAttribute: (name) => (name in part.attrs ? part.attrs[name] : null),
    classList: { contains: (name) => classes.includes(name) },
  };
  return WIDGETS.find((widget) => matches(widget, el)) || null;
}

/**
 * Judge a whole surface.
 *
 * @returns {{ ok: boolean, widgets: number, problems: string[], warnings: string[] }}
 *          `problems` block saving; `warnings` are worth fixing but do not.
 */
function validateSurface(html) {
  const problems = [];
  const warnings = [];
  const tags = bodyTags(html);
  if (tags === null) {
    return { ok: false, widgets: 0, problems: ["There is no <body>. A surface is an HTML document."], warnings };
  }
  if (!/<title[^>]*>[^<]*\S[^<]*<\/title>/i.test(String(html))) {
    warnings.push("No <title>: the Load list would show the file name instead of a name.");
  }

  const parts = tags.slice(1); // past <body> itself
  const seen = new Set();
  let widgets = 0;

  for (const part of parts) {
    const widget = widgetFor(part);
    const settings = settingsOf(part.attrs);
    delete settings.dmode;
    const where = part.attrs.id ? "#" + part.attrs.id : "a <" + part.tag + ">";

    if (!widget) {
      for (const key of Object.keys(settings)) {
        problems.push(where + ": data-gjs-" + key + " is a widget setting on something that is not a widget.");
      }
      continue;
    }

    widgets++;
    if (!part.attrs.id) {
      problems.push("A " + widget.name + " has no id. Every widget needs one: it is how a surface knows a widget across devices.");
      continue;
    }
    if (seen.has(part.attrs.id)) {
      problems.push("#" + part.attrs.id + " is used twice. Ids must be unique.");
      continue;
    }
    seen.add(part.attrs.id);

    // An authored setting that is not the widget's is a mistake to name; a
    // baked config (data-oscar-config, how an export or a published page
    // carries settings) may hold keys from another OSCAR version, so an
    // unknown key there is dropped the way readWidget drops it.
    for (const key of Object.keys(settings)) {
      if (!(key in widget.defaults)) {
        problems.push(where + ": " + JSON.stringify(key) + " is not a " + widget.name + " setting.");
        delete settings[key];
      }
    }
    if (part.attrs["data-oscar-config"]) {
      let baked = null;
      try {
        baked = JSON.parse(unescapeAttr(part.attrs["data-oscar-config"]));
      } catch {
        problems.push(where + ": data-oscar-config is not JSON.");
      }
      if (baked && typeof baked === "object") {
        for (const key of Object.keys(baked)) {
          if (key in widget.defaults && !(key in settings)) settings[key] = baked[key];
        }
      }
    }

    if ("message" in settings) {
      const complaint = checkMessage(settings.message);
      if (complaint) problems.push(where + ": message " + JSON.stringify(settings.message) + " -- " + complaint);
    }
    // The widget's own panel checks, run over the whole config as the panel would.
    const config = Object.assign({}, widget.defaults, settings);
    for (const [key, value] of Object.entries(settings)) {
      const check = widget.checks && widget.checks[key];
      if (!check) continue;
      const complaint = check(value, config);
      if (complaint) problems.push(where + ": " + key + "=" + JSON.stringify(value) + " -- " + complaint);
    }
  }

  if (widgets === 0) warnings.push("No widgets: the surface would be a page that controls nothing.");
  return { ok: problems.length === 0, widgets, problems, warnings };
}

module.exports = { validateSurface, bodyTags, settingsOf, widgetFor };
