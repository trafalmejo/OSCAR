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

  /**
   * A board on a USB cable: the Serial (Arduino) button and its panel, where
   * the port and baud rate are picked.
   *
   * Off on purpose (2026-09-25): built, researched, and put away until users
   * ask. Everything stays and works -- Via and its Board row on Data out,
   * From on Data in, the server's link, the word "serial" in an old page's
   * Ip, the sketches in tools/arduino -- the panel simply does not offer any
   * of it while this is off. A board with Wi-Fi or Ethernet never needed
   * any of this and is not affected.
   */
  SERIAL: false,

  /**
   * MIDI: the MIDI section in a widget's settings.
   *
   * On. It is a switch at all because MIDI goes through a compiled module
   * and the operating system's own MIDI service, which is more that can go
   * wrong on somebody's computer than a UDP socket; if it does, this is the
   * one line that takes it out of a release. Off hides the section and
   * nothing else: a widget already set to send MIDI still does.
   */
  MIDI: true,

  /**
   * The canvas yields to the show: a control whose id is live on a published
   * surface sends and shares nothing from the editor's canvas, and every
   * enabled control wears a light saying whether it sends from here (green)
   * or a published surface owns it (red, the owners in the hover text).
   * On because two masters on one id fight on the wire; here as a switch in
   * case an installation prefers the old behaviour, canvas always live.
   */
  CANVAS_YIELD: true,

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
