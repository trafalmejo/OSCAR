"use strict";

/**
 * Parts of OSCAR that are built and tested but not offered yet.
 *
 * Switching one off hides the way in; the code behind it stays, and its
 * tests run with the feature forced on, so it keeps working while the rest
 * of OSCAR changes around it. Turning it back on is the one line here.
 *
 * An extension can switch one on as well (lib/extensions.js). The server
 * works out what that leaves, and writes it into the page as
 * window.OSCAR_FEATURES before any of OSCAR's scripts run; read in a browser,
 * the switches below answer with that. Anywhere else they are the defaults.
 */
const DEFAULTS = {
  /**
   * Several pages on one surface: the Pages button and dialog in the editor,
   * and the tabs in the preview and on the tablets.
   *
   * Off because an exported or published surface carries its first page
   * only, so pages promise more than OSCAR can deliver end to end. A project
   * that already has several keeps them all in its file, untouched and out
   * of reach, until this is true again. The git tag `pages-feature` marks
   * the last commit with it on.
   */
  PAGES: false,
};

function isOn(name) {
  const page = typeof window !== "undefined" && window.OSCAR_FEATURES;
  if (page && typeof page[name] === "boolean") return page[name];
  return DEFAULTS[name];
}

const features = { DEFAULTS: Object.freeze(Object.assign({}, DEFAULTS)) };
for (const name of Object.keys(DEFAULTS)) {
  // Read every time rather than once: the page decides, and only at run time.
  Object.defineProperty(features, name, { enumerable: true, get: () => isOn(name) });
}

module.exports = features;
