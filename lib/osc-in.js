"use strict";

/**
 * The receiving half of OSCAR: reading a message off the wire and deciding who
 * it is for.
 *
 * OSCAR has only ever sent. Receiving means two jobs that are easy to tangle
 * together and much easier to trust apart: turning an osc.js packet into plain
 * values, and matching an incoming address against the address a widget was
 * configured with. Both are pure, so both can be tested without a socket.
 */

const { isAddress, MAX_ARGS } = require("./osc-message");

/**
 * One argument, as a plain JavaScript value.
 *
 * osc.js hands us { type, value } when metadata is on, except for T and F,
 * where the type tag *is* the value and `value` may be missing entirely.
 */
function plainValue(arg) {
  if (arg === null || arg === undefined) return null;
  if (typeof arg !== "object") return arg;
  if (arg.type === "T") return true;
  if (arg.type === "F") return false;
  return arg.value === undefined ? null : arg.value;
}

/**
 * Turn a received packet into { address, args }, or null if it is not
 * something OSCAR can act on.
 *
 * Nothing about the sender is kept. Which machine moved a fader is not a thing
 * any widget may act on, and recording it would invite exactly that.
 */
function parse(packet) {
  if (!packet || typeof packet !== "object") return null;
  if (!isAddress(packet.address)) return null;

  const raw = packet.args;
  const list = raw === null || raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  // The same cap the sending side uses. A flood of arguments from a misbehaving
  // target is not a message any OSCAR widget understands.
  if (list.length > MAX_ARGS) return null;

  return { address: packet.address, args: list.map(plainValue) };
}

/** The characters that make an address a pattern rather than a literal. */
const WILDCARD = /[*?[\]{}]/;

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile an OSC address pattern to a regular expression.
 *
 * OSC 1.0 patterns: `?` is one character, `*` is any run of them, `[abc]` and
 * `[!abc]` are character classes, `{one,two}` is an alternation. None of them
 * cross a `/`, because they match within one part of the path -- `/eos/*`
 * addresses the channels of /eos, not everything underneath it.
 */
function compile(pattern) {
  let out = "^";

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern.charAt(i);

    if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else if (char === "[") {
      const end = pattern.indexOf("]", i + 1);
      // An unclosed bracket is someone's typo, not a class. Match it literally
      // rather than swallowing the rest of the address.
      if (end === -1) {
        out += "\\[";
        continue;
      }
      let body = pattern.slice(i + 1, end);
      i = end;
      const negated = body.charAt(0) === "!";
      if (negated) body = body.slice(1);
      // A range (a-z) has to survive, so only the characters that would end or
      // invert the class are escaped.
      body = body.replace(/[\\^\]]/g, "\\$&");
      out += "[" + (negated ? "^" : "") + body + "]";
    } else if (char === "{") {
      const end = pattern.indexOf("}", i + 1);
      if (end === -1) {
        out += "\\{";
        continue;
      }
      const parts = pattern.slice(i + 1, end).split(",").map(escape);
      i = end;
      out += "(?:" + parts.join("|") + ")";
    } else {
      out += escape(char);
    }
  }

  return new RegExp(out + "$");
}

// Compiling per message would mean rebuilding the same expression sixty times
// a second during a fader move. The cap stops a target that sends a fresh
// pattern every packet from growing this without limit.
const MAX_CACHED = 200;
const cache = new Map();

function regexFor(pattern) {
  let regex = cache.get(pattern);
  if (regex) return regex;
  regex = compile(pattern);
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(pattern, regex);
  return regex;
}

/**
 * Does an incoming address reach a widget listening on `address`?
 *
 * The pattern is the incoming one: in OSC the sender addresses a set of
 * destinations and each receiver decides whether it is in it. A widget's own
 * Message setting is always taken literally -- someone typing /pad[1] means
 * that address, not a class.
 */
function matchesAddress(pattern, address) {
  if (typeof pattern !== "string" || typeof address !== "string") return false;
  if (!WILDCARD.test(pattern)) return pattern === address;

  try {
    return regexFor(pattern).test(address);
  } catch (err) {
    // A pattern that will not compile matches nothing, rather than taking the
    // listener down with it.
    return false;
  }
}

module.exports = { parse, matchesAddress, plainValue };
