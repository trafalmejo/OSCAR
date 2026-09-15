"use strict";

const { toNumber, isInt32 } = require("./osc-args");
const { isPort } = require("./ports");

// Enough for a colour, a matrix row, or a fader bank; small enough that a
// malformed page can't ask OSCAR to build something absurd.
const MAX_ARGS = 16;

/**
 * Coerce one argument into what osc.js expects: { type, value }.
 *
 * Returns null for anything that cannot be sent, so the caller can drop the
 * whole message rather than emit something half-formed.
 */
function toArg(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return coerce(input.type, input.value);
  }
  if (typeof input === "boolean") return coerce(input ? "T" : "F", input);
  if (typeof input === "string") return coerce("s", input);
  return coerce("f", input);
}

/**
 * Numbers go through the same parser as the widgets' (lib/osc-args.js), so
 * the two gates cannot disagree about what is a number. JSON has no NaN, so
 * a NaN sent from a browser arrives as null -- and Number(null) is 0, as is
 * Number("") and Number("  "). A missing value would quietly become zero,
 * which on a lighting rig means "off". Refuse it instead.
 */
function coerce(type, value) {
  switch (type) {
    case "i": {
      const number = toNumber(value);
      if (number === null) return null;
      const truncated = Math.trunc(number);
      if (!isInt32(truncated)) return null;
      return { type: "i", value: truncated };
    }
    case "s":
      if (value === null || value === undefined) return null;
      return { type: "s", value: String(value) };
    case "T":
      return { type: "T", value: true };
    case "F":
      return { type: "F", value: false };
    case "f":
    case undefined:
    case null: {
      const number = toNumber(value);
      if (number === null) return null;
      return { type: "f", value: number };
    }
    default:
      return null; // an OSC type OSCAR doesn't send
  }
}

/** An OSC address is a path: /master/level */
function isAddress(address) {
  return typeof address === "string" && address.length > 1 && address.charAt(0) === "/";
}

/**
 * Build a message for osc.js, or null if it cannot be sent.
 *
 * Takes a list so one widget can send several values at once -- an XY pad
 * sends two, a colour sends three or four. A bare value is accepted as a
 * list of one, which is what every widget sent before.
 */
function buildMessage(address, args) {
  if (!isAddress(address)) return null;

  // An empty list is only reachable by passing [] on purpose -- a bare address
  // like /play is a real message. Anything else that arrives empty-handed
  // (undefined, null) becomes [undefined] below and is refused by toArg, so
  // "send nothing deliberately" and "every value was garbage" stay distinct.
  const list = Array.isArray(args) ? args : [args];
  if (list.length > MAX_ARGS) return null;

  const built = [];
  for (const item of list) {
    const arg = toArg(item);
    if (!arg) return null;
    built.push(arg);
  }

  return { address, args: built };
}

// isPort is lib/ports.js's, re-exported so the send path and the listen path
// cannot drift apart on what a port is.
module.exports = { buildMessage, isAddress, isPort, MAX_ARGS };
