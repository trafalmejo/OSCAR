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
 * touched it. What the stamp does not see: the page's own CSS and anything
 * that is not a widget, so a purely visual edit does not mark. The mark is
 * about behaviour: where things send, what they listen to, whether they are
 * on.
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

/**
 * The stamp of a page's widgets, or "" for markup with none: two pages with
 * the same stamp hold the same controls, set the same way.
 *
 * @param {string} html any markup holding widget tags: a canvas snapshot, a
 *        published page, a template
 */
function surfaceStamp(html) {
  const parts = [];
  String(html || "").replace(TAG, function (tag, name) {
    const id = ID.exec(tag);
    const raw = CONFIG.exec(tag);
    let config = null;
    if (raw) {
      try {
        config = JSON.parse(unescapeHtml(raw[1]));
      } catch (err) {
        config = { unreadable: raw[1] };
      }
    }
    if (config && typeof config === "object") {
      for (const key of VOLATILE) delete config[key];
      config = Object.keys(config)
        .sort()
        .map((key) => key + "=" + JSON.stringify(config[key]))
        .join(",");
    }
    parts.push((id ? id[1] : "") + "|" + name + "|" + (config === null ? "none" : config));
    return tag;
  });
  return parts.length ? hash(parts.join("\n")) : "";
}

module.exports = { surfaceStamp, VOLATILE };
