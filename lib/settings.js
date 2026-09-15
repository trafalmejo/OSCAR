"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULTS = { locked: false };

/**
 * A tiny settings file, kept beside the projects folder.
 *
 * Locked mode has to survive a restart: an installation that reboots
 * overnight must come back locked, not wide open.
 */
class Settings {
  constructor(file) {
    this.file = file;
    this.values = Object.assign({}, DEFAULTS, this._read());
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return {}; // missing or unreadable: defaults are fine
    }
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    this.values[key] = value;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2), "utf8");
    } catch (err) {
      // A read-only location shouldn't stop OSCAR working; it just won't
      // remember the setting next time.
      console.error("Could not save settings:", err.message);
    }
    return value;
  }
}

module.exports = { Settings };
