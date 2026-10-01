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
 *
 * Beside each page, when the editor said what it was made from, are two more
 * files: <id>.json, a small record (which project, its name, when), and
 * <id>.project.json, a copy of that project as it was published. The copy is
 * what makes a surface editable later: the page alone cannot be turned back
 * into a project. A page with neither is one published before they existed,
 * or put in the folder by hand; it is served all the same.
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
    this.removedListeners = [];
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

  /**
   * Be told, with its id, whenever a surface is unpublished. For whoever
   * keeps a copy of the page somewhere else, and has to take it down too.
   * Returns an unsubscribe function. A listener that throws spoils nothing.
   */
  onRemoved(fn) {
    if (typeof fn !== "function") return function () {};
    this.removedListeners.push(fn);
    return () => {
      this.removedListeners = this.removedListeners.filter((other) => other !== fn);
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

  /** The record and the project copy kept beside a page. */
  _besideFor(id) {
    const page = this._fileFor(id);
    if (!page) return null;
    const stem = page.slice(0, -".html".length);
    return { record: stem + ".json", project: stem + ".project.json" };
  }

  /**
   * What a surface was published from: { project: { id, name }, publishedAt,
   * editable }, or null for a page with no record.
   */
  async record(id) {
    const beside = this._besideFor(id);
    if (!beside) return null;
    try {
      const record = JSON.parse(await fsp.readFile(beside.record, "utf8"));
      return record && typeof record === "object" && !Array.isArray(record) ? record : null;
    } catch {
      return null;
    }
  }

  /** The project a surface was published from, as it was then, or null. */
  async project(id) {
    const beside = this._besideFor(id);
    if (!beside) return null;
    try {
      return JSON.parse(await fsp.readFile(beside.project, "utf8"));
    } catch {
      return null;
    }
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
        const record = await this.record(id);
        const project = record && record.project && typeof record.project === "object" ? record.project : null;
        pages.push({
          id,
          size: stat.size,
          date: stat.mtime.toISOString(),
          // What it is called and which project it is, when the editor said.
          name: project && typeof project.name === "string" ? project.name : null,
          project: project && typeof project.id === "string" ? project.id : null,
          editable: !!(record && record.editable),
          // The stamp of the canvas it was published from, as the editor
          // sent it (lib/export/stamp.js); null when nobody wrote it down.
          stamp: record && typeof record.stamp === "string" ? record.stamp : null,
        });
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
   *
   * `from` is what the page was made from: { project: { id, name }, source,
   * stamp }, where source is the project itself, kept so the surface can be
   * edited later, and stamp is the stamp of the canvas as the editor sent it. Without it the page stands alone, and what was beside the page it
   * replaces goes: a copy of some other project must not be taken for this one's.
   */
  async save(name, page, from) {
    const id = this.idFor(name);
    const file = id && this._fileFor(id);
    if (!file) throw new Error("That name cannot be published");
    const replaced = await this.exists(id);

    // A temp file first, so a tablet loading the page mid-publish gets the old
    // one whole rather than the new one half written.
    const tmp = file + ".tmp";
    await fsp.writeFile(tmp, page, "utf8");
    await fsp.rename(tmp, file);
    await this._writeBeside(id, from);
    for (const fn of this.listeners.slice()) {
      try {
        fn(id);
      } catch (err) {
        /* its own business */
      }
    }
    return { id, replaced };
  }

  async _writeBeside(id, from) {
    const beside = this._besideFor(id);
    const project = from && from.project && typeof from.project === "object" ? from.project : null;
    const source = from && from.source && typeof from.source === "object" ? from.source : null;
    if (!project || typeof project.id !== "string") {
      await this._removeBeside(id);
      return;
    }
    if (source) await fsp.writeFile(beside.project, JSON.stringify(source), "utf8");
    else await fsp.unlink(beside.project).catch(() => {});
    const record = {
      project: { id: project.id, name: typeof project.name === "string" ? project.name : id },
      publishedAt: new Date().toISOString(),
      editable: !!source,
    };
    if (typeof from.stamp === "string") record.stamp = from.stamp;
    await fsp.writeFile(beside.record, JSON.stringify(record, null, 2), "utf8");
  }

  async _removeBeside(id) {
    const beside = this._besideFor(id);
    if (!beside) return;
    await fsp.unlink(beside.record).catch(() => {});
    await fsp.unlink(beside.project).catch(() => {});
  }

  /** Take a surface down: its page, and what was kept beside it. */
  async remove(id) {
    const file = this._fileFor(id);
    if (!file) return false;
    try {
      await fsp.unlink(file);
    } catch {
      return false;
    }
    await this._removeBeside(id);
    for (const fn of this.removedListeners.slice()) {
      try {
        fn(id);
      } catch (err) {
        /* its own business */
      }
    }
    return true;
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

/**
 * The stored page with another OSCAR address baked into it: what a download
 * of a published surface is. The page was published with this OSCAR's own
 * address, which is right for a page OSCAR serves; a file opened elsewhere
 * has to be told where OSCAR is, so the download says.
 */
function rebake(page, connection) {
  const text = String(page == null ? "" : page);
  const at = text.indexOf(BAKED_MARKER);
  if (at === -1) return text;
  const start = at + BAKED_MARKER.length;
  const end = text.indexOf(";\n</script>", start);
  if (end === -1) return text;
  let baked;
  try {
    baked = JSON.parse(text.slice(start, end));
  } catch (err) {
    return text;
  }
  baked.host = connection.host;
  baked.port = connection.port;
  return text.slice(0, start) + JSON.stringify(baked).replace(/</g, "\\u003c") + text.slice(end);
}

function markServed(page, socketPort) {
  const port = Number(socketPort);
  const text = String(page == null ? "" : page);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return text;
  const at = text.indexOf(BAKED_MARKER);
  if (at === -1) return text;
  return text.slice(0, at) + "<script>\nwindow.OSCAR_SERVED = " + JSON.stringify({ port }) + ";\n</script>\n" + text.slice(at);
}

module.exports = { PublishedStore, markServed, rebake, RESERVED };
