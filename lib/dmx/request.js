"use strict";

const { SLOTS, MAX_LEVEL, protocol, HOST, readHost } = require("./spec");
const { toWhole } = require("./levels");

/**
 * The server-side gate for DMX, the counterpart of buildMessage in
 * lib/osc-message.js.
 *
 * What arrives over the socket is a browser's word for it, and a browser can
 * be running a hand-edited project, an old OSCAR, or a page someone wrote
 * themselves. Every field is checked and a request failing any check is
 * refused whole. Nothing is repaired, defaulted or clamped into shape: a
 * request OSCAR cannot read becomes silence, never a guess at what a rig
 * should do.
 */

/**
 * A source is one widget's claim on a block of channels. It is the editor's
 * component id, which is what lets the same widget replace its own claim on
 * every move rather than pile up a new one, and hand it back when deleted.
 */
const SOURCE = /^[A-Za-z0-9_.:-]{1,64}$/;

function readSource(raw) {
  return typeof raw === "string" && SOURCE.test(raw) ? raw : null;
}

/**
 * Validate one DMX request, or return null if it cannot be sent.
 *
 * @param {object} input { protocol, host, universe, channel, levels, source }
 * @returns {object|null} the same fields, checked; `levels` is a fresh array
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
  // A block running off the end of the universe is a misconfiguration, not a
  // request to send the part that fits.
  if (channel + input.levels.length - 1 > SLOTS) return null;

  const levels = [];
  for (const raw of input.levels) {
    const level = toWhole(raw, 0, MAX_LEVEL);
    if (level === null) return null;
    levels.push(level);
  }

  const host = readHost(input.host);
  if (host === null) return null;

  const source = readSource(input.source);
  if (source === null) return null;

  return { protocol: spec.id, host, universe, channel, levels, source };
}

module.exports = { buildRequest, readSource, readHost, SOURCE, HOST };
