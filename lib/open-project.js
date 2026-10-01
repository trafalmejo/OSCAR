"use strict";

/**
 * Which project the canvas in this browser is.
 *
 * The canvas autosaves into the browser (the editor's storageManager), and
 * until now nothing beside it said what it was: a reload kept the layout and
 * forgot the name. A published surface remembers the project it was made
 * from by that project's id (lib/published.js), so the canvas has to know
 * its own -- across a reload, and before it has ever been saved to a file.
 *
 * Kept in the browser, beside the canvas, and not on the server: each
 * browser has a canvas of its own, and one "open project" for all of them
 * would be wrong for every browser but one.
 *
 *   id     the project's identity, or null for a canvas that is nobody yet
 *          (a template just loaded, a first launch)
 *   name   what it is called
 *   saved  whether it has been saved to, or opened from, a file or the
 *          library: Save as on such a project makes a new project, with a
 *          new id; the first save of one that has not keeps the id it has
 *
 * `storage` is localStorage's shape (getItem, setItem, removeItem), handed in
 * so a test needs no browser. A storage that throws -- private browsing, a
 * full disk -- costs the memory across reloads and nothing else.
 */

const { isProjectId, newProjectId } = require("./project-format");

const KEY = "oscarProject.open";
const NOBODY = Object.freeze({ id: null, name: "", saved: false });

function tidy(pointer) {
  const given = pointer && typeof pointer === "object" ? pointer : {};
  return {
    id: isProjectId(given.id) ? given.id : null,
    name: typeof given.name === "string" ? given.name.trim().slice(0, 200) : "",
    saved: given.saved === true,
  };
}

function createOpenProject(storage, options) {
  const makeId = (options && options.newId) || newProjectId;
  let held = null;

  function load() {
    try {
      return tidy(JSON.parse(storage.getItem(KEY)));
    } catch (err) {
      return tidy(null);
    }
  }

  function keep(pointer) {
    held = tidy(pointer);
    try {
      if (!held.id && !held.name) storage.removeItem(KEY);
      else storage.setItem(KEY, JSON.stringify(held));
    } catch (err) {
      // Remembered for as long as the page lives, then.
    }
    return Object.assign({}, held);
  }

  return {
    /** { id, name, saved } as it stands. */
    get() {
      if (!held) held = load();
      return Object.assign({}, held);
    },

    /** The canvas is this project now: opened, loaded, or saved under it. */
    set(pointer) {
      return keep(pointer);
    },

    /** The canvas is nobody's: a template, an import, a fresh start. A name may come with it. */
    clear(name) {
      return keep(Object.assign({}, NOBODY, { name: typeof name === "string" ? name : "" }));
    },

    /** The project's id, made now if the canvas had none: publishing needs one to be remembered by. */
    ensureId() {
      const now = this.get();
      if (now.id) return now.id;
      return keep(Object.assign(now, { id: makeId() })).id;
    },

    /** A fresh id, not kept: for a Save as that may yet be called off. */
    newId: () => makeId(),
  };
}

module.exports = { createOpenProject, KEY };
