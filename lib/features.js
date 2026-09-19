"use strict";

/**
 * Parts of OSCAR that are built and tested but not offered yet.
 *
 * Switching one off hides the way in; the code behind it stays, and its
 * tests run with the feature forced on, so it keeps working while the rest
 * of OSCAR changes around it. Turning it back on is the one line here.
 */
module.exports = {
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
