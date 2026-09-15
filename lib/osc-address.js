"use strict";

/**
 * OSC 1.0 address pattern matching.
 *
 * In OSC the sender names a set of destinations and each receiver decides
 * whether it is in the set, so the incoming address is the pattern and a
 * widget's own Message setting is always a literal: someone who types /pad[1]
 * in the panel means that address, not a character class.
 *
 * The four OSC 1.0 forms, none of which cross a "/", because each matches
 * within one part of the path -- /eos/* addresses the children of /eos, not
 * everything beneath it:
 *   ?         one character
 *   *         any run of characters, including none
 *   [a-c]     one character from the set; [!a-c] one not in it
 *   {a,b}     either of the alternatives
 *
 * A malformed pattern -- an unclosed bracket, a stray "}", a "/" inside a
 * class -- matches nothing. Never throwing matters more than being helpful
 * here: this runs on every packet a rig sends, and a typo in someone else's
 * software must not take OSCAR's listener down.
 */

const SPECIAL = /[*?[\]{}]/;

/** Does `pattern` contain anything that makes it more than a literal? */
function isPattern(pattern) {
  return typeof pattern === "string" && SPECIAL.test(pattern);
}

/**
 * Turn a pattern into a token list, or null if it is malformed.
 *
 * Tokens: { lit: "x" } | { any: true } | { one: true } |
 *         { set: Array<[lo, hi]>, negate } | { alts: [string] }
 */
function compile(pattern) {
  const tokens = [];
  let i = 0;

  while (i < pattern.length) {
    const char = pattern.charAt(i);

    if (char === "*") {
      // Two stars in a row mean the same as one; folding them keeps the
      // backtracking below linear in the length of the address.
      if (!tokens.length || !tokens[tokens.length - 1].any) tokens.push({ any: true });
      i++;
    } else if (char === "?") {
      tokens.push({ one: true });
      i++;
    } else if (char === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end === -1) return null;
      const set = parseSet(pattern.slice(i + 1, end));
      if (!set) return null;
      tokens.push(set);
      i = end + 1;
    } else if (char === "{") {
      const end = pattern.indexOf("}", i + 1);
      if (end === -1) return null;
      const body = pattern.slice(i + 1, end);
      // Nothing nests in OSC 1.0, and an alternative cannot span a "/".
      if (/[{[\]/*?]/.test(body)) return null;
      tokens.push({ alts: body.split(",") });
      i = end + 1;
    } else if (char === "]" || char === "}") {
      return null;
    } else {
      tokens.push({ lit: char });
      i++;
    }
  }

  return tokens;
}

/** The inside of [...], as ranges; a single character is a range of one. */
function parseSet(body) {
  let negate = false;
  if (body.charAt(0) === "!") {
    negate = true;
    body = body.slice(1);
  }
  if (!body || /[/[{}*?]/.test(body)) return null;

  const set = [];
  for (let i = 0; i < body.length; i++) {
    const lo = body.charAt(i);
    // "a-c" is a range; a "-" first, last, or right after a range is itself.
    if (body.charAt(i + 1) === "-" && i + 2 < body.length) {
      const hi = body.charAt(i + 2);
      if (hi < lo) return null;
      set.push([lo, hi]);
      i += 2;
    } else {
      set.push([lo, lo]);
    }
  }
  return { set: set, negate: negate };
}

function inSet(token, char) {
  let found = false;
  for (const range of token.set) {
    if (char >= range[0] && char <= range[1]) {
      found = true;
      break;
    }
  }
  return token.negate ? !found : found;
}

/**
 * Match tokens[ti..] against address[ai..], backtracking over * and {}.
 *
 * `failed` remembers every (token, position) pair that has already come to
 * nothing. Without it a run of stars backtracks exponentially, and a pattern
 * like /*a*a*a*a... arriving sixty times a second would stall the page.
 */
function matchFrom(tokens, ti, address, ai, failed) {
  const key = ti * (address.length + 1) + ai;
  if (failed.has(key)) return false;

  while (ti < tokens.length) {
    const token = tokens[ti];

    if (token.any) {
      // Try the shortest run first; the star stops at the next "/" or the end.
      let limit = address.indexOf("/", ai);
      if (limit === -1) limit = address.length;
      for (let end = ai; end <= limit; end++) {
        if (matchFrom(tokens, ti + 1, address, end, failed)) return true;
      }
      failed.add(key);
      return false;
    }

    if (token.alts) {
      for (const alt of token.alts) {
        if (address.startsWith(alt, ai) && matchFrom(tokens, ti + 1, address, ai + alt.length, failed)) {
          return true;
        }
      }
      failed.add(key);
      return false;
    }

    if (ai >= address.length) return false;
    const char = address.charAt(ai);

    if (token.one) {
      if (char === "/") break;
    } else if (token.set) {
      if (char === "/" || !inSet(token, char)) break;
    } else if (char !== token.lit) {
      break;
    }
    ti++;
    ai++;
  }
  if (ti === tokens.length && ai === address.length) return true;
  failed.add(key);
  return false;
}

// A rig driving a fader sends the same address sixty times a second; compiling
// it once is plenty. The cap keeps a target that invents a new pattern per
// packet from growing this without limit.
const MAX_CACHED = 256;
const cache = new Map();

function tokensFor(pattern) {
  if (cache.has(pattern)) return cache.get(pattern);
  const tokens = compile(pattern);
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(pattern, tokens);
  return tokens;
}

/**
 * Does an incoming `pattern` reach a widget whose address is `address`?
 *
 * Both must be OSC addresses (a string starting with "/"); anything else, and
 * any malformed pattern, is false.
 */
function matchesAddress(pattern, address) {
  if (typeof pattern !== "string" || typeof address !== "string") return false;
  if (pattern.charAt(0) !== "/" || address.charAt(0) !== "/") return false;
  if (!SPECIAL.test(pattern)) return pattern === address;

  const tokens = tokensFor(pattern);
  if (!tokens) return false;
  return matchFrom(tokens, 0, address, 0, new Set());
}

module.exports = { matchesAddress, isPattern, compile };
