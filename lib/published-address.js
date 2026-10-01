"use strict";

/**
 * The address a published surface is opened at, as a person would type it.
 *
 * Its own file, with no dependencies, because the editor builds it in the
 * browser: lib/published.js reads and writes files and cannot be bundled.
 *
 * `host` is the address other devices reach OSCAR on -- what GET /connection
 * reports -- and never the one in the editor's own address bar, which on the
 * computer running OSCAR is localhost and means something else on a phone.
 */
function surfaceAddress(host, httpPort, path) {
  const name = String(host == null ? "" : host).trim();
  if (!name || typeof path !== "string" || path.charAt(0) !== "/") return "";
  const port = Number(httpPort);
  // 80 is what http:// means already, and is one thing fewer to mistype.
  const suffix = Number.isInteger(port) && port > 0 && port !== 80 ? ":" + port : "";
  // An IPv6 literal has to be bracketed to sit in front of a port.
  const shown = name.indexOf(":") !== -1 && name.charAt(0) !== "[" ? "[" + name + "]" : name;
  return "http://" + shown + suffix + path;
}

/**
 * The address a project is published at the first time, made from its title
 * so that nobody has to think of one: "Lobby visitors" is /show/lobby-visitors.
 * One that is taken -- by another project, by a page from before -- gets a
 * number, and so does a name OSCAR uses itself. The address is fixed from
 * then on: renaming the project does not move it, and printed codes keep
 * working.
 *
 * @param {string} title
 * @param {string[]} taken the addresses in use, and the reserved ones
 */
function addressFor(title, taken) {
  const used = new Set(Array.isArray(taken) ? taken : []);
  const stem =
    String(title == null ? "" : title)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56)
      .replace(/-+$/g, "") || "interface";
  if (!used.has(stem)) return stem;
  for (let n = 2; ; n++) {
    if (!used.has(stem + "-" + n)) return stem + "-" + n;
  }
}

module.exports = { surfaceAddress, addressFor };
