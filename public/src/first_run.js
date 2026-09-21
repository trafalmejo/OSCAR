"use strict";

/**
 * What somebody sees the first time they open OSCAR: the Showcase, a surface
 * where every widget works, not an empty canvas and a toolbar of icons.
 *
 * "The first time" means this browser has never held an OSCAR canvas. The
 * canvas autosaves into the browser (see storageManager in oscar_editor.js),
 * so from the first edit on there is an autosave and this never happens
 * again: not after the canvas has been cleared on purpose, and not after an
 * autosave was set aside for being unreadable or from a newer OSCAR. Those
 * people have been here before, and an empty canvas is what they are owed.
 *
 * It has to be asked before the editor starts, because starting it is what
 * writes the first autosave.
 */

/** The template opened on a first run. Anything else in public/templates would do. */
var WELCOME = "templates/oscar-showcase.html";

/** The key the canvas autosaves under. */
var AUTOSAVE_KEY = "oscarProject";

/**
 * @param {Storage} storage the browser's localStorage, or anything shaped like it
 * @returns {boolean} false when it cannot be told: better an empty canvas
 *          than a template loaded over somebody's work
 */
function isFirstRun(storage) {
  try {
    return !!storage && storage.getItem(AUTOSAVE_KEY) === null;
  } catch (err) {
    // Storage that throws when read (a private window, a locked-down kiosk).
    return false;
  }
}

/**
 * Open the welcome template. Quietly: nobody asked for it, so there is no
 * "Loaded successfully", and if it cannot be fetched the canvas stays empty
 * and nothing is said.
 *
 * @param {object} deps
 * @param {(url: string) => Promise<Response>} deps.fetch
 * @param {(html: string) => void} deps.load what Load uses to open a template
 * @param {() => boolean} [deps.untouched] whether the canvas is still as it
 *        started; checked after the fetch, in case somebody was quick
 * @returns {Promise<boolean>} whether it was opened
 */
function openWelcome(deps) {
  return deps
    .fetch(WELCOME)
    .then(function (res) {
      if (!res.ok) throw new Error("status " + res.status);
      return res.text();
    })
    .then(function (html) {
      if (deps.untouched && !deps.untouched()) return false;
      deps.load(html);
      return true;
    })
    .catch(function () {
      return false;
    });
}

module.exports = { isFirstRun: isFirstRun, openWelcome: openWelcome, WELCOME: WELCOME, AUTOSAVE_KEY: AUTOSAVE_KEY };
