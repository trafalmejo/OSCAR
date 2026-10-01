"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const { stampProject, projectIdOf, isProjectId, newProjectId } = require("./project-format");

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Turn a user-facing project name into a safe filename stem.
 *
 * Two names that reduce to the same slug are treated as the same project;
 * the save flow surfaces an overwrite prompt showing the stored name, so
 * that collision is visible rather than silent.
 */
function slugify(name) {
  const slug = String(name == null ? "" : name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

/**
 * Projects stored as plain JSON files on the machine running OSCAR.
 *
 * This replaces the old cloud API (accounts + Mongo behind
 * account.createwithoscar.com), which no longer exists. Keeping the same
 * REST shape means the editor UI keeps working unchanged.
 */
class ProjectStore {
  /**
   * @param {string} dir
   * @param {{ oscarVersion?: string }} [options] - recorded in saved files
   */
  constructor(dir, options = {}) {
    this.dir = dir;
    this.oscarVersion = options.oscarVersion || null;
    this.writing = new Map(); // project id -> the write in hand, so two for one project take turns
    fs.mkdirSync(this.dir, { recursive: true });
  }

  // Reject anything that could escape the projects directory.
  _fileFor(id) {
    if (!ID_PATTERN.test(String(id))) return null;
    return path.join(this.dir, id + ".json");
  }

  // A .oscar file is the same record saved through the editor's Save-to-file:
  // one put into the projects folder lists and opens like any project.
  _oscarFileFor(id) {
    if (!ID_PATTERN.test(String(id))) return null;
    return path.join(this.dir, id + ".oscar");
  }

  async list() {
    let entries;
    try {
      entries = await fsp.readdir(this.dir);
    } catch {
      return [];
    }

    const projects = [];
    const seen = new Set();
    for (const entry of entries) {
      const kind = entry.endsWith(".json") ? ".json" : entry.endsWith(".oscar") ? ".oscar" : null;
      if (!kind) continue;
      const id = entry.slice(0, -kind.length);
      if (seen.has(id)) continue;
      const file = kind === ".json" ? this._fileFor(id) : this._oscarFileFor(id);
      if (!file) continue;
      seen.add(id);
      try {
        const [stat, raw] = await Promise.all([fsp.stat(file), fsp.readFile(file, "utf8")]);
        const record = JSON.parse(raw);
        projects.push({
          _id: id,
          // The project's identity, which a published surface remembers
          // (lib/project-format.js); _id is only the file it is kept in.
          id: projectIdOf(record, id),
          name: record.name || id,
          size: stat.size,
          date: new Date(record.updatedAt || stat.mtime).toISOString().slice(0, 10),
        });
      } catch {
        // A corrupt or half-written file shouldn't take down the whole list.
      }
    }
    return projects.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
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

  /** Returns the stored record, or null when it is missing/unreadable. */
  async read(id) {
    for (const file of [this._fileFor(id), this._oscarFileFor(id)]) {
      if (!file) return null;
      try {
        return JSON.parse(await fsp.readFile(file, "utf8"));
      } catch {
        // The other extension may hold it.
      }
    }
    return null;
  }

  /**
   * @param {string} name
   * @param {object} data - the GrapesJS project
   * @param {{ grapesjs?: string, id?: string }} [meta] - versions to record
   *        alongside it, and the project's identity when it has one
   */
  async save(name, data, meta = {}) {
    const id = slugify(name);
    const file = this._fileFor(id);
    if (!file) throw new Error("Invalid project name");

    const record = stampProject({
      name: String(name).trim() || id,
      data,
      oscar: this.oscarVersion,
      grapesjs: meta.grapesjs,
      id: meta.id,
    });

    // Write to a temp file first so an interrupted save can't destroy the
    // previously saved project.
    const tmp = file + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
    await fsp.rename(tmp, file);
    return id;
  }

  async remove(id) {
    let removed = false;
    for (const file of [this._fileFor(id), this._oscarFileFor(id)]) {
      if (!file) return false;
      try {
        await fsp.unlink(file);
        removed = true;
      } catch {
        // Not under this extension.
      }
    }
    return removed;
  }

  // ---- a project by who it is --------------------------------------------------
  // Everything above names a project by the file it is in, which is its name
  // made into a slug: fine for a folder of files saved by hand, and no way to
  // rename one. A project that lives in OSCAR is named by its id
  // (lib/project-format.js) instead: its title is only a field, so it can
  // change, and the file it is in is the id, so nothing moves when it does.
  // Files from before -- a slug for a name, an id inside or none -- are found
  // by reading them, and written back where they were.

  /** Where the project with this id is kept: { file, stem, record }, or null. */
  async _locate(projectId) {
    if (!isProjectId(projectId)) return null;
    const read = async (file) => JSON.parse(await fsp.readFile(file, "utf8"));
    // One made since projects lived here is in the file its id names.
    const own = this._fileFor(projectId);
    try {
      const record = await read(own);
      if (projectIdOf(record, projectId) === projectId) return { file: own, stem: projectId, record };
    } catch {
      // Not there, or not readable: look among the others.
    }
    let entries;
    try {
      entries = await fsp.readdir(this.dir);
    } catch {
      return null;
    }
    for (const entry of entries) {
      const kind = entry.endsWith(".json") ? ".json" : entry.endsWith(".oscar") ? ".oscar" : null;
      if (!kind) continue;
      const stem = entry.slice(0, -kind.length);
      const file = kind === ".json" ? this._fileFor(stem) : this._oscarFileFor(stem);
      if (!file) continue;
      try {
        const record = await read(file);
        if (projectIdOf(record, stem) === projectId) return { file, stem, record };
      } catch {
        // A file that cannot be read is nobody.
      }
    }
    return null;
  }

  /** One write at a time per project: the second waits for the first, then looks again. */
  _inTurn(projectId, work) {
    const before = this.writing.get(projectId) || Promise.resolve();
    const mine = before.then(work, work);
    const settled = mine.catch(() => {});
    this.writing.set(projectId, settled);
    settled.then(() => {
      if (this.writing.get(projectId) === settled) this.writing.delete(projectId);
    });
    return mine;
  }

  async _write(file, record) {
    // A temp file first, so an interrupted save cannot destroy the project.
    const tmp = file + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
    await fsp.rename(tmp, file);
  }

  /** The project with this id: { id, name, rev, updatedAt, record }, or null. */
  async readById(projectId) {
    const found = await this._locate(projectId);
    if (!found) return null;
    const record = found.record;
    return {
      id: projectId,
      name: typeof record.name === "string" && record.name.trim() ? record.name : found.stem,
      rev: Number.isInteger(record.rev) ? record.rev : 0,
      updatedAt: record.updatedAt || null,
      record,
    };
  }

  /**
   * A new project. With an id of its own unless one is given that is free:
   * a file brought in keeps who it says it is.
   * @returns {Promise<{ id, name, rev }>}
   */
  async create(name, data, meta = {}) {
    const id = isProjectId(meta.id) && !(await this._locate(meta.id)) ? meta.id : newProjectId();
    const title = String(name == null ? "" : name).trim().slice(0, 200) || "Untitled";
    await this._write(this._fileFor(id), stampProject({ name: title, data, oscar: this.oscarVersion, grapesjs: meta.grapesjs, id, rev: 1 }));
    return { id, name: title, rev: 1 };
  }

  /**
   * Write a project that is here: its content, its title, or both.
   *
   * `baseRev` is the revision the writer last saw. A project that has been
   * written since by someone else -- a second window, another device -- is
   * not written over: the answer is { conflict: true, rev, name } and
   * nothing changes. Without it the write goes through, as a replace does.
   *
   * @returns {Promise<null | { conflict: true, rev, name } | { id, name, rev }>} null when there is no such project
   */
  write(projectId, changes = {}) {
    return this._inTurn(projectId, async () => {
      const found = await this._locate(projectId);
      if (!found) return null;
      const record = found.record;
      const rev = Number.isInteger(record.rev) ? record.rev : 0;
      const name = typeof record.name === "string" && record.name.trim() ? record.name : found.stem;
      if (Number.isInteger(changes.baseRev) && changes.baseRev !== rev) return { conflict: true, rev, name };
      const title = typeof changes.name === "string" && changes.name.trim() ? changes.name.trim().slice(0, 200) : name;
      const next = stampProject({
        name: title,
        data: changes.data !== undefined ? changes.data : record.data,
        oscar: this.oscarVersion,
        grapesjs: changes.grapesjs || record.grapesjs,
        id: projectId,
        rev: rev + 1,
      });
      // Where it was, under the name it had: a file somebody put here keeps its place.
      await this._write(found.file, next);
      return { id: projectId, name: title, rev: rev + 1 };
    });
  }

  /** A second project with the same content, an id of its own, and a title that says what it is. */
  async duplicate(projectId) {
    const found = await this.readById(projectId);
    if (!found) return null;
    return this.create("Copy of " + found.name, found.record.data, { grapesjs: found.record.grapesjs });
  }

  /** Delete the project with this id. False when there is none. */
  removeById(projectId) {
    return this._inTurn(projectId, async () => {
      const found = await this._locate(projectId);
      if (!found) return false;
      try {
        await fsp.unlink(found.file);
        return true;
      } catch {
        return false;
      }
    });
  }
}

module.exports = { ProjectStore, slugify };
