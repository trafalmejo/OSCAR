"use strict";

/**
 * Turning the files an exported page refers to into part of the page.
 *
 * An exported interface is one HTML file, so a background image left as
 * `images/fruits/background.png` is a broken image the moment the file moves
 * off the machine that made it -- which is the whole point of exporting. Small
 * assets are inlined as data: URIs instead.
 */

const fs = require("fs");
const path = require("path");

/**
 * Anything past this stays a plain reference.
 *
 * Base64 costs a third on top of the file size, and the result has to be
 * parsed as part of the document. A 2MB photo becomes 2.7MB of markup and the
 * page visibly stalls opening; better to leave it linked and say so.
 */
const MAX_ASSET_BYTES = 2 * 1024 * 1024;

const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".css": "text/css",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function mimeFor(file) {
  return MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}

/**
 * Where a reference in the exported markup lands on disk, or null.
 *
 * The markup arrives in an HTTP request, so a reference in it is untrusted
 * input: `../../../etc/passwd` must not read a file, and neither must an
 * absolute path or a URL. Only paths that stay inside `root` resolve.
 *
 * A leading slash is treated as root-relative rather than rejected, because
 * that is how a reference looks once someone has dragged an image in from the
 * asset manager and GrapesJS has written it as `/images/...`.
 */
function resolveAsset(root, reference) {
  const ref = String(reference == null ? "" : reference).trim();
  if (!ref) return null;

  // Already self-contained, or pointing somewhere this machine cannot reach
  // for us: a URL, a data: URI, an anchor, a mail link.
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//") || ref.startsWith("#")) return null;

  // A query or fragment is addressing, not a filename. Backslashes are folded
  // to slashes first: a POSIX server would otherwise read `..\..\etc\passwd`
  // as one long filename and cheerfully resolve it inside the root, so the
  // traversal check below would never see the `..` it is looking for.
  const clean = decodeSafely(ref.split(/[?#]/)[0]).replace(/\\/g, "/");
  if (!clean) return null;
  // A NUL byte truncates a path inside the C library underneath fs.
  if (clean.indexOf("\0") !== -1) return null;

  const base = path.resolve(root);
  const target = path.resolve(base, clean.replace(/^\/+/, ""));

  // path.relative gives "" for the root itself and something starting with ".."
  // for anything above it.
  const inside = path.relative(base, target);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;

  return target;
}

function decodeSafely(value) {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    // A stray % is not an escape; take the reference at face value.
    return value;
  }
}

/**
 * A reader that turns references into data: URIs, for buildDocument.
 *
 * Injected rather than imported so the document builder never touches a disk
 * and stays testable from a plain object.
 *
 * @param {string} root - the directory references are relative to
 * @param {{ maxBytes?: number }} [options]
 * @returns {(reference: string) => string|null} a data: URI, or null to leave
 *          the reference alone
 */
function createAssetReader(root, options) {
  const maxBytes = (options && options.maxBytes) || MAX_ASSET_BYTES;
  const cache = new Map();

  return function readAsset(reference) {
    if (cache.has(reference)) return cache.get(reference);

    let uri = null;
    const file = resolveAsset(root, reference);

    if (file) {
      try {
        const stats = fs.statSync(file);
        if (stats.isFile() && stats.size <= maxBytes) {
          uri = "data:" + mimeFor(file) + ";base64," + fs.readFileSync(file).toString("base64");
        }
      } catch (err) {
        // Missing or unreadable. The reference stays as it is, which is no
        // worse than it was, and the export still succeeds.
        uri = null;
      }
    }

    cache.set(reference, uri);
    return uri;
  };
}

module.exports = { resolveAsset, createAssetReader, mimeFor, MAX_ASSET_BYTES };
