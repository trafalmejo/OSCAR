"use strict";

/**
 * Turning the files an exported page refers to into part of the page.
 *
 * An exported interface is one HTML file, so a background left as
 * `images/fruits/background.png` is a broken image the moment the file leaves
 * the machine that made it -- which is the whole point of exporting. Small
 * assets are inlined as data: URIs instead.
 */

const fs = require("fs");
const path = require("path");

/**
 * Anything past this stays a plain reference.
 *
 * Base64 costs a third on top of the file, and the result is parsed as part
 * of the document: a tablet opening a page with a 20MB video in its markup
 * stalls before it draws a single control. Better left linked, and said so.
 */
const MAX_ASSET_BYTES = 2 * 1024 * 1024;

/**
 * What may be inlined at all. A list of what is allowed rather than of what
 * is not: the reference comes out of an HTTP request, and "anything under
 * public/" includes OSCAR's own scripts and templates, which no page has a
 * reason to carry.
 */
const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function mimeFor(file) {
  return MIME_TYPES[path.extname(file).toLowerCase()] || null;
}

function decodeSafely(value) {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    // A stray % is not an escape; take the reference at face value.
    return value;
  }
}

/** Is `target` strictly inside `base`? Both absolute. */
function isInside(base, target) {
  const relative = path.relative(base, target);
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Where a reference in exported markup lands on disk, or null.
 *
 * The markup arrives in an HTTP request, so every reference in it is
 * untrusted: `../../oscar-settings.json` must not read a file, and nor must
 * an absolute path, a drive letter or a URL. Only paths that stay inside
 * `root` resolve.
 *
 * A leading slash is root-relative rather than refused, because that is how
 * GrapesJS writes an image dragged in from the asset manager.
 */
function resolveAsset(root, reference) {
  const ref = String(reference == null ? "" : reference).trim();
  if (!ref) return null;

  // Already self-contained, or somewhere this machine cannot read for the
  // page: a URL, a data: URI, a protocol-relative address, an anchor. The
  // scheme test also catches `C:\...`.
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//") || ref.startsWith("#")) return null;

  // A query or fragment is addressing, not a filename. Backslashes are folded
  // to slashes before the check: on a POSIX server `..\..\etc\passwd` is one
  // odd filename, on Windows it is a traversal, and the answer must not
  // depend on where OSCAR happens to run.
  const clean = decodeSafely(ref.split(/[?#]/)[0]).replace(/\\/g, "/");
  if (!clean || clean.indexOf("\0") !== -1) return null;

  const base = path.resolve(root);
  const target = path.resolve(base, clean.replace(/^\/+/, ""));
  return isInside(base, target) ? target : null;
}

/**
 * A reader that turns references into data: URIs, for buildDocument.
 *
 * Injected there rather than imported, so the document builder never touches
 * a disk. `reader.linked` lists the references that named a real file too
 * large to inline, so the dialog can say which files have to travel with the
 * page.
 *
 * @param {string} root the directory references are relative to
 * @param {{ maxBytes?: number }} [options]
 */
function createAssetReader(root, options) {
  const maxBytes = (options && options.maxBytes) || MAX_ASSET_BYTES;
  const cache = new Map();
  const linked = [];

  function load(reference) {
    const file = resolveAsset(root, reference);
    if (!file) return null;
    const mime = mimeFor(file);
    if (!mime) return null;

    try {
      // A link inside the folder can point anywhere on the disk, and the
      // check above only ever saw its name.
      const real = fs.realpathSync(file);
      if (!isInside(fs.realpathSync(path.resolve(root)), real)) return null;

      const stats = fs.statSync(real);
      if (!stats.isFile()) return null;
      if (stats.size > maxBytes) {
        linked.push(reference);
        return null;
      }
      return "data:" + mime + ";base64," + fs.readFileSync(real).toString("base64");
    } catch (err) {
      // Missing or unreadable: the reference stays as it was, which is no
      // worse than before, and the export still succeeds.
      return null;
    }
  }

  function readAsset(reference) {
    if (!cache.has(reference)) cache.set(reference, load(reference));
    return cache.get(reference);
  }

  readAsset.linked = linked;
  return readAsset;
}

module.exports = { resolveAsset, createAssetReader, mimeFor, MAX_ASSET_BYTES };
