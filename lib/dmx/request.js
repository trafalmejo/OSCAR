"use strict";

const { SLOTS, MAX_LEVEL, protocol } = require("./spec");
const { toWhole } = require("./levels");

/**
 * The server-side gate for DMX, the counterpart of lib/osc-message.js's
 * buildMessage.
 *
 * Anything arriving over the socket is a browser's word for it, and a browser
 * can be a hand-edited project, an old OSCAR, or a page someone wrote
 * themselves. Every field is checked here and a request that fails any check is
 * refused whole. Nothing is repaired, defaulted or clamped into shape: a
 * request OSCAR cannot understand becomes silence, not a guess at what a rig
 * should do.
 */

/** A source is one widget's claim on a block of channels. */
const SOURCE = /^[A-Za-z0-9_.:-]{1,64}$/;
const DEFAULT_SOURCE = "default";

/**
 * Hostnames and IPv4 literals only -- this is the address a UDP packet is sent
 * to, and anything stranger than these characters is a sign the request was
 * not built by OSCAR.
 */
const HOST = /^[A-Za-z0-9.-]{1,255}$/;

function toHost(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") return null;
  const host = raw.trim();
  if (!host) return ""; // blank means "use the protocol's default", not an error
  return HOST.test(host) ? host : null;
}

function toSource(raw) {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_SOURCE;
  const source = String(raw);
  return SOURCE.test(source) ? source : null;
}

/**
 * Validate one DMX request, or return null if it cannot be sent.
 *
 * @param {object} input {protocol, host, universe, channel, levels, source}
 * @returns {object|null} the same fields, checked and normalised
 */
function buildRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const spec = protocol(input.protocol);
  if (!spec) return null;

  const universe = toWhole(input.universe, spec.minUniverse, spec.maxUniverse);
  if (universe === null) return null;

  const channel = toWhole(input.channel, 1, SLOTS);
  if (channel === null) return null;

  if (!Array.isArray(input.levels) || !input.levels.length) return null;
  // A block that runs off the end of the universe is a misconfiguration, not a
  // request to send the part that fits.
  if (channel + input.levels.length - 1 > SLOTS) return null;

  const levels = [];
  for (const raw of input.levels) {
    const level = toWhole(raw, 0, MAX_LEVEL);
    if (level === null) return null;
    levels.push(level);
  }

  const host = toHost(input.host);
  if (host === null) return null;

  const source = toSource(input.source);
  if (source === null) return null;

  return {
    protocol: spec.id,
    host: host,
    universe: universe,
    channel: channel,
    levels: levels,
    source: source,
  };
}

/** The same check for a request that only names a source, such as a release. */
function readSource(raw) {
  return toSource(raw);
}

module.exports = { buildRequest, readSource, DEFAULT_SOURCE, SOURCE, HOST };
