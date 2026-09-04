"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

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
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  // Reject anything that could escape the projects directory.
  _fileFor(id) {
    if (!ID_PATTERN.test(String(id))) return null;
    return path.join(this.dir, id + ".json");
  }

  async list() {
    let entries;
    try {
      entries = await fsp.readdir(this.dir);
    } catch {
      return [];
    }

    const projects = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const id = entry.slice(0, -".json".length);
      const file = this._fileFor(id);
      if (!file) continue;
      try {
        const [stat, raw] = await Promise.all([fsp.stat(file), fsp.readFile(file, "utf8")]);
        const record = JSON.parse(raw);
        projects.push({
          _id: id,
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
    const file = this._fileFor(id);
    if (!file) return null;
    try {
      return JSON.parse(await fsp.readFile(file, "utf8"));
    } catch {
      return null;
    }
  }

  async save(name, data) {
    const id = slugify(name);
    const file = this._fileFor(id);
    if (!file) throw new Error("Invalid project name");

    const record = {
      name: String(name).trim() || id,
      updatedAt: new Date().toISOString(),
      data,
    };

    // Write to a temp file first so an interrupted save can't destroy the
    // previously saved project.
    const tmp = file + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
    await fsp.rename(tmp, file);
    return id;
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

module.exports = { ProjectStore, slugify };
