"use strict";

/**
 * Reading a whole HTML document -- a template, or a file pasted into Import --
 * as the parts OSCAR takes from it.
 *
 * GrapesJS can read a document itself, but it then replaces the canvas's
 * <head> with the one in the file, and that head is where OSCAR's fonts, widget
 * styles and widget rules are loaded. Every widget lost its styling, and the
 * head was saved with the project, so it happened again on every reload.
 *
 * So a document is turned into what GrapesJS reads without trouble: its CSS
 * and the contents of its <body>. The attributes on <body> are handed back
 * separately, because that is where a template names its widget style.
 */

const COMMENT = /<!--[\s\S]*?-->/g;
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const BODY_OPEN = /<body\b([^>]*)>/i;
const BODY_CLOSE = /<\/body\s*>/i;
const ATTRIBUTE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * CSS with its comments taken out, strings left alone.
 *
 * The editor's CSS parser reads a comment INSIDE a rule as a declaration and
 * stores it as `undefined: undefined`, which is then saved with the project
 * and written into every export. Comments between rules are harmless but go
 * the same way, since nothing downstream keeps them anyway.
 */
function stripCssComments(css) {
  const text = String(css == null ? "" : css);
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      out += ch;
      // An escaped character cannot close the string.
      if (ch === "\\" && i + 1 < text.length) out += text[++i];
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      // An unclosed comment swallows the rest, as it does in a browser.
      i = end === -1 ? text.length : end + 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** The same markup with the comments removed from every <style> block. */
function cleanStyleBlocks(html) {
  return String(html == null ? "" : html).replace(STYLE_BLOCK, function (block, css) {
    return block.replace(css, function () {
      return stripCssComments(css);
    });
  });
}

function attributesOf(source) {
  const attributes = {};
  for (const match of String(source).matchAll(ATTRIBUTE)) {
    const value = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4];
    attributes[match[1].toLowerCase()] = value === undefined ? "" : value;
  }
  return attributes;
}

/**
 * `{ html, bodyAttributes }` for a document, or null for anything that has no
 * <body> -- a fragment, which GrapesJS already reads as it is.
 *
 * `html` is every <style> block followed by the body's contents. Comments are
 * dropped first, so a <body> written inside one is not mistaken for the real
 * one.
 */
function readDocument(input) {
  const text = String(input == null ? "" : input).replace(COMMENT, "");
  const open = BODY_OPEN.exec(text);
  if (!open) return null;

  const start = open.index + open[0].length;
  const close = text.slice(start).search(BODY_CLOSE);
  const body = close === -1 ? text.slice(start) : text.slice(start, start + close);

  const css = [...text.matchAll(STYLE_BLOCK)].map((m) => stripCssComments(m[1]).trim()).filter(Boolean);
  const html = (css.length ? "<style>\n" + css.join("\n") + "\n</style>\n" : "") + body.replace(STYLE_BLOCK, "").trim();

  return { html, bodyAttributes: attributesOf(open[1]) };
}

module.exports = { readDocument, attributesOf, stripCssComments, cleanStyleBlocks };
