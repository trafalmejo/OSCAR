"use strict";

/**
 * A surface's stamp: what its controls are set to, as one short string.
 *
 * The editor's canvas and a published copy of it are two documents that
 * cannot be compared byte for byte -- the published page carries the runtime
 * around the same widgets -- but their widgets can be: same widgets, same
 * ids, same settings, same surface. The stamp reads every widget tag out of
 * a page's markup and hashes its id, its kind and its settings, in document
 * order, so the editor can say "the published copy is older than your
 * canvas" without keeping notes anywhere.
 *
 * What a hand changes as it plays is left out -- a fader's value, a pad's
 * position -- or every published surface would be stale the moment anyone
 * touched it. Given the page's styles as well, the stamp takes in the whole
 * page, markup and CSS, so a reworded heading or a changed colour is a
 * change to publish too; that is the form the editor and the publish route
 * use, since both hold the same document.
 *
 * Runs in the browser and in Node alike: string work and arithmetic only.
 */

const { NAME_ATTR, CONFIG_ATTR } = require("./config");

/** The settings a hand replaces as it plays; see STATE_KEYS in config.js. */
const VOLATILE = ["value", "x", "y"];

const TAG = new RegExp("<[^>]*" + NAME_ATTR + '="([^"]*)"[^>]*>', "g");
const ID = /\sid="([^"]*)"/;
const CONFIG = new RegExp("\\s" + CONFIG_ATTR + '="([^"]*)"');

function unescapeHtml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** cyrb53: a small, well-mixed 53-bit string hash; no crypto needed for "did it change". */
function hash(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A widget's settings as one line: sorted, with what a hand changes left out. */
function settled(raw) {
  let config;
  try {
    config = JSON.parse(unescapeHtml(raw));
  } catch (err) {
    config = { unreadable: raw };
  }
  if (!config || typeof config !== "object") return "none";
  for (const key of VOLATILE) delete config[key];
  return Object.keys(config)
    .sort()
    .map((key) => key + "=" + JSON.stringify(config[key]))
    .join(",");
}

/**
 * The stamp of a page's widgets, or "" for markup with none: two pages with
 * the same stamp hold the same controls, set the same way.
 *
 * Given the page's CSS as well, the stamp is of the whole page: the markup
 * around the widgets and the styles too, so that a heading reworded or a
 * colour changed counts as a change to publish, as it is. The widgets'
 * volatile settings are still left out of the markup before it is hashed,
 * so a fader moved on the canvas does not count. That form is for the
 * editor's canvas and what the editor sends to publish, which are the same
 * document; a published page, built around the runtime, is only ever
 * stamped by its widgets.
 *
 * @param {string} html any markup holding widget tags: a canvas snapshot, a
 *        published page, a template
 * @param {string} [css] the page's own styles, for the stamp of the whole page
 */
function surfaceStamp(html, css) {
  const parts = [];
  const page = String(html || "").replace(TAG, function (tag, name) {
    const id = ID.exec(tag);
    const raw = CONFIG.exec(tag);
    const config = raw ? settled(raw[1]) : null;
    parts.push((id ? id[1] : "") + "|" + name + "|" + (config === null ? "none" : config));
    // The tag as hashed with the page: its settings settled the same way.
    return raw ? tag.replace(CONFIG, " " + CONFIG_ATTR + '="' + config + '"') : tag;
  });
  if (!parts.length) return "";
  if (css === undefined) return hash(parts.join("\n"));
  return hash(parts.join("\n") + "\n--\n" + page + "\n--\n" + String(css || ""));
}

module.exports = { surfaceStamp, VOLATILE };
