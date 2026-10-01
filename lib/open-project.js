"use strict";

/**
 * Which project the canvas in this browser is.
 *
 * A project lives in OSCAR (lib/projects.js); the canvas in a browser is one
 * of them being edited, or a canvas that is nobody yet. The browser keeps the
 * canvas itself (the editor's storageManager), and beside it this: who it is,
 * and how it stands against what OSCAR holds. Across a reload, that is what
 * lets the editor pick up where it was, and send what it had not yet sent.
 *
 * Kept in the browser, beside the canvas, and not on the server: each
 * browser has a canvas of its own, and one "open project" for all of them
 * would be wrong for every browser but one.
 *
 *   id     the project's identity, or null for a canvas that is nobody yet
 *   name   its title
 *   rev    the revision of it this browser last saw OSCAR hold (0: none)
 *   dirty  true from the first change until the save that covers it is
 *          confirmed: what is on the canvas has not all reached OSCAR
 *   fresh  true for a canvas that is nobody yet and was put there, not made:
 *          a template just opened, a first launch. It becomes a project at
 *          its first change. A canvas with no id that is not fresh is one
 *          from before projects lived in OSCAR, and is carried over.
 *
 * `storage` is localStorage's shape (getItem, setItem, removeItem), handed in
 * so a test needs no browser. A storage that throws -- private browsing, a
 * full disk -- costs the memory across reloads and nothing else.
 */

const { isProjectId, newProjectId } = require("./project-format");

const KEY = "oscarProject.open";

function tidy(pointer) {
  const given = pointer && typeof pointer === "object" && !Array.isArray(pointer) ? pointer : {};
  return {
    id: isProjectId(given.id) ? given.id : null,
    name: typeof given.name === "string" ? given.name.trim().slice(0, 200) : "",
    rev: Number.isInteger(given.rev) && given.rev > 0 ? given.rev : 0,
    dirty: given.dirty === true,
    fresh: given.fresh === true,
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
      // Always written, even for a canvas that is nobody: "fresh" has to
      // outlive a reload, or a template that was only looked at would be
      // taken for work from before and made a project.
      storage.setItem(KEY, JSON.stringify(held));
    } catch (err) {
      // Remembered for as long as the page lives, then.
    }
    return Object.assign({}, held);
  }

  return {
    /** { id, name, rev, dirty, fresh } as it stands. */
    get() {
      if (!held) held = load();
      return Object.assign({}, held);
    },

    /** The canvas is this now. */
    set(pointer) {
      return keep(pointer);
    },

    /** The canvas is nobody's: a template, an import, a fresh start. A name may come with it. */
    clear(name) {
      return keep({ id: null, name: typeof name === "string" ? name : "", rev: 0, dirty: false, fresh: true });
    },

    /** A fresh id, not kept. */
    newId: () => makeId(),
  };
}

module.exports = { createOpenProject, KEY };
