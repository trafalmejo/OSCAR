"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const { slugify } = require("./projects");

/**
 * Published surfaces: exported pages that OSCAR serves itself.
 *
 * An exported file works when a computer opens it from disk. A phone cannot:
 * Android hands Chrome a downloaded file as a sandboxed content:// page, and
 * iOS will not run one at all, so the page never reaches OSCAR. Served from
 * OSCAR at an address, the very same file works on anything with a browser.
 * That is all publishing is -- the export, kept where OSCAR can serve it.
 *
 * Kept as plain .html files beside the projects, so a published surface can be
 * read, copied or deleted by hand, and so the packaged app, whose own folder
 * is read-only, has somewhere to put them.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Names the address space already uses. GET /show/preview is the hand-off
 * between the editor and the preview page, and a surface published under
 * that name could never be reached.
 */
const RESERVED = ["preview"];

class PublishedStore {
  constructor(dir) {
    this.dir = dir;
    this.listeners = [];
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Be told, with its id, whenever a surface is published or published again.
   * For whoever keeps a copy of the page somewhere else. Returns an
   * unsubscribe function. A listener that throws spoils nobody's publish.
   */
  onSaved(fn) {
    if (typeof fn !== "function") return function () {};
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((other) => other !== fn);
    };
  }

  /** The id a name is published under, or null when it cannot be one. */
  idFor(name) {
    const id = slugify(name);
    return RESERVED.indexOf(id) === -1 ? id : null;
  }

  // Reject anything that could escape the folder.
  _fileFor(id) {
    if (!ID_PATTERN.test(String(id)) || RESERVED.indexOf(String(id)) !== -1) return null;
    return path.join(this.dir, id + ".html");
  }

  async list() {
    let entries;
    try {
      entries = await fsp.readdir(this.dir);
    } catch {
      return [];
    }
    const pages = [];
    for (const entry of entries) {
      if (!entry.endsWith(".html")) continue;
      const id = entry.slice(0, -".html".length);
      const file = this._fileFor(id);
      if (!file) continue;
      try {
        const stat = await fsp.stat(file);
        pages.push({ id, size: stat.size, date: stat.mtime.toISOString() });
      } catch {
        // Gone between the listing and the look; not worth failing the list.
      }
    }
    return pages.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  async exists(id) {
    const file = this._fileFor(id);
    if (!file) return false;
    try {
      await fsp.access(file);
      return true;
    } catch {
      return false;
    }
  }

  /** The page, or null when there is none by that id. */
  async read(id) {
    const file = this._fileFor(id);
    if (!file) return null;
    try {
      return await fsp.readFile(file, "utf8");
    } catch {
      return null;
    }
  }

  /**
   * Publishing under a name that is already there replaces it: that is what
   * publishing again means, and the address people have bookmarked stays good.
   * Returns { id, replaced }.
   */
  async save(name, page) {
    const id = this.idFor(name);
    const file = id && this._fileFor(id);
    if (!file) throw new Error("That name cannot be published");
    const replaced = await this.exists(id);

    // A temp file first, so a tablet loading the page mid-publish gets the old
    // one whole rather than the new one half written.
    const tmp = file + ".tmp";
    await fsp.writeFile(tmp, page, "utf8");
    await fsp.rename(tmp, file);
    for (const fn of this.listeners.slice()) {
      try {
        fn(id);
      } catch (err) {
        /* its own business */
      }
    }
    return { id, replaced };
  }

  async remove(id) {
    const file = this._fileFor(id);
    if (!file) return false;
    try {
      await fsp.unlink(file);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Tell a page, as it is served, that OSCAR itself is serving it.
 *
 * An exported file has OSCAR's address baked in, because a page opened from
 * disk cannot ask. One served by OSCAR does not need to be told: OSCAR is
 * wherever the page came from. Saying so lets a published surface survive the
 * computer changing address -- a laptop on a new network, a router handing
 * out a new lease -- without being published again. Only the bridge's port
 * has to be supplied, since it is not the port the page was loaded on.
 *
 * Added at serve time rather than stored, so the file on disk stays exactly
 * the export and still works if someone copies it off and opens it elsewhere.
 * Placed before the baked address, which is the first thing the page reads.
 */
const BAKED_MARKER = "<script>\nwindow.OSCAR_EXPORT = ";

function markServed(page, socketPort) {
  const port = Number(socketPort);
  const text = String(page == null ? "" : page);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return text;
  const at = text.indexOf(BAKED_MARKER);
  if (at === -1) return text;
  return text.slice(0, at) + "<script>\nwindow.OSCAR_SERVED = " + JSON.stringify({ port }) + ";\n</script>\n" + text.slice(at);
}

module.exports = { PublishedStore, markServed, RESERVED };
