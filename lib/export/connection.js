"use strict";

/**
 * Where OSCAR's bridge is: checked the same way when the export is made (on
 * the server) and when the exported page reads it back (in the browser), so
 * this file requires nothing a browser does not have.
 */

/**
 * A name or address a socket can be opened to: a hostname, an IPv4 address,
 * or an IPv6 address in brackets. Anything else is refused rather than
 * cleaned up -- the value is written into a URL, a script and an HTML
 * comment, and a host that needed cleaning was not going to connect anyway.
 */
const HOST = /^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9._-]*[a-z0-9])?)$/i;

/** The host as given, trimmed, or null. */
function readHost(raw) {
  const host = typeof raw === "string" ? raw.trim() : "";
  return host && host.length <= 253 && HOST.test(host) ? host : null;
}

/**
 * A TCP port, or null. Often typed into a text box or a query string, so a
 * string of digits is fine; "", " " and null are not a port, whatever
 * Number() makes of them, and 0 means "any free port", which reaches nothing.
 */
function readPort(raw) {
  const text = typeof raw === "number" ? String(raw) : raw;
  if (typeof text !== "string" || !/^\s*\d{1,5}\s*$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

/** { host, port } or { error }, from what the export dialog sent. */
function readConnection(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  if (typeof source.host !== "string" || !source.host.trim()) {
    return { error: "Say where OSCAR can be reached." };
  }
  const host = readHost(source.host);
  if (!host) {
    return { error: "That is not an address: use a name or an IP, without http:// or a port." };
  }
  const port = readPort(source.port);
  if (port === null) return { error: "The bridge port is a whole number between 1 and 65535." };
  return { host: host, port: port };
}

module.exports = { HOST, readHost, readPort, readConnection };
