(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

const { toNumber } = require("../osc-args");
const { MAX_LEVEL } = require("./spec");

/**
 * Turning what a control is worth into what a DMX slot can hold.
 *
 * Every function here returns null rather than a number it would have had to
 * invent. The reasoning is lib/osc-message.js's, and it bites harder here: a
 * slot is unsigned, 0 is a real command meaning "off", and Number(null),
 * Number("") and Number(false) are all 0. A value that arrived broken must
 * never reach a dimmer as a blackout.
 */

/** A whole number inside a range, or null. Universes and channels. */
function toWhole(raw, min, max) {
  const number = toNumber(raw);
  if (number === null || !Number.isInteger(number)) return null;
  if (number < min || number > max) return null;
  return number;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Where a value sits within a control's own range, as 0..1, or null.
 *
 * The one place a widget's units -- 0-100, -1..1, 20-2000 Hz -- become
 * something a protocol can scale, so the widget keeps owning its range and
 * DMX never learns what a slider was labelled. Clamped: a value past either
 * end pins there, which is what the fixture can do anyway.
 *
 * A range of zero width cannot place anything. Returning 0 there would look
 * like a level; it is the absence of one.
 */
function unitOf(value, min, max) {
  const v = toNumber(value);
  const lo = toNumber(min);
  const hi = toNumber(max);
  if (v === null || lo === null || hi === null || hi === lo) return null;
  return clamp((v - lo) / (hi - lo), 0, 1);
}

/** 0..1 -> 0..255, clamped before rounding. Null stays null. */
function toLevel(unit) {
  const number = toNumber(unit);
  if (number === null) return null;
  return Math.round(clamp(number, 0, 1) * MAX_LEVEL);
}

/**
 * A list of 0..1 values -> levels, or null if any one of them fails.
 *
 * One bad coordinate spoils the set, the same way a half-built OSC message is
 * refused: pan without tilt puts a light somewhere nobody asked for.
 */
function toLevels(units) {
  const list = Array.isArray(units) ? units : [units];
  if (!list.length) return null;
  const levels = [];
  for (const unit of list) {
    const level = toLevel(unit);
    if (level === null) return null;
    levels.push(level);
  }
  return levels;
}

/**
 * Lay a widget's levels across the block of channels it was given, or null
 * when the block is too narrow to hold them.
 *
 * Values fill in order and the last one repeats to the end of the block, so
 * one slider over three channels dims an RGB fixture as a whole while a pad
 * over two lands on pan and tilt. A block narrower than the values would drop
 * a coordinate, and half a position is no position.
 */
function spread(levels, count) {
  if (!Array.isArray(levels) || !levels.length || count < levels.length) return null;
  const out = [];
  for (let i = 0; i < count; i++) out.push(levels[Math.min(i, levels.length - 1)]);
  return out;
}

module.exports = { toWhole, unitOf, toLevel, toLevels, spread, clamp };

},{"../osc-args":6,"./spec":2}],2:[function(require,module,exports){
"use strict";

/**
 * The fixed numbers the two DMX-over-Ethernet protocols are built on.
 *
 * Kept apart from the encoders so the widgets -- which run in a browser --
 * can validate a universe or a channel without pulling in Buffer or a socket.
 */

/** A DMX universe is 512 slots of one byte each. */
const SLOTS = 512;
const MAX_LEVEL = 255;

const ARTNET_PORT = 6454;
const SACN_PORT = 5568;

/**
 * Art-Net addresses a universe with a 15-bit Port-Address (Net, Sub-Net and
 * Universe packed together), so 0 is an ordinary first universe. E1.31
 * reserves 0 and 64000 upward, leaving 1-63999 for data.
 */
const PROTOCOLS = [
  { id: "artnet", name: "Art-Net", port: ARTNET_PORT, minUniverse: 0, maxUniverse: 32767 },
  { id: "sacn", name: "sACN (E1.31)", port: SACN_PORT, minUniverse: 1, maxUniverse: 63999 },
];

/** The same list as a settings panel wants it. */
const PROTOCOL_OPTIONS = PROTOCOLS.map((spec) => ({ id: spec.id, name: spec.name }));

function protocol(id) {
  return PROTOCOLS.find((spec) => spec.id === id) || null;
}

/** E1.31 gives every universe its own multicast group: 239.255.<hi>.<lo>. */
function sacnMulticast(universe) {
  return "239.255." + ((universe >> 8) & 0xff) + "." + (universe & 0xff);
}

/**
 * Where a frame goes when no node was named.
 *
 * Each protocol was designed around an "I do not know the node's address"
 * answer: Art-Net broadcasts, sACN multicasts. Naming the node is still
 * better on a busy network, which is why the field exists.
 */
function defaultHost(id, universe) {
  return id === "sacn" ? sacnMulticast(universe) : "255.255.255.255";
}

/**
 * Hostnames and IPv4 literals only: this is where a UDP packet goes, and
 * anything stranger than these characters was not built by OSCAR. Shared by
 * the settings panel and the server's gate so the two cannot drift.
 */
const HOST = /^[A-Za-z0-9.-]{1,255}$/;

/** A host, "" for the protocol's default, or null for something refused. */
function readHost(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") return null;
  const host = raw.trim();
  if (!host) return "";
  return HOST.test(host) ? host : null;
}

module.exports = {
  SLOTS,
  MAX_LEVEL,
  ARTNET_PORT,
  SACN_PORT,
  PROTOCOLS,
  PROTOCOL_OPTIONS,
  protocol,
  sacnMulticast,
  defaultHost,
  HOST,
  readHost,
};

},{}],3:[function(require,module,exports){
"use strict";

/**
 * A widget's settings, written onto exported markup and read back off it.
 *
 * Inside the editor every setting is a component property and deliberately
 * not an HTML attribute (public/src/adapters/grapesjs.js says why: an
 * attribute is a second copy of the truth, saved into every project file and
 * stale from the next edit on). That leaves exported markup saying
 * `<input type="range">` and nothing about where it sends, which is one of
 * the reasons an exported page never worked. So the settings are written onto
 * the elements here, at export time and only then, and read back by the
 * standalone runtime (public/src/adapters/standalone.js).
 *
 * Which keys travel is decided by each definition's own `defaults`, and which
 * widgets exist by WIDGETS, so a widget added to the registry is carried
 * without anyone remembering to list it here.
 *
 * Nothing here touches a DOM: readWidget asks its argument for getAttribute,
 * which a real element and a test double both answer.
 */

const { byName } = require("../widgets");

/** Marks an element as an OSCAR widget, and says which one. */
const NAME_ATTR = "data-oscar";

/**
 * Carries the settings, as one JSON value rather than an attribute per key.
 *
 * Attributes are strings and these values are not: `invert` is a boolean,
 * `port` a number. Spread over data-oscar-invert="false" the runtime would be
 * handed the string "false", which is truthy, and a fader would quietly run
 * backwards. JSON keeps the types.
 */
const CONFIG_ATTR = "data-oscar-config";

const WIDGET_SELECTOR = "[" + NAME_ATTR + "]";

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** The widget registered under this name, or null. Never a prototype member. */
function definitionFor(name) {
  return typeof name === "string" && has(byName, name) ? byName[name] : null;
}

/**
 * The attributes that carry one widget's configuration, or null when `name`
 * is not a widget.
 *
 * Only the keys the widget declares are written; everything else on a
 * component is editor bookkeeping and has no business on a control surface.
 * A setting the editor holds as undefined travels as null, so the key is
 * still there: readWidget treats a missing key as damage.
 *
 * @param {string} name a widget name, e.g. "oscar-slider"
 * @param {(key: string) => any} read reads one setting off the host
 */
function exportAttributes(name, read) {
  const definition = definitionFor(name);
  if (!definition) return null;

  const settings = {};
  for (const key of Object.keys(definition.defaults)) {
    const value = read(key);
    settings[key] = value === undefined ? null : value;
  }

  const attributes = {};
  attributes[NAME_ATTR] = name;
  attributes[CONFIG_ATTR] = JSON.stringify(settings);
  return attributes;
}

/** The settings object an attribute holds, or null if it holds nothing usable. */
function parseConfig(raw) {
  if (typeof raw !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  // An array or a bare number parses fine and is still not a settings object.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed;
}

/**
 * A widget's settings with the files they name embedded, as the attribute's
 * new value, or null when there is nothing to change. Which settings name
 * files is the widget's business: it says so with `embed`.
 */
function embedAssets(name, raw, readAsset) {
  const definition = definitionFor(name);
  if (!definition || typeof definition.embed !== "function") return null;
  const config = parseConfig(raw);
  if (!config) return null;
  const changed = definition.embed(config, readAsset);
  return changed ? JSON.stringify(Object.assign({}, config, changed)) : null;
}

/**
 * The one setting a widget keeps writing itself: where its thumb is, what is
 * selected. The editor judges it when someone types it and not again when
 * the range around it is edited, so a project can honestly hold a Value its
 * present Min and Max would refuse, and the widgets clamp it as they start.
 * Refusing it here would switch off controls that work. It is also not a
 * setting that decides where anything goes: it is sent only after a gesture
 * has replaced it.
 */
const STATE_KEYS = ["value"];

/**
 * Why these settings cannot be run, or null when they can.
 *
 * All the keys being there says the blob was not truncated; it does not say
 * somebody's hand-edit left them usable, and the header of every exported
 * file invites hand-edits. "enabled": "false" is a string, which is truthy,
 * so the control the editor of the file meant to silence stays live; a Min
 * of null reaches Number() inside a widget and becomes a range starting at
 * 0. The definition already knows what a usable value is -- `checks` is what
 * the settings panel refuses edits with -- so the same judgement is asked
 * for here, and nothing about any one widget is written down in this file.
 * An export made by the editor always passes: the panel let none of it in
 * otherwise.
 */
function complaintAbout(definition, config) {
  for (const spec of definition.fields || []) {
    if (spec.type === "checkbox" && typeof config[spec.key] !== "boolean") {
      return JSON.stringify(spec.key) + " has to be true or false, not " + JSON.stringify(config[spec.key]);
    }
  }
  const checks = definition.checks || {};
  for (const key of Object.keys(checks)) {
    if (STATE_KEYS.indexOf(key) !== -1 || !has(config, key)) continue;
    let complaint;
    try {
      complaint = checks[key](config[key], config);
    } catch (err) {
      // A validator written for what a settings panel can produce, handed an
      // object or an array. That it cannot even be judged is the answer.
      complaint = "it cannot be read";
    }
    if (complaint) return JSON.stringify(key) + " is not usable: " + complaint;
  }
  return null;
}

/**
 * Read a widget back off an element.
 *
 * Returns { definition, config }, or { problem } saying why this element
 * cannot be run, or null when the element does not claim to be a widget.
 *
 * There is no path from here to a widget running on its defaults. The
 * defaults are a live control aimed at localhost:7000 /slider1 with a range
 * of 0-100: a widget revived on them after its settings were damaged fires
 * at whatever happens to be listening there, at levels nobody chose. A
 * control that does nothing gets noticed and fixed; one that drives the
 * wrong rig gets noticed by the audience. So every key the definition
 * declares has to be present -- an export always writes all of them, and the
 * file carries its own runtime, so a missing key is never a version skew,
 * only damage. Present is not enough either: see complaintAbout.
 */
function readWidget(el) {
  if (!el || typeof el.getAttribute !== "function") return null;
  const name = el.getAttribute(NAME_ATTR);
  if (name === null || name === undefined) return null;

  const definition = definitionFor(name);
  if (!definition) return { problem: "unknown widget " + JSON.stringify(name) };

  const settings = parseConfig(el.getAttribute(CONFIG_ATTR));
  if (!settings) return { problem: CONFIG_ATTR + " is missing or is not a JSON object" };

  const config = {};
  for (const key of Object.keys(definition.defaults)) {
    if (!has(settings, key)) return { problem: CONFIG_ATTR + " has no " + JSON.stringify(key) };
    config[key] = settings[key];
  }
  const complaint = complaintAbout(definition, config);
  if (complaint) return { problem: CONFIG_ATTR + ": " + complaint };
  return { definition: definition, config: config };
}

module.exports = {
  NAME_ATTR,
  CONFIG_ATTR,
  WIDGET_SELECTOR,
  definitionFor,
  exportAttributes,
  parseConfig,
  embedAssets,
  readWidget,
};

},{"../widgets":19}],4:[function(require,module,exports){
"use strict";

/**
 * Reading a whole HTML document -- a template, or a file pasted into Import --
 * as the parts OSCAR takes from it.
 *
 * GrapesJS can read a document itself, but it then replaces the canvas's
 * <head> with the one in the file, and that head is where OSCAR's fonts, widget
 * styles and widget rules are loaded. Every widget lost its styling, and the
 * head was saved with the project, so it happened again on every reload.
 *
 * So a document is turned into what GrapesJS reads without trouble: its CSS
 * and the contents of its <body>. The attributes on <body> are handed back
 * separately, because that is where a template names its widget style.
 */

const COMMENT = /<!--[\s\S]*?-->/g;
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const BODY_OPEN = /<body\b([^>]*)>/i;
const BODY_CLOSE = /<\/body\s*>/i;
const ATTRIBUTE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * CSS with its comments taken out, strings left alone.
 *
 * The editor's CSS parser reads a comment INSIDE a rule as a declaration and
 * stores it as `undefined: undefined`, which is then saved with the project
 * and written into every export. Comments between rules are harmless but go
 * the same way, since nothing downstream keeps them anyway.
 */
function stripCssComments(css) {
  const text = String(css == null ? "" : css);
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      out += ch;
      // An escaped character cannot close the string.
      if (ch === "\\" && i + 1 < text.length) out += text[++i];
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      // An unclosed comment swallows the rest, as it does in a browser.
      i = end === -1 ? text.length : end + 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** The same markup with the comments removed from every <style> block. */
function cleanStyleBlocks(html) {
  return String(html == null ? "" : html).replace(STYLE_BLOCK, function (block, css) {
    return block.replace(css, function () {
      return stripCssComments(css);
    });
  });
}

function attributesOf(source) {
  const attributes = {};
  for (const match of String(source).matchAll(ATTRIBUTE)) {
    const value = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4];
    attributes[match[1].toLowerCase()] = value === undefined ? "" : value;
  }
  return attributes;
}

/**
 * `{ html, bodyAttributes }` for a document, or null for anything that has no
 * <body> -- a fragment, which GrapesJS already reads as it is.
 *
 * `html` is every <style> block followed by the body's contents. Comments are
 * dropped first, so a <body> written inside one is not mistaken for the real
 * one.
 */
function readDocument(input) {
  const text = String(input == null ? "" : input).replace(COMMENT, "");
  const open = BODY_OPEN.exec(text);
  if (!open) return null;

  const start = open.index + open[0].length;
  const close = text.slice(start).search(BODY_CLOSE);
  const body = close === -1 ? text.slice(start) : text.slice(start, start + close);

  const css = [...text.matchAll(STYLE_BLOCK)].map((m) => stripCssComments(m[1]).trim()).filter(Boolean);
  const html = (css.length ? "<style>\n" + css.join("\n") + "\n</style>\n" : "") + body.replace(STYLE_BLOCK, "").trim();

  return { html, bodyAttributes: attributesOf(open[1]) };
}

module.exports = { readDocument, attributesOf, stripCssComments, cleanStyleBlocks };

},{}],5:[function(require,module,exports){
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

},{}],6:[function(require,module,exports){
"use strict";

/**
 * Turning a widget's configured value into OSC arguments.
 *
 * This is the half of a widget that decides *what* to send, kept apart from
 * the half that decides *when*. It knows nothing about the editor, the DOM, or
 * any UI library, so it can be tested from Node and survives swapping the
 * editor out from under it.
 */

/**
 * What a button can send. A button's on/off values are typed by hand, so it
 * gets the full set -- a cue number is an int, a clip name is a string, and
 * plenty of software just wants a bare /play with nothing attached.
 */
const ARG_TYPES = [
  { id: "i", name: "int32 (i)" },
  { id: "f", name: "float32 (f)" },
  { id: "s", name: "string (s)" },
  { id: "bool", name: "bool (T/F)" },
  { id: "none", name: "no argument" },
];

/**
 * What a continuous control can send. A slider or a pad produces a number by
 * moving, so string and bool make no sense and "no argument" would throw the
 * value away.
 */
const NUMERIC_ARG_TYPES = [
  { id: "f", name: "float32 (f)" },
  { id: "i", name: "int32 (i)" },
];

/**
 * Which hand-typed values count as "off" for a bool.
 *
 * Someone setting a button up will write any of these in the Value OFF field
 * and expect F on the wire.
 */
const FALSY = /^(0|false|off|no|)$/i;

function isFalsy(raw) {
  return FALSY.test(String(raw == null ? "" : raw).trim());
}

/**
 * Build the argument list for one value, or null if it cannot be sent.
 *
 * Returning null drops the whole message. That is deliberate and it is the
 * opposite of what a "helpful" default would do: coercing an unparseable
 * value to 0 would mean sending "off" to a lighting rig, which is worse than
 * sending nothing at all. The same reasoning as lib/osc-message.js.
 */
function toArgs(argType, raw) {
  switch (argType) {
    case "none":
      // A bare address is a real OSC message -- /play, /stop, /next.
      return [];

    case "bool":
      // T and F carry no payload; the type tag is the whole message.
      return [{ type: isFalsy(raw) ? "F" : "T" }];

    case "s":
      if (raw === null || raw === undefined) return null;
      return [{ type: "s", value: String(raw) }];

    case "i": {
      const number = toNumber(raw);
      if (number === null) return null;
      // Rounded, not truncated: a slider two thirds of the way up should read
      // as 67, not 66, and someone typing 1.9 meant 2.
      const rounded = Math.round(number);
      if (!isInt32(rounded)) return null;
      return [{ type: "i", value: rounded }];
    }

    case "f":
    default: {
      const number = toNumber(raw);
      if (number === null) return null;
      return [{ type: "f", value: number }];
    }
  }
}

/**
 * Parse a number without the traps JavaScript lays for you, or return null.
 *
 * Number("") and Number(null) are both 0, and so are Number("  ") and
 * Number([]): a cleared field, a stray space, a missing value or a wrapped
 * one would each quietly become a real value. Only a number, or text that
 * spells one, counts.
 */
function toNumber(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

/**
 * An OSC int is 32 bits. osc.js wraps anything wider rather than refusing it,
 * so a value past this range would go out as some unrelated negative number.
 */
function isInt32(number) {
  return Number.isInteger(number) && number >= -2147483648 && number <= 2147483647;
}

/** Is this a value the given argument type can actually send? */
function isSendable(argType, raw) {
  return toArgs(argType, raw) !== null;
}

module.exports = { ARG_TYPES, NUMERIC_ARG_TYPES, toArgs, isSendable, isFalsy, toNumber, isInt32 };

},{}],7:[function(require,module,exports){
(function (process){(function (){
"use strict";

/**
 * The ports OSCAR listens on and sends from, read from the environment.
 *
 * One place, so that every port can be moved -- two copies on one machine,
 * or a development server that must not collide with a running show -- and
 * so that a port a later feature needs is added here rather than as one more
 * ad-hoc Number(process.env.X) in server.js.
 */

const DEFAULTS = {
  /** Web interface. */
  http: 8080,
  /** Browser-to-server OSC bridge (socket.io). */
  socket: 8081,
  /** Source port for OSC sent to the network. */
  lan: 5001,
  /** Source port for OSC sent to this machine. */
  local: 5002,
  /** Where OSC coming back from the rig is received. */
  oscIn: 9000,
  /**
   * Source port Art-Net and sACN are sent from. 0 means any free port: the
   * nodes listen on 6454 and 5568 whatever OSCAR sends from, and binding 6454
   * here would collide with node software on this same machine -- Resolume,
   * QLC+, MadMapper all receive Art-Net on it. Set OSCAR_DMX_PORT=6454 for a
   * node that only answers to that source port.
   */
  dmx: 0,
};

const VARIABLES = {
  http: "OSCAR_HTTP_PORT",
  socket: "OSCAR_SOCKET_PORT",
  lan: "OSCAR_LAN_PORT",
  local: "OSCAR_LOCAL_PORT",
  oscIn: "OSCAR_OSC_IN_PORT",
  dmx: "OSCAR_DMX_PORT",
};

/**
 * The one definition of a port, for a number or the text of one. Used by the
 * send path (lib/osc-message.js), the settings panel (lib/widgets/fields.js)
 * and the listeners here, so none of them can drift on what is refused.
 */
function isPort(value) {
  if (typeof value !== "number" && typeof value !== "string") return false;
  if (typeof value === "string" && value.trim() === "") return false;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 65535;
}

/**
 * Read one port. Unset means the default; set but not a port is refused.
 *
 * Silently falling back on a typo ("OSCAR_HTTP_PORT=808O") would start OSCAR
 * on 8080 and collide with whatever the operator was trying to avoid.
 */
function readPort(name, env) {
  const raw = env[VARIABLES[name]];
  if (raw === undefined || raw === "") return DEFAULTS[name];
  const port = Number(raw);
  if (isPort(port)) return port;
  // A port whose default is "any" may be asked for explicitly, so a profile
  // that pins it can be overridden from a command line the same way.
  if (DEFAULTS[name] === 0 && String(raw).trim() === "0") return 0;
  throw new Error(VARIABLES[name] + " must be a port number between 1 and 65535, not " + JSON.stringify(raw));
}

/** @returns {{http:number, socket:number, lan:number, local:number, oscIn:number, dmx:number}} */
function portsFromEnv(env) {
  const source = env || process.env;
  const ports = {};
  for (const name of Object.keys(DEFAULTS)) ports[name] = readPort(name, source);
  return ports;
}

/** The ports `serve:at` takes on its command line, in order. */
const ARGUMENTS = ["http", "socket", "oscIn"];

/** How far from the HTTP port each derived port sits. */
const OFFSETS = { socket: 1, oscIn: 2, lan: 3, local: 4 };

/**
 * Plan the ports for a copy started as `serve:at <http> [socket] [osc-in]`.
 *
 * A port typed on the command line always wins: it is the one thing the
 * operator asked for, and an OSCAR_HTTP_PORT left in a shell profile must not
 * quietly put a development copy on the show's port. Every port not typed is
 * derived from the HTTP port unless the environment already sets it, so one
 * number keeps a copy clear of everything else, including the two source
 * ports OSC is sent from.
 *
 * Returns { variables, notes, ports }: the environment to start with, what to
 * tell the operator (a variable an argument overrode), and the full result.
 * Throws, naming the port, on anything that cannot be resolved -- a malformed
 * argument, a malformed variable, or two ports landing on the same number.
 */
function planPorts(args, env) {
  const given = {};
  ARGUMENTS.forEach((name, i) => {
    const raw = args[i];
    if (raw === undefined) return;
    if (!isPort(raw)) {
      throw new Error("the " + VARIABLES[name] + " argument must be a port number between 1 and 65535, not " + JSON.stringify(raw));
    }
    given[name] = Number(raw);
  });
  if (given.http === undefined) throw new Error("an HTTP port is required");

  const variables = {};
  const notes = [];
  for (const name of ["http"].concat(Object.keys(OFFSETS))) {
    const variable = VARIABLES[name];
    const fromEnv = env[variable];
    const inEnv = fromEnv !== undefined && fromEnv !== "";

    if (given[name] !== undefined) {
      if (inEnv && Number(fromEnv) !== given[name]) {
        notes.push(variable + "=" + fromEnv + " is set in the environment; using " + given[name] + " from the command line");
      }
      variables[variable] = String(given[name]);
      continue;
    }
    if (inEnv) continue;

    const derived = given.http + OFFSETS[name];
    if (!isPort(derived)) throw new Error(variable + " would be " + derived + ", which is not a port");
    variables[variable] = String(derived);
  }

  // Resolving through portsFromEnv refuses a malformed variable the same way
  // a plain start would, and yields every port so collisions can be caught
  // before something binds -- an OSC-in port typed as http + 3 is also the
  // LAN source port, and UDP does not share.
  const ports = portsFromEnv(Object.assign({}, env, variables));
  const taken = {};
  for (const name of Object.keys(ports)) {
    // "Any free port" collides with nothing by definition.
    if (ports[name] === 0) continue;
    const other = taken[ports[name]];
    if (other) throw new Error(VARIABLES[other] + " and " + VARIABLES[name] + " would both be " + ports[name]);
    taken[ports[name]] = name;
  }

  return { variables, notes, ports };
}

module.exports = { portsFromEnv, planPorts, DEFAULTS, VARIABLES, isPort };

}).call(this)}).call(this,require('_process'))
},{"_process":30}],8:[function(require,module,exports){
"use strict";

/**
 * OSCAR's own project file format version.
 *
 * Bump this ONLY when a saved project needs converting to stay readable --
 * not once per OSCAR release. Add the matching entry to MIGRATIONS when you
 * do, and a test for it.
 */
const CURRENT_FORMAT = 3;

/**
 * MIGRATIONS[n] converts project data from format n to format n + 1.
 *
 * Format 0 means a file saved before OSCAR stamped its projects (the 2.0
 * releases). Those already hold GrapesJS 0.21+ project data, so there is
 * nothing to change -- they only need recognising.
 */
const MIGRATIONS = {
  0: (data) => data,
  1: (data) => stripEditorState(data),
  // Format 3 is the first that may hold more than one page. The conversion
  // itself is small -- every page gets a name -- and the bump is the larger
  // half of the point: an OSCAR from before the page switcher would open a
  // multi-page show, draw page one, and offer no way to reach the rest, which
  // reads as a damaged project. Refused as "too new", it says to update.
  2: (data) => namePages(data),
};

// Editor state that must never live in a project. A 2.1 development build
// locked components while previewing by setting these on the components
// themselves, so saving during a preview wrote them into the file and the
// widgets could no longer be moved afterwards.
const EDITOR_STATE_KEYS = ["draggable", "selectable", "hoverable", "highlightable", "editable"];

function stripFromComponent(component) {
  if (!component || typeof component !== "object") return;

  for (const key of EDITOR_STATE_KEYS) {
    if (component[key] === false) delete component[key];
  }

  const children = component.components;
  if (Array.isArray(children)) children.forEach(stripFromComponent);
}

function stripEditorState(data) {
  if (!data || !Array.isArray(data.pages)) return data;

  for (const page of data.pages) {
    for (const frame of page.frames || []) stripFromComponent(frame.component);
    // Some projects carry the component directly on the page.
    stripFromComponent(page.component);
  }
  return data;
}

/**
 * What a page with no name of its own is called, by its position.
 *
 * The one place the label is made: the migration writes it into files, and
 * the editor's page list and the tablet's tabs both print it (they require
 * this module through the bundle), so a page is never called one thing on
 * disk and another on screen.
 */
function defaultPageName(index) {
  return "Page " + (index + 1);
}

function hasName(name) {
  return typeof name === "string" && name.trim() !== "";
}

/** The label for a page named `name` (or not named at all) at `index`. */
function pageLabel(name, index) {
  return hasName(name) ? name.trim() : defaultPageName(index);
}

/**
 * Give every page a name.
 *
 * GrapesJS creates the first page of a project with an empty name and drops
 * an empty name when it saves, so page one of every project comes back
 * unnamed -- not only in files from before multi-page. A tab has to print
 * something. Idempotent: a page that has a name keeps it.
 */
function namePages(data) {
  if (!data || !Array.isArray(data.pages)) return data;

  data.pages.forEach((page, index) => {
    if (!page || typeof page !== "object") return;
    if (!hasName(page.name)) page.name = defaultPageName(index);
  });
  return data;
}

/** GrapesJS 0.21+ project data always carries a pages array. */
function isGrapesProject(data) {
  return !!data && typeof data === "object" && Array.isArray(data.pages) && data.pages.length > 0;
}

/** Files written before stamping have no format field; they are format 0. */
function detectFormat(record) {
  const format = record && record.format;
  return Number.isInteger(format) && format >= 0 ? format : 0;
}

/**
 * Decide what to do with a project record that has just been read.
 *
 * Returns one of:
 *   { status: "ok", data, from, migrated }
 *   { status: "too-new", savedBy, format }   - written by a newer OSCAR
 *   { status: "unreadable" }                 - not an OSCAR 2 project at all
 *
 * A file from a *newer* OSCAR is refused rather than opened. Its shape still
 * looks valid, so loading it would quietly drop whatever this version does not
 * understand -- and the next save would write that loss back over the file.
 */
function openProject(record) {
  if (!record || typeof record !== "object") return { status: "unreadable" };

  const from = detectFormat(record);

  if (from > CURRENT_FORMAT) {
    return { status: "too-new", format: from, savedBy: record.oscar || null };
  }

  // The envelope holds the project under `data`; an unstamped file may be the
  // bare project itself.
  let data = record.data !== undefined ? record.data : record;

  for (let version = from; version < CURRENT_FORMAT; version++) {
    const migrate = MIGRATIONS[version];
    if (!migrate) return { status: "unreadable" };
    try {
      data = migrate(data);
    } catch {
      return { status: "unreadable" };
    }
  }

  if (!isGrapesProject(data)) return { status: "unreadable" };

  // Unconditionally, not just as a migration: a file stamped with the current
  // format can still carry editor state if a build wrote it there, and a
  // version gate would wave that straight through. Idempotent and cheap.
  data = stripEditorState(data);

  // Likewise the page names. GrapesJS drops an empty name on every save, so a
  // file stamped with the current format routinely holds an unnamed first
  // page; a migration alone would never see it.
  data = namePages(data);

  // Against the format this project would be saved as, not the newest there
  // is: a single-page file is stamped 2 for good (formatFor) and is current.
  return { status: "ok", data, from, migrated: from < formatFor(data) };
}

/**
 * The format a project is stamped with: the oldest one that describes it.
 *
 * Format 3 exists so that an OSCAR without a page switcher refuses a show it
 * could only draw the first page of. A project with a single page holds
 * nothing such a build cannot show -- a page name is the only difference, and
 * GrapesJS has always carried one -- so stamping it 3 would lock every file
 * saved from now on out of a colleague's older OSCAR for no reason. It keeps
 * the last single-page format, and gains 3 the day it gains a second page.
 */
const SINGLE_PAGE_FORMAT = 2;

function formatFor(data) {
  const pages = data && Array.isArray(data.pages) ? data.pages.length : 0;
  return pages > 1 ? CURRENT_FORMAT : Math.min(SINGLE_PAGE_FORMAT, CURRENT_FORMAT);
}

/**
 * Build the envelope written to disk.
 *
 * `oscar` and `grapesjs` are recorded for diagnosis -- knowing what wrote a
 * file is most of the work when someone reports it won't open. Neither is used
 * to decide anything; only `format` is.
 */
function stampProject({ name, data, oscar, grapesjs, now = () => new Date() }) {
  return {
    format: formatFor(data),
    oscar: oscar || null,
    grapesjs: grapesjs || null,
    name,
    updatedAt: now().toISOString(),
    data,
  };
}

module.exports = {
  CURRENT_FORMAT,
  formatFor,
  stripEditorState,
  namePages,
  defaultPageName,
  pageLabel,
  MIGRATIONS,
  isGrapesProject,
  detectFormat,
  openProject,
  stampProject,
};

},{}],9:[function(require,module,exports){
"use strict";

/**
 * The project list in the Save and Load dialogs: the parts that are not DOM.
 *
 * Sorting and formatting live here so they can be tested without a browser.
 * The rows come straight from GET /projects: { _id, name, size, date }.
 */

const KB = 1024;
const MB = 1024 * 1024;

/** A file size a person can read at a glance. Anything unusable shows blank. */
function formatSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < KB) return bytes + " B";
  if (bytes < MB) return Math.round(bytes / KB) + " KB";
  return (bytes / MB).toFixed(1) + " MB";
}

function isMissing(value) {
  return value === null || value === undefined || value === "";
}

/**
 * Rows ordered by one column, without changing the array handed in.
 *
 * Rows missing that value go last whichever way the column is sorted -- a
 * project with no date is not the newest one. Ties keep the order the server
 * sent, so a re-sort never shuffles rows that compare equal.
 */
function sortProjects(rows, key, direction) {
  const sign = direction === "descending" ? -1 : 1;

  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = a.row ? a.row[key] : undefined;
      const bv = b.row ? b.row[key] : undefined;
      const aMissing = isMissing(av);
      const bMissing = isMissing(bv);
      if (aMissing || bMissing) {
        if (aMissing === bMissing) return a.index - b.index;
        return aMissing ? 1 : -1;
      }

      const order =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });

      return order !== 0 ? Math.sign(order) * sign : a.index - b.index;
    })
    .map((entry) => entry.row);
}

/**
 * What clicking a column header does.
 *
 * The same column flips direction. A new column starts where people look
 * first: names A to Z, but sizes and dates largest and newest first.
 */
function nextSort(current, key) {
  if (current && current.key === key) {
    return { key, direction: current.direction === "ascending" ? "descending" : "ascending" };
  }
  return { key, direction: key === "name" ? "ascending" : "descending" };
}

/**
 * The rows as the list shows them: templates first, in the order the server
 * sent them, then the projects sorted by the chosen column.
 *
 * Templates stay on top whatever the sort, so they are always where people
 * last saw them. With `withTemplates` false -- the Save dialog, where picking
 * a template would only mean saving over its name -- they are left out.
 */
function orderProjects(rows, key, direction, withTemplates) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const templates = withTemplates === false ? [] : list.filter((row) => row.template === true);
  return templates.concat(sortProjects(list.filter((row) => row.template !== true), key, direction));
}

/** Newest first: someone opening Load usually wants what they saved last. */
const DEFAULT_SORT = { key: "date", direction: "descending" };

module.exports = { formatSize, sortProjects, orderProjects, nextSort, DEFAULT_SORT };

},{}],10:[function(require,module,exports){
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

module.exports = { surfaceAddress };

},{}],11:[function(require,module,exports){
"use strict";

/**
 * Naming the serial cable as somewhere a widget can send.
 *
 * A widget says where it sends with an Ip and a Port. A board on a USB cable
 * has neither, so the word `serial` stands in the Ip field and the server
 * routes the message down the cable instead of onto the network.
 *
 * Why the Ip field and not a section of its own beside OSC and DMX: a
 * section says WHAT goes on the wire (OSC, DMX levels), and serial changes
 * none of that. Ip is on every widget that sends at all, so a text input can
 * reach a board as easily as a fader can. It is the same OSC
 * message with a different destination, which is what Ip has always meant.
 * "OSC to the board and DMX to the dimmer" falls out for free: tick both
 * sections.
 *
 * Kept in its own file, away from lib/serial.js: the validators in
 * lib/widgets/ run inside the browser bundle, and lib/serial.js reaches for a
 * native serial module that has no business being browserified.
 */

const SERIAL_HOST = "serial";

/**
 * Is this destination the board on the cable rather than the network?
 *
 * Forgiving about case and stray spaces on purpose: there is one reading of
 * the word and every gate uses it, so "Serial " can never be accepted by the
 * settings panel and then sent to the network by the server.
 */
function isSerialTarget(ip) {
  return typeof ip === "string" && ip.trim().toLowerCase() === SERIAL_HOST;
}

module.exports = { SERIAL_HOST, isSerialTarget };

},{}],12:[function(require,module,exports){
"use strict";

/**
 * Where the editor's toolbar buttons sit, as plain data.
 *
 * GrapesJS appends every button to the end of its panel and offers no way to
 * say where one goes, so OSCAR's buttons land in the order its scripts happen
 * to add them. The order that makes sense to a person is stated here instead,
 * and applied once every button exists.
 *
 * Each entry reads "put this button straight after that one".
 */
const PLACEMENTS = [
  // Locking is what you do once a surface is pushed and the doors are about
  // to open, so it belongs beside the button that pushes it.
  { id: "toggle-lock", after: "preview" },
  // Pages and the widget style are both about the surface as a whole, not
  // about getting a project in or out.
  { id: "open-pages", after: "open-styles" },
  // Out and in are a pair: publishing sends the surface out (arrow up),
  // Import brings code in (arrow down), side by side.
  { id: "gjs-open-import-webpage", after: "oscar-export" },
];

/**
 * `ids` with `id` moved to sit straight after `after`. A button that is not
 * there -- a panel that failed to load, a renamed command -- leaves the order
 * as it was rather than throwing: a toolbar in the old order still works.
 */
function moveAfter(ids, id, after) {
  const order = Array.isArray(ids) ? ids.slice() : [];
  if (id === after || order.indexOf(id) === -1 || order.indexOf(after) === -1) return order;
  order.splice(order.indexOf(id), 1);
  order.splice(order.indexOf(after) + 1, 0, id);
  return order;
}

/** The order after every placement has been applied, first to last. */
function arrange(ids, placements) {
  return (placements || PLACEMENTS).reduce((order, p) => moveAfter(order, p.id, p.after), Array.isArray(ids) ? ids.slice() : []);
}

module.exports = { PLACEMENTS, moveAfter, arrange };

},{}],13:[function(require,module,exports){
"use strict";

/**
 * The styles a surface can wear, and what switching between them involves.
 *
 * A style is a set of token values (--osc-*) in public/assets/css/styles/<id>.css,
 * light and dark, converted from a tweakcn preset. The widgets in toggle.css
 * draw only from those tokens, so a style never touches a widget rule.
 *
 * A surface records its choice as two attributes on its body, which travel with
 * the project to the preview and every tablet:
 *   data-osc-style="<id>"   data-osc-appearance="light" | "dark"
 *
 * Adding a style: its file in styles/, one entry below, and the font package
 * if it needs one that is not bundled yet.
 */

const STYLES = [
  { id: "default", label: "Default", fonts: [] },
  { id: "amber-minimal", label: "Amber Minimal", fonts: ["inter"] },
  { id: "cyberpunk", label: "Cyberpunk", fonts: ["outfit"] },
  { id: "supabase", label: "Supabase", fonts: ["outfit"] },
  { id: "tangerine", label: "Tangerine", fonts: ["inter"] },
];

/**
 * The choice of no style: the page's own CSS decides how it looks. A page that
 * is a design of its own -- an imported site, the OSCAR Showcase -- writes its
 * tokens under [data-osc-style="own"], and they give way the moment one of
 * the styles above is picked instead. It has no file. Where the page sets
 * nothing, the Default style's values are underneath (see default.css), so a
 * widget is never left unpainted.
 */
const OWN_STYLE = { id: "own", label: "Page's own", hint: "OSCAR picks no theme. The page's own CSS decides the look." };

/** Everything the picker offers, in order. */
const CHOICES = STYLES.concat([OWN_STYLE]);

const APPEARANCES = ["light", "dark"];

const DEFAULT_STYLE = "default";
const DEFAULT_APPEARANCE = "light";

const STYLE_ATTRIBUTE = "data-osc-style";
const APPEARANCE_ATTRIBUTE = "data-osc-appearance";

function isStyle(id) {
  return CHOICES.some((style) => style.id === id);
}

function isAppearance(value) {
  return APPEARANCES.indexOf(value) !== -1;
}

/**
 * What the canvas has to load, in order: fonts, then every style's tokens,
 * then the widgets that draw with them. Fonts are bundled locally -- OSCAR
 * runs at venues with no internet.
 */
function canvasStylesheets() {
  const fonts = [];
  STYLES.forEach((style) => {
    style.fonts.forEach((font) => {
      if (fonts.indexOf(font) === -1) fonts.push(font);
    });
  });

  return fonts
    .map((font) => "node_modules/@fontsource-variable/" + font + "/index.css")
    .concat(STYLES.map((style) => "assets/css/styles/" + style.id + ".css"))
    .concat(["assets/css/toggle.css"]);
}

/**
 * The surface itself follows the style: its background, text colour and font.
 *
 * This cannot live in a layer like everything else. The canvas paints its body
 * white with an unlayered rule of its own, and a layered rule always loses to
 * that. So it is given to GrapesJS as protectedCss, which comes after that
 * rule; an edit made to the Body in the Style Manager is an id rule and still
 * wins over it. The first two rules are GrapesJS's own default protectedCss,
 * kept because setting the option replaces them.
 */
const SURFACE_CSS =
  "* { box-sizing: border-box; } body { margin: 0; } " +
  // The style attributes live on GrapesJS's wrapper element, which is what gets
  // saved; they are copied onto the body too (see copyToBody), so both paint.
  "body, [data-osc-style] { background-color: var(--osc-background); color: var(--osc-foreground); " +
  "font-family: var(--osc-font); letter-spacing: var(--osc-letter-spacing); }";

/**
 * The properties that make up how a widget looks, as opposed to where it is.
 *
 * "Reset to style" removes these from a widget's own styling so it follows the
 * surface's style again, and leaves position, size and spacing alone: undoing
 * someone's layout to reset a colour would be a nasty surprise.
 */
const APPEARANCE_PROPERTY = /^(background|color$|border|outline|box-shadow|text-shadow|font|letter-spacing|line-height|text-|opacity$|--osc-)/;

function isAppearanceProperty(name) {
  return APPEARANCE_PROPERTY.test(String(name));
}

/** A widget's own styling with the appearance taken out and the layout kept. */
function withoutAppearance(style) {
  const kept = {};
  Object.keys(style || {}).forEach((name) => {
    if (!isAppearanceProperty(name)) kept[name] = style[name];
  });
  return kept;
}

/**
 * Copy a surface's style from its saved attributes onto another element --
 * the canvas body. GrapesJS keeps the attributes on its wrapper element and
 * never saves the body, so the body has to be told again whenever the canvas
 * loads, a project loads, or the style changes. A surface with no style takes
 * the attributes off, so the body falls back to the default style.
 */
function copyToBody(attributes, body) {
  [STYLE_ATTRIBUTE, APPEARANCE_ATTRIBUTE].forEach((name) => {
    const value = attributes && attributes[name];
    if (value) body.setAttribute(name, value);
    else body.removeAttribute(name);
  });
}

/**
 * Which components get "Reset to style": OSCAR's widgets, and the surface
 * itself (GrapesJS's wrapper, shown as Body), whose background follows the
 * style the same way a widget's colours do.
 */
function offersReset(type) {
  return type === "wrapper" || /^oscar-/.test(String(type || ""));
}

/**
 * A surface's attributes with its style taken from `source` instead: the body
 * attributes of an imported document or template. Only a style and appearance
 * OSCAR has are taken, and a document that names neither leaves the surface
 * with no style, since importing replaces the whole surface.
 */
function withSurfaceStyle(current, source) {
  const attributes = Object.assign({}, current);
  delete attributes[STYLE_ATTRIBUTE];
  delete attributes[APPEARANCE_ATTRIBUTE];
  const style = source && source[STYLE_ATTRIBUTE];
  const appearance = source && source[APPEARANCE_ATTRIBUTE];
  if (isStyle(style)) attributes[STYLE_ATTRIBUTE] = style;
  if (isAppearance(appearance)) attributes[APPEARANCE_ATTRIBUTE] = appearance;
  return attributes;
}

module.exports = {
  copyToBody,
  withSurfaceStyle,
  offersReset,
  STYLES,
  OWN_STYLE,
  CHOICES,
  APPEARANCES,
  DEFAULT_STYLE,
  DEFAULT_APPEARANCE,
  STYLE_ATTRIBUTE,
  APPEARANCE_ATTRIBUTE,
  SURFACE_CSS,
  isStyle,
  isAppearance,
  canvasStylesheets,
  isAppearanceProperty,
  withoutAppearance,
};

},{}],14:[function(require,module,exports){
"use strict";

const {
  field,
  oscFields,
  enabled,
  connectionChecks,
  dmxFields,
  dmxDefaults,
  dmxChecks,
} = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { follow } = require("./incoming");
const { share, onShared } = require("./shared");
const { ARG_TYPES, isSendable, toNumber } = require("../osc-args");

const DEFAULT_LABEL = "Insert here your text";

/** The class that shows a toggle is on. Styled in public/assets/css/toggle.css. */
const ON_CLASS = "toggle";

const MODES = [
  { id: "momentary", name: "momentary (hold)" },
  { id: "toggle", name: "toggle (click)" },
];

/**
 * OSC button.
 *
 * Momentary sends Value ON while held and Value OFF on release. Toggle
 * alternates between them on each press. On DMX the two edges are full and
 * out, whatever Value ON and Value OFF say: a button is a switch, not a level.
 *
 * With Listen on, a value arriving at Message sets what the button shows: a
 * toggle adopts it as its state, so the next press sends the opposite edge;
 * a momentary button only lights up, because its state is the finger's.
 * The same button on another device is followed the same way, Listen or
 * not: every tablet on the surface shows one state, { on }.
 */
const button = {
  name: "oscar-button",
  tag: "button",
  // The label is plain text inside the button, not a child element. A child
  // intercepted every click and drag: grabbing a button by its label tore the
  // label out, and clicking selected the text rather than the button.
  text: "label",

  sends: true,
  receives: true,
  dmx: true,

  block: {
    label: "Button",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M5,3H19A2,2 0 0,1 21,5V19A2,2 0 0,1 19,21H5A2,2 0 0,1 3,19V5A2,2 0 0,1 5,3Z"/></svg>',
  },

  defaults: Object.assign(
    {
      label: DEFAULT_LABEL,
      enabled: true,
      ip: "localhost",
      port: 7000,
      message: "/push1",
      listen: false,
      mode: "momentary",
      valueOn: "1",
      valueOff: "0",
      argType: "i",
    },
    dmxDefaults(1)
  ),

  fields: [enabled(), field("label", "Label", "text")]
    .concat(oscFields())
    .concat([
      field("mode", "Mode", "select", { options: MODES }),
      field("valueOn", "Value ON", "text"),
      field("valueOff", "Value OFF", "text"),
      field("argType", "Argument type", "select", { section: "osc", options: ARG_TYPES }),
    ])
    .concat(dmxFields()),

  checks: Object.assign({}, connectionChecks(), dmxChecks(1), {
    valueOn: checkValue,
    valueOff: checkValue,
  }),

  /**
   * Bind a live button to an element.
   *
   * `ctx` is the whole of what a widget may assume about its host; the
   * contract is at the top of index.js. Everything here is plain DOM, so
   * porting to another editor means providing that, not rewriting the button.
   */
  attach: function (el, ctx) {
    let on = false;
    // What the rig says a momentary button is doing while no finger is on it.
    // Kept apart from `on`, because `on` is the finger's: folding the two
    // together would make a press on a button the rig already reports as on
    // send no ON edge at all.
    let echo = false;

    function paint() {
      ctx.setClass(ON_CLASS, on || echo);
    }

    /**
     * The one place an edge is decided.
     *
     * Guarding on the current state means a key repeat, a duplicated pointer
     * event, or a second blur cannot send the same edge twice -- downstream,
     * a repeated ON is a retrigger.
     */
    function setOn(next) {
      if (next === on) return;
      on = next;
      // The release is the latest word on the matter; a stale echo must not
      // keep the button lit after it.
      if (!on) echo = false;
      paint();
      ctx.send(resolve(ctx, on));
      // A momentary button is on for as long as this finger is down, and a
      // tablet that falls off the network mid-press never reports the
      // release: the press goes out with what to show if that happens, or
      // every other device stays lit. A toggle's state outlives the device
      // that set it, so it carries nothing of the kind.
      share(ctx, { on: on }, on && isMomentary() ? { release: { on: false } } : undefined);
    }

    /**
     * Show an edge decided elsewhere -- by the rig, or by a hand on another
     * device. Paints, and for a toggle adopts it as the state, so the next
     * press here sends the opposite edge. Through paint(), never setOn(),
     * which is the path that sends. Returns whether it was taken: a
     * momentary button under a finger takes nothing, because its state is
     * the finger's for as long as it is down.
     */
    function take(next) {
      if (isMomentary()) {
        if (on) return false;
        echo = next;
      } else {
        on = next;
        echo = false;
      }
      paint();
      return true;
    }

    /**
     * Take an edge the rig sent, and have it recorded as heard: the other
     * devices were sent the same message, so nobody needs telling, but a
     * device joining later starts where the rig left the button.
     */
    function adopt(values) {
      const next = asEdge(ctx, values[0]);
      if (next === null) return;
      if (take(next)) share(ctx, { on: next }, { heard: true });
    }

    /** Take the edge another device shows. Never shared again: it came from there. */
    function adoptShared(state) {
      if (typeof state.on !== "boolean") return;
      take(state.on);
    }

    function isMomentary() {
      return ctx.get("mode") !== "toggle";
    }

    function onPointerDown(e) {
      if (!isMomentary()) return;
      // Stops the press selecting the label text or starting a drag.
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch (err) {
        /* older engines manage without it */
      }
      setOn(true);
    }

    function release() {
      if (isMomentary()) setOn(false);
    }

    function onClick() {
      if (!isMomentary()) setOn(!on);
    }

    function onKeyDown(e) {
      if (e.key !== " " && e.key !== "Enter") return;
      if (!isMomentary()) return;
      // Suppress the synthetic click the browser would fire, so holding the
      // key stays one edge rather than a stream of them.
      e.preventDefault();
      if (!e.repeat) setOn(true);
    }

    function onKeyUp(e) {
      if (e.key !== " " && e.key !== "Enter") return;
      release();
    }

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("keyup", onKeyUp);

    // Without this, alt-tabbing mid-press strands the button on and whatever
    // it drives stays on with it -- the pointerup lands on another window.
    // Guarded so the widget can be exercised outside a browser.
    const root = typeof window === "undefined" ? null : window;
    if (root) root.addEventListener("blur", release);

    // The on state lives here, not in the host's model, so it is never saved;
    // the cost is that the host wipes the class when it rewrites the element,
    // and a toggle that is on would paint as off while the rig stays on.
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(paint) : null;
    const stopOsc = follow(ctx, adopt);
    const stopShared = onShared(ctx, adoptShared);

    return function detach() {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("keyup", onKeyUp);
      if (root) root.removeEventListener("blur", release);
      if (stopRewrite) stopRewrite();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

/**
 * Read a received value as an edge: true for ON, false for OFF, null for
 * nothing the button can act on.
 *
 * The button's own Value ON and Value OFF are checked first, so a button that
 * sends "go"/"stop" follows the same words coming back. Failing that, a bool
 * is itself and a number is on unless it is zero. Anything else -- a word the
 * button never uses, a blob -- is ignored rather than guessed at.
 *
 * A blank value matches nothing: a button whose Value ON was cleared would
 * otherwise light up on an empty string. And a message with no argument at
 * all is ignored, which means a button that itself sends no argument has
 * nothing to follow -- a bare address is the same on both edges, so it says
 * nothing about state.
 */
function asEdge(ctx, value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const valueOn = trimmed(ctx.get("valueOn"));
  const valueOff = trimmed(ctx.get("valueOff"));
  if (valueOn && text === valueOn) return true;
  if (valueOff && text === valueOff) return false;
  if (typeof value === "boolean") return value;
  const number = toNumber(value);
  if (number !== null) return number !== 0;
  return null;
}

function trimmed(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

/** The message for one edge, or null if it cannot or should not be sent. */
function resolve(ctx, on) {
  return outgoing(routing(ctx), on ? ctx.get("valueOn") : ctx.get("valueOff"), on ? 1 : 0);
}

/**
 * A value is judged against the argument type it will be sent as, because
 * "abc" is perfectly good as a string and unsendable as a float.
 */
function checkValue(value, config) {
  const argType = (config && config.argType) || "f";
  if (isSendable(argType, value)) return null;
  return 'The value "' + value + '" cannot be sent as ' + argType;
}

module.exports = { button, MODES, ON_CLASS, DEFAULT_LABEL };

},{"../osc-args":6,"./fields":17,"./incoming":18,"./outgoing":23,"./shared":25}],15:[function(require,module,exports){
"use strict";

const {
  field,
  oscFields,
  enabled,
  connectionChecks,
  dmxFields,
  dmxDefaults,
  dmxChecks,
} = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { follow } = require("./incoming");
const { share, onShared } = require("./shared");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");
const { clamp } = require("../dmx/levels");

/**
 * How the colour is written on the wire.
 *
 * There is no one convention, which is why this is a setting and not a
 * decision baked into the widget: some software wants three channels, some
 * four, and some is happiest with the hex code a designer pastes out of a
 * palette.
 */
const FORMATS = [
  { id: "rgb", name: "3 values (r, g, b)" },
  { id: "rgba", name: "4 values (r, g, b, a)" },
  { id: "hex", name: "hex string (#rrggbb)" },
];

/**
 * The scale the channels are on. Resolume reads a colour parameter as 0-1;
 * TouchDesigner and pixel-minded software read 0-255. Guessing wrong sends
 * 255 where 1 was meant, which reads as white either way and hides the
 * mistake until something clips, so it is asked rather than assumed.
 */
const SCALES = [
  { id: "unit", name: "0 to 1" },
  { id: "byte", name: "0 to 255" },
];

const MAX = 255;

/** Bare or #-prefixed, three or six digits, or four or eight with an alpha. */
const HEX = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Read a hex colour as [r, g, b] bytes, or null.
 *
 * Null rather than black: #000000 is a colour someone may have chosen on
 * purpose, so it cannot double as "this could not be read". The short forms
 * are accepted because they are what a hand types into the Colour field
 * (#f80, or f80 without the hash), and the four- and eight-digit forms
 * because some software writes its colours with an alpha on the end; the
 * swatch has nowhere to show one, so it is dropped.
 */
function parseHex(raw) {
  if (typeof raw !== "string") return null;
  const match = HEX.exec(raw.trim());
  if (!match) return null;

  let digits = match[1];
  if (digits.length <= 4) {
    // #f0a is shorthand for #ff00aa: each digit doubles.
    digits = digits
      .split("")
      .map((d) => d + d)
      .join("");
  }
  return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16));
}

/** The one form <input type="color"> holds: lowercase #rrggbb. */
function toHex(rgb) {
  return "#" + rgb.map((byte) => ("0" + byte.toString(16)).slice(-2)).join("");
}

/** The same colour in the form the swatch holds, or null. */
function normaliseHex(raw) {
  const rgb = parseHex(raw);
  return rgb ? toHex(rgb) : null;
}

/** 128 -> 0.502, not 0.5019607843137255: nothing downstream needs the tail. */
function round(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * OSC colour picker.
 *
 * A native <input type="color"> rather than a hand-drawn wheel: it is the one
 * colour control every tablet already knows how to open, it works with a
 * keyboard, and a CSS edit cannot break it. Dragging inside the OS picker
 * fires input continuously; one send per frame keeps a fixture following
 * the hand without flooding the network, and the change event -- the picker
 * being dismissed -- sends the exact colour chosen.
 *
 * On the wire the colour is three channels, four with an Alpha, or the hex
 * string, on the scale Range says. On DMX it is red, green and blue on three
 * consecutive channels, whatever the OSC format: an RGB fixture is exactly
 * that block, and alpha is not a thing a fixture has (an RGBA fixture's
 * fourth channel is amber).
 *
 * With Listen on, a colour arriving at Message fills the swatch, in either
 * shape OSCAR itself sends: the hex string, or three channels on the same
 * Range (a fourth, alpha, is ignored). Anything unreadable leaves the swatch
 * alone: the native control falls back to black when handed a value it does
 * not understand, and a rig sending nonsense must not black a colour out.
 */
const colour = {
  name: "oscar-colour",
  tag: "input",
  // The slider is an input too; the type is what tells them apart when a
  // project is parsed.
  attributes: { type: "color" },

  sends: true,
  receives: true,
  dmx: true,

  block: {
    label: "Colour",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M17.5,12A1.5,1.5 0 0,1 16,10.5A1.5,1.5 0 0,1 17.5,9A1.5,1.5 0 0,1 19,10.5A1.5,1.5 0 0,1 ' +
      '17.5,12M14.5,8A1.5,1.5 0 0,1 13,6.5A1.5,1.5 0 0,1 14.5,5A1.5,1.5 0 0,1 16,6.5A1.5,1.5 0 0,1 ' +
      '14.5,8M9.5,8A1.5,1.5 0 0,1 8,6.5A1.5,1.5 0 0,1 9.5,5A1.5,1.5 0 0,1 11,6.5A1.5,1.5 0 0,1 ' +
      '9.5,8M6.5,12A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,1 6.5,9A1.5,1.5 0 0,1 8,10.5A1.5,1.5 0 0,1 ' +
      '6.5,12M12,3A9,9 0 0,0 3,12A9,9 0 0,0 12,21A1.5,1.5 0 0,0 13.5,19.5C13.5,19.11 13.35,18.76 ' +
      '13.11,18.5C12.88,18.23 12.73,17.88 12.73,17.5A1.5,1.5 0 0,1 14.23,16H16A5,5 0 0,0 ' +
      '21,11C21,6.58 16.97,3 12,3Z"/></svg>',
  },

  defaults: Object.assign(
    {
      enabled: true,
      ip: "localhost",
      port: 7000,
      message: "/colour",
      listen: false,
      value: "#ff0000",
      format: "rgb",
      scale: "unit",
      alpha: 1,
      argType: "f",
    },
    dmxDefaults(3)
  ),

  fields: [enabled()]
    .concat(oscFields())
    .concat([
      field("value", "Colour", "text", { placeholder: "#rrggbb" }),
      field("format", "Send as", "select", { options: FORMATS }),
      field("scale", "Range", "select", { options: SCALES }),
      // Alpha is configured, not picked: the native control has no alpha
      // channel. Always typed as 0-1 whatever Range says, so switching Range
      // does not silently reinterpret it.
      field("alpha", "Alpha", "number", { min: 0, max: 1, step: "any", showIf: { key: "format", in: ["rgba"] } }),
      // A hex string is a string by definition; the argument type only has
      // something to say about the numeric formats.
      field("argType", "Argument type", "select", { section: "osc", options: NUMERIC_ARG_TYPES, showIf: { key: "format", in: ["rgb", "rgba"] } }),
    ])
    .concat(dmxFields()),

  checks: Object.assign({}, connectionChecks(), dmxChecks(3), {
    value: checkColour,
    alpha: checkAlpha,
    // One rule, asked from each of the three settings that can bring the
    // combination about, so it is refused whichever is edited last.
    argType: checkWholeNumbers,
    scale: checkWholeNumbers,
    format: checkWholeNumbers,
  }),

  attach: function (el, ctx) {
    // True from the first move inside the picker until it is dismissed. The
    // network is ignored for as long as it is: a colour arriving mid-pick
    // would snatch the swatch out from under the hand.
    //
    // Deliberately NOT set on click or focus. A picker that reports only on
    // OK (the Windows dialog, Android) would be covered that way, but a
    // cancelled dialog fires nothing a page can rely on, and the flag would
    // stay up: a picker deaf to the rig for good is worse than a swatch
    // repainted behind an open dialog, which the next OK puts right.
    let picking = false;
    let frame = null;
    let pending = null;
    // The colour last sent during this pick. The change event repeats the
    // colour the last input already put on a frame, and one pick is one
    // colour, not two copies of it.
    let last = null;

    apply();

    /**
     * Put the stored colour on the swatch after a load. Only a colour that
     * could be read: the native control turns anything else into black.
     */
    function apply() {
      const hex = normaliseHex(ctx.get("value"));
      if (hex) el.value = hex;
    }

    /** Take the swatch's colour as the current one; null if it is unreadable. */
    function read() {
      const hex = normaliseHex(el.value);
      if (hex === null) return null;
      ctx.set("value", hex);
      pending = hex;
      return hex;
    }

    function onInput() {
      picking = true;
      if (read() !== null) schedule();
    }

    /** The picker was dismissed: what it holds is the exact colour chosen. */
    function onChange() {
      read();
      release();
    }

    /**
     * The end of a pick: the change event, or focus leaving the control or
     * the window before one arrived -- the picker closed by an alt-tab, say.
     * What the swatch last held is what goes out, exactly and at once, and
     * the rig is heard again. The next pick starts afresh, so choosing the
     * same colour again later is sent again.
     */
    function release() {
      picking = false;
      flush();
      last = null;
    }

    // A drag across the picker fires far more often than anything needs;
    // one send per frame is plenty. Where there are no frames -- outside a
    // browser -- every move sends, which is what a test wants anyway.
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
    const cancelRaf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : null;

    function schedule() {
      if (!raf) return flush();
      if (frame) return;
      frame = raf(function () {
        frame = null;
        flush();
      });
    }

    function flush() {
      if (frame && cancelRaf) {
        cancelRaf(frame);
        frame = null;
      }
      if (pending === null) return;
      const hex = pending;
      pending = null;
      if (hex === last) return;
      last = hex;
      const message = resolve(ctx, hex);
      ctx.send(message);
      // Only a colour that went out is news for the other devices.
      if (message) share(ctx, { value: hex });
    }

    /**
     * Take a colour the rig sent. Stores it and fills the swatch through
     * apply(), the view-only path -- a colour that came in must never go
     * back out.
     */
    function adopt(values) {
      const hex = fromWire(values, ctx.get("scale"));
      // Every device heard the rig: recorded for whoever joins later, passed
      // to nobody.
      if (take(hex)) share(ctx, { value: hex }, { heard: true });
    }

    /** Another device picked. Shown, and never shared again: it came from there. */
    function adoptShared(state) {
      if (state) take(normaliseHex(state.value));
    }

    /** Fill the swatch with a colour that arrived, unless a hand is picking. */
    function take(hex) {
      if (picking || hex === null) return false;
      ctx.set("value", hex);
      apply();
      return true;
    }

    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    el.addEventListener("blur", release);
    // Guarded so the widget can be exercised outside a browser.
    const root = typeof window === "undefined" ? null : window;
    if (root) root.addEventListener("blur", release);

    // A hand-edited Colour field has to reach the swatch; a format or scale
    // edit changes what the same colour means on the wire, and nothing is
    // sent until the next pick.
    const stop = ctx.onChange(["value"], apply);
    // The value is a property, not an attribute, and survives the host
    // rewriting the element; put back anyway, because that is one assumption
    // about the host fewer.
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(apply) : null;
    const stopOsc = follow(ctx, adopt);
    const stopShared = onShared(ctx, adoptShared);

    return function detach() {
      if (frame && cancelRaf) cancelRaf(frame);
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", onChange);
      el.removeEventListener("blur", release);
      if (root) root.removeEventListener("blur", release);
      if (stop) stop();
      if (stopRewrite) stopRewrite();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

/**
 * The OSC values one colour becomes, in order, or null if it cannot be sent.
 *
 * A blank or mistyped Alpha refuses the message rather than filling in a
 * number: Number("") is 0, and 0 alpha is fully transparent, which on a media
 * server is the layer going dark. toNumber() returns null for it instead. A
 * readable alpha past either end pins there, as a unit does on DMX.
 */
function oscValues(ctx, rgb) {
  const byte = ctx.get("scale") === "byte";
  const values = rgb.map((channel) => (byte ? channel : round(channel / MAX)));
  if (ctx.get("format") !== "rgba") return values;

  const alpha = toNumber(ctx.get("alpha"));
  if (alpha === null) return null;
  const unit = clamp(alpha, 0, 1);
  values.push(byte ? Math.round(unit * MAX) : round(unit));
  return values;
}

/**
 * What one colour puts on the wire, or null.
 *
 * The DMX half is always red, green and blue as 0..1, whatever the OSC
 * format: a fixture takes channels, not strings, and never an alpha. The two
 * halves are independent, so an alpha that cannot be read silences OSC and
 * leaves DMX driving the fixture.
 */
function resolve(ctx, hex) {
  const rgb = parseHex(hex);
  if (rgb === null) return null;
  const units = rgb.map((channel) => channel / MAX);
  const config = routing(ctx);

  if (ctx.get("format") === "hex") {
    return outgoing(Object.assign(config, { argType: "s" }), toHex(rgb), units);
  }
  return outgoing(config, oscValues(ctx, rgb), units);
}

/**
 * Read a colour off the wire, in whichever shape it arrives, or null.
 *
 * The hex string OSCAR sends in hex mode comes back as one string; the
 * channels it sends otherwise come back as three or four values on the
 * configured Range, and only the first three are read: the swatch has
 * nowhere to show an alpha. Numbers spelled as text are numbers. A channel
 * past either end of the range pins there, as a received slider value does;
 * a channel that cannot be read at all leaves the swatch as it was, the
 * same as the send path, where an unreadable value is dropped rather than
 * read as 0 -- and 0, 0, 0 is black.
 *
 * Channels are tried BEFORE the hex code. "255" and "000" are both valid
 * three-digit hex codes, so software that sends its channels as text
 * ("255", "128", "0") would otherwise paint #225555, and "000" first would
 * paint black: an unrelated colour, adopted silently. Three readable numbers
 * are never a hex code; a string is only taken as one when it is the only
 * value, which is what OSCAR itself sends, starts with '#', or has six digits. The rule lives here and not in parseHex because a bare "100" typed
 * into the Colour field is still a hex code.
 */
function fromWire(values, scale) {
  if (!Array.isArray(values) || !values.length) return null;

  const rgb = channelsOf(values, scale);
  if (rgb) return toHex(rgb);

  // A list that failed to read as channels is NOT then tried as a hex code,
  // unless it says so with a '#' or is too long to be a channel. Without this, channels sent as text with
  // one of them unreadable -- "000", "  ", "0" -- fell through to reading
  // "000" as a short hex code and painted black: the blackout-by-nonsense
  // this widget exists to refuse. A lone string is the hex form OSCAR sends.
  const first = values[0];
  if (typeof first !== "string") return null;
  // Six digits or more cannot be a channel on either Range, so they stay a
  // hex code; it is the bare short forms that a number can pass for.
  const bare = first.trim();
  if (values.length > 1 && bare.charAt(0) !== "#" && bare.length < 6) return null;
  return normaliseHex(first);
}

/** The first three values as bytes, or null unless all three are numbers. */
function channelsOf(values, scale) {
  if (values.length < 3) return null;

  const full = scale === "byte" ? 1 : MAX;
  const rgb = [];
  for (let i = 0; i < 3; i++) {
    const number = toNumber(values[i]);
    if (number === null) return null;
    rgb.push(Math.round(clamp(number * full, 0, MAX)));
  }
  return rgb;
}

function checkColour(value) {
  if (normaliseHex(value)) return null;
  return "A colour is a hex code, like #ff8800";
}

function checkAlpha(value) {
  const alpha = toNumber(value);
  if (alpha !== null && alpha >= 0 && alpha <= 1) return null;
  return "Alpha has to be a number between 0 and 1";
}

/**
 * Whole numbers on a 0 to 1 range leave two values per channel: #808080
 * rounds to 1, 1, 1 and #7f7f7f to 0, 0, 0, so every colour reaches the rig
 * as one of eight primaries, and an Alpha of 0.25 goes out as 0 -- fully
 * transparent. Nobody means that; someone who picks int wants 0 to 255.
 * Refused in the panel rather than rewritten on the wire, so what is
 * configured stays what is sent. The hex format ignores the argument type,
 * so it is left alone.
 */
function checkWholeNumbers(value, config) {
  if (!config) return null;
  if (config.format === "hex" || config.argType !== "i" || config.scale !== "unit") return null;
  return "Whole numbers need Range set to 0 to 255: on 0 to 1 every channel would round to 0 or 1";
}

module.exports = { colour, FORMATS, SCALES, parseHex, normaliseHex, fromWire };

},{"../dmx/levels":1,"../osc-args":6,"./fields":17,"./incoming":18,"./outgoing":23,"./shared":25}],16:[function(require,module,exports){
"use strict";

const {
  field,
  oscFields,
  enabled,
  connectionChecks,
  dmxFields,
  dmxDefaults,
  dmxChecks,
  sendsDmx,
} = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { follow } = require("./incoming");
const { share, onShared } = require("./shared");
const { refusal, checkArgType, levelOf } = require("./typed");
const { ARG_TYPES } = require("../osc-args");

/**
 * Turn the designer's option list into options.
 *
 * One option per line would read better, but every setting in the panel is a
 * single-line control, so a newline can never be typed into one. Commas and
 * semicolons are the separators that survive the panel:
 *
 *   Red=1, Green=2, Blue=3
 *   Off=0; Half=128; Full=255
 *
 * An item with no "=" is its own label and value, so a bare "1, 2, 3" works
 * and is the quickest thing to type. A label or value holding a comma or a
 * semicolon is the price of that choice; OSC values rarely do. The split is
 * at the LAST "=": labels are written for people and do hold one ("EQ=flat"),
 * values are written for a rig and almost never do.
 */
function parseOptions(raw) {
  const options = [];
  for (const part of String(raw === null || raw === undefined ? "" : raw).split(/[,;]/)) {
    const item = part.trim();
    if (!item) continue;
    const split = item.lastIndexOf("=");
    if (split === -1) {
      options.push({ label: item, value: item });
      continue;
    }
    const label = item.slice(0, split).trim();
    const value = item.slice(split + 1).trim();
    options.push({ label: label || value, value: value });
  }
  return options;
}

/** The designer's text is content, never markup. */
function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, function (character) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character];
  });
}

/**
 * OSC dropdown: a fixed list of cues, each sending its own value.
 *
 * A native select, because a tablet renders it as the platform's own picker
 * -- a wheel on iOS, a sheet on Android -- which beats anything hand-drawn
 * for hitting the right row with a thumb. One pick is one message: a
 * dropdown has no half-typed states to flood the wire with, so it sends the
 * moment a choice is made -- by pointer or touch. A keyboard walking a closed
 * list raises a pick for every row it passes, and those are no more choices
 * than the 1 in 12.5 is a number: they wait for Enter, or for the list to be
 * left. On DMX the option's value is the level, 0-255, so "Off=0, Half=128,
 * Full=255" is a three-step dimmer; the panel refuses an option that is not
 * one while DMX's Enable is ticked.
 *
 * With Listen on, a value arriving at Message selects the option that sends
 * it; a value no option sends changes nothing.
 */
const dropdown = {
  name: "oscar-dropdown",
  tag: "select",
  attributes: { class: "oscar-dropdown" },

  sends: true,
  receives: true,
  dmx: true,

  block: {
    label: "Dropdown",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M2,5H22A1,1 0 0,1 23,6V18A1,1 0 0,1 22,19H2A1,1 0 0,1 1,18V6A1,1 0 0,1 ' +
      '2,5M3,7V17H21V7H3M15,10H19L17,13L15,10Z"/></svg>',
  },

  defaults: Object.assign(
    {
      enabled: true,
      ip: "localhost",
      port: 7000,
      message: "/dropdown1",
      listen: false,
      options: "Red=1, Green=2, Blue=3",
      value: "1",
      argType: "i",
    },
    dmxDefaults(1)
  ),

  fields: [enabled()]
    .concat(oscFields())
    .concat([
      field("options", "Options", "text", { placeholder: "Red=1, Green=2, Blue=3" }),
      field("value", "Selected", "text"),
      field("argType", "Argument type", "select", { section: "osc", options: ARG_TYPES }),
    ])
    .concat(dmxFields()),

  checks: Object.assign({}, connectionChecks(), dmxChecks(1), {
    options: checkOptions,
    value: checkValue,
    // Sending DMX decides whether the options have to be levels, so switching
    // it on is judged like editing them: from either side, as argType is.
    dmxEnabled: function (value, config) {
      const next = Object.assign({}, config, { dmxEnabled: value, transport: undefined });
      return checkOptions(next.options, next);
    },
    argType: checkArgType(function (config) {
      return values(config.options).concat([config.value]);
    }),
  }),

  attach: function (el, ctx) {
    // Whether the last thing to touch the list was a key, and whether a pick
    // made that way is still waiting to be sent.
    let byKey = false;
    let pending = false;

    render();

    /**
     * Build the list from the Options setting.
     *
     * The option elements are never part of the saved widget: the setting is
     * the one source of truth, and rendering from it on every attach means an
     * edited list cannot drift from the markup. A stored selection the list
     * no longer offers falls back to the first option, and is stored as such,
     * so the box and the project agree on what is showing.
     */
    function render() {
      pending = false;
      const options = parseOptions(ctx.get("options"));
      el.innerHTML = options
        .map(function (option) {
          return '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + "</option>";
        })
        .join("");

      const selected = text(ctx.get("value"));
      if (offers(options, selected)) {
        el.value = selected;
      } else if (options.length) {
        el.value = options[0].value;
        ctx.set("value", options[0].value);
      }
    }

    // A select raises `input` and `change` together for one pick, so one of
    // them is enough; `input` is the one every host can raise, as a
    // browser does for anything a control's value changes through.
    function onPick() {
      if (byKey) pending = true;
      else commit();
    }

    function commit() {
      pending = false;
      const raw = el.value;
      ctx.set("value", raw);
      const message = outgoing(routing(ctx), raw, levelOf(raw));
      ctx.send(message);
      // Only a pick that went out is news: a row chosen on a disabled list
      // reached nothing, and must not be shown as chosen on the other devices.
      if (message) share(ctx, { value: raw });
    }

    // An open list keeps its arrow keys to itself and raises one pick when a
    // row is chosen, often with the Enter that chose it already seen here;
    // so Enter also ends keyboard mode and that pick goes straight out.
    function onKeyDown(e) {
      if (e.key !== "Enter") {
        byKey = true;
        return;
      }
      byKey = false;
      if (pending) commit();
    }

    function onPointerDown() {
      byKey = false;
    }

    // Tabbing away from a row is choosing it, as leaving a text box is.
    function onBlur() {
      byKey = false;
      if (pending) commit();
    }

    /**
     * Take a value the rig sent: select the option that sends it, and stop
     * there. Compared as text, so the 1 an int option comes back as finds
     * "Red=1". A value no option sends, or nothing OSCAR could read, is
     * ignored rather than shown as a blank box.
     */
    function adopt(values) {
      // Every device heard the rig, so it is recorded for whoever joins later
      // and passed to nobody.
      if (take(values[0])) share(ctx, { value: el.value }, { heard: true });
    }

    /** Another device picked. Shown, and never shared again: it came from there. */
    function adoptShared(state) {
      if (state) take(state.value);
    }

    /** Show a value that arrived, from the rig or from another device. */
    function take(value) {
      if (value === null || value === undefined || typeof value === "object") return false;
      const wanted = String(value);
      if (!offers(parseOptions(ctx.get("options")), wanted)) return false;
      ctx.set("value", wanted);
      el.value = wanted;
      // Something has spoken since the keyboard passed by; sending the passed
      // row now would answer it.
      pending = false;
      return true;
    }

    el.addEventListener("input", onPick);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("blur", onBlur);
    const stop = ctx.onChange(["options", "value"], render);
    const stopOsc = follow(ctx, adopt);
    const stopShared = onShared(ctx, adoptShared);

    return function detach() {
      el.removeEventListener("input", onPick);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("blur", onBlur);
      if (stop) stop();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

function text(value) {
  return value === null || value === undefined ? "" : String(value);
}

function offers(options, value) {
  return options.some(function (option) {
    return option.value === value;
  });
}

function values(raw) {
  return parseOptions(raw).map(function (option) {
    return option.value;
  });
}

/**
 * Every option has to be sendable, and there has to be one.
 *
 * Sendable on every protocol switched on: as the chosen type on OSC, and as a
 * level, 0-255, on DMX. "A=abc" is a fine string and no level at all, and
 * "A=300" is no level either -- pinned to 255, or -5 to a blackout, it would
 * be a cue the designer never wrote. Without this the dropdown looks live
 * and that option sends nothing.
 *
 * Two options may not send the same value: the value is all that is stored
 * and all that comes back from the rig, so the second could be picked but
 * never shown again.
 */
function checkOptions(raw, config) {
  const options = parseOptions(raw);
  if (!options.length) return "List the options like: Red=1, Green=2, Blue=3";
  const argType = (config && config.argType) || "i";
  const seen = {};
  for (const option of options) {
    const complaint = refusal(argType, option.value);
    if (complaint) return complaint;
    if (sendsDmx(config) && levelOf(option.value) === null) {
      return 'The value "' + option.value + '" is not a DMX level; on DMX every option has to be a number from 0 to 255';
    }
    if (seen["=" + option.value]) return 'Two options send "' + option.value + '"; each option needs its own value';
    seen["=" + option.value] = true;
  }
  return null;
}

/** The selection has to be one of the options; the list is what can be picked. */
function checkValue(value, config) {
  const options = parseOptions(config && config.options);
  if (options.length && !offers(options, text(value))) {
    return 'The selection "' + value + '" is not one of the options';
  }
  return refusal((config && config.argType) || "i", value);
}

module.exports = { dropdown, parseOptions };

},{"../osc-args":6,"./fields":17,"./incoming":18,"./outgoing":23,"./shared":25,"./typed":28}],17:[function(require,module,exports){
"use strict";

/**
 * The vocabulary a widget uses to describe its settings panel.
 *
 * A widget lists fields; something else turns them into whatever the editor of
 * the day uses for its inspector. Nothing here knows what that editor is, so a
 * widget definition outlives the choice of one.
 *
 * Field shape:
 *   { key, label, type, options?, min?, max?, step?, placeholder?, showIf?, section?, hint? }
 *   type: "text" | "number" | "select" | "checkbox"
 *   showIf: { key, in: [...] } -- the field is only shown while the setting
 *           named by `key` holds one of the listed values. Data rather than a
 *           function, so an adapter can see which setting to watch instead of
 *           being handed a closure it cannot look inside.
 *   hint: a sentence for whoever hovers over the setting, for the few whose
 *           label cannot say enough in the width a panel gives it.
 *   section: "osc" | "dmx" -- the protocol the setting belongs to. The panel
 *           draws one collapsible section per protocol; a field with none sits
 *           above them, with the settings that are about the widget itself.
 */

const { toNumber } = require("../osc-args");
const { isPort } = require("../ports");
const { SERIAL_HOST, isSerialTarget } = require("../serial-target");
const { SLOTS, PROTOCOL_OPTIONS, protocol, readHost } = require("../dmx/spec");
const { toWhole } = require("../dmx/levels");

const TYPES = ["text", "number", "select", "checkbox"];

/**
 * The protocols a widget can speak, in the order the panel shows them. One
 * section each, and each section that can be switched off carries its own
 * checkbox -- so which protocols a widget uses is read off the panel at a
 * glance, and adding a protocol later is adding a section, not another
 * entry in a list of combinations.
 */
const SECTIONS = [
  { id: "osc", label: "OSC" },
  { id: "dmx", label: "DMX" },
];

function field(key, label, type, extra) {
  const spec = Object.assign({ key: key, label: label, type: type }, extra || {});
  if (TYPES.indexOf(spec.type) === -1) {
    throw new Error("unknown field type: " + spec.type);
  }
  const rule = spec.showIf;
  if (rule !== undefined && (!rule || typeof rule.key !== "string" || !Array.isArray(rule.in))) {
    throw new Error(key + ": showIf must be { key, in: [...] }");
  }
  if (spec.section !== undefined && !SECTIONS.some((section) => section.id === spec.section)) {
    throw new Error(key + ": unknown section " + JSON.stringify(spec.section));
  }
  return spec;
}

/**
 * The master switch, and the first field on every widget.
 *
 * It reads as what it is: a widget can be laid out, positioned and styled
 * while silent -- and deaf, so Listen does not move it either -- which is how
 * you build a surface without firing cues at a rig that is mid-show. It sits
 * above even the label, because whether a control is live matters more than
 * what it is called.
 */
function enabled() {
  // "Enabled" alone read as a third copy of the Enable box each protocol
  // section has. This one is over both of them, and over Listen as well.
  return field("enabled", "Master comms", "checkbox", { hint: MASTER_HINT });
}

const MASTER_HINT =
  "Master switch for this widget's communication. Off: it sends nothing on any protocol and " +
  "ignores incoming messages, whatever the sections below say, and a DMX fixture holds its last level. " +
  "Use it to lay out and try a control without firing cues at the rig.";

/**
 * Which directions of each protocol section are live on a widget, for the
 * lights the panel draws on the section's title so it can be read collapsed.
 *
 *   { osc: { in: true, out: false }, dmx: { out: true } }
 *
 * A direction the widget does not have is absent: a meter has no `out`, DMX
 * never has an `in`, and a section the widget lacks is not there at all.
 * Live means it would really happen: the direction's own checkbox AND the
 * master switch. A green light over a widget the master has silenced would
 * be a lie, and it is the collapsed section that gets trusted at a glance.
 */
function sectionStatus(fields, config) {
  const has = (key) => (fields || []).some((spec) => spec.key === key);
  const master = !!(config && config.enabled);
  const status = {};

  const osc = {};
  if (has("listen")) osc.in = master && isOn(config && config.listen);
  // Ip is what makes a widget a sender; one without it only follows.
  if (has("ip")) osc.out = master && sendsOsc(config);
  if (Object.keys(osc).length) status.osc = osc;

  if (has("dmxEnabled")) status.dmx = { out: master && sendsDmx(config) };
  return status;
}

/**
 * Where a widget sends. Every widget carries these, in this order, so a button
 * and a pad feel like the same instrument when you click between them.
 *
 * Ip also takes the word `serial`: the board on the USB cable, which has no
 * address (lib/serial-target.js says why it lives here). Port is then unused.
 */
function connection() {
  return [
    field("ip", "Ip", "text", { section: "osc", placeholder: "localhost, an IP, or " + SERIAL_HOST }),
    field("port", "Port", "number", { section: "osc", min: 1, max: 65535 }),
    field("message", "Message", "text", { section: "osc", placeholder: "/address" }),
  ];
}

/**
 * Which way a bar-shaped widget runs. Shared vocabulary rather than one
 * widget's property: the slider and the meter both offer it, a project file
 * stores the id, and neither definition should have to load the other to
 * spell it the same way.
 */
const ORIENTATIONS = [
  { id: "horizontal", name: "Horizontal" },
  { id: "vertical", name: "Vertical" },
];

/**
 * Data in: follow the rig, by reflecting OSC that arrives at the widget's own
 * Message address. (The setting is stored as `listen`, its first name.)
 *
 * Off by default on a widget that also sends. A surface must not start moving
 * on its own the moment it is opened, and a control built before this existed
 * must behave exactly as it always did.
 */
function listen() {
  return field("listen", "Data in", "checkbox", { section: "osc", hint: DATA_IN_HINT });
}

const DATA_IN_HINT =
  "Follow the rig: an OSC message arriving at this widget's Message address moves it. " +
  "What comes in is never sent back out.";

const DATA_OUT_HINT = "Send this widget's value over this protocol when it is used.";

/**
 * The OSC section of a panel, in the one order every widget shares.
 *
 * OSC runs both ways, so the section opens with a checkbox per direction --
 * Data in where the widget can follow the rig, Data out where it sends --
 * and then says where: Ip and Port for a widget that sends, Message for both,
 * since it is the address sent to and the address followed.
 *
 * Built here rather than listed by each widget so the directions lead every
 * OSC section the same way, and a widget cannot offer a direction it has not
 * got: `sends` and `receives` are the definition's own flags.
 *
 * The stored keys are `listen` (in) and `oscEnabled` (out). They keep those
 * names because projects already hold them; the panel calls them what they do.
 */
function oscFields(options) {
  const sends = !options || options.sends !== false;
  const receives = !options || options.receives !== false;
  const fields = [];
  if (receives) fields.push(listen());
  if (sends) fields.push(oscToggle());
  if (sends) return fields.concat(connection());
  return fields.concat([field("message", "Message", "text", { section: "osc", placeholder: "/address" })]);
}

/**
 * Where a widget's value goes.
 *
 * OSC reaches software; DMX reaches fixtures. Each is switched on by the
 * checkbox at the top of its own section, so one fader can ride a media
 * server's opacity and a house dimmer together, and "which protocols does
 * this use" is answered by looking at the panel. OSC is on and DMX off by
 * default, so every project made before DMX existed behaves as it did. Both
 * off is allowed and silent.
 *
 * Every widget that sends carries OSC's Data out, not only those that can
 * also drive DMX: the master switch stops both directions, so this is the
 * only way to keep a control following the rig while it sends nothing.
 *
 * The labels say the direction and leave the protocol to the section's
 * title; a label that repeats it wraps onto a second line in the narrow
 * panel. For the same reason the DMX fields are Protocol, Node and so on, not
 * "DMX protocol"; the complaints a check raises still name DMX in full,
 * because a message is read away from the section it is about.
 */
function oscToggle() {
  return field("oscEnabled", "Data out", "checkbox", { section: "osc", hint: DATA_OUT_HINT });
}

// DMX only runs one way, from the desk to the fixture, so its section has the
// one direction. Named as OSC's is, so the two sections read alike.
function dmxToggle() {
  return field("dmxEnabled", "Data out", "checkbox", { section: "dmx", hint: DATA_OUT_HINT });
}

/** A checkbox as it may be stored: the boolean, or its text in a file edited by hand. */
function isOn(value) {
  return value === true || value === "true";
}

/**
 * Projects saved while the choice was one Output setting (osc, dmx or both)
 * still say it that way. Where that word is present it is what the person
 * chose, so it is read in preference to the checkboxes, which on such a
 * widget only hold their defaults. upgradeRouting() turns it into the
 * checkboxes; the editor does so as it opens each widget.
 */
const LEGACY_DMX = ["dmx", "both"];
const LEGACY_OSC = ["osc", "both"];

function legacyTransport(config) {
  const transport = config && config.transport;
  return typeof transport === "string" && transport ? transport : null;
}

/** Whether these settings put DMX on the wire. */
function sendsDmx(config) {
  const legacy = legacyTransport(config);
  if (legacy) return LEGACY_DMX.indexOf(legacy) !== -1;
  return isOn(config && config.dmxEnabled);
}

/** Whether these settings put OSC on the wire. No word either way means it does. */
function sendsOsc(config) {
  const legacy = legacyTransport(config);
  if (legacy) return LEGACY_OSC.indexOf(legacy) !== -1;
  const flag = config && config.oscEnabled;
  return flag === undefined || flag === null ? true : isOn(flag);
}

/**
 * The two checkboxes an old Output setting stands for, or null when the
 * settings carry no such word and there is nothing to upgrade.
 */
function upgradeRouting(config) {
  const legacy = legacyTransport(config);
  if (!legacy) return null;
  return { oscEnabled: LEGACY_OSC.indexOf(legacy) !== -1, dmxEnabled: LEGACY_DMX.indexOf(legacy) !== -1 };
}

/**
 * The DMX half of a widget's settings, for a widget with dmx: true.
 *
 * Its own section, led by the checkbox that switches it on. Nothing in it is
 * hidden while it is off: a channel can be set up before the fixture is live.
 * Where OSC needs an address and a port, DMX
 * needs a protocol, a node, a universe and a block of channels: the first
 * channel, and how many from there. A widget's values fill the block in
 * order and the last repeats, so a slider over three channels dims an RGB
 * fixture as a whole and a pad over two lands on pan and tilt.
 */
function dmxFields() {
  const only = { section: "dmx" };
  return [
    dmxToggle(),
    field("dmxProtocol", "Protocol", "select", Object.assign({ options: PROTOCOL_OPTIONS }, only)),
    field("dmxHost", "Node", "text", Object.assign({ placeholder: "broadcast" }, only)),
    field("dmxUniverse", "Universe", "number", Object.assign({ min: 0, max: 63999 }, only)),
    field("dmxChannel", "Channel", "number", Object.assign({ min: 1, max: SLOTS }, only)),
    field("dmxCount", "Channels", "number", Object.assign({ min: 1, max: SLOTS }, only)),
  ];
}

/**
 * The defaults that go with oscToggle() and dmxFields().
 *
 * Universe 1 rather than 0: it is the one first universe both protocols
 * accept, so switching protocol never silently stops the output. `values` is
 * how many channels the widget naturally drives -- one for a fader, two for
 * a pad, three for a colour -- and is the smallest block it can be given.
 */
function dmxDefaults(values) {
  return {
    oscEnabled: true,
    dmxEnabled: false,
    dmxProtocol: "artnet",
    dmxHost: "",
    dmxUniverse: 1,
    dmxChannel: 1,
    dmxCount: values || 1,
  };
}

function universeRange(config) {
  return protocol(config && config.dmxProtocol) || protocol("artnet");
}

function checkDmxUniverse(value, config) {
  const spec = universeRange(config);
  if (toWhole(value, spec.minUniverse, spec.maxUniverse) !== null) return null;
  return "A " + spec.name + " universe is a whole number between " + spec.minUniverse + " and " + spec.maxUniverse;
}

// Switching protocol under a universe the new one cannot address would leave
// the widget silently unsendable; the universe check does not re-run on its own.
function checkDmxProtocol(value, config) {
  const spec = protocol(value);
  if (!spec) return "Unknown DMX protocol: " + value;
  const universe = toWhole(config && config.dmxUniverse, spec.minUniverse, spec.maxUniverse);
  if (universe !== null) return null;
  return spec.name + " cannot address universe " + (config && config.dmxUniverse) + "; change the universe first";
}

function checkDmxChannel(value, config) {
  const channel = toWhole(value, 1, SLOTS);
  if (channel === null) return "A DMX channel is a whole number between 1 and " + SLOTS;
  const count = toWhole(config && config.dmxCount, 1, SLOTS);
  if (count !== null && channel + count - 1 > SLOTS) {
    return "Channel " + channel + " plus " + count + " channels runs past the end of the universe";
  }
  return null;
}

/**
 * @param {number} values the widget's own value count; a narrower block would
 *                        drop a coordinate, and half a position is no position
 */
function checkDmxCount(values) {
  const least = values || 1;
  return function (value, config) {
    const count = toWhole(value, least, SLOTS);
    if (count === null) return "This widget needs between " + least + " and " + SLOTS + " DMX channels";
    const channel = toWhole(config && config.dmxChannel, 1, SLOTS);
    // Sending the part that fits would leave half a fixture answering, which
    // reads as a broken light rather than a wrong setting.
    if (channel !== null && channel + count - 1 > SLOTS) {
      return "Channel " + channel + " plus " + count + " channels runs past the end of the universe";
    }
    return null;
  };
}

const IPV4 =
  /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/;

// The wire refuses a node the server could not send to, but its only word of
// that is a line in a console the packaged app never shows; the widget looks
// alive and drives nothing. So the panel refuses it first. A value made of
// digits and dots is an IPv4 literal that has to be one: "192.168.1.300" is
// not a hostname either.
function checkDmxHost(value) {
  const host = readHost(value == null ? "" : String(value));
  if (host !== null && (!/^[0-9.]+$/.test(host) || IPV4.test(host))) return null;
  return "A DMX node is an IP address or a host name, or blank to reach every node: " + value;
}

/** The validators that go with dmxFields(); `values` as for dmxDefaults(). */
function dmxChecks(values) {
  return {
    dmxProtocol: checkDmxProtocol,
    dmxHost: checkDmxHost,
    dmxUniverse: checkDmxUniverse,
    dmxChannel: checkDmxChannel,
    dmxCount: checkDmxCount(values),
  };
}

/**
 * Validators return a complaint, or null when the value is fine.
 *
 * They run when someone edits a field, so a value that cannot be sent is
 * caught while there is still a human looking at it. The send path refuses bad
 * values too -- these two guards cover different moments, not the same one
 * twice: a project file can be edited by hand, and a field can be left mid-edit.
 */
function checkIp(value, config) {
  if (isSerialTarget(value)) return null;
  if (value !== "localhost" && !IPV4.test(String(value))) {
    return "That isn't an IP address, localhost, or " + SERIAL_HOST + ": " + value;
  }
  // A widget on the cable may have had its Port cleared, which is fine there
  // and unsendable here. The port check does not re-run on its own, and the
  // server's refusal is a console line the packaged app never shows.
  if (config && "port" in config && !isPort(config.port)) {
    return "Give this widget a Port before pointing it at the network";
  }
  return null;
}

// The cable has no ports, so a widget aimed at it may leave Port empty.
// Empty only: anything else typed there is stored in the project, and comes
// back as a port the server refuses the day Ip is pointed at the network.
function checkPort(value, config) {
  if (isPort(value)) return null;
  if (config && isSerialTarget(config.ip)) {
    const blank = value === undefined || value === null || (typeof value === "string" && value.trim() === "");
    return blank ? null : "Leave the Port empty for serial, or give a whole number between 1 and 65535";
  }
  return "The port has to be a whole number between 1 and 65535";
}

function checkMessage(value) {
  const address = String(value == null ? "" : value);
  if (address.length > 1 && address.charAt(0) === "/") return null;
  return "An OSC message is a path, like /master/level";
}

// The same parser the wire uses, so a value the panel accepts is one the
// send path will not drop -- and a stray space is refused in both places.
function checkNumber(label) {
  return function (value) {
    if (toNumber(value) !== null) return null;
    return label + " has to be a number";
  };
}

/** The validators that go with connection(). */
function connectionChecks() {
  return { ip: checkIp, port: checkPort, message: checkMessage };
}

module.exports = {
  field: field,
  enabled: enabled,
  listen: listen,
  oscFields: oscFields,
  connection: connection,
  connectionChecks: connectionChecks,
  SECTIONS: SECTIONS,
  sectionStatus: sectionStatus,
  oscToggle: oscToggle,
  dmxToggle: dmxToggle,
  upgradeRouting: upgradeRouting,
  ORIENTATIONS: ORIENTATIONS,
  sendsDmx: sendsDmx,
  sendsOsc: sendsOsc,
  dmxFields: dmxFields,
  dmxDefaults: dmxDefaults,
  dmxChecks: dmxChecks,
  checkIp: checkIp,
  checkPort: checkPort,
  checkMessage: checkMessage,
  checkNumber: checkNumber,
  IPV4: IPV4,
};

},{"../dmx/levels":1,"../dmx/spec":2,"../osc-args":6,"../ports":7,"../serial-target":11}],18:[function(require,module,exports){
"use strict";

const { matchesAddress } = require("../osc-address");

/**
 * Deciding whether an incoming OSC message is this widget's business.
 *
 * The mirror of outgoing(): every widget that follows the rig funnels through
 * here, so the Listen switch cannot be implemented three slightly different
 * ways, and a widget that was never asked to listen can never be moved from
 * the network.
 *
 * What this module does *not* do matters as much as what it does. It hands a
 * widget values and nothing else -- never a message to send, and never the
 * context to send one with. A value that arrived from outside and went straight
 * back out is a loop between OSCAR and any software that echoes its own state,
 * and the only way to be sure no widget closes that loop is to give the
 * receive path nothing to close it with. The host enforces the same thing from
 * its side: ctx.send() is refused while an incoming message is being
 * delivered (see the ctx contract in index.js).
 */

/**
 * The values an incoming message carries for a widget, or null.
 *
 * Enabled is the master switch, and a widget that is off is deaf as well as
 * silent: a surface is switched off to be laid out while the rig is live, and
 * a thumb that keeps jumping under the pointer is not laid out.
 *
 * `config.message` is the widget's own address, or a list of them for a widget
 * that answers to several (an XY pad in two-message mode). It is always taken
 * literally; the incoming address is the pattern (lib/osc-address.js). An
 * address also always reaches itself: some software exposes addresses like
 * /layer[1]/opacity and echoes them verbatim, and read as a pattern that
 * string would never match its own widget.
 *
 * @returns {{address: string, values: Array}|null}  `address` is the widget's
 *   own address that matched, so a widget with several knows which one.
 */
function incoming(config, message) {
  if (!config || !config.enabled || !config.listen) return null;
  if (!message || typeof message.address !== "string" || !Array.isArray(message.args)) return null;

  const addresses = Array.isArray(config.message) ? config.message : [config.message];
  for (const address of addresses) {
    if (message.address === address || matchesAddress(message.address, address)) {
      return { address: address, values: message.args.slice() };
    }
  }
  return null;
}

/**
 * Follow the messages a widget's own address attracts.
 *
 * This is the whole of what a widget writes to receive: it applies the
 * values to its element and stores them with ctx.set, and that is all.
 *
 *   const stopOsc = follow(ctx, function (values, address) { ... });
 *   ... in detach:  if (stopOsc) stopOsc();
 *
 * Enabled, Listen and Message are read afresh for every message, because all
 * three can be edited while the widget is live. `addresses`, if given, is a
 * function returning the address or addresses to follow instead of Message.
 *
 * @returns an unsubscribe function, or null where the host cannot receive.
 */
function follow(ctx, fn, addresses) {
  if (typeof ctx.onOsc !== "function") return null;
  return ctx.onOsc(function (message) {
    const wanted = addresses ? addresses() : ctx.get("message");
    const config = { enabled: ctx.get("enabled"), listen: ctx.get("listen"), message: wanted };
    const match = incoming(config, message);
    if (match) fn(match.values, match.address);
  });
}

module.exports = { incoming, follow };

},{"../osc-address":5}],19:[function(require,module,exports){
"use strict";

/**
 * OSCAR's widgets, described independently of any editor.
 *
 * A widget says what it is (tag, attributes, block icon), what can be
 * configured on it (fields and their validators), and how it behaves when a
 * finger lands on it (attach, in plain DOM). Nothing here imports GrapesJS or
 * touches the editor, so replacing the editor means writing one adapter --
 * public/src/adapters/grapesjs.js is the current one -- and not rewriting a
 * single widget.
 *
 * Adding a widget: one file in this folder exporting the definition, and one
 * line in registry.js. The editor and the preview register everything in
 * WIDGETS; there is nothing to wire by hand.
 *
 * A definition:
 *   name          "oscar-<something>", unique; also the component type
 *   tag           the element it renders as
 *   attributes    attributes on that element (optional); with a shared tag,
 *                 `type` or `class` here is what tells the widget from a
 *                 plain element when a project is parsed
 *   text          the setting rendered as the element's text content (optional)
 *   ownsChildren  true for a widget that builds the elements inside itself
 *                 from its settings on every attach -- the tiles of a grid,
 *                 the rows of a list (optional). Those elements are the
 *                 widget's business and nobody else's: a host must not store
 *                 them in the project, read them back out of parsed markup,
 *                 or offer them to the designer as things to select, move or
 *                 delete. The settings stay the one source of truth. Cannot
 *                 be combined with `text`, which is the host filling the
 *                 element instead.
 *   embed(config, read) -> changed settings | null   (optional) for a widget
 *                 whose settings name image files: called at export, where
 *                 read(path) gives a data: URI for a file that can travel
 *                 inside the page, or null
 *   block         { label, category, icon } for the palette
 *   defaults      every setting and its starting value
 *   fields        the settings panel, in order; see fields.js
 *   checks        { key: (value, config) => complaint | null } validators
 *   attach(el, ctx) -> detach()   the behaviour, in plain DOM
 *
 * Capability flags, so tests and later features can tell the widgets apart
 * without guessing from their fields. All three are explicit booleans:
 *   sends     it puts OSC on the wire when used, so it has ip, port, message
 *             and argType settings. A display-only widget sets false.
 *   receives  it reacts to OSC arriving from the network (a meter, or a fader
 *             that follows the rig). It then has a `listen` field (listen()
 *             from fields.js, placed right after Message) and a `message`
 *             field naming the address it follows, and subscribes through
 *             follow() from incoming.js. On a widget that also sends, listen
 *             defaults to false: a surface must not start moving on its own.
 *   dmx       its values are numbers that a DMX channel could carry, so it
 *             offers DMX as well as OSC. Each protocol is a section of the
 *             panel led by its own checkbox: oscToggle() from fields.js
 *             (OSC's Enable, on by default so every older project behaves as it
 *             did) ahead of connection(), and the DMX fields (dmxFields(),
 *             which opens with DMX's Enable, off by default; defaults from
 *             dmxDefaults(n) and checks from dmxChecks(n), n being how many
 *             channels the widget naturally drives). A widget with dmx: false
 *             carries neither checkbox: OSC's Enable on a widget that only speaks
 *             OSC would be a second Enabled. The widget scales its gesture to 0..1 with unitOf()
 *             from lib/dmx/levels.js and passes that as outgoing()'s third
 *             argument; outgoing() builds the DMX half. A widget that sends
 *             text, or sends nothing, sets false. Implies sends.
 *
 * The contract an adapter must provide as `ctx`:
 *   get(key)                 read a setting
 *   set(key, value)          store a value the widget computed; must not
 *                            re-validate or re-render, or a drag fights itself
 *   send(message | null)     put a message on the wire; null means stay silent.
 *                            The message is what outgoing() returned: an OSC
 *                            half { ip, port, address, args }, a DMX half
 *                            { dmx: { protocol, host, universe, channel,
 *                            levels } }, or both on one object; the host
 *                            sends whichever halves are present and stamps
 *                            the DMX half with the widget's identity. A widget
 *                            never releases DMX channels itself: the host
 *                            does that when the widget is deleted or its
 *                            DMX's Enable is unticked, and the server when OSCAR quits.
 *                            Refused while an incoming message is being
 *                            delivered to this widget (see onOsc).
 *   setClass(name, on)       reflect state visually
 *   onChange(keys, fn)       run fn when any of those settings is edited;
 *                            returns an unsubscribe function
 *   onRewrite(fn)            run fn after the host has rewritten the element's
 *                            attributes and classes. An editor re-applies its
 *                            own copy of them on every class or style edit,
 *                            wiping whatever attach wrote straight onto the
 *                            element -- an attribute, a class, an inline
 *                            property, a value -- so fn puts it back. Returns
 *                            an unsubscribe function. Optional in a host;
 *                            widgets check for it before calling it.
 *   onOsc(fn)                run fn({ address, args }) for every OSC message
 *                            the host receives, args as plain values (number,
 *                            string, boolean, or null for one OSCAR cannot
 *                            read). Returns an unsubscribe function. Optional
 *                            in a host: absent where nothing can be received,
 *                            so widgets go through follow() in incoming.js,
 *                            which checks for it and also applies Listen and
 *                            the address match. Parse every value with
 *                            toNumber() from osc-args.js -- an unreadable
 *                            value is ignored, never read as 0.
 *   share(state, how?)       tell every other device showing this surface
 *                            what this widget now shows: a small object of
 *                            numbers, booleans or short strings ({ on },
 *                            { value }, { x, y }). Called from the paths a
 *                            hand takes, next to send(), and once from the
 *                            OSC receive path with how = { heard: true }:
 *                            the record on the server then has what the rig
 *                            said, for a device joining later, and nobody
 *                            is told, because every device was sent the
 *                            same message. how = { release: state } says
 *                            what to show if this device goes away, for
 *                            state that lasts only while a finger is down.
 *                            Refused while a shared state is being
 *                            delivered (see onShared).
 *                            Optional in a host: absent where there is one
 *                            device and nothing to agree with, and in the
 *                            editor, which is not a device on the surface;
 *                            so widgets go through share() in shared.js,
 *                            which checks.
 *   onShared(fn)             run fn(state) when another device changes what
 *                            this widget shows, and, on a host that keeps
 *                            one, with the state already known when the
 *                            widget subscribes, so a device joining late
 *                            starts where the others are. `state` is the
 *                            widget's whole record, merged from everything
 *                            shared for it, so a key may be missing; read
 *                            each value as carefully as one from the rig.
 *                            Returns an unsubscribe function. Optional in a
 *                            host, so widgets go through onShared() in
 *                            shared.js. While fn runs the host refuses both
 *                            send() and share(): the device that acted
 *                            already sent, and a device that re-shared what
 *                            it was handed would hand it straight back.
 *
 * Sharing is not gated on Listen or on anything else: two tablets agreeing
 * on what a control shows is not something anyone should have to switch on.
 * The state is keyed by the widget's id in the project, so the same widget
 * finds itself on every device the layout was pushed to; a widget with no
 * hand on it takes what arrives the way it takes what the rig sends, and a
 * hand on it outranks the other devices as it outranks the rig -- but what
 * arrived under the hand is caught up with once it lifts, if the hand itself
 * said nothing later, because the other devices are only told once.
 *
 * Receiving never sends. A value that arrived from the network and went
 * straight back out is an endless loop with any software that echoes its own
 * state, so the receive path is built with no way to close one: follow()
 * hands a widget bare values, and the host refuses send() for as long as it
 * is delivering an incoming message. That refusal covers the delivery itself,
 * so a widget must not schedule a send from its receive path either -- not
 * on a frame, not on a timer; the shared test runs the frames a widget
 * scheduled while receiving and fails if anything went out. A widget applies
 * what it hears to its element and stores it with set(), and that is the
 * whole of its job. A hand on a control outranks the network: while a widget
 * is being dragged or held it ignores what arrives, and a drag that loses
 * the window (blur) counts as released. Enabled off makes a widget deaf as
 * well as silent; follow() checks it. A display-only widget (a meter) sets
 * sends: false, receives: true, and does nothing but follow().
 *
 * A widget must call the unsubscribe functions it was given from detach, or
 * every re-render stacks one more handler on the host.
 */

const registry = require("./registry");
const { outgoing } = require("./outgoing");

const FLAGS = ["sends", "receives", "dmx"];

/**
 * Refuse a definition that would fail later in some quieter way -- a missing
 * flag read as false, a duplicate name silently replacing another widget's
 * component type in the editor.
 */
function validate(definition) {
  const name = definition && definition.name;
  if (typeof name !== "string" || !/^oscar-[a-z0-9-]+$/.test(name)) {
    throw new Error("a widget's name must look like oscar-<something>, got " + JSON.stringify(name));
  }
  const problems = [];
  if (typeof definition.tag !== "string") problems.push("tag");
  const block = definition.block || {};
  for (const key of ["label", "category", "icon"]) {
    if (typeof block[key] !== "string" || !block[key]) problems.push("block." + key);
  }
  const defaults = definition.defaults;
  if (!defaults || typeof defaults !== "object") problems.push("defaults");
  // A text key with no default behind it renders an empty label and nothing
  // says why; catch the typo here, where the widget is named.
  if (definition.text !== undefined) {
    const known = defaults && Object.prototype.hasOwnProperty.call(defaults, definition.text);
    if (typeof definition.text !== "string" || !known) {
      problems.push("text (" + JSON.stringify(definition.text) + " is not a key of defaults)");
    }
  }
  // Read as a plain truthy value it would let "yes" through in one host and
  // not in another; and a widget cannot both fill its element itself and
  // have the host fill it with a label.
  if (definition.ownsChildren !== undefined) {
    if (typeof definition.ownsChildren !== "boolean") problems.push("ownsChildren (must be true or false)");
    else if (definition.ownsChildren && definition.text !== undefined) problems.push("ownsChildren together with text");
  }
  if (!Array.isArray(definition.fields)) problems.push("fields");
  if (typeof definition.attach !== "function") problems.push("attach");
  for (const flag of FLAGS) {
    if (typeof definition[flag] !== "boolean") problems.push(flag + " (must be true or false)");
  }
  if (definition.dmx && !definition.sends) problems.push("dmx without sends");

  // A receiver with no Listen switch would follow the rig from the moment it
  // is dropped; one with no Message has nothing to follow. And a Listen field
  // on a widget that says it does not receive is a switch wired to nothing.
  const keys = Array.isArray(definition.fields) ? definition.fields.map((f) => f && f.key) : [];
  if (definition.receives) {
    if (!keys.includes("listen")) problems.push("receives without a listen field (listen() in fields.js)");
    if (!keys.includes("message")) problems.push("receives without a message field");
    if (definition.sends && defaults && defaults.listen !== false) {
      problems.push("listen must default to false on a widget that sends");
    }
  } else if (keys.includes("listen")) {
    problems.push("a listen field on a widget with receives: false");
  }

  if (problems.length) {
    throw new Error(name + " is not a complete widget definition: " + problems.join(", "));
  }
  return definition;
}

const WIDGETS = registry.map(validate);

const byName = {};
for (const widget of WIDGETS) {
  if (byName[widget.name]) throw new Error("two widgets are called " + widget.name);
  byName[widget.name] = widget;
}

module.exports = { WIDGETS, byName, validate, FLAGS, outgoing };

},{"./outgoing":23,"./registry":24}],20:[function(require,module,exports){
"use strict";

const { field, enabled, oscFields, connectionChecks } = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { follow } = require("./incoming");
const { share, onShared } = require("./shared");
const { refusal, checkArgType } = require("./typed");
const { ARG_TYPES, toArgs, toNumber } = require("../osc-args");

const TILE_CLASS = "oscar-media-tile";
const THUMB_CLASS = "oscar-media-thumb";
const LABEL_CLASS = "oscar-media-label";

/** On the tile that is picked. Styled in public/assets/css/toggle.css. */
const SELECTED_CLASS = "oscar-media-selected";

/** The custom property the grid reads its column count from. */
const COLUMNS_PROPERTY = "--oscar-media-columns";

const MAX_COLUMNS = 12;

/**
 * What a tile can send: a clip index or a clip name, which is how Resolume,
 * Millumin and QLab address a cue. Bool and "no argument" carry no identity
 * -- every tile would send the same message, and the grid would be a row of
 * identical buttons wearing different pictures.
 */
const ITEM_ARG_TYPES = ARG_TYPES.filter(function (type) {
  return type.id === "i" || type.id === "f" || type.id === "s";
});

/**
 * Turn the designer's one line into tiles.
 *
 *   Forest; Waves; Stars                     each sends its position: 1, 2, 3
 *   Forest|7; Waves|12                       label|value
 *   Forest|7|thumbs/forest.jpg; Waves|12     label|value|imageUrl
 *
 * Semicolons, because every setting in the panel is a single-line control and
 * a newline can never be typed into one; newlines are accepted as well, so a
 * project file written by hand or by a script can read the way a list should.
 * The price is that a label cannot hold ";" or "|".
 *
 * An omitted value is the tile's 1-based position among the tiles, which is
 * how a clip grid is addressed; the common case is the one with least typing.
 *
 * A data: URL holds semicolons of its own ("data:image/png;base64,..."), so
 * an image that starts with data: is not finished until its comma, and the
 * pieces the split made of it are put back together. Only pieces that can be
 * part of one, though: a piece with a "|" in it is the next item, and a data:
 * URL whose comma never comes is a typing mistake. It keeps what it had and
 * the items after it stay tiles -- safeImageUrl refuses it, so the panel says
 * what is wrong instead of the rest of the grid quietly vanishing.
 *
 * An entry with neither label nor image is dropped: it would draw an empty
 * square that launches something when touched.
 */
function parseItems(raw) {
  const pieces = String(raw === null || raw === undefined ? "" : raw).split(/[;\r\n]/);
  const items = [];
  for (let i = 0; i < pieces.length; i++) {
    let piece = pieces[i];
    if (unfinishedDataUrl(piece)) {
      let joined = piece;
      let end = i;
      while (unfinishedDataUrl(joined) && end + 1 < pieces.length && pieces[end + 1].indexOf("|") === -1) {
        joined += ";" + pieces[++end];
      }
      if (!unfinishedDataUrl(joined)) {
        piece = joined;
        i = end;
      }
    }

    const parts = piece.split("|").map(function (part) {
      return part.trim();
    });
    const label = parts[0] || "";
    const image = parts.length > 2 ? parts.slice(2).join("|").trim() : "";
    if (!label && !image) continue;
    const value = parts.length > 1 && parts[1] !== "" ? parts[1] : String(items.length + 1);
    items.push({ label: label, value: value, image: image });
  }
  return items;
}

function unfinishedDataUrl(piece) {
  const image = piece.split("|").slice(2).join("|").trim();
  return /^data:/i.test(image) && image.indexOf(",") === -1;
}

/**
 * The URL as it may be given to an <img>, or "" for one that may not.
 *
 * The URL is typed by a person, or arrives in a project someone else made,
 * and the surface runs on the machine that drives the rig. So this is an
 * allowlist and not a list of known-bad schemes: no scheme at all (a path
 * next to the page), http, https, or an image held in a data: URL. That
 * refuses javascript:, vbscript:, data:text/html and whatever scheme comes
 * next. Browsers skip tabs, newlines and other control characters when they
 * read a scheme, so "java\tscript:" is judged with them taken out.
 *
 * A data: URL with no comma has no image in it. It is refused so that the
 * panel names it; see parseItems for how one comes about.
 */
function safeImageUrl(raw) {
  const url = String(raw === null || raw === undefined ? "" : raw).trim();
  if (!url) return "";
  const bare = url.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(bare);
  if (!scheme) return url;
  const name = scheme[1].toLowerCase();
  if (name === "http" || name === "https") return url;
  if (name === "data" && /^data:image\//i.test(bare) && bare.indexOf(",") !== -1) return url;
  return "";
}

/**
 * What a tile's value is once it is on the wire, as a key, or null for a
 * value the type cannot carry.
 *
 * Not the text the designer typed: "07" and "7" are one int, "1.4" and "1"
 * are one int because ints are rounded, and "1.0" and "1" are one float. The
 * rig only ever sees, and only ever echoes, the wire value.
 */
function wireKey(argType, value) {
  const args = toArgs(argType, value);
  if (!args || !args.length) return null;
  return args[0].type + ":" + String(args[0].value);
}

/** The number a tile puts on the wire, or null for a string or an unsendable one. */
function wireNumber(argType, value) {
  const args = toArgs(argType, value);
  if (!args || !args.length || typeof args[0].value !== "number") return null;
  return args[0].value;
}

/**
 * OSC media browser: a grid of thumbnails, and one tap picks one.
 *
 * The need it answers is an operator with a tablet choosing what plays in a
 * room -- browsing pictures, not remembering that the forest loop is clip 7.
 * A pick sends the tile's value to Message, which is the message a clip
 * launcher already listens for.
 *
 * It is a chooser and not a media library: it shows images the designer
 * points it at. It does not upload, store or play anything.
 *
 * A tile is picked on click and not on pointerdown, because the grid scrolls:
 * a finger that lands on a tile to push the list along must not launch
 * whatever it landed on, and a browser only raises click for a touch that
 * did not turn into a scroll. Picking the tile that is already picked sends
 * again -- relaunching a clip is a real instruction, not a repeat to swallow.
 *
 * With Listen on, a value arriving at Message moves the highlight to the tile
 * that sends it, and nothing goes out. A value no tile sends changes
 * nothing: the address may carry more than this grid knows about. The same
 * browser on another device is followed the same way, Listen or not:
 * { value }, the picked tile's value as text.
 *
 * The highlight is not a setting and is never saved: what is playing is the
 * rig's to say, and a project that reopened claiming clip 3 would be
 * guessing. A device that joins late is told by the others.
 */
const mediaBrowser = {
  name: "oscar-media-browser",
  tag: "div",
  attributes: { class: "oscar-media-browser" },
  // The tiles are built here from Items, never stored: see ownsChildren in
  // the adapter.
  ownsChildren: true,

  sends: true,
  receives: true,
  dmx: false,

  block: {
    label: "Media Browser",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M3,3H11V11H3V3M13,3H21V11H13V3M3,13H11V21H3V13M13,13H21V21H13V13M15,15V19H19V15H15Z"/></svg>',
  },

  defaults: {
    enabled: true,
    oscEnabled: true,
    ip: "localhost",
    port: 7000,
    message: "/clip",
    listen: false,
    items: "Clip 1; Clip 2; Clip 3; Clip 4; Clip 5; Clip 6",
    columns: 3,
    showLabels: true,
    argType: "i",
  },

  fields: [enabled()]
    .concat(oscFields())
    .concat([
    field("items", "Items", "text", { placeholder: "Forest|7|thumbs/forest.jpg; Waves|12" }),
    field("columns", "Columns", "number", { min: 1, max: MAX_COLUMNS, step: 1 }),
    field("showLabels", "Show labels", "checkbox"),
    field("argType", "Argument type", "select", { section: "osc", options: ITEM_ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
    items: checkItems,
    columns: checkColumns,
    argType: checkArgType(function (config) {
      return parseItems(config.items).map(function (item) {
        return item.value;
      });
    }),
  }),

  /**
   * Export: a thumbnail given as a path is a file next to OSCAR, and an
   * exported page leaves OSCAR behind. `read` hands back a data: URI for a
   * path it can embed, and the items line is rewritten around those. Returns
   * the settings that changed, or null when none did.
   */
  embed: function (config, read) {
    let embedded = false;
    const line = parseItems(config.items)
      .map(function (item) {
        const uri = item.image && safeImageUrl(item.image) ? read(item.image) : null;
        if (uri) embedded = true;
        const image = uri || item.image;
        return item.label + "|" + item.value + (image ? "|" + image : "");
      })
      .join("; ");
    return embedded ? { items: line } : null;
  },

  attach: function (el, ctx) {
    // The element's own document: the canvas is an iframe, and a node made
    // by the outer page belongs to the wrong tree. A host with no document
    // gets no tiles and a widget that still attaches and detaches.
    const doc = el.ownerDocument || null;

    /** Every tile on the element, as { node, item }; nothing else is ever touched. */
    let tiles = [];
    /** The picked tile's value, or null while nothing is picked. */
    let selected = null;

    function paint() {
      el.style.setProperty(COLUMNS_PROPERTY, String(columnsOf(ctx.get("columns"))));
      for (const tile of tiles) {
        const on = tile.item.value === selected;
        if (on) tile.node.classList.add(SELECTED_CLASS);
        else tile.node.classList.remove(SELECTED_CLASS);
        tile.node.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }

    function clear() {
      for (const tile of tiles) {
        tile.node.removeEventListener("click", tile.onClick);
        if (tile.node.parentNode === el) el.removeChild(tile.node);
      }
      tiles = [];
    }

    /**
     * Build the tiles from Items.
     *
     * With createElement, textContent and setAttribute, and never as a
     * string of markup: a label or a URL is typed by a person, or comes in a
     * project somebody else made, and markup assembled from it is a way to
     * run script on the machine that drives the rig.
     */
    function build() {
      clear();
      if (doc && typeof doc.createElement === "function") {
        const showLabels = ctx.get("showLabels") !== false;
        tiles = parseItems(ctx.get("items")).map(function (item) {
          return makeTile(item, showLabels);
        });
        for (const tile of tiles) el.appendChild(tile.node);
      }
      // A highlight on a value the new list does not offer is on nothing.
      if (selected !== null && !find(selected)) selected = null;
      paint();
    }

    function makeTile(item, showLabels) {
      const node = doc.createElement("button");
      // Inside a form, a bare button submits and reloads the surface mid-show.
      node.setAttribute("type", "button");
      node.setAttribute("class", TILE_CLASS);
      node.setAttribute("title", item.label || item.value);

      const url = safeImageUrl(item.image);
      let label = null;
      function addLabel() {
        if (label) return;
        label = doc.createElement("span");
        label.setAttribute("class", LABEL_CLASS);
        label.textContent = item.label || item.value;
        node.appendChild(label);
      }

      if (url) {
        const img = doc.createElement("img");
        img.setAttribute("class", THUMB_CLASS);
        img.setAttribute("alt", item.label);
        // A browser drags an image by default. In the editor that drag can be
        // dropped on the canvas as a new component, which is the tile leaving
        // the widget; on a tablet it is a ghost image under a scrolling finger.
        img.setAttribute("draggable", "false");
        // A thumbnail that did not load must not leave a blank tile nobody
        // can tell from its neighbour: the name takes its place.
        img.addEventListener("error", function () {
          if (img.parentNode === node) node.removeChild(img);
          addLabel();
        });
        img.setAttribute("src", url);
        node.appendChild(img);
      }
      // Labels can be switched off for a wall of pictures, but a tile with no
      // picture keeps its name, or it is a blank square.
      if (showLabels || !url) addLabel();

      const tile = {
        node: node,
        item: item,
        onClick: function () {
          pick(item);
        },
      };
      node.addEventListener("click", tile.onClick);
      return tile;
    }

    function find(value) {
      for (const tile of tiles) if (tile.item.value === value) return tile;
      return null;
    }

    /**
     * The tile a value from outside means. As text first, so the 3 an int
     * tile comes back as finds "Forest|3"; then as numbers, so a float rig
     * answering 3.0 to a tile written "3.00" still finds it. toNumber gives
     * null for anything unreadable, and null matches nothing -- a blank or a
     * word is never read as tile 0.
     */
    function match(value) {
      if (value === null || value === undefined || typeof value === "object" || typeof value === "boolean") return null;
      const text = String(value).trim();
      const exact = find(text);
      if (exact) return exact;
      const number = toNumber(value);
      if (number === null) return null;
      for (const tile of tiles) if (toNumber(tile.item.value) === number) return tile;
      // Last, against what the tile really sends: an int tile written "1.4"
      // sends 1, and the rig answering 1 means that tile.
      const argType = ctx.get("argType");
      for (const tile of tiles) if (wireNumber(argType, tile.item.value) === number) return tile;
      return null;
    }

    /** A hand picked this tile: the one path that sends. */
    function pick(item) {
      // A disabled browser is being laid out, and a highlight that moved
      // while nothing went out would show a clip that is not playing.
      if (!ctx.get("enabled")) return;
      // The same goes for a value the argument type cannot carry (the panel
      // refuses one; a project edited by hand can hold one). Nothing goes
      // out, so nothing is highlighted, here or on any other device.
      const message = outgoing(routing(ctx), item.value);
      if (!message) return;
      selected = item.value;
      paint();
      ctx.send(message);
      share(ctx, { value: item.value });
    }

    /** Show a pick made elsewhere. Through paint(), never pick(). */
    function take(value) {
      const tile = match(value);
      if (!tile) return false;
      selected = tile.item.value;
      paint();
      return true;
    }

    /** The rig said what is playing; every device heard it, so it is only recorded. */
    function adopt(values) {
      if (take(values[0])) share(ctx, { value: selected }, { heard: true });
    }

    /** Another device picked. Never shared again: it came from there. */
    function adoptShared(state) {
      if (state) take(state.value);
    }

    build();

    const stop = ctx.onChange(["items", "showLabels"], build);
    const stopColumns = ctx.onChange(["columns"], paint);
    // The column count sits on the element as an inline property, which the
    // host wipes whenever it rewrites the element.
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(paint) : null;
    const stopOsc = follow(ctx, adopt);
    const stopShared = onShared(ctx, adoptShared);

    return function detach() {
      clear();
      if (stop) stop();
      if (stopColumns) stopColumns();
      if (stopRewrite) stopRewrite();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

/**
 * How many columns to draw. Anything unreadable falls back to the default
 * and is never read as 0: a grid of no columns is a widget that vanished.
 */
function columnsOf(value) {
  const number = toNumber(value);
  if (number === null) return mediaBrowser.defaults.columns;
  return Math.min(MAX_COLUMNS, Math.max(1, Math.round(number)));
}

/**
 * Every tile has to be sendable, and there has to be one.
 *
 * Two tiles may not send the same value: the value is all that comes back
 * from the rig or from another tablet, so the highlight could not tell them
 * apart. "The same" is judged on the wire, not as typed -- see wireKey. And an image URL that will be refused is said here, where the
 * designer typed it, not left as a tile that mysteriously has no picture.
 */
function checkItems(raw, config) {
  const items = parseItems(raw);
  if (!items.length) return "List the items like: Forest|7|thumbs/forest.jpg; Waves|12";
  const argType = (config && config.argType) || "i";
  const seen = {};
  for (const item of items) {
    const complaint = refusal(argType, item.value);
    if (complaint) return complaint;
    const key = wireKey(argType, item.value);
    if (seen[key]) return 'Two items send "' + seen[key].sent + '"; each item needs its own value';
    seen[key] = { sent: String(toArgs(argType, item.value)[0].value) };
    if (item.image && !safeImageUrl(item.image)) {
      return 'The image for "' + (item.label || item.value) + '" has to be a path, an http(s) address or a data:image URL';
    }
  }
  return null;
}

function checkColumns(value) {
  const number = toNumber(value);
  if (number === null || number !== Math.round(number) || number < 1 || number > MAX_COLUMNS) {
    return "Columns has to be a whole number from 1 to " + MAX_COLUMNS;
  }
  return null;
}

module.exports = {
  mediaBrowser,
  parseItems,
  safeImageUrl,
  ITEM_ARG_TYPES,
  TILE_CLASS,
  SELECTED_CLASS,
  COLUMNS_PROPERTY,
};

},{"../osc-args":6,"./fields":17,"./incoming":18,"./outgoing":23,"./shared":25,"./typed":28}],21:[function(require,module,exports){
"use strict";

const { field, enabled, oscFields, checkMessage, checkNumber, ORIENTATIONS } = require("./fields");
const { follow } = require("./incoming");
const { toNumber } = require("../osc-args");
const { unitOf } = require("../dmx/levels");

/** The longest delay setTimeout can hold. */
const MAX_DELAY = 2147483647;

/** On the element while a peak marker is showing. Styled in public/assets/css/toggle.css. */
const PEAK_CLASS = "oscar-peak";

function pct(unit) {
  return (unit * 100).toFixed(2) + "%";
}

/**
 * OSC meter: a level display, not a control.
 *
 * Every other widget points outward -- a finger lands on it and a message
 * leaves. This one points inward: it shows a number that arrived from the
 * rig, so an operator can watch an audio level, a fixture's intensity or a
 * playhead without reading it off another screen. It sends nothing, ever, so
 * it has no Ip or Port: Message is the address it follows, and Listen is on
 * from the start because following is the whole of what it does.
 *
 * The bar and the peak marker are pseudo-elements driven by two custom
 * properties. Real children would be selectable and draggable out of the
 * component in the editor, and would have to be rebuilt on every repaint.
 * There are no event listeners at all: pointer events are left on so the
 * designer can still select and move it, and nothing else is listened for.
 *
 * Peak hold runs on a clock, because the sources worth metering (Resolume,
 * TouchDesigner) send only when a value changes: a marker that waited for
 * the next reading before falling would sit on a peak from minutes ago, and
 * "Peak hold (s)" would not mean what its number says. So a reading at or
 * above the marker moves it up at once, and once the hold has passed the
 * marker falls back onto the bar by itself. It falls to the last reading that
 * arrived, never to zero: the bar is still the truth about what the meter was
 * told, and the timer only stops the marker claiming a peak is recent when it
 * is not. The timer repaints and does nothing else -- it cannot send, because
 * a meter has nothing to send with.
 */
const meter = {
  name: "oscar-meter",
  tag: "div",
  // Only the class, which is what tells a meter from any other div when a
  // project is parsed. orient follows the setting, and a copy here would be
  // re-applied by the host over the real one on every class or style edit.
  attributes: { class: "oscar-meter" },

  sends: false,
  receives: true,
  dmx: false,

  block: {
    label: "Meter",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M3,7H21A2,2 0 0,1 23,9V15A2,2 0 0,1 21,17H3A2,2 0 0,1 1,15V9A2,2 0 0,1 3,7' +
      'M3,9V15H21V9H3M5,11H13V13H5V11M16,11H18V13H16V11Z"/></svg>',
  },

  defaults: {
    enabled: true,
    message: "/meter1",
    // A meter exists to follow something; unlike a control, there is nothing
    // it could start doing on its own that a hand would have to fight.
    listen: true,
    min: 0,
    max: 100,
    value: 0,
    orientation: "horizontal",
    // Seconds a peak stays marked. 0 turns the marker off.
    peakHold: 0,
  },

  fields: [
    enabled(),
    // It follows the rig and never sends: Data in and the address, no more.
    ...oscFields({ sends: false }),
    field("min", "Min", "number", { step: "any" }),
    field("max", "Max", "number", { step: "any" }),
    field("value", "Value", "number", { step: "any" }),
    field("orientation", "Orientation", "select", { options: ORIENTATIONS }),
    field("peakHold", "Peak hold (s)", "number", { min: 0, step: "any" }),
  ],

  checks: {
    message: checkMessage,
    min: checkNumber("Min"),
    max: checkNumber("Max"),
    value: checkNumber("Value"),
    peakHold: checkPeakHold,
  },

  attach: function (el, ctx) {
    // The reading the marker sits at, in the meter's own units, and when it
    // was taken. Kept as a reading rather than a fraction so that editing the
    // range under a held peak re-places the marker instead of leaving it at
    // a stale pixel. Null until the first reading: a marker is a record of
    // what arrived, and nothing has.
    let peak = null;
    let peakAt = 0;
    // The pending fall of the marker, while it is above the bar.
    let fall = null;

    paint();

    /** Seconds of hold as milliseconds, or 0 for no marker at all. */
    function holdMs() {
      const seconds = toNumber(ctx.get("peakHold"));
      return seconds !== null && seconds > 0 ? seconds * 1000 : 0;
    }

    /** Where a reading sits in the configured range, 0..1, or null. */
    function unit(value) {
      return unitOf(value, ctx.get("min"), ctx.get("max"));
    }

    /**
     * Draw what is stored: the bar from Value, the marker from the held peak.
     *
     * The view-only path, so it can be run again after the host rewrites the
     * element. A stored value that cannot be placed -- unreadable, or a range
     * of zero width -- leaves the bar where it is rather than emptying it: an
     * empty bar reports silence on a channel that may be at full.
     */
    function paint() {
      el.setAttribute("orient", ctx.get("orientation") || "horizontal");

      const level = unit(ctx.get("value"));
      if (level !== null) el.style.setProperty("--oscar-level", pct(level));

      if (!holdMs()) peak = null;
      const held = peak === null ? null : unit(peak);
      if (held !== null) el.style.setProperty("--oscar-peak", pct(held));
      ctx.setClass(PEAK_CLASS, held !== null);

      // Every path that can lift the marker off the bar, or change how long
      // it may stay there, ends in a paint -- so this is the one place the
      // fall is armed, and an edit to Peak hold re-times a marker already up.
      const bar = unit(ctx.get("value"));
      arm(held !== null && bar !== null && held > bar);
    }

    /** Have the marker fall when its hold runs out, or call that off. */
    function arm(wanted) {
      if (fall !== null) clearTimeout(fall);
      fall = null;
      if (!wanted) return;
      // setTimeout takes a 32-bit delay: anything longer (a hold of 25 days
      // or more) overflows and fires after a millisecond, dropping the marker
      // at once. Wait the longest it can, and drop() goes round again.
      fall = setTimeout(drop, Math.min(MAX_DELAY, Math.max(0, peakAt + holdMs() - Date.now())));
      // Under Node a pending timer keeps the process alive, and a meter left
      // mounted must not hold a test run or a shutdown open for its hold
      // time. A browser's timer is a plain number and has nothing to unref.
      if (fall && typeof fall.unref === "function") fall.unref();
    }

    /**
     * The hold has run out with no reading to move the marker: bring it down
     * onto the bar. View only -- nothing is stored and nothing is sent. The
     * marker lands on the last reading, and its hold starts again from now,
     * so a lower reading a moment later leaves it there for the full time.
     */
    function drop() {
      fall = null;
      // Woken early by the delay cap above: the hold has not run out yet.
      if (Date.now() < peakAt + holdMs()) {
        arm(true);
        return;
      }
      const current = toNumber(ctx.get("value"));
      // A value that cannot be placed leaves the marker alone, as it leaves
      // the bar alone: there is nowhere true to move it to.
      if (current === null || unit(current) === null) return;
      peak = current;
      peakAt = Date.now();
      paint();
    }

    /**
     * Take a reading from the rig. Stores it, decides the peak, repaints, and
     * nothing else: a value that came in never goes back out.
     */
    function adopt(values) {
      const value = toNumber(values[0]);
      // An unreadable value holds the last reading. Dropping to zero would
      // report silence on a channel that may be at full, which is the
      // dangerous direction for a display to fail in.
      if (value === null) return;

      // Stored silently, so a re-render repaints where the level actually
      // was rather than back at the configured default.
      ctx.set("value", value);

      const hold = holdMs();
      if (hold) {
        const now = Date.now();
        const rising = unit(value);
        const held = peak === null ? null : unit(peak);
        // Compared as fractions rather than as readings so that a range
        // running downward (min above max) still marks its loudest point.
        if (held === null || rising === null || rising >= held || now - peakAt >= hold) {
          peak = value;
          peakAt = now;
        }
      }
      paint();
    }

    // Editing the range, the orientation or the value in the panel has to
    // move the bar, or the designer is laying out a widget they cannot see
    // working. Enabled is not watched: a meter switched off freezes where it
    // is, and switching it back on shows the same until the next reading.
    const stop = ctx.onChange(["min", "max", "value", "orientation", "peakHold"], paint);
    // The host rewriting the element strips orient, the custom properties
    // and the peak class, and losing them shows an empty, flat meter.
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(paint) : null;
    // follow() reads Enabled and Listen for every message, so a disabled
    // meter is deaf and holds its last reading rather than dropping to zero.
    const stopOsc = follow(ctx, adopt);

    return function detach() {
      // A marker left to fall after its element is gone would paint onto
      // nothing, and in the editor onto a view that has been replaced.
      arm(false);
      if (stop) stop();
      if (stopRewrite) stopRewrite();
      if (stopOsc) stopOsc();
    };
  },
};

function checkPeakHold(value) {
  const seconds = toNumber(value);
  if (seconds !== null && seconds >= 0) return null;
  return "Peak hold has to be a number of seconds, 0 for none";
}

module.exports = { meter, PEAK_CLASS };

},{"../dmx/levels":1,"../osc-args":6,"./fields":17,"./incoming":18}],22:[function(require,module,exports){
"use strict";

const {
  field,
  oscFields,
  enabled,
  connectionChecks,
  dmxFields,
  dmxDefaults,
  dmxChecks,
  sendsDmx,
} = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { follow } = require("./incoming");
const { share, onShared } = require("./shared");
const { commitOn, refusal, checkArgType, levelOf, dmxRange } = require("./typed");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");

/**
 * OSC number box: type an exact value instead of hunting for it with a fader.
 *
 * Some values are known -- 127, 0.5, cue 12 -- and dragging a slider until
 * it happens to land on one is guesswork. Sends on Enter, on leaving the box
 * and on a click of the stepper arrows, never per keystroke; typed.js says
 * why. Min, Max and Step are optional: blank means no limit, and a value
 * outside the limits, or off the step, is refused and not sent -- the box
 * keeps the text and the browser marks it, so the operator sees what was not
 * accepted rather than a rig at a clamped value nobody typed.
 *
 * On DMX the number is a level: 0-255 as typed, or, with Min and Max both
 * set, scaled within them as a slider's would be. Without both, 0-255 are
 * the box's limits whatever else is set, and a number outside them is refused
 * like any other: a mistyped -1 pinned to 0 would be a blackout. With Listen
 * on, a value arriving at Message fills the box, brought inside the limits
 * and onto the step so the box and its settings agree -- unless the box is
 * being typed into.
 *
 * The settings are judged together, not one by one. Min, Max, Step, DMX's Enable
 * and Argument type each decide whether the Value already in the box can be
 * sent, so each of them refuses an edit that would strand it: a box holding
 * a number it will itself refuse sends nothing on Enter, and looks fine.
 */
const numberInput = {
  name: "oscar-number-input",
  tag: "input",
  // Only what never changes; min, max and step follow the settings and are
  // put on the element by attach. The enterkeyhint puts "send" on a phone
  // keyboard's Enter, which is what it does here.
  attributes: { type: "number", class: "oscar-number-input", enterkeyhint: "send" },

  sends: true,
  receives: true,
  dmx: true,

  block: {
    label: "Number Input",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M4,17V9H2V7H6V17H4M22,15C22,16.11 21.1,17 20,17H16V15H20V13H18V11H20V9H16V7H20A2,2 0 0,1 ' +
      '22,9V10.5A1.5,1.5 0 0,1 20.5,12A1.5,1.5 0 0,1 22,13.5V15M14,15V17H8V13C8,11.89 8.9,11 ' +
      '10,11H12V9H8V7H12A2,2 0 0,1 14,9V11C14,12.11 13.1,13 12,13H10V15H14Z"/></svg>',
  },

  defaults: Object.assign(
    {
      enabled: true,
      ip: "localhost",
      port: 7000,
      message: "/number1",
      listen: false,
      value: 0,
      min: "",
      max: "",
      step: "",
      argType: "f",
    },
    dmxDefaults(1)
  ),

  fields: [enabled()]
    .concat(oscFields())
    .concat([
      field("value", "Value", "number", { step: "any" }),
      field("min", "Min", "number", { step: "any", placeholder: "no limit" }),
      field("max", "Max", "number", { step: "any", placeholder: "no limit" }),
      field("step", "Step", "number", { step: "any", min: 0, placeholder: "any" }),
      field("argType", "Argument type", "select", { section: "osc", options: NUMERIC_ARG_TYPES }),
    ])
    .concat(dmxFields()),

  checks: Object.assign({}, connectionChecks(), dmxChecks(1), {
    value: checkValue,
    min: checkLimit("Min", "max"),
    max: checkLimit("Max", "min"),
    step: checkStep,
    // Switching DMX on changes which numbers can go out (a level is 0-255
    // unless Min and Max say otherwise), so it is judged like editing a limit.
    dmxEnabled: function (value, config) {
      return stranded(config, "dmxEnabled", value);
    },
    argType: checkArgType(function (config) {
      return [config.value];
    }),
  }),

  attach: function (el, ctx) {
    const entry = commitOn(el, function (raw) {
      const value = toNumber(raw);
      // A cleared or half-typed box is a question, not a zero: Number("") is
      // 0, and 0 is a real cue. Nothing goes out, and the text stays as typed
      // so it can be finished.
      if (value === null) return;
      // Every refusal comes before the value is stored. A number the wire
      // will not take -- 3000000000 as an int -- must not end up in the
      // project either, where the panel's own check would refuse it.
      if (complaintAbout(settings(ctx), value)) return;
      ctx.set("value", value);
      const message = resolve(ctx, value);
      ctx.send(message);
      // Only a number that went out is news for the other devices.
      if (message) share(ctx, { value: value });
    });

    apply();

    /**
     * Push the limits and the value onto the native input. The limits go on
     * the element too, not only into accepts(): the stepper arrows stop at
     * them, and the browser paints a value outside them as out of range.
     */
    function apply() {
      const range = limits(settings(ctx));
      el.min = attribute(range.min);
      el.max = attribute(range.max);
      el.step = attribute(ctx.get("step")) || "any";
      const value = toNumber(ctx.get("value"));
      entry.show(value === null ? "" : String(value));
    }

    /**
     * Take a value the rig sent: it fills the box and goes no further.
     * Brought inside the limits and onto the step, as the slider keeps a
     * value inside its range, so the box never shows a number it would
     * itself refuse: Enter on what the rig sent has to re-send it.
     */
    function adopt(values) {
      const fitted = take(values[0]);
      // Every device heard the rig: recorded for whoever joins later, passed
      // to nobody.
      if (fitted !== null) share(ctx, { value: fitted }, { heard: true });
    }

    /** Another device typed. Shown, and never shared again: it came from there. */
    function adoptShared(state) {
      if (state) take(state.value);
    }

    /** Show a number that arrived; returns what was shown, or null. */
    function take(raw) {
      if (entry.editing()) return null;
      const value = toNumber(raw);
      if (value === null) return null;
      const fitted = nearest(settings(ctx), value);
      // What even the nearest number cannot fix -- a value past an int, limits
      // that leave no room -- is ignored rather than shown and then refused.
      if (complaintAbout(settings(ctx), fitted)) return null;
      ctx.set("value", fitted);
      apply();
      return fitted;
    }

    const stop = ctx.onChange(["value", "min", "max", "step", "dmxEnabled", "transport"], apply);
    // The host rewriting the element strips min, max and step with the rest,
    // and a box with no max lets the stepper run past the range.
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(apply) : null;
    const stopOsc = follow(ctx, adopt);
    const stopShared = onShared(ctx, adoptShared);

    return function detach() {
      entry.detach();
      if (stop) stop();
      if (stopRewrite) stopRewrite();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

/** A limit as the element wants it: a number's text, or "" for none. */
function attribute(raw) {
  const number = toNumber(raw);
  return number === null ? "" : String(number);
}

/** The settings that decide whether a number can go out. */
function settings(ctx) {
  return {
    min: ctx.get("min"),
    max: ctx.get("max"),
    step: ctx.get("step"),
    argType: ctx.get("argType"),
    dmxEnabled: ctx.get("dmxEnabled"),
    // Only ever set on a widget from a project saved before the checkboxes.
    transport: ctx.get("transport"),
  };
}

/**
 * The limits in force, each of which may be null for none.
 *
 * On DMX without both Min and Max the number is the level itself, so 0-255
 * bound it as well as whatever single limit is set. `dmx` says the bounds
 * came from there, so a complaint can say why.
 */
function limits(config) {
  let min = toNumber(config && config.min);
  let max = toNumber(config && config.max);
  if (!sendsDmx(config) || (min !== null && max !== null)) return { min: min, max: max, dmx: false };
  const level = dmxRange(min, max);
  min = min === null ? level.min : Math.max(min, level.min);
  max = max === null ? level.max : Math.min(max, level.max);
  return { min: min, max: max, dmx: true };
}

/**
 * Why this number cannot be sent under these settings, or null. The one
 * judgement behind the keyboard, the panel's Value, and every setting that
 * could strand the Value.
 */
function complaintAbout(config, number) {
  const complaint = refusal((config && config.argType) || "f", number);
  if (complaint) return complaint;
  const range = limits(config);
  const why = range.dmx ? " (a DMX level is 0-255; set both Min and Max to type in other units)" : "";
  if (range.min !== null && number < range.min) return "The value has to be at least " + range.min + why;
  if (range.max !== null && number > range.max) return "The value has to be at most " + range.max + why;
  if (!onStep(number, config && config.step, range.min)) {
    return "The value has to be a whole number of steps from " + (range.min === null ? 0 : range.min);
  }
  return null;
}

/**
 * Would this edit leave the Value already in the box unsendable? A Value
 * that is not a number at all is left to its own check.
 */
function stranded(config, key, value) {
  const next = Object.assign({}, config);
  next[key] = value;
  const held = toNumber(next.value);
  if (held === null) return null;
  const complaint = complaintAbout(next, held);
  return complaint ? complaint + "; change the value first" : null;
}

/**
 * Whether a value is a whole number of steps from the base, which the
 * browser takes to be Min, or 0 without one. Measured with a tolerance,
 * because 0.3 is not three of 0.1 in floating point.
 */
function onStep(value, step, min) {
  const size = toNumber(step);
  if (size === null || size <= 0) return true;
  const steps = (value - (min === null ? 0 : min)) / size;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/**
 * The number nearest a received one that the box would accept: inside the
 * limits, then on the step, stepping back in if rounding left the range.
 */
function nearest(config, value) {
  const range = limits(config);
  let result = value;
  if (range.min !== null) result = Math.max(range.min, result);
  if (range.max !== null) result = Math.min(range.max, result);

  const size = toNumber(config.step);
  if (size === null || size <= 0) return result;
  const base = range.min === null ? 0 : range.min;
  let steps = Math.round((result - base) / size);
  if (range.max !== null && base + steps * size > range.max) steps -= 1;
  // Trimmed, because three steps of 0.1 is 0.30000000000000004 and that is
  // what the box would show.
  return Number((base + steps * size).toPrecision(12));
}

function resolve(ctx, value) {
  return outgoing(routing(ctx), value, levelOf(value, ctx.get("min"), ctx.get("max")));
}

function blank(value) {
  return value === "" || value === null || value === undefined;
}

/**
 * Blank is allowed -- it is how you say "no limit" -- and nonsense is not.
 * The two limits must also be the right way round: the browser treats every
 * value as out of range when Min is above Max, and the box goes dead.
 */
function checkLimit(label, otherKey) {
  return function (value, config) {
    const key = otherKey === "max" ? "min" : "max";
    // Clearing a limit can strand the Value too: on DMX it brings 0-255 back.
    if (blank(value)) return stranded(config, key, value);
    const number = toNumber(value);
    if (number === null) return label + " has to be a number, or blank for no limit";
    const other = toNumber(config && config[otherKey]);
    if (other !== null && (otherKey === "max" ? number > other : number < other)) {
      return "Min has to be at most Max";
    }
    return stranded(config, key, value);
  };
}

function checkStep(value, config) {
  if (blank(value)) return stranded(config, "step", value);
  const number = toNumber(value);
  if (number === null || number <= 0) return "Step has to be a number above zero, or blank for any";
  return stranded(config, "step", value);
}

/**
 * Judged against the type that will carry it and the limits it has to sit
 * inside: a value the box would refuse from the keyboard is refused from the
 * panel too, and for the same reasons.
 */
function checkValue(value, config) {
  const number = toNumber(value);
  if (number === null) return "The value has to be a number";
  return complaintAbout(config, number);
}

module.exports = { numberInput };

},{"../osc-args":6,"./fields":17,"./incoming":18,"./outgoing":23,"./shared":25,"./typed":28}],23:[function(require,module,exports){
"use strict";

const { toArgs } = require("../osc-args");
const { SLOTS, protocol } = require("../dmx/spec");
const { toWhole, toLevels, spread } = require("../dmx/levels");
const { sendsOsc, sendsDmx } = require("./fields");
const { SERIAL_HOST, isSerialTarget } = require("../serial-target");

/**
 * Decide what a widget should put on the wire, or null for silence.
 *
 * Every widget funnels through here, so the Enabled switch cannot be
 * implemented three slightly different ways, and a value that no argument
 * type can carry is dropped rather than guessed at.
 *
 * A widget hands over two readings of the same gesture:
 *
 *   raw    the value in the widget's own units -- 0-100, a cue number, "go"
 *          -- which is what OSC carries. A list for a widget that produces
 *          several values at once: a pad two, a colour three.
 *   units  the same gesture as 0..1 (a list for several), which is what a
 *          DMX slot is scaled from. Only the widget knows its own range, so
 *          only the widget can work this out (unitOf in lib/dmx/levels.js);
 *          a slider labelled 20-2000 Hz still means "full" at the top. A
 *          button passes 1 or 0. Omitted by a widget that cannot drive DMX.
 *
 * The result is { ip, port, address, args } for OSC, { dmx: {...} } for DMX,
 * or both on one object when both protocols are switched on, and the host sends whichever
 * halves are present. The halves are independent: a button whose Value ON
 * is "go" cannot send that as a float, but it can still put its dimmer to
 * full, and silence on one wire is no reason for silence on the other.
 */
function outgoing(config, raw, units) {
  if (!config || !config.enabled) return null;

  const message = {};
  let sending = false;

  if (sendsOsc(config)) {
    const args = oscArgs(config, raw);
    if (args) {
      // The cable is named once, in one spelling, so the server never has to
      // wonder whether " Serial" is a host name. The port rides along unread.
      message.ip = isSerialTarget(config.ip) ? SERIAL_HOST : config.ip;
      message.port = config.port;
      message.address = config.message;
      message.args = args;
      sending = true;
    }
  }

  if (sendsDmx(config)) {
    const dmx = dmxRequest(config, units);
    if (dmx) {
      message.dmx = dmx;
      sending = true;
    }
  }

  return sending ? message : null;
}

/** The OSC arguments for one gesture, or null if any value cannot be sent. */
function oscArgs(config, raw) {
  const values = Array.isArray(raw) ? raw : [raw];
  const args = [];
  for (const value of values) {
    const built = toArgs(config.argType, value);
    // One unsendable value spoils the message. Sending the rest would put a
    // position on the wire with a coordinate silently missing from it.
    if (built === null) return null;
    for (const arg of built) args.push(arg);
  }
  return args;
}

/**
 * The DMX half for one gesture, or null.
 *
 * Null means the fixture stays where it is rather than going to zero. That
 * is the whole point: an unreadable level coerced to 0 is a blackout, and it
 * would look exactly like someone pulling the fader down. The block is
 * refused, not truncated, when it runs past channel 512 or is too narrow for
 * the widget's values; the settings panel refuses both too, and a project
 * file edited by hand reaches here instead.
 */
function dmxRequest(config, units) {
  const spec = protocol(config.dmxProtocol);
  if (!spec) return null;

  const universe = toWhole(config.dmxUniverse, spec.minUniverse, spec.maxUniverse);
  const channel = toWhole(config.dmxChannel, 1, SLOTS);
  const count = toWhole(config.dmxCount, 1, SLOTS);
  if (universe === null || channel === null || count === null) return null;
  if (channel + count - 1 > SLOTS) return null;

  const levels = spread(toLevels(units), count);
  if (levels === null) return null;

  return {
    protocol: spec.id,
    host: typeof config.dmxHost === "string" ? config.dmxHost.trim() : "",
    universe: universe,
    channel: channel,
    levels: levels,
  };
}

/**
 * The same settings limited to one transport, or null when they do not use
 * it. For a widget that sends its OSC in several messages but its DMX in one
 * -- the pad in two-message mode -- so each half goes out exactly once.
 */
function only(config, protocol) {
  if (!config) return null;
  if (protocol === "osc" && !sendsOsc(config)) return null;
  if (protocol === "dmx" && !sendsDmx(config)) return null;
  // `transport` is the old one-setting form of the same choice (fields.js);
  // cleared, so it cannot outvote the two checkboxes set here.
  return Object.assign({}, config, {
    transport: undefined,
    oscEnabled: protocol === "osc",
    dmxEnabled: protocol === "dmx",
  });
}

/**
 * The settings every sending widget shares, read off its host in one go.
 *
 * Widgets differ in how they produce a value, not in where it goes, so the
 * routing half of a panel is read the same way for all of them. Keys a widget
 * does not have read as undefined, which outgoing() treats as OSC only.
 */
function routing(ctx) {
  return {
    enabled: ctx.get("enabled"),
    oscEnabled: ctx.get("oscEnabled"),
    dmxEnabled: ctx.get("dmxEnabled"),
    // Only ever set on a widget from a project saved before the checkboxes.
    transport: ctx.get("transport"),
    ip: ctx.get("ip"),
    port: ctx.get("port"),
    message: ctx.get("message"),
    argType: ctx.get("argType"),
    dmxProtocol: ctx.get("dmxProtocol"),
    dmxHost: ctx.get("dmxHost"),
    dmxUniverse: ctx.get("dmxUniverse"),
    dmxChannel: ctx.get("dmxChannel"),
    dmxCount: ctx.get("dmxCount"),
  };
}

module.exports = { outgoing, only, routing };

},{"../dmx/levels":1,"../dmx/spec":2,"../osc-args":6,"../serial-target":11,"./fields":17}],24:[function(require,module,exports){
"use strict";

/**
 * Every widget OSCAR ships, in the order the block palette shows them.
 *
 * Adding a widget is one new file in this folder plus one line here. Nothing
 * else needs editing: lib/widgets/index.js reads this list, and the editor and
 * the preview register whatever it holds through the adapter.
 *
 * Keep one require per line so parallel additions merge without conflict.
 */
module.exports = [
  require("./button").button,
  require("./slider").slider,
  require("./xypad").xypad,
  require("./meter").meter,
  require("./colour").colour,
  require("./text-input").textInput,
  require("./number-input").numberInput,
  require("./dropdown").dropdown,
  require("./media-browser").mediaBrowser,
];

},{"./button":14,"./colour":15,"./dropdown":16,"./media-browser":20,"./meter":21,"./number-input":22,"./slider":26,"./text-input":27,"./xypad":29}],25:[function(require,module,exports){
"use strict";

/**
 * Agreeing with the other devices on the surface.
 *
 * Several tablets showing one layout each run their own copy of a widget,
 * and a copy that does not hear about the others is wrong the moment one of
 * them is touched: a toggle that one operator switched on still draws off
 * on the next tablet, and its next press sends the ON edge again. So a
 * widget tells the host what it now shows -- { on }, { value }, { x, y } --
 * every time a hand changes it, and follows what the host says the others
 * show. Neither needs switching on: two tablets agreeing is not a feature
 * anyone should have to find.
 *
 * Both host methods are optional (see the ctx contract in index.js), so
 * every widget goes through here rather than checking for them itself.
 *
 * The rules that keep this from becoming a loop are the host's and the
 * server's, not the widget's, and a widget cannot break them: the host
 * refuses share() and send() while a shared state is being delivered, and
 * the server passes a change on only when it changed something. What a
 * widget owes in return is to treat what arrives the way it treats what
 * the rig sends -- apply it to the element, store it with set(), and
 * nothing else -- and to ignore it while a hand is on the control.
 */

/**
 * Tell the other devices what this widget now shows.
 *
 * `how` is optional and says what kind of news this is:
 *   { heard: true }        the value came from the rig, not from a hand.
 *                          Every device on the layout was sent the same OSC
 *                          message, so it is recorded for whoever joins
 *                          later and nobody else is told -- a copy from
 *                          each tablet for each message of a fader stream
 *                          is traffic at best, and at worst arrives late
 *                          and pulls a thumb back to where the rig was.
 *   { release: { ... } }   what the widget shows once this device is gone.
 *                          For state that lasts only as long as a finger is
 *                          down: a tablet that drops off the network
 *                          mid-press never gets to say the finger came up.
 */
function share(ctx, state, how) {
  if (typeof ctx.share === "function") ctx.share(state, how);
}

/**
 * Follow this widget's state as the other devices report it.
 *
 *   const stopShared = onShared(ctx, function (state) { ... });
 *   ... in detach:  if (stopShared) stopShared();
 *
 * `state` is whatever the widgets on the other devices shared, merged, so
 * a key may be missing and a value is to be read with toNumber() from
 * osc-args.js or checked for the type expected, never assumed.
 *
 * @returns an unsubscribe function, or null where the host has no other
 *   devices to speak of.
 */
function onShared(ctx, fn) {
  if (typeof ctx.onShared !== "function") return null;
  return ctx.onShared(fn);
}

module.exports = { share, onShared };

},{}],26:[function(require,module,exports){
"use strict";

const {
  field,
  oscFields,
  enabled,
  connectionChecks,
  checkNumber,
  ORIENTATIONS,
  dmxFields,
  dmxDefaults,
  dmxChecks,
} = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { follow } = require("./incoming");
const { share, onShared } = require("./shared");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");
const { unitOf } = require("../dmx/levels");

/**
 * OSC slider.
 *
 * With Invert on, the value sent is mirrored within [Min, Max] while the thumb
 * stays where the hand put it. With Listen on, a value arriving at Message
 * moves the thumb -- except while a finger is on it. The same slider on
 * another device moves it the same way, Listen or not: every tablet on the
 * surface shows one { value }. On DMX the level is where the value sent sits
 * within [Min, Max], so Invert mirrors it as well.
 */
const slider = {
  name: "oscar-slider",
  tag: "input",
  // Only what never changes. min, max and orient follow the settings, and a
  // copy of them here would be re-applied by the host over the real ones on
  // every class or style edit, flipping a vertical slider flat.
  attributes: { type: "range", step: "0.01" },

  sends: true,
  receives: true,
  dmx: true,

  block: {
    label: "Slider",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M3,17V19H9V17H3M3,5V7H13V5H3M13,21V19H21V17H13V15H11V21H13M7,9V11H3V13H7V15H9V9H7M21,' +
      '13V11H11V13H21M15,9H17V7H21V5H17V3H15V9Z"/></svg>',
  },

  defaults: Object.assign(
    {
      enabled: true,
      ip: "localhost",
      port: 7000,
      message: "/slider1",
      listen: false,
      min: 0,
      max: 100,
      value: 0,
      orientation: "horizontal",
      invert: false,
      argType: "f",
    },
    dmxDefaults(1)
  ),

  fields: [enabled()]
    .concat(oscFields())
    .concat([
      field("min", "Min", "number", { step: "any" }),
      field("max", "Max", "number", { step: "any" }),
      field("value", "Value", "number", { step: "any" }),
      field("orientation", "Orientation", "select", { options: ORIENTATIONS }),
      field("invert", "Invert", "checkbox"),
      field("argType", "Argument type", "select", { section: "osc", options: NUMERIC_ARG_TYPES }),
    ])
    .concat(dmxFields()),

  checks: Object.assign({}, connectionChecks(), dmxChecks(1), {
    min: checkNumber("Min"),
    max: checkNumber("Max"),
    value: checkValue,
  }),

  attach: function (el, ctx) {
    // True from the pointer landing on the thumb until it lifts. The network
    // is ignored for as long as it is: a value arriving mid-drag would snatch
    // the thumb out from under the finger.
    let held = false;
    // The last value that arrived while it was. The other devices are told of
    // a change once, so one dropped for good would leave this thumb out of
    // step with theirs after the finger lifts, until somebody moved it again.
    let missed = null;

    apply();

    /**
     * Push the configured range and position onto the native input.
     *
     * Without this every slider sits at the browser's default midpoint after a
     * load, while the value last sent to the rig was something else entirely.
     */
    function apply() {
      const min = Number(ctx.get("min"));
      const max = Number(ctx.get("max"));
      if (Number.isFinite(min)) el.min = String(min);
      if (Number.isFinite(max)) el.max = String(max);
      el.setAttribute("orient", ctx.get("orientation") || "horizontal");

      const value = Number(ctx.get("value"));
      if (Number.isFinite(value)) {
        el.value = String(ctx.get("invert") ? max - value + min : value);
      }
      paintFill();
    }

    /**
     * Tell the stylesheet how far along the track the thumb is.
     *
     * A native range input cannot style "the part before the thumb" in
     * Chromium or WebKit, so toggle.css draws the filled track from this. It
     * follows the thumb, not the value sent: with Invert on the two differ,
     * and the fill belongs under the finger.
     */
    function paintFill() {
      const lo = toNumber(el.min);
      const hi = toNumber(el.max);
      const at = toNumber(el.value);
      // Not called `share`: that is the function that tells the other devices.
      let part = 0;
      if (lo !== null && hi !== null && at !== null && hi !== lo) {
        part = Math.min(1, Math.max(0, (at - lo) / (hi - lo)));
      }
      el.style.setProperty("--oscar-fill", (part * 100).toFixed(2) + "%");
    }

    function onInput() {
      const raw = Number(el.value);
      const min = Number(ctx.get("min"));
      const max = Number(ctx.get("max"));
      const value = ctx.get("invert") ? max - raw + min : raw;

      // The hand has spoken since; what arrived before it is old news.
      missed = null;
      paintFill();
      ctx.set("value", value);
      ctx.send(resolve(ctx, value));
      share(ctx, { value: value });
    }

    function hold() {
      held = true;
    }

    function release() {
      held = false;
      if (missed === null) return;
      // Catch up with what came in under the finger -- through take(), the
      // view-only path: this is still a value from outside, and lifting a
      // finger must not put it on the wire.
      const raw = missed;
      missed = null;
      take(raw);
    }

    /**
     * Show a value decided elsewhere -- by the rig, or by a hand on another
     * device. Stores it and moves the thumb through apply(), the view-only
     * path, and nothing else: a value that came in must never go back out.
     * Returns the value kept, or null when there was nothing to keep: an
     * unreadable value, or a finger on the thumb, which outranks anything
     * arriving for as long as it is down.
     */
    function take(raw) {
      const value = toNumber(raw);
      if (value === null) return null;
      if (held) {
        missed = value;
        return null;
      }
      const kept = within(value, ctx.get("min"), ctx.get("max"));
      ctx.set("value", kept);
      apply();
      return kept;
    }

    /**
     * Take a value the rig sent, and have it recorded as heard: the other
     * devices were sent the same message, so nobody needs telling, but a
     * device joining later starts where the rig left the thumb.
     */
    function adopt(values) {
      const kept = take(values[0]);
      if (kept !== null) share(ctx, { value: kept }, { heard: true });
    }

    /** Take the value another device shows. Never shared again: it came from there. */
    function adoptShared(state) {
      take(state.value);
    }

    el.addEventListener("input", onInput);
    el.addEventListener("pointerdown", hold);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    // A pointerup that lands on another window would otherwise leave the
    // slider deaf to the rig until the next press.
    const root = typeof window === "undefined" ? null : window;
    if (root) root.addEventListener("blur", release);

    // A settings edit changes the range or flips the direction under a thumb
    // that is already somewhere; re-apply rather than leave the two disagreeing.
    const stop = ctx.onChange(["min", "max", "value", "orientation", "invert"], apply);
    // The host rewriting the element strips orient, min and max, and losing
    // max clamps the thumb through the browser's default range on the way.
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(apply) : null;
    const stopOsc = follow(ctx, adopt);
    const stopShared = onShared(ctx, adoptShared);

    return function detach() {
      el.removeEventListener("input", onInput);
      el.removeEventListener("pointerdown", hold);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
      if (root) root.removeEventListener("blur", release);
      if (stop) stop();
      if (stopRewrite) stopRewrite();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

/** Keep a received value inside the slider's range, so thumb and value agree. */
function within(value, min, max) {
  const lo = toNumber(min);
  const hi = toNumber(max);
  if (lo === null || hi === null) return value;
  return Math.min(Math.max(lo, hi), Math.max(Math.min(lo, hi), value));
}

function resolve(ctx, value) {
  return outgoing(routing(ctx), value, unitOf(value, ctx.get("min"), ctx.get("max")));
}

function checkValue(value, config) {
  const number = toNumber(value);
  if (number === null) return "The value has to be a number";
  const min = Number(config.min);
  const max = Number(config.max);
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  if (number < low || number > high) {
    return "The value has to be between " + low + " and " + high;
  }
  return null;
}

// ORIENTATIONS lives in fields.js now; it is still exported from here because
// this is where it used to be, and a caller that learned it here keeps working.
module.exports = { slider, ORIENTATIONS };

},{"../dmx/levels":1,"../osc-args":6,"./fields":17,"./incoming":18,"./outgoing":23,"./shared":25}],27:[function(require,module,exports){
"use strict";

const { field, enabled, oscFields, connectionChecks } = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { follow } = require("./incoming");
const { share, onShared } = require("./shared");
const { commitOn, refusal, checkArgType } = require("./typed");
const { ARG_TYPES } = require("../osc-args");

/**
 * OSC text box: type a value, press Enter, and it goes out.
 *
 * The full argument-type list, not only string: the thing that makes a typed
 * box useful is that it carries whatever is typed -- a clip name today, a cue
 * number tomorrow -- and the panel refuses a value the chosen type cannot
 * carry rather than sending nothing without a word. Sends on Enter and on
 * leaving the field, never per keystroke; typed.js says why. Not a DMX
 * widget: text is not a level.
 *
 * With Listen on, a value arriving at Message is shown in the box -- unless
 * the box is being typed into, in which case the operator's half-written
 * value outranks the network.
 */
const textInput = {
  name: "oscar-text-input",
  tag: "input",
  // Browsers offer previously typed text in any text box; on a control
  // surface those suggestions are noise over the cue being typed. The
  // enterkeyhint puts "send" on a phone keyboard's Enter, which is what it
  // does here.
  attributes: { type: "text", class: "oscar-text-input", autocomplete: "off", enterkeyhint: "send" },

  sends: true,
  receives: true,
  dmx: false,

  block: {
    label: "Text Input",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M17,7H22V17H17V19A1,1 0 0,0 18,20H20V22H17.5C16.95,22 16,21.55 16,21C16,21.55 15.05,22 ' +
      '14.5,22H12V20H14A1,1 0 0,0 15,19V5A1,1 0 0,0 14,4H12V2H14.5C15.05,2 16,2.45 16,3C16,2.45 ' +
      '16.95,2 17.5,2H20V4H18A1,1 0 0,0 17,5V7M2,7H13V9H4V15H13V17H2V7M20,15V9H17V15H20Z"/></svg>',
  },

  defaults: {
    enabled: true,
    oscEnabled: true,
    ip: "localhost",
    port: 7000,
    message: "/text1",
    listen: false,
    value: "",
    placeholder: "Type, then press Enter",
    argType: "s",
  },

  fields: [enabled()]
    .concat(oscFields())
    .concat([
    field("value", "Value", "text"),
    field("placeholder", "Placeholder", "text"),
    field("argType", "Argument type", "select", { section: "osc", options: ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
    value: checkValue,
    argType: checkArgType(function (config) {
      return text(config.value).trim() ? [config.value] : [];
    }),
  }),

  attach: function (el, ctx) {
    const entry = commitOn(el, function (raw) {
      // An empty box has nothing in it to send. Left to the argument types it
      // would still go out -- "" as a string, F as a bool, a bare address as
      // none -- and F is a real cue fired by pressing Enter on nothing. The
      // emptiness is kept, so a cleared box stays cleared after a reload.
      if (!raw.trim()) {
        ctx.set("value", "");
        return;
      }
      // Refused before it is stored: "GO" in a float box goes nowhere, and
      // must not end up in the project, where the panel would refuse it.
      if (refusal(ctx.get("argType") || "s", raw)) return;
      ctx.set("value", raw);
      const message = outgoing(routing(ctx), raw);
      ctx.send(message);
      // Only text that went out is news for the other devices. Longer than
      // the server will record is simply not shared.
      if (message) share(ctx, { value: raw });
    });

    apply();

    /** Show the stored text, so a reload does not empty the box. */
    function apply() {
      const hint = ctx.get("placeholder");
      el.placeholder = hint === null || hint === undefined ? "" : String(hint);
      entry.show(text(ctx.get("value")));
    }

    /**
     * Take a value the rig sent: it fills the box and goes no further. A
     * number or a bool is shown as its text; a value OSCAR could not read,
     * or a message with no argument, changes nothing.
     */
    function adopt(values) {
      // Every device heard the rig: recorded for whoever joins later, passed
      // to nobody.
      if (take(values[0])) share(ctx, { value: text(values[0]) }, { heard: true });
    }

    /** Another device typed. Shown, and never shared again: it came from there. */
    function adoptShared(state) {
      if (state) take(state.value);
    }

    /** Show text that arrived, unless a hand is typing here. */
    function take(value) {
      if (entry.editing()) return false;
      if (value === null || value === undefined || typeof value === "object") return false;
      ctx.set("value", text(value));
      apply();
      return true;
    }

    const stop = ctx.onChange(["value", "placeholder"], apply);
    // The host rewriting the element strips the placeholder with the rest.
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(apply) : null;
    const stopOsc = follow(ctx, adopt);
    const stopShared = onShared(ctx, adoptShared);

    return function detach() {
      entry.detach();
      if (stop) stop();
      if (stopRewrite) stopRewrite();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

function text(value) {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * A blank Value is fine under any type: it is the box's starting text, and an
 * empty box sends nothing, so a float box may start empty. Anything typed
 * there has to be sendable as the chosen type.
 */
function checkValue(value, config) {
  if (!text(value).trim()) return null;
  return refusal((config && config.argType) || "s", value);
}

module.exports = { textInput };

},{"../osc-args":6,"./fields":17,"./incoming":18,"./outgoing":23,"./shared":25,"./typed":28}],28:[function(require,module,exports){
"use strict";

const { isSendable, toNumber } = require("../osc-args");
const { unitOf } = require("../dmx/levels");
const { MAX_LEVEL } = require("../dmx/spec");

/**
 * What the typed controls -- the text box, the number box and the dropdown --
 * have in common: when a typed value counts as finished, how a value is judged
 * against the argument type that will carry it, and what a bare number means
 * to a DMX channel.
 *
 * The button and the slider decide *when* to send from a gesture. A typed
 * field has no gesture, only keystrokes, and a keystroke is never a value:
 * typing 12.5 is 1, then 12, then 12.5, and the first two are real cues a rig
 * would act on. So nothing here sends per keystroke. A value is finished when
 * Enter is pressed, or when the field is left (the browser's `change`, which
 * fires on blur only if the text was actually edited). Enter sends even when
 * nothing changed, because re-sending a cue on purpose is a normal thing to
 * do; `change` sends only what differs from what the wire last saw, because
 * the browser fires it right after Enter as well, and that would put the
 * same cue out twice.
 */

/**
 * Wire a field up to send when its value is finished.
 *
 *   const entry = commitOn(el, function (value) { ... });
 *   ... in detach:  entry.detach();
 *
 * `send` is given the field's text. It parses, refuses, sends, and stores;
 * this only decides that the moment has come.
 *
 * Two more rules ride along, both about the difference between typing and
 * everything else:
 *
 *   An `input` event that arrives while the pointer is held on the control is
 *   not typing -- a hand cannot hold a mouse button on a field and type into
 *   it -- it is a click on a number box's stepper arrow, and one step is a
 *   finished value, exactly as one notch on a slider is. It is sent at once.
 *   (Browsers also fire `change` for a step, which is then the same value and
 *   goes nowhere.) "Held" has to end wherever the button comes up: a press
 *   inside the box released outside it -- dragging to select the text -- puts
 *   no pointerup on the box, and a hold that outlives it turns every later
 *   keystroke into a cue. So the release is heard on the window, leaving the
 *   field ends it too, and an `input` that says it is an insertion or a
 *   deletion is typing whatever the pointer is doing.
 *
 *   A field that has been typed into since it last committed is being
 *   edited, and `editing()` says so; a widget that follows the rig leaves such
 *   a field alone, or an echo would overwrite half a number under the
 *   operator's fingers. Committing, or leaving the field, ends the edit.
 *
 * `show(text)` is how the widget itself puts a value in the box -- from the
 * settings or from the network -- so that text counts as already on the wire
 * and not as an edit in progress.
 */
function commitOn(el, send) {
  let last = el.value;
  let dirty = false;
  let held = false;

  function commit(force) {
    const value = el.value;
    dirty = false;
    if (!force && value === last) return;
    last = value;
    send(value);
  }

  function onKeyDown(e) {
    if (e.key !== "Enter") return;
    // The Enter that confirms an IME composition picks a candidate; it is
    // not the end of the value. (229 is how older engines report it.)
    if (e.isComposing || e.keyCode === 229) return;
    // Inside a form, Enter would submit and reload the surface mid-show.
    if (e.preventDefault) e.preventDefault();
    commit(true);
  }

  function onChange() {
    commit(false);
  }

  function onInput(e) {
    if (held && !isTyping(e)) commit(true);
    else dirty = true;
  }

  function onBlur() {
    // `change` has already fired for a real edit; whatever is left in the
    // box was walked away from, and the field is nobody's any more.
    dirty = false;
    held = false;
  }

  function hold() {
    held = true;
  }

  function release() {
    held = false;
  }

  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("change", onChange);
  el.addEventListener("input", onInput);
  el.addEventListener("blur", onBlur);
  el.addEventListener("pointerdown", hold);
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  // The element's own window where there is one: in an editor the canvas is
  // an iframe, and a release inside it never reaches the outer window.
  const root = (el.ownerDocument && el.ownerDocument.defaultView) || (typeof window === "undefined" ? null : window);
  if (root) {
    root.addEventListener("pointerup", release);
    root.addEventListener("pointercancel", release);
    root.addEventListener("blur", release);
  }

  return {
    editing: function () {
      return dirty;
    },
    show: function (text) {
      el.value = text;
      last = text;
      dirty = false;
    },
    detach: function () {
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("change", onChange);
      el.removeEventListener("input", onInput);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("pointerdown", hold);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
      if (root) {
        root.removeEventListener("pointerup", release);
        root.removeEventListener("pointercancel", release);
        root.removeEventListener("blur", release);
      }
    },
  };
}

/**
 * Does this `input` event say it came from the keyboard? A stepper click
 * reports no inputType, or a replacement; typing, pasting, deleting and undo
 * all report an insert*, delete* or history* one.
 */
function isTyping(e) {
  const kind = e && typeof e.inputType === "string" ? e.inputType : "";
  if (kind === "insertReplacementText") return false;
  return /^(insert|delete|history)/.test(kind);
}

/**
 * The complaint for a value the argument type cannot carry, or null.
 *
 * "abc" is perfectly good as a string and unsendable as a float. The same
 * refusal is raised from both ends: editing the value under a type, and
 * switching the type over a value -- the second is checkArgType below --
 * because a panel that only checks one of them lets "GO" sit in a box that
 * has just been switched to float, and the widget goes silently dead.
 */
function refusal(argType, value) {
  if (isSendable(argType, value)) return null;
  return 'The value "' + value + '" cannot be sent as ' + argType;
}

/**
 * A validator for the argType field: the new type has to be able to carry
 * whatever the widget already holds. `valuesOf(config)` lists those values.
 */
function checkArgType(valuesOf) {
  return function (argType, config) {
    for (const value of valuesOf(config || {})) {
      const complaint = refusal(argType, value);
      if (complaint) return complaint + "; change the value first";
    }
    return null;
  };
}

/**
 * What a typed number means to a DMX channel, as 0..1, or null.
 *
 * With Min and Max both set, the level is where the number sits between them,
 * as it is on a slider: a box that takes 0-100 puts 50 at half. With no range
 * to scale by, the number is taken as the level itself, 0-255, which is the
 * unit a lighting operator types in anyway.
 *
 * Out of range is null, not the nearest end. A slider pins because a hand
 * dragged past the end of the track means "all the way"; a typed -1 is a
 * slip of the finger, and pinning it to 0 is a blackout nobody asked for.
 * Unreadable stays null too, and nothing is sent.
 */
function levelOf(value, min, max) {
  const range = dmxRange(min, max);
  const number = toNumber(value);
  if (number === null || number < range.min || number > range.max) return null;
  return unitOf(number, range.min, range.max);
}

/**
 * The numbers a DMX channel can take from a typed control: Min to Max when
 * both are set, otherwise the raw level, 0-255.
 */
function dmxRange(min, max) {
  const lo = toNumber(min);
  const hi = toNumber(max);
  if (lo !== null && hi !== null) return { min: lo, max: hi };
  return { min: 0, max: MAX_LEVEL };
}

module.exports = { commitOn, refusal, checkArgType, levelOf, dmxRange };

},{"../dmx/levels":1,"../dmx/spec":2,"../osc-args":6}],29:[function(require,module,exports){
"use strict";

const {
  field,
  oscFields,
  enabled,
  connectionChecks,
  checkNumber,
  dmxFields,
  dmxDefaults,
  dmxChecks,
} = require("./fields");
const { outgoing, only, routing } = require("./outgoing");
const { follow } = require("./incoming");
const { share, onShared } = require("./shared");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");
const { unitOf } = require("../dmx/levels");

const SEND_MODES = [
  { id: "one", name: "One message, two values" },
  { id: "two", name: "Two messages (/x and /y)" },
];

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * OSC XY pad: drag anywhere in the square to send two values at once.
 *
 * One message carrying both values is the default, which is what most software
 * expects for a position. Two separate messages suits targets that want one
 * value per address. With Listen on, the handle follows the same shape coming
 * back: /pad with two values, or /pad/x and /pad/y with one each -- except
 * while a finger is dragging it. The same pad on another device moves it the
 * same way, Listen or not: every tablet on the surface shows one { x, y }.
 * On DMX, X lands on the first channel of the block and Y on the next: pan
 * and tilt on a moving head.
 */
const xypad = {
  name: "oscar-xypad",
  tag: "div",
  // The handle is drawn by CSS on this element, not by a child. A child would
  // swallow the drag, the way a button's label used to.
  attributes: { class: "oscar-xypad" },

  sends: true,
  receives: true,
  dmx: true,

  block: {
    label: "XY Pad",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M3,3H21A2,2 0 0,1 23,5V19A2,2 0 0,1 21,21H3A2,2 0 0,1 1,19V5A2,2 0 0,1 3,3M3,5V19H21V5H3' +
      'M15,9A2,2 0 0,1 17,11A2,2 0 0,1 15,13A2,2 0 0,1 13,11A2,2 0 0,1 15,9Z"/></svg>',
  },

  defaults: Object.assign(
    {
      enabled: true,
      ip: "localhost",
      port: 7000,
      message: "/pad",
      listen: false,
      sendMode: "one",
      minX: 0,
      maxX: 100,
      minY: 0,
      maxY: 100,
      x: 0,
      y: 0,
      invertX: false,
      invertY: false,
      argType: "f",
    },
    dmxDefaults(2)
  ),

  fields: [enabled()]
    .concat(oscFields())
    .concat([
      field("sendMode", "Send", "select", { options: SEND_MODES }),
      field("minX", "Min X", "number", { step: "any" }),
      field("maxX", "Max X", "number", { step: "any" }),
      field("minY", "Min Y", "number", { step: "any" }),
      field("maxY", "Max Y", "number", { step: "any" }),
      field("invertX", "Invert X", "checkbox"),
      field("invertY", "Invert Y", "checkbox"),
      field("argType", "Argument type", "select", { section: "osc", options: NUMERIC_ARG_TYPES }),
    ])
    .concat(dmxFields()),

  checks: Object.assign({}, connectionChecks(), dmxChecks(2), {
    minX: checkNumber("Min X"),
    maxX: checkNumber("Max X"),
    minY: checkNumber("Min Y"),
    maxY: checkNumber("Max Y"),
  }),

  attach: function (el, ctx) {
    let dragging = false;
    let frame = null;
    let pending = null;

    place();

    /** Put the handle where the stored values say, after a load. */
    function place() {
      const fx = fraction(ctx.get("x"), ctx.get("minX"), ctx.get("maxX"));
      const fy = fraction(ctx.get("y"), ctx.get("minY"), ctx.get("maxY"));

      const left = ctx.get("invertX") ? 1 - fx : fx;
      // Screen coordinates run downward; a control surface reads upward.
      const top = ctx.get("invertY") ? fy : 1 - fy;

      paint(left, top);
    }

    function paint(left, top) {
      el.style.setProperty("--oscar-x", (left * 100).toFixed(2) + "%");
      el.style.setProperty("--oscar-y", (top * 100).toFixed(2) + "%");
    }

    function fraction(value, min, max) {
      const lo = Number(min);
      const hi = Number(max);
      const v = Number(value);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(v)) return 0;
      if (hi === lo) return 0;
      return clamp((v - lo) / (hi - lo), 0, 1);
    }

    function onPointerDown(e) {
      e.preventDefault();
      // Capture keeps the drag alive if the finger leaves the pad, so a value
      // can be held at the very edge.
      try {
        el.setPointerCapture(e.pointerId);
      } catch (err) {
        /* older engines manage without it */
      }
      dragging = true;
      track(e);
    }

    function onPointerMove(e) {
      if (dragging) track(e);
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      track(e, true);
    }

    /**
     * A pointerup that lands on another window -- alt-tab, a notification --
     * never reaches the pad. Without this the drag would stay open and the
     * pad deaf to the rig until the next press. There is no pointer to read,
     * so the last position it had is what goes out.
     */
    function onBlur() {
      if (!dragging) return;
      dragging = false;
      flush();
    }

    /** Work out the values under the pointer and schedule them. */
    function track(e, final) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const px = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const py = clamp((e.clientY - rect.top) / rect.height, 0, 1);

      const fx = ctx.get("invertX") ? 1 - px : px;
      const fy = ctx.get("invertY") ? py : 1 - py;

      const minX = Number(ctx.get("minX"));
      const maxX = Number(ctx.get("maxX"));
      const minY = Number(ctx.get("minY"));
      const maxY = Number(ctx.get("maxY"));

      const x = round(minX + (maxX - minX) * fx);
      const y = round(minY + (maxY - minY) * fy);

      paint(px, py);
      ctx.set("x", x);
      ctx.set("y", y);

      pending = { x: x, y: y };
      if (final) {
        // The last position must be exact: whatever is downstream ends up
        // where the operator let go, not one frame short of it.
        flush();
      } else {
        schedule();
      }
    }

    // A drag fires far more often than anything needs; one send per frame is
    // plenty and keeps a busy surface from flooding the network. Where there
    // are no frames -- outside a browser -- every move sends, which is what a
    // test wants anyway.
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
    const cancelRaf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : null;

    function schedule() {
      if (!raf) return flush();
      if (frame) return;
      frame = raf(function () {
        frame = null;
        flush();
      });
    }

    function flush() {
      if (frame && cancelRaf) {
        cancelRaf(frame);
        frame = null;
      }
      if (!pending) return;

      const values = pending;
      pending = null;

      const config = routing(ctx);
      const units = [
        unitOf(values.x, ctx.get("minX"), ctx.get("maxX")),
        unitOf(values.y, ctx.get("minY"), ctx.get("maxY")),
      ];

      if (ctx.get("sendMode") === "two") {
        // Two OSC messages, but one DMX frame: pan and tilt are one position
        // on a moving head, and a half-updated block would swing it through
        // somewhere nobody pointed at.
        const osc = only(config, "osc");
        ctx.send(outgoing(osc && Object.assign({}, osc, { message: config.message + "/x" }), values.x));
        ctx.send(outgoing(osc && Object.assign({}, osc, { message: config.message + "/y" }), values.y));
        ctx.send(outgoing(only(config, "dmx"), null, units));
      } else {
        ctx.send(outgoing(config, [values.x, values.y], units));
      }
      // One position for the other devices, whichever way it went out.
      share(ctx, { x: values.x, y: values.y });
    }

    /** The address, or pair of addresses, the pad answers to. */
    function addresses() {
      const message = ctx.get("message");
      if (ctx.get("sendMode") === "two") return [message + "/x", message + "/y"];
      return message;
    }

    /**
     * Take a position the rig sent: one message with both values, or one
     * axis at a time. Stores it and moves the handle through place(), the
     * view-only path -- a value that came in must never go back out. Then
     * has the position recorded as heard: the other devices were sent the
     * same message, so nobody needs telling, but a device joining later
     * starts where the rig left the handle.
     */
    function adopt(values, address) {
      // The finger outranks the rig for as long as it is down.
      if (dragging) return;

      if (ctx.get("sendMode") === "two") {
        const value = toNumber(values[0]);
        if (value === null) return;
        const axis = address === ctx.get("message") + "/x" ? "x" : "y";
        ctx.set(axis, within(value, ctx.get("min" + axis.toUpperCase()), ctx.get("max" + axis.toUpperCase())));
      } else {
        const x = toNumber(values[0]);
        const y = toNumber(values[1]);
        // Half a position is no position; a handle moved along one axis
        // only would misreport the other.
        if (x === null || y === null) return;
        ctx.set("x", within(x, ctx.get("minX"), ctx.get("maxX")));
        ctx.set("y", within(y, ctx.get("minY"), ctx.get("maxY")));
      }
      place();
      share(ctx, { x: ctx.get("x"), y: ctx.get("y") }, { heard: true });
    }

    /**
     * Take the position another device shows. Never shared again: it came
     * from there. The record is merged from everything ever shared for this
     * pad, so each axis is taken on its own; one that cannot be read is
     * left where it is rather than guessed at.
     */
    function adoptShared(state) {
      if (dragging) return;
      const x = toNumber(state.x);
      const y = toNumber(state.y);
      if (x === null && y === null) return;
      if (x !== null) ctx.set("x", within(x, ctx.get("minX"), ctx.get("maxX")));
      if (y !== null) ctx.set("y", within(y, ctx.get("minY"), ctx.get("maxY")));
      place();
    }

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    // Guarded so the widget can be exercised outside a browser.
    const root = typeof window === "undefined" ? null : window;
    if (root) root.addEventListener("blur", onBlur);
    const stop = ctx.onChange(["minX", "maxX", "minY", "maxY", "invertX", "invertY"], place);
    // The handle position is an inline property, which goes when the host
    // rewrites the element's attributes; the stored x and y put it back.
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(place) : null;
    const stopOsc = follow(ctx, adopt, addresses);
    const stopShared = onShared(ctx, adoptShared);

    return function detach() {
      if (frame && cancelRaf) cancelRaf(frame);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      if (root) root.removeEventListener("blur", onBlur);
      if (stop) stop();
      if (stopRewrite) stopRewrite();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

/** Keep a received value inside an axis's range, so handle and value agree. */
function within(value, min, max) {
  const lo = toNumber(min);
  const hi = toNumber(max);
  if (lo === null || hi === null) return value;
  return clamp(value, Math.min(lo, hi), Math.max(lo, hi));
}

module.exports = { xypad, SEND_MODES };

},{"../dmx/levels":1,"../osc-args":6,"./fields":17,"./incoming":18,"./outgoing":23,"./shared":25}],30:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],31:[function(require,module,exports){
/*!
 * jquery-confirm v3.3.4 (http://craftpip.github.io/jquery-confirm/)
 * Author: Boniface Pereira
 * Website: www.craftpip.com
 * Contact: hey@craftpip.com
 *
 * Copyright 2013-2019 jquery-confirm
 * Licensed under MIT (https://github.com/craftpip/jquery-confirm/blob/master/LICENSE)
 */
(function(factory){if(typeof define==="function"&&define.amd){define(["jquery"],factory);}else{if(typeof module==="object"&&module.exports){module.exports=function(root,jQuery){if(jQuery===undefined){if(typeof window!=="undefined"){jQuery=require("jquery");}else{jQuery=require("jquery")(root);}}factory(jQuery);return jQuery;};}else{factory(jQuery);}}}(function($){var w=window;$.fn.confirm=function(options,option2){if(typeof options==="undefined"){options={};}if(typeof options==="string"){options={content:options,title:(option2)?option2:false};}$(this).each(function(){var $this=$(this);if($this.attr("jc-attached")){console.warn("jConfirm has already been attached to this element ",$this[0]);return;}$this.on("click",function(e){e.preventDefault();var jcOption=$.extend({},options);if($this.attr("data-title")){jcOption.title=$this.attr("data-title");}if($this.attr("data-content")){jcOption.content=$this.attr("data-content");}if(typeof jcOption.buttons==="undefined"){jcOption.buttons={};}jcOption["$target"]=$this;if($this.attr("href")&&Object.keys(jcOption.buttons).length===0){var buttons=$.extend(true,{},w.jconfirm.pluginDefaults.defaultButtons,(w.jconfirm.defaults||{}).defaultButtons||{});var firstBtn=Object.keys(buttons)[0];jcOption.buttons=buttons;jcOption.buttons[firstBtn].action=function(){location.href=$this.attr("href");};}jcOption.closeIcon=false;var instance=$.confirm(jcOption);});$this.attr("jc-attached",true);});return $(this);};$.confirm=function(options,option2){if(typeof options==="undefined"){options={};}if(typeof options==="string"){options={content:options,title:(option2)?option2:false};}var putDefaultButtons=!(options.buttons===false);if(typeof options.buttons!=="object"){options.buttons={};}if(Object.keys(options.buttons).length===0&&putDefaultButtons){var buttons=$.extend(true,{},w.jconfirm.pluginDefaults.defaultButtons,(w.jconfirm.defaults||{}).defaultButtons||{});options.buttons=buttons;}return w.jconfirm(options);};$.alert=function(options,option2){if(typeof options==="undefined"){options={};}if(typeof options==="string"){options={content:options,title:(option2)?option2:false};}var putDefaultButtons=!(options.buttons===false);if(typeof options.buttons!=="object"){options.buttons={};}if(Object.keys(options.buttons).length===0&&putDefaultButtons){var buttons=$.extend(true,{},w.jconfirm.pluginDefaults.defaultButtons,(w.jconfirm.defaults||{}).defaultButtons||{});var firstBtn=Object.keys(buttons)[0];options.buttons[firstBtn]=buttons[firstBtn];}return w.jconfirm(options);};$.dialog=function(options,option2){if(typeof options==="undefined"){options={};}if(typeof options==="string"){options={content:options,title:(option2)?option2:false,closeIcon:function(){}};}options.buttons={};if(typeof options.closeIcon==="undefined"){options.closeIcon=function(){};}options.confirmKeys=[13];return w.jconfirm(options);};w.jconfirm=function(options){if(typeof options==="undefined"){options={};}var pluginOptions=$.extend(true,{},w.jconfirm.pluginDefaults);if(w.jconfirm.defaults){pluginOptions=$.extend(true,pluginOptions,w.jconfirm.defaults);}pluginOptions=$.extend(true,{},pluginOptions,options);var instance=new w.Jconfirm(pluginOptions);w.jconfirm.instances.push(instance);return instance;};w.Jconfirm=function(options){$.extend(this,options);this._init();};w.Jconfirm.prototype={_init:function(){var that=this;if(!w.jconfirm.instances.length){w.jconfirm.lastFocused=$("body").find(":focus");}this._id=Math.round(Math.random()*99999);this.contentParsed=$(document.createElement("div"));if(!this.lazyOpen){setTimeout(function(){that.open();},0);}},_buildHTML:function(){var that=this;this._parseAnimation(this.animation,"o");this._parseAnimation(this.closeAnimation,"c");this._parseBgDismissAnimation(this.backgroundDismissAnimation);this._parseColumnClass(this.columnClass);this._parseTheme(this.theme);this._parseType(this.type);var template=$(this.template);template.find(".jconfirm-box").addClass(this.animationParsed).addClass(this.backgroundDismissAnimationParsed).addClass(this.typeParsed);if(this.typeAnimated){template.find(".jconfirm-box").addClass("jconfirm-type-animated");}if(this.useBootstrap){template.find(".jc-bs3-row").addClass(this.bootstrapClasses.row);template.find(".jc-bs3-row").addClass("justify-content-md-center justify-content-sm-center justify-content-xs-center justify-content-lg-center");template.find(".jconfirm-box-container").addClass(this.columnClassParsed);if(this.containerFluid){template.find(".jc-bs3-container").addClass(this.bootstrapClasses.containerFluid);}else{template.find(".jc-bs3-container").addClass(this.bootstrapClasses.container);}}else{template.find(".jconfirm-box").css("width",this.boxWidth);}if(this.titleClass){template.find(".jconfirm-title-c").addClass(this.titleClass);}template.addClass(this.themeParsed);var ariaLabel="jconfirm-box"+this._id;template.find(".jconfirm-box").attr("aria-labelledby",ariaLabel).attr("tabindex",-1);template.find(".jconfirm-content").attr("id",ariaLabel);if(this.bgOpacity!==null){template.find(".jconfirm-bg").css("opacity",this.bgOpacity);}if(this.rtl){template.addClass("jconfirm-rtl");}this.$el=template.appendTo(this.container);this.$jconfirmBoxContainer=this.$el.find(".jconfirm-box-container");this.$jconfirmBox=this.$body=this.$el.find(".jconfirm-box");this.$jconfirmBg=this.$el.find(".jconfirm-bg");this.$title=this.$el.find(".jconfirm-title");this.$titleContainer=this.$el.find(".jconfirm-title-c");this.$content=this.$el.find("div.jconfirm-content");this.$contentPane=this.$el.find(".jconfirm-content-pane");this.$icon=this.$el.find(".jconfirm-icon-c");this.$closeIcon=this.$el.find(".jconfirm-closeIcon");this.$holder=this.$el.find(".jconfirm-holder");this.$btnc=this.$el.find(".jconfirm-buttons");this.$scrollPane=this.$el.find(".jconfirm-scrollpane");that.setStartingPoint();this._contentReady=$.Deferred();this._modalReady=$.Deferred();this.$holder.css({"padding-top":this.offsetTop,"padding-bottom":this.offsetBottom,});this.setTitle();this.setIcon();this._setButtons();this._parseContent();this.initDraggable();if(this.isAjax){this.showLoading(false);}$.when(this._contentReady,this._modalReady).then(function(){if(that.isAjaxLoading){setTimeout(function(){that.isAjaxLoading=false;that.setContent();that.setTitle();that.setIcon();setTimeout(function(){that.hideLoading(false);that._updateContentMaxHeight();},100);if(typeof that.onContentReady==="function"){that.onContentReady();}},50);}else{that._updateContentMaxHeight();that.setTitle();that.setIcon();if(typeof that.onContentReady==="function"){that.onContentReady();}}if(that.autoClose){that._startCountDown();}}).then(function(){that._watchContent();});if(this.animation==="none"){this.animationSpeed=1;this.animationBounce=1;}this.$body.css(this._getCSS(this.animationSpeed,this.animationBounce));this.$contentPane.css(this._getCSS(this.animationSpeed,1));this.$jconfirmBg.css(this._getCSS(this.animationSpeed,1));this.$jconfirmBoxContainer.css(this._getCSS(this.animationSpeed,1));},_typePrefix:"jconfirm-type-",typeParsed:"",_parseType:function(type){this.typeParsed=this._typePrefix+type;},setType:function(type){var oldClass=this.typeParsed;this._parseType(type);this.$jconfirmBox.removeClass(oldClass).addClass(this.typeParsed);},themeParsed:"",_themePrefix:"jconfirm-",setTheme:function(theme){var previous=this.theme;this.theme=theme||this.theme;this._parseTheme(this.theme);if(previous){this.$el.removeClass(previous);}this.$el.addClass(this.themeParsed);this.theme=theme;},_parseTheme:function(theme){var that=this;theme=theme.split(",");$.each(theme,function(k,a){if(a.indexOf(that._themePrefix)===-1){theme[k]=that._themePrefix+$.trim(a);}});this.themeParsed=theme.join(" ").toLowerCase();},backgroundDismissAnimationParsed:"",_bgDismissPrefix:"jconfirm-hilight-",_parseBgDismissAnimation:function(bgDismissAnimation){var animation=bgDismissAnimation.split(",");var that=this;$.each(animation,function(k,a){if(a.indexOf(that._bgDismissPrefix)===-1){animation[k]=that._bgDismissPrefix+$.trim(a);}});this.backgroundDismissAnimationParsed=animation.join(" ").toLowerCase();},animationParsed:"",closeAnimationParsed:"",_animationPrefix:"jconfirm-animation-",setAnimation:function(animation){this.animation=animation||this.animation;this._parseAnimation(this.animation,"o");},_parseAnimation:function(animation,which){which=which||"o";var animations=animation.split(",");var that=this;$.each(animations,function(k,a){if(a.indexOf(that._animationPrefix)===-1){animations[k]=that._animationPrefix+$.trim(a);}});var a_string=animations.join(" ").toLowerCase();if(which==="o"){this.animationParsed=a_string;}else{this.closeAnimationParsed=a_string;}return a_string;},setCloseAnimation:function(closeAnimation){this.closeAnimation=closeAnimation||this.closeAnimation;this._parseAnimation(this.closeAnimation,"c");},setAnimationSpeed:function(speed){this.animationSpeed=speed||this.animationSpeed;},columnClassParsed:"",setColumnClass:function(colClass){if(!this.useBootstrap){console.warn("cannot set columnClass, useBootstrap is set to false");return;}this.columnClass=colClass||this.columnClass;this._parseColumnClass(this.columnClass);this.$jconfirmBoxContainer.addClass(this.columnClassParsed);},_updateContentMaxHeight:function(){var height=$(window).height()-(this.$jconfirmBox.outerHeight()-this.$contentPane.outerHeight())-(this.offsetTop+this.offsetBottom);this.$contentPane.css({"max-height":height+"px"});},setBoxWidth:function(width){if(this.useBootstrap){console.warn("cannot set boxWidth, useBootstrap is set to true");return;}this.boxWidth=width;this.$jconfirmBox.css("width",width);},_parseColumnClass:function(colClass){colClass=colClass.toLowerCase();var p;switch(colClass){case"xl":case"xlarge":p="col-md-12";break;case"l":case"large":p="col-md-8 col-md-offset-2";break;case"m":case"medium":p="col-md-6 col-md-offset-3";break;case"s":case"small":p="col-md-4 col-md-offset-4";break;case"xs":case"xsmall":p="col-md-2 col-md-offset-5";break;default:p=colClass;}this.columnClassParsed=p;},initDraggable:function(){var that=this;var $t=this.$titleContainer;this.resetDrag();if(this.draggable){$t.on("mousedown",function(e){$t.addClass("jconfirm-hand");that.mouseX=e.clientX;that.mouseY=e.clientY;that.isDrag=true;});$(window).on("mousemove."+this._id,function(e){if(that.isDrag){that.movingX=e.clientX-that.mouseX+that.initialX;that.movingY=e.clientY-that.mouseY+that.initialY;that.setDrag();}});$(window).on("mouseup."+this._id,function(){$t.removeClass("jconfirm-hand");if(that.isDrag){that.isDrag=false;that.initialX=that.movingX;that.initialY=that.movingY;}});}},resetDrag:function(){this.isDrag=false;this.initialX=0;this.initialY=0;this.movingX=0;this.movingY=0;this.mouseX=0;this.mouseY=0;this.$jconfirmBoxContainer.css("transform","translate("+0+"px, "+0+"px)");},setDrag:function(){if(!this.draggable){return;}this.alignMiddle=false;var boxWidth=this.$jconfirmBox.outerWidth();var boxHeight=this.$jconfirmBox.outerHeight();var windowWidth=$(window).width();var windowHeight=$(window).height();var that=this;var dragUpdate=1;if(that.movingX%dragUpdate===0||that.movingY%dragUpdate===0){if(that.dragWindowBorder){var leftDistance=(windowWidth/2)-boxWidth/2;var topDistance=(windowHeight/2)-boxHeight/2;topDistance-=that.dragWindowGap;leftDistance-=that.dragWindowGap;if(leftDistance+that.movingX<0){that.movingX=-leftDistance;}else{if(leftDistance-that.movingX<0){that.movingX=leftDistance;}}if(topDistance+that.movingY<0){that.movingY=-topDistance;}else{if(topDistance-that.movingY<0){that.movingY=topDistance;}}}that.$jconfirmBoxContainer.css("transform","translate("+that.movingX+"px, "+that.movingY+"px)");}},_scrollTop:function(){if(typeof pageYOffset!=="undefined"){return pageYOffset;}else{var B=document.body;var D=document.documentElement;D=(D.clientHeight)?D:B;return D.scrollTop;}},_watchContent:function(){var that=this;if(this._timer){clearInterval(this._timer);}var prevContentHeight=0;this._timer=setInterval(function(){if(that.smoothContent){var contentHeight=that.$content.outerHeight()||0;if(contentHeight!==prevContentHeight){prevContentHeight=contentHeight;}var wh=$(window).height();var total=that.offsetTop+that.offsetBottom+that.$jconfirmBox.height()-that.$contentPane.height()+that.$content.height();if(total<wh){that.$contentPane.addClass("no-scroll");}else{that.$contentPane.removeClass("no-scroll");}}},this.watchInterval);},_overflowClass:"jconfirm-overflow",_hilightAnimating:false,highlight:function(){this.hiLightModal();},hiLightModal:function(){var that=this;if(this._hilightAnimating){return;}that.$body.addClass("hilight");var duration=parseFloat(that.$body.css("animation-duration"))||2;this._hilightAnimating=true;setTimeout(function(){that._hilightAnimating=false;that.$body.removeClass("hilight");},duration*1000);},_bindEvents:function(){var that=this;this.boxClicked=false;this.$scrollPane.click(function(e){if(!that.boxClicked){var buttonName=false;var shouldClose=false;var str;if(typeof that.backgroundDismiss==="function"){str=that.backgroundDismiss();}else{str=that.backgroundDismiss;}if(typeof str==="string"&&typeof that.buttons[str]!=="undefined"){buttonName=str;shouldClose=false;}else{if(typeof str==="undefined"||!!(str)===true){shouldClose=true;}else{shouldClose=false;}}if(buttonName){var btnResponse=that.buttons[buttonName].action.apply(that);shouldClose=(typeof btnResponse==="undefined")||!!(btnResponse);}if(shouldClose){that.close();}else{that.hiLightModal();}}that.boxClicked=false;});this.$jconfirmBox.click(function(e){that.boxClicked=true;});var isKeyDown=false;$(window).on("jcKeyDown."+that._id,function(e){if(!isKeyDown){isKeyDown=true;}});$(window).on("keyup."+that._id,function(e){if(isKeyDown){that.reactOnKey(e);isKeyDown=false;}});$(window).on("resize."+this._id,function(){that._updateContentMaxHeight();setTimeout(function(){that.resetDrag();},100);});},_cubic_bezier:"0.36, 0.55, 0.19",_getCSS:function(speed,bounce){return{"-webkit-transition-duration":speed/1000+"s","transition-duration":speed/1000+"s","-webkit-transition-timing-function":"cubic-bezier("+this._cubic_bezier+", "+bounce+")","transition-timing-function":"cubic-bezier("+this._cubic_bezier+", "+bounce+")"};},_setButtons:function(){var that=this;var total_buttons=0;if(typeof this.buttons!=="object"){this.buttons={};}$.each(this.buttons,function(key,button){total_buttons+=1;if(typeof button==="function"){that.buttons[key]=button={action:button};}that.buttons[key].text=button.text||key;that.buttons[key].btnClass=button.btnClass||"btn-default";that.buttons[key].action=button.action||function(){};that.buttons[key].keys=button.keys||[];that.buttons[key].isHidden=button.isHidden||false;that.buttons[key].isDisabled=button.isDisabled||false;$.each(that.buttons[key].keys,function(i,a){that.buttons[key].keys[i]=a.toLowerCase();});var button_element=$('<button type="button" class="btn"></button>').html(that.buttons[key].text).addClass(that.buttons[key].btnClass).prop("disabled",that.buttons[key].isDisabled).css("display",that.buttons[key].isHidden?"none":"").click(function(e){e.preventDefault();var res=that.buttons[key].action.apply(that,[that.buttons[key]]);that.onAction.apply(that,[key,that.buttons[key]]);that._stopCountDown();if(typeof res==="undefined"||res){that.close();}});that.buttons[key].el=button_element;that.buttons[key].setText=function(text){button_element.html(text);};that.buttons[key].addClass=function(className){button_element.addClass(className);};that.buttons[key].removeClass=function(className){button_element.removeClass(className);};that.buttons[key].disable=function(){that.buttons[key].isDisabled=true;button_element.prop("disabled",true);};that.buttons[key].enable=function(){that.buttons[key].isDisabled=false;button_element.prop("disabled",false);};that.buttons[key].show=function(){that.buttons[key].isHidden=false;button_element.css("display","");};that.buttons[key].hide=function(){that.buttons[key].isHidden=true;button_element.css("display","none");};that["$_"+key]=that["$$"+key]=button_element;that.$btnc.append(button_element);});if(total_buttons===0){this.$btnc.hide();}if(this.closeIcon===null&&total_buttons===0){this.closeIcon=true;}if(this.closeIcon){if(this.closeIconClass){var closeHtml='<i class="'+this.closeIconClass+'"></i>';this.$closeIcon.html(closeHtml);}this.$closeIcon.click(function(e){e.preventDefault();var buttonName=false;var shouldClose=false;var str;if(typeof that.closeIcon==="function"){str=that.closeIcon();}else{str=that.closeIcon;}if(typeof str==="string"&&typeof that.buttons[str]!=="undefined"){buttonName=str;shouldClose=false;}else{if(typeof str==="undefined"||!!(str)===true){shouldClose=true;}else{shouldClose=false;}}if(buttonName){var btnResponse=that.buttons[buttonName].action.apply(that);shouldClose=(typeof btnResponse==="undefined")||!!(btnResponse);}if(shouldClose){that.close();}});this.$closeIcon.show();}else{this.$closeIcon.hide();}},setTitle:function(string,force){force=force||false;if(typeof string!=="undefined"){if(typeof string==="string"){this.title=string;}else{if(typeof string==="function"){if(typeof string.promise==="function"){console.error("Promise was returned from title function, this is not supported.");}var response=string();if(typeof response==="string"){this.title=response;}else{this.title=false;}}else{this.title=false;}}}if(this.isAjaxLoading&&!force){return;}this.$title.html(this.title||"");this.updateTitleContainer();},setIcon:function(iconClass,force){force=force||false;if(typeof iconClass!=="undefined"){if(typeof iconClass==="string"){this.icon=iconClass;}else{if(typeof iconClass==="function"){var response=iconClass();if(typeof response==="string"){this.icon=response;}else{this.icon=false;}}else{this.icon=false;}}}if(this.isAjaxLoading&&!force){return;}this.$icon.html(this.icon?'<i class="'+this.icon+'"></i>':"");this.updateTitleContainer();},updateTitleContainer:function(){if(!this.title&&!this.icon){this.$titleContainer.hide();}else{this.$titleContainer.show();}},setContentPrepend:function(content,force){if(!content){return;}this.contentParsed.prepend(content);},setContentAppend:function(content){if(!content){return;}this.contentParsed.append(content);},setContent:function(content,force){force=!!force;var that=this;if(content){this.contentParsed.html("").append(content);}if(this.isAjaxLoading&&!force){return;}this.$content.html("");this.$content.append(this.contentParsed);setTimeout(function(){that.$body.find("input[autofocus]:visible:first").focus();},100);},loadingSpinner:false,showLoading:function(disableButtons){this.loadingSpinner=true;this.$jconfirmBox.addClass("loading");if(disableButtons){this.$btnc.find("button").prop("disabled",true);}},hideLoading:function(enableButtons){this.loadingSpinner=false;this.$jconfirmBox.removeClass("loading");if(enableButtons){this.$btnc.find("button").prop("disabled",false);}},ajaxResponse:false,contentParsed:"",isAjax:false,isAjaxLoading:false,_parseContent:function(){var that=this;var e="&nbsp;";if(typeof this.content==="function"){var res=this.content.apply(this);if(typeof res==="string"){this.content=res;}else{if(typeof res==="object"&&typeof res.always==="function"){this.isAjax=true;this.isAjaxLoading=true;res.always(function(data,status,xhr){that.ajaxResponse={data:data,status:status,xhr:xhr};that._contentReady.resolve(data,status,xhr);if(typeof that.contentLoaded==="function"){that.contentLoaded(data,status,xhr);}});this.content=e;}else{this.content=e;}}}if(typeof this.content==="string"&&this.content.substr(0,4).toLowerCase()==="url:"){this.isAjax=true;this.isAjaxLoading=true;var u=this.content.substring(4,this.content.length);$.get(u).done(function(html){that.contentParsed.html(html);}).always(function(data,status,xhr){that.ajaxResponse={data:data,status:status,xhr:xhr};that._contentReady.resolve(data,status,xhr);if(typeof that.contentLoaded==="function"){that.contentLoaded(data,status,xhr);}});}if(!this.content){this.content=e;}if(!this.isAjax){this.contentParsed.html(this.content);this.setContent();that._contentReady.resolve();}},_stopCountDown:function(){clearInterval(this.autoCloseInterval);if(this.$cd){this.$cd.remove();}},_startCountDown:function(){var that=this;var opt=this.autoClose.split("|");if(opt.length!==2){console.error("Invalid option for autoClose. example 'close|10000'");return false;}var button_key=opt[0];var time=parseInt(opt[1]);if(typeof this.buttons[button_key]==="undefined"){console.error("Invalid button key '"+button_key+"' for autoClose");return false;}var seconds=Math.ceil(time/1000);this.$cd=$('<span class="countdown"> ('+seconds+")</span>").appendTo(this["$_"+button_key]);this.autoCloseInterval=setInterval(function(){that.$cd.html(" ("+(seconds-=1)+") ");if(seconds<=0){that["$$"+button_key].trigger("click");that._stopCountDown();}},1000);},_getKey:function(key){switch(key){case 192:return"tilde";case 13:return"enter";case 16:return"shift";case 9:return"tab";case 20:return"capslock";case 17:return"ctrl";case 91:return"win";case 18:return"alt";case 27:return"esc";case 32:return"space";}var initial=String.fromCharCode(key);if(/^[A-z0-9]+$/.test(initial)){return initial.toLowerCase();}else{return false;}},reactOnKey:function(e){var that=this;var a=$(".jconfirm");if(a.eq(a.length-1)[0]!==this.$el[0]){return false;}var key=e.which;if(this.$content.find(":input").is(":focus")&&/13|32/.test(key)){return false;}var keyChar=this._getKey(key);if(keyChar==="esc"&&this.escapeKey){if(this.escapeKey===true){this.$scrollPane.trigger("click");}else{if(typeof this.escapeKey==="string"||typeof this.escapeKey==="function"){var buttonKey;if(typeof this.escapeKey==="function"){buttonKey=this.escapeKey();}else{buttonKey=this.escapeKey;}if(buttonKey){if(typeof this.buttons[buttonKey]==="undefined"){console.warn("Invalid escapeKey, no buttons found with key "+buttonKey);}else{this["$_"+buttonKey].trigger("click");}}}}}$.each(this.buttons,function(key,button){if(button.keys.indexOf(keyChar)!==-1){that["$_"+key].trigger("click");}});},setDialogCenter:function(){console.info("setDialogCenter is deprecated, dialogs are centered with CSS3 tables");},_unwatchContent:function(){clearInterval(this._timer);},close:function(onClosePayload){var that=this;if(typeof this.onClose==="function"){this.onClose(onClosePayload);}this._unwatchContent();$(window).unbind("resize."+this._id);$(window).unbind("keyup."+this._id);$(window).unbind("jcKeyDown."+this._id);if(this.draggable){$(window).unbind("mousemove."+this._id);$(window).unbind("mouseup."+this._id);this.$titleContainer.unbind("mousedown");}that.$el.removeClass(that.loadedClass);$("body").removeClass("jconfirm-no-scroll-"+that._id);that.$jconfirmBoxContainer.removeClass("jconfirm-no-transition");setTimeout(function(){that.$body.addClass(that.closeAnimationParsed);that.$jconfirmBg.addClass("jconfirm-bg-h");var closeTimer=(that.closeAnimation==="none")?1:that.animationSpeed;setTimeout(function(){that.$el.remove();var l=w.jconfirm.instances;var i=w.jconfirm.instances.length-1;for(i;i>=0;i--){if(w.jconfirm.instances[i]._id===that._id){w.jconfirm.instances.splice(i,1);}}if(!w.jconfirm.instances.length){if(that.scrollToPreviousElement&&w.jconfirm.lastFocused&&w.jconfirm.lastFocused.length&&$.contains(document,w.jconfirm.lastFocused[0])){var $lf=w.jconfirm.lastFocused;if(that.scrollToPreviousElementAnimate){var st=$(window).scrollTop();var ot=w.jconfirm.lastFocused.offset().top;var wh=$(window).height();if(!(ot>st&&ot<(st+wh))){var scrollTo=(ot-Math.round((wh/3)));$("html, body").animate({scrollTop:scrollTo},that.animationSpeed,"swing",function(){$lf.focus();});}else{$lf.focus();}}else{$lf.focus();}w.jconfirm.lastFocused=false;}}if(typeof that.onDestroy==="function"){that.onDestroy();}},closeTimer*0.4);},50);return true;},open:function(){if(this.isOpen()){return false;}this._buildHTML();this._bindEvents();this._open();return true;},setStartingPoint:function(){var el=false;if(this.animateFromElement!==true&&this.animateFromElement){el=this.animateFromElement;w.jconfirm.lastClicked=false;}else{if(w.jconfirm.lastClicked&&this.animateFromElement===true){el=w.jconfirm.lastClicked;w.jconfirm.lastClicked=false;}else{return false;}}if(!el){return false;}var offset=el.offset();var iTop=el.outerHeight()/2;var iLeft=el.outerWidth()/2;iTop-=this.$jconfirmBox.outerHeight()/2;iLeft-=this.$jconfirmBox.outerWidth()/2;var sourceTop=offset.top+iTop;sourceTop=sourceTop-this._scrollTop();var sourceLeft=offset.left+iLeft;var wh=$(window).height()/2;var ww=$(window).width()/2;var targetH=wh-this.$jconfirmBox.outerHeight()/2;var targetW=ww-this.$jconfirmBox.outerWidth()/2;sourceTop-=targetH;sourceLeft-=targetW;if(Math.abs(sourceTop)>wh||Math.abs(sourceLeft)>ww){return false;}this.$jconfirmBoxContainer.css("transform","translate("+sourceLeft+"px, "+sourceTop+"px)");},_open:function(){var that=this;if(typeof that.onOpenBefore==="function"){that.onOpenBefore();}this.$body.removeClass(this.animationParsed);this.$jconfirmBg.removeClass("jconfirm-bg-h");this.$body.focus();that.$jconfirmBoxContainer.css("transform","translate("+0+"px, "+0+"px)");setTimeout(function(){that.$body.css(that._getCSS(that.animationSpeed,1));that.$body.css({"transition-property":that.$body.css("transition-property")+", margin"});that.$jconfirmBoxContainer.addClass("jconfirm-no-transition");that._modalReady.resolve();if(typeof that.onOpen==="function"){that.onOpen();}that.$el.addClass(that.loadedClass);},this.animationSpeed);},loadedClass:"jconfirm-open",isClosed:function(){return !this.$el||this.$el.parent().length===0;},isOpen:function(){return !this.isClosed();},toggle:function(){if(!this.isOpen()){this.open();}else{this.close();}}};w.jconfirm.instances=[];w.jconfirm.lastFocused=false;w.jconfirm.pluginDefaults={template:'<div class="jconfirm"><div class="jconfirm-bg jconfirm-bg-h"></div><div class="jconfirm-scrollpane"><div class="jconfirm-row"><div class="jconfirm-cell"><div class="jconfirm-holder"><div class="jc-bs3-container"><div class="jc-bs3-row"><div class="jconfirm-box-container jconfirm-animated"><div class="jconfirm-box" role="dialog" aria-labelledby="labelled" tabindex="-1"><div class="jconfirm-closeIcon">&times;</div><div class="jconfirm-title-c"><span class="jconfirm-icon-c"></span><span class="jconfirm-title"></span></div><div class="jconfirm-content-pane"><div class="jconfirm-content"></div></div><div class="jconfirm-buttons"></div><div class="jconfirm-clear"></div></div></div></div></div></div></div></div></div></div>',title:"Hello",titleClass:"",type:"default",typeAnimated:true,draggable:true,dragWindowGap:15,dragWindowBorder:true,animateFromElement:true,alignMiddle:true,smoothContent:true,content:"Are you sure to continue?",buttons:{},defaultButtons:{ok:{action:function(){}},close:{action:function(){}}},contentLoaded:function(){},icon:"",lazyOpen:false,bgOpacity:null,theme:"light",animation:"scale",closeAnimation:"scale",animationSpeed:400,animationBounce:1,escapeKey:true,rtl:false,container:"body",containerFluid:false,backgroundDismiss:false,backgroundDismissAnimation:"shake",autoClose:false,closeIcon:null,closeIconClass:false,watchInterval:100,columnClass:"col-md-4 col-md-offset-4 col-sm-6 col-sm-offset-3 col-xs-10 col-xs-offset-1",boxWidth:"50%",scrollToPreviousElement:true,scrollToPreviousElementAnimate:true,useBootstrap:true,offsetTop:40,offsetBottom:40,bootstrapClasses:{container:"container",containerFluid:"container-fluid",row:"row"},onContentReady:function(){},onOpenBefore:function(){},onOpen:function(){},onClose:function(){},onDestroy:function(){},onAction:function(){}};var keyDown=false;$(window).on("keydown",function(e){if(!keyDown){var $target=$(e.target);var pass=false;if($target.closest(".jconfirm-box").length){pass=true;}if(pass){$(window).trigger("jcKeyDown");}keyDown=true;}});$(window).on("keyup",function(){keyDown=false;});w.jconfirm.lastClicked=false;$(document).on("mousedown","button, a, [jc-source]",function(){w.jconfirm.lastClicked=$(this);});}));
},{"jquery":32}],32:[function(require,module,exports){
/*!
 * jQuery JavaScript Library v3.7.1
 * https://jquery.com/
 *
 * Copyright OpenJS Foundation and other contributors
 * Released under the MIT license
 * https://jquery.org/license
 *
 * Date: 2023-08-28T13:37Z
 */
( function( global, factory ) {

	"use strict";

	if ( typeof module === "object" && typeof module.exports === "object" ) {

		// For CommonJS and CommonJS-like environments where a proper `window`
		// is present, execute the factory and get jQuery.
		// For environments that do not have a `window` with a `document`
		// (such as Node.js), expose a factory as module.exports.
		// This accentuates the need for the creation of a real `window`.
		// e.g. var jQuery = require("jquery")(window);
		// See ticket trac-14549 for more info.
		module.exports = global.document ?
			factory( global, true ) :
			function( w ) {
				if ( !w.document ) {
					throw new Error( "jQuery requires a window with a document" );
				}
				return factory( w );
			};
	} else {
		factory( global );
	}

// Pass this if window is not defined yet
} )( typeof window !== "undefined" ? window : this, function( window, noGlobal ) {

// Edge <= 12 - 13+, Firefox <=18 - 45+, IE 10 - 11, Safari 5.1 - 9+, iOS 6 - 9.1
// throw exceptions when non-strict code (e.g., ASP.NET 4.5) accesses strict mode
// arguments.callee.caller (trac-13335). But as of jQuery 3.0 (2016), strict mode should be common
// enough that all such attempts are guarded in a try block.
"use strict";

var arr = [];

var getProto = Object.getPrototypeOf;

var slice = arr.slice;

var flat = arr.flat ? function( array ) {
	return arr.flat.call( array );
} : function( array ) {
	return arr.concat.apply( [], array );
};


var push = arr.push;

var indexOf = arr.indexOf;

var class2type = {};

var toString = class2type.toString;

var hasOwn = class2type.hasOwnProperty;

var fnToString = hasOwn.toString;

var ObjectFunctionString = fnToString.call( Object );

var support = {};

var isFunction = function isFunction( obj ) {

		// Support: Chrome <=57, Firefox <=52
		// In some browsers, typeof returns "function" for HTML <object> elements
		// (i.e., `typeof document.createElement( "object" ) === "function"`).
		// We don't want to classify *any* DOM node as a function.
		// Support: QtWeb <=3.8.5, WebKit <=534.34, wkhtmltopdf tool <=0.12.5
		// Plus for old WebKit, typeof returns "function" for HTML collections
		// (e.g., `typeof document.getElementsByTagName("div") === "function"`). (gh-4756)
		return typeof obj === "function" && typeof obj.nodeType !== "number" &&
			typeof obj.item !== "function";
	};


var isWindow = function isWindow( obj ) {
		return obj != null && obj === obj.window;
	};


var document = window.document;



	var preservedScriptAttributes = {
		type: true,
		src: true,
		nonce: true,
		noModule: true
	};

	function DOMEval( code, node, doc ) {
		doc = doc || document;

		var i, val,
			script = doc.createElement( "script" );

		script.text = code;
		if ( node ) {
			for ( i in preservedScriptAttributes ) {

				// Support: Firefox 64+, Edge 18+
				// Some browsers don't support the "nonce" property on scripts.
				// On the other hand, just using `getAttribute` is not enough as
				// the `nonce` attribute is reset to an empty string whenever it
				// becomes browsing-context connected.
				// See https://github.com/whatwg/html/issues/2369
				// See https://html.spec.whatwg.org/#nonce-attributes
				// The `node.getAttribute` check was added for the sake of
				// `jQuery.globalEval` so that it can fake a nonce-containing node
				// via an object.
				val = node[ i ] || node.getAttribute && node.getAttribute( i );
				if ( val ) {
					script.setAttribute( i, val );
				}
			}
		}
		doc.head.appendChild( script ).parentNode.removeChild( script );
	}


function toType( obj ) {
	if ( obj == null ) {
		return obj + "";
	}

	// Support: Android <=2.3 only (functionish RegExp)
	return typeof obj === "object" || typeof obj === "function" ?
		class2type[ toString.call( obj ) ] || "object" :
		typeof obj;
}
/* global Symbol */
// Defining this global in .eslintrc.json would create a danger of using the global
// unguarded in another place, it seems safer to define global only for this module



var version = "3.7.1",

	rhtmlSuffix = /HTML$/i,

	// Define a local copy of jQuery
	jQuery = function( selector, context ) {

		// The jQuery object is actually just the init constructor 'enhanced'
		// Need init if jQuery is called (just allow error to be thrown if not included)
		return new jQuery.fn.init( selector, context );
	};

jQuery.fn = jQuery.prototype = {

	// The current version of jQuery being used
	jquery: version,

	constructor: jQuery,

	// The default length of a jQuery object is 0
	length: 0,

	toArray: function() {
		return slice.call( this );
	},

	// Get the Nth element in the matched element set OR
	// Get the whole matched element set as a clean array
	get: function( num ) {

		// Return all the elements in a clean array
		if ( num == null ) {
			return slice.call( this );
		}

		// Return just the one element from the set
		return num < 0 ? this[ num + this.length ] : this[ num ];
	},

	// Take an array of elements and push it onto the stack
	// (returning the new matched element set)
	pushStack: function( elems ) {

		// Build a new jQuery matched element set
		var ret = jQuery.merge( this.constructor(), elems );

		// Add the old object onto the stack (as a reference)
		ret.prevObject = this;

		// Return the newly-formed element set
		return ret;
	},

	// Execute a callback for every element in the matched set.
	each: function( callback ) {
		return jQuery.each( this, callback );
	},

	map: function( callback ) {
		return this.pushStack( jQuery.map( this, function( elem, i ) {
			return callback.call( elem, i, elem );
		} ) );
	},

	slice: function() {
		return this.pushStack( slice.apply( this, arguments ) );
	},

	first: function() {
		return this.eq( 0 );
	},

	last: function() {
		return this.eq( -1 );
	},

	even: function() {
		return this.pushStack( jQuery.grep( this, function( _elem, i ) {
			return ( i + 1 ) % 2;
		} ) );
	},

	odd: function() {
		return this.pushStack( jQuery.grep( this, function( _elem, i ) {
			return i % 2;
		} ) );
	},

	eq: function( i ) {
		var len = this.length,
			j = +i + ( i < 0 ? len : 0 );
		return this.pushStack( j >= 0 && j < len ? [ this[ j ] ] : [] );
	},

	end: function() {
		return this.prevObject || this.constructor();
	},

	// For internal use only.
	// Behaves like an Array's method, not like a jQuery method.
	push: push,
	sort: arr.sort,
	splice: arr.splice
};

jQuery.extend = jQuery.fn.extend = function() {
	var options, name, src, copy, copyIsArray, clone,
		target = arguments[ 0 ] || {},
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if ( typeof target === "boolean" ) {
		deep = target;

		// Skip the boolean and the target
		target = arguments[ i ] || {};
		i++;
	}

	// Handle case when target is a string or something (possible in deep copy)
	if ( typeof target !== "object" && !isFunction( target ) ) {
		target = {};
	}

	// Extend jQuery itself if only one argument is passed
	if ( i === length ) {
		target = this;
		i--;
	}

	for ( ; i < length; i++ ) {

		// Only deal with non-null/undefined values
		if ( ( options = arguments[ i ] ) != null ) {

			// Extend the base object
			for ( name in options ) {
				copy = options[ name ];

				// Prevent Object.prototype pollution
				// Prevent never-ending loop
				if ( name === "__proto__" || target === copy ) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if ( deep && copy && ( jQuery.isPlainObject( copy ) ||
					( copyIsArray = Array.isArray( copy ) ) ) ) {
					src = target[ name ];

					// Ensure proper type for the source value
					if ( copyIsArray && !Array.isArray( src ) ) {
						clone = [];
					} else if ( !copyIsArray && !jQuery.isPlainObject( src ) ) {
						clone = {};
					} else {
						clone = src;
					}
					copyIsArray = false;

					// Never move original objects, clone them
					target[ name ] = jQuery.extend( deep, clone, copy );

				// Don't bring in undefined values
				} else if ( copy !== undefined ) {
					target[ name ] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};

jQuery.extend( {

	// Unique for each copy of jQuery on the page
	expando: "jQuery" + ( version + Math.random() ).replace( /\D/g, "" ),

	// Assume jQuery is ready without the ready module
	isReady: true,

	error: function( msg ) {
		throw new Error( msg );
	},

	noop: function() {},

	isPlainObject: function( obj ) {
		var proto, Ctor;

		// Detect obvious negatives
		// Use toString instead of jQuery.type to catch host objects
		if ( !obj || toString.call( obj ) !== "[object Object]" ) {
			return false;
		}

		proto = getProto( obj );

		// Objects with no prototype (e.g., `Object.create( null )`) are plain
		if ( !proto ) {
			return true;
		}

		// Objects with prototype are plain iff they were constructed by a global Object function
		Ctor = hasOwn.call( proto, "constructor" ) && proto.constructor;
		return typeof Ctor === "function" && fnToString.call( Ctor ) === ObjectFunctionString;
	},

	isEmptyObject: function( obj ) {
		var name;

		for ( name in obj ) {
			return false;
		}
		return true;
	},

	// Evaluates a script in a provided context; falls back to the global one
	// if not specified.
	globalEval: function( code, options, doc ) {
		DOMEval( code, { nonce: options && options.nonce }, doc );
	},

	each: function( obj, callback ) {
		var length, i = 0;

		if ( isArrayLike( obj ) ) {
			length = obj.length;
			for ( ; i < length; i++ ) {
				if ( callback.call( obj[ i ], i, obj[ i ] ) === false ) {
					break;
				}
			}
		} else {
			for ( i in obj ) {
				if ( callback.call( obj[ i ], i, obj[ i ] ) === false ) {
					break;
				}
			}
		}

		return obj;
	},


	// Retrieve the text value of an array of DOM nodes
	text: function( elem ) {
		var node,
			ret = "",
			i = 0,
			nodeType = elem.nodeType;

		if ( !nodeType ) {

			// If no nodeType, this is expected to be an array
			while ( ( node = elem[ i++ ] ) ) {

				// Do not traverse comment nodes
				ret += jQuery.text( node );
			}
		}
		if ( nodeType === 1 || nodeType === 11 ) {
			return elem.textContent;
		}
		if ( nodeType === 9 ) {
			return elem.documentElement.textContent;
		}
		if ( nodeType === 3 || nodeType === 4 ) {
			return elem.nodeValue;
		}

		// Do not include comment or processing instruction nodes

		return ret;
	},

	// results is for internal usage only
	makeArray: function( arr, results ) {
		var ret = results || [];

		if ( arr != null ) {
			if ( isArrayLike( Object( arr ) ) ) {
				jQuery.merge( ret,
					typeof arr === "string" ?
						[ arr ] : arr
				);
			} else {
				push.call( ret, arr );
			}
		}

		return ret;
	},

	inArray: function( elem, arr, i ) {
		return arr == null ? -1 : indexOf.call( arr, elem, i );
	},

	isXMLDoc: function( elem ) {
		var namespace = elem && elem.namespaceURI,
			docElem = elem && ( elem.ownerDocument || elem ).documentElement;

		// Assume HTML when documentElement doesn't yet exist, such as inside
		// document fragments.
		return !rhtmlSuffix.test( namespace || docElem && docElem.nodeName || "HTML" );
	},

	// Support: Android <=4.0 only, PhantomJS 1 only
	// push.apply(_, arraylike) throws on ancient WebKit
	merge: function( first, second ) {
		var len = +second.length,
			j = 0,
			i = first.length;

		for ( ; j < len; j++ ) {
			first[ i++ ] = second[ j ];
		}

		first.length = i;

		return first;
	},

	grep: function( elems, callback, invert ) {
		var callbackInverse,
			matches = [],
			i = 0,
			length = elems.length,
			callbackExpect = !invert;

		// Go through the array, only saving the items
		// that pass the validator function
		for ( ; i < length; i++ ) {
			callbackInverse = !callback( elems[ i ], i );
			if ( callbackInverse !== callbackExpect ) {
				matches.push( elems[ i ] );
			}
		}

		return matches;
	},

	// arg is for internal usage only
	map: function( elems, callback, arg ) {
		var length, value,
			i = 0,
			ret = [];

		// Go through the array, translating each of the items to their new values
		if ( isArrayLike( elems ) ) {
			length = elems.length;
			for ( ; i < length; i++ ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret.push( value );
				}
			}

		// Go through every key on the object,
		} else {
			for ( i in elems ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret.push( value );
				}
			}
		}

		// Flatten any nested arrays
		return flat( ret );
	},

	// A global GUID counter for objects
	guid: 1,

	// jQuery.support is not used in Core but other projects attach their
	// properties to it so it needs to exist.
	support: support
} );

if ( typeof Symbol === "function" ) {
	jQuery.fn[ Symbol.iterator ] = arr[ Symbol.iterator ];
}

// Populate the class2type map
jQuery.each( "Boolean Number String Function Array Date RegExp Object Error Symbol".split( " " ),
	function( _i, name ) {
		class2type[ "[object " + name + "]" ] = name.toLowerCase();
	} );

function isArrayLike( obj ) {

	// Support: real iOS 8.2 only (not reproducible in simulator)
	// `in` check used to prevent JIT error (gh-2145)
	// hasOwn isn't used here due to false negatives
	// regarding Nodelist length in IE
	var length = !!obj && "length" in obj && obj.length,
		type = toType( obj );

	if ( isFunction( obj ) || isWindow( obj ) ) {
		return false;
	}

	return type === "array" || length === 0 ||
		typeof length === "number" && length > 0 && ( length - 1 ) in obj;
}


function nodeName( elem, name ) {

	return elem.nodeName && elem.nodeName.toLowerCase() === name.toLowerCase();

}
var pop = arr.pop;


var sort = arr.sort;


var splice = arr.splice;


var whitespace = "[\\x20\\t\\r\\n\\f]";


var rtrimCSS = new RegExp(
	"^" + whitespace + "+|((?:^|[^\\\\])(?:\\\\.)*)" + whitespace + "+$",
	"g"
);




// Note: an element does not contain itself
jQuery.contains = function( a, b ) {
	var bup = b && b.parentNode;

	return a === bup || !!( bup && bup.nodeType === 1 && (

		// Support: IE 9 - 11+
		// IE doesn't have `contains` on SVG.
		a.contains ?
			a.contains( bup ) :
			a.compareDocumentPosition && a.compareDocumentPosition( bup ) & 16
	) );
};




// CSS string/identifier serialization
// https://drafts.csswg.org/cssom/#common-serializing-idioms
var rcssescape = /([\0-\x1f\x7f]|^-?\d)|^-$|[^\x80-\uFFFF\w-]/g;

function fcssescape( ch, asCodePoint ) {
	if ( asCodePoint ) {

		// U+0000 NULL becomes U+FFFD REPLACEMENT CHARACTER
		if ( ch === "\0" ) {
			return "\uFFFD";
		}

		// Control characters and (dependent upon position) numbers get escaped as code points
		return ch.slice( 0, -1 ) + "\\" + ch.charCodeAt( ch.length - 1 ).toString( 16 ) + " ";
	}

	// Other potentially-special ASCII characters get backslash-escaped
	return "\\" + ch;
}

jQuery.escapeSelector = function( sel ) {
	return ( sel + "" ).replace( rcssescape, fcssescape );
};




var preferredDoc = document,
	pushNative = push;

( function() {

var i,
	Expr,
	outermostContext,
	sortInput,
	hasDuplicate,
	push = pushNative,

	// Local document vars
	document,
	documentElement,
	documentIsHTML,
	rbuggyQSA,
	matches,

	// Instance-specific data
	expando = jQuery.expando,
	dirruns = 0,
	done = 0,
	classCache = createCache(),
	tokenCache = createCache(),
	compilerCache = createCache(),
	nonnativeSelectorCache = createCache(),
	sortOrder = function( a, b ) {
		if ( a === b ) {
			hasDuplicate = true;
		}
		return 0;
	},

	booleans = "checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|ismap|" +
		"loop|multiple|open|readonly|required|scoped",

	// Regular expressions

	// https://www.w3.org/TR/css-syntax-3/#ident-token-diagram
	identifier = "(?:\\\\[\\da-fA-F]{1,6}" + whitespace +
		"?|\\\\[^\\r\\n\\f]|[\\w-]|[^\0-\\x7f])+",

	// Attribute selectors: https://www.w3.org/TR/selectors/#attribute-selectors
	attributes = "\\[" + whitespace + "*(" + identifier + ")(?:" + whitespace +

		// Operator (capture 2)
		"*([*^$|!~]?=)" + whitespace +

		// "Attribute values must be CSS identifiers [capture 5] or strings [capture 3 or capture 4]"
		"*(?:'((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\"|(" + identifier + "))|)" +
		whitespace + "*\\]",

	pseudos = ":(" + identifier + ")(?:\\((" +

		// To reduce the number of selectors needing tokenize in the preFilter, prefer arguments:
		// 1. quoted (capture 3; capture 4 or capture 5)
		"('((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\")|" +

		// 2. simple (capture 6)
		"((?:\\\\.|[^\\\\()[\\]]|" + attributes + ")*)|" +

		// 3. anything else (capture 2)
		".*" +
		")\\)|)",

	// Leading and non-escaped trailing whitespace, capturing some non-whitespace characters preceding the latter
	rwhitespace = new RegExp( whitespace + "+", "g" ),

	rcomma = new RegExp( "^" + whitespace + "*," + whitespace + "*" ),
	rleadingCombinator = new RegExp( "^" + whitespace + "*([>+~]|" + whitespace + ")" +
		whitespace + "*" ),
	rdescend = new RegExp( whitespace + "|>" ),

	rpseudo = new RegExp( pseudos ),
	ridentifier = new RegExp( "^" + identifier + "$" ),

	matchExpr = {
		ID: new RegExp( "^#(" + identifier + ")" ),
		CLASS: new RegExp( "^\\.(" + identifier + ")" ),
		TAG: new RegExp( "^(" + identifier + "|[*])" ),
		ATTR: new RegExp( "^" + attributes ),
		PSEUDO: new RegExp( "^" + pseudos ),
		CHILD: new RegExp(
			"^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\(" +
				whitespace + "*(even|odd|(([+-]|)(\\d*)n|)" + whitespace + "*(?:([+-]|)" +
				whitespace + "*(\\d+)|))" + whitespace + "*\\)|)", "i" ),
		bool: new RegExp( "^(?:" + booleans + ")$", "i" ),

		// For use in libraries implementing .is()
		// We use this for POS matching in `select`
		needsContext: new RegExp( "^" + whitespace +
			"*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\(" + whitespace +
			"*((?:-\\d)?\\d*)" + whitespace + "*\\)|)(?=[^-]|$)", "i" )
	},

	rinputs = /^(?:input|select|textarea|button)$/i,
	rheader = /^h\d$/i,

	// Easily-parseable/retrievable ID or TAG or CLASS selectors
	rquickExpr = /^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,

	rsibling = /[+~]/,

	// CSS escapes
	// https://www.w3.org/TR/CSS21/syndata.html#escaped-characters
	runescape = new RegExp( "\\\\[\\da-fA-F]{1,6}" + whitespace +
		"?|\\\\([^\\r\\n\\f])", "g" ),
	funescape = function( escape, nonHex ) {
		var high = "0x" + escape.slice( 1 ) - 0x10000;

		if ( nonHex ) {

			// Strip the backslash prefix from a non-hex escape sequence
			return nonHex;
		}

		// Replace a hexadecimal escape sequence with the encoded Unicode code point
		// Support: IE <=11+
		// For values outside the Basic Multilingual Plane (BMP), manually construct a
		// surrogate pair
		return high < 0 ?
			String.fromCharCode( high + 0x10000 ) :
			String.fromCharCode( high >> 10 | 0xD800, high & 0x3FF | 0xDC00 );
	},

	// Used for iframes; see `setDocument`.
	// Support: IE 9 - 11+, Edge 12 - 18+
	// Removing the function wrapper causes a "Permission Denied"
	// error in IE/Edge.
	unloadHandler = function() {
		setDocument();
	},

	inDisabledFieldset = addCombinator(
		function( elem ) {
			return elem.disabled === true && nodeName( elem, "fieldset" );
		},
		{ dir: "parentNode", next: "legend" }
	);

// Support: IE <=9 only
// Accessing document.activeElement can throw unexpectedly
// https://bugs.jquery.com/ticket/13393
function safeActiveElement() {
	try {
		return document.activeElement;
	} catch ( err ) { }
}

// Optimize for push.apply( _, NodeList )
try {
	push.apply(
		( arr = slice.call( preferredDoc.childNodes ) ),
		preferredDoc.childNodes
	);

	// Support: Android <=4.0
	// Detect silently failing push.apply
	// eslint-disable-next-line no-unused-expressions
	arr[ preferredDoc.childNodes.length ].nodeType;
} catch ( e ) {
	push = {
		apply: function( target, els ) {
			pushNative.apply( target, slice.call( els ) );
		},
		call: function( target ) {
			pushNative.apply( target, slice.call( arguments, 1 ) );
		}
	};
}

function find( selector, context, results, seed ) {
	var m, i, elem, nid, match, groups, newSelector,
		newContext = context && context.ownerDocument,

		// nodeType defaults to 9, since context defaults to document
		nodeType = context ? context.nodeType : 9;

	results = results || [];

	// Return early from calls with invalid selector or context
	if ( typeof selector !== "string" || !selector ||
		nodeType !== 1 && nodeType !== 9 && nodeType !== 11 ) {

		return results;
	}

	// Try to shortcut find operations (as opposed to filters) in HTML documents
	if ( !seed ) {
		setDocument( context );
		context = context || document;

		if ( documentIsHTML ) {

			// If the selector is sufficiently simple, try using a "get*By*" DOM method
			// (excepting DocumentFragment context, where the methods don't exist)
			if ( nodeType !== 11 && ( match = rquickExpr.exec( selector ) ) ) {

				// ID selector
				if ( ( m = match[ 1 ] ) ) {

					// Document context
					if ( nodeType === 9 ) {
						if ( ( elem = context.getElementById( m ) ) ) {

							// Support: IE 9 only
							// getElementById can match elements by name instead of ID
							if ( elem.id === m ) {
								push.call( results, elem );
								return results;
							}
						} else {
							return results;
						}

					// Element context
					} else {

						// Support: IE 9 only
						// getElementById can match elements by name instead of ID
						if ( newContext && ( elem = newContext.getElementById( m ) ) &&
							find.contains( context, elem ) &&
							elem.id === m ) {

							push.call( results, elem );
							return results;
						}
					}

				// Type selector
				} else if ( match[ 2 ] ) {
					push.apply( results, context.getElementsByTagName( selector ) );
					return results;

				// Class selector
				} else if ( ( m = match[ 3 ] ) && context.getElementsByClassName ) {
					push.apply( results, context.getElementsByClassName( m ) );
					return results;
				}
			}

			// Take advantage of querySelectorAll
			if ( !nonnativeSelectorCache[ selector + " " ] &&
				( !rbuggyQSA || !rbuggyQSA.test( selector ) ) ) {

				newSelector = selector;
				newContext = context;

				// qSA considers elements outside a scoping root when evaluating child or
				// descendant combinators, which is not what we want.
				// In such cases, we work around the behavior by prefixing every selector in the
				// list with an ID selector referencing the scope context.
				// The technique has to be used as well when a leading combinator is used
				// as such selectors are not recognized by querySelectorAll.
				// Thanks to Andrew Dupont for this technique.
				if ( nodeType === 1 &&
					( rdescend.test( selector ) || rleadingCombinator.test( selector ) ) ) {

					// Expand context for sibling selectors
					newContext = rsibling.test( selector ) && testContext( context.parentNode ) ||
						context;

					// We can use :scope instead of the ID hack if the browser
					// supports it & if we're not changing the context.
					// Support: IE 11+, Edge 17 - 18+
					// IE/Edge sometimes throw a "Permission denied" error when
					// strict-comparing two documents; shallow comparisons work.
					// eslint-disable-next-line eqeqeq
					if ( newContext != context || !support.scope ) {

						// Capture the context ID, setting it first if necessary
						if ( ( nid = context.getAttribute( "id" ) ) ) {
							nid = jQuery.escapeSelector( nid );
						} else {
							context.setAttribute( "id", ( nid = expando ) );
						}
					}

					// Prefix every selector in the list
					groups = tokenize( selector );
					i = groups.length;
					while ( i-- ) {
						groups[ i ] = ( nid ? "#" + nid : ":scope" ) + " " +
							toSelector( groups[ i ] );
					}
					newSelector = groups.join( "," );
				}

				try {
					push.apply( results,
						newContext.querySelectorAll( newSelector )
					);
					return results;
				} catch ( qsaError ) {
					nonnativeSelectorCache( selector, true );
				} finally {
					if ( nid === expando ) {
						context.removeAttribute( "id" );
					}
				}
			}
		}
	}

	// All others
	return select( selector.replace( rtrimCSS, "$1" ), context, results, seed );
}

/**
 * Create key-value caches of limited size
 * @returns {function(string, object)} Returns the Object data after storing it on itself with
 *	property name the (space-suffixed) string and (if the cache is larger than Expr.cacheLength)
 *	deleting the oldest entry
 */
function createCache() {
	var keys = [];

	function cache( key, value ) {

		// Use (key + " ") to avoid collision with native prototype properties
		// (see https://github.com/jquery/sizzle/issues/157)
		if ( keys.push( key + " " ) > Expr.cacheLength ) {

			// Only keep the most recent entries
			delete cache[ keys.shift() ];
		}
		return ( cache[ key + " " ] = value );
	}
	return cache;
}

/**
 * Mark a function for special use by jQuery selector module
 * @param {Function} fn The function to mark
 */
function markFunction( fn ) {
	fn[ expando ] = true;
	return fn;
}

/**
 * Support testing using an element
 * @param {Function} fn Passed the created element and returns a boolean result
 */
function assert( fn ) {
	var el = document.createElement( "fieldset" );

	try {
		return !!fn( el );
	} catch ( e ) {
		return false;
	} finally {

		// Remove from its parent by default
		if ( el.parentNode ) {
			el.parentNode.removeChild( el );
		}

		// release memory in IE
		el = null;
	}
}

/**
 * Returns a function to use in pseudos for input types
 * @param {String} type
 */
function createInputPseudo( type ) {
	return function( elem ) {
		return nodeName( elem, "input" ) && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for buttons
 * @param {String} type
 */
function createButtonPseudo( type ) {
	return function( elem ) {
		return ( nodeName( elem, "input" ) || nodeName( elem, "button" ) ) &&
			elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for :enabled/:disabled
 * @param {Boolean} disabled true for :disabled; false for :enabled
 */
function createDisabledPseudo( disabled ) {

	// Known :disabled false positives: fieldset[disabled] > legend:nth-of-type(n+2) :can-disable
	return function( elem ) {

		// Only certain elements can match :enabled or :disabled
		// https://html.spec.whatwg.org/multipage/scripting.html#selector-enabled
		// https://html.spec.whatwg.org/multipage/scripting.html#selector-disabled
		if ( "form" in elem ) {

			// Check for inherited disabledness on relevant non-disabled elements:
			// * listed form-associated elements in a disabled fieldset
			//   https://html.spec.whatwg.org/multipage/forms.html#category-listed
			//   https://html.spec.whatwg.org/multipage/forms.html#concept-fe-disabled
			// * option elements in a disabled optgroup
			//   https://html.spec.whatwg.org/multipage/forms.html#concept-option-disabled
			// All such elements have a "form" property.
			if ( elem.parentNode && elem.disabled === false ) {

				// Option elements defer to a parent optgroup if present
				if ( "label" in elem ) {
					if ( "label" in elem.parentNode ) {
						return elem.parentNode.disabled === disabled;
					} else {
						return elem.disabled === disabled;
					}
				}

				// Support: IE 6 - 11+
				// Use the isDisabled shortcut property to check for disabled fieldset ancestors
				return elem.isDisabled === disabled ||

					// Where there is no isDisabled, check manually
					elem.isDisabled !== !disabled &&
						inDisabledFieldset( elem ) === disabled;
			}

			return elem.disabled === disabled;

		// Try to winnow out elements that can't be disabled before trusting the disabled property.
		// Some victims get caught in our net (label, legend, menu, track), but it shouldn't
		// even exist on them, let alone have a boolean value.
		} else if ( "label" in elem ) {
			return elem.disabled === disabled;
		}

		// Remaining elements are neither :enabled nor :disabled
		return false;
	};
}

/**
 * Returns a function to use in pseudos for positionals
 * @param {Function} fn
 */
function createPositionalPseudo( fn ) {
	return markFunction( function( argument ) {
		argument = +argument;
		return markFunction( function( seed, matches ) {
			var j,
				matchIndexes = fn( [], seed.length, argument ),
				i = matchIndexes.length;

			// Match elements found at the specified indexes
			while ( i-- ) {
				if ( seed[ ( j = matchIndexes[ i ] ) ] ) {
					seed[ j ] = !( matches[ j ] = seed[ j ] );
				}
			}
		} );
	} );
}

/**
 * Checks a node for validity as a jQuery selector context
 * @param {Element|Object=} context
 * @returns {Element|Object|Boolean} The input node if acceptable, otherwise a falsy value
 */
function testContext( context ) {
	return context && typeof context.getElementsByTagName !== "undefined" && context;
}

/**
 * Sets document-related variables once based on the current document
 * @param {Element|Object} [node] An element or document object to use to set the document
 * @returns {Object} Returns the current document
 */
function setDocument( node ) {
	var subWindow,
		doc = node ? node.ownerDocument || node : preferredDoc;

	// Return early if doc is invalid or already selected
	// Support: IE 11+, Edge 17 - 18+
	// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
	// two documents; shallow comparisons work.
	// eslint-disable-next-line eqeqeq
	if ( doc == document || doc.nodeType !== 9 || !doc.documentElement ) {
		return document;
	}

	// Update global variables
	document = doc;
	documentElement = document.documentElement;
	documentIsHTML = !jQuery.isXMLDoc( document );

	// Support: iOS 7 only, IE 9 - 11+
	// Older browsers didn't support unprefixed `matches`.
	matches = documentElement.matches ||
		documentElement.webkitMatchesSelector ||
		documentElement.msMatchesSelector;

	// Support: IE 9 - 11+, Edge 12 - 18+
	// Accessing iframe documents after unload throws "permission denied" errors
	// (see trac-13936).
	// Limit the fix to IE & Edge Legacy; despite Edge 15+ implementing `matches`,
	// all IE 9+ and Edge Legacy versions implement `msMatchesSelector` as well.
	if ( documentElement.msMatchesSelector &&

		// Support: IE 11+, Edge 17 - 18+
		// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
		// two documents; shallow comparisons work.
		// eslint-disable-next-line eqeqeq
		preferredDoc != document &&
		( subWindow = document.defaultView ) && subWindow.top !== subWindow ) {

		// Support: IE 9 - 11+, Edge 12 - 18+
		subWindow.addEventListener( "unload", unloadHandler );
	}

	// Support: IE <10
	// Check if getElementById returns elements by name
	// The broken getElementById methods don't pick up programmatically-set names,
	// so use a roundabout getElementsByName test
	support.getById = assert( function( el ) {
		documentElement.appendChild( el ).id = jQuery.expando;
		return !document.getElementsByName ||
			!document.getElementsByName( jQuery.expando ).length;
	} );

	// Support: IE 9 only
	// Check to see if it's possible to do matchesSelector
	// on a disconnected node.
	support.disconnectedMatch = assert( function( el ) {
		return matches.call( el, "*" );
	} );

	// Support: IE 9 - 11+, Edge 12 - 18+
	// IE/Edge don't support the :scope pseudo-class.
	support.scope = assert( function() {
		return document.querySelectorAll( ":scope" );
	} );

	// Support: Chrome 105 - 111 only, Safari 15.4 - 16.3 only
	// Make sure the `:has()` argument is parsed unforgivingly.
	// We include `*` in the test to detect buggy implementations that are
	// _selectively_ forgiving (specifically when the list includes at least
	// one valid selector).
	// Note that we treat complete lack of support for `:has()` as if it were
	// spec-compliant support, which is fine because use of `:has()` in such
	// environments will fail in the qSA path and fall back to jQuery traversal
	// anyway.
	support.cssHas = assert( function() {
		try {
			document.querySelector( ":has(*,:jqfake)" );
			return false;
		} catch ( e ) {
			return true;
		}
	} );

	// ID filter and find
	if ( support.getById ) {
		Expr.filter.ID = function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				return elem.getAttribute( "id" ) === attrId;
			};
		};
		Expr.find.ID = function( id, context ) {
			if ( typeof context.getElementById !== "undefined" && documentIsHTML ) {
				var elem = context.getElementById( id );
				return elem ? [ elem ] : [];
			}
		};
	} else {
		Expr.filter.ID =  function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				var node = typeof elem.getAttributeNode !== "undefined" &&
					elem.getAttributeNode( "id" );
				return node && node.value === attrId;
			};
		};

		// Support: IE 6 - 7 only
		// getElementById is not reliable as a find shortcut
		Expr.find.ID = function( id, context ) {
			if ( typeof context.getElementById !== "undefined" && documentIsHTML ) {
				var node, i, elems,
					elem = context.getElementById( id );

				if ( elem ) {

					// Verify the id attribute
					node = elem.getAttributeNode( "id" );
					if ( node && node.value === id ) {
						return [ elem ];
					}

					// Fall back on getElementsByName
					elems = context.getElementsByName( id );
					i = 0;
					while ( ( elem = elems[ i++ ] ) ) {
						node = elem.getAttributeNode( "id" );
						if ( node && node.value === id ) {
							return [ elem ];
						}
					}
				}

				return [];
			}
		};
	}

	// Tag
	Expr.find.TAG = function( tag, context ) {
		if ( typeof context.getElementsByTagName !== "undefined" ) {
			return context.getElementsByTagName( tag );

		// DocumentFragment nodes don't have gEBTN
		} else {
			return context.querySelectorAll( tag );
		}
	};

	// Class
	Expr.find.CLASS = function( className, context ) {
		if ( typeof context.getElementsByClassName !== "undefined" && documentIsHTML ) {
			return context.getElementsByClassName( className );
		}
	};

	/* QSA/matchesSelector
	---------------------------------------------------------------------- */

	// QSA and matchesSelector support

	rbuggyQSA = [];

	// Build QSA regex
	// Regex strategy adopted from Diego Perini
	assert( function( el ) {

		var input;

		documentElement.appendChild( el ).innerHTML =
			"<a id='" + expando + "' href='' disabled='disabled'></a>" +
			"<select id='" + expando + "-\r\\' disabled='disabled'>" +
			"<option selected=''></option></select>";

		// Support: iOS <=7 - 8 only
		// Boolean attributes and "value" are not treated correctly in some XML documents
		if ( !el.querySelectorAll( "[selected]" ).length ) {
			rbuggyQSA.push( "\\[" + whitespace + "*(?:value|" + booleans + ")" );
		}

		// Support: iOS <=7 - 8 only
		if ( !el.querySelectorAll( "[id~=" + expando + "-]" ).length ) {
			rbuggyQSA.push( "~=" );
		}

		// Support: iOS 8 only
		// https://bugs.webkit.org/show_bug.cgi?id=136851
		// In-page `selector#id sibling-combinator selector` fails
		if ( !el.querySelectorAll( "a#" + expando + "+*" ).length ) {
			rbuggyQSA.push( ".#.+[+~]" );
		}

		// Support: Chrome <=105+, Firefox <=104+, Safari <=15.4+
		// In some of the document kinds, these selectors wouldn't work natively.
		// This is probably OK but for backwards compatibility we want to maintain
		// handling them through jQuery traversal in jQuery 3.x.
		if ( !el.querySelectorAll( ":checked" ).length ) {
			rbuggyQSA.push( ":checked" );
		}

		// Support: Windows 8 Native Apps
		// The type and name attributes are restricted during .innerHTML assignment
		input = document.createElement( "input" );
		input.setAttribute( "type", "hidden" );
		el.appendChild( input ).setAttribute( "name", "D" );

		// Support: IE 9 - 11+
		// IE's :disabled selector does not pick up the children of disabled fieldsets
		// Support: Chrome <=105+, Firefox <=104+, Safari <=15.4+
		// In some of the document kinds, these selectors wouldn't work natively.
		// This is probably OK but for backwards compatibility we want to maintain
		// handling them through jQuery traversal in jQuery 3.x.
		documentElement.appendChild( el ).disabled = true;
		if ( el.querySelectorAll( ":disabled" ).length !== 2 ) {
			rbuggyQSA.push( ":enabled", ":disabled" );
		}

		// Support: IE 11+, Edge 15 - 18+
		// IE 11/Edge don't find elements on a `[name='']` query in some cases.
		// Adding a temporary attribute to the document before the selection works
		// around the issue.
		// Interestingly, IE 10 & older don't seem to have the issue.
		input = document.createElement( "input" );
		input.setAttribute( "name", "" );
		el.appendChild( input );
		if ( !el.querySelectorAll( "[name='']" ).length ) {
			rbuggyQSA.push( "\\[" + whitespace + "*name" + whitespace + "*=" +
				whitespace + "*(?:''|\"\")" );
		}
	} );

	if ( !support.cssHas ) {

		// Support: Chrome 105 - 110+, Safari 15.4 - 16.3+
		// Our regular `try-catch` mechanism fails to detect natively-unsupported
		// pseudo-classes inside `:has()` (such as `:has(:contains("Foo"))`)
		// in browsers that parse the `:has()` argument as a forgiving selector list.
		// https://drafts.csswg.org/selectors/#relational now requires the argument
		// to be parsed unforgivingly, but browsers have not yet fully adjusted.
		rbuggyQSA.push( ":has" );
	}

	rbuggyQSA = rbuggyQSA.length && new RegExp( rbuggyQSA.join( "|" ) );

	/* Sorting
	---------------------------------------------------------------------- */

	// Document order sorting
	sortOrder = function( a, b ) {

		// Flag for duplicate removal
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		// Sort on method existence if only one input has compareDocumentPosition
		var compare = !a.compareDocumentPosition - !b.compareDocumentPosition;
		if ( compare ) {
			return compare;
		}

		// Calculate position if both inputs belong to the same document
		// Support: IE 11+, Edge 17 - 18+
		// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
		// two documents; shallow comparisons work.
		// eslint-disable-next-line eqeqeq
		compare = ( a.ownerDocument || a ) == ( b.ownerDocument || b ) ?
			a.compareDocumentPosition( b ) :

			// Otherwise we know they are disconnected
			1;

		// Disconnected nodes
		if ( compare & 1 ||
			( !support.sortDetached && b.compareDocumentPosition( a ) === compare ) ) {

			// Choose the first element that is related to our preferred document
			// Support: IE 11+, Edge 17 - 18+
			// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
			// two documents; shallow comparisons work.
			// eslint-disable-next-line eqeqeq
			if ( a === document || a.ownerDocument == preferredDoc &&
				find.contains( preferredDoc, a ) ) {
				return -1;
			}

			// Support: IE 11+, Edge 17 - 18+
			// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
			// two documents; shallow comparisons work.
			// eslint-disable-next-line eqeqeq
			if ( b === document || b.ownerDocument == preferredDoc &&
				find.contains( preferredDoc, b ) ) {
				return 1;
			}

			// Maintain original order
			return sortInput ?
				( indexOf.call( sortInput, a ) - indexOf.call( sortInput, b ) ) :
				0;
		}

		return compare & 4 ? -1 : 1;
	};

	return document;
}

find.matches = function( expr, elements ) {
	return find( expr, null, null, elements );
};

find.matchesSelector = function( elem, expr ) {
	setDocument( elem );

	if ( documentIsHTML &&
		!nonnativeSelectorCache[ expr + " " ] &&
		( !rbuggyQSA || !rbuggyQSA.test( expr ) ) ) {

		try {
			var ret = matches.call( elem, expr );

			// IE 9's matchesSelector returns false on disconnected nodes
			if ( ret || support.disconnectedMatch ||

					// As well, disconnected nodes are said to be in a document
					// fragment in IE 9
					elem.document && elem.document.nodeType !== 11 ) {
				return ret;
			}
		} catch ( e ) {
			nonnativeSelectorCache( expr, true );
		}
	}

	return find( expr, document, null, [ elem ] ).length > 0;
};

find.contains = function( context, elem ) {

	// Set document vars if needed
	// Support: IE 11+, Edge 17 - 18+
	// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
	// two documents; shallow comparisons work.
	// eslint-disable-next-line eqeqeq
	if ( ( context.ownerDocument || context ) != document ) {
		setDocument( context );
	}
	return jQuery.contains( context, elem );
};


find.attr = function( elem, name ) {

	// Set document vars if needed
	// Support: IE 11+, Edge 17 - 18+
	// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
	// two documents; shallow comparisons work.
	// eslint-disable-next-line eqeqeq
	if ( ( elem.ownerDocument || elem ) != document ) {
		setDocument( elem );
	}

	var fn = Expr.attrHandle[ name.toLowerCase() ],

		// Don't get fooled by Object.prototype properties (see trac-13807)
		val = fn && hasOwn.call( Expr.attrHandle, name.toLowerCase() ) ?
			fn( elem, name, !documentIsHTML ) :
			undefined;

	if ( val !== undefined ) {
		return val;
	}

	return elem.getAttribute( name );
};

find.error = function( msg ) {
	throw new Error( "Syntax error, unrecognized expression: " + msg );
};

/**
 * Document sorting and removing duplicates
 * @param {ArrayLike} results
 */
jQuery.uniqueSort = function( results ) {
	var elem,
		duplicates = [],
		j = 0,
		i = 0;

	// Unless we *know* we can detect duplicates, assume their presence
	//
	// Support: Android <=4.0+
	// Testing for detecting duplicates is unpredictable so instead assume we can't
	// depend on duplicate detection in all browsers without a stable sort.
	hasDuplicate = !support.sortStable;
	sortInput = !support.sortStable && slice.call( results, 0 );
	sort.call( results, sortOrder );

	if ( hasDuplicate ) {
		while ( ( elem = results[ i++ ] ) ) {
			if ( elem === results[ i ] ) {
				j = duplicates.push( i );
			}
		}
		while ( j-- ) {
			splice.call( results, duplicates[ j ], 1 );
		}
	}

	// Clear input after sorting to release objects
	// See https://github.com/jquery/sizzle/pull/225
	sortInput = null;

	return results;
};

jQuery.fn.uniqueSort = function() {
	return this.pushStack( jQuery.uniqueSort( slice.apply( this ) ) );
};

Expr = jQuery.expr = {

	// Can be adjusted by the user
	cacheLength: 50,

	createPseudo: markFunction,

	match: matchExpr,

	attrHandle: {},

	find: {},

	relative: {
		">": { dir: "parentNode", first: true },
		" ": { dir: "parentNode" },
		"+": { dir: "previousSibling", first: true },
		"~": { dir: "previousSibling" }
	},

	preFilter: {
		ATTR: function( match ) {
			match[ 1 ] = match[ 1 ].replace( runescape, funescape );

			// Move the given value to match[3] whether quoted or unquoted
			match[ 3 ] = ( match[ 3 ] || match[ 4 ] || match[ 5 ] || "" )
				.replace( runescape, funescape );

			if ( match[ 2 ] === "~=" ) {
				match[ 3 ] = " " + match[ 3 ] + " ";
			}

			return match.slice( 0, 4 );
		},

		CHILD: function( match ) {

			/* matches from matchExpr["CHILD"]
				1 type (only|nth|...)
				2 what (child|of-type)
				3 argument (even|odd|\d*|\d*n([+-]\d+)?|...)
				4 xn-component of xn+y argument ([+-]?\d*n|)
				5 sign of xn-component
				6 x of xn-component
				7 sign of y-component
				8 y of y-component
			*/
			match[ 1 ] = match[ 1 ].toLowerCase();

			if ( match[ 1 ].slice( 0, 3 ) === "nth" ) {

				// nth-* requires argument
				if ( !match[ 3 ] ) {
					find.error( match[ 0 ] );
				}

				// numeric x and y parameters for Expr.filter.CHILD
				// remember that false/true cast respectively to 0/1
				match[ 4 ] = +( match[ 4 ] ?
					match[ 5 ] + ( match[ 6 ] || 1 ) :
					2 * ( match[ 3 ] === "even" || match[ 3 ] === "odd" )
				);
				match[ 5 ] = +( ( match[ 7 ] + match[ 8 ] ) || match[ 3 ] === "odd" );

			// other types prohibit arguments
			} else if ( match[ 3 ] ) {
				find.error( match[ 0 ] );
			}

			return match;
		},

		PSEUDO: function( match ) {
			var excess,
				unquoted = !match[ 6 ] && match[ 2 ];

			if ( matchExpr.CHILD.test( match[ 0 ] ) ) {
				return null;
			}

			// Accept quoted arguments as-is
			if ( match[ 3 ] ) {
				match[ 2 ] = match[ 4 ] || match[ 5 ] || "";

			// Strip excess characters from unquoted arguments
			} else if ( unquoted && rpseudo.test( unquoted ) &&

				// Get excess from tokenize (recursively)
				( excess = tokenize( unquoted, true ) ) &&

				// advance to the next closing parenthesis
				( excess = unquoted.indexOf( ")", unquoted.length - excess ) - unquoted.length ) ) {

				// excess is a negative index
				match[ 0 ] = match[ 0 ].slice( 0, excess );
				match[ 2 ] = unquoted.slice( 0, excess );
			}

			// Return only captures needed by the pseudo filter method (type and argument)
			return match.slice( 0, 3 );
		}
	},

	filter: {

		TAG: function( nodeNameSelector ) {
			var expectedNodeName = nodeNameSelector.replace( runescape, funescape ).toLowerCase();
			return nodeNameSelector === "*" ?
				function() {
					return true;
				} :
				function( elem ) {
					return nodeName( elem, expectedNodeName );
				};
		},

		CLASS: function( className ) {
			var pattern = classCache[ className + " " ];

			return pattern ||
				( pattern = new RegExp( "(^|" + whitespace + ")" + className +
					"(" + whitespace + "|$)" ) ) &&
				classCache( className, function( elem ) {
					return pattern.test(
						typeof elem.className === "string" && elem.className ||
							typeof elem.getAttribute !== "undefined" &&
								elem.getAttribute( "class" ) ||
							""
					);
				} );
		},

		ATTR: function( name, operator, check ) {
			return function( elem ) {
				var result = find.attr( elem, name );

				if ( result == null ) {
					return operator === "!=";
				}
				if ( !operator ) {
					return true;
				}

				result += "";

				if ( operator === "=" ) {
					return result === check;
				}
				if ( operator === "!=" ) {
					return result !== check;
				}
				if ( operator === "^=" ) {
					return check && result.indexOf( check ) === 0;
				}
				if ( operator === "*=" ) {
					return check && result.indexOf( check ) > -1;
				}
				if ( operator === "$=" ) {
					return check && result.slice( -check.length ) === check;
				}
				if ( operator === "~=" ) {
					return ( " " + result.replace( rwhitespace, " " ) + " " )
						.indexOf( check ) > -1;
				}
				if ( operator === "|=" ) {
					return result === check || result.slice( 0, check.length + 1 ) === check + "-";
				}

				return false;
			};
		},

		CHILD: function( type, what, _argument, first, last ) {
			var simple = type.slice( 0, 3 ) !== "nth",
				forward = type.slice( -4 ) !== "last",
				ofType = what === "of-type";

			return first === 1 && last === 0 ?

				// Shortcut for :nth-*(n)
				function( elem ) {
					return !!elem.parentNode;
				} :

				function( elem, _context, xml ) {
					var cache, outerCache, node, nodeIndex, start,
						dir = simple !== forward ? "nextSibling" : "previousSibling",
						parent = elem.parentNode,
						name = ofType && elem.nodeName.toLowerCase(),
						useCache = !xml && !ofType,
						diff = false;

					if ( parent ) {

						// :(first|last|only)-(child|of-type)
						if ( simple ) {
							while ( dir ) {
								node = elem;
								while ( ( node = node[ dir ] ) ) {
									if ( ofType ?
										nodeName( node, name ) :
										node.nodeType === 1 ) {

										return false;
									}
								}

								// Reverse direction for :only-* (if we haven't yet done so)
								start = dir = type === "only" && !start && "nextSibling";
							}
							return true;
						}

						start = [ forward ? parent.firstChild : parent.lastChild ];

						// non-xml :nth-child(...) stores cache data on `parent`
						if ( forward && useCache ) {

							// Seek `elem` from a previously-cached index
							outerCache = parent[ expando ] || ( parent[ expando ] = {} );
							cache = outerCache[ type ] || [];
							nodeIndex = cache[ 0 ] === dirruns && cache[ 1 ];
							diff = nodeIndex && cache[ 2 ];
							node = nodeIndex && parent.childNodes[ nodeIndex ];

							while ( ( node = ++nodeIndex && node && node[ dir ] ||

								// Fallback to seeking `elem` from the start
								( diff = nodeIndex = 0 ) || start.pop() ) ) {

								// When found, cache indexes on `parent` and break
								if ( node.nodeType === 1 && ++diff && node === elem ) {
									outerCache[ type ] = [ dirruns, nodeIndex, diff ];
									break;
								}
							}

						} else {

							// Use previously-cached element index if available
							if ( useCache ) {
								outerCache = elem[ expando ] || ( elem[ expando ] = {} );
								cache = outerCache[ type ] || [];
								nodeIndex = cache[ 0 ] === dirruns && cache[ 1 ];
								diff = nodeIndex;
							}

							// xml :nth-child(...)
							// or :nth-last-child(...) or :nth(-last)?-of-type(...)
							if ( diff === false ) {

								// Use the same loop as above to seek `elem` from the start
								while ( ( node = ++nodeIndex && node && node[ dir ] ||
									( diff = nodeIndex = 0 ) || start.pop() ) ) {

									if ( ( ofType ?
										nodeName( node, name ) :
										node.nodeType === 1 ) &&
										++diff ) {

										// Cache the index of each encountered element
										if ( useCache ) {
											outerCache = node[ expando ] ||
												( node[ expando ] = {} );
											outerCache[ type ] = [ dirruns, diff ];
										}

										if ( node === elem ) {
											break;
										}
									}
								}
							}
						}

						// Incorporate the offset, then check against cycle size
						diff -= last;
						return diff === first || ( diff % first === 0 && diff / first >= 0 );
					}
				};
		},

		PSEUDO: function( pseudo, argument ) {

			// pseudo-class names are case-insensitive
			// https://www.w3.org/TR/selectors/#pseudo-classes
			// Prioritize by case sensitivity in case custom pseudos are added with uppercase letters
			// Remember that setFilters inherits from pseudos
			var args,
				fn = Expr.pseudos[ pseudo ] || Expr.setFilters[ pseudo.toLowerCase() ] ||
					find.error( "unsupported pseudo: " + pseudo );

			// The user may use createPseudo to indicate that
			// arguments are needed to create the filter function
			// just as jQuery does
			if ( fn[ expando ] ) {
				return fn( argument );
			}

			// But maintain support for old signatures
			if ( fn.length > 1 ) {
				args = [ pseudo, pseudo, "", argument ];
				return Expr.setFilters.hasOwnProperty( pseudo.toLowerCase() ) ?
					markFunction( function( seed, matches ) {
						var idx,
							matched = fn( seed, argument ),
							i = matched.length;
						while ( i-- ) {
							idx = indexOf.call( seed, matched[ i ] );
							seed[ idx ] = !( matches[ idx ] = matched[ i ] );
						}
					} ) :
					function( elem ) {
						return fn( elem, 0, args );
					};
			}

			return fn;
		}
	},

	pseudos: {

		// Potentially complex pseudos
		not: markFunction( function( selector ) {

			// Trim the selector passed to compile
			// to avoid treating leading and trailing
			// spaces as combinators
			var input = [],
				results = [],
				matcher = compile( selector.replace( rtrimCSS, "$1" ) );

			return matcher[ expando ] ?
				markFunction( function( seed, matches, _context, xml ) {
					var elem,
						unmatched = matcher( seed, null, xml, [] ),
						i = seed.length;

					// Match elements unmatched by `matcher`
					while ( i-- ) {
						if ( ( elem = unmatched[ i ] ) ) {
							seed[ i ] = !( matches[ i ] = elem );
						}
					}
				} ) :
				function( elem, _context, xml ) {
					input[ 0 ] = elem;
					matcher( input, null, xml, results );

					// Don't keep the element
					// (see https://github.com/jquery/sizzle/issues/299)
					input[ 0 ] = null;
					return !results.pop();
				};
		} ),

		has: markFunction( function( selector ) {
			return function( elem ) {
				return find( selector, elem ).length > 0;
			};
		} ),

		contains: markFunction( function( text ) {
			text = text.replace( runescape, funescape );
			return function( elem ) {
				return ( elem.textContent || jQuery.text( elem ) ).indexOf( text ) > -1;
			};
		} ),

		// "Whether an element is represented by a :lang() selector
		// is based solely on the element's language value
		// being equal to the identifier C,
		// or beginning with the identifier C immediately followed by "-".
		// The matching of C against the element's language value is performed case-insensitively.
		// The identifier C does not have to be a valid language name."
		// https://www.w3.org/TR/selectors/#lang-pseudo
		lang: markFunction( function( lang ) {

			// lang value must be a valid identifier
			if ( !ridentifier.test( lang || "" ) ) {
				find.error( "unsupported lang: " + lang );
			}
			lang = lang.replace( runescape, funescape ).toLowerCase();
			return function( elem ) {
				var elemLang;
				do {
					if ( ( elemLang = documentIsHTML ?
						elem.lang :
						elem.getAttribute( "xml:lang" ) || elem.getAttribute( "lang" ) ) ) {

						elemLang = elemLang.toLowerCase();
						return elemLang === lang || elemLang.indexOf( lang + "-" ) === 0;
					}
				} while ( ( elem = elem.parentNode ) && elem.nodeType === 1 );
				return false;
			};
		} ),

		// Miscellaneous
		target: function( elem ) {
			var hash = window.location && window.location.hash;
			return hash && hash.slice( 1 ) === elem.id;
		},

		root: function( elem ) {
			return elem === documentElement;
		},

		focus: function( elem ) {
			return elem === safeActiveElement() &&
				document.hasFocus() &&
				!!( elem.type || elem.href || ~elem.tabIndex );
		},

		// Boolean properties
		enabled: createDisabledPseudo( false ),
		disabled: createDisabledPseudo( true ),

		checked: function( elem ) {

			// In CSS3, :checked should return both checked and selected elements
			// https://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			return ( nodeName( elem, "input" ) && !!elem.checked ) ||
				( nodeName( elem, "option" ) && !!elem.selected );
		},

		selected: function( elem ) {

			// Support: IE <=11+
			// Accessing the selectedIndex property
			// forces the browser to treat the default option as
			// selected when in an optgroup.
			if ( elem.parentNode ) {
				// eslint-disable-next-line no-unused-expressions
				elem.parentNode.selectedIndex;
			}

			return elem.selected === true;
		},

		// Contents
		empty: function( elem ) {

			// https://www.w3.org/TR/selectors/#empty-pseudo
			// :empty is negated by element (1) or content nodes (text: 3; cdata: 4; entity ref: 5),
			//   but not by others (comment: 8; processing instruction: 7; etc.)
			// nodeType < 6 works because attributes (2) do not appear as children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				if ( elem.nodeType < 6 ) {
					return false;
				}
			}
			return true;
		},

		parent: function( elem ) {
			return !Expr.pseudos.empty( elem );
		},

		// Element/input types
		header: function( elem ) {
			return rheader.test( elem.nodeName );
		},

		input: function( elem ) {
			return rinputs.test( elem.nodeName );
		},

		button: function( elem ) {
			return nodeName( elem, "input" ) && elem.type === "button" ||
				nodeName( elem, "button" );
		},

		text: function( elem ) {
			var attr;
			return nodeName( elem, "input" ) && elem.type === "text" &&

				// Support: IE <10 only
				// New HTML5 attribute values (e.g., "search") appear
				// with elem.type === "text"
				( ( attr = elem.getAttribute( "type" ) ) == null ||
					attr.toLowerCase() === "text" );
		},

		// Position-in-collection
		first: createPositionalPseudo( function() {
			return [ 0 ];
		} ),

		last: createPositionalPseudo( function( _matchIndexes, length ) {
			return [ length - 1 ];
		} ),

		eq: createPositionalPseudo( function( _matchIndexes, length, argument ) {
			return [ argument < 0 ? argument + length : argument ];
		} ),

		even: createPositionalPseudo( function( matchIndexes, length ) {
			var i = 0;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		} ),

		odd: createPositionalPseudo( function( matchIndexes, length ) {
			var i = 1;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		} ),

		lt: createPositionalPseudo( function( matchIndexes, length, argument ) {
			var i;

			if ( argument < 0 ) {
				i = argument + length;
			} else if ( argument > length ) {
				i = length;
			} else {
				i = argument;
			}

			for ( ; --i >= 0; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		} ),

		gt: createPositionalPseudo( function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; ++i < length; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		} )
	}
};

Expr.pseudos.nth = Expr.pseudos.eq;

// Add button/input type pseudos
for ( i in { radio: true, checkbox: true, file: true, password: true, image: true } ) {
	Expr.pseudos[ i ] = createInputPseudo( i );
}
for ( i in { submit: true, reset: true } ) {
	Expr.pseudos[ i ] = createButtonPseudo( i );
}

// Easy API for creating new setFilters
function setFilters() {}
setFilters.prototype = Expr.filters = Expr.pseudos;
Expr.setFilters = new setFilters();

function tokenize( selector, parseOnly ) {
	var matched, match, tokens, type,
		soFar, groups, preFilters,
		cached = tokenCache[ selector + " " ];

	if ( cached ) {
		return parseOnly ? 0 : cached.slice( 0 );
	}

	soFar = selector;
	groups = [];
	preFilters = Expr.preFilter;

	while ( soFar ) {

		// Comma and first run
		if ( !matched || ( match = rcomma.exec( soFar ) ) ) {
			if ( match ) {

				// Don't consume trailing commas as valid
				soFar = soFar.slice( match[ 0 ].length ) || soFar;
			}
			groups.push( ( tokens = [] ) );
		}

		matched = false;

		// Combinators
		if ( ( match = rleadingCombinator.exec( soFar ) ) ) {
			matched = match.shift();
			tokens.push( {
				value: matched,

				// Cast descendant combinators to space
				type: match[ 0 ].replace( rtrimCSS, " " )
			} );
			soFar = soFar.slice( matched.length );
		}

		// Filters
		for ( type in Expr.filter ) {
			if ( ( match = matchExpr[ type ].exec( soFar ) ) && ( !preFilters[ type ] ||
				( match = preFilters[ type ]( match ) ) ) ) {
				matched = match.shift();
				tokens.push( {
					value: matched,
					type: type,
					matches: match
				} );
				soFar = soFar.slice( matched.length );
			}
		}

		if ( !matched ) {
			break;
		}
	}

	// Return the length of the invalid excess
	// if we're just parsing
	// Otherwise, throw an error or return tokens
	if ( parseOnly ) {
		return soFar.length;
	}

	return soFar ?
		find.error( selector ) :

		// Cache the tokens
		tokenCache( selector, groups ).slice( 0 );
}

function toSelector( tokens ) {
	var i = 0,
		len = tokens.length,
		selector = "";
	for ( ; i < len; i++ ) {
		selector += tokens[ i ].value;
	}
	return selector;
}

function addCombinator( matcher, combinator, base ) {
	var dir = combinator.dir,
		skip = combinator.next,
		key = skip || dir,
		checkNonElements = base && key === "parentNode",
		doneName = done++;

	return combinator.first ?

		// Check against closest ancestor/preceding element
		function( elem, context, xml ) {
			while ( ( elem = elem[ dir ] ) ) {
				if ( elem.nodeType === 1 || checkNonElements ) {
					return matcher( elem, context, xml );
				}
			}
			return false;
		} :

		// Check against all ancestor/preceding elements
		function( elem, context, xml ) {
			var oldCache, outerCache,
				newCache = [ dirruns, doneName ];

			// We can't set arbitrary data on XML nodes, so they don't benefit from combinator caching
			if ( xml ) {
				while ( ( elem = elem[ dir ] ) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						if ( matcher( elem, context, xml ) ) {
							return true;
						}
					}
				}
			} else {
				while ( ( elem = elem[ dir ] ) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						outerCache = elem[ expando ] || ( elem[ expando ] = {} );

						if ( skip && nodeName( elem, skip ) ) {
							elem = elem[ dir ] || elem;
						} else if ( ( oldCache = outerCache[ key ] ) &&
							oldCache[ 0 ] === dirruns && oldCache[ 1 ] === doneName ) {

							// Assign to newCache so results back-propagate to previous elements
							return ( newCache[ 2 ] = oldCache[ 2 ] );
						} else {

							// Reuse newcache so results back-propagate to previous elements
							outerCache[ key ] = newCache;

							// A match means we're done; a fail means we have to keep checking
							if ( ( newCache[ 2 ] = matcher( elem, context, xml ) ) ) {
								return true;
							}
						}
					}
				}
			}
			return false;
		};
}

function elementMatcher( matchers ) {
	return matchers.length > 1 ?
		function( elem, context, xml ) {
			var i = matchers.length;
			while ( i-- ) {
				if ( !matchers[ i ]( elem, context, xml ) ) {
					return false;
				}
			}
			return true;
		} :
		matchers[ 0 ];
}

function multipleContexts( selector, contexts, results ) {
	var i = 0,
		len = contexts.length;
	for ( ; i < len; i++ ) {
		find( selector, contexts[ i ], results );
	}
	return results;
}

function condense( unmatched, map, filter, context, xml ) {
	var elem,
		newUnmatched = [],
		i = 0,
		len = unmatched.length,
		mapped = map != null;

	for ( ; i < len; i++ ) {
		if ( ( elem = unmatched[ i ] ) ) {
			if ( !filter || filter( elem, context, xml ) ) {
				newUnmatched.push( elem );
				if ( mapped ) {
					map.push( i );
				}
			}
		}
	}

	return newUnmatched;
}

function setMatcher( preFilter, selector, matcher, postFilter, postFinder, postSelector ) {
	if ( postFilter && !postFilter[ expando ] ) {
		postFilter = setMatcher( postFilter );
	}
	if ( postFinder && !postFinder[ expando ] ) {
		postFinder = setMatcher( postFinder, postSelector );
	}
	return markFunction( function( seed, results, context, xml ) {
		var temp, i, elem, matcherOut,
			preMap = [],
			postMap = [],
			preexisting = results.length,

			// Get initial elements from seed or context
			elems = seed ||
				multipleContexts( selector || "*",
					context.nodeType ? [ context ] : context, [] ),

			// Prefilter to get matcher input, preserving a map for seed-results synchronization
			matcherIn = preFilter && ( seed || !selector ) ?
				condense( elems, preMap, preFilter, context, xml ) :
				elems;

		if ( matcher ) {

			// If we have a postFinder, or filtered seed, or non-seed postFilter
			// or preexisting results,
			matcherOut = postFinder || ( seed ? preFilter : preexisting || postFilter ) ?

				// ...intermediate processing is necessary
				[] :

				// ...otherwise use results directly
				results;

			// Find primary matches
			matcher( matcherIn, matcherOut, context, xml );
		} else {
			matcherOut = matcherIn;
		}

		// Apply postFilter
		if ( postFilter ) {
			temp = condense( matcherOut, postMap );
			postFilter( temp, [], context, xml );

			// Un-match failing elements by moving them back to matcherIn
			i = temp.length;
			while ( i-- ) {
				if ( ( elem = temp[ i ] ) ) {
					matcherOut[ postMap[ i ] ] = !( matcherIn[ postMap[ i ] ] = elem );
				}
			}
		}

		if ( seed ) {
			if ( postFinder || preFilter ) {
				if ( postFinder ) {

					// Get the final matcherOut by condensing this intermediate into postFinder contexts
					temp = [];
					i = matcherOut.length;
					while ( i-- ) {
						if ( ( elem = matcherOut[ i ] ) ) {

							// Restore matcherIn since elem is not yet a final match
							temp.push( ( matcherIn[ i ] = elem ) );
						}
					}
					postFinder( null, ( matcherOut = [] ), temp, xml );
				}

				// Move matched elements from seed to results to keep them synchronized
				i = matcherOut.length;
				while ( i-- ) {
					if ( ( elem = matcherOut[ i ] ) &&
						( temp = postFinder ? indexOf.call( seed, elem ) : preMap[ i ] ) > -1 ) {

						seed[ temp ] = !( results[ temp ] = elem );
					}
				}
			}

		// Add elements to results, through postFinder if defined
		} else {
			matcherOut = condense(
				matcherOut === results ?
					matcherOut.splice( preexisting, matcherOut.length ) :
					matcherOut
			);
			if ( postFinder ) {
				postFinder( null, results, matcherOut, xml );
			} else {
				push.apply( results, matcherOut );
			}
		}
	} );
}

function matcherFromTokens( tokens ) {
	var checkContext, matcher, j,
		len = tokens.length,
		leadingRelative = Expr.relative[ tokens[ 0 ].type ],
		implicitRelative = leadingRelative || Expr.relative[ " " ],
		i = leadingRelative ? 1 : 0,

		// The foundational matcher ensures that elements are reachable from top-level context(s)
		matchContext = addCombinator( function( elem ) {
			return elem === checkContext;
		}, implicitRelative, true ),
		matchAnyContext = addCombinator( function( elem ) {
			return indexOf.call( checkContext, elem ) > -1;
		}, implicitRelative, true ),
		matchers = [ function( elem, context, xml ) {

			// Support: IE 11+, Edge 17 - 18+
			// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
			// two documents; shallow comparisons work.
			// eslint-disable-next-line eqeqeq
			var ret = ( !leadingRelative && ( xml || context != outermostContext ) ) || (
				( checkContext = context ).nodeType ?
					matchContext( elem, context, xml ) :
					matchAnyContext( elem, context, xml ) );

			// Avoid hanging onto element
			// (see https://github.com/jquery/sizzle/issues/299)
			checkContext = null;
			return ret;
		} ];

	for ( ; i < len; i++ ) {
		if ( ( matcher = Expr.relative[ tokens[ i ].type ] ) ) {
			matchers = [ addCombinator( elementMatcher( matchers ), matcher ) ];
		} else {
			matcher = Expr.filter[ tokens[ i ].type ].apply( null, tokens[ i ].matches );

			// Return special upon seeing a positional matcher
			if ( matcher[ expando ] ) {

				// Find the next relative operator (if any) for proper handling
				j = ++i;
				for ( ; j < len; j++ ) {
					if ( Expr.relative[ tokens[ j ].type ] ) {
						break;
					}
				}
				return setMatcher(
					i > 1 && elementMatcher( matchers ),
					i > 1 && toSelector(

						// If the preceding token was a descendant combinator, insert an implicit any-element `*`
						tokens.slice( 0, i - 1 )
							.concat( { value: tokens[ i - 2 ].type === " " ? "*" : "" } )
					).replace( rtrimCSS, "$1" ),
					matcher,
					i < j && matcherFromTokens( tokens.slice( i, j ) ),
					j < len && matcherFromTokens( ( tokens = tokens.slice( j ) ) ),
					j < len && toSelector( tokens )
				);
			}
			matchers.push( matcher );
		}
	}

	return elementMatcher( matchers );
}

function matcherFromGroupMatchers( elementMatchers, setMatchers ) {
	var bySet = setMatchers.length > 0,
		byElement = elementMatchers.length > 0,
		superMatcher = function( seed, context, xml, results, outermost ) {
			var elem, j, matcher,
				matchedCount = 0,
				i = "0",
				unmatched = seed && [],
				setMatched = [],
				contextBackup = outermostContext,

				// We must always have either seed elements or outermost context
				elems = seed || byElement && Expr.find.TAG( "*", outermost ),

				// Use integer dirruns iff this is the outermost matcher
				dirrunsUnique = ( dirruns += contextBackup == null ? 1 : Math.random() || 0.1 ),
				len = elems.length;

			if ( outermost ) {

				// Support: IE 11+, Edge 17 - 18+
				// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
				// two documents; shallow comparisons work.
				// eslint-disable-next-line eqeqeq
				outermostContext = context == document || context || outermost;
			}

			// Add elements passing elementMatchers directly to results
			// Support: iOS <=7 - 9 only
			// Tolerate NodeList properties (IE: "length"; Safari: <number>) matching
			// elements by id. (see trac-14142)
			for ( ; i !== len && ( elem = elems[ i ] ) != null; i++ ) {
				if ( byElement && elem ) {
					j = 0;

					// Support: IE 11+, Edge 17 - 18+
					// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
					// two documents; shallow comparisons work.
					// eslint-disable-next-line eqeqeq
					if ( !context && elem.ownerDocument != document ) {
						setDocument( elem );
						xml = !documentIsHTML;
					}
					while ( ( matcher = elementMatchers[ j++ ] ) ) {
						if ( matcher( elem, context || document, xml ) ) {
							push.call( results, elem );
							break;
						}
					}
					if ( outermost ) {
						dirruns = dirrunsUnique;
					}
				}

				// Track unmatched elements for set filters
				if ( bySet ) {

					// They will have gone through all possible matchers
					if ( ( elem = !matcher && elem ) ) {
						matchedCount--;
					}

					// Lengthen the array for every element, matched or not
					if ( seed ) {
						unmatched.push( elem );
					}
				}
			}

			// `i` is now the count of elements visited above, and adding it to `matchedCount`
			// makes the latter nonnegative.
			matchedCount += i;

			// Apply set filters to unmatched elements
			// NOTE: This can be skipped if there are no unmatched elements (i.e., `matchedCount`
			// equals `i`), unless we didn't visit _any_ elements in the above loop because we have
			// no element matchers and no seed.
			// Incrementing an initially-string "0" `i` allows `i` to remain a string only in that
			// case, which will result in a "00" `matchedCount` that differs from `i` but is also
			// numerically zero.
			if ( bySet && i !== matchedCount ) {
				j = 0;
				while ( ( matcher = setMatchers[ j++ ] ) ) {
					matcher( unmatched, setMatched, context, xml );
				}

				if ( seed ) {

					// Reintegrate element matches to eliminate the need for sorting
					if ( matchedCount > 0 ) {
						while ( i-- ) {
							if ( !( unmatched[ i ] || setMatched[ i ] ) ) {
								setMatched[ i ] = pop.call( results );
							}
						}
					}

					// Discard index placeholder values to get only actual matches
					setMatched = condense( setMatched );
				}

				// Add matches to results
				push.apply( results, setMatched );

				// Seedless set matches succeeding multiple successful matchers stipulate sorting
				if ( outermost && !seed && setMatched.length > 0 &&
					( matchedCount + setMatchers.length ) > 1 ) {

					jQuery.uniqueSort( results );
				}
			}

			// Override manipulation of globals by nested matchers
			if ( outermost ) {
				dirruns = dirrunsUnique;
				outermostContext = contextBackup;
			}

			return unmatched;
		};

	return bySet ?
		markFunction( superMatcher ) :
		superMatcher;
}

function compile( selector, match /* Internal Use Only */ ) {
	var i,
		setMatchers = [],
		elementMatchers = [],
		cached = compilerCache[ selector + " " ];

	if ( !cached ) {

		// Generate a function of recursive functions that can be used to check each element
		if ( !match ) {
			match = tokenize( selector );
		}
		i = match.length;
		while ( i-- ) {
			cached = matcherFromTokens( match[ i ] );
			if ( cached[ expando ] ) {
				setMatchers.push( cached );
			} else {
				elementMatchers.push( cached );
			}
		}

		// Cache the compiled function
		cached = compilerCache( selector,
			matcherFromGroupMatchers( elementMatchers, setMatchers ) );

		// Save selector and tokenization
		cached.selector = selector;
	}
	return cached;
}

/**
 * A low-level selection function that works with jQuery's compiled
 *  selector functions
 * @param {String|Function} selector A selector or a pre-compiled
 *  selector function built with jQuery selector compile
 * @param {Element} context
 * @param {Array} [results]
 * @param {Array} [seed] A set of elements to match against
 */
function select( selector, context, results, seed ) {
	var i, tokens, token, type, find,
		compiled = typeof selector === "function" && selector,
		match = !seed && tokenize( ( selector = compiled.selector || selector ) );

	results = results || [];

	// Try to minimize operations if there is only one selector in the list and no seed
	// (the latter of which guarantees us context)
	if ( match.length === 1 ) {

		// Reduce context if the leading compound selector is an ID
		tokens = match[ 0 ] = match[ 0 ].slice( 0 );
		if ( tokens.length > 2 && ( token = tokens[ 0 ] ).type === "ID" &&
				context.nodeType === 9 && documentIsHTML && Expr.relative[ tokens[ 1 ].type ] ) {

			context = ( Expr.find.ID(
				token.matches[ 0 ].replace( runescape, funescape ),
				context
			) || [] )[ 0 ];
			if ( !context ) {
				return results;

			// Precompiled matchers will still verify ancestry, so step up a level
			} else if ( compiled ) {
				context = context.parentNode;
			}

			selector = selector.slice( tokens.shift().value.length );
		}

		// Fetch a seed set for right-to-left matching
		i = matchExpr.needsContext.test( selector ) ? 0 : tokens.length;
		while ( i-- ) {
			token = tokens[ i ];

			// Abort if we hit a combinator
			if ( Expr.relative[ ( type = token.type ) ] ) {
				break;
			}
			if ( ( find = Expr.find[ type ] ) ) {

				// Search, expanding context for leading sibling combinators
				if ( ( seed = find(
					token.matches[ 0 ].replace( runescape, funescape ),
					rsibling.test( tokens[ 0 ].type ) &&
						testContext( context.parentNode ) || context
				) ) ) {

					// If seed is empty or no tokens remain, we can return early
					tokens.splice( i, 1 );
					selector = seed.length && toSelector( tokens );
					if ( !selector ) {
						push.apply( results, seed );
						return results;
					}

					break;
				}
			}
		}
	}

	// Compile and execute a filtering function if one is not provided
	// Provide `match` to avoid retokenization if we modified the selector above
	( compiled || compile( selector, match ) )(
		seed,
		context,
		!documentIsHTML,
		results,
		!context || rsibling.test( selector ) && testContext( context.parentNode ) || context
	);
	return results;
}

// One-time assignments

// Support: Android <=4.0 - 4.1+
// Sort stability
support.sortStable = expando.split( "" ).sort( sortOrder ).join( "" ) === expando;

// Initialize against the default document
setDocument();

// Support: Android <=4.0 - 4.1+
// Detached nodes confoundingly follow *each other*
support.sortDetached = assert( function( el ) {

	// Should return 1, but returns 4 (following)
	return el.compareDocumentPosition( document.createElement( "fieldset" ) ) & 1;
} );

jQuery.find = find;

// Deprecated
jQuery.expr[ ":" ] = jQuery.expr.pseudos;
jQuery.unique = jQuery.uniqueSort;

// These have always been private, but they used to be documented as part of
// Sizzle so let's maintain them for now for backwards compatibility purposes.
find.compile = compile;
find.select = select;
find.setDocument = setDocument;
find.tokenize = tokenize;

find.escape = jQuery.escapeSelector;
find.getText = jQuery.text;
find.isXML = jQuery.isXMLDoc;
find.selectors = jQuery.expr;
find.support = jQuery.support;
find.uniqueSort = jQuery.uniqueSort;

	/* eslint-enable */

} )();


var dir = function( elem, dir, until ) {
	var matched = [],
		truncate = until !== undefined;

	while ( ( elem = elem[ dir ] ) && elem.nodeType !== 9 ) {
		if ( elem.nodeType === 1 ) {
			if ( truncate && jQuery( elem ).is( until ) ) {
				break;
			}
			matched.push( elem );
		}
	}
	return matched;
};


var siblings = function( n, elem ) {
	var matched = [];

	for ( ; n; n = n.nextSibling ) {
		if ( n.nodeType === 1 && n !== elem ) {
			matched.push( n );
		}
	}

	return matched;
};


var rneedsContext = jQuery.expr.match.needsContext;

var rsingleTag = ( /^<([a-z][^\/\0>:\x20\t\r\n\f]*)[\x20\t\r\n\f]*\/?>(?:<\/\1>|)$/i );



// Implement the identical functionality for filter and not
function winnow( elements, qualifier, not ) {
	if ( isFunction( qualifier ) ) {
		return jQuery.grep( elements, function( elem, i ) {
			return !!qualifier.call( elem, i, elem ) !== not;
		} );
	}

	// Single element
	if ( qualifier.nodeType ) {
		return jQuery.grep( elements, function( elem ) {
			return ( elem === qualifier ) !== not;
		} );
	}

	// Arraylike of elements (jQuery, arguments, Array)
	if ( typeof qualifier !== "string" ) {
		return jQuery.grep( elements, function( elem ) {
			return ( indexOf.call( qualifier, elem ) > -1 ) !== not;
		} );
	}

	// Filtered directly for both simple and complex selectors
	return jQuery.filter( qualifier, elements, not );
}

jQuery.filter = function( expr, elems, not ) {
	var elem = elems[ 0 ];

	if ( not ) {
		expr = ":not(" + expr + ")";
	}

	if ( elems.length === 1 && elem.nodeType === 1 ) {
		return jQuery.find.matchesSelector( elem, expr ) ? [ elem ] : [];
	}

	return jQuery.find.matches( expr, jQuery.grep( elems, function( elem ) {
		return elem.nodeType === 1;
	} ) );
};

jQuery.fn.extend( {
	find: function( selector ) {
		var i, ret,
			len = this.length,
			self = this;

		if ( typeof selector !== "string" ) {
			return this.pushStack( jQuery( selector ).filter( function() {
				for ( i = 0; i < len; i++ ) {
					if ( jQuery.contains( self[ i ], this ) ) {
						return true;
					}
				}
			} ) );
		}

		ret = this.pushStack( [] );

		for ( i = 0; i < len; i++ ) {
			jQuery.find( selector, self[ i ], ret );
		}

		return len > 1 ? jQuery.uniqueSort( ret ) : ret;
	},
	filter: function( selector ) {
		return this.pushStack( winnow( this, selector || [], false ) );
	},
	not: function( selector ) {
		return this.pushStack( winnow( this, selector || [], true ) );
	},
	is: function( selector ) {
		return !!winnow(
			this,

			// If this is a positional/relative selector, check membership in the returned set
			// so $("p:first").is("p:last") won't return true for a doc with two "p".
			typeof selector === "string" && rneedsContext.test( selector ) ?
				jQuery( selector ) :
				selector || [],
			false
		).length;
	}
} );


// Initialize a jQuery object


// A central reference to the root jQuery(document)
var rootjQuery,

	// A simple way to check for HTML strings
	// Prioritize #id over <tag> to avoid XSS via location.hash (trac-9521)
	// Strict HTML recognition (trac-11290: must start with <)
	// Shortcut simple #id case for speed
	rquickExpr = /^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]+))$/,

	init = jQuery.fn.init = function( selector, context, root ) {
		var match, elem;

		// HANDLE: $(""), $(null), $(undefined), $(false)
		if ( !selector ) {
			return this;
		}

		// Method init() accepts an alternate rootjQuery
		// so migrate can support jQuery.sub (gh-2101)
		root = root || rootjQuery;

		// Handle HTML strings
		if ( typeof selector === "string" ) {
			if ( selector[ 0 ] === "<" &&
				selector[ selector.length - 1 ] === ">" &&
				selector.length >= 3 ) {

				// Assume that strings that start and end with <> are HTML and skip the regex check
				match = [ null, selector, null ];

			} else {
				match = rquickExpr.exec( selector );
			}

			// Match html or make sure no context is specified for #id
			if ( match && ( match[ 1 ] || !context ) ) {

				// HANDLE: $(html) -> $(array)
				if ( match[ 1 ] ) {
					context = context instanceof jQuery ? context[ 0 ] : context;

					// Option to run scripts is true for back-compat
					// Intentionally let the error be thrown if parseHTML is not present
					jQuery.merge( this, jQuery.parseHTML(
						match[ 1 ],
						context && context.nodeType ? context.ownerDocument || context : document,
						true
					) );

					// HANDLE: $(html, props)
					if ( rsingleTag.test( match[ 1 ] ) && jQuery.isPlainObject( context ) ) {
						for ( match in context ) {

							// Properties of context are called as methods if possible
							if ( isFunction( this[ match ] ) ) {
								this[ match ]( context[ match ] );

							// ...and otherwise set as attributes
							} else {
								this.attr( match, context[ match ] );
							}
						}
					}

					return this;

				// HANDLE: $(#id)
				} else {
					elem = document.getElementById( match[ 2 ] );

					if ( elem ) {

						// Inject the element directly into the jQuery object
						this[ 0 ] = elem;
						this.length = 1;
					}
					return this;
				}

			// HANDLE: $(expr, $(...))
			} else if ( !context || context.jquery ) {
				return ( context || root ).find( selector );

			// HANDLE: $(expr, context)
			// (which is just equivalent to: $(context).find(expr)
			} else {
				return this.constructor( context ).find( selector );
			}

		// HANDLE: $(DOMElement)
		} else if ( selector.nodeType ) {
			this[ 0 ] = selector;
			this.length = 1;
			return this;

		// HANDLE: $(function)
		// Shortcut for document ready
		} else if ( isFunction( selector ) ) {
			return root.ready !== undefined ?
				root.ready( selector ) :

				// Execute immediately if ready is not present
				selector( jQuery );
		}

		return jQuery.makeArray( selector, this );
	};

// Give the init function the jQuery prototype for later instantiation
init.prototype = jQuery.fn;

// Initialize central reference
rootjQuery = jQuery( document );


var rparentsprev = /^(?:parents|prev(?:Until|All))/,

	// Methods guaranteed to produce a unique set when starting from a unique set
	guaranteedUnique = {
		children: true,
		contents: true,
		next: true,
		prev: true
	};

jQuery.fn.extend( {
	has: function( target ) {
		var targets = jQuery( target, this ),
			l = targets.length;

		return this.filter( function() {
			var i = 0;
			for ( ; i < l; i++ ) {
				if ( jQuery.contains( this, targets[ i ] ) ) {
					return true;
				}
			}
		} );
	},

	closest: function( selectors, context ) {
		var cur,
			i = 0,
			l = this.length,
			matched = [],
			targets = typeof selectors !== "string" && jQuery( selectors );

		// Positional selectors never match, since there's no _selection_ context
		if ( !rneedsContext.test( selectors ) ) {
			for ( ; i < l; i++ ) {
				for ( cur = this[ i ]; cur && cur !== context; cur = cur.parentNode ) {

					// Always skip document fragments
					if ( cur.nodeType < 11 && ( targets ?
						targets.index( cur ) > -1 :

						// Don't pass non-elements to jQuery#find
						cur.nodeType === 1 &&
							jQuery.find.matchesSelector( cur, selectors ) ) ) {

						matched.push( cur );
						break;
					}
				}
			}
		}

		return this.pushStack( matched.length > 1 ? jQuery.uniqueSort( matched ) : matched );
	},

	// Determine the position of an element within the set
	index: function( elem ) {

		// No argument, return index in parent
		if ( !elem ) {
			return ( this[ 0 ] && this[ 0 ].parentNode ) ? this.first().prevAll().length : -1;
		}

		// Index in selector
		if ( typeof elem === "string" ) {
			return indexOf.call( jQuery( elem ), this[ 0 ] );
		}

		// Locate the position of the desired element
		return indexOf.call( this,

			// If it receives a jQuery object, the first element is used
			elem.jquery ? elem[ 0 ] : elem
		);
	},

	add: function( selector, context ) {
		return this.pushStack(
			jQuery.uniqueSort(
				jQuery.merge( this.get(), jQuery( selector, context ) )
			)
		);
	},

	addBack: function( selector ) {
		return this.add( selector == null ?
			this.prevObject : this.prevObject.filter( selector )
		);
	}
} );

function sibling( cur, dir ) {
	while ( ( cur = cur[ dir ] ) && cur.nodeType !== 1 ) {}
	return cur;
}

jQuery.each( {
	parent: function( elem ) {
		var parent = elem.parentNode;
		return parent && parent.nodeType !== 11 ? parent : null;
	},
	parents: function( elem ) {
		return dir( elem, "parentNode" );
	},
	parentsUntil: function( elem, _i, until ) {
		return dir( elem, "parentNode", until );
	},
	next: function( elem ) {
		return sibling( elem, "nextSibling" );
	},
	prev: function( elem ) {
		return sibling( elem, "previousSibling" );
	},
	nextAll: function( elem ) {
		return dir( elem, "nextSibling" );
	},
	prevAll: function( elem ) {
		return dir( elem, "previousSibling" );
	},
	nextUntil: function( elem, _i, until ) {
		return dir( elem, "nextSibling", until );
	},
	prevUntil: function( elem, _i, until ) {
		return dir( elem, "previousSibling", until );
	},
	siblings: function( elem ) {
		return siblings( ( elem.parentNode || {} ).firstChild, elem );
	},
	children: function( elem ) {
		return siblings( elem.firstChild );
	},
	contents: function( elem ) {
		if ( elem.contentDocument != null &&

			// Support: IE 11+
			// <object> elements with no `data` attribute has an object
			// `contentDocument` with a `null` prototype.
			getProto( elem.contentDocument ) ) {

			return elem.contentDocument;
		}

		// Support: IE 9 - 11 only, iOS 7 only, Android Browser <=4.3 only
		// Treat the template element as a regular one in browsers that
		// don't support it.
		if ( nodeName( elem, "template" ) ) {
			elem = elem.content || elem;
		}

		return jQuery.merge( [], elem.childNodes );
	}
}, function( name, fn ) {
	jQuery.fn[ name ] = function( until, selector ) {
		var matched = jQuery.map( this, fn, until );

		if ( name.slice( -5 ) !== "Until" ) {
			selector = until;
		}

		if ( selector && typeof selector === "string" ) {
			matched = jQuery.filter( selector, matched );
		}

		if ( this.length > 1 ) {

			// Remove duplicates
			if ( !guaranteedUnique[ name ] ) {
				jQuery.uniqueSort( matched );
			}

			// Reverse order for parents* and prev-derivatives
			if ( rparentsprev.test( name ) ) {
				matched.reverse();
			}
		}

		return this.pushStack( matched );
	};
} );
var rnothtmlwhite = ( /[^\x20\t\r\n\f]+/g );



// Convert String-formatted options into Object-formatted ones
function createOptions( options ) {
	var object = {};
	jQuery.each( options.match( rnothtmlwhite ) || [], function( _, flag ) {
		object[ flag ] = true;
	} );
	return object;
}

/*
 * Create a callback list using the following parameters:
 *
 *	options: an optional list of space-separated options that will change how
 *			the callback list behaves or a more traditional option object
 *
 * By default a callback list will act like an event callback list and can be
 * "fired" multiple times.
 *
 * Possible options:
 *
 *	once:			will ensure the callback list can only be fired once (like a Deferred)
 *
 *	memory:			will keep track of previous values and will call any callback added
 *					after the list has been fired right away with the latest "memorized"
 *					values (like a Deferred)
 *
 *	unique:			will ensure a callback can only be added once (no duplicate in the list)
 *
 *	stopOnFalse:	interrupt callings when a callback returns false
 *
 */
jQuery.Callbacks = function( options ) {

	// Convert options from String-formatted to Object-formatted if needed
	// (we check in cache first)
	options = typeof options === "string" ?
		createOptions( options ) :
		jQuery.extend( {}, options );

	var // Flag to know if list is currently firing
		firing,

		// Last fire value for non-forgettable lists
		memory,

		// Flag to know if list was already fired
		fired,

		// Flag to prevent firing
		locked,

		// Actual callback list
		list = [],

		// Queue of execution data for repeatable lists
		queue = [],

		// Index of currently firing callback (modified by add/remove as needed)
		firingIndex = -1,

		// Fire callbacks
		fire = function() {

			// Enforce single-firing
			locked = locked || options.once;

			// Execute callbacks for all pending executions,
			// respecting firingIndex overrides and runtime changes
			fired = firing = true;
			for ( ; queue.length; firingIndex = -1 ) {
				memory = queue.shift();
				while ( ++firingIndex < list.length ) {

					// Run callback and check for early termination
					if ( list[ firingIndex ].apply( memory[ 0 ], memory[ 1 ] ) === false &&
						options.stopOnFalse ) {

						// Jump to end and forget the data so .add doesn't re-fire
						firingIndex = list.length;
						memory = false;
					}
				}
			}

			// Forget the data if we're done with it
			if ( !options.memory ) {
				memory = false;
			}

			firing = false;

			// Clean up if we're done firing for good
			if ( locked ) {

				// Keep an empty list if we have data for future add calls
				if ( memory ) {
					list = [];

				// Otherwise, this object is spent
				} else {
					list = "";
				}
			}
		},

		// Actual Callbacks object
		self = {

			// Add a callback or a collection of callbacks to the list
			add: function() {
				if ( list ) {

					// If we have memory from a past run, we should fire after adding
					if ( memory && !firing ) {
						firingIndex = list.length - 1;
						queue.push( memory );
					}

					( function add( args ) {
						jQuery.each( args, function( _, arg ) {
							if ( isFunction( arg ) ) {
								if ( !options.unique || !self.has( arg ) ) {
									list.push( arg );
								}
							} else if ( arg && arg.length && toType( arg ) !== "string" ) {

								// Inspect recursively
								add( arg );
							}
						} );
					} )( arguments );

					if ( memory && !firing ) {
						fire();
					}
				}
				return this;
			},

			// Remove a callback from the list
			remove: function() {
				jQuery.each( arguments, function( _, arg ) {
					var index;
					while ( ( index = jQuery.inArray( arg, list, index ) ) > -1 ) {
						list.splice( index, 1 );

						// Handle firing indexes
						if ( index <= firingIndex ) {
							firingIndex--;
						}
					}
				} );
				return this;
			},

			// Check if a given callback is in the list.
			// If no argument is given, return whether or not list has callbacks attached.
			has: function( fn ) {
				return fn ?
					jQuery.inArray( fn, list ) > -1 :
					list.length > 0;
			},

			// Remove all callbacks from the list
			empty: function() {
				if ( list ) {
					list = [];
				}
				return this;
			},

			// Disable .fire and .add
			// Abort any current/pending executions
			// Clear all callbacks and values
			disable: function() {
				locked = queue = [];
				list = memory = "";
				return this;
			},
			disabled: function() {
				return !list;
			},

			// Disable .fire
			// Also disable .add unless we have memory (since it would have no effect)
			// Abort any pending executions
			lock: function() {
				locked = queue = [];
				if ( !memory && !firing ) {
					list = memory = "";
				}
				return this;
			},
			locked: function() {
				return !!locked;
			},

			// Call all callbacks with the given context and arguments
			fireWith: function( context, args ) {
				if ( !locked ) {
					args = args || [];
					args = [ context, args.slice ? args.slice() : args ];
					queue.push( args );
					if ( !firing ) {
						fire();
					}
				}
				return this;
			},

			// Call all the callbacks with the given arguments
			fire: function() {
				self.fireWith( this, arguments );
				return this;
			},

			// To know if the callbacks have already been called at least once
			fired: function() {
				return !!fired;
			}
		};

	return self;
};


function Identity( v ) {
	return v;
}
function Thrower( ex ) {
	throw ex;
}

function adoptValue( value, resolve, reject, noValue ) {
	var method;

	try {

		// Check for promise aspect first to privilege synchronous behavior
		if ( value && isFunction( ( method = value.promise ) ) ) {
			method.call( value ).done( resolve ).fail( reject );

		// Other thenables
		} else if ( value && isFunction( ( method = value.then ) ) ) {
			method.call( value, resolve, reject );

		// Other non-thenables
		} else {

			// Control `resolve` arguments by letting Array#slice cast boolean `noValue` to integer:
			// * false: [ value ].slice( 0 ) => resolve( value )
			// * true: [ value ].slice( 1 ) => resolve()
			resolve.apply( undefined, [ value ].slice( noValue ) );
		}

	// For Promises/A+, convert exceptions into rejections
	// Since jQuery.when doesn't unwrap thenables, we can skip the extra checks appearing in
	// Deferred#then to conditionally suppress rejection.
	} catch ( value ) {

		// Support: Android 4.0 only
		// Strict mode functions invoked without .call/.apply get global-object context
		reject.apply( undefined, [ value ] );
	}
}

jQuery.extend( {

	Deferred: function( func ) {
		var tuples = [

				// action, add listener, callbacks,
				// ... .then handlers, argument index, [final state]
				[ "notify", "progress", jQuery.Callbacks( "memory" ),
					jQuery.Callbacks( "memory" ), 2 ],
				[ "resolve", "done", jQuery.Callbacks( "once memory" ),
					jQuery.Callbacks( "once memory" ), 0, "resolved" ],
				[ "reject", "fail", jQuery.Callbacks( "once memory" ),
					jQuery.Callbacks( "once memory" ), 1, "rejected" ]
			],
			state = "pending",
			promise = {
				state: function() {
					return state;
				},
				always: function() {
					deferred.done( arguments ).fail( arguments );
					return this;
				},
				"catch": function( fn ) {
					return promise.then( null, fn );
				},

				// Keep pipe for back-compat
				pipe: function( /* fnDone, fnFail, fnProgress */ ) {
					var fns = arguments;

					return jQuery.Deferred( function( newDefer ) {
						jQuery.each( tuples, function( _i, tuple ) {

							// Map tuples (progress, done, fail) to arguments (done, fail, progress)
							var fn = isFunction( fns[ tuple[ 4 ] ] ) && fns[ tuple[ 4 ] ];

							// deferred.progress(function() { bind to newDefer or newDefer.notify })
							// deferred.done(function() { bind to newDefer or newDefer.resolve })
							// deferred.fail(function() { bind to newDefer or newDefer.reject })
							deferred[ tuple[ 1 ] ]( function() {
								var returned = fn && fn.apply( this, arguments );
								if ( returned && isFunction( returned.promise ) ) {
									returned.promise()
										.progress( newDefer.notify )
										.done( newDefer.resolve )
										.fail( newDefer.reject );
								} else {
									newDefer[ tuple[ 0 ] + "With" ](
										this,
										fn ? [ returned ] : arguments
									);
								}
							} );
						} );
						fns = null;
					} ).promise();
				},
				then: function( onFulfilled, onRejected, onProgress ) {
					var maxDepth = 0;
					function resolve( depth, deferred, handler, special ) {
						return function() {
							var that = this,
								args = arguments,
								mightThrow = function() {
									var returned, then;

									// Support: Promises/A+ section 2.3.3.3.3
									// https://promisesaplus.com/#point-59
									// Ignore double-resolution attempts
									if ( depth < maxDepth ) {
										return;
									}

									returned = handler.apply( that, args );

									// Support: Promises/A+ section 2.3.1
									// https://promisesaplus.com/#point-48
									if ( returned === deferred.promise() ) {
										throw new TypeError( "Thenable self-resolution" );
									}

									// Support: Promises/A+ sections 2.3.3.1, 3.5
									// https://promisesaplus.com/#point-54
									// https://promisesaplus.com/#point-75
									// Retrieve `then` only once
									then = returned &&

										// Support: Promises/A+ section 2.3.4
										// https://promisesaplus.com/#point-64
										// Only check objects and functions for thenability
										( typeof returned === "object" ||
											typeof returned === "function" ) &&
										returned.then;

									// Handle a returned thenable
									if ( isFunction( then ) ) {

										// Special processors (notify) just wait for resolution
										if ( special ) {
											then.call(
												returned,
												resolve( maxDepth, deferred, Identity, special ),
												resolve( maxDepth, deferred, Thrower, special )
											);

										// Normal processors (resolve) also hook into progress
										} else {

											// ...and disregard older resolution values
											maxDepth++;

											then.call(
												returned,
												resolve( maxDepth, deferred, Identity, special ),
												resolve( maxDepth, deferred, Thrower, special ),
												resolve( maxDepth, deferred, Identity,
													deferred.notifyWith )
											);
										}

									// Handle all other returned values
									} else {

										// Only substitute handlers pass on context
										// and multiple values (non-spec behavior)
										if ( handler !== Identity ) {
											that = undefined;
											args = [ returned ];
										}

										// Process the value(s)
										// Default process is resolve
										( special || deferred.resolveWith )( that, args );
									}
								},

								// Only normal processors (resolve) catch and reject exceptions
								process = special ?
									mightThrow :
									function() {
										try {
											mightThrow();
										} catch ( e ) {

											if ( jQuery.Deferred.exceptionHook ) {
												jQuery.Deferred.exceptionHook( e,
													process.error );
											}

											// Support: Promises/A+ section 2.3.3.3.4.1
											// https://promisesaplus.com/#point-61
											// Ignore post-resolution exceptions
											if ( depth + 1 >= maxDepth ) {

												// Only substitute handlers pass on context
												// and multiple values (non-spec behavior)
												if ( handler !== Thrower ) {
													that = undefined;
													args = [ e ];
												}

												deferred.rejectWith( that, args );
											}
										}
									};

							// Support: Promises/A+ section 2.3.3.3.1
							// https://promisesaplus.com/#point-57
							// Re-resolve promises immediately to dodge false rejection from
							// subsequent errors
							if ( depth ) {
								process();
							} else {

								// Call an optional hook to record the error, in case of exception
								// since it's otherwise lost when execution goes async
								if ( jQuery.Deferred.getErrorHook ) {
									process.error = jQuery.Deferred.getErrorHook();

								// The deprecated alias of the above. While the name suggests
								// returning the stack, not an error instance, jQuery just passes
								// it directly to `console.warn` so both will work; an instance
								// just better cooperates with source maps.
								} else if ( jQuery.Deferred.getStackHook ) {
									process.error = jQuery.Deferred.getStackHook();
								}
								window.setTimeout( process );
							}
						};
					}

					return jQuery.Deferred( function( newDefer ) {

						// progress_handlers.add( ... )
						tuples[ 0 ][ 3 ].add(
							resolve(
								0,
								newDefer,
								isFunction( onProgress ) ?
									onProgress :
									Identity,
								newDefer.notifyWith
							)
						);

						// fulfilled_handlers.add( ... )
						tuples[ 1 ][ 3 ].add(
							resolve(
								0,
								newDefer,
								isFunction( onFulfilled ) ?
									onFulfilled :
									Identity
							)
						);

						// rejected_handlers.add( ... )
						tuples[ 2 ][ 3 ].add(
							resolve(
								0,
								newDefer,
								isFunction( onRejected ) ?
									onRejected :
									Thrower
							)
						);
					} ).promise();
				},

				// Get a promise for this deferred
				// If obj is provided, the promise aspect is added to the object
				promise: function( obj ) {
					return obj != null ? jQuery.extend( obj, promise ) : promise;
				}
			},
			deferred = {};

		// Add list-specific methods
		jQuery.each( tuples, function( i, tuple ) {
			var list = tuple[ 2 ],
				stateString = tuple[ 5 ];

			// promise.progress = list.add
			// promise.done = list.add
			// promise.fail = list.add
			promise[ tuple[ 1 ] ] = list.add;

			// Handle state
			if ( stateString ) {
				list.add(
					function() {

						// state = "resolved" (i.e., fulfilled)
						// state = "rejected"
						state = stateString;
					},

					// rejected_callbacks.disable
					// fulfilled_callbacks.disable
					tuples[ 3 - i ][ 2 ].disable,

					// rejected_handlers.disable
					// fulfilled_handlers.disable
					tuples[ 3 - i ][ 3 ].disable,

					// progress_callbacks.lock
					tuples[ 0 ][ 2 ].lock,

					// progress_handlers.lock
					tuples[ 0 ][ 3 ].lock
				);
			}

			// progress_handlers.fire
			// fulfilled_handlers.fire
			// rejected_handlers.fire
			list.add( tuple[ 3 ].fire );

			// deferred.notify = function() { deferred.notifyWith(...) }
			// deferred.resolve = function() { deferred.resolveWith(...) }
			// deferred.reject = function() { deferred.rejectWith(...) }
			deferred[ tuple[ 0 ] ] = function() {
				deferred[ tuple[ 0 ] + "With" ]( this === deferred ? undefined : this, arguments );
				return this;
			};

			// deferred.notifyWith = list.fireWith
			// deferred.resolveWith = list.fireWith
			// deferred.rejectWith = list.fireWith
			deferred[ tuple[ 0 ] + "With" ] = list.fireWith;
		} );

		// Make the deferred a promise
		promise.promise( deferred );

		// Call given func if any
		if ( func ) {
			func.call( deferred, deferred );
		}

		// All done!
		return deferred;
	},

	// Deferred helper
	when: function( singleValue ) {
		var

			// count of uncompleted subordinates
			remaining = arguments.length,

			// count of unprocessed arguments
			i = remaining,

			// subordinate fulfillment data
			resolveContexts = Array( i ),
			resolveValues = slice.call( arguments ),

			// the primary Deferred
			primary = jQuery.Deferred(),

			// subordinate callback factory
			updateFunc = function( i ) {
				return function( value ) {
					resolveContexts[ i ] = this;
					resolveValues[ i ] = arguments.length > 1 ? slice.call( arguments ) : value;
					if ( !( --remaining ) ) {
						primary.resolveWith( resolveContexts, resolveValues );
					}
				};
			};

		// Single- and empty arguments are adopted like Promise.resolve
		if ( remaining <= 1 ) {
			adoptValue( singleValue, primary.done( updateFunc( i ) ).resolve, primary.reject,
				!remaining );

			// Use .then() to unwrap secondary thenables (cf. gh-3000)
			if ( primary.state() === "pending" ||
				isFunction( resolveValues[ i ] && resolveValues[ i ].then ) ) {

				return primary.then();
			}
		}

		// Multiple arguments are aggregated like Promise.all array elements
		while ( i-- ) {
			adoptValue( resolveValues[ i ], updateFunc( i ), primary.reject );
		}

		return primary.promise();
	}
} );


// These usually indicate a programmer mistake during development,
// warn about them ASAP rather than swallowing them by default.
var rerrorNames = /^(Eval|Internal|Range|Reference|Syntax|Type|URI)Error$/;

// If `jQuery.Deferred.getErrorHook` is defined, `asyncError` is an error
// captured before the async barrier to get the original error cause
// which may otherwise be hidden.
jQuery.Deferred.exceptionHook = function( error, asyncError ) {

	// Support: IE 8 - 9 only
	// Console exists when dev tools are open, which can happen at any time
	if ( window.console && window.console.warn && error && rerrorNames.test( error.name ) ) {
		window.console.warn( "jQuery.Deferred exception: " + error.message,
			error.stack, asyncError );
	}
};




jQuery.readyException = function( error ) {
	window.setTimeout( function() {
		throw error;
	} );
};




// The deferred used on DOM ready
var readyList = jQuery.Deferred();

jQuery.fn.ready = function( fn ) {

	readyList
		.then( fn )

		// Wrap jQuery.readyException in a function so that the lookup
		// happens at the time of error handling instead of callback
		// registration.
		.catch( function( error ) {
			jQuery.readyException( error );
		} );

	return this;
};

jQuery.extend( {

	// Is the DOM ready to be used? Set to true once it occurs.
	isReady: false,

	// A counter to track how many items to wait for before
	// the ready event fires. See trac-6781
	readyWait: 1,

	// Handle when the DOM is ready
	ready: function( wait ) {

		// Abort if there are pending holds or we're already ready
		if ( wait === true ? --jQuery.readyWait : jQuery.isReady ) {
			return;
		}

		// Remember that the DOM is ready
		jQuery.isReady = true;

		// If a normal DOM Ready event fired, decrement, and wait if need be
		if ( wait !== true && --jQuery.readyWait > 0 ) {
			return;
		}

		// If there are functions bound, to execute
		readyList.resolveWith( document, [ jQuery ] );
	}
} );

jQuery.ready.then = readyList.then;

// The ready event handler and self cleanup method
function completed() {
	document.removeEventListener( "DOMContentLoaded", completed );
	window.removeEventListener( "load", completed );
	jQuery.ready();
}

// Catch cases where $(document).ready() is called
// after the browser event has already occurred.
// Support: IE <=9 - 10 only
// Older IE sometimes signals "interactive" too soon
if ( document.readyState === "complete" ||
	( document.readyState !== "loading" && !document.documentElement.doScroll ) ) {

	// Handle it asynchronously to allow scripts the opportunity to delay ready
	window.setTimeout( jQuery.ready );

} else {

	// Use the handy event callback
	document.addEventListener( "DOMContentLoaded", completed );

	// A fallback to window.onload, that will always work
	window.addEventListener( "load", completed );
}




// Multifunctional method to get and set values of a collection
// The value/s can optionally be executed if it's a function
var access = function( elems, fn, key, value, chainable, emptyGet, raw ) {
	var i = 0,
		len = elems.length,
		bulk = key == null;

	// Sets many values
	if ( toType( key ) === "object" ) {
		chainable = true;
		for ( i in key ) {
			access( elems, fn, i, key[ i ], true, emptyGet, raw );
		}

	// Sets one value
	} else if ( value !== undefined ) {
		chainable = true;

		if ( !isFunction( value ) ) {
			raw = true;
		}

		if ( bulk ) {

			// Bulk operations run against the entire set
			if ( raw ) {
				fn.call( elems, value );
				fn = null;

			// ...except when executing function values
			} else {
				bulk = fn;
				fn = function( elem, _key, value ) {
					return bulk.call( jQuery( elem ), value );
				};
			}
		}

		if ( fn ) {
			for ( ; i < len; i++ ) {
				fn(
					elems[ i ], key, raw ?
						value :
						value.call( elems[ i ], i, fn( elems[ i ], key ) )
				);
			}
		}
	}

	if ( chainable ) {
		return elems;
	}

	// Gets
	if ( bulk ) {
		return fn.call( elems );
	}

	return len ? fn( elems[ 0 ], key ) : emptyGet;
};


// Matches dashed string for camelizing
var rmsPrefix = /^-ms-/,
	rdashAlpha = /-([a-z])/g;

// Used by camelCase as callback to replace()
function fcamelCase( _all, letter ) {
	return letter.toUpperCase();
}

// Convert dashed to camelCase; used by the css and data modules
// Support: IE <=9 - 11, Edge 12 - 15
// Microsoft forgot to hump their vendor prefix (trac-9572)
function camelCase( string ) {
	return string.replace( rmsPrefix, "ms-" ).replace( rdashAlpha, fcamelCase );
}
var acceptData = function( owner ) {

	// Accepts only:
	//  - Node
	//    - Node.ELEMENT_NODE
	//    - Node.DOCUMENT_NODE
	//  - Object
	//    - Any
	return owner.nodeType === 1 || owner.nodeType === 9 || !( +owner.nodeType );
};




function Data() {
	this.expando = jQuery.expando + Data.uid++;
}

Data.uid = 1;

Data.prototype = {

	cache: function( owner ) {

		// Check if the owner object already has a cache
		var value = owner[ this.expando ];

		// If not, create one
		if ( !value ) {
			value = {};

			// We can accept data for non-element nodes in modern browsers,
			// but we should not, see trac-8335.
			// Always return an empty object.
			if ( acceptData( owner ) ) {

				// If it is a node unlikely to be stringify-ed or looped over
				// use plain assignment
				if ( owner.nodeType ) {
					owner[ this.expando ] = value;

				// Otherwise secure it in a non-enumerable property
				// configurable must be true to allow the property to be
				// deleted when data is removed
				} else {
					Object.defineProperty( owner, this.expando, {
						value: value,
						configurable: true
					} );
				}
			}
		}

		return value;
	},
	set: function( owner, data, value ) {
		var prop,
			cache = this.cache( owner );

		// Handle: [ owner, key, value ] args
		// Always use camelCase key (gh-2257)
		if ( typeof data === "string" ) {
			cache[ camelCase( data ) ] = value;

		// Handle: [ owner, { properties } ] args
		} else {

			// Copy the properties one-by-one to the cache object
			for ( prop in data ) {
				cache[ camelCase( prop ) ] = data[ prop ];
			}
		}
		return cache;
	},
	get: function( owner, key ) {
		return key === undefined ?
			this.cache( owner ) :

			// Always use camelCase key (gh-2257)
			owner[ this.expando ] && owner[ this.expando ][ camelCase( key ) ];
	},
	access: function( owner, key, value ) {

		// In cases where either:
		//
		//   1. No key was specified
		//   2. A string key was specified, but no value provided
		//
		// Take the "read" path and allow the get method to determine
		// which value to return, respectively either:
		//
		//   1. The entire cache object
		//   2. The data stored at the key
		//
		if ( key === undefined ||
				( ( key && typeof key === "string" ) && value === undefined ) ) {

			return this.get( owner, key );
		}

		// When the key is not a string, or both a key and value
		// are specified, set or extend (existing objects) with either:
		//
		//   1. An object of properties
		//   2. A key and value
		//
		this.set( owner, key, value );

		// Since the "set" path can have two possible entry points
		// return the expected data based on which path was taken[*]
		return value !== undefined ? value : key;
	},
	remove: function( owner, key ) {
		var i,
			cache = owner[ this.expando ];

		if ( cache === undefined ) {
			return;
		}

		if ( key !== undefined ) {

			// Support array or space separated string of keys
			if ( Array.isArray( key ) ) {

				// If key is an array of keys...
				// We always set camelCase keys, so remove that.
				key = key.map( camelCase );
			} else {
				key = camelCase( key );

				// If a key with the spaces exists, use it.
				// Otherwise, create an array by matching non-whitespace
				key = key in cache ?
					[ key ] :
					( key.match( rnothtmlwhite ) || [] );
			}

			i = key.length;

			while ( i-- ) {
				delete cache[ key[ i ] ];
			}
		}

		// Remove the expando if there's no more data
		if ( key === undefined || jQuery.isEmptyObject( cache ) ) {

			// Support: Chrome <=35 - 45
			// Webkit & Blink performance suffers when deleting properties
			// from DOM nodes, so set to undefined instead
			// https://bugs.chromium.org/p/chromium/issues/detail?id=378607 (bug restricted)
			if ( owner.nodeType ) {
				owner[ this.expando ] = undefined;
			} else {
				delete owner[ this.expando ];
			}
		}
	},
	hasData: function( owner ) {
		var cache = owner[ this.expando ];
		return cache !== undefined && !jQuery.isEmptyObject( cache );
	}
};
var dataPriv = new Data();

var dataUser = new Data();



//	Implementation Summary
//
//	1. Enforce API surface and semantic compatibility with 1.9.x branch
//	2. Improve the module's maintainability by reducing the storage
//		paths to a single mechanism.
//	3. Use the same single mechanism to support "private" and "user" data.
//	4. _Never_ expose "private" data to user code (TODO: Drop _data, _removeData)
//	5. Avoid exposing implementation details on user objects (eg. expando properties)
//	6. Provide a clear path for implementation upgrade to WeakMap in 2014

var rbrace = /^(?:\{[\w\W]*\}|\[[\w\W]*\])$/,
	rmultiDash = /[A-Z]/g;

function getData( data ) {
	if ( data === "true" ) {
		return true;
	}

	if ( data === "false" ) {
		return false;
	}

	if ( data === "null" ) {
		return null;
	}

	// Only convert to a number if it doesn't change the string
	if ( data === +data + "" ) {
		return +data;
	}

	if ( rbrace.test( data ) ) {
		return JSON.parse( data );
	}

	return data;
}

function dataAttr( elem, key, data ) {
	var name;

	// If nothing was found internally, try to fetch any
	// data from the HTML5 data-* attribute
	if ( data === undefined && elem.nodeType === 1 ) {
		name = "data-" + key.replace( rmultiDash, "-$&" ).toLowerCase();
		data = elem.getAttribute( name );

		if ( typeof data === "string" ) {
			try {
				data = getData( data );
			} catch ( e ) {}

			// Make sure we set the data so it isn't changed later
			dataUser.set( elem, key, data );
		} else {
			data = undefined;
		}
	}
	return data;
}

jQuery.extend( {
	hasData: function( elem ) {
		return dataUser.hasData( elem ) || dataPriv.hasData( elem );
	},

	data: function( elem, name, data ) {
		return dataUser.access( elem, name, data );
	},

	removeData: function( elem, name ) {
		dataUser.remove( elem, name );
	},

	// TODO: Now that all calls to _data and _removeData have been replaced
	// with direct calls to dataPriv methods, these can be deprecated.
	_data: function( elem, name, data ) {
		return dataPriv.access( elem, name, data );
	},

	_removeData: function( elem, name ) {
		dataPriv.remove( elem, name );
	}
} );

jQuery.fn.extend( {
	data: function( key, value ) {
		var i, name, data,
			elem = this[ 0 ],
			attrs = elem && elem.attributes;

		// Gets all values
		if ( key === undefined ) {
			if ( this.length ) {
				data = dataUser.get( elem );

				if ( elem.nodeType === 1 && !dataPriv.get( elem, "hasDataAttrs" ) ) {
					i = attrs.length;
					while ( i-- ) {

						// Support: IE 11 only
						// The attrs elements can be null (trac-14894)
						if ( attrs[ i ] ) {
							name = attrs[ i ].name;
							if ( name.indexOf( "data-" ) === 0 ) {
								name = camelCase( name.slice( 5 ) );
								dataAttr( elem, name, data[ name ] );
							}
						}
					}
					dataPriv.set( elem, "hasDataAttrs", true );
				}
			}

			return data;
		}

		// Sets multiple values
		if ( typeof key === "object" ) {
			return this.each( function() {
				dataUser.set( this, key );
			} );
		}

		return access( this, function( value ) {
			var data;

			// The calling jQuery object (element matches) is not empty
			// (and therefore has an element appears at this[ 0 ]) and the
			// `value` parameter was not undefined. An empty jQuery object
			// will result in `undefined` for elem = this[ 0 ] which will
			// throw an exception if an attempt to read a data cache is made.
			if ( elem && value === undefined ) {

				// Attempt to get data from the cache
				// The key will always be camelCased in Data
				data = dataUser.get( elem, key );
				if ( data !== undefined ) {
					return data;
				}

				// Attempt to "discover" the data in
				// HTML5 custom data-* attrs
				data = dataAttr( elem, key );
				if ( data !== undefined ) {
					return data;
				}

				// We tried really hard, but the data doesn't exist.
				return;
			}

			// Set the data...
			this.each( function() {

				// We always store the camelCased key
				dataUser.set( this, key, value );
			} );
		}, null, value, arguments.length > 1, null, true );
	},

	removeData: function( key ) {
		return this.each( function() {
			dataUser.remove( this, key );
		} );
	}
} );


jQuery.extend( {
	queue: function( elem, type, data ) {
		var queue;

		if ( elem ) {
			type = ( type || "fx" ) + "queue";
			queue = dataPriv.get( elem, type );

			// Speed up dequeue by getting out quickly if this is just a lookup
			if ( data ) {
				if ( !queue || Array.isArray( data ) ) {
					queue = dataPriv.access( elem, type, jQuery.makeArray( data ) );
				} else {
					queue.push( data );
				}
			}
			return queue || [];
		}
	},

	dequeue: function( elem, type ) {
		type = type || "fx";

		var queue = jQuery.queue( elem, type ),
			startLength = queue.length,
			fn = queue.shift(),
			hooks = jQuery._queueHooks( elem, type ),
			next = function() {
				jQuery.dequeue( elem, type );
			};

		// If the fx queue is dequeued, always remove the progress sentinel
		if ( fn === "inprogress" ) {
			fn = queue.shift();
			startLength--;
		}

		if ( fn ) {

			// Add a progress sentinel to prevent the fx queue from being
			// automatically dequeued
			if ( type === "fx" ) {
				queue.unshift( "inprogress" );
			}

			// Clear up the last queue stop function
			delete hooks.stop;
			fn.call( elem, next, hooks );
		}

		if ( !startLength && hooks ) {
			hooks.empty.fire();
		}
	},

	// Not public - generate a queueHooks object, or return the current one
	_queueHooks: function( elem, type ) {
		var key = type + "queueHooks";
		return dataPriv.get( elem, key ) || dataPriv.access( elem, key, {
			empty: jQuery.Callbacks( "once memory" ).add( function() {
				dataPriv.remove( elem, [ type + "queue", key ] );
			} )
		} );
	}
} );

jQuery.fn.extend( {
	queue: function( type, data ) {
		var setter = 2;

		if ( typeof type !== "string" ) {
			data = type;
			type = "fx";
			setter--;
		}

		if ( arguments.length < setter ) {
			return jQuery.queue( this[ 0 ], type );
		}

		return data === undefined ?
			this :
			this.each( function() {
				var queue = jQuery.queue( this, type, data );

				// Ensure a hooks for this queue
				jQuery._queueHooks( this, type );

				if ( type === "fx" && queue[ 0 ] !== "inprogress" ) {
					jQuery.dequeue( this, type );
				}
			} );
	},
	dequeue: function( type ) {
		return this.each( function() {
			jQuery.dequeue( this, type );
		} );
	},
	clearQueue: function( type ) {
		return this.queue( type || "fx", [] );
	},

	// Get a promise resolved when queues of a certain type
	// are emptied (fx is the type by default)
	promise: function( type, obj ) {
		var tmp,
			count = 1,
			defer = jQuery.Deferred(),
			elements = this,
			i = this.length,
			resolve = function() {
				if ( !( --count ) ) {
					defer.resolveWith( elements, [ elements ] );
				}
			};

		if ( typeof type !== "string" ) {
			obj = type;
			type = undefined;
		}
		type = type || "fx";

		while ( i-- ) {
			tmp = dataPriv.get( elements[ i ], type + "queueHooks" );
			if ( tmp && tmp.empty ) {
				count++;
				tmp.empty.add( resolve );
			}
		}
		resolve();
		return defer.promise( obj );
	}
} );
var pnum = ( /[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/ ).source;

var rcssNum = new RegExp( "^(?:([+-])=|)(" + pnum + ")([a-z%]*)$", "i" );


var cssExpand = [ "Top", "Right", "Bottom", "Left" ];

var documentElement = document.documentElement;



	var isAttached = function( elem ) {
			return jQuery.contains( elem.ownerDocument, elem );
		},
		composed = { composed: true };

	// Support: IE 9 - 11+, Edge 12 - 18+, iOS 10.0 - 10.2 only
	// Check attachment across shadow DOM boundaries when possible (gh-3504)
	// Support: iOS 10.0-10.2 only
	// Early iOS 10 versions support `attachShadow` but not `getRootNode`,
	// leading to errors. We need to check for `getRootNode`.
	if ( documentElement.getRootNode ) {
		isAttached = function( elem ) {
			return jQuery.contains( elem.ownerDocument, elem ) ||
				elem.getRootNode( composed ) === elem.ownerDocument;
		};
	}
var isHiddenWithinTree = function( elem, el ) {

		// isHiddenWithinTree might be called from jQuery#filter function;
		// in that case, element will be second argument
		elem = el || elem;

		// Inline style trumps all
		return elem.style.display === "none" ||
			elem.style.display === "" &&

			// Otherwise, check computed style
			// Support: Firefox <=43 - 45
			// Disconnected elements can have computed display: none, so first confirm that elem is
			// in the document.
			isAttached( elem ) &&

			jQuery.css( elem, "display" ) === "none";
	};



function adjustCSS( elem, prop, valueParts, tween ) {
	var adjusted, scale,
		maxIterations = 20,
		currentValue = tween ?
			function() {
				return tween.cur();
			} :
			function() {
				return jQuery.css( elem, prop, "" );
			},
		initial = currentValue(),
		unit = valueParts && valueParts[ 3 ] || ( jQuery.cssNumber[ prop ] ? "" : "px" ),

		// Starting value computation is required for potential unit mismatches
		initialInUnit = elem.nodeType &&
			( jQuery.cssNumber[ prop ] || unit !== "px" && +initial ) &&
			rcssNum.exec( jQuery.css( elem, prop ) );

	if ( initialInUnit && initialInUnit[ 3 ] !== unit ) {

		// Support: Firefox <=54
		// Halve the iteration target value to prevent interference from CSS upper bounds (gh-2144)
		initial = initial / 2;

		// Trust units reported by jQuery.css
		unit = unit || initialInUnit[ 3 ];

		// Iteratively approximate from a nonzero starting point
		initialInUnit = +initial || 1;

		while ( maxIterations-- ) {

			// Evaluate and update our best guess (doubling guesses that zero out).
			// Finish if the scale equals or crosses 1 (making the old*new product non-positive).
			jQuery.style( elem, prop, initialInUnit + unit );
			if ( ( 1 - scale ) * ( 1 - ( scale = currentValue() / initial || 0.5 ) ) <= 0 ) {
				maxIterations = 0;
			}
			initialInUnit = initialInUnit / scale;

		}

		initialInUnit = initialInUnit * 2;
		jQuery.style( elem, prop, initialInUnit + unit );

		// Make sure we update the tween properties later on
		valueParts = valueParts || [];
	}

	if ( valueParts ) {
		initialInUnit = +initialInUnit || +initial || 0;

		// Apply relative offset (+=/-=) if specified
		adjusted = valueParts[ 1 ] ?
			initialInUnit + ( valueParts[ 1 ] + 1 ) * valueParts[ 2 ] :
			+valueParts[ 2 ];
		if ( tween ) {
			tween.unit = unit;
			tween.start = initialInUnit;
			tween.end = adjusted;
		}
	}
	return adjusted;
}


var defaultDisplayMap = {};

function getDefaultDisplay( elem ) {
	var temp,
		doc = elem.ownerDocument,
		nodeName = elem.nodeName,
		display = defaultDisplayMap[ nodeName ];

	if ( display ) {
		return display;
	}

	temp = doc.body.appendChild( doc.createElement( nodeName ) );
	display = jQuery.css( temp, "display" );

	temp.parentNode.removeChild( temp );

	if ( display === "none" ) {
		display = "block";
	}
	defaultDisplayMap[ nodeName ] = display;

	return display;
}

function showHide( elements, show ) {
	var display, elem,
		values = [],
		index = 0,
		length = elements.length;

	// Determine new display value for elements that need to change
	for ( ; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}

		display = elem.style.display;
		if ( show ) {

			// Since we force visibility upon cascade-hidden elements, an immediate (and slow)
			// check is required in this first loop unless we have a nonempty display value (either
			// inline or about-to-be-restored)
			if ( display === "none" ) {
				values[ index ] = dataPriv.get( elem, "display" ) || null;
				if ( !values[ index ] ) {
					elem.style.display = "";
				}
			}
			if ( elem.style.display === "" && isHiddenWithinTree( elem ) ) {
				values[ index ] = getDefaultDisplay( elem );
			}
		} else {
			if ( display !== "none" ) {
				values[ index ] = "none";

				// Remember what we're overwriting
				dataPriv.set( elem, "display", display );
			}
		}
	}

	// Set the display of the elements in a second loop to avoid constant reflow
	for ( index = 0; index < length; index++ ) {
		if ( values[ index ] != null ) {
			elements[ index ].style.display = values[ index ];
		}
	}

	return elements;
}

jQuery.fn.extend( {
	show: function() {
		return showHide( this, true );
	},
	hide: function() {
		return showHide( this );
	},
	toggle: function( state ) {
		if ( typeof state === "boolean" ) {
			return state ? this.show() : this.hide();
		}

		return this.each( function() {
			if ( isHiddenWithinTree( this ) ) {
				jQuery( this ).show();
			} else {
				jQuery( this ).hide();
			}
		} );
	}
} );
var rcheckableType = ( /^(?:checkbox|radio)$/i );

var rtagName = ( /<([a-z][^\/\0>\x20\t\r\n\f]*)/i );

var rscriptType = ( /^$|^module$|\/(?:java|ecma)script/i );



( function() {
	var fragment = document.createDocumentFragment(),
		div = fragment.appendChild( document.createElement( "div" ) ),
		input = document.createElement( "input" );

	// Support: Android 4.0 - 4.3 only
	// Check state lost if the name is set (trac-11217)
	// Support: Windows Web Apps (WWA)
	// `name` and `type` must use .setAttribute for WWA (trac-14901)
	input.setAttribute( "type", "radio" );
	input.setAttribute( "checked", "checked" );
	input.setAttribute( "name", "t" );

	div.appendChild( input );

	// Support: Android <=4.1 only
	// Older WebKit doesn't clone checked state correctly in fragments
	support.checkClone = div.cloneNode( true ).cloneNode( true ).lastChild.checked;

	// Support: IE <=11 only
	// Make sure textarea (and checkbox) defaultValue is properly cloned
	div.innerHTML = "<textarea>x</textarea>";
	support.noCloneChecked = !!div.cloneNode( true ).lastChild.defaultValue;

	// Support: IE <=9 only
	// IE <=9 replaces <option> tags with their contents when inserted outside of
	// the select element.
	div.innerHTML = "<option></option>";
	support.option = !!div.lastChild;
} )();


// We have to close these tags to support XHTML (trac-13200)
var wrapMap = {

	// XHTML parsers do not magically insert elements in the
	// same way that tag soup parsers do. So we cannot shorten
	// this by omitting <tbody> or other required elements.
	thead: [ 1, "<table>", "</table>" ],
	col: [ 2, "<table><colgroup>", "</colgroup></table>" ],
	tr: [ 2, "<table><tbody>", "</tbody></table>" ],
	td: [ 3, "<table><tbody><tr>", "</tr></tbody></table>" ],

	_default: [ 0, "", "" ]
};

wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
wrapMap.th = wrapMap.td;

// Support: IE <=9 only
if ( !support.option ) {
	wrapMap.optgroup = wrapMap.option = [ 1, "<select multiple='multiple'>", "</select>" ];
}


function getAll( context, tag ) {

	// Support: IE <=9 - 11 only
	// Use typeof to avoid zero-argument method invocation on host objects (trac-15151)
	var ret;

	if ( typeof context.getElementsByTagName !== "undefined" ) {
		ret = context.getElementsByTagName( tag || "*" );

	} else if ( typeof context.querySelectorAll !== "undefined" ) {
		ret = context.querySelectorAll( tag || "*" );

	} else {
		ret = [];
	}

	if ( tag === undefined || tag && nodeName( context, tag ) ) {
		return jQuery.merge( [ context ], ret );
	}

	return ret;
}


// Mark scripts as having already been evaluated
function setGlobalEval( elems, refElements ) {
	var i = 0,
		l = elems.length;

	for ( ; i < l; i++ ) {
		dataPriv.set(
			elems[ i ],
			"globalEval",
			!refElements || dataPriv.get( refElements[ i ], "globalEval" )
		);
	}
}


var rhtml = /<|&#?\w+;/;

function buildFragment( elems, context, scripts, selection, ignored ) {
	var elem, tmp, tag, wrap, attached, j,
		fragment = context.createDocumentFragment(),
		nodes = [],
		i = 0,
		l = elems.length;

	for ( ; i < l; i++ ) {
		elem = elems[ i ];

		if ( elem || elem === 0 ) {

			// Add nodes directly
			if ( toType( elem ) === "object" ) {

				// Support: Android <=4.0 only, PhantomJS 1 only
				// push.apply(_, arraylike) throws on ancient WebKit
				jQuery.merge( nodes, elem.nodeType ? [ elem ] : elem );

			// Convert non-html into a text node
			} else if ( !rhtml.test( elem ) ) {
				nodes.push( context.createTextNode( elem ) );

			// Convert html into DOM nodes
			} else {
				tmp = tmp || fragment.appendChild( context.createElement( "div" ) );

				// Deserialize a standard representation
				tag = ( rtagName.exec( elem ) || [ "", "" ] )[ 1 ].toLowerCase();
				wrap = wrapMap[ tag ] || wrapMap._default;
				tmp.innerHTML = wrap[ 1 ] + jQuery.htmlPrefilter( elem ) + wrap[ 2 ];

				// Descend through wrappers to the right content
				j = wrap[ 0 ];
				while ( j-- ) {
					tmp = tmp.lastChild;
				}

				// Support: Android <=4.0 only, PhantomJS 1 only
				// push.apply(_, arraylike) throws on ancient WebKit
				jQuery.merge( nodes, tmp.childNodes );

				// Remember the top-level container
				tmp = fragment.firstChild;

				// Ensure the created nodes are orphaned (trac-12392)
				tmp.textContent = "";
			}
		}
	}

	// Remove wrapper from fragment
	fragment.textContent = "";

	i = 0;
	while ( ( elem = nodes[ i++ ] ) ) {

		// Skip elements already in the context collection (trac-4087)
		if ( selection && jQuery.inArray( elem, selection ) > -1 ) {
			if ( ignored ) {
				ignored.push( elem );
			}
			continue;
		}

		attached = isAttached( elem );

		// Append to fragment
		tmp = getAll( fragment.appendChild( elem ), "script" );

		// Preserve script evaluation history
		if ( attached ) {
			setGlobalEval( tmp );
		}

		// Capture executables
		if ( scripts ) {
			j = 0;
			while ( ( elem = tmp[ j++ ] ) ) {
				if ( rscriptType.test( elem.type || "" ) ) {
					scripts.push( elem );
				}
			}
		}
	}

	return fragment;
}


var rtypenamespace = /^([^.]*)(?:\.(.+)|)/;

function returnTrue() {
	return true;
}

function returnFalse() {
	return false;
}

function on( elem, types, selector, data, fn, one ) {
	var origFn, type;

	// Types can be a map of types/handlers
	if ( typeof types === "object" ) {

		// ( types-Object, selector, data )
		if ( typeof selector !== "string" ) {

			// ( types-Object, data )
			data = data || selector;
			selector = undefined;
		}
		for ( type in types ) {
			on( elem, type, selector, data, types[ type ], one );
		}
		return elem;
	}

	if ( data == null && fn == null ) {

		// ( types, fn )
		fn = selector;
		data = selector = undefined;
	} else if ( fn == null ) {
		if ( typeof selector === "string" ) {

			// ( types, selector, fn )
			fn = data;
			data = undefined;
		} else {

			// ( types, data, fn )
			fn = data;
			data = selector;
			selector = undefined;
		}
	}
	if ( fn === false ) {
		fn = returnFalse;
	} else if ( !fn ) {
		return elem;
	}

	if ( one === 1 ) {
		origFn = fn;
		fn = function( event ) {

			// Can use an empty set, since event contains the info
			jQuery().off( event );
			return origFn.apply( this, arguments );
		};

		// Use same guid so caller can remove using origFn
		fn.guid = origFn.guid || ( origFn.guid = jQuery.guid++ );
	}
	return elem.each( function() {
		jQuery.event.add( this, types, fn, data, selector );
	} );
}

/*
 * Helper functions for managing events -- not part of the public interface.
 * Props to Dean Edwards' addEvent library for many of the ideas.
 */
jQuery.event = {

	global: {},

	add: function( elem, types, handler, data, selector ) {

		var handleObjIn, eventHandle, tmp,
			events, t, handleObj,
			special, handlers, type, namespaces, origType,
			elemData = dataPriv.get( elem );

		// Only attach events to objects that accept data
		if ( !acceptData( elem ) ) {
			return;
		}

		// Caller can pass in an object of custom data in lieu of the handler
		if ( handler.handler ) {
			handleObjIn = handler;
			handler = handleObjIn.handler;
			selector = handleObjIn.selector;
		}

		// Ensure that invalid selectors throw exceptions at attach time
		// Evaluate against documentElement in case elem is a non-element node (e.g., document)
		if ( selector ) {
			jQuery.find.matchesSelector( documentElement, selector );
		}

		// Make sure that the handler has a unique ID, used to find/remove it later
		if ( !handler.guid ) {
			handler.guid = jQuery.guid++;
		}

		// Init the element's event structure and main handler, if this is the first
		if ( !( events = elemData.events ) ) {
			events = elemData.events = Object.create( null );
		}
		if ( !( eventHandle = elemData.handle ) ) {
			eventHandle = elemData.handle = function( e ) {

				// Discard the second event of a jQuery.event.trigger() and
				// when an event is called after a page has unloaded
				return typeof jQuery !== "undefined" && jQuery.event.triggered !== e.type ?
					jQuery.event.dispatch.apply( elem, arguments ) : undefined;
			};
		}

		// Handle multiple events separated by a space
		types = ( types || "" ).match( rnothtmlwhite ) || [ "" ];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[ t ] ) || [];
			type = origType = tmp[ 1 ];
			namespaces = ( tmp[ 2 ] || "" ).split( "." ).sort();

			// There *must* be a type, no attaching namespace-only handlers
			if ( !type ) {
				continue;
			}

			// If event changes its type, use the special event handlers for the changed type
			special = jQuery.event.special[ type ] || {};

			// If selector defined, determine special event api type, otherwise given type
			type = ( selector ? special.delegateType : special.bindType ) || type;

			// Update special based on newly reset type
			special = jQuery.event.special[ type ] || {};

			// handleObj is passed to all event handlers
			handleObj = jQuery.extend( {
				type: type,
				origType: origType,
				data: data,
				handler: handler,
				guid: handler.guid,
				selector: selector,
				needsContext: selector && jQuery.expr.match.needsContext.test( selector ),
				namespace: namespaces.join( "." )
			}, handleObjIn );

			// Init the event handler queue if we're the first
			if ( !( handlers = events[ type ] ) ) {
				handlers = events[ type ] = [];
				handlers.delegateCount = 0;

				// Only use addEventListener if the special events handler returns false
				if ( !special.setup ||
					special.setup.call( elem, data, namespaces, eventHandle ) === false ) {

					if ( elem.addEventListener ) {
						elem.addEventListener( type, eventHandle );
					}
				}
			}

			if ( special.add ) {
				special.add.call( elem, handleObj );

				if ( !handleObj.handler.guid ) {
					handleObj.handler.guid = handler.guid;
				}
			}

			// Add to the element's handler list, delegates in front
			if ( selector ) {
				handlers.splice( handlers.delegateCount++, 0, handleObj );
			} else {
				handlers.push( handleObj );
			}

			// Keep track of which events have ever been used, for event optimization
			jQuery.event.global[ type ] = true;
		}

	},

	// Detach an event or set of events from an element
	remove: function( elem, types, handler, selector, mappedTypes ) {

		var j, origCount, tmp,
			events, t, handleObj,
			special, handlers, type, namespaces, origType,
			elemData = dataPriv.hasData( elem ) && dataPriv.get( elem );

		if ( !elemData || !( events = elemData.events ) ) {
			return;
		}

		// Once for each type.namespace in types; type may be omitted
		types = ( types || "" ).match( rnothtmlwhite ) || [ "" ];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[ t ] ) || [];
			type = origType = tmp[ 1 ];
			namespaces = ( tmp[ 2 ] || "" ).split( "." ).sort();

			// Unbind all events (on this namespace, if provided) for the element
			if ( !type ) {
				for ( type in events ) {
					jQuery.event.remove( elem, type + types[ t ], handler, selector, true );
				}
				continue;
			}

			special = jQuery.event.special[ type ] || {};
			type = ( selector ? special.delegateType : special.bindType ) || type;
			handlers = events[ type ] || [];
			tmp = tmp[ 2 ] &&
				new RegExp( "(^|\\.)" + namespaces.join( "\\.(?:.*\\.|)" ) + "(\\.|$)" );

			// Remove matching events
			origCount = j = handlers.length;
			while ( j-- ) {
				handleObj = handlers[ j ];

				if ( ( mappedTypes || origType === handleObj.origType ) &&
					( !handler || handler.guid === handleObj.guid ) &&
					( !tmp || tmp.test( handleObj.namespace ) ) &&
					( !selector || selector === handleObj.selector ||
						selector === "**" && handleObj.selector ) ) {
					handlers.splice( j, 1 );

					if ( handleObj.selector ) {
						handlers.delegateCount--;
					}
					if ( special.remove ) {
						special.remove.call( elem, handleObj );
					}
				}
			}

			// Remove generic event handler if we removed something and no more handlers exist
			// (avoids potential for endless recursion during removal of special event handlers)
			if ( origCount && !handlers.length ) {
				if ( !special.teardown ||
					special.teardown.call( elem, namespaces, elemData.handle ) === false ) {

					jQuery.removeEvent( elem, type, elemData.handle );
				}

				delete events[ type ];
			}
		}

		// Remove data and the expando if it's no longer used
		if ( jQuery.isEmptyObject( events ) ) {
			dataPriv.remove( elem, "handle events" );
		}
	},

	dispatch: function( nativeEvent ) {

		var i, j, ret, matched, handleObj, handlerQueue,
			args = new Array( arguments.length ),

			// Make a writable jQuery.Event from the native event object
			event = jQuery.event.fix( nativeEvent ),

			handlers = (
				dataPriv.get( this, "events" ) || Object.create( null )
			)[ event.type ] || [],
			special = jQuery.event.special[ event.type ] || {};

		// Use the fix-ed jQuery.Event rather than the (read-only) native event
		args[ 0 ] = event;

		for ( i = 1; i < arguments.length; i++ ) {
			args[ i ] = arguments[ i ];
		}

		event.delegateTarget = this;

		// Call the preDispatch hook for the mapped type, and let it bail if desired
		if ( special.preDispatch && special.preDispatch.call( this, event ) === false ) {
			return;
		}

		// Determine handlers
		handlerQueue = jQuery.event.handlers.call( this, event, handlers );

		// Run delegates first; they may want to stop propagation beneath us
		i = 0;
		while ( ( matched = handlerQueue[ i++ ] ) && !event.isPropagationStopped() ) {
			event.currentTarget = matched.elem;

			j = 0;
			while ( ( handleObj = matched.handlers[ j++ ] ) &&
				!event.isImmediatePropagationStopped() ) {

				// If the event is namespaced, then each handler is only invoked if it is
				// specially universal or its namespaces are a superset of the event's.
				if ( !event.rnamespace || handleObj.namespace === false ||
					event.rnamespace.test( handleObj.namespace ) ) {

					event.handleObj = handleObj;
					event.data = handleObj.data;

					ret = ( ( jQuery.event.special[ handleObj.origType ] || {} ).handle ||
						handleObj.handler ).apply( matched.elem, args );

					if ( ret !== undefined ) {
						if ( ( event.result = ret ) === false ) {
							event.preventDefault();
							event.stopPropagation();
						}
					}
				}
			}
		}

		// Call the postDispatch hook for the mapped type
		if ( special.postDispatch ) {
			special.postDispatch.call( this, event );
		}

		return event.result;
	},

	handlers: function( event, handlers ) {
		var i, handleObj, sel, matchedHandlers, matchedSelectors,
			handlerQueue = [],
			delegateCount = handlers.delegateCount,
			cur = event.target;

		// Find delegate handlers
		if ( delegateCount &&

			// Support: IE <=9
			// Black-hole SVG <use> instance trees (trac-13180)
			cur.nodeType &&

			// Support: Firefox <=42
			// Suppress spec-violating clicks indicating a non-primary pointer button (trac-3861)
			// https://www.w3.org/TR/DOM-Level-3-Events/#event-type-click
			// Support: IE 11 only
			// ...but not arrow key "clicks" of radio inputs, which can have `button` -1 (gh-2343)
			!( event.type === "click" && event.button >= 1 ) ) {

			for ( ; cur !== this; cur = cur.parentNode || this ) {

				// Don't check non-elements (trac-13208)
				// Don't process clicks on disabled elements (trac-6911, trac-8165, trac-11382, trac-11764)
				if ( cur.nodeType === 1 && !( event.type === "click" && cur.disabled === true ) ) {
					matchedHandlers = [];
					matchedSelectors = {};
					for ( i = 0; i < delegateCount; i++ ) {
						handleObj = handlers[ i ];

						// Don't conflict with Object.prototype properties (trac-13203)
						sel = handleObj.selector + " ";

						if ( matchedSelectors[ sel ] === undefined ) {
							matchedSelectors[ sel ] = handleObj.needsContext ?
								jQuery( sel, this ).index( cur ) > -1 :
								jQuery.find( sel, this, null, [ cur ] ).length;
						}
						if ( matchedSelectors[ sel ] ) {
							matchedHandlers.push( handleObj );
						}
					}
					if ( matchedHandlers.length ) {
						handlerQueue.push( { elem: cur, handlers: matchedHandlers } );
					}
				}
			}
		}

		// Add the remaining (directly-bound) handlers
		cur = this;
		if ( delegateCount < handlers.length ) {
			handlerQueue.push( { elem: cur, handlers: handlers.slice( delegateCount ) } );
		}

		return handlerQueue;
	},

	addProp: function( name, hook ) {
		Object.defineProperty( jQuery.Event.prototype, name, {
			enumerable: true,
			configurable: true,

			get: isFunction( hook ) ?
				function() {
					if ( this.originalEvent ) {
						return hook( this.originalEvent );
					}
				} :
				function() {
					if ( this.originalEvent ) {
						return this.originalEvent[ name ];
					}
				},

			set: function( value ) {
				Object.defineProperty( this, name, {
					enumerable: true,
					configurable: true,
					writable: true,
					value: value
				} );
			}
		} );
	},

	fix: function( originalEvent ) {
		return originalEvent[ jQuery.expando ] ?
			originalEvent :
			new jQuery.Event( originalEvent );
	},

	special: {
		load: {

			// Prevent triggered image.load events from bubbling to window.load
			noBubble: true
		},
		click: {

			// Utilize native event to ensure correct state for checkable inputs
			setup: function( data ) {

				// For mutual compressibility with _default, replace `this` access with a local var.
				// `|| data` is dead code meant only to preserve the variable through minification.
				var el = this || data;

				// Claim the first handler
				if ( rcheckableType.test( el.type ) &&
					el.click && nodeName( el, "input" ) ) {

					// dataPriv.set( el, "click", ... )
					leverageNative( el, "click", true );
				}

				// Return false to allow normal processing in the caller
				return false;
			},
			trigger: function( data ) {

				// For mutual compressibility with _default, replace `this` access with a local var.
				// `|| data` is dead code meant only to preserve the variable through minification.
				var el = this || data;

				// Force setup before triggering a click
				if ( rcheckableType.test( el.type ) &&
					el.click && nodeName( el, "input" ) ) {

					leverageNative( el, "click" );
				}

				// Return non-false to allow normal event-path propagation
				return true;
			},

			// For cross-browser consistency, suppress native .click() on links
			// Also prevent it if we're currently inside a leveraged native-event stack
			_default: function( event ) {
				var target = event.target;
				return rcheckableType.test( target.type ) &&
					target.click && nodeName( target, "input" ) &&
					dataPriv.get( target, "click" ) ||
					nodeName( target, "a" );
			}
		},

		beforeunload: {
			postDispatch: function( event ) {

				// Support: Firefox 20+
				// Firefox doesn't alert if the returnValue field is not set.
				if ( event.result !== undefined && event.originalEvent ) {
					event.originalEvent.returnValue = event.result;
				}
			}
		}
	}
};

// Ensure the presence of an event listener that handles manually-triggered
// synthetic events by interrupting progress until reinvoked in response to
// *native* events that it fires directly, ensuring that state changes have
// already occurred before other listeners are invoked.
function leverageNative( el, type, isSetup ) {

	// Missing `isSetup` indicates a trigger call, which must force setup through jQuery.event.add
	if ( !isSetup ) {
		if ( dataPriv.get( el, type ) === undefined ) {
			jQuery.event.add( el, type, returnTrue );
		}
		return;
	}

	// Register the controller as a special universal handler for all event namespaces
	dataPriv.set( el, type, false );
	jQuery.event.add( el, type, {
		namespace: false,
		handler: function( event ) {
			var result,
				saved = dataPriv.get( this, type );

			if ( ( event.isTrigger & 1 ) && this[ type ] ) {

				// Interrupt processing of the outer synthetic .trigger()ed event
				if ( !saved ) {

					// Store arguments for use when handling the inner native event
					// There will always be at least one argument (an event object), so this array
					// will not be confused with a leftover capture object.
					saved = slice.call( arguments );
					dataPriv.set( this, type, saved );

					// Trigger the native event and capture its result
					this[ type ]();
					result = dataPriv.get( this, type );
					dataPriv.set( this, type, false );

					if ( saved !== result ) {

						// Cancel the outer synthetic event
						event.stopImmediatePropagation();
						event.preventDefault();

						return result;
					}

				// If this is an inner synthetic event for an event with a bubbling surrogate
				// (focus or blur), assume that the surrogate already propagated from triggering
				// the native event and prevent that from happening again here.
				// This technically gets the ordering wrong w.r.t. to `.trigger()` (in which the
				// bubbling surrogate propagates *after* the non-bubbling base), but that seems
				// less bad than duplication.
				} else if ( ( jQuery.event.special[ type ] || {} ).delegateType ) {
					event.stopPropagation();
				}

			// If this is a native event triggered above, everything is now in order
			// Fire an inner synthetic event with the original arguments
			} else if ( saved ) {

				// ...and capture the result
				dataPriv.set( this, type, jQuery.event.trigger(
					saved[ 0 ],
					saved.slice( 1 ),
					this
				) );

				// Abort handling of the native event by all jQuery handlers while allowing
				// native handlers on the same element to run. On target, this is achieved
				// by stopping immediate propagation just on the jQuery event. However,
				// the native event is re-wrapped by a jQuery one on each level of the
				// propagation so the only way to stop it for jQuery is to stop it for
				// everyone via native `stopPropagation()`. This is not a problem for
				// focus/blur which don't bubble, but it does also stop click on checkboxes
				// and radios. We accept this limitation.
				event.stopPropagation();
				event.isImmediatePropagationStopped = returnTrue;
			}
		}
	} );
}

jQuery.removeEvent = function( elem, type, handle ) {

	// This "if" is needed for plain objects
	if ( elem.removeEventListener ) {
		elem.removeEventListener( type, handle );
	}
};

jQuery.Event = function( src, props ) {

	// Allow instantiation without the 'new' keyword
	if ( !( this instanceof jQuery.Event ) ) {
		return new jQuery.Event( src, props );
	}

	// Event object
	if ( src && src.type ) {
		this.originalEvent = src;
		this.type = src.type;

		// Events bubbling up the document may have been marked as prevented
		// by a handler lower down the tree; reflect the correct value.
		this.isDefaultPrevented = src.defaultPrevented ||
				src.defaultPrevented === undefined &&

				// Support: Android <=2.3 only
				src.returnValue === false ?
			returnTrue :
			returnFalse;

		// Create target properties
		// Support: Safari <=6 - 7 only
		// Target should not be a text node (trac-504, trac-13143)
		this.target = ( src.target && src.target.nodeType === 3 ) ?
			src.target.parentNode :
			src.target;

		this.currentTarget = src.currentTarget;
		this.relatedTarget = src.relatedTarget;

	// Event type
	} else {
		this.type = src;
	}

	// Put explicitly provided properties onto the event object
	if ( props ) {
		jQuery.extend( this, props );
	}

	// Create a timestamp if incoming event doesn't have one
	this.timeStamp = src && src.timeStamp || Date.now();

	// Mark it as fixed
	this[ jQuery.expando ] = true;
};

// jQuery.Event is based on DOM3 Events as specified by the ECMAScript Language Binding
// https://www.w3.org/TR/2003/WD-DOM-Level-3-Events-20030331/ecma-script-binding.html
jQuery.Event.prototype = {
	constructor: jQuery.Event,
	isDefaultPrevented: returnFalse,
	isPropagationStopped: returnFalse,
	isImmediatePropagationStopped: returnFalse,
	isSimulated: false,

	preventDefault: function() {
		var e = this.originalEvent;

		this.isDefaultPrevented = returnTrue;

		if ( e && !this.isSimulated ) {
			e.preventDefault();
		}
	},
	stopPropagation: function() {
		var e = this.originalEvent;

		this.isPropagationStopped = returnTrue;

		if ( e && !this.isSimulated ) {
			e.stopPropagation();
		}
	},
	stopImmediatePropagation: function() {
		var e = this.originalEvent;

		this.isImmediatePropagationStopped = returnTrue;

		if ( e && !this.isSimulated ) {
			e.stopImmediatePropagation();
		}

		this.stopPropagation();
	}
};

// Includes all common event props including KeyEvent and MouseEvent specific props
jQuery.each( {
	altKey: true,
	bubbles: true,
	cancelable: true,
	changedTouches: true,
	ctrlKey: true,
	detail: true,
	eventPhase: true,
	metaKey: true,
	pageX: true,
	pageY: true,
	shiftKey: true,
	view: true,
	"char": true,
	code: true,
	charCode: true,
	key: true,
	keyCode: true,
	button: true,
	buttons: true,
	clientX: true,
	clientY: true,
	offsetX: true,
	offsetY: true,
	pointerId: true,
	pointerType: true,
	screenX: true,
	screenY: true,
	targetTouches: true,
	toElement: true,
	touches: true,
	which: true
}, jQuery.event.addProp );

jQuery.each( { focus: "focusin", blur: "focusout" }, function( type, delegateType ) {

	function focusMappedHandler( nativeEvent ) {
		if ( document.documentMode ) {

			// Support: IE 11+
			// Attach a single focusin/focusout handler on the document while someone wants
			// focus/blur. This is because the former are synchronous in IE while the latter
			// are async. In other browsers, all those handlers are invoked synchronously.

			// `handle` from private data would already wrap the event, but we need
			// to change the `type` here.
			var handle = dataPriv.get( this, "handle" ),
				event = jQuery.event.fix( nativeEvent );
			event.type = nativeEvent.type === "focusin" ? "focus" : "blur";
			event.isSimulated = true;

			// First, handle focusin/focusout
			handle( nativeEvent );

			// ...then, handle focus/blur
			//
			// focus/blur don't bubble while focusin/focusout do; simulate the former by only
			// invoking the handler at the lower level.
			if ( event.target === event.currentTarget ) {

				// The setup part calls `leverageNative`, which, in turn, calls
				// `jQuery.event.add`, so event handle will already have been set
				// by this point.
				handle( event );
			}
		} else {

			// For non-IE browsers, attach a single capturing handler on the document
			// while someone wants focusin/focusout.
			jQuery.event.simulate( delegateType, nativeEvent.target,
				jQuery.event.fix( nativeEvent ) );
		}
	}

	jQuery.event.special[ type ] = {

		// Utilize native event if possible so blur/focus sequence is correct
		setup: function() {

			var attaches;

			// Claim the first handler
			// dataPriv.set( this, "focus", ... )
			// dataPriv.set( this, "blur", ... )
			leverageNative( this, type, true );

			if ( document.documentMode ) {

				// Support: IE 9 - 11+
				// We use the same native handler for focusin & focus (and focusout & blur)
				// so we need to coordinate setup & teardown parts between those events.
				// Use `delegateType` as the key as `type` is already used by `leverageNative`.
				attaches = dataPriv.get( this, delegateType );
				if ( !attaches ) {
					this.addEventListener( delegateType, focusMappedHandler );
				}
				dataPriv.set( this, delegateType, ( attaches || 0 ) + 1 );
			} else {

				// Return false to allow normal processing in the caller
				return false;
			}
		},
		trigger: function() {

			// Force setup before trigger
			leverageNative( this, type );

			// Return non-false to allow normal event-path propagation
			return true;
		},

		teardown: function() {
			var attaches;

			if ( document.documentMode ) {
				attaches = dataPriv.get( this, delegateType ) - 1;
				if ( !attaches ) {
					this.removeEventListener( delegateType, focusMappedHandler );
					dataPriv.remove( this, delegateType );
				} else {
					dataPriv.set( this, delegateType, attaches );
				}
			} else {

				// Return false to indicate standard teardown should be applied
				return false;
			}
		},

		// Suppress native focus or blur if we're currently inside
		// a leveraged native-event stack
		_default: function( event ) {
			return dataPriv.get( event.target, type );
		},

		delegateType: delegateType
	};

	// Support: Firefox <=44
	// Firefox doesn't have focus(in | out) events
	// Related ticket - https://bugzilla.mozilla.org/show_bug.cgi?id=687787
	//
	// Support: Chrome <=48 - 49, Safari <=9.0 - 9.1
	// focus(in | out) events fire after focus & blur events,
	// which is spec violation - http://www.w3.org/TR/DOM-Level-3-Events/#events-focusevent-event-order
	// Related ticket - https://bugs.chromium.org/p/chromium/issues/detail?id=449857
	//
	// Support: IE 9 - 11+
	// To preserve relative focusin/focus & focusout/blur event order guaranteed on the 3.x branch,
	// attach a single handler for both events in IE.
	jQuery.event.special[ delegateType ] = {
		setup: function() {

			// Handle: regular nodes (via `this.ownerDocument`), window
			// (via `this.document`) & document (via `this`).
			var doc = this.ownerDocument || this.document || this,
				dataHolder = document.documentMode ? this : doc,
				attaches = dataPriv.get( dataHolder, delegateType );

			// Support: IE 9 - 11+
			// We use the same native handler for focusin & focus (and focusout & blur)
			// so we need to coordinate setup & teardown parts between those events.
			// Use `delegateType` as the key as `type` is already used by `leverageNative`.
			if ( !attaches ) {
				if ( document.documentMode ) {
					this.addEventListener( delegateType, focusMappedHandler );
				} else {
					doc.addEventListener( type, focusMappedHandler, true );
				}
			}
			dataPriv.set( dataHolder, delegateType, ( attaches || 0 ) + 1 );
		},
		teardown: function() {
			var doc = this.ownerDocument || this.document || this,
				dataHolder = document.documentMode ? this : doc,
				attaches = dataPriv.get( dataHolder, delegateType ) - 1;

			if ( !attaches ) {
				if ( document.documentMode ) {
					this.removeEventListener( delegateType, focusMappedHandler );
				} else {
					doc.removeEventListener( type, focusMappedHandler, true );
				}
				dataPriv.remove( dataHolder, delegateType );
			} else {
				dataPriv.set( dataHolder, delegateType, attaches );
			}
		}
	};
} );

// Create mouseenter/leave events using mouseover/out and event-time checks
// so that event delegation works in jQuery.
// Do the same for pointerenter/pointerleave and pointerover/pointerout
//
// Support: Safari 7 only
// Safari sends mouseenter too often; see:
// https://bugs.chromium.org/p/chromium/issues/detail?id=470258
// for the description of the bug (it existed in older Chrome versions as well).
jQuery.each( {
	mouseenter: "mouseover",
	mouseleave: "mouseout",
	pointerenter: "pointerover",
	pointerleave: "pointerout"
}, function( orig, fix ) {
	jQuery.event.special[ orig ] = {
		delegateType: fix,
		bindType: fix,

		handle: function( event ) {
			var ret,
				target = this,
				related = event.relatedTarget,
				handleObj = event.handleObj;

			// For mouseenter/leave call the handler if related is outside the target.
			// NB: No relatedTarget if the mouse left/entered the browser window
			if ( !related || ( related !== target && !jQuery.contains( target, related ) ) ) {
				event.type = handleObj.origType;
				ret = handleObj.handler.apply( this, arguments );
				event.type = fix;
			}
			return ret;
		}
	};
} );

jQuery.fn.extend( {

	on: function( types, selector, data, fn ) {
		return on( this, types, selector, data, fn );
	},
	one: function( types, selector, data, fn ) {
		return on( this, types, selector, data, fn, 1 );
	},
	off: function( types, selector, fn ) {
		var handleObj, type;
		if ( types && types.preventDefault && types.handleObj ) {

			// ( event )  dispatched jQuery.Event
			handleObj = types.handleObj;
			jQuery( types.delegateTarget ).off(
				handleObj.namespace ?
					handleObj.origType + "." + handleObj.namespace :
					handleObj.origType,
				handleObj.selector,
				handleObj.handler
			);
			return this;
		}
		if ( typeof types === "object" ) {

			// ( types-object [, selector] )
			for ( type in types ) {
				this.off( type, selector, types[ type ] );
			}
			return this;
		}
		if ( selector === false || typeof selector === "function" ) {

			// ( types [, fn] )
			fn = selector;
			selector = undefined;
		}
		if ( fn === false ) {
			fn = returnFalse;
		}
		return this.each( function() {
			jQuery.event.remove( this, types, fn, selector );
		} );
	}
} );


var

	// Support: IE <=10 - 11, Edge 12 - 13 only
	// In IE/Edge using regex groups here causes severe slowdowns.
	// See https://connect.microsoft.com/IE/feedback/details/1736512/
	rnoInnerhtml = /<script|<style|<link/i,

	// checked="checked" or checked
	rchecked = /checked\s*(?:[^=]|=\s*.checked.)/i,

	rcleanScript = /^\s*<!\[CDATA\[|\]\]>\s*$/g;

// Prefer a tbody over its parent table for containing new rows
function manipulationTarget( elem, content ) {
	if ( nodeName( elem, "table" ) &&
		nodeName( content.nodeType !== 11 ? content : content.firstChild, "tr" ) ) {

		return jQuery( elem ).children( "tbody" )[ 0 ] || elem;
	}

	return elem;
}

// Replace/restore the type attribute of script elements for safe DOM manipulation
function disableScript( elem ) {
	elem.type = ( elem.getAttribute( "type" ) !== null ) + "/" + elem.type;
	return elem;
}
function restoreScript( elem ) {
	if ( ( elem.type || "" ).slice( 0, 5 ) === "true/" ) {
		elem.type = elem.type.slice( 5 );
	} else {
		elem.removeAttribute( "type" );
	}

	return elem;
}

function cloneCopyEvent( src, dest ) {
	var i, l, type, pdataOld, udataOld, udataCur, events;

	if ( dest.nodeType !== 1 ) {
		return;
	}

	// 1. Copy private data: events, handlers, etc.
	if ( dataPriv.hasData( src ) ) {
		pdataOld = dataPriv.get( src );
		events = pdataOld.events;

		if ( events ) {
			dataPriv.remove( dest, "handle events" );

			for ( type in events ) {
				for ( i = 0, l = events[ type ].length; i < l; i++ ) {
					jQuery.event.add( dest, type, events[ type ][ i ] );
				}
			}
		}
	}

	// 2. Copy user data
	if ( dataUser.hasData( src ) ) {
		udataOld = dataUser.access( src );
		udataCur = jQuery.extend( {}, udataOld );

		dataUser.set( dest, udataCur );
	}
}

// Fix IE bugs, see support tests
function fixInput( src, dest ) {
	var nodeName = dest.nodeName.toLowerCase();

	// Fails to persist the checked state of a cloned checkbox or radio button.
	if ( nodeName === "input" && rcheckableType.test( src.type ) ) {
		dest.checked = src.checked;

	// Fails to return the selected option to the default selected state when cloning options
	} else if ( nodeName === "input" || nodeName === "textarea" ) {
		dest.defaultValue = src.defaultValue;
	}
}

function domManip( collection, args, callback, ignored ) {

	// Flatten any nested arrays
	args = flat( args );

	var fragment, first, scripts, hasScripts, node, doc,
		i = 0,
		l = collection.length,
		iNoClone = l - 1,
		value = args[ 0 ],
		valueIsFunction = isFunction( value );

	// We can't cloneNode fragments that contain checked, in WebKit
	if ( valueIsFunction ||
			( l > 1 && typeof value === "string" &&
				!support.checkClone && rchecked.test( value ) ) ) {
		return collection.each( function( index ) {
			var self = collection.eq( index );
			if ( valueIsFunction ) {
				args[ 0 ] = value.call( this, index, self.html() );
			}
			domManip( self, args, callback, ignored );
		} );
	}

	if ( l ) {
		fragment = buildFragment( args, collection[ 0 ].ownerDocument, false, collection, ignored );
		first = fragment.firstChild;

		if ( fragment.childNodes.length === 1 ) {
			fragment = first;
		}

		// Require either new content or an interest in ignored elements to invoke the callback
		if ( first || ignored ) {
			scripts = jQuery.map( getAll( fragment, "script" ), disableScript );
			hasScripts = scripts.length;

			// Use the original fragment for the last item
			// instead of the first because it can end up
			// being emptied incorrectly in certain situations (trac-8070).
			for ( ; i < l; i++ ) {
				node = fragment;

				if ( i !== iNoClone ) {
					node = jQuery.clone( node, true, true );

					// Keep references to cloned scripts for later restoration
					if ( hasScripts ) {

						// Support: Android <=4.0 only, PhantomJS 1 only
						// push.apply(_, arraylike) throws on ancient WebKit
						jQuery.merge( scripts, getAll( node, "script" ) );
					}
				}

				callback.call( collection[ i ], node, i );
			}

			if ( hasScripts ) {
				doc = scripts[ scripts.length - 1 ].ownerDocument;

				// Re-enable scripts
				jQuery.map( scripts, restoreScript );

				// Evaluate executable scripts on first document insertion
				for ( i = 0; i < hasScripts; i++ ) {
					node = scripts[ i ];
					if ( rscriptType.test( node.type || "" ) &&
						!dataPriv.access( node, "globalEval" ) &&
						jQuery.contains( doc, node ) ) {

						if ( node.src && ( node.type || "" ).toLowerCase()  !== "module" ) {

							// Optional AJAX dependency, but won't run scripts if not present
							if ( jQuery._evalUrl && !node.noModule ) {
								jQuery._evalUrl( node.src, {
									nonce: node.nonce || node.getAttribute( "nonce" )
								}, doc );
							}
						} else {

							// Unwrap a CDATA section containing script contents. This shouldn't be
							// needed as in XML documents they're already not visible when
							// inspecting element contents and in HTML documents they have no
							// meaning but we're preserving that logic for backwards compatibility.
							// This will be removed completely in 4.0. See gh-4904.
							DOMEval( node.textContent.replace( rcleanScript, "" ), node, doc );
						}
					}
				}
			}
		}
	}

	return collection;
}

function remove( elem, selector, keepData ) {
	var node,
		nodes = selector ? jQuery.filter( selector, elem ) : elem,
		i = 0;

	for ( ; ( node = nodes[ i ] ) != null; i++ ) {
		if ( !keepData && node.nodeType === 1 ) {
			jQuery.cleanData( getAll( node ) );
		}

		if ( node.parentNode ) {
			if ( keepData && isAttached( node ) ) {
				setGlobalEval( getAll( node, "script" ) );
			}
			node.parentNode.removeChild( node );
		}
	}

	return elem;
}

jQuery.extend( {
	htmlPrefilter: function( html ) {
		return html;
	},

	clone: function( elem, dataAndEvents, deepDataAndEvents ) {
		var i, l, srcElements, destElements,
			clone = elem.cloneNode( true ),
			inPage = isAttached( elem );

		// Fix IE cloning issues
		if ( !support.noCloneChecked && ( elem.nodeType === 1 || elem.nodeType === 11 ) &&
				!jQuery.isXMLDoc( elem ) ) {

			// We eschew jQuery#find here for performance reasons:
			// https://jsperf.com/getall-vs-sizzle/2
			destElements = getAll( clone );
			srcElements = getAll( elem );

			for ( i = 0, l = srcElements.length; i < l; i++ ) {
				fixInput( srcElements[ i ], destElements[ i ] );
			}
		}

		// Copy the events from the original to the clone
		if ( dataAndEvents ) {
			if ( deepDataAndEvents ) {
				srcElements = srcElements || getAll( elem );
				destElements = destElements || getAll( clone );

				for ( i = 0, l = srcElements.length; i < l; i++ ) {
					cloneCopyEvent( srcElements[ i ], destElements[ i ] );
				}
			} else {
				cloneCopyEvent( elem, clone );
			}
		}

		// Preserve script evaluation history
		destElements = getAll( clone, "script" );
		if ( destElements.length > 0 ) {
			setGlobalEval( destElements, !inPage && getAll( elem, "script" ) );
		}

		// Return the cloned set
		return clone;
	},

	cleanData: function( elems ) {
		var data, elem, type,
			special = jQuery.event.special,
			i = 0;

		for ( ; ( elem = elems[ i ] ) !== undefined; i++ ) {
			if ( acceptData( elem ) ) {
				if ( ( data = elem[ dataPriv.expando ] ) ) {
					if ( data.events ) {
						for ( type in data.events ) {
							if ( special[ type ] ) {
								jQuery.event.remove( elem, type );

							// This is a shortcut to avoid jQuery.event.remove's overhead
							} else {
								jQuery.removeEvent( elem, type, data.handle );
							}
						}
					}

					// Support: Chrome <=35 - 45+
					// Assign undefined instead of using delete, see Data#remove
					elem[ dataPriv.expando ] = undefined;
				}
				if ( elem[ dataUser.expando ] ) {

					// Support: Chrome <=35 - 45+
					// Assign undefined instead of using delete, see Data#remove
					elem[ dataUser.expando ] = undefined;
				}
			}
		}
	}
} );

jQuery.fn.extend( {
	detach: function( selector ) {
		return remove( this, selector, true );
	},

	remove: function( selector ) {
		return remove( this, selector );
	},

	text: function( value ) {
		return access( this, function( value ) {
			return value === undefined ?
				jQuery.text( this ) :
				this.empty().each( function() {
					if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
						this.textContent = value;
					}
				} );
		}, null, value, arguments.length );
	},

	append: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.appendChild( elem );
			}
		} );
	},

	prepend: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.insertBefore( elem, target.firstChild );
			}
		} );
	},

	before: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this );
			}
		} );
	},

	after: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this.nextSibling );
			}
		} );
	},

	empty: function() {
		var elem,
			i = 0;

		for ( ; ( elem = this[ i ] ) != null; i++ ) {
			if ( elem.nodeType === 1 ) {

				// Prevent memory leaks
				jQuery.cleanData( getAll( elem, false ) );

				// Remove any remaining nodes
				elem.textContent = "";
			}
		}

		return this;
	},

	clone: function( dataAndEvents, deepDataAndEvents ) {
		dataAndEvents = dataAndEvents == null ? false : dataAndEvents;
		deepDataAndEvents = deepDataAndEvents == null ? dataAndEvents : deepDataAndEvents;

		return this.map( function() {
			return jQuery.clone( this, dataAndEvents, deepDataAndEvents );
		} );
	},

	html: function( value ) {
		return access( this, function( value ) {
			var elem = this[ 0 ] || {},
				i = 0,
				l = this.length;

			if ( value === undefined && elem.nodeType === 1 ) {
				return elem.innerHTML;
			}

			// See if we can take a shortcut and just use innerHTML
			if ( typeof value === "string" && !rnoInnerhtml.test( value ) &&
				!wrapMap[ ( rtagName.exec( value ) || [ "", "" ] )[ 1 ].toLowerCase() ] ) {

				value = jQuery.htmlPrefilter( value );

				try {
					for ( ; i < l; i++ ) {
						elem = this[ i ] || {};

						// Remove element nodes and prevent memory leaks
						if ( elem.nodeType === 1 ) {
							jQuery.cleanData( getAll( elem, false ) );
							elem.innerHTML = value;
						}
					}

					elem = 0;

				// If using innerHTML throws an exception, use the fallback method
				} catch ( e ) {}
			}

			if ( elem ) {
				this.empty().append( value );
			}
		}, null, value, arguments.length );
	},

	replaceWith: function() {
		var ignored = [];

		// Make the changes, replacing each non-ignored context element with the new content
		return domManip( this, arguments, function( elem ) {
			var parent = this.parentNode;

			if ( jQuery.inArray( this, ignored ) < 0 ) {
				jQuery.cleanData( getAll( this ) );
				if ( parent ) {
					parent.replaceChild( elem, this );
				}
			}

		// Force callback invocation
		}, ignored );
	}
} );

jQuery.each( {
	appendTo: "append",
	prependTo: "prepend",
	insertBefore: "before",
	insertAfter: "after",
	replaceAll: "replaceWith"
}, function( name, original ) {
	jQuery.fn[ name ] = function( selector ) {
		var elems,
			ret = [],
			insert = jQuery( selector ),
			last = insert.length - 1,
			i = 0;

		for ( ; i <= last; i++ ) {
			elems = i === last ? this : this.clone( true );
			jQuery( insert[ i ] )[ original ]( elems );

			// Support: Android <=4.0 only, PhantomJS 1 only
			// .get() because push.apply(_, arraylike) throws on ancient WebKit
			push.apply( ret, elems.get() );
		}

		return this.pushStack( ret );
	};
} );
var rnumnonpx = new RegExp( "^(" + pnum + ")(?!px)[a-z%]+$", "i" );

var rcustomProp = /^--/;


var getStyles = function( elem ) {

		// Support: IE <=11 only, Firefox <=30 (trac-15098, trac-14150)
		// IE throws on elements created in popups
		// FF meanwhile throws on frame elements through "defaultView.getComputedStyle"
		var view = elem.ownerDocument.defaultView;

		if ( !view || !view.opener ) {
			view = window;
		}

		return view.getComputedStyle( elem );
	};

var swap = function( elem, options, callback ) {
	var ret, name,
		old = {};

	// Remember the old values, and insert the new ones
	for ( name in options ) {
		old[ name ] = elem.style[ name ];
		elem.style[ name ] = options[ name ];
	}

	ret = callback.call( elem );

	// Revert the old values
	for ( name in options ) {
		elem.style[ name ] = old[ name ];
	}

	return ret;
};


var rboxStyle = new RegExp( cssExpand.join( "|" ), "i" );



( function() {

	// Executing both pixelPosition & boxSizingReliable tests require only one layout
	// so they're executed at the same time to save the second computation.
	function computeStyleTests() {

		// This is a singleton, we need to execute it only once
		if ( !div ) {
			return;
		}

		container.style.cssText = "position:absolute;left:-11111px;width:60px;" +
			"margin-top:1px;padding:0;border:0";
		div.style.cssText =
			"position:relative;display:block;box-sizing:border-box;overflow:scroll;" +
			"margin:auto;border:1px;padding:1px;" +
			"width:60%;top:1%";
		documentElement.appendChild( container ).appendChild( div );

		var divStyle = window.getComputedStyle( div );
		pixelPositionVal = divStyle.top !== "1%";

		// Support: Android 4.0 - 4.3 only, Firefox <=3 - 44
		reliableMarginLeftVal = roundPixelMeasures( divStyle.marginLeft ) === 12;

		// Support: Android 4.0 - 4.3 only, Safari <=9.1 - 10.1, iOS <=7.0 - 9.3
		// Some styles come back with percentage values, even though they shouldn't
		div.style.right = "60%";
		pixelBoxStylesVal = roundPixelMeasures( divStyle.right ) === 36;

		// Support: IE 9 - 11 only
		// Detect misreporting of content dimensions for box-sizing:border-box elements
		boxSizingReliableVal = roundPixelMeasures( divStyle.width ) === 36;

		// Support: IE 9 only
		// Detect overflow:scroll screwiness (gh-3699)
		// Support: Chrome <=64
		// Don't get tricked when zoom affects offsetWidth (gh-4029)
		div.style.position = "absolute";
		scrollboxSizeVal = roundPixelMeasures( div.offsetWidth / 3 ) === 12;

		documentElement.removeChild( container );

		// Nullify the div so it wouldn't be stored in the memory and
		// it will also be a sign that checks already performed
		div = null;
	}

	function roundPixelMeasures( measure ) {
		return Math.round( parseFloat( measure ) );
	}

	var pixelPositionVal, boxSizingReliableVal, scrollboxSizeVal, pixelBoxStylesVal,
		reliableTrDimensionsVal, reliableMarginLeftVal,
		container = document.createElement( "div" ),
		div = document.createElement( "div" );

	// Finish early in limited (non-browser) environments
	if ( !div.style ) {
		return;
	}

	// Support: IE <=9 - 11 only
	// Style of cloned element affects source element cloned (trac-8908)
	div.style.backgroundClip = "content-box";
	div.cloneNode( true ).style.backgroundClip = "";
	support.clearCloneStyle = div.style.backgroundClip === "content-box";

	jQuery.extend( support, {
		boxSizingReliable: function() {
			computeStyleTests();
			return boxSizingReliableVal;
		},
		pixelBoxStyles: function() {
			computeStyleTests();
			return pixelBoxStylesVal;
		},
		pixelPosition: function() {
			computeStyleTests();
			return pixelPositionVal;
		},
		reliableMarginLeft: function() {
			computeStyleTests();
			return reliableMarginLeftVal;
		},
		scrollboxSize: function() {
			computeStyleTests();
			return scrollboxSizeVal;
		},

		// Support: IE 9 - 11+, Edge 15 - 18+
		// IE/Edge misreport `getComputedStyle` of table rows with width/height
		// set in CSS while `offset*` properties report correct values.
		// Behavior in IE 9 is more subtle than in newer versions & it passes
		// some versions of this test; make sure not to make it pass there!
		//
		// Support: Firefox 70+
		// Only Firefox includes border widths
		// in computed dimensions. (gh-4529)
		reliableTrDimensions: function() {
			var table, tr, trChild, trStyle;
			if ( reliableTrDimensionsVal == null ) {
				table = document.createElement( "table" );
				tr = document.createElement( "tr" );
				trChild = document.createElement( "div" );

				table.style.cssText = "position:absolute;left:-11111px;border-collapse:separate";
				tr.style.cssText = "box-sizing:content-box;border:1px solid";

				// Support: Chrome 86+
				// Height set through cssText does not get applied.
				// Computed height then comes back as 0.
				tr.style.height = "1px";
				trChild.style.height = "9px";

				// Support: Android 8 Chrome 86+
				// In our bodyBackground.html iframe,
				// display for all div elements is set to "inline",
				// which causes a problem only in Android 8 Chrome 86.
				// Ensuring the div is `display: block`
				// gets around this issue.
				trChild.style.display = "block";

				documentElement
					.appendChild( table )
					.appendChild( tr )
					.appendChild( trChild );

				trStyle = window.getComputedStyle( tr );
				reliableTrDimensionsVal = ( parseInt( trStyle.height, 10 ) +
					parseInt( trStyle.borderTopWidth, 10 ) +
					parseInt( trStyle.borderBottomWidth, 10 ) ) === tr.offsetHeight;

				documentElement.removeChild( table );
			}
			return reliableTrDimensionsVal;
		}
	} );
} )();


function curCSS( elem, name, computed ) {
	var width, minWidth, maxWidth, ret,
		isCustomProp = rcustomProp.test( name ),

		// Support: Firefox 51+
		// Retrieving style before computed somehow
		// fixes an issue with getting wrong values
		// on detached elements
		style = elem.style;

	computed = computed || getStyles( elem );

	// getPropertyValue is needed for:
	//   .css('filter') (IE 9 only, trac-12537)
	//   .css('--customProperty) (gh-3144)
	if ( computed ) {

		// Support: IE <=9 - 11+
		// IE only supports `"float"` in `getPropertyValue`; in computed styles
		// it's only available as `"cssFloat"`. We no longer modify properties
		// sent to `.css()` apart from camelCasing, so we need to check both.
		// Normally, this would create difference in behavior: if
		// `getPropertyValue` returns an empty string, the value returned
		// by `.css()` would be `undefined`. This is usually the case for
		// disconnected elements. However, in IE even disconnected elements
		// with no styles return `"none"` for `getPropertyValue( "float" )`
		ret = computed.getPropertyValue( name ) || computed[ name ];

		if ( isCustomProp && ret ) {

			// Support: Firefox 105+, Chrome <=105+
			// Spec requires trimming whitespace for custom properties (gh-4926).
			// Firefox only trims leading whitespace. Chrome just collapses
			// both leading & trailing whitespace to a single space.
			//
			// Fall back to `undefined` if empty string returned.
			// This collapses a missing definition with property defined
			// and set to an empty string but there's no standard API
			// allowing us to differentiate them without a performance penalty
			// and returning `undefined` aligns with older jQuery.
			//
			// rtrimCSS treats U+000D CARRIAGE RETURN and U+000C FORM FEED
			// as whitespace while CSS does not, but this is not a problem
			// because CSS preprocessing replaces them with U+000A LINE FEED
			// (which *is* CSS whitespace)
			// https://www.w3.org/TR/css-syntax-3/#input-preprocessing
			ret = ret.replace( rtrimCSS, "$1" ) || undefined;
		}

		if ( ret === "" && !isAttached( elem ) ) {
			ret = jQuery.style( elem, name );
		}

		// A tribute to the "awesome hack by Dean Edwards"
		// Android Browser returns percentage for some values,
		// but width seems to be reliably pixels.
		// This is against the CSSOM draft spec:
		// https://drafts.csswg.org/cssom/#resolved-values
		if ( !support.pixelBoxStyles() && rnumnonpx.test( ret ) && rboxStyle.test( name ) ) {

			// Remember the original values
			width = style.width;
			minWidth = style.minWidth;
			maxWidth = style.maxWidth;

			// Put in the new values to get a computed value out
			style.minWidth = style.maxWidth = style.width = ret;
			ret = computed.width;

			// Revert the changed values
			style.width = width;
			style.minWidth = minWidth;
			style.maxWidth = maxWidth;
		}
	}

	return ret !== undefined ?

		// Support: IE <=9 - 11 only
		// IE returns zIndex value as an integer.
		ret + "" :
		ret;
}


function addGetHookIf( conditionFn, hookFn ) {

	// Define the hook, we'll check on the first run if it's really needed.
	return {
		get: function() {
			if ( conditionFn() ) {

				// Hook not needed (or it's not possible to use it due
				// to missing dependency), remove it.
				delete this.get;
				return;
			}

			// Hook needed; redefine it so that the support test is not executed again.
			return ( this.get = hookFn ).apply( this, arguments );
		}
	};
}


var cssPrefixes = [ "Webkit", "Moz", "ms" ],
	emptyStyle = document.createElement( "div" ).style,
	vendorProps = {};

// Return a vendor-prefixed property or undefined
function vendorPropName( name ) {

	// Check for vendor prefixed names
	var capName = name[ 0 ].toUpperCase() + name.slice( 1 ),
		i = cssPrefixes.length;

	while ( i-- ) {
		name = cssPrefixes[ i ] + capName;
		if ( name in emptyStyle ) {
			return name;
		}
	}
}

// Return a potentially-mapped jQuery.cssProps or vendor prefixed property
function finalPropName( name ) {
	var final = jQuery.cssProps[ name ] || vendorProps[ name ];

	if ( final ) {
		return final;
	}
	if ( name in emptyStyle ) {
		return name;
	}
	return vendorProps[ name ] = vendorPropName( name ) || name;
}


var

	// Swappable if display is none or starts with table
	// except "table", "table-cell", or "table-caption"
	// See here for display values: https://developer.mozilla.org/en-US/docs/CSS/display
	rdisplayswap = /^(none|table(?!-c[ea]).+)/,
	cssShow = { position: "absolute", visibility: "hidden", display: "block" },
	cssNormalTransform = {
		letterSpacing: "0",
		fontWeight: "400"
	};

function setPositiveNumber( _elem, value, subtract ) {

	// Any relative (+/-) values have already been
	// normalized at this point
	var matches = rcssNum.exec( value );
	return matches ?

		// Guard against undefined "subtract", e.g., when used as in cssHooks
		Math.max( 0, matches[ 2 ] - ( subtract || 0 ) ) + ( matches[ 3 ] || "px" ) :
		value;
}

function boxModelAdjustment( elem, dimension, box, isBorderBox, styles, computedVal ) {
	var i = dimension === "width" ? 1 : 0,
		extra = 0,
		delta = 0,
		marginDelta = 0;

	// Adjustment may not be necessary
	if ( box === ( isBorderBox ? "border" : "content" ) ) {
		return 0;
	}

	for ( ; i < 4; i += 2 ) {

		// Both box models exclude margin
		// Count margin delta separately to only add it after scroll gutter adjustment.
		// This is needed to make negative margins work with `outerHeight( true )` (gh-3982).
		if ( box === "margin" ) {
			marginDelta += jQuery.css( elem, box + cssExpand[ i ], true, styles );
		}

		// If we get here with a content-box, we're seeking "padding" or "border" or "margin"
		if ( !isBorderBox ) {

			// Add padding
			delta += jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );

			// For "border" or "margin", add border
			if ( box !== "padding" ) {
				delta += jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );

			// But still keep track of it otherwise
			} else {
				extra += jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}

		// If we get here with a border-box (content + padding + border), we're seeking "content" or
		// "padding" or "margin"
		} else {

			// For "content", subtract padding
			if ( box === "content" ) {
				delta -= jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );
			}

			// For "content" or "padding", subtract border
			if ( box !== "margin" ) {
				delta -= jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		}
	}

	// Account for positive content-box scroll gutter when requested by providing computedVal
	if ( !isBorderBox && computedVal >= 0 ) {

		// offsetWidth/offsetHeight is a rounded sum of content, padding, scroll gutter, and border
		// Assuming integer scroll gutter, subtract the rest and round down
		delta += Math.max( 0, Math.ceil(
			elem[ "offset" + dimension[ 0 ].toUpperCase() + dimension.slice( 1 ) ] -
			computedVal -
			delta -
			extra -
			0.5

		// If offsetWidth/offsetHeight is unknown, then we can't determine content-box scroll gutter
		// Use an explicit zero to avoid NaN (gh-3964)
		) ) || 0;
	}

	return delta + marginDelta;
}

function getWidthOrHeight( elem, dimension, extra ) {

	// Start with computed style
	var styles = getStyles( elem ),

		// To avoid forcing a reflow, only fetch boxSizing if we need it (gh-4322).
		// Fake content-box until we know it's needed to know the true value.
		boxSizingNeeded = !support.boxSizingReliable() || extra,
		isBorderBox = boxSizingNeeded &&
			jQuery.css( elem, "boxSizing", false, styles ) === "border-box",
		valueIsBorderBox = isBorderBox,

		val = curCSS( elem, dimension, styles ),
		offsetProp = "offset" + dimension[ 0 ].toUpperCase() + dimension.slice( 1 );

	// Support: Firefox <=54
	// Return a confounding non-pixel value or feign ignorance, as appropriate.
	if ( rnumnonpx.test( val ) ) {
		if ( !extra ) {
			return val;
		}
		val = "auto";
	}


	// Support: IE 9 - 11 only
	// Use offsetWidth/offsetHeight for when box sizing is unreliable.
	// In those cases, the computed value can be trusted to be border-box.
	if ( ( !support.boxSizingReliable() && isBorderBox ||

		// Support: IE 10 - 11+, Edge 15 - 18+
		// IE/Edge misreport `getComputedStyle` of table rows with width/height
		// set in CSS while `offset*` properties report correct values.
		// Interestingly, in some cases IE 9 doesn't suffer from this issue.
		!support.reliableTrDimensions() && nodeName( elem, "tr" ) ||

		// Fall back to offsetWidth/offsetHeight when value is "auto"
		// This happens for inline elements with no explicit setting (gh-3571)
		val === "auto" ||

		// Support: Android <=4.1 - 4.3 only
		// Also use offsetWidth/offsetHeight for misreported inline dimensions (gh-3602)
		!parseFloat( val ) && jQuery.css( elem, "display", false, styles ) === "inline" ) &&

		// Make sure the element is visible & connected
		elem.getClientRects().length ) {

		isBorderBox = jQuery.css( elem, "boxSizing", false, styles ) === "border-box";

		// Where available, offsetWidth/offsetHeight approximate border box dimensions.
		// Where not available (e.g., SVG), assume unreliable box-sizing and interpret the
		// retrieved value as a content box dimension.
		valueIsBorderBox = offsetProp in elem;
		if ( valueIsBorderBox ) {
			val = elem[ offsetProp ];
		}
	}

	// Normalize "" and auto
	val = parseFloat( val ) || 0;

	// Adjust for the element's box model
	return ( val +
		boxModelAdjustment(
			elem,
			dimension,
			extra || ( isBorderBox ? "border" : "content" ),
			valueIsBorderBox,
			styles,

			// Provide the current computed size to request scroll gutter calculation (gh-3589)
			val
		)
	) + "px";
}

jQuery.extend( {

	// Add in style property hooks for overriding the default
	// behavior of getting and setting a style property
	cssHooks: {
		opacity: {
			get: function( elem, computed ) {
				if ( computed ) {

					// We should always get a number back from opacity
					var ret = curCSS( elem, "opacity" );
					return ret === "" ? "1" : ret;
				}
			}
		}
	},

	// Don't automatically add "px" to these possibly-unitless properties
	cssNumber: {
		animationIterationCount: true,
		aspectRatio: true,
		borderImageSlice: true,
		columnCount: true,
		flexGrow: true,
		flexShrink: true,
		fontWeight: true,
		gridArea: true,
		gridColumn: true,
		gridColumnEnd: true,
		gridColumnStart: true,
		gridRow: true,
		gridRowEnd: true,
		gridRowStart: true,
		lineHeight: true,
		opacity: true,
		order: true,
		orphans: true,
		scale: true,
		widows: true,
		zIndex: true,
		zoom: true,

		// SVG-related
		fillOpacity: true,
		floodOpacity: true,
		stopOpacity: true,
		strokeMiterlimit: true,
		strokeOpacity: true
	},

	// Add in properties whose names you wish to fix before
	// setting or getting the value
	cssProps: {},

	// Get and set the style property on a DOM Node
	style: function( elem, name, value, extra ) {

		// Don't set styles on text and comment nodes
		if ( !elem || elem.nodeType === 3 || elem.nodeType === 8 || !elem.style ) {
			return;
		}

		// Make sure that we're working with the right name
		var ret, type, hooks,
			origName = camelCase( name ),
			isCustomProp = rcustomProp.test( name ),
			style = elem.style;

		// Make sure that we're working with the right name. We don't
		// want to query the value if it is a CSS custom property
		// since they are user-defined.
		if ( !isCustomProp ) {
			name = finalPropName( origName );
		}

		// Gets hook for the prefixed version, then unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// Check if we're setting a value
		if ( value !== undefined ) {
			type = typeof value;

			// Convert "+=" or "-=" to relative numbers (trac-7345)
			if ( type === "string" && ( ret = rcssNum.exec( value ) ) && ret[ 1 ] ) {
				value = adjustCSS( elem, name, ret );

				// Fixes bug trac-9237
				type = "number";
			}

			// Make sure that null and NaN values aren't set (trac-7116)
			if ( value == null || value !== value ) {
				return;
			}

			// If a number was passed in, add the unit (except for certain CSS properties)
			// The isCustomProp check can be removed in jQuery 4.0 when we only auto-append
			// "px" to a few hardcoded values.
			if ( type === "number" && !isCustomProp ) {
				value += ret && ret[ 3 ] || ( jQuery.cssNumber[ origName ] ? "" : "px" );
			}

			// background-* props affect original clone's values
			if ( !support.clearCloneStyle && value === "" && name.indexOf( "background" ) === 0 ) {
				style[ name ] = "inherit";
			}

			// If a hook was provided, use that value, otherwise just set the specified value
			if ( !hooks || !( "set" in hooks ) ||
				( value = hooks.set( elem, value, extra ) ) !== undefined ) {

				if ( isCustomProp ) {
					style.setProperty( name, value );
				} else {
					style[ name ] = value;
				}
			}

		} else {

			// If a hook was provided get the non-computed value from there
			if ( hooks && "get" in hooks &&
				( ret = hooks.get( elem, false, extra ) ) !== undefined ) {

				return ret;
			}

			// Otherwise just get the value from the style object
			return style[ name ];
		}
	},

	css: function( elem, name, extra, styles ) {
		var val, num, hooks,
			origName = camelCase( name ),
			isCustomProp = rcustomProp.test( name );

		// Make sure that we're working with the right name. We don't
		// want to modify the value if it is a CSS custom property
		// since they are user-defined.
		if ( !isCustomProp ) {
			name = finalPropName( origName );
		}

		// Try prefixed name followed by the unprefixed name
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// If a hook was provided get the computed value from there
		if ( hooks && "get" in hooks ) {
			val = hooks.get( elem, true, extra );
		}

		// Otherwise, if a way to get the computed value exists, use that
		if ( val === undefined ) {
			val = curCSS( elem, name, styles );
		}

		// Convert "normal" to computed value
		if ( val === "normal" && name in cssNormalTransform ) {
			val = cssNormalTransform[ name ];
		}

		// Make numeric if forced or a qualifier was provided and val looks numeric
		if ( extra === "" || extra ) {
			num = parseFloat( val );
			return extra === true || isFinite( num ) ? num || 0 : val;
		}

		return val;
	}
} );

jQuery.each( [ "height", "width" ], function( _i, dimension ) {
	jQuery.cssHooks[ dimension ] = {
		get: function( elem, computed, extra ) {
			if ( computed ) {

				// Certain elements can have dimension info if we invisibly show them
				// but it must have a current display style that would benefit
				return rdisplayswap.test( jQuery.css( elem, "display" ) ) &&

					// Support: Safari 8+
					// Table columns in Safari have non-zero offsetWidth & zero
					// getBoundingClientRect().width unless display is changed.
					// Support: IE <=11 only
					// Running getBoundingClientRect on a disconnected node
					// in IE throws an error.
					( !elem.getClientRects().length || !elem.getBoundingClientRect().width ) ?
					swap( elem, cssShow, function() {
						return getWidthOrHeight( elem, dimension, extra );
					} ) :
					getWidthOrHeight( elem, dimension, extra );
			}
		},

		set: function( elem, value, extra ) {
			var matches,
				styles = getStyles( elem ),

				// Only read styles.position if the test has a chance to fail
				// to avoid forcing a reflow.
				scrollboxSizeBuggy = !support.scrollboxSize() &&
					styles.position === "absolute",

				// To avoid forcing a reflow, only fetch boxSizing if we need it (gh-3991)
				boxSizingNeeded = scrollboxSizeBuggy || extra,
				isBorderBox = boxSizingNeeded &&
					jQuery.css( elem, "boxSizing", false, styles ) === "border-box",
				subtract = extra ?
					boxModelAdjustment(
						elem,
						dimension,
						extra,
						isBorderBox,
						styles
					) :
					0;

			// Account for unreliable border-box dimensions by comparing offset* to computed and
			// faking a content-box to get border and padding (gh-3699)
			if ( isBorderBox && scrollboxSizeBuggy ) {
				subtract -= Math.ceil(
					elem[ "offset" + dimension[ 0 ].toUpperCase() + dimension.slice( 1 ) ] -
					parseFloat( styles[ dimension ] ) -
					boxModelAdjustment( elem, dimension, "border", false, styles ) -
					0.5
				);
			}

			// Convert to pixels if value adjustment is needed
			if ( subtract && ( matches = rcssNum.exec( value ) ) &&
				( matches[ 3 ] || "px" ) !== "px" ) {

				elem.style[ dimension ] = value;
				value = jQuery.css( elem, dimension );
			}

			return setPositiveNumber( elem, value, subtract );
		}
	};
} );

jQuery.cssHooks.marginLeft = addGetHookIf( support.reliableMarginLeft,
	function( elem, computed ) {
		if ( computed ) {
			return ( parseFloat( curCSS( elem, "marginLeft" ) ) ||
				elem.getBoundingClientRect().left -
					swap( elem, { marginLeft: 0 }, function() {
						return elem.getBoundingClientRect().left;
					} )
			) + "px";
		}
	}
);

// These hooks are used by animate to expand properties
jQuery.each( {
	margin: "",
	padding: "",
	border: "Width"
}, function( prefix, suffix ) {
	jQuery.cssHooks[ prefix + suffix ] = {
		expand: function( value ) {
			var i = 0,
				expanded = {},

				// Assumes a single number if not a string
				parts = typeof value === "string" ? value.split( " " ) : [ value ];

			for ( ; i < 4; i++ ) {
				expanded[ prefix + cssExpand[ i ] + suffix ] =
					parts[ i ] || parts[ i - 2 ] || parts[ 0 ];
			}

			return expanded;
		}
	};

	if ( prefix !== "margin" ) {
		jQuery.cssHooks[ prefix + suffix ].set = setPositiveNumber;
	}
} );

jQuery.fn.extend( {
	css: function( name, value ) {
		return access( this, function( elem, name, value ) {
			var styles, len,
				map = {},
				i = 0;

			if ( Array.isArray( name ) ) {
				styles = getStyles( elem );
				len = name.length;

				for ( ; i < len; i++ ) {
					map[ name[ i ] ] = jQuery.css( elem, name[ i ], false, styles );
				}

				return map;
			}

			return value !== undefined ?
				jQuery.style( elem, name, value ) :
				jQuery.css( elem, name );
		}, name, value, arguments.length > 1 );
	}
} );


function Tween( elem, options, prop, end, easing ) {
	return new Tween.prototype.init( elem, options, prop, end, easing );
}
jQuery.Tween = Tween;

Tween.prototype = {
	constructor: Tween,
	init: function( elem, options, prop, end, easing, unit ) {
		this.elem = elem;
		this.prop = prop;
		this.easing = easing || jQuery.easing._default;
		this.options = options;
		this.start = this.now = this.cur();
		this.end = end;
		this.unit = unit || ( jQuery.cssNumber[ prop ] ? "" : "px" );
	},
	cur: function() {
		var hooks = Tween.propHooks[ this.prop ];

		return hooks && hooks.get ?
			hooks.get( this ) :
			Tween.propHooks._default.get( this );
	},
	run: function( percent ) {
		var eased,
			hooks = Tween.propHooks[ this.prop ];

		if ( this.options.duration ) {
			this.pos = eased = jQuery.easing[ this.easing ](
				percent, this.options.duration * percent, 0, 1, this.options.duration
			);
		} else {
			this.pos = eased = percent;
		}
		this.now = ( this.end - this.start ) * eased + this.start;

		if ( this.options.step ) {
			this.options.step.call( this.elem, this.now, this );
		}

		if ( hooks && hooks.set ) {
			hooks.set( this );
		} else {
			Tween.propHooks._default.set( this );
		}
		return this;
	}
};

Tween.prototype.init.prototype = Tween.prototype;

Tween.propHooks = {
	_default: {
		get: function( tween ) {
			var result;

			// Use a property on the element directly when it is not a DOM element,
			// or when there is no matching style property that exists.
			if ( tween.elem.nodeType !== 1 ||
				tween.elem[ tween.prop ] != null && tween.elem.style[ tween.prop ] == null ) {
				return tween.elem[ tween.prop ];
			}

			// Passing an empty string as a 3rd parameter to .css will automatically
			// attempt a parseFloat and fallback to a string if the parse fails.
			// Simple values such as "10px" are parsed to Float;
			// complex values such as "rotate(1rad)" are returned as-is.
			result = jQuery.css( tween.elem, tween.prop, "" );

			// Empty strings, null, undefined and "auto" are converted to 0.
			return !result || result === "auto" ? 0 : result;
		},
		set: function( tween ) {

			// Use step hook for back compat.
			// Use cssHook if its there.
			// Use .style if available and use plain properties where available.
			if ( jQuery.fx.step[ tween.prop ] ) {
				jQuery.fx.step[ tween.prop ]( tween );
			} else if ( tween.elem.nodeType === 1 && (
				jQuery.cssHooks[ tween.prop ] ||
					tween.elem.style[ finalPropName( tween.prop ) ] != null ) ) {
				jQuery.style( tween.elem, tween.prop, tween.now + tween.unit );
			} else {
				tween.elem[ tween.prop ] = tween.now;
			}
		}
	}
};

// Support: IE <=9 only
// Panic based approach to setting things on disconnected nodes
Tween.propHooks.scrollTop = Tween.propHooks.scrollLeft = {
	set: function( tween ) {
		if ( tween.elem.nodeType && tween.elem.parentNode ) {
			tween.elem[ tween.prop ] = tween.now;
		}
	}
};

jQuery.easing = {
	linear: function( p ) {
		return p;
	},
	swing: function( p ) {
		return 0.5 - Math.cos( p * Math.PI ) / 2;
	},
	_default: "swing"
};

jQuery.fx = Tween.prototype.init;

// Back compat <1.8 extension point
jQuery.fx.step = {};




var
	fxNow, inProgress,
	rfxtypes = /^(?:toggle|show|hide)$/,
	rrun = /queueHooks$/;

function schedule() {
	if ( inProgress ) {
		if ( document.hidden === false && window.requestAnimationFrame ) {
			window.requestAnimationFrame( schedule );
		} else {
			window.setTimeout( schedule, jQuery.fx.interval );
		}

		jQuery.fx.tick();
	}
}

// Animations created synchronously will run synchronously
function createFxNow() {
	window.setTimeout( function() {
		fxNow = undefined;
	} );
	return ( fxNow = Date.now() );
}

// Generate parameters to create a standard animation
function genFx( type, includeWidth ) {
	var which,
		i = 0,
		attrs = { height: type };

	// If we include width, step value is 1 to do all cssExpand values,
	// otherwise step value is 2 to skip over Left and Right
	includeWidth = includeWidth ? 1 : 0;
	for ( ; i < 4; i += 2 - includeWidth ) {
		which = cssExpand[ i ];
		attrs[ "margin" + which ] = attrs[ "padding" + which ] = type;
	}

	if ( includeWidth ) {
		attrs.opacity = attrs.width = type;
	}

	return attrs;
}

function createTween( value, prop, animation ) {
	var tween,
		collection = ( Animation.tweeners[ prop ] || [] ).concat( Animation.tweeners[ "*" ] ),
		index = 0,
		length = collection.length;
	for ( ; index < length; index++ ) {
		if ( ( tween = collection[ index ].call( animation, prop, value ) ) ) {

			// We're done with this property
			return tween;
		}
	}
}

function defaultPrefilter( elem, props, opts ) {
	var prop, value, toggle, hooks, oldfire, propTween, restoreDisplay, display,
		isBox = "width" in props || "height" in props,
		anim = this,
		orig = {},
		style = elem.style,
		hidden = elem.nodeType && isHiddenWithinTree( elem ),
		dataShow = dataPriv.get( elem, "fxshow" );

	// Queue-skipping animations hijack the fx hooks
	if ( !opts.queue ) {
		hooks = jQuery._queueHooks( elem, "fx" );
		if ( hooks.unqueued == null ) {
			hooks.unqueued = 0;
			oldfire = hooks.empty.fire;
			hooks.empty.fire = function() {
				if ( !hooks.unqueued ) {
					oldfire();
				}
			};
		}
		hooks.unqueued++;

		anim.always( function() {

			// Ensure the complete handler is called before this completes
			anim.always( function() {
				hooks.unqueued--;
				if ( !jQuery.queue( elem, "fx" ).length ) {
					hooks.empty.fire();
				}
			} );
		} );
	}

	// Detect show/hide animations
	for ( prop in props ) {
		value = props[ prop ];
		if ( rfxtypes.test( value ) ) {
			delete props[ prop ];
			toggle = toggle || value === "toggle";
			if ( value === ( hidden ? "hide" : "show" ) ) {

				// Pretend to be hidden if this is a "show" and
				// there is still data from a stopped show/hide
				if ( value === "show" && dataShow && dataShow[ prop ] !== undefined ) {
					hidden = true;

				// Ignore all other no-op show/hide data
				} else {
					continue;
				}
			}
			orig[ prop ] = dataShow && dataShow[ prop ] || jQuery.style( elem, prop );
		}
	}

	// Bail out if this is a no-op like .hide().hide()
	propTween = !jQuery.isEmptyObject( props );
	if ( !propTween && jQuery.isEmptyObject( orig ) ) {
		return;
	}

	// Restrict "overflow" and "display" styles during box animations
	if ( isBox && elem.nodeType === 1 ) {

		// Support: IE <=9 - 11, Edge 12 - 15
		// Record all 3 overflow attributes because IE does not infer the shorthand
		// from identically-valued overflowX and overflowY and Edge just mirrors
		// the overflowX value there.
		opts.overflow = [ style.overflow, style.overflowX, style.overflowY ];

		// Identify a display type, preferring old show/hide data over the CSS cascade
		restoreDisplay = dataShow && dataShow.display;
		if ( restoreDisplay == null ) {
			restoreDisplay = dataPriv.get( elem, "display" );
		}
		display = jQuery.css( elem, "display" );
		if ( display === "none" ) {
			if ( restoreDisplay ) {
				display = restoreDisplay;
			} else {

				// Get nonempty value(s) by temporarily forcing visibility
				showHide( [ elem ], true );
				restoreDisplay = elem.style.display || restoreDisplay;
				display = jQuery.css( elem, "display" );
				showHide( [ elem ] );
			}
		}

		// Animate inline elements as inline-block
		if ( display === "inline" || display === "inline-block" && restoreDisplay != null ) {
			if ( jQuery.css( elem, "float" ) === "none" ) {

				// Restore the original display value at the end of pure show/hide animations
				if ( !propTween ) {
					anim.done( function() {
						style.display = restoreDisplay;
					} );
					if ( restoreDisplay == null ) {
						display = style.display;
						restoreDisplay = display === "none" ? "" : display;
					}
				}
				style.display = "inline-block";
			}
		}
	}

	if ( opts.overflow ) {
		style.overflow = "hidden";
		anim.always( function() {
			style.overflow = opts.overflow[ 0 ];
			style.overflowX = opts.overflow[ 1 ];
			style.overflowY = opts.overflow[ 2 ];
		} );
	}

	// Implement show/hide animations
	propTween = false;
	for ( prop in orig ) {

		// General show/hide setup for this element animation
		if ( !propTween ) {
			if ( dataShow ) {
				if ( "hidden" in dataShow ) {
					hidden = dataShow.hidden;
				}
			} else {
				dataShow = dataPriv.access( elem, "fxshow", { display: restoreDisplay } );
			}

			// Store hidden/visible for toggle so `.stop().toggle()` "reverses"
			if ( toggle ) {
				dataShow.hidden = !hidden;
			}

			// Show elements before animating them
			if ( hidden ) {
				showHide( [ elem ], true );
			}

			/* eslint-disable no-loop-func */

			anim.done( function() {

				/* eslint-enable no-loop-func */

				// The final step of a "hide" animation is actually hiding the element
				if ( !hidden ) {
					showHide( [ elem ] );
				}
				dataPriv.remove( elem, "fxshow" );
				for ( prop in orig ) {
					jQuery.style( elem, prop, orig[ prop ] );
				}
			} );
		}

		// Per-property setup
		propTween = createTween( hidden ? dataShow[ prop ] : 0, prop, anim );
		if ( !( prop in dataShow ) ) {
			dataShow[ prop ] = propTween.start;
			if ( hidden ) {
				propTween.end = propTween.start;
				propTween.start = 0;
			}
		}
	}
}

function propFilter( props, specialEasing ) {
	var index, name, easing, value, hooks;

	// camelCase, specialEasing and expand cssHook pass
	for ( index in props ) {
		name = camelCase( index );
		easing = specialEasing[ name ];
		value = props[ index ];
		if ( Array.isArray( value ) ) {
			easing = value[ 1 ];
			value = props[ index ] = value[ 0 ];
		}

		if ( index !== name ) {
			props[ name ] = value;
			delete props[ index ];
		}

		hooks = jQuery.cssHooks[ name ];
		if ( hooks && "expand" in hooks ) {
			value = hooks.expand( value );
			delete props[ name ];

			// Not quite $.extend, this won't overwrite existing keys.
			// Reusing 'index' because we have the correct "name"
			for ( index in value ) {
				if ( !( index in props ) ) {
					props[ index ] = value[ index ];
					specialEasing[ index ] = easing;
				}
			}
		} else {
			specialEasing[ name ] = easing;
		}
	}
}

function Animation( elem, properties, options ) {
	var result,
		stopped,
		index = 0,
		length = Animation.prefilters.length,
		deferred = jQuery.Deferred().always( function() {

			// Don't match elem in the :animated selector
			delete tick.elem;
		} ),
		tick = function() {
			if ( stopped ) {
				return false;
			}
			var currentTime = fxNow || createFxNow(),
				remaining = Math.max( 0, animation.startTime + animation.duration - currentTime ),

				// Support: Android 2.3 only
				// Archaic crash bug won't allow us to use `1 - ( 0.5 || 0 )` (trac-12497)
				temp = remaining / animation.duration || 0,
				percent = 1 - temp,
				index = 0,
				length = animation.tweens.length;

			for ( ; index < length; index++ ) {
				animation.tweens[ index ].run( percent );
			}

			deferred.notifyWith( elem, [ animation, percent, remaining ] );

			// If there's more to do, yield
			if ( percent < 1 && length ) {
				return remaining;
			}

			// If this was an empty animation, synthesize a final progress notification
			if ( !length ) {
				deferred.notifyWith( elem, [ animation, 1, 0 ] );
			}

			// Resolve the animation and report its conclusion
			deferred.resolveWith( elem, [ animation ] );
			return false;
		},
		animation = deferred.promise( {
			elem: elem,
			props: jQuery.extend( {}, properties ),
			opts: jQuery.extend( true, {
				specialEasing: {},
				easing: jQuery.easing._default
			}, options ),
			originalProperties: properties,
			originalOptions: options,
			startTime: fxNow || createFxNow(),
			duration: options.duration,
			tweens: [],
			createTween: function( prop, end ) {
				var tween = jQuery.Tween( elem, animation.opts, prop, end,
					animation.opts.specialEasing[ prop ] || animation.opts.easing );
				animation.tweens.push( tween );
				return tween;
			},
			stop: function( gotoEnd ) {
				var index = 0,

					// If we are going to the end, we want to run all the tweens
					// otherwise we skip this part
					length = gotoEnd ? animation.tweens.length : 0;
				if ( stopped ) {
					return this;
				}
				stopped = true;
				for ( ; index < length; index++ ) {
					animation.tweens[ index ].run( 1 );
				}

				// Resolve when we played the last frame; otherwise, reject
				if ( gotoEnd ) {
					deferred.notifyWith( elem, [ animation, 1, 0 ] );
					deferred.resolveWith( elem, [ animation, gotoEnd ] );
				} else {
					deferred.rejectWith( elem, [ animation, gotoEnd ] );
				}
				return this;
			}
		} ),
		props = animation.props;

	propFilter( props, animation.opts.specialEasing );

	for ( ; index < length; index++ ) {
		result = Animation.prefilters[ index ].call( animation, elem, props, animation.opts );
		if ( result ) {
			if ( isFunction( result.stop ) ) {
				jQuery._queueHooks( animation.elem, animation.opts.queue ).stop =
					result.stop.bind( result );
			}
			return result;
		}
	}

	jQuery.map( props, createTween, animation );

	if ( isFunction( animation.opts.start ) ) {
		animation.opts.start.call( elem, animation );
	}

	// Attach callbacks from options
	animation
		.progress( animation.opts.progress )
		.done( animation.opts.done, animation.opts.complete )
		.fail( animation.opts.fail )
		.always( animation.opts.always );

	jQuery.fx.timer(
		jQuery.extend( tick, {
			elem: elem,
			anim: animation,
			queue: animation.opts.queue
		} )
	);

	return animation;
}

jQuery.Animation = jQuery.extend( Animation, {

	tweeners: {
		"*": [ function( prop, value ) {
			var tween = this.createTween( prop, value );
			adjustCSS( tween.elem, prop, rcssNum.exec( value ), tween );
			return tween;
		} ]
	},

	tweener: function( props, callback ) {
		if ( isFunction( props ) ) {
			callback = props;
			props = [ "*" ];
		} else {
			props = props.match( rnothtmlwhite );
		}

		var prop,
			index = 0,
			length = props.length;

		for ( ; index < length; index++ ) {
			prop = props[ index ];
			Animation.tweeners[ prop ] = Animation.tweeners[ prop ] || [];
			Animation.tweeners[ prop ].unshift( callback );
		}
	},

	prefilters: [ defaultPrefilter ],

	prefilter: function( callback, prepend ) {
		if ( prepend ) {
			Animation.prefilters.unshift( callback );
		} else {
			Animation.prefilters.push( callback );
		}
	}
} );

jQuery.speed = function( speed, easing, fn ) {
	var opt = speed && typeof speed === "object" ? jQuery.extend( {}, speed ) : {
		complete: fn || !fn && easing ||
			isFunction( speed ) && speed,
		duration: speed,
		easing: fn && easing || easing && !isFunction( easing ) && easing
	};

	// Go to the end state if fx are off
	if ( jQuery.fx.off ) {
		opt.duration = 0;

	} else {
		if ( typeof opt.duration !== "number" ) {
			if ( opt.duration in jQuery.fx.speeds ) {
				opt.duration = jQuery.fx.speeds[ opt.duration ];

			} else {
				opt.duration = jQuery.fx.speeds._default;
			}
		}
	}

	// Normalize opt.queue - true/undefined/null -> "fx"
	if ( opt.queue == null || opt.queue === true ) {
		opt.queue = "fx";
	}

	// Queueing
	opt.old = opt.complete;

	opt.complete = function() {
		if ( isFunction( opt.old ) ) {
			opt.old.call( this );
		}

		if ( opt.queue ) {
			jQuery.dequeue( this, opt.queue );
		}
	};

	return opt;
};

jQuery.fn.extend( {
	fadeTo: function( speed, to, easing, callback ) {

		// Show any hidden elements after setting opacity to 0
		return this.filter( isHiddenWithinTree ).css( "opacity", 0 ).show()

			// Animate to the value specified
			.end().animate( { opacity: to }, speed, easing, callback );
	},
	animate: function( prop, speed, easing, callback ) {
		var empty = jQuery.isEmptyObject( prop ),
			optall = jQuery.speed( speed, easing, callback ),
			doAnimation = function() {

				// Operate on a copy of prop so per-property easing won't be lost
				var anim = Animation( this, jQuery.extend( {}, prop ), optall );

				// Empty animations, or finishing resolves immediately
				if ( empty || dataPriv.get( this, "finish" ) ) {
					anim.stop( true );
				}
			};

		doAnimation.finish = doAnimation;

		return empty || optall.queue === false ?
			this.each( doAnimation ) :
			this.queue( optall.queue, doAnimation );
	},
	stop: function( type, clearQueue, gotoEnd ) {
		var stopQueue = function( hooks ) {
			var stop = hooks.stop;
			delete hooks.stop;
			stop( gotoEnd );
		};

		if ( typeof type !== "string" ) {
			gotoEnd = clearQueue;
			clearQueue = type;
			type = undefined;
		}
		if ( clearQueue ) {
			this.queue( type || "fx", [] );
		}

		return this.each( function() {
			var dequeue = true,
				index = type != null && type + "queueHooks",
				timers = jQuery.timers,
				data = dataPriv.get( this );

			if ( index ) {
				if ( data[ index ] && data[ index ].stop ) {
					stopQueue( data[ index ] );
				}
			} else {
				for ( index in data ) {
					if ( data[ index ] && data[ index ].stop && rrun.test( index ) ) {
						stopQueue( data[ index ] );
					}
				}
			}

			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this &&
					( type == null || timers[ index ].queue === type ) ) {

					timers[ index ].anim.stop( gotoEnd );
					dequeue = false;
					timers.splice( index, 1 );
				}
			}

			// Start the next in the queue if the last step wasn't forced.
			// Timers currently will call their complete callbacks, which
			// will dequeue but only if they were gotoEnd.
			if ( dequeue || !gotoEnd ) {
				jQuery.dequeue( this, type );
			}
		} );
	},
	finish: function( type ) {
		if ( type !== false ) {
			type = type || "fx";
		}
		return this.each( function() {
			var index,
				data = dataPriv.get( this ),
				queue = data[ type + "queue" ],
				hooks = data[ type + "queueHooks" ],
				timers = jQuery.timers,
				length = queue ? queue.length : 0;

			// Enable finishing flag on private data
			data.finish = true;

			// Empty the queue first
			jQuery.queue( this, type, [] );

			if ( hooks && hooks.stop ) {
				hooks.stop.call( this, true );
			}

			// Look for any active animations, and finish them
			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && timers[ index ].queue === type ) {
					timers[ index ].anim.stop( true );
					timers.splice( index, 1 );
				}
			}

			// Look for any animations in the old queue and finish them
			for ( index = 0; index < length; index++ ) {
				if ( queue[ index ] && queue[ index ].finish ) {
					queue[ index ].finish.call( this );
				}
			}

			// Turn off finishing flag
			delete data.finish;
		} );
	}
} );

jQuery.each( [ "toggle", "show", "hide" ], function( _i, name ) {
	var cssFn = jQuery.fn[ name ];
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return speed == null || typeof speed === "boolean" ?
			cssFn.apply( this, arguments ) :
			this.animate( genFx( name, true ), speed, easing, callback );
	};
} );

// Generate shortcuts for custom animations
jQuery.each( {
	slideDown: genFx( "show" ),
	slideUp: genFx( "hide" ),
	slideToggle: genFx( "toggle" ),
	fadeIn: { opacity: "show" },
	fadeOut: { opacity: "hide" },
	fadeToggle: { opacity: "toggle" }
}, function( name, props ) {
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return this.animate( props, speed, easing, callback );
	};
} );

jQuery.timers = [];
jQuery.fx.tick = function() {
	var timer,
		i = 0,
		timers = jQuery.timers;

	fxNow = Date.now();

	for ( ; i < timers.length; i++ ) {
		timer = timers[ i ];

		// Run the timer and safely remove it when done (allowing for external removal)
		if ( !timer() && timers[ i ] === timer ) {
			timers.splice( i--, 1 );
		}
	}

	if ( !timers.length ) {
		jQuery.fx.stop();
	}
	fxNow = undefined;
};

jQuery.fx.timer = function( timer ) {
	jQuery.timers.push( timer );
	jQuery.fx.start();
};

jQuery.fx.interval = 13;
jQuery.fx.start = function() {
	if ( inProgress ) {
		return;
	}

	inProgress = true;
	schedule();
};

jQuery.fx.stop = function() {
	inProgress = null;
};

jQuery.fx.speeds = {
	slow: 600,
	fast: 200,

	// Default speed
	_default: 400
};


// Based off of the plugin by Clint Helfers, with permission.
jQuery.fn.delay = function( time, type ) {
	time = jQuery.fx ? jQuery.fx.speeds[ time ] || time : time;
	type = type || "fx";

	return this.queue( type, function( next, hooks ) {
		var timeout = window.setTimeout( next, time );
		hooks.stop = function() {
			window.clearTimeout( timeout );
		};
	} );
};


( function() {
	var input = document.createElement( "input" ),
		select = document.createElement( "select" ),
		opt = select.appendChild( document.createElement( "option" ) );

	input.type = "checkbox";

	// Support: Android <=4.3 only
	// Default value for a checkbox should be "on"
	support.checkOn = input.value !== "";

	// Support: IE <=11 only
	// Must access selectedIndex to make default options select
	support.optSelected = opt.selected;

	// Support: IE <=11 only
	// An input loses its value after becoming a radio
	input = document.createElement( "input" );
	input.value = "t";
	input.type = "radio";
	support.radioValue = input.value === "t";
} )();


var boolHook,
	attrHandle = jQuery.expr.attrHandle;

jQuery.fn.extend( {
	attr: function( name, value ) {
		return access( this, jQuery.attr, name, value, arguments.length > 1 );
	},

	removeAttr: function( name ) {
		return this.each( function() {
			jQuery.removeAttr( this, name );
		} );
	}
} );

jQuery.extend( {
	attr: function( elem, name, value ) {
		var ret, hooks,
			nType = elem.nodeType;

		// Don't get/set attributes on text, comment and attribute nodes
		if ( nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		// Fallback to prop when attributes are not supported
		if ( typeof elem.getAttribute === "undefined" ) {
			return jQuery.prop( elem, name, value );
		}

		// Attribute hooks are determined by the lowercase version
		// Grab necessary hook if one is defined
		if ( nType !== 1 || !jQuery.isXMLDoc( elem ) ) {
			hooks = jQuery.attrHooks[ name.toLowerCase() ] ||
				( jQuery.expr.match.bool.test( name ) ? boolHook : undefined );
		}

		if ( value !== undefined ) {
			if ( value === null ) {
				jQuery.removeAttr( elem, name );
				return;
			}

			if ( hooks && "set" in hooks &&
				( ret = hooks.set( elem, value, name ) ) !== undefined ) {
				return ret;
			}

			elem.setAttribute( name, value + "" );
			return value;
		}

		if ( hooks && "get" in hooks && ( ret = hooks.get( elem, name ) ) !== null ) {
			return ret;
		}

		ret = jQuery.find.attr( elem, name );

		// Non-existent attributes return null, we normalize to undefined
		return ret == null ? undefined : ret;
	},

	attrHooks: {
		type: {
			set: function( elem, value ) {
				if ( !support.radioValue && value === "radio" &&
					nodeName( elem, "input" ) ) {
					var val = elem.value;
					elem.setAttribute( "type", value );
					if ( val ) {
						elem.value = val;
					}
					return value;
				}
			}
		}
	},

	removeAttr: function( elem, value ) {
		var name,
			i = 0,

			// Attribute names can contain non-HTML whitespace characters
			// https://html.spec.whatwg.org/multipage/syntax.html#attributes-2
			attrNames = value && value.match( rnothtmlwhite );

		if ( attrNames && elem.nodeType === 1 ) {
			while ( ( name = attrNames[ i++ ] ) ) {
				elem.removeAttribute( name );
			}
		}
	}
} );

// Hooks for boolean attributes
boolHook = {
	set: function( elem, value, name ) {
		if ( value === false ) {

			// Remove boolean attributes when set to false
			jQuery.removeAttr( elem, name );
		} else {
			elem.setAttribute( name, name );
		}
		return name;
	}
};

jQuery.each( jQuery.expr.match.bool.source.match( /\w+/g ), function( _i, name ) {
	var getter = attrHandle[ name ] || jQuery.find.attr;

	attrHandle[ name ] = function( elem, name, isXML ) {
		var ret, handle,
			lowercaseName = name.toLowerCase();

		if ( !isXML ) {

			// Avoid an infinite loop by temporarily removing this function from the getter
			handle = attrHandle[ lowercaseName ];
			attrHandle[ lowercaseName ] = ret;
			ret = getter( elem, name, isXML ) != null ?
				lowercaseName :
				null;
			attrHandle[ lowercaseName ] = handle;
		}
		return ret;
	};
} );




var rfocusable = /^(?:input|select|textarea|button)$/i,
	rclickable = /^(?:a|area)$/i;

jQuery.fn.extend( {
	prop: function( name, value ) {
		return access( this, jQuery.prop, name, value, arguments.length > 1 );
	},

	removeProp: function( name ) {
		return this.each( function() {
			delete this[ jQuery.propFix[ name ] || name ];
		} );
	}
} );

jQuery.extend( {
	prop: function( elem, name, value ) {
		var ret, hooks,
			nType = elem.nodeType;

		// Don't get/set properties on text, comment and attribute nodes
		if ( nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		if ( nType !== 1 || !jQuery.isXMLDoc( elem ) ) {

			// Fix name and attach hooks
			name = jQuery.propFix[ name ] || name;
			hooks = jQuery.propHooks[ name ];
		}

		if ( value !== undefined ) {
			if ( hooks && "set" in hooks &&
				( ret = hooks.set( elem, value, name ) ) !== undefined ) {
				return ret;
			}

			return ( elem[ name ] = value );
		}

		if ( hooks && "get" in hooks && ( ret = hooks.get( elem, name ) ) !== null ) {
			return ret;
		}

		return elem[ name ];
	},

	propHooks: {
		tabIndex: {
			get: function( elem ) {

				// Support: IE <=9 - 11 only
				// elem.tabIndex doesn't always return the
				// correct value when it hasn't been explicitly set
				// Use proper attribute retrieval (trac-12072)
				var tabindex = jQuery.find.attr( elem, "tabindex" );

				if ( tabindex ) {
					return parseInt( tabindex, 10 );
				}

				if (
					rfocusable.test( elem.nodeName ) ||
					rclickable.test( elem.nodeName ) &&
					elem.href
				) {
					return 0;
				}

				return -1;
			}
		}
	},

	propFix: {
		"for": "htmlFor",
		"class": "className"
	}
} );

// Support: IE <=11 only
// Accessing the selectedIndex property
// forces the browser to respect setting selected
// on the option
// The getter ensures a default option is selected
// when in an optgroup
// eslint rule "no-unused-expressions" is disabled for this code
// since it considers such accessions noop
if ( !support.optSelected ) {
	jQuery.propHooks.selected = {
		get: function( elem ) {

			/* eslint no-unused-expressions: "off" */

			var parent = elem.parentNode;
			if ( parent && parent.parentNode ) {
				parent.parentNode.selectedIndex;
			}
			return null;
		},
		set: function( elem ) {

			/* eslint no-unused-expressions: "off" */

			var parent = elem.parentNode;
			if ( parent ) {
				parent.selectedIndex;

				if ( parent.parentNode ) {
					parent.parentNode.selectedIndex;
				}
			}
		}
	};
}

jQuery.each( [
	"tabIndex",
	"readOnly",
	"maxLength",
	"cellSpacing",
	"cellPadding",
	"rowSpan",
	"colSpan",
	"useMap",
	"frameBorder",
	"contentEditable"
], function() {
	jQuery.propFix[ this.toLowerCase() ] = this;
} );




	// Strip and collapse whitespace according to HTML spec
	// https://infra.spec.whatwg.org/#strip-and-collapse-ascii-whitespace
	function stripAndCollapse( value ) {
		var tokens = value.match( rnothtmlwhite ) || [];
		return tokens.join( " " );
	}


function getClass( elem ) {
	return elem.getAttribute && elem.getAttribute( "class" ) || "";
}

function classesToArray( value ) {
	if ( Array.isArray( value ) ) {
		return value;
	}
	if ( typeof value === "string" ) {
		return value.match( rnothtmlwhite ) || [];
	}
	return [];
}

jQuery.fn.extend( {
	addClass: function( value ) {
		var classNames, cur, curValue, className, i, finalValue;

		if ( isFunction( value ) ) {
			return this.each( function( j ) {
				jQuery( this ).addClass( value.call( this, j, getClass( this ) ) );
			} );
		}

		classNames = classesToArray( value );

		if ( classNames.length ) {
			return this.each( function() {
				curValue = getClass( this );
				cur = this.nodeType === 1 && ( " " + stripAndCollapse( curValue ) + " " );

				if ( cur ) {
					for ( i = 0; i < classNames.length; i++ ) {
						className = classNames[ i ];
						if ( cur.indexOf( " " + className + " " ) < 0 ) {
							cur += className + " ";
						}
					}

					// Only assign if different to avoid unneeded rendering.
					finalValue = stripAndCollapse( cur );
					if ( curValue !== finalValue ) {
						this.setAttribute( "class", finalValue );
					}
				}
			} );
		}

		return this;
	},

	removeClass: function( value ) {
		var classNames, cur, curValue, className, i, finalValue;

		if ( isFunction( value ) ) {
			return this.each( function( j ) {
				jQuery( this ).removeClass( value.call( this, j, getClass( this ) ) );
			} );
		}

		if ( !arguments.length ) {
			return this.attr( "class", "" );
		}

		classNames = classesToArray( value );

		if ( classNames.length ) {
			return this.each( function() {
				curValue = getClass( this );

				// This expression is here for better compressibility (see addClass)
				cur = this.nodeType === 1 && ( " " + stripAndCollapse( curValue ) + " " );

				if ( cur ) {
					for ( i = 0; i < classNames.length; i++ ) {
						className = classNames[ i ];

						// Remove *all* instances
						while ( cur.indexOf( " " + className + " " ) > -1 ) {
							cur = cur.replace( " " + className + " ", " " );
						}
					}

					// Only assign if different to avoid unneeded rendering.
					finalValue = stripAndCollapse( cur );
					if ( curValue !== finalValue ) {
						this.setAttribute( "class", finalValue );
					}
				}
			} );
		}

		return this;
	},

	toggleClass: function( value, stateVal ) {
		var classNames, className, i, self,
			type = typeof value,
			isValidValue = type === "string" || Array.isArray( value );

		if ( isFunction( value ) ) {
			return this.each( function( i ) {
				jQuery( this ).toggleClass(
					value.call( this, i, getClass( this ), stateVal ),
					stateVal
				);
			} );
		}

		if ( typeof stateVal === "boolean" && isValidValue ) {
			return stateVal ? this.addClass( value ) : this.removeClass( value );
		}

		classNames = classesToArray( value );

		return this.each( function() {
			if ( isValidValue ) {

				// Toggle individual class names
				self = jQuery( this );

				for ( i = 0; i < classNames.length; i++ ) {
					className = classNames[ i ];

					// Check each className given, space separated list
					if ( self.hasClass( className ) ) {
						self.removeClass( className );
					} else {
						self.addClass( className );
					}
				}

			// Toggle whole class name
			} else if ( value === undefined || type === "boolean" ) {
				className = getClass( this );
				if ( className ) {

					// Store className if set
					dataPriv.set( this, "__className__", className );
				}

				// If the element has a class name or if we're passed `false`,
				// then remove the whole classname (if there was one, the above saved it).
				// Otherwise bring back whatever was previously saved (if anything),
				// falling back to the empty string if nothing was stored.
				if ( this.setAttribute ) {
					this.setAttribute( "class",
						className || value === false ?
							"" :
							dataPriv.get( this, "__className__" ) || ""
					);
				}
			}
		} );
	},

	hasClass: function( selector ) {
		var className, elem,
			i = 0;

		className = " " + selector + " ";
		while ( ( elem = this[ i++ ] ) ) {
			if ( elem.nodeType === 1 &&
				( " " + stripAndCollapse( getClass( elem ) ) + " " ).indexOf( className ) > -1 ) {
				return true;
			}
		}

		return false;
	}
} );




var rreturn = /\r/g;

jQuery.fn.extend( {
	val: function( value ) {
		var hooks, ret, valueIsFunction,
			elem = this[ 0 ];

		if ( !arguments.length ) {
			if ( elem ) {
				hooks = jQuery.valHooks[ elem.type ] ||
					jQuery.valHooks[ elem.nodeName.toLowerCase() ];

				if ( hooks &&
					"get" in hooks &&
					( ret = hooks.get( elem, "value" ) ) !== undefined
				) {
					return ret;
				}

				ret = elem.value;

				// Handle most common string cases
				if ( typeof ret === "string" ) {
					return ret.replace( rreturn, "" );
				}

				// Handle cases where value is null/undef or number
				return ret == null ? "" : ret;
			}

			return;
		}

		valueIsFunction = isFunction( value );

		return this.each( function( i ) {
			var val;

			if ( this.nodeType !== 1 ) {
				return;
			}

			if ( valueIsFunction ) {
				val = value.call( this, i, jQuery( this ).val() );
			} else {
				val = value;
			}

			// Treat null/undefined as ""; convert numbers to string
			if ( val == null ) {
				val = "";

			} else if ( typeof val === "number" ) {
				val += "";

			} else if ( Array.isArray( val ) ) {
				val = jQuery.map( val, function( value ) {
					return value == null ? "" : value + "";
				} );
			}

			hooks = jQuery.valHooks[ this.type ] || jQuery.valHooks[ this.nodeName.toLowerCase() ];

			// If set returns undefined, fall back to normal setting
			if ( !hooks || !( "set" in hooks ) || hooks.set( this, val, "value" ) === undefined ) {
				this.value = val;
			}
		} );
	}
} );

jQuery.extend( {
	valHooks: {
		option: {
			get: function( elem ) {

				var val = jQuery.find.attr( elem, "value" );
				return val != null ?
					val :

					// Support: IE <=10 - 11 only
					// option.text throws exceptions (trac-14686, trac-14858)
					// Strip and collapse whitespace
					// https://html.spec.whatwg.org/#strip-and-collapse-whitespace
					stripAndCollapse( jQuery.text( elem ) );
			}
		},
		select: {
			get: function( elem ) {
				var value, option, i,
					options = elem.options,
					index = elem.selectedIndex,
					one = elem.type === "select-one",
					values = one ? null : [],
					max = one ? index + 1 : options.length;

				if ( index < 0 ) {
					i = max;

				} else {
					i = one ? index : 0;
				}

				// Loop through all the selected options
				for ( ; i < max; i++ ) {
					option = options[ i ];

					// Support: IE <=9 only
					// IE8-9 doesn't update selected after form reset (trac-2551)
					if ( ( option.selected || i === index ) &&

							// Don't return options that are disabled or in a disabled optgroup
							!option.disabled &&
							( !option.parentNode.disabled ||
								!nodeName( option.parentNode, "optgroup" ) ) ) {

						// Get the specific value for the option
						value = jQuery( option ).val();

						// We don't need an array for one selects
						if ( one ) {
							return value;
						}

						// Multi-Selects return an array
						values.push( value );
					}
				}

				return values;
			},

			set: function( elem, value ) {
				var optionSet, option,
					options = elem.options,
					values = jQuery.makeArray( value ),
					i = options.length;

				while ( i-- ) {
					option = options[ i ];

					/* eslint-disable no-cond-assign */

					if ( option.selected =
						jQuery.inArray( jQuery.valHooks.option.get( option ), values ) > -1
					) {
						optionSet = true;
					}

					/* eslint-enable no-cond-assign */
				}

				// Force browsers to behave consistently when non-matching value is set
				if ( !optionSet ) {
					elem.selectedIndex = -1;
				}
				return values;
			}
		}
	}
} );

// Radios and checkboxes getter/setter
jQuery.each( [ "radio", "checkbox" ], function() {
	jQuery.valHooks[ this ] = {
		set: function( elem, value ) {
			if ( Array.isArray( value ) ) {
				return ( elem.checked = jQuery.inArray( jQuery( elem ).val(), value ) > -1 );
			}
		}
	};
	if ( !support.checkOn ) {
		jQuery.valHooks[ this ].get = function( elem ) {
			return elem.getAttribute( "value" ) === null ? "on" : elem.value;
		};
	}
} );




// Return jQuery for attributes-only inclusion
var location = window.location;

var nonce = { guid: Date.now() };

var rquery = ( /\?/ );



// Cross-browser xml parsing
jQuery.parseXML = function( data ) {
	var xml, parserErrorElem;
	if ( !data || typeof data !== "string" ) {
		return null;
	}

	// Support: IE 9 - 11 only
	// IE throws on parseFromString with invalid input.
	try {
		xml = ( new window.DOMParser() ).parseFromString( data, "text/xml" );
	} catch ( e ) {}

	parserErrorElem = xml && xml.getElementsByTagName( "parsererror" )[ 0 ];
	if ( !xml || parserErrorElem ) {
		jQuery.error( "Invalid XML: " + (
			parserErrorElem ?
				jQuery.map( parserErrorElem.childNodes, function( el ) {
					return el.textContent;
				} ).join( "\n" ) :
				data
		) );
	}
	return xml;
};


var rfocusMorph = /^(?:focusinfocus|focusoutblur)$/,
	stopPropagationCallback = function( e ) {
		e.stopPropagation();
	};

jQuery.extend( jQuery.event, {

	trigger: function( event, data, elem, onlyHandlers ) {

		var i, cur, tmp, bubbleType, ontype, handle, special, lastElement,
			eventPath = [ elem || document ],
			type = hasOwn.call( event, "type" ) ? event.type : event,
			namespaces = hasOwn.call( event, "namespace" ) ? event.namespace.split( "." ) : [];

		cur = lastElement = tmp = elem = elem || document;

		// Don't do events on text and comment nodes
		if ( elem.nodeType === 3 || elem.nodeType === 8 ) {
			return;
		}

		// focus/blur morphs to focusin/out; ensure we're not firing them right now
		if ( rfocusMorph.test( type + jQuery.event.triggered ) ) {
			return;
		}

		if ( type.indexOf( "." ) > -1 ) {

			// Namespaced trigger; create a regexp to match event type in handle()
			namespaces = type.split( "." );
			type = namespaces.shift();
			namespaces.sort();
		}
		ontype = type.indexOf( ":" ) < 0 && "on" + type;

		// Caller can pass in a jQuery.Event object, Object, or just an event type string
		event = event[ jQuery.expando ] ?
			event :
			new jQuery.Event( type, typeof event === "object" && event );

		// Trigger bitmask: & 1 for native handlers; & 2 for jQuery (always true)
		event.isTrigger = onlyHandlers ? 2 : 3;
		event.namespace = namespaces.join( "." );
		event.rnamespace = event.namespace ?
			new RegExp( "(^|\\.)" + namespaces.join( "\\.(?:.*\\.|)" ) + "(\\.|$)" ) :
			null;

		// Clean up the event in case it is being reused
		event.result = undefined;
		if ( !event.target ) {
			event.target = elem;
		}

		// Clone any incoming data and prepend the event, creating the handler arg list
		data = data == null ?
			[ event ] :
			jQuery.makeArray( data, [ event ] );

		// Allow special events to draw outside the lines
		special = jQuery.event.special[ type ] || {};
		if ( !onlyHandlers && special.trigger && special.trigger.apply( elem, data ) === false ) {
			return;
		}

		// Determine event propagation path in advance, per W3C events spec (trac-9951)
		// Bubble up to document, then to window; watch for a global ownerDocument var (trac-9724)
		if ( !onlyHandlers && !special.noBubble && !isWindow( elem ) ) {

			bubbleType = special.delegateType || type;
			if ( !rfocusMorph.test( bubbleType + type ) ) {
				cur = cur.parentNode;
			}
			for ( ; cur; cur = cur.parentNode ) {
				eventPath.push( cur );
				tmp = cur;
			}

			// Only add window if we got to document (e.g., not plain obj or detached DOM)
			if ( tmp === ( elem.ownerDocument || document ) ) {
				eventPath.push( tmp.defaultView || tmp.parentWindow || window );
			}
		}

		// Fire handlers on the event path
		i = 0;
		while ( ( cur = eventPath[ i++ ] ) && !event.isPropagationStopped() ) {
			lastElement = cur;
			event.type = i > 1 ?
				bubbleType :
				special.bindType || type;

			// jQuery handler
			handle = ( dataPriv.get( cur, "events" ) || Object.create( null ) )[ event.type ] &&
				dataPriv.get( cur, "handle" );
			if ( handle ) {
				handle.apply( cur, data );
			}

			// Native handler
			handle = ontype && cur[ ontype ];
			if ( handle && handle.apply && acceptData( cur ) ) {
				event.result = handle.apply( cur, data );
				if ( event.result === false ) {
					event.preventDefault();
				}
			}
		}
		event.type = type;

		// If nobody prevented the default action, do it now
		if ( !onlyHandlers && !event.isDefaultPrevented() ) {

			if ( ( !special._default ||
				special._default.apply( eventPath.pop(), data ) === false ) &&
				acceptData( elem ) ) {

				// Call a native DOM method on the target with the same name as the event.
				// Don't do default actions on window, that's where global variables be (trac-6170)
				if ( ontype && isFunction( elem[ type ] ) && !isWindow( elem ) ) {

					// Don't re-trigger an onFOO event when we call its FOO() method
					tmp = elem[ ontype ];

					if ( tmp ) {
						elem[ ontype ] = null;
					}

					// Prevent re-triggering of the same event, since we already bubbled it above
					jQuery.event.triggered = type;

					if ( event.isPropagationStopped() ) {
						lastElement.addEventListener( type, stopPropagationCallback );
					}

					elem[ type ]();

					if ( event.isPropagationStopped() ) {
						lastElement.removeEventListener( type, stopPropagationCallback );
					}

					jQuery.event.triggered = undefined;

					if ( tmp ) {
						elem[ ontype ] = tmp;
					}
				}
			}
		}

		return event.result;
	},

	// Piggyback on a donor event to simulate a different one
	// Used only for `focus(in | out)` events
	simulate: function( type, elem, event ) {
		var e = jQuery.extend(
			new jQuery.Event(),
			event,
			{
				type: type,
				isSimulated: true
			}
		);

		jQuery.event.trigger( e, null, elem );
	}

} );

jQuery.fn.extend( {

	trigger: function( type, data ) {
		return this.each( function() {
			jQuery.event.trigger( type, data, this );
		} );
	},
	triggerHandler: function( type, data ) {
		var elem = this[ 0 ];
		if ( elem ) {
			return jQuery.event.trigger( type, data, elem, true );
		}
	}
} );


var
	rbracket = /\[\]$/,
	rCRLF = /\r?\n/g,
	rsubmitterTypes = /^(?:submit|button|image|reset|file)$/i,
	rsubmittable = /^(?:input|select|textarea|keygen)/i;

function buildParams( prefix, obj, traditional, add ) {
	var name;

	if ( Array.isArray( obj ) ) {

		// Serialize array item.
		jQuery.each( obj, function( i, v ) {
			if ( traditional || rbracket.test( prefix ) ) {

				// Treat each array item as a scalar.
				add( prefix, v );

			} else {

				// Item is non-scalar (array or object), encode its numeric index.
				buildParams(
					prefix + "[" + ( typeof v === "object" && v != null ? i : "" ) + "]",
					v,
					traditional,
					add
				);
			}
		} );

	} else if ( !traditional && toType( obj ) === "object" ) {

		// Serialize object item.
		for ( name in obj ) {
			buildParams( prefix + "[" + name + "]", obj[ name ], traditional, add );
		}

	} else {

		// Serialize scalar item.
		add( prefix, obj );
	}
}

// Serialize an array of form elements or a set of
// key/values into a query string
jQuery.param = function( a, traditional ) {
	var prefix,
		s = [],
		add = function( key, valueOrFunction ) {

			// If value is a function, invoke it and use its return value
			var value = isFunction( valueOrFunction ) ?
				valueOrFunction() :
				valueOrFunction;

			s[ s.length ] = encodeURIComponent( key ) + "=" +
				encodeURIComponent( value == null ? "" : value );
		};

	if ( a == null ) {
		return "";
	}

	// If an array was passed in, assume that it is an array of form elements.
	if ( Array.isArray( a ) || ( a.jquery && !jQuery.isPlainObject( a ) ) ) {

		// Serialize the form elements
		jQuery.each( a, function() {
			add( this.name, this.value );
		} );

	} else {

		// If traditional, encode the "old" way (the way 1.3.2 or older
		// did it), otherwise encode params recursively.
		for ( prefix in a ) {
			buildParams( prefix, a[ prefix ], traditional, add );
		}
	}

	// Return the resulting serialization
	return s.join( "&" );
};

jQuery.fn.extend( {
	serialize: function() {
		return jQuery.param( this.serializeArray() );
	},
	serializeArray: function() {
		return this.map( function() {

			// Can add propHook for "elements" to filter or add form elements
			var elements = jQuery.prop( this, "elements" );
			return elements ? jQuery.makeArray( elements ) : this;
		} ).filter( function() {
			var type = this.type;

			// Use .is( ":disabled" ) so that fieldset[disabled] works
			return this.name && !jQuery( this ).is( ":disabled" ) &&
				rsubmittable.test( this.nodeName ) && !rsubmitterTypes.test( type ) &&
				( this.checked || !rcheckableType.test( type ) );
		} ).map( function( _i, elem ) {
			var val = jQuery( this ).val();

			if ( val == null ) {
				return null;
			}

			if ( Array.isArray( val ) ) {
				return jQuery.map( val, function( val ) {
					return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
				} );
			}

			return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
		} ).get();
	}
} );


var
	r20 = /%20/g,
	rhash = /#.*$/,
	rantiCache = /([?&])_=[^&]*/,
	rheaders = /^(.*?):[ \t]*([^\r\n]*)$/mg,

	// trac-7653, trac-8125, trac-8152: local protocol detection
	rlocalProtocol = /^(?:about|app|app-storage|.+-extension|file|res|widget):$/,
	rnoContent = /^(?:GET|HEAD)$/,
	rprotocol = /^\/\//,

	/* Prefilters
	 * 1) They are useful to introduce custom dataTypes (see ajax/jsonp.js for an example)
	 * 2) These are called:
	 *    - BEFORE asking for a transport
	 *    - AFTER param serialization (s.data is a string if s.processData is true)
	 * 3) key is the dataType
	 * 4) the catchall symbol "*" can be used
	 * 5) execution will start with transport dataType and THEN continue down to "*" if needed
	 */
	prefilters = {},

	/* Transports bindings
	 * 1) key is the dataType
	 * 2) the catchall symbol "*" can be used
	 * 3) selection will start with transport dataType and THEN go to "*" if needed
	 */
	transports = {},

	// Avoid comment-prolog char sequence (trac-10098); must appease lint and evade compression
	allTypes = "*/".concat( "*" ),

	// Anchor tag for parsing the document origin
	originAnchor = document.createElement( "a" );

originAnchor.href = location.href;

// Base "constructor" for jQuery.ajaxPrefilter and jQuery.ajaxTransport
function addToPrefiltersOrTransports( structure ) {

	// dataTypeExpression is optional and defaults to "*"
	return function( dataTypeExpression, func ) {

		if ( typeof dataTypeExpression !== "string" ) {
			func = dataTypeExpression;
			dataTypeExpression = "*";
		}

		var dataType,
			i = 0,
			dataTypes = dataTypeExpression.toLowerCase().match( rnothtmlwhite ) || [];

		if ( isFunction( func ) ) {

			// For each dataType in the dataTypeExpression
			while ( ( dataType = dataTypes[ i++ ] ) ) {

				// Prepend if requested
				if ( dataType[ 0 ] === "+" ) {
					dataType = dataType.slice( 1 ) || "*";
					( structure[ dataType ] = structure[ dataType ] || [] ).unshift( func );

				// Otherwise append
				} else {
					( structure[ dataType ] = structure[ dataType ] || [] ).push( func );
				}
			}
		}
	};
}

// Base inspection function for prefilters and transports
function inspectPrefiltersOrTransports( structure, options, originalOptions, jqXHR ) {

	var inspected = {},
		seekingTransport = ( structure === transports );

	function inspect( dataType ) {
		var selected;
		inspected[ dataType ] = true;
		jQuery.each( structure[ dataType ] || [], function( _, prefilterOrFactory ) {
			var dataTypeOrTransport = prefilterOrFactory( options, originalOptions, jqXHR );
			if ( typeof dataTypeOrTransport === "string" &&
				!seekingTransport && !inspected[ dataTypeOrTransport ] ) {

				options.dataTypes.unshift( dataTypeOrTransport );
				inspect( dataTypeOrTransport );
				return false;
			} else if ( seekingTransport ) {
				return !( selected = dataTypeOrTransport );
			}
		} );
		return selected;
	}

	return inspect( options.dataTypes[ 0 ] ) || !inspected[ "*" ] && inspect( "*" );
}

// A special extend for ajax options
// that takes "flat" options (not to be deep extended)
// Fixes trac-9887
function ajaxExtend( target, src ) {
	var key, deep,
		flatOptions = jQuery.ajaxSettings.flatOptions || {};

	for ( key in src ) {
		if ( src[ key ] !== undefined ) {
			( flatOptions[ key ] ? target : ( deep || ( deep = {} ) ) )[ key ] = src[ key ];
		}
	}
	if ( deep ) {
		jQuery.extend( true, target, deep );
	}

	return target;
}

/* Handles responses to an ajax request:
 * - finds the right dataType (mediates between content-type and expected dataType)
 * - returns the corresponding response
 */
function ajaxHandleResponses( s, jqXHR, responses ) {

	var ct, type, finalDataType, firstDataType,
		contents = s.contents,
		dataTypes = s.dataTypes;

	// Remove auto dataType and get content-type in the process
	while ( dataTypes[ 0 ] === "*" ) {
		dataTypes.shift();
		if ( ct === undefined ) {
			ct = s.mimeType || jqXHR.getResponseHeader( "Content-Type" );
		}
	}

	// Check if we're dealing with a known content-type
	if ( ct ) {
		for ( type in contents ) {
			if ( contents[ type ] && contents[ type ].test( ct ) ) {
				dataTypes.unshift( type );
				break;
			}
		}
	}

	// Check to see if we have a response for the expected dataType
	if ( dataTypes[ 0 ] in responses ) {
		finalDataType = dataTypes[ 0 ];
	} else {

		// Try convertible dataTypes
		for ( type in responses ) {
			if ( !dataTypes[ 0 ] || s.converters[ type + " " + dataTypes[ 0 ] ] ) {
				finalDataType = type;
				break;
			}
			if ( !firstDataType ) {
				firstDataType = type;
			}
		}

		// Or just use first one
		finalDataType = finalDataType || firstDataType;
	}

	// If we found a dataType
	// We add the dataType to the list if needed
	// and return the corresponding response
	if ( finalDataType ) {
		if ( finalDataType !== dataTypes[ 0 ] ) {
			dataTypes.unshift( finalDataType );
		}
		return responses[ finalDataType ];
	}
}

/* Chain conversions given the request and the original response
 * Also sets the responseXXX fields on the jqXHR instance
 */
function ajaxConvert( s, response, jqXHR, isSuccess ) {
	var conv2, current, conv, tmp, prev,
		converters = {},

		// Work with a copy of dataTypes in case we need to modify it for conversion
		dataTypes = s.dataTypes.slice();

	// Create converters map with lowercased keys
	if ( dataTypes[ 1 ] ) {
		for ( conv in s.converters ) {
			converters[ conv.toLowerCase() ] = s.converters[ conv ];
		}
	}

	current = dataTypes.shift();

	// Convert to each sequential dataType
	while ( current ) {

		if ( s.responseFields[ current ] ) {
			jqXHR[ s.responseFields[ current ] ] = response;
		}

		// Apply the dataFilter if provided
		if ( !prev && isSuccess && s.dataFilter ) {
			response = s.dataFilter( response, s.dataType );
		}

		prev = current;
		current = dataTypes.shift();

		if ( current ) {

			// There's only work to do if current dataType is non-auto
			if ( current === "*" ) {

				current = prev;

			// Convert response if prev dataType is non-auto and differs from current
			} else if ( prev !== "*" && prev !== current ) {

				// Seek a direct converter
				conv = converters[ prev + " " + current ] || converters[ "* " + current ];

				// If none found, seek a pair
				if ( !conv ) {
					for ( conv2 in converters ) {

						// If conv2 outputs current
						tmp = conv2.split( " " );
						if ( tmp[ 1 ] === current ) {

							// If prev can be converted to accepted input
							conv = converters[ prev + " " + tmp[ 0 ] ] ||
								converters[ "* " + tmp[ 0 ] ];
							if ( conv ) {

								// Condense equivalence converters
								if ( conv === true ) {
									conv = converters[ conv2 ];

								// Otherwise, insert the intermediate dataType
								} else if ( converters[ conv2 ] !== true ) {
									current = tmp[ 0 ];
									dataTypes.unshift( tmp[ 1 ] );
								}
								break;
							}
						}
					}
				}

				// Apply converter (if not an equivalence)
				if ( conv !== true ) {

					// Unless errors are allowed to bubble, catch and return them
					if ( conv && s.throws ) {
						response = conv( response );
					} else {
						try {
							response = conv( response );
						} catch ( e ) {
							return {
								state: "parsererror",
								error: conv ? e : "No conversion from " + prev + " to " + current
							};
						}
					}
				}
			}
		}
	}

	return { state: "success", data: response };
}

jQuery.extend( {

	// Counter for holding the number of active queries
	active: 0,

	// Last-Modified header cache for next request
	lastModified: {},
	etag: {},

	ajaxSettings: {
		url: location.href,
		type: "GET",
		isLocal: rlocalProtocol.test( location.protocol ),
		global: true,
		processData: true,
		async: true,
		contentType: "application/x-www-form-urlencoded; charset=UTF-8",

		/*
		timeout: 0,
		data: null,
		dataType: null,
		username: null,
		password: null,
		cache: null,
		throws: false,
		traditional: false,
		headers: {},
		*/

		accepts: {
			"*": allTypes,
			text: "text/plain",
			html: "text/html",
			xml: "application/xml, text/xml",
			json: "application/json, text/javascript"
		},

		contents: {
			xml: /\bxml\b/,
			html: /\bhtml/,
			json: /\bjson\b/
		},

		responseFields: {
			xml: "responseXML",
			text: "responseText",
			json: "responseJSON"
		},

		// Data converters
		// Keys separate source (or catchall "*") and destination types with a single space
		converters: {

			// Convert anything to text
			"* text": String,

			// Text to html (true = no transformation)
			"text html": true,

			// Evaluate text as a json expression
			"text json": JSON.parse,

			// Parse text as xml
			"text xml": jQuery.parseXML
		},

		// For options that shouldn't be deep extended:
		// you can add your own custom options here if
		// and when you create one that shouldn't be
		// deep extended (see ajaxExtend)
		flatOptions: {
			url: true,
			context: true
		}
	},

	// Creates a full fledged settings object into target
	// with both ajaxSettings and settings fields.
	// If target is omitted, writes into ajaxSettings.
	ajaxSetup: function( target, settings ) {
		return settings ?

			// Building a settings object
			ajaxExtend( ajaxExtend( target, jQuery.ajaxSettings ), settings ) :

			// Extending ajaxSettings
			ajaxExtend( jQuery.ajaxSettings, target );
	},

	ajaxPrefilter: addToPrefiltersOrTransports( prefilters ),
	ajaxTransport: addToPrefiltersOrTransports( transports ),

	// Main method
	ajax: function( url, options ) {

		// If url is an object, simulate pre-1.5 signature
		if ( typeof url === "object" ) {
			options = url;
			url = undefined;
		}

		// Force options to be an object
		options = options || {};

		var transport,

			// URL without anti-cache param
			cacheURL,

			// Response headers
			responseHeadersString,
			responseHeaders,

			// timeout handle
			timeoutTimer,

			// Url cleanup var
			urlAnchor,

			// Request state (becomes false upon send and true upon completion)
			completed,

			// To know if global events are to be dispatched
			fireGlobals,

			// Loop variable
			i,

			// uncached part of the url
			uncached,

			// Create the final options object
			s = jQuery.ajaxSetup( {}, options ),

			// Callbacks context
			callbackContext = s.context || s,

			// Context for global events is callbackContext if it is a DOM node or jQuery collection
			globalEventContext = s.context &&
				( callbackContext.nodeType || callbackContext.jquery ) ?
				jQuery( callbackContext ) :
				jQuery.event,

			// Deferreds
			deferred = jQuery.Deferred(),
			completeDeferred = jQuery.Callbacks( "once memory" ),

			// Status-dependent callbacks
			statusCode = s.statusCode || {},

			// Headers (they are sent all at once)
			requestHeaders = {},
			requestHeadersNames = {},

			// Default abort message
			strAbort = "canceled",

			// Fake xhr
			jqXHR = {
				readyState: 0,

				// Builds headers hashtable if needed
				getResponseHeader: function( key ) {
					var match;
					if ( completed ) {
						if ( !responseHeaders ) {
							responseHeaders = {};
							while ( ( match = rheaders.exec( responseHeadersString ) ) ) {
								responseHeaders[ match[ 1 ].toLowerCase() + " " ] =
									( responseHeaders[ match[ 1 ].toLowerCase() + " " ] || [] )
										.concat( match[ 2 ] );
							}
						}
						match = responseHeaders[ key.toLowerCase() + " " ];
					}
					return match == null ? null : match.join( ", " );
				},

				// Raw string
				getAllResponseHeaders: function() {
					return completed ? responseHeadersString : null;
				},

				// Caches the header
				setRequestHeader: function( name, value ) {
					if ( completed == null ) {
						name = requestHeadersNames[ name.toLowerCase() ] =
							requestHeadersNames[ name.toLowerCase() ] || name;
						requestHeaders[ name ] = value;
					}
					return this;
				},

				// Overrides response content-type header
				overrideMimeType: function( type ) {
					if ( completed == null ) {
						s.mimeType = type;
					}
					return this;
				},

				// Status-dependent callbacks
				statusCode: function( map ) {
					var code;
					if ( map ) {
						if ( completed ) {

							// Execute the appropriate callbacks
							jqXHR.always( map[ jqXHR.status ] );
						} else {

							// Lazy-add the new callbacks in a way that preserves old ones
							for ( code in map ) {
								statusCode[ code ] = [ statusCode[ code ], map[ code ] ];
							}
						}
					}
					return this;
				},

				// Cancel the request
				abort: function( statusText ) {
					var finalText = statusText || strAbort;
					if ( transport ) {
						transport.abort( finalText );
					}
					done( 0, finalText );
					return this;
				}
			};

		// Attach deferreds
		deferred.promise( jqXHR );

		// Add protocol if not provided (prefilters might expect it)
		// Handle falsy url in the settings object (trac-10093: consistency with old signature)
		// We also use the url parameter if available
		s.url = ( ( url || s.url || location.href ) + "" )
			.replace( rprotocol, location.protocol + "//" );

		// Alias method option to type as per ticket trac-12004
		s.type = options.method || options.type || s.method || s.type;

		// Extract dataTypes list
		s.dataTypes = ( s.dataType || "*" ).toLowerCase().match( rnothtmlwhite ) || [ "" ];

		// A cross-domain request is in order when the origin doesn't match the current origin.
		if ( s.crossDomain == null ) {
			urlAnchor = document.createElement( "a" );

			// Support: IE <=8 - 11, Edge 12 - 15
			// IE throws exception on accessing the href property if url is malformed,
			// e.g. http://example.com:80x/
			try {
				urlAnchor.href = s.url;

				// Support: IE <=8 - 11 only
				// Anchor's host property isn't correctly set when s.url is relative
				urlAnchor.href = urlAnchor.href;
				s.crossDomain = originAnchor.protocol + "//" + originAnchor.host !==
					urlAnchor.protocol + "//" + urlAnchor.host;
			} catch ( e ) {

				// If there is an error parsing the URL, assume it is crossDomain,
				// it can be rejected by the transport if it is invalid
				s.crossDomain = true;
			}
		}

		// Convert data if not already a string
		if ( s.data && s.processData && typeof s.data !== "string" ) {
			s.data = jQuery.param( s.data, s.traditional );
		}

		// Apply prefilters
		inspectPrefiltersOrTransports( prefilters, s, options, jqXHR );

		// If request was aborted inside a prefilter, stop there
		if ( completed ) {
			return jqXHR;
		}

		// We can fire global events as of now if asked to
		// Don't fire events if jQuery.event is undefined in an AMD-usage scenario (trac-15118)
		fireGlobals = jQuery.event && s.global;

		// Watch for a new set of requests
		if ( fireGlobals && jQuery.active++ === 0 ) {
			jQuery.event.trigger( "ajaxStart" );
		}

		// Uppercase the type
		s.type = s.type.toUpperCase();

		// Determine if request has content
		s.hasContent = !rnoContent.test( s.type );

		// Save the URL in case we're toying with the If-Modified-Since
		// and/or If-None-Match header later on
		// Remove hash to simplify url manipulation
		cacheURL = s.url.replace( rhash, "" );

		// More options handling for requests with no content
		if ( !s.hasContent ) {

			// Remember the hash so we can put it back
			uncached = s.url.slice( cacheURL.length );

			// If data is available and should be processed, append data to url
			if ( s.data && ( s.processData || typeof s.data === "string" ) ) {
				cacheURL += ( rquery.test( cacheURL ) ? "&" : "?" ) + s.data;

				// trac-9682: remove data so that it's not used in an eventual retry
				delete s.data;
			}

			// Add or update anti-cache param if needed
			if ( s.cache === false ) {
				cacheURL = cacheURL.replace( rantiCache, "$1" );
				uncached = ( rquery.test( cacheURL ) ? "&" : "?" ) + "_=" + ( nonce.guid++ ) +
					uncached;
			}

			// Put hash and anti-cache on the URL that will be requested (gh-1732)
			s.url = cacheURL + uncached;

		// Change '%20' to '+' if this is encoded form body content (gh-2658)
		} else if ( s.data && s.processData &&
			( s.contentType || "" ).indexOf( "application/x-www-form-urlencoded" ) === 0 ) {
			s.data = s.data.replace( r20, "+" );
		}

		// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
		if ( s.ifModified ) {
			if ( jQuery.lastModified[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-Modified-Since", jQuery.lastModified[ cacheURL ] );
			}
			if ( jQuery.etag[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-None-Match", jQuery.etag[ cacheURL ] );
			}
		}

		// Set the correct header, if data is being sent
		if ( s.data && s.hasContent && s.contentType !== false || options.contentType ) {
			jqXHR.setRequestHeader( "Content-Type", s.contentType );
		}

		// Set the Accepts header for the server, depending on the dataType
		jqXHR.setRequestHeader(
			"Accept",
			s.dataTypes[ 0 ] && s.accepts[ s.dataTypes[ 0 ] ] ?
				s.accepts[ s.dataTypes[ 0 ] ] +
					( s.dataTypes[ 0 ] !== "*" ? ", " + allTypes + "; q=0.01" : "" ) :
				s.accepts[ "*" ]
		);

		// Check for headers option
		for ( i in s.headers ) {
			jqXHR.setRequestHeader( i, s.headers[ i ] );
		}

		// Allow custom headers/mimetypes and early abort
		if ( s.beforeSend &&
			( s.beforeSend.call( callbackContext, jqXHR, s ) === false || completed ) ) {

			// Abort if not done already and return
			return jqXHR.abort();
		}

		// Aborting is no longer a cancellation
		strAbort = "abort";

		// Install callbacks on deferreds
		completeDeferred.add( s.complete );
		jqXHR.done( s.success );
		jqXHR.fail( s.error );

		// Get transport
		transport = inspectPrefiltersOrTransports( transports, s, options, jqXHR );

		// If no transport, we auto-abort
		if ( !transport ) {
			done( -1, "No Transport" );
		} else {
			jqXHR.readyState = 1;

			// Send global event
			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxSend", [ jqXHR, s ] );
			}

			// If request was aborted inside ajaxSend, stop there
			if ( completed ) {
				return jqXHR;
			}

			// Timeout
			if ( s.async && s.timeout > 0 ) {
				timeoutTimer = window.setTimeout( function() {
					jqXHR.abort( "timeout" );
				}, s.timeout );
			}

			try {
				completed = false;
				transport.send( requestHeaders, done );
			} catch ( e ) {

				// Rethrow post-completion exceptions
				if ( completed ) {
					throw e;
				}

				// Propagate others as results
				done( -1, e );
			}
		}

		// Callback for when everything is done
		function done( status, nativeStatusText, responses, headers ) {
			var isSuccess, success, error, response, modified,
				statusText = nativeStatusText;

			// Ignore repeat invocations
			if ( completed ) {
				return;
			}

			completed = true;

			// Clear timeout if it exists
			if ( timeoutTimer ) {
				window.clearTimeout( timeoutTimer );
			}

			// Dereference transport for early garbage collection
			// (no matter how long the jqXHR object will be used)
			transport = undefined;

			// Cache response headers
			responseHeadersString = headers || "";

			// Set readyState
			jqXHR.readyState = status > 0 ? 4 : 0;

			// Determine if successful
			isSuccess = status >= 200 && status < 300 || status === 304;

			// Get response data
			if ( responses ) {
				response = ajaxHandleResponses( s, jqXHR, responses );
			}

			// Use a noop converter for missing script but not if jsonp
			if ( !isSuccess &&
				jQuery.inArray( "script", s.dataTypes ) > -1 &&
				jQuery.inArray( "json", s.dataTypes ) < 0 ) {
				s.converters[ "text script" ] = function() {};
			}

			// Convert no matter what (that way responseXXX fields are always set)
			response = ajaxConvert( s, response, jqXHR, isSuccess );

			// If successful, handle type chaining
			if ( isSuccess ) {

				// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
				if ( s.ifModified ) {
					modified = jqXHR.getResponseHeader( "Last-Modified" );
					if ( modified ) {
						jQuery.lastModified[ cacheURL ] = modified;
					}
					modified = jqXHR.getResponseHeader( "etag" );
					if ( modified ) {
						jQuery.etag[ cacheURL ] = modified;
					}
				}

				// if no content
				if ( status === 204 || s.type === "HEAD" ) {
					statusText = "nocontent";

				// if not modified
				} else if ( status === 304 ) {
					statusText = "notmodified";

				// If we have data, let's convert it
				} else {
					statusText = response.state;
					success = response.data;
					error = response.error;
					isSuccess = !error;
				}
			} else {

				// Extract error from statusText and normalize for non-aborts
				error = statusText;
				if ( status || !statusText ) {
					statusText = "error";
					if ( status < 0 ) {
						status = 0;
					}
				}
			}

			// Set data for the fake xhr object
			jqXHR.status = status;
			jqXHR.statusText = ( nativeStatusText || statusText ) + "";

			// Success/Error
			if ( isSuccess ) {
				deferred.resolveWith( callbackContext, [ success, statusText, jqXHR ] );
			} else {
				deferred.rejectWith( callbackContext, [ jqXHR, statusText, error ] );
			}

			// Status-dependent callbacks
			jqXHR.statusCode( statusCode );
			statusCode = undefined;

			if ( fireGlobals ) {
				globalEventContext.trigger( isSuccess ? "ajaxSuccess" : "ajaxError",
					[ jqXHR, s, isSuccess ? success : error ] );
			}

			// Complete
			completeDeferred.fireWith( callbackContext, [ jqXHR, statusText ] );

			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxComplete", [ jqXHR, s ] );

				// Handle the global AJAX counter
				if ( !( --jQuery.active ) ) {
					jQuery.event.trigger( "ajaxStop" );
				}
			}
		}

		return jqXHR;
	},

	getJSON: function( url, data, callback ) {
		return jQuery.get( url, data, callback, "json" );
	},

	getScript: function( url, callback ) {
		return jQuery.get( url, undefined, callback, "script" );
	}
} );

jQuery.each( [ "get", "post" ], function( _i, method ) {
	jQuery[ method ] = function( url, data, callback, type ) {

		// Shift arguments if data argument was omitted
		if ( isFunction( data ) ) {
			type = type || callback;
			callback = data;
			data = undefined;
		}

		// The url can be an options object (which then must have .url)
		return jQuery.ajax( jQuery.extend( {
			url: url,
			type: method,
			dataType: type,
			data: data,
			success: callback
		}, jQuery.isPlainObject( url ) && url ) );
	};
} );

jQuery.ajaxPrefilter( function( s ) {
	var i;
	for ( i in s.headers ) {
		if ( i.toLowerCase() === "content-type" ) {
			s.contentType = s.headers[ i ] || "";
		}
	}
} );


jQuery._evalUrl = function( url, options, doc ) {
	return jQuery.ajax( {
		url: url,

		// Make this explicit, since user can override this through ajaxSetup (trac-11264)
		type: "GET",
		dataType: "script",
		cache: true,
		async: false,
		global: false,

		// Only evaluate the response if it is successful (gh-4126)
		// dataFilter is not invoked for failure responses, so using it instead
		// of the default converter is kludgy but it works.
		converters: {
			"text script": function() {}
		},
		dataFilter: function( response ) {
			jQuery.globalEval( response, options, doc );
		}
	} );
};


jQuery.fn.extend( {
	wrapAll: function( html ) {
		var wrap;

		if ( this[ 0 ] ) {
			if ( isFunction( html ) ) {
				html = html.call( this[ 0 ] );
			}

			// The elements to wrap the target around
			wrap = jQuery( html, this[ 0 ].ownerDocument ).eq( 0 ).clone( true );

			if ( this[ 0 ].parentNode ) {
				wrap.insertBefore( this[ 0 ] );
			}

			wrap.map( function() {
				var elem = this;

				while ( elem.firstElementChild ) {
					elem = elem.firstElementChild;
				}

				return elem;
			} ).append( this );
		}

		return this;
	},

	wrapInner: function( html ) {
		if ( isFunction( html ) ) {
			return this.each( function( i ) {
				jQuery( this ).wrapInner( html.call( this, i ) );
			} );
		}

		return this.each( function() {
			var self = jQuery( this ),
				contents = self.contents();

			if ( contents.length ) {
				contents.wrapAll( html );

			} else {
				self.append( html );
			}
		} );
	},

	wrap: function( html ) {
		var htmlIsFunction = isFunction( html );

		return this.each( function( i ) {
			jQuery( this ).wrapAll( htmlIsFunction ? html.call( this, i ) : html );
		} );
	},

	unwrap: function( selector ) {
		this.parent( selector ).not( "body" ).each( function() {
			jQuery( this ).replaceWith( this.childNodes );
		} );
		return this;
	}
} );


jQuery.expr.pseudos.hidden = function( elem ) {
	return !jQuery.expr.pseudos.visible( elem );
};
jQuery.expr.pseudos.visible = function( elem ) {
	return !!( elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length );
};




jQuery.ajaxSettings.xhr = function() {
	try {
		return new window.XMLHttpRequest();
	} catch ( e ) {}
};

var xhrSuccessStatus = {

		// File protocol always yields status code 0, assume 200
		0: 200,

		// Support: IE <=9 only
		// trac-1450: sometimes IE returns 1223 when it should be 204
		1223: 204
	},
	xhrSupported = jQuery.ajaxSettings.xhr();

support.cors = !!xhrSupported && ( "withCredentials" in xhrSupported );
support.ajax = xhrSupported = !!xhrSupported;

jQuery.ajaxTransport( function( options ) {
	var callback, errorCallback;

	// Cross domain only allowed if supported through XMLHttpRequest
	if ( support.cors || xhrSupported && !options.crossDomain ) {
		return {
			send: function( headers, complete ) {
				var i,
					xhr = options.xhr();

				xhr.open(
					options.type,
					options.url,
					options.async,
					options.username,
					options.password
				);

				// Apply custom fields if provided
				if ( options.xhrFields ) {
					for ( i in options.xhrFields ) {
						xhr[ i ] = options.xhrFields[ i ];
					}
				}

				// Override mime type if needed
				if ( options.mimeType && xhr.overrideMimeType ) {
					xhr.overrideMimeType( options.mimeType );
				}

				// X-Requested-With header
				// For cross-domain requests, seeing as conditions for a preflight are
				// akin to a jigsaw puzzle, we simply never set it to be sure.
				// (it can always be set on a per-request basis or even using ajaxSetup)
				// For same-domain requests, won't change header if already provided.
				if ( !options.crossDomain && !headers[ "X-Requested-With" ] ) {
					headers[ "X-Requested-With" ] = "XMLHttpRequest";
				}

				// Set headers
				for ( i in headers ) {
					xhr.setRequestHeader( i, headers[ i ] );
				}

				// Callback
				callback = function( type ) {
					return function() {
						if ( callback ) {
							callback = errorCallback = xhr.onload =
								xhr.onerror = xhr.onabort = xhr.ontimeout =
									xhr.onreadystatechange = null;

							if ( type === "abort" ) {
								xhr.abort();
							} else if ( type === "error" ) {

								// Support: IE <=9 only
								// On a manual native abort, IE9 throws
								// errors on any property access that is not readyState
								if ( typeof xhr.status !== "number" ) {
									complete( 0, "error" );
								} else {
									complete(

										// File: protocol always yields status 0; see trac-8605, trac-14207
										xhr.status,
										xhr.statusText
									);
								}
							} else {
								complete(
									xhrSuccessStatus[ xhr.status ] || xhr.status,
									xhr.statusText,

									// Support: IE <=9 only
									// IE9 has no XHR2 but throws on binary (trac-11426)
									// For XHR2 non-text, let the caller handle it (gh-2498)
									( xhr.responseType || "text" ) !== "text"  ||
									typeof xhr.responseText !== "string" ?
										{ binary: xhr.response } :
										{ text: xhr.responseText },
									xhr.getAllResponseHeaders()
								);
							}
						}
					};
				};

				// Listen to events
				xhr.onload = callback();
				errorCallback = xhr.onerror = xhr.ontimeout = callback( "error" );

				// Support: IE 9 only
				// Use onreadystatechange to replace onabort
				// to handle uncaught aborts
				if ( xhr.onabort !== undefined ) {
					xhr.onabort = errorCallback;
				} else {
					xhr.onreadystatechange = function() {

						// Check readyState before timeout as it changes
						if ( xhr.readyState === 4 ) {

							// Allow onerror to be called first,
							// but that will not handle a native abort
							// Also, save errorCallback to a variable
							// as xhr.onerror cannot be accessed
							window.setTimeout( function() {
								if ( callback ) {
									errorCallback();
								}
							} );
						}
					};
				}

				// Create the abort callback
				callback = callback( "abort" );

				try {

					// Do send the request (this may raise an exception)
					xhr.send( options.hasContent && options.data || null );
				} catch ( e ) {

					// trac-14683: Only rethrow if this hasn't been notified as an error yet
					if ( callback ) {
						throw e;
					}
				}
			},

			abort: function() {
				if ( callback ) {
					callback();
				}
			}
		};
	}
} );




// Prevent auto-execution of scripts when no explicit dataType was provided (See gh-2432)
jQuery.ajaxPrefilter( function( s ) {
	if ( s.crossDomain ) {
		s.contents.script = false;
	}
} );

// Install script dataType
jQuery.ajaxSetup( {
	accepts: {
		script: "text/javascript, application/javascript, " +
			"application/ecmascript, application/x-ecmascript"
	},
	contents: {
		script: /\b(?:java|ecma)script\b/
	},
	converters: {
		"text script": function( text ) {
			jQuery.globalEval( text );
			return text;
		}
	}
} );

// Handle cache's special case and crossDomain
jQuery.ajaxPrefilter( "script", function( s ) {
	if ( s.cache === undefined ) {
		s.cache = false;
	}
	if ( s.crossDomain ) {
		s.type = "GET";
	}
} );

// Bind script tag hack transport
jQuery.ajaxTransport( "script", function( s ) {

	// This transport only deals with cross domain or forced-by-attrs requests
	if ( s.crossDomain || s.scriptAttrs ) {
		var script, callback;
		return {
			send: function( _, complete ) {
				script = jQuery( "<script>" )
					.attr( s.scriptAttrs || {} )
					.prop( { charset: s.scriptCharset, src: s.url } )
					.on( "load error", callback = function( evt ) {
						script.remove();
						callback = null;
						if ( evt ) {
							complete( evt.type === "error" ? 404 : 200, evt.type );
						}
					} );

				// Use native DOM manipulation to avoid our domManip AJAX trickery
				document.head.appendChild( script[ 0 ] );
			},
			abort: function() {
				if ( callback ) {
					callback();
				}
			}
		};
	}
} );




var oldCallbacks = [],
	rjsonp = /(=)\?(?=&|$)|\?\?/;

// Default jsonp settings
jQuery.ajaxSetup( {
	jsonp: "callback",
	jsonpCallback: function() {
		var callback = oldCallbacks.pop() || ( jQuery.expando + "_" + ( nonce.guid++ ) );
		this[ callback ] = true;
		return callback;
	}
} );

// Detect, normalize options and install callbacks for jsonp requests
jQuery.ajaxPrefilter( "json jsonp", function( s, originalSettings, jqXHR ) {

	var callbackName, overwritten, responseContainer,
		jsonProp = s.jsonp !== false && ( rjsonp.test( s.url ) ?
			"url" :
			typeof s.data === "string" &&
				( s.contentType || "" )
					.indexOf( "application/x-www-form-urlencoded" ) === 0 &&
				rjsonp.test( s.data ) && "data"
		);

	// Handle iff the expected data type is "jsonp" or we have a parameter to set
	if ( jsonProp || s.dataTypes[ 0 ] === "jsonp" ) {

		// Get callback name, remembering preexisting value associated with it
		callbackName = s.jsonpCallback = isFunction( s.jsonpCallback ) ?
			s.jsonpCallback() :
			s.jsonpCallback;

		// Insert callback into url or form data
		if ( jsonProp ) {
			s[ jsonProp ] = s[ jsonProp ].replace( rjsonp, "$1" + callbackName );
		} else if ( s.jsonp !== false ) {
			s.url += ( rquery.test( s.url ) ? "&" : "?" ) + s.jsonp + "=" + callbackName;
		}

		// Use data converter to retrieve json after script execution
		s.converters[ "script json" ] = function() {
			if ( !responseContainer ) {
				jQuery.error( callbackName + " was not called" );
			}
			return responseContainer[ 0 ];
		};

		// Force json dataType
		s.dataTypes[ 0 ] = "json";

		// Install callback
		overwritten = window[ callbackName ];
		window[ callbackName ] = function() {
			responseContainer = arguments;
		};

		// Clean-up function (fires after converters)
		jqXHR.always( function() {

			// If previous value didn't exist - remove it
			if ( overwritten === undefined ) {
				jQuery( window ).removeProp( callbackName );

			// Otherwise restore preexisting value
			} else {
				window[ callbackName ] = overwritten;
			}

			// Save back as free
			if ( s[ callbackName ] ) {

				// Make sure that re-using the options doesn't screw things around
				s.jsonpCallback = originalSettings.jsonpCallback;

				// Save the callback name for future use
				oldCallbacks.push( callbackName );
			}

			// Call if it was a function and we have a response
			if ( responseContainer && isFunction( overwritten ) ) {
				overwritten( responseContainer[ 0 ] );
			}

			responseContainer = overwritten = undefined;
		} );

		// Delegate to script
		return "script";
	}
} );




// Support: Safari 8 only
// In Safari 8 documents created via document.implementation.createHTMLDocument
// collapse sibling forms: the second one becomes a child of the first one.
// Because of that, this security measure has to be disabled in Safari 8.
// https://bugs.webkit.org/show_bug.cgi?id=137337
support.createHTMLDocument = ( function() {
	var body = document.implementation.createHTMLDocument( "" ).body;
	body.innerHTML = "<form></form><form></form>";
	return body.childNodes.length === 2;
} )();


// Argument "data" should be string of html
// context (optional): If specified, the fragment will be created in this context,
// defaults to document
// keepScripts (optional): If true, will include scripts passed in the html string
jQuery.parseHTML = function( data, context, keepScripts ) {
	if ( typeof data !== "string" ) {
		return [];
	}
	if ( typeof context === "boolean" ) {
		keepScripts = context;
		context = false;
	}

	var base, parsed, scripts;

	if ( !context ) {

		// Stop scripts or inline event handlers from being executed immediately
		// by using document.implementation
		if ( support.createHTMLDocument ) {
			context = document.implementation.createHTMLDocument( "" );

			// Set the base href for the created document
			// so any parsed elements with URLs
			// are based on the document's URL (gh-2965)
			base = context.createElement( "base" );
			base.href = document.location.href;
			context.head.appendChild( base );
		} else {
			context = document;
		}
	}

	parsed = rsingleTag.exec( data );
	scripts = !keepScripts && [];

	// Single tag
	if ( parsed ) {
		return [ context.createElement( parsed[ 1 ] ) ];
	}

	parsed = buildFragment( [ data ], context, scripts );

	if ( scripts && scripts.length ) {
		jQuery( scripts ).remove();
	}

	return jQuery.merge( [], parsed.childNodes );
};


/**
 * Load a url into a page
 */
jQuery.fn.load = function( url, params, callback ) {
	var selector, type, response,
		self = this,
		off = url.indexOf( " " );

	if ( off > -1 ) {
		selector = stripAndCollapse( url.slice( off ) );
		url = url.slice( 0, off );
	}

	// If it's a function
	if ( isFunction( params ) ) {

		// We assume that it's the callback
		callback = params;
		params = undefined;

	// Otherwise, build a param string
	} else if ( params && typeof params === "object" ) {
		type = "POST";
	}

	// If we have elements to modify, make the request
	if ( self.length > 0 ) {
		jQuery.ajax( {
			url: url,

			// If "type" variable is undefined, then "GET" method will be used.
			// Make value of this field explicit since
			// user can override it through ajaxSetup method
			type: type || "GET",
			dataType: "html",
			data: params
		} ).done( function( responseText ) {

			// Save response for use in complete callback
			response = arguments;

			self.html( selector ?

				// If a selector was specified, locate the right elements in a dummy div
				// Exclude scripts to avoid IE 'Permission Denied' errors
				jQuery( "<div>" ).append( jQuery.parseHTML( responseText ) ).find( selector ) :

				// Otherwise use the full result
				responseText );

		// If the request succeeds, this function gets "data", "status", "jqXHR"
		// but they are ignored because response was set above.
		// If it fails, this function gets "jqXHR", "status", "error"
		} ).always( callback && function( jqXHR, status ) {
			self.each( function() {
				callback.apply( this, response || [ jqXHR.responseText, status, jqXHR ] );
			} );
		} );
	}

	return this;
};




jQuery.expr.pseudos.animated = function( elem ) {
	return jQuery.grep( jQuery.timers, function( fn ) {
		return elem === fn.elem;
	} ).length;
};




jQuery.offset = {
	setOffset: function( elem, options, i ) {
		var curPosition, curLeft, curCSSTop, curTop, curOffset, curCSSLeft, calculatePosition,
			position = jQuery.css( elem, "position" ),
			curElem = jQuery( elem ),
			props = {};

		// Set position first, in-case top/left are set even on static elem
		if ( position === "static" ) {
			elem.style.position = "relative";
		}

		curOffset = curElem.offset();
		curCSSTop = jQuery.css( elem, "top" );
		curCSSLeft = jQuery.css( elem, "left" );
		calculatePosition = ( position === "absolute" || position === "fixed" ) &&
			( curCSSTop + curCSSLeft ).indexOf( "auto" ) > -1;

		// Need to be able to calculate position if either
		// top or left is auto and position is either absolute or fixed
		if ( calculatePosition ) {
			curPosition = curElem.position();
			curTop = curPosition.top;
			curLeft = curPosition.left;

		} else {
			curTop = parseFloat( curCSSTop ) || 0;
			curLeft = parseFloat( curCSSLeft ) || 0;
		}

		if ( isFunction( options ) ) {

			// Use jQuery.extend here to allow modification of coordinates argument (gh-1848)
			options = options.call( elem, i, jQuery.extend( {}, curOffset ) );
		}

		if ( options.top != null ) {
			props.top = ( options.top - curOffset.top ) + curTop;
		}
		if ( options.left != null ) {
			props.left = ( options.left - curOffset.left ) + curLeft;
		}

		if ( "using" in options ) {
			options.using.call( elem, props );

		} else {
			curElem.css( props );
		}
	}
};

jQuery.fn.extend( {

	// offset() relates an element's border box to the document origin
	offset: function( options ) {

		// Preserve chaining for setter
		if ( arguments.length ) {
			return options === undefined ?
				this :
				this.each( function( i ) {
					jQuery.offset.setOffset( this, options, i );
				} );
		}

		var rect, win,
			elem = this[ 0 ];

		if ( !elem ) {
			return;
		}

		// Return zeros for disconnected and hidden (display: none) elements (gh-2310)
		// Support: IE <=11 only
		// Running getBoundingClientRect on a
		// disconnected node in IE throws an error
		if ( !elem.getClientRects().length ) {
			return { top: 0, left: 0 };
		}

		// Get document-relative position by adding viewport scroll to viewport-relative gBCR
		rect = elem.getBoundingClientRect();
		win = elem.ownerDocument.defaultView;
		return {
			top: rect.top + win.pageYOffset,
			left: rect.left + win.pageXOffset
		};
	},

	// position() relates an element's margin box to its offset parent's padding box
	// This corresponds to the behavior of CSS absolute positioning
	position: function() {
		if ( !this[ 0 ] ) {
			return;
		}

		var offsetParent, offset, doc,
			elem = this[ 0 ],
			parentOffset = { top: 0, left: 0 };

		// position:fixed elements are offset from the viewport, which itself always has zero offset
		if ( jQuery.css( elem, "position" ) === "fixed" ) {

			// Assume position:fixed implies availability of getBoundingClientRect
			offset = elem.getBoundingClientRect();

		} else {
			offset = this.offset();

			// Account for the *real* offset parent, which can be the document or its root element
			// when a statically positioned element is identified
			doc = elem.ownerDocument;
			offsetParent = elem.offsetParent || doc.documentElement;
			while ( offsetParent &&
				( offsetParent === doc.body || offsetParent === doc.documentElement ) &&
				jQuery.css( offsetParent, "position" ) === "static" ) {

				offsetParent = offsetParent.parentNode;
			}
			if ( offsetParent && offsetParent !== elem && offsetParent.nodeType === 1 ) {

				// Incorporate borders into its offset, since they are outside its content origin
				parentOffset = jQuery( offsetParent ).offset();
				parentOffset.top += jQuery.css( offsetParent, "borderTopWidth", true );
				parentOffset.left += jQuery.css( offsetParent, "borderLeftWidth", true );
			}
		}

		// Subtract parent offsets and element margins
		return {
			top: offset.top - parentOffset.top - jQuery.css( elem, "marginTop", true ),
			left: offset.left - parentOffset.left - jQuery.css( elem, "marginLeft", true )
		};
	},

	// This method will return documentElement in the following cases:
	// 1) For the element inside the iframe without offsetParent, this method will return
	//    documentElement of the parent window
	// 2) For the hidden or detached element
	// 3) For body or html element, i.e. in case of the html node - it will return itself
	//
	// but those exceptions were never presented as a real life use-cases
	// and might be considered as more preferable results.
	//
	// This logic, however, is not guaranteed and can change at any point in the future
	offsetParent: function() {
		return this.map( function() {
			var offsetParent = this.offsetParent;

			while ( offsetParent && jQuery.css( offsetParent, "position" ) === "static" ) {
				offsetParent = offsetParent.offsetParent;
			}

			return offsetParent || documentElement;
		} );
	}
} );

// Create scrollLeft and scrollTop methods
jQuery.each( { scrollLeft: "pageXOffset", scrollTop: "pageYOffset" }, function( method, prop ) {
	var top = "pageYOffset" === prop;

	jQuery.fn[ method ] = function( val ) {
		return access( this, function( elem, method, val ) {

			// Coalesce documents and windows
			var win;
			if ( isWindow( elem ) ) {
				win = elem;
			} else if ( elem.nodeType === 9 ) {
				win = elem.defaultView;
			}

			if ( val === undefined ) {
				return win ? win[ prop ] : elem[ method ];
			}

			if ( win ) {
				win.scrollTo(
					!top ? val : win.pageXOffset,
					top ? val : win.pageYOffset
				);

			} else {
				elem[ method ] = val;
			}
		}, method, val, arguments.length );
	};
} );

// Support: Safari <=7 - 9.1, Chrome <=37 - 49
// Add the top/left cssHooks using jQuery.fn.position
// Webkit bug: https://bugs.webkit.org/show_bug.cgi?id=29084
// Blink bug: https://bugs.chromium.org/p/chromium/issues/detail?id=589347
// getComputedStyle returns percent when specified for top/left/bottom/right;
// rather than make the css module depend on the offset module, just check for it here
jQuery.each( [ "top", "left" ], function( _i, prop ) {
	jQuery.cssHooks[ prop ] = addGetHookIf( support.pixelPosition,
		function( elem, computed ) {
			if ( computed ) {
				computed = curCSS( elem, prop );

				// If curCSS returns percentage, fallback to offset
				return rnumnonpx.test( computed ) ?
					jQuery( elem ).position()[ prop ] + "px" :
					computed;
			}
		}
	);
} );


// Create innerHeight, innerWidth, height, width, outerHeight and outerWidth methods
jQuery.each( { Height: "height", Width: "width" }, function( name, type ) {
	jQuery.each( {
		padding: "inner" + name,
		content: type,
		"": "outer" + name
	}, function( defaultExtra, funcName ) {

		// Margin is only for outerHeight, outerWidth
		jQuery.fn[ funcName ] = function( margin, value ) {
			var chainable = arguments.length && ( defaultExtra || typeof margin !== "boolean" ),
				extra = defaultExtra || ( margin === true || value === true ? "margin" : "border" );

			return access( this, function( elem, type, value ) {
				var doc;

				if ( isWindow( elem ) ) {

					// $( window ).outerWidth/Height return w/h including scrollbars (gh-1729)
					return funcName.indexOf( "outer" ) === 0 ?
						elem[ "inner" + name ] :
						elem.document.documentElement[ "client" + name ];
				}

				// Get document width or height
				if ( elem.nodeType === 9 ) {
					doc = elem.documentElement;

					// Either scroll[Width/Height] or offset[Width/Height] or client[Width/Height],
					// whichever is greatest
					return Math.max(
						elem.body[ "scroll" + name ], doc[ "scroll" + name ],
						elem.body[ "offset" + name ], doc[ "offset" + name ],
						doc[ "client" + name ]
					);
				}

				return value === undefined ?

					// Get width or height on the element, requesting but not forcing parseFloat
					jQuery.css( elem, type, extra ) :

					// Set width or height on the element
					jQuery.style( elem, type, value, extra );
			}, type, chainable ? margin : undefined, chainable );
		};
	} );
} );


jQuery.each( [
	"ajaxStart",
	"ajaxStop",
	"ajaxComplete",
	"ajaxError",
	"ajaxSuccess",
	"ajaxSend"
], function( _i, type ) {
	jQuery.fn[ type ] = function( fn ) {
		return this.on( type, fn );
	};
} );




jQuery.fn.extend( {

	bind: function( types, data, fn ) {
		return this.on( types, null, data, fn );
	},
	unbind: function( types, fn ) {
		return this.off( types, null, fn );
	},

	delegate: function( selector, types, data, fn ) {
		return this.on( types, selector, data, fn );
	},
	undelegate: function( selector, types, fn ) {

		// ( namespace ) or ( selector, types [, fn] )
		return arguments.length === 1 ?
			this.off( selector, "**" ) :
			this.off( types, selector || "**", fn );
	},

	hover: function( fnOver, fnOut ) {
		return this
			.on( "mouseenter", fnOver )
			.on( "mouseleave", fnOut || fnOver );
	}
} );

jQuery.each(
	( "blur focus focusin focusout resize scroll click dblclick " +
	"mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave " +
	"change select submit keydown keypress keyup contextmenu" ).split( " " ),
	function( _i, name ) {

		// Handle event binding
		jQuery.fn[ name ] = function( data, fn ) {
			return arguments.length > 0 ?
				this.on( name, null, data, fn ) :
				this.trigger( name );
		};
	}
);




// Support: Android <=4.0 only
// Make sure we trim BOM and NBSP
// Require that the "whitespace run" starts from a non-whitespace
// to avoid O(N^2) behavior when the engine would try matching "\s+$" at each space position.
var rtrim = /^[\s\uFEFF\xA0]+|([^\s\uFEFF\xA0])[\s\uFEFF\xA0]+$/g;

// Bind a function to a context, optionally partially applying any
// arguments.
// jQuery.proxy is deprecated to promote standards (specifically Function#bind)
// However, it is not slated for removal any time soon
jQuery.proxy = function( fn, context ) {
	var tmp, args, proxy;

	if ( typeof context === "string" ) {
		tmp = fn[ context ];
		context = fn;
		fn = tmp;
	}

	// Quick check to determine if target is callable, in the spec
	// this throws a TypeError, but we will just return undefined.
	if ( !isFunction( fn ) ) {
		return undefined;
	}

	// Simulated bind
	args = slice.call( arguments, 2 );
	proxy = function() {
		return fn.apply( context || this, args.concat( slice.call( arguments ) ) );
	};

	// Set the guid of unique handler to the same of original handler, so it can be removed
	proxy.guid = fn.guid = fn.guid || jQuery.guid++;

	return proxy;
};

jQuery.holdReady = function( hold ) {
	if ( hold ) {
		jQuery.readyWait++;
	} else {
		jQuery.ready( true );
	}
};
jQuery.isArray = Array.isArray;
jQuery.parseJSON = JSON.parse;
jQuery.nodeName = nodeName;
jQuery.isFunction = isFunction;
jQuery.isWindow = isWindow;
jQuery.camelCase = camelCase;
jQuery.type = toType;

jQuery.now = Date.now;

jQuery.isNumeric = function( obj ) {

	// As of jQuery 3.0, isNumeric is limited to
	// strings and numbers (primitives or objects)
	// that can be coerced to finite numbers (gh-2662)
	var type = jQuery.type( obj );
	return ( type === "number" || type === "string" ) &&

		// parseFloat NaNs numeric-cast false positives ("")
		// ...but misinterprets leading-number strings, particularly hex literals ("0x...")
		// subtraction forces infinities to NaN
		!isNaN( obj - parseFloat( obj ) );
};

jQuery.trim = function( text ) {
	return text == null ?
		"" :
		( text + "" ).replace( rtrim, "$1" );
};



// Register as a named AMD module, since jQuery can be concatenated with other
// files that may use define, but not via a proper concatenation script that
// understands anonymous AMD modules. A named AMD is safest and most robust
// way to register. Lowercase jquery is used because AMD module names are
// derived from file names, and jQuery is normally delivered in a lowercase
// file name. Do this after creating the global so that if an AMD module wants
// to call noConflict to hide this version of jQuery, it will work.

// Note that for maximum portability, libraries that are not jQuery should
// declare themselves as anonymous modules, and avoid setting a global if an
// AMD loader is present. jQuery is a special case. For more information, see
// https://github.com/jrburke/requirejs/wiki/Updating-existing-libraries#wiki-anon

if ( typeof define === "function" && define.amd ) {
	define( "jquery", [], function() {
		return jQuery;
	} );
}




var

	// Map over jQuery in case of overwrite
	_jQuery = window.jQuery,

	// Map over the $ in case of overwrite
	_$ = window.$;

jQuery.noConflict = function( deep ) {
	if ( window.$ === jQuery ) {
		window.$ = _$;
	}

	if ( deep && window.jQuery === jQuery ) {
		window.jQuery = _jQuery;
	}

	return jQuery;
};

// Expose jQuery and $ identifiers, even in AMD
// (trac-7102#comment:10, https://github.com/jquery/jquery/pull/557)
// and CommonJS for browser emulators (trac-13566)
if ( typeof noGlobal === "undefined" ) {
	window.jQuery = window.$ = jQuery;
}




return jQuery;
} );

},{}],33:[function(require,module,exports){
//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(row * cellSize, col * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();

(function (factory) {
  if (typeof define === 'function' && define.amd) {
      define([], factory);
  } else if (typeof exports === 'object') {
      module.exports = factory();
  }
}(function () {
    return qrcode;
}));

},{}],34:[function(require,module,exports){
/**
 * The GrapesJS adapter: the only file in OSCAR that knows what editor we use.
 *
 * It translates a neutral widget definition (lib/widgets/) into the things
 * GrapesJS wants -- a component type, a trait list, a block -- and supplies the
 * `ctx` the widget's behaviour runs against. Swapping editors means rewriting
 * this file; the widgets themselves do not change.
 */

var { WIDGETS } = require("../../../lib/widgets");
var { sendsDmx, upgradeRouting, sectionStatus, SECTIONS } = require("../../../lib/widgets/fields");
var { exportAttributes } = require("../../../lib/export/config");

/**
 * The collapsible section a field is drawn in. GrapesJS draws every trait
 * that has a category above every trait that has none, so the widget's own
 * settings get a section too -- first, because Enabled is the first field --
 * rather than ending up underneath the protocols.
 *
 * A protocol's section starts open when the widget uses that protocol. The
 * DMX section of a plain OSC button is one closed line, which keeps its panel
 * as short as it was before DMX existed.
 */
var WIDGET_SECTION = { id: "widget", label: "Widget" };
var SECTION_ATTRIBUTE = "data-oscar-section";

function categoryOf(field, config) {
  var section = null;
  SECTIONS.forEach(function (candidate) {
    if (candidate.id === field.section) section = candidate;
  });
  if (!section) return { id: WIDGET_SECTION.id, label: WIDGET_SECTION.label, open: true };
  var open = section.id === "dmx" ? sendsDmx(config || {}) : true;
  // The attribute lands on the section's element, which is how the status
  // light finds it: by what it is, not by what its title happens to say.
  var attributes = {};
  attributes[SECTION_ATTRIBUTE] = section.id;
  return { id: section.id, label: section.label, open: open, attributes: attributes };
}

/** Neutral field descriptor -> GrapesJS trait. `config` decides which sections start open. */
function toTrait(field, config) {
  var trait = {
    // Every setting is a component property rather than an HTML attribute.
    // Attributes would end up in the exported markup, where they are noise at
    // best and a stale copy of the truth at worst.
    changeProp: true,
    name: field.key,
    label: field.label,
    type: field.type,
    category: categoryOf(field, config),
  };

  if (field.type === "select") {
    // GrapesJS wants { id, name }, which is the shape lib/widgets uses too.
    trait.options = field.options;
  }
  if (field.placeholder) trait.placeholder = field.placeholder;
  // Shown by the browser on hover. decoratePanel() copies it onto the label
  // too, which GrapesJS titles with the label's own text.
  if (field.hint) trait.attributes = { title: field.hint };
  if (field.min !== undefined) trait.min = field.min;
  if (field.max !== undefined) trait.max = field.max;
  if (field.step !== undefined) trait.step = field.step;

  return trait;
}

/** The whole panel for a widget in a given state. */
function traitsFor(definition, config) {
  return visibleFields(definition, config).map(function (field) {
    return toTrait(field, config);
  });
}

/** The fields a trait list holds, in order, as one comparable string. */
function traitKeys(traits) {
  if (!traits || typeof traits.map !== "function") return null;
  return traits
    .map(function (trait) {
      // A GrapesJS trait is a model once the component has built it, and a
      // plain descriptor before.
      return trait.key || (typeof trait.get === "function" ? trait.get("name") : trait.name);
    })
    .join(" ");
}

/** Read every configured value off a component, for validators that need context. */
function configOf(model, definition) {
  var config = {};
  for (var key in definition.defaults) {
    if (Object.prototype.hasOwnProperty.call(definition.defaults, key)) {
      config[key] = model.get(key);
    }
  }
  return config;
}

/**
 * The fields that apply to a widget as it is currently configured.
 *
 * A field may carry `showIf: { key, in: [...] }` (lib/widgets/fields.js),
 * which is how the DMX half of a panel stays out of the way of anyone sending
 * only OSC. It is data rather than a callback so this file can also work out
 * which settings it has to watch for the panel to keep up.
 */
function visibleFields(definition, config) {
  return definition.fields.filter(function (field) {
    var rule = field.showIf;
    return !rule || rule.in.indexOf(config[rule.key]) !== -1;
  });
}

/** The settings some field's visibility depends on. */
function revealKeys(definition) {
  var keys = [];
  definition.fields.forEach(function (field) {
    if (field.showIf && keys.indexOf(field.showIf.key) === -1) keys.push(field.showIf.key);
  });
  return keys;
}

function changeEvent(keys) {
  return keys
    .map(function (key) {
      return "change:" + key;
    })
    .join(" ");
}

/**
 * Which components are on their way out because someone deleted them.
 *
 * GrapesJS removes a widget's view for more reasons than deletion: opening a
 * project, and the preview page taking a push, tear the whole surface down
 * and build the new one (an undo does the same). Releasing DMX on every one
 * of those would black the stage out on "Push to preview" while a tablet is
 * mid-show. Only an actual deletion -- the trash icon, the Delete key, a
 * script calling remove() -- goes through Component.remove(), which announces
 * itself with component:remove:before; a load resets the wrapper's children
 * and never does -- what it does remove that way is the wrapper itself, the
 * page's body, and the whole surface going is not a widget being deleted.
 * A move is a remove-and-append flagged `temporary`, so it does not count
 * either. The set is per editor and filled once, however many widgets
 * register against it.
 */
// The widget types that can hold DMX channels, by component type name.
var DMX_TYPES = {};
WIDGETS.forEach(function (definition) {
  if (definition.dmx) DMX_TYPES[definition.name] = true;
});

var deletionsByEditor = typeof WeakMap === "function" ? new WeakMap() : null;

function deletionsOf(editor) {
  var marked = deletionsByEditor && deletionsByEditor.get(editor);
  if (marked) return marked;

  marked = new WeakSet();
  if (deletionsByEditor) deletionsByEditor.set(editor, marked);

  // A host without events cannot tell a deletion from a reload, and holding
  // the rig is the safe answer to not knowing.
  if (typeof editor.on !== "function") return marked;

  // Deleting a whole page is a deletion of everything on it, and GrapesJS
  // announces it differently: the only component:remove:before is for the
  // page's wrapper, which is rightly ignored below, and a page that is not
  // showing has no views whose removal could hand anything back. So the
  // channels are given up here, by id, before the page's components are gone
  // (by page:remove they already are). A widget that holds no channels costs
  // a message the server answers with "not known".
  editor.on("page:remove:before", function (page) {
    if (!page || typeof page.getMainComponent !== "function" || !editor.stopDMX) return;
    var main = page.getMainComponent();
    if (!main || typeof main.onAll !== "function") return;
    main.onAll(function (model) {
      if (DMX_TYPES[model.get("type")]) editor.stopDMX(model.getId());
    });
  });

  editor.on("component:remove:before", function (component, remove, opts) {
    if (!component || (opts && opts.temporary)) return;
    if (typeof component.get === "function" && component.get("type") === "wrapper") return;
    var mark = function (model) {
      marked.add(model);
    };
    // A deleted container takes the widgets inside it with it.
    if (typeof component.onAll === "function") component.onAll(mark);
    else mark(component);
  });

  return marked;
}

/**
 * Build the `ctx` a widget's behaviour runs against.
 *
 * `set` writes with `silent` so that storing a value mid-drag cannot trigger
 * the validators or a re-render -- the old slider needed a `fromView` flag
 * threaded through its model to dodge exactly that, and the pad would have
 * fought its own handle.
 *
 * `onOsc` is the network coming the other way, and `send` is shut for as long
 * as a message is being delivered through it. That is the host's half of the
 * loop guard: a widget has no way to lift it, so a value that arrived from
 * outside cannot be bounced straight back out by any widget, however it is
 * written. (The widgets' half is in lib/widgets/incoming.js.)
 *
 * `onShared` is the other devices on the surface, and while their state is
 * being delivered both `send` and `share` are shut: the device that acted
 * already put the message on the wire, and a device that re-shared what it
 * was handed would hand it straight back. `share` stays open while OSC is
 * being delivered, on purpose -- a value the rig sent is recorded, so a
 * device joining later starts where the rig left things -- but it goes out
 * marked as heard, and the server tells nobody: the other devices were sent
 * the same OSC message (lib/shared-sync.js).
 *
 * Only the pages that show the surface take part. The editor is handed no
 * shareState (see oscar_socket.js), so neither method exists there.
 *
 * A message may carry an OSC half, a DMX half, or both (lib/widgets/outgoing.js);
 * each goes out on its own bridge. The DMX half is stamped with the
 * component's id on the way, which is what names this widget's claim on its
 * channels: the same widget replaces its own claim on every move, and hands
 * it back when deleted. The id lives in the project file, so a tablet that
 * reloads the surface resumes driving the same channels instead of turning
 * up as a second source fighting the first.
 */
function contextFor(view, editor) {
  var model = view.model;
  // How deep this widget is in taking an incoming OSC message, and in
  // taking another device's state. Each shuts a different door.
  var delivering = 0;
  var adopting = 0;

  var ctx = {
    onRewrite: function (fn) {
      view.oscarRewrites = (view.oscarRewrites || []).concat([fn]);
      return function () {
        view.oscarRewrites = (view.oscarRewrites || []).filter(function (f) {
          return f !== fn;
        });
      };
    },

    get: function (key) {
      return model.get(key);
    },

    set: function (key, value) {
      model.set(key, value, { silent: true });
    },

    send: function (message) {
      if (delivering) {
        console.warn("OSCAR: a widget tried to answer incoming OSC with outgoing OSC; dropped", message);
        return;
      }
      if (adopting) {
        // The device that acted already sent this; a second copy from every
        // tablet watching would be a retrigger downstream.
        console.warn("OSCAR: a widget tried to answer another device's state by sending; dropped", message);
        return;
      }
      if (!message) return;
      if (message.address && editor.sendOSC) {
        editor.sendOSC(message.ip, message.port, message.address, message.args);
      }
      if (message.dmx && editor.sendDMX) {
        editor.sendDMX(Object.assign({ source: model.getId() }, message.dmx));
      }
    },

    setClass: function (name, on) {
      // Straight onto the element, never onto the model: a class added to the
      // model is saved into the project file, so a surface stored while a
      // toggle happened to be on would reload wearing its on state.
      if (on) view.el.classList.add(name);
      else view.el.classList.remove(name);
    },

    onChange: function (keys, fn) {
      var event = changeEvent(keys);
      model.on(event, fn);
      return function () {
        model.off(event, fn);
      };
    },
  };

  // Only a host that can receive offers onOsc at all; the widgets check for
  // it (through follow() in lib/widgets/incoming.js) rather than assume it.
  if (editor.onOscIn) {
    ctx.onOsc = function (fn) {
      return editor.onOscIn(function (message) {
        delivering++;
        try {
          fn(message);
        } finally {
          delivering--;
        }
      });
    };
  }

  // Likewise share and onShared: only where the socket plugin put the other
  // devices within reach. The state is keyed by the component's id, which
  // is written into the project (see pinId), so the same widget carries the
  // same id on every device the layout was pushed to.
  if (editor.shareState) {
    ctx.share = function (state, how) {
      if (adopting) {
        console.warn("OSCAR: a widget tried to re-share the state it was handed; dropped", state);
        return;
      }
      // Whatever is shared while the rig's message is being delivered is
      // something every device heard, whether or not the widget said so:
      // it is recorded and nobody is told (lib/shared-sync.js).
      var heard = delivering > 0 || !!(how && how.heard === true);
      editor.shareState(model.getId(), state, { heard: heard, release: how && how.release });
    };
  }

  if (editor.onSharedState) {
    ctx.onShared = function (fn) {
      return editor.onSharedState(model.getId(), function (state) {
        adopting++;
        try {
          fn(state);
        } finally {
          adopting--;
        }
      });
    };
  }

  return ctx;
}

// The widget types that follow the rig, by component type name.
var RECEIVERS = {};
WIDGETS.forEach(function (definition) {
  if (definition.receives) RECEIVERS[definition.name] = definition;
});

// editor -> Map(component model -> detach), for the widgets kept running
// without a view. Per editor, like the deletions above.
var offstageByEditor = typeof WeakMap === "function" ? new WeakMap() : null;

/** Stop the viewless copy of one widget, if there is one: its view has arrived. */
function stopOffstage(editor, model) {
  var running = offstageByEditor && offstageByEditor.get(editor);
  var detach = running && running.get(model);
  if (!detach) return;
  running.delete(model);
  detach();
}

/**
 * Keep the widgets of the pages that are not showing listening to the rig.
 *
 * GrapesJS only builds views for the page on the canvas, and a widget only
 * runs while it has a view. So on a surface with several pages, what the rig
 * said to a fader on page two while page one was up reached nobody: with a
 * single tablet -- the usual rig -- no device anywhere was running that
 * fader, the value was never stored or recorded, and the fader came back
 * where it had been left, disagreeing with the rig. The next touch then sent
 * from the stale position, which is a jump on the rig.
 *
 * The components of every page exist whether or not they are showing; only
 * their views do not. So each widget that can receive is attached to an
 * element that is never put on screen, against the same ctx a view would
 * get. It does what it always does with what it hears -- stores it with
 * set(), shares it as heard -- and because nothing can touch an element that
 * is not in any document, it never sends. When its page is turned to, the
 * view's own attach takes over (onRender stops this copy first) and starts
 * from the stored value and, on a sharing device, the shared state.
 *
 * Widgets that only send are left alone: they have nothing to hear, and what
 * other devices do to them is cached by the socket plugin without them.
 *
 *   var offstage = runOffstage(editor, { document: document });
 *   offstage.start() / offstage.refresh() / offstage.stop()
 *
 * start() doubles as the refresh after a project load, which replaces every
 * component without necessarily announcing a page change.
 */
function runOffstage(editor, options) {
  var doc = (options && options.document) || (typeof document === "undefined" ? null : document);
  var running = new Map();
  var started = false;
  if (offstageByEditor) offstageByEditor.set(editor, running);

  function attach(model, definition) {
    var el = doc.createElement(definition.tag);
    var attributes = definition.attributes || {};
    Object.keys(attributes).forEach(function (name) {
      el.setAttribute(name, attributes[name]);
    });
    try {
      running.set(model, definition.attach(el, contextFor({ model: model, el: el }, editor)) || function () {});
    } catch (err) {
      // One widget that cannot run without a view must not stop the page
      // from turning, or the rest from listening.
      console.warn("OSCAR: a widget could not be kept listening off its page:", err && err.message);
    }
  }

  function refresh() {
    var wanted = new Map();
    if (started && doc && editor.Pages) {
      var selected = editor.Pages.getSelected();
      editor.Pages.getAll().forEach(function (page) {
        if (page === selected || typeof page.getMainComponent !== "function") return;
        var main = page.getMainComponent();
        if (!main || typeof main.onAll !== "function") return;
        main.onAll(function (model) {
          var definition = RECEIVERS[model.get("type")];
          if (definition) wanted.set(model, definition);
        });
      });
    }

    // Whatever is no longer off stage goes first: the page turned to, and
    // after a load every component of the project that was replaced.
    Array.from(running.keys()).forEach(function (model) {
      if (!wanted.has(model)) stopOffstage(editor, model);
    });
    wanted.forEach(function (definition, model) {
      if (!running.has(model)) attach(model, definition);
    });
  }

  // A host that cannot receive has nothing for these widgets to hear.
  if (typeof editor.on === "function" && editor.onOscIn) {
    editor.on("page:select page:add page:remove", refresh);
  }

  return {
    refresh: refresh,
    start: function () {
      started = !!editor.onOscIn;
      refresh();
    },
    stop: function () {
      started = false;
      refresh();
    },
    get size() {
      return running.size;
    },
  };
}

/**
 * Write the component's id into the project.
 *
 * GrapesJS only saves a component's id when something refers to it -- a
 * style rule, a script; otherwise the id is made up afresh on every load,
 * and made up differently on every device. Widgets placed on the canvas
 * pick up a style rule and keep their id that way, but one pasted in from
 * an imported template does not, and the state the tablets share for it
 * would be keyed by an id no other tablet has. Pinning it as an attribute
 * makes the id part of the project on every path.
 */
function pinId(model) {
  var attributes = model.get("attributes") || {};
  if (attributes.id || typeof model.setId !== "function") return;
  model.setId(model.getId());
}

/**
 * Empty a component whose widget builds its own children.
 *
 * What the widget draws lives on the view's element only and GrapesJS never
 * hears of it, which is the whole arrangement: no component, so nothing to
 * save, select, move or delete. This is for children that got into the model
 * some other way -- a project file edited by hand, or written by something
 * that stored them.
 */
function disown(model) {
  if (typeof model.components !== "function") return;
  var children = model.components();
  if (children && children.length) model.components("");
}

/** Let the widget put back what GrapesJS just wiped off its element. */
function rewritten(view) {
  (view.oscarRewrites || []).forEach(function (fn) {
    fn();
  });
}

/**
 * Register one widget definition with GrapesJS.
 *
 * Returns a plugin function, which is what the editor's `plugins` list takes.
 */
function register(definition) {
  return function (editor, options) {
    var ipserver = (options && options.ipserver) || "localhost";
    var deletions = definition.dmx ? deletionsOf(editor) : null;
    var ownClass = definition.attributes && definition.attributes.class;

    // A widget with an Ip setting starts pointed at this machine. One without
    // -- a label, or a meter, which listens and never sends -- has nowhere to
    // point, and must not carry a hidden ip that nothing shows or checks. The
    // test is the setting itself rather than the sends flag, so the hidden
    // value and the visible field cannot come apart.
    var defaults = Object.assign(
      {},
      definition.defaults,
      "ip" in (definition.defaults || {}) ? { ip: ipserver } : {}
    );

    editor.DomComponents.addType(definition.name, {
      isComponent: function (el) {
        return parsed(definition, el);
      },

      model: {
        defaults: Object.assign(
          {
            tagName: definition.tag,
            attributes: Object.assign({}, definition.attributes),
            droppable: false,
            resizable: true,
            traits: traitsFor(definition, defaults),
          },
          defaults,
          // A widget whose label is its text content renders that text as its
          // only child; anything else starts empty.
          definition.text ? { components: String(defaults[definition.text] || "") } : {}
        ),

        init: function () {
          var model = this;

          // The id is what the other devices know this widget by; it has to
          // reach the project file, or it never reaches them.
          pinId(model);

          // A widget's own class is how its stylesheet finds it and how a
          // project's HTML is recognised, not something to style through.
          // GrapesJS styles a component through its classes whenever it has
          // any, so every edit to one XY pad -- a resize, a move, a colour --
          // went to the rule all pads share, and they changed together.
          // Private keeps the class on the element but out of styling, so
          // edits land on this one component; protected stops it being
          // removed from the Classes list by accident.
          //
          // Flagged here, per component, rather than once when the plugin
          // loads: loading a project creates the selector afresh, and a flag
          // set on the earlier one is lost with it.
          // A host that keeps no class list has nothing to flag.
          var classes = ownClass ? model.get("classes") : null;
          if (classes && typeof classes.forEach === "function") {
            classes.forEach(function (selector) {
              if (selector.get("name") === ownClass) {
                selector.set({ private: true, protected: true });
              }
            });
          }

          if (definition.ownsChildren) disown(model);

          // The type's trait list was built from its defaults. A component
          // read back from a saved project may be set to DMX already, and
          // switching Output has to bring the right half of the panel with
          // it. GrapesJS rebuilds its traits on change:traits and redraws the
          // panel itself, so the list is only ever set when it would differ --
          // judged by which fields it holds, since two states of a widget can
          // show the same number of different fields.
          var reveals = revealKeys(definition);
          if (reveals.length) {
            var refresh = function () {
              var wanted = visibleFields(definition, configOf(model, definition));
              if (traitKeys(model.get("traits")) === traitKeys(wanted)) return;
              model.set(
                "traits",
                wanted.map(function (field) {
                  return toTrait(field, configOf(model, definition));
                })
              );
            };
            refresh();
            model.on(changeEvent(reveals), refresh);
          }

          // A widget switched away from DMX must hand its channels back, or
          // the rig holds that widget's last look with nothing left able to
          // change it. Enabled off does not release: a disabled fader holds
          // its level the way a silent OSC fader leaves the software where it
          // was, and a blackout is not "no change".
          if (definition.dmx) {
            // A project saved while the choice was one Output setting says
            // osc, dmx or both. Turn that into the two checkboxes the panel
            // now shows, or they would sit at their defaults and lie about a
            // widget that is driving DMX. Silent: opening a project is not
            // an edit, and nothing has changed about what the widget does.
            var upgraded = upgradeRouting({ transport: model.get("transport") });
            if (upgraded) {
              model.set(upgraded, { silent: true });
              model.unset("transport", { silent: true });
            }

            // The type's panel was built with DMX off, so its DMX section
            // starts closed. One that is driving DMX opens on it.
            if (sendsDmx(configOf(model, definition))) {
              model.set("traits", traitsFor(definition, configOf(model, definition)));
            }

            model.on("change:dmxEnabled", function () {
              if (!sendsDmx(configOf(model, definition)) && editor.stopDMX) editor.stopDMX(model.getId());
            });
          }

          if (definition.text) {
            model.on("change:" + definition.text, function () {
              model.components(String(model.get(definition.text) || ""));
            });
          }

          // Validation runs only on edits made through the settings panel.
          // Values the widget writes back go through ctx.set, which is silent.
          Object.keys(definition.checks || {}).forEach(function (key) {
            model.on("change:" + key, function () {
              var complaint = definition.checks[key](model.get(key), configOf(model, definition));
              if (!complaint) return;
              alert(complaint);
              model.set(key, model.previous(key), { silent: true });
              // The panel is already showing the rejected text; make it show
              // what the component actually holds.
              editor.trigger("component:toggled");
            });
          });
        },
      },

      // GrapesJS's own updateAttributes strips every attribute off the element
      // and re-applies the model's copy, and updateClasses does the same for
      // the class list, on every class or style edit. Whatever the widget
      // wrote straight onto the element goes with them, so each runs the
      // widget's onRewrite handlers afterwards (extendFnView calls the
      // original first).
      extendFnView: ["updateAttributes", "updateClasses"],

      view: {
        updateAttributes: function () {
          rewritten(this);
        },

        updateClasses: function () {
          rewritten(this);
        },

        onRender: function () {
          // The view takes over from the copy that listened while this page
          // was not showing (runOffstage); two of them would share twice.
          stopOffstage(editor, this.model);
          if (this.oscarDetach) this.oscarDetach();
          this.oscarDetach = definition.attach(this.el, contextFor(this, editor));
        },

        removed: function () {
          // DMX is a stream: a deleted widget that was driving channels hands
          // them back, or the rig holds its last look with nothing on the
          // surface able to change it. Only a deletion, though (see
          // deletionsOf): a surface being reloaded keeps every channel where
          // it is, and so does a browser merely disconnecting -- that is the
          // server's rule, and a phone locking its screen must not black out
          // a show.
          if (deletions && deletions.has(this.model)) {
            deletions.delete(this.model);
            if (editor.stopDMX) editor.stopDMX(this.model.getId());
          }

          if (!this.oscarDetach) return;
          this.oscarDetach();
          this.oscarDetach = null;
        },
      },
    });

    editor.BlockManager.add(definition.name, {
      label: definition.block.label,
      // GrapesJS 0.21+ no longer ships Font Awesome, so icons are inline SVG.
      media: definition.block.icon,
      category: definition.block.category,
      content: { type: definition.name },
    });
  };
}

/**
 * One plugin per registered widget, each told the address other devices
 * should send to. This is the whole of what an entry point needs to do to get
 * every widget: spread it into the editor's `plugins` list.
 */
function widgetPlugins(ipServer) {
  return WIDGETS.map(function (definition) {
    var plugin = register(definition);
    return function (editor) {
      plugin(editor, { ipserver: ipServer });
    };
  });
}

/**
 * Recognise an element as this widget when a project is parsed.
 *
 * Matching on the tag alone is too greedy: every <input> in an imported form
 * would become a slider, so a widget that shares its tag is identified by the
 * attributes it was defined with.
 */
function matches(definition, el) {
  if (!el || !el.tagName) return false;
  if (el.tagName.toLowerCase() !== definition.tag) return false;

  var attributes = definition.attributes || {};
  if (attributes.type && el.getAttribute("type") !== attributes.type) return false;
  if (attributes.class && !(el.classList && el.classList.contains(attributes.class))) return false;
  return true;
}

/**
 * The markup and stylesheet an export is built from, with every widget's
 * settings written into the markup.
 *
 * The settings are handed to getHtml() as it serialises each component (its
 * `attributes` option is called per component, children included) and exist
 * only in the string it returns. They are never set on a model, not even for
 * the length of the call, so there is nothing to strip afterwards and no
 * moment at which an autosave, an undo step or a crash could catch a project
 * holding a second copy of its settings -- the thing toTrait's comment rules
 * out. Writing them on and taking them off again would also have GrapesJS
 * rewrite every widget's element twice per export, mid-show.
 *
 * Which components are widgets, and which keys travel, comes from WIDGETS by
 * way of lib/export/config.js; nothing here lists a widget.
 *
 * Only the first page: an exported file is one surface, and the dialog says
 * so when the project has more.
 */
function exportSnapshot(editor) {
  var pages = editor.Pages.getAll();
  var component = pages[0].getMainComponent();
  var widgets = 0;

  var html = editor.getHtml({
    component: component,
    attributes: function (model, attributes) {
      var settings = exportAttributes(model.get("type"), function (key) {
        return model.get(key);
      });
      if (!settings) return attributes;
      widgets++;
      // The id is the widget's name on the wire: its claim on DMX channels
      // and the key the devices share its state under. pinId writes it into
      // every widget that has been through init; this covers one that has
      // not, in the output only.
      var id = attributes && attributes.id ? null : typeof model.getId === "function" && model.getId();
      return Object.assign({}, attributes, id ? { id: id } : null, settings);
    },
  });

  return {
    html: html,
    css: editor.getCss({ component: component }) || "",
    pages: pages.length,
    widgets: widgets,
  };
}

/**
 * What an element parsed from HTML becomes: this widget, or nothing.
 *
 * A widget whose label is its text takes the label from the element too, so
 * pasted or templated code such as <button>Strobe</button> is a button called
 * Strobe in its settings, not one showing Strobe while its Label field says
 * something else.
 *
 * A widget that builds its own children (ownsChildren, lib/widgets/index.js)
 * has none as far as the project goes. Markup pasted in or imported -- a page
 * saved from a browser, with the tiles the widget drew still inside it --
 * would otherwise have them parsed into components: stored, selectable,
 * draggable out, and drawn a second time next to the ones the widget builds.
 * The parser only descends into an element whose components are already given.
 */
function parsed(definition, el) {
  if (!matches(definition, el)) return undefined;
  var result = { type: definition.name };
  if (definition.ownsChildren) result.components = [];
  if (definition.text) {
    var label = String(el.textContent || "").trim();
    if (label) result[definition.text] = label;
  }
  return result;
}

/**
 * Keep the canvas body in the surface's style. The style is saved on the
 * wrapper component, but the body is outside anything GrapesJS stores, so it
 * is brought back in line on every canvas load, project load, page turn (each
 * page has its own wrapper, and so its own style) and attribute change.
 * `copy(attributes, body)` does the copying.
 */
function followSurfaceStyle(editor, copy) {
  function sync() {
    var doc = editor.Canvas.getDocument();
    var wrapper = editor.getWrapper();
    if (doc && doc.body && wrapper) copy(wrapper.getAttributes(), doc.body);
  }
  editor.on("load canvas:frame:load project:load page:select", sync);
  editor.on("component:update:attributes", function (component) {
    if (component === editor.getWrapper()) sync();
  });
  sync();
}

/**
 * What the settings panel shows beyond what GrapesJS draws: lights on each
 * protocol section's title, one per direction the widget has (IN and OUT for
 * OSC, OUT alone for DMX, IN alone for a meter), green while that direction
 * is live on the selected widget and grey while it is not, so a collapsed
 * section still says what it is doing; and the hint of any setting that has
 * one, on its label.
 *
 * GrapesJS rebuilds the panel whenever the selection or a widget's trait list
 * changes and has no hook for after it has, so the panel is watched and
 * decorated again when its contents change. Only child elements are watched,
 * and a repaint changes attributes, so decorating cannot set itself off.
 */
var DIRECTIONS = [
  { id: "in", tag: "IN", label: "Data in" },
  { id: "out", tag: "OUT", label: "Data out" },
];

function sectionLights(editor, options) {
  var doc = (options && options.document) || document;
  var root = (options && options.root) || doc;
  var watched = null;
  var unwatch = null;

  function paint() {
    var model = editor.getSelected();
    var definition = model && byType(model.get("type"));
    var status = definition ? sectionStatus(definition.fields, configOf(model, definition)) : {};

    var sections = root.querySelectorAll("[" + SECTION_ATTRIBUTE + "]");
    Array.prototype.forEach.call(sections, function (section) {
      var title = section.querySelector("[data-title]");
      if (!title) return;
      var directions = status[section.getAttribute(SECTION_ATTRIBUTE)] || {};

      // One holder per title, made once; the lights in it are redrawn, since
      // which directions exist changes with the widget selected.
      var holder = title.querySelector(".oscar-section-lights");
      if (!holder) {
        holder = doc.createElement("span");
        holder.className = "oscar-section-lights";
        title.appendChild(holder);
      }
      DIRECTIONS.forEach(function (direction) {
        var light = holder.querySelector('[data-direction="' + direction.id + '"]');
        if (!(direction.id in directions)) {
          // The widget has no such direction: a meter never sends, DMX never listens.
          if (light) holder.removeChild(light);
          return;
        }
        if (!light) {
          light = doc.createElement("span");
          light.className = "oscar-section-light";
          light.setAttribute("data-direction", direction.id);
          // Two unlabelled dots would be a guess; the tag says which is which.
          light.textContent = direction.tag;
          holder.appendChild(light);
        }
        var on = directions[direction.id] === true;
        var words = direction.label + (on ? ": on" : ": off");
        light.setAttribute("data-on", String(on));
        // In words as well as colour, for a reader and for anyone who cannot
        // tell the two colours apart.
        light.setAttribute("title", words);
        light.setAttribute("role", "img");
        light.setAttribute("aria-label", words);
      });
    });

    // GrapesJS puts a trait's attributes on the wrapper around its row.
    var hinted = root.querySelectorAll(".gjs-trt-trait__wrp[title]");
    Array.prototype.forEach.call(hinted, function (row) {
      var label = row.querySelector(".gjs-label");
      if (label) label.setAttribute("title", row.getAttribute("title"));
    });
  }

  function watch(model) {
    if (unwatch) unwatch();
    unwatch = null;
    watched = model || null;
    if (!watched || typeof watched.on !== "function") return;
    var events = "change:enabled change:listen change:oscEnabled change:dmxEnabled";
    watched.on(events, paint);
    unwatch = function () {
      watched.off(events, paint);
    };
  }

  editor.on("component:selected component:deselected", function () {
    watch(editor.getSelected());
    // The panel is drawn after the selection is announced.
    setTimeout(paint, 0);
  });

  if (typeof MutationObserver === "function" && root.nodeType) {
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () {
        pending = false;
        paint();
      }, 0);
    }).observe(root, { childList: true, subtree: true });
  }

  return paint;
}

function byType(type) {
  for (var i = 0; i < WIDGETS.length; i++) if (WIDGETS[i].name === type) return WIDGETS[i];
  return null;
}

/**
 * Keep GrapesJS's select tool off for as long as the surface is being
 * previewed.
 *
 * Preview mode stops the tool, but GrapesJS starts its default command again
 * whenever a frame loads -- a page turn, a project load -- without asking
 * whether a preview is on. While it runs it cancels every click in the
 * canvas, so that a click selects instead of doing what clicking does. The
 * one control that depends on a click's default action is the colour picker,
 * whose dialog then never opens.
 *
 * Stopped through the editor's own stopDefault(), not by stopping the command:
 * that also clears the flag GrapesJS checks when the preview ends, so leaving
 * preview brings the select tool back as it should.
 */
function noSelectingWhile(editor, isPreviewing) {
  editor.on("command:run:select-comp", function () {
    if (!isPreviewing()) return;
    // After the run that announced itself has finished.
    setTimeout(function () {
      if (isPreviewing()) editor.getModel().stopDefault();
    }, 0);
  });
}

module.exports = {
  noSelectingWhile: noSelectingWhile,
  sectionLights: sectionLights,
  parsed: parsed,
  followSurfaceStyle: followSurfaceStyle,
  exportSnapshot: exportSnapshot,
  register: register,
  widgetPlugins: widgetPlugins,
  runOffstage: runOffstage,
  toTrait: toTrait,
  matches: matches,
  visibleFields: visibleFields,
  revealKeys: revealKeys,
};

},{"../../../lib/export/config":3,"../../../lib/widgets":19,"../../../lib/widgets/fields":17}],35:[function(require,module,exports){
/**
 * "Export" in the editor: turning the canvas into one file that works.
 *
 * What the toolbar had before is GrapesJS's own export-template command, a
 * modal of markup to copy out -- labelled "See code", because that is all it
 * is. It cannot produce a working interface: the settings that say where a
 * widget sends are not in the markup, and nothing on the page would read
 * them if they were.
 *
 * This asks the adapter for markup with those settings written in, and the
 * OSCAR server to wrap it around the standalone runtime (POST /export).
 *
 * Not named oscar_*.js: requiring "./oscar_<name>" is how an entry point used
 * to pull in one widget's file, and test/widgets.test.js refuses that pattern
 * in the entry points so nobody wires a widget by hand again.
 */

var { exportSnapshot } = require("./adapters/grapesjs");
var { surfaceAddress } = require("../../lib/published-address");
// Draws the code for a published surface's address. Bundled, like everything
// else here: OSCAR runs at venues with no internet.
var qrcode = require("qrcode-generator");

var DEFAULT_NAME = "my-interface";

/** A filename someone can find again, from whatever they typed. */
function fileStem(name) {
  var stem = String(name == null ? "" : name)
    .trim()
    .toLowerCase()
    .replace(/\.html?$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return stem || DEFAULT_NAME;
}

/**
 * Hand a blob to the browser as a download. The object URL is released a
 * moment later rather than at once: revoking it in the same frame as the
 * click races the download in Safari, and the file arrives empty.
 */
function download(blob, filename) {
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 1000);
}

/** The files the server left as links, from its response header. */
function linkedAssets(res) {
  try {
    var list = JSON.parse(decodeURIComponent(res.headers.get("X-Oscar-Linked-Assets") || "[]"));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

/**
 * @param {object} editor the GrapesJS editor
 * @param {{ host: string, port: number, projectName?: () => string }} options
 *        host and port are what the editor was started with, used only if
 *        the server cannot be asked again
 */
function install(editor, options) {
  var container = document.getElementById("export-panel");
  if (!container) return;

  var publishButton = document.getElementById("publish-button");
  var resultBox = document.getElementById("publish-result");
  var qrBox = document.getElementById("publish-qr");
  var statusLine = document.getElementById("publish-status");
  var link = document.getElementById("publish-link");
  var publishedBox = document.getElementById("published-box");
  var publishedList = document.getElementById("published-list");
  // The address other devices reach OSCAR on, as GET /connection last said.
  var lanHost = "";

  /** Where a published surface is opened from another device. */
  function addressOf(path) {
    return surfaceAddress(lanHost || window.location.hostname, window.location.port || 80, path);
  }

  function showPublished(path, replaced) {
    var address = addressOf(path);
    statusLine.textContent = replaced ? "Published again, at the same address:" : "Published. Open it at:";
    link.textContent = address;
    link.href = address;
    // Drawn by the library from an address OSCAR built; nothing a person typed
    // reaches it except the name, which has been reduced to a-z, 0-9 and "-".
    var code = qrcode(0, "M");
    code.addData(address);
    code.make();
    qrBox.innerHTML = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    resultBox.style.display = "flex";
  }

  function refreshPublished() {
    return fetch("/published")
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .then(function (pages) {
        publishedList.textContent = "";
        (Array.isArray(pages) ? pages : []).forEach(function (page) {
          var row = document.createElement("li");
          var open = document.createElement("a");
          open.className = "o-link";
          open.target = "_blank";
          open.rel = "noopener";
          open.href = addressOf(page.path);
          open.textContent = addressOf(page.path);
          row.appendChild(open);

          var qr = document.createElement("button");
          qr.type = "button";
          qr.className = "o-btn";
          qr.textContent = "QR";
          qr.setAttribute("aria-label", "Show the QR code for " + page.id);
          qr.onclick = function () {
            showPublished(page.path, false);
            statusLine.textContent = "Open it at:";
          };
          row.appendChild(qr);

          var remove = document.createElement("button");
          remove.type = "button";
          remove.className = "o-btn";
          remove.textContent = "Unpublish";
          remove.setAttribute("aria-label", "Unpublish " + page.id);
          remove.onclick = function () {
            remove.disabled = true;
            fetch("/published/" + encodeURIComponent(page.id), { method: "DELETE" }).then(function () {
              if (link.href === addressOf(page.path)) resultBox.style.display = "none";
              refreshPublished();
            });
          };
          row.appendChild(remove);
          publishedList.appendChild(row);
        });
        publishedBox.style.display = publishedList.children.length ? "block" : "none";
      })
      .catch(function () {
        publishedBox.style.display = "none";
      });
  }

  var nameField = document.getElementById("export-name");
  var hostField = document.getElementById("export-host");
  var portField = document.getElementById("export-port");
  var errorBox = document.getElementById("export-error");
  var noteBox = document.getElementById("export-note");
  var pagesBox = document.getElementById("export-pages");
  var pageCount = document.getElementById("export-page-count");
  var button = document.getElementById("export-button");

  function say(box, message) {
    box.textContent = message;
    box.style.display = message ? "block" : "none";
  }

  function open() {
    say(errorBox, "");
    say(noteBox, "");
    nameField.value = fileStem((options.projectName && options.projectName()) || "");

    var pages = editor.Pages.getAll().length;
    pageCount.textContent = String(pages);
    pagesBox.style.display = pages > 1 ? "block" : "none";

    // Asked for now rather than remembered from when the editor loaded: a
    // laptop that has changed network since then has a new address, and the
    // file is about to have this one baked into it. The address OSCAR reports
    // is the one a tablet on the same Wi-Fi can reach -- not localhost, which
    // would only ever work on this computer.
    hostField.value = options.host || window.location.hostname || "";
    portField.value = options.port || "";
    fetch("/connection")
      .then(function (res) {
        return res.json();
      })
      .then(function (conn) {
        if (conn && conn.address) {
          hostField.value = conn.address;
          lanHost = conn.address;
        }
        if (conn && conn.socketPort) portField.value = conn.socketPort;
      })
      .catch(function () {
        /* the values from startup stand */
      })
      .then(refreshPublished);
    resultBox.style.display = "none";

    container.style.display = "block";
    editor.Modal.open({
      title: "Publish your interface",
      content: container,
      attributes: { class: "modal-login" },
    });
  }

  /**
   * What both buttons send: the same surface, built the same way. Null if
   * something is missing.
   *
   * Only a downloaded file has to be told where OSCAR is. A published page is
   * served by OSCAR and finds it by the address it was opened at, so
   * publishing asks for nothing and the server bakes in its own address.
   */
  function request(needsAddress) {
    var host = (hostField.value || "").trim();
    var port = (portField.value || "").trim();

    say(errorBox, "");
    say(noteBox, "");
    if (needsAddress) {
      // The server checks both properly; this only saves a round trip.
      if (!host) return say(errorBox, "Say where OSCAR can be reached."), null;
      if (!port) return say(errorBox, "Say which port OSCAR's bridge is on."), null;
    }

    var snapshot = exportSnapshot(editor);
    return {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: (nameField.value || "").trim() || DEFAULT_NAME,
        fileName: fileStem(nameField.value),
        html: snapshot.html,
        css: snapshot.css,
        connection: needsAddress ? { host: host, port: port } : undefined,
      }),
    };
  }

  publishButton.onclick = function () {
    var body = request(false);
    if (!body) return;
    publishButton.disabled = true;

    fetch("/publish", body)
      .then(function (res) {
        return res.json().then(function (answer) {
          if (!res.ok) throw new Error((answer && answer.error) || "The surface could not be published.");
          return answer;
        });
      })
      .then(function (answer) {
        showPublished(answer.path, answer.replaced);
        if (answer.linked && answer.linked.length) {
          say(noteBox, "Too large to embed, so these are loaded from OSCAR as the page opens: " + answer.linked.join(", "));
        }
        return refreshPublished();
      })
      .catch(function (err) {
        say(errorBox, (err && err.message) || "Could not reach the OSCAR server.");
      })
      .then(function () {
        publishButton.disabled = false;
      });
  };

  button.onclick = function () {
    var stem = fileStem(nameField.value);
    var body = request(true);
    if (!body) return;
    button.disabled = true;

    fetch("/export", body)
      .then(function (res) {
        if (res.ok) {
          return res.blob().then(function (blob) {
            return { blob: blob, linked: linkedAssets(res) };
          });
        }
        return res.json().then(
          function (body) {
            throw new Error((body && body.error) || "The export failed.");
          },
          function () {
            throw new Error("The export failed.");
          }
        );
      })
      .then(function (result) {
        download(result.blob, stem + ".html");
        if (!result.linked.length) return editor.Modal.close();
        // The one case where the file is not the whole story, so the dialog
        // stays up to say it.
        say(
          noteBox,
          "Downloaded. Too large to embed, so these stay as links and have to be " +
            "kept next to the file: " + result.linked.join(", ")
        );
      })
      .catch(function (err) {
        say(errorBox, (err && err.message) || "Could not reach the OSCAR server.");
      })
      .then(function () {
        button.disabled = false;
      });
  };

  editor.Commands.add("oscar-export", open);
}

module.exports = { install: install, fileStem: fileStem };

},{"../../lib/published-address":10,"./adapters/grapesjs":34,"qrcode-generator":33}],36:[function(require,module,exports){
window.$ = $ = window.jQuery = require("jquery");

// jquery-confirm attaches itself to whichever jQuery it is handed. The bundle
// carries its own copy of jQuery, so it must be required here rather than
// loaded as a separate <script> tag -- otherwise it extends the page's jQuery
// and $.alert/$.confirm go missing on this one. Its CommonJS build exports an
// initialiser instead of running itself.
require("jquery-confirm")(window, $);
// Every $.alert and $.confirm draws with OSCAR's theme (css/oscar_theme.css)
// without each call site having to ask for it. jquery-confirm sizes its box
// with Bootstrap grid classes unless told otherwise, and with Bootstrap gone
// those classes have no width, so a prompt stretched across the whole screen.
window.jconfirm.defaults = { theme: "oscar", useBootstrap: false, boxWidth: "420px" };

// GrapesJS 0.21+ no longer ships Font Awesome, so OSCAR's icons are inline SVG.
var ICONS = {
  // Save and Load are a pair of folders, arrow up to send a project, arrow
  // down to bring one back. mdi-folder-upload and mdi-folder-download,
  // @mdi/svg 7.4.47 (Apache-2.0), copied from the package.
  save: "M20,6A2,2 0 0,1 22,8V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4H10L12,6H20M10.75,13H14V17H16V13H19.25L15,8.75",
  open: "M20,6A2,2 0 0,1 22,8V18A2,2 0 0,1 20,20H4C2.89,20 2,19.1 2,18V6C2,4.89 2.89,4 4,4H10L12,6H20M19.25,13H16V9H14V13H10.75L15,17.25",
  // mdi-palette and mdi-restore, @mdi/svg 7.4.47 (Apache-2.0): the widget
  // style gallery, and putting a widget back on its surface's style.
  palette: "M17.5,12A1.5,1.5 0 0,1 16,10.5A1.5,1.5 0 0,1 17.5,9A1.5,1.5 0 0,1 19,10.5A1.5,1.5 0 0,1 17.5,12M14.5,8A1.5,1.5 0 0,1 13,6.5A1.5,1.5 0 0,1 14.5,5A1.5,1.5 0 0,1 16,6.5A1.5,1.5 0 0,1 14.5,8M9.5,8A1.5,1.5 0 0,1 8,6.5A1.5,1.5 0 0,1 9.5,5A1.5,1.5 0 0,1 11,6.5A1.5,1.5 0 0,1 9.5,8M6.5,12A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,1 6.5,9A1.5,1.5 0 0,1 8,10.5A1.5,1.5 0 0,1 6.5,12M12,3A9,9 0 0,0 3,12A9,9 0 0,0 12,21A1.5,1.5 0 0,0 13.5,19.5C13.5,19.11 13.35,18.76 13.11,18.5C12.88,18.23 12.73,17.88 12.73,17.5A1.5,1.5 0 0,1 14.23,16H16A5,5 0 0,0 21,11C21,6.58 16.97,3 12,3Z",
  restore: "M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3Z",
  // mdi-upload, @mdi/svg 7.4.47 (Apache-2.0): publishing sends the surface
  // out, so its arrow points up. Import, beside it, brings code in and keeps
  // the arrow down that GrapesJS gives it. The two used to be the same icon.
  upload: "M9,16V10H5L12,3L19,10H15V16H9M5,20V18H19V20H5Z",
  help: "M15.07,11.25L14.17,12.17C13.45,12.89 13,13.5 13,15H11V14.5C11,13.39 11.45,12.39 12.17,11.67L13.41,10.41C13.78,10.05 14,9.55 14,9C14,7.89 13.1,7 12,7A2,2 0 0,0 10,9H8A4,4 0 0,1 12,5A4,4 0 0,1 16,9C16,9.88 15.64,10.67 15.07,11.25M13,19H11V17H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12C22,6.47 17.5,2 12,2Z",
  pages:
    "M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M19,21H8V7H19V21Z",
  remove: "M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z",
  locked:
    "M12,17A2,2 0 0,0 14,15C14,13.89 13.1,13 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6A2,2 0 0,1 4,20V10C4,8.89 4.9,8 6,8H7V6A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,3A3,3 0 0,0 9,6V8H15V6A3,3 0 0,0 12,3Z",
  unlocked:
    "M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V10A2,2 0 0,1 6,8H15V6A3,3 0 0,0 12,3A3,3 0 0,0 9,6H7A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,17A2,2 0 0,0 14,15A2,2 0 0,0 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17Z",
};

function icon(name, size) {
  size = size || 18;
  return (
    '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
    '<path fill="currentColor" d="' + ICONS[name] + '"/></svg>'
  );
}

var editor = {};

// One browserify bundle serves both the editor and the preview page, so each
// entry point only boots when its own container is on the page.
if (document.getElementById("gjs")) {
  // Ask the server which address it is reachable on, so new widgets default to
  // an IP that other devices on the network can actually talk to.
  fetch("/connection")
    .then(function (res) {
      return res.json();
    })
    .catch(function () {
      return {};
    })
    .then(function (conn) {
      initGrape(conn.address || window.location.hostname || "localhost", conn.socketPort || 8081);
      window.editor = editor;
    });

  checkForUpdate();
  loadDiagnostics();
  wireFeedbackButtons();
}

// ---- feedback --------------------------------------------------------------
// Reports are prefilled into GitHub's issue form and opened in the browser, so
// the person sees exactly what is being sent before submitting. OSCAR itself
// posts nothing and holds no credentials.
var ISSUES_URL = "https://github.com/trafalmejo/OSCAR/issues/new";

var diagnostics = null;

function loadDiagnostics() {
  fetch("/diagnostics")
    .then(function (res) {
      return res.json();
    })
    .then(function (info) {
      diagnostics = info || {};
      var el = document.getElementById("about-version");
      if (el && diagnostics.oscar) el.textContent = "OSCAR " + diagnostics.oscar;
    })
    .catch(function () {
      diagnostics = {};
    });
}

/** The version details a bug report always ends up asking for. */
function environmentReport() {
  var info = diagnostics || {};
  var lines = [
    "OSCAR:      " + (info.oscar || "unknown"),
    "Runs as:    " + (info.electron ? "desktop app (Electron " + info.electron + ")" : "browser"),
    "System:     " + (info.platform || "?") + " " + (info.arch || ""),
    "Node:       " + (info.node || "?"),
    "GrapesJS:   " + (typeof grapesjs !== "undefined" ? grapesjs.version : "?"),
    "Project:    format " + (info.projectFormat || "?"),
    // Whether this build can open a serial port at all is the first question
    // a "my Arduino does nothing" report raises. The port name stays out.
    "Serial:     " + (info.serial ? (info.serial.supported ? info.serial.state : "not in this build") : "?"),
    "Browser:    " + navigator.userAgent,
  ];
  return lines.join("\n");
}

function openIssue(template) {
  var url =
    ISSUES_URL +
    "?template=" +
    encodeURIComponent(template) +
    "&environment=" +
    encodeURIComponent(environmentReport());
  window.open(url, "_blank", "noopener");
}

function wireFeedbackButtons() {
  var report = document.getElementById("report-problem");
  if (report) {
    report.onclick = function (e) {
      e.preventDefault();
      openIssue("bug.yml");
    };
  }

  var suggest = document.getElementById("suggest-feature");
  if (suggest) {
    suggest.onclick = function (e) {
      e.preventDefault();
      // The feature form has no environment field; nothing to prefill.
      window.open(ISSUES_URL + "?template=feature.yml", "_blank", "noopener");
    };
  }
}

// ---- update notice ---------------------------------------------------------
// The server does the checking; this only reports what it found. It is a
// corner toast rather than a modal on purpose: OSCAR is often on screen during
// a show, and nothing here may steal focus, cover the toolbar, or block work.
var SKIPPED_KEY = "oscarSkippedUpdate";

function skippedVersion() {
  try {
    return localStorage.getItem(SKIPPED_KEY);
  } catch (err) {
    return null; // private windows and locked-down browsers
  }
}

function showUpdateNotice(info) {
  var box = document.createElement("div");
  box.className = "oscar-update";

  var title = document.createElement("div");
  title.className = "oscar-update-title";
  title.textContent = "OSCAR " + info.version + " is available";

  var current = document.createElement("div");
  current.className = "oscar-update-current";
  current.textContent = info.current
    ? "You are running " + info.current + "."
    : "You are running an older version.";

  var actions = document.createElement("div");
  actions.className = "oscar-update-actions";

  // Only ever link to a GitHub release page, whatever the server replied.
  var link = document.createElement("a");
  link.className = "oscar-update-get";
  link.textContent = "What's new";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.href = /^https:\/\/github\.com\//.test(info.url || "")
    ? info.url
    : "https://github.com/trafalmejo/OSCAR/releases/latest";

  var later = document.createElement("button");
  later.className = "oscar-update-later";
  later.type = "button";
  later.textContent = "Later";
  later.onclick = function () {
    box.remove();
  };

  var skip = document.createElement("button");
  skip.className = "oscar-update-skip";
  skip.type = "button";
  skip.textContent = "Skip this version";
  skip.onclick = function () {
    try {
      localStorage.setItem(SKIPPED_KEY, info.version);
    } catch (err) {
      /* nothing to do -- it just gets offered again next launch */
    }
    box.remove();
  };

  actions.appendChild(link);
  actions.appendChild(later);
  actions.appendChild(skip);
  box.appendChild(title);
  box.appendChild(current);
  box.appendChild(actions);
  document.body.appendChild(box);
}

function checkForUpdate() {
  fetch("/update")
    .then(function (res) {
      return res.json();
    })
    .then(function (info) {
      if (!info || !info.available || !info.version) return;
      if (info.version === skippedVersion()) return;
      showUpdateNotice(info);
    })
    .catch(function () {
      // Offline, or the server said nothing. Never worth bothering anyone.
    });
}

// The same module the server uses to stamp and check project files, so the
// format number and the "is this a project?" rule can never drift apart.
var projectFormat = require("../../lib/project-format");
var projectsTable = require("../../lib/projects-table");
var widgetStyles = require("../../lib/widget-styles");
var htmlDocument = require("../../lib/html-document");
var { followSurfaceStyle, sectionLights, noSelectingWhile } = require("./adapters/grapesjs");

// Every widget in lib/widgets/registry.js, wired to GrapesJS by the adapter.
var { widgetPlugins, runOffstage } = require("./adapters/grapesjs");

// Tabs and the page-by-page lock, shared with the /preview page.
var oscarPages = require("./pages");

var oscarExport = require("./export_dialog");
var toolbarOrder = require("../../lib/toolbar-order");

var isProjectData = projectFormat.isGrapesProject;

function postJSON(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(function (res) {
    return res.json();
  });
}

function initGrape(ipServer, socketPort) {
  editor = grapesjs.init({
    // GrapesJS fetches Font Awesome from a CDN by default, which fails without
    // a word at a venue with no internet. The few icons it still draws that
    // way are supplied by css/oscar_theme.css instead.
    cssIcons: "",
    // The outline on a selected component is drawn inside the canvas, which
    // cannot see the editor's theme variables, so GrapesJS's own light blue
    // stayed while the handles and toolbar turned pink. canvasCss is added
    // after GrapesJS's rule and is editor-only: it never reaches a saved or
    // exported project. The colour is read from the theme, not repeated here.
    canvasCss:
      ".gjs-selected { outline: 2px solid " +
      (getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#ff3663") +
      " !important; }",
    dragMode: "absolute",
    // Code pasted into Import, and templates, are read with these.
    //
    // A whole document is reduced to its CSS and its body first (see
    // lib/html-document.js for why GrapesJS must not read it as a document),
    // and the style named on its <body> is put on the surface. data-gjs-min-x
    // becomes the minX setting, since HTML attribute names cannot hold
    // capitals. The rest are GrapesJS's own defaults, restated because this
    // option replaces them.
    parser: {
      optionsHtml: {
        preParser: function (input, context) {
          var doc = htmlDocument.readDocument(input);
          // A snippet keeps its shape; only the comments inside its <style>
          // blocks go, for the reason given at stripCssComments.
          if (!doc) return htmlDocument.cleanStyleBlocks(input);
          var wrapper = context && context.editor && context.editor.getWrapper();
          if (wrapper) {
            wrapper.setAttributes(widgetStyles.withSurfaceStyle(wrapper.getAttributes(), doc.bodyAttributes));
          }
          return doc.html;
        },
        htmlType: "text/html",
        allowScripts: false,
        allowUnsafeAttr: false,
        allowUnsafeAttrValue: false,
        keepEmptyTextNodes: false,
        convertDataGjsAttributesHyphens: true,
        convertAttributeValues: false,
      },
    },
    height: "100%",
    container: "#gjs",
    fromElement: true,
    allowScripts: 1,
    // The canvas is its own document and loads nothing from the editor page:
    // fonts, every style's tokens and the widgets all come in here.
    canvas: { styles: widgetStyles.canvasStylesheets() },
    // The surface follows its style too; see SURFACE_CSS for why this one
    // rule cannot sit in a layer.
    protectedCss: widgetStyles.SURFACE_CSS,
    assetManager: {
      assets: [
        "images/fruits/emoji-apple.png",
        "images/fruits/emoji-apple-click.png",
        "images/fruits/emoji-orange.png",
        "images/fruits/emoji-orange-click.png",
        "images/fruits/emoji-banana.png",
        "images/fruits/emoji-banana-click.png",
        "images/fruits/background.png",
      ],
    },
    // The canvas autosaves into this browser. Named projects are a separate,
    // explicit action that writes JSON files next to the OSCAR server.
    storageManager: {
      type: "local",
      autosave: true,
      autoload: true,
      stepsBeforeSave: 1,
      // A key distinct from 0.16's `gjs-*` entries, so a browser that ran an
      // older OSCAR ignores that data instead of half-loading it.
      options: { local: { key: "oscarProject" } },
      // Stamp the autosave the same way saved files are stamped, and never
      // let editor state into it.
      onStore: function (data) {
        // formatFor, as for a saved file: a single page stays readable by
        // an older OSCAR sharing this browser's storage.
        return Object.assign(
          { oscarFormat: projectFormat.formatFor(data) },
          projectFormat.namePages(projectFormat.stripEditorState(data))
        );
      },
      onLoad: function (data) {
        if (!data || !Object.keys(data).length) return data;

        var format = typeof data.oscarFormat === "number" ? data.oscarFormat : 0;
        delete data.oscarFormat;

        // An autosave from a newer OSCAR would be quietly mangled by this one,
        // and the next change would save the damage. Start fresh, but keep the
        // newer copy rather than destroying someone's canvas.
        if (format > projectFormat.CURRENT_FORMAT) {
          try {
            localStorage.setItem("oscarProject.newer", JSON.stringify(data));
          } catch (err) {
            /* nothing more we can do */
          }
          console.warn(
            "OSCAR: this browser holds work from a newer OSCAR. Starting fresh; " +
              "the newer copy is kept under the oscarProject.newer key."
          );
          return {};
        }

        // Repair an autosave that already holds editor state. A build once
        // wrote the preview lock in here, which left widgets unmovable on
        // every launch; that data carries the current stamp, so a version
        // check would not catch it.
        data = projectFormat.stripEditorState(data);

        // And name its pages, on every load for the same reason: GrapesJS
        // drops an empty page name when it stores, so page one of an autosave
        // carrying the current stamp is routinely unnamed.
        data = projectFormat.namePages(data);

        // An autosave with no pages (from a crash mid-load, say) would leave
        // the editor blank and unusable on every launch, with no way out short
        // of clearing browser data. Start fresh -- `{}` is exactly what a
        // first-ever launch loads.
        if (isProjectData(data)) return data;
        console.warn("OSCAR: discarding an unreadable autosave and starting fresh");
        return {};
      },
    },
    plugins: [
      "oscar_socket",
      "oscar_ip",
      // OSCAR's widgets are bundled rather than loaded as globals, so they go
      // in as functions. Named plugins are resolved through window[name], which
      // silently does nothing when the name is wrong -- that is how the
      // gjs-blocks-basic mismatch went unnoticed.
      ...widgetPlugins(ipServer),
      "grapesjs-preset-webpage",
      "gjs-blocks-basic",
      "grapesjs-custom-code",
      "grapesjs-parser-postcss",
      "grapesjs-touch",
      "grapesjs-tooltip",
    ],
    pluginsOpts: {
      oscar_socket: { ipserver: ipServer, socketPort: socketPort },
      "grapesjs-tooltip": {},
      "gjs-blocks-basic": { flexGrid: true },
      "grapesjs-preset-webpage": {
        blocks: [],
        // Keep OSCAR's own palette (css/oscar_theme.css) rather than the
        // preset's theme.
        useCustomTheme: false,
        showStylesOnChange: true,
        // Not "Import Template": a template is now something in the Load list.
        modalImportTitle: "Import HTML/CSS",
        modalImportLabel:
          '<div style="margin-bottom: 10px; font-size: 13px;">Paste here your HTML/CSS and click Import</div>',
        modalImportContent: function (editor) {
          return editor.getHtml() + "<style>" + editor.getCss() + "</style>";
        },
      },
    },
  });

  // The chosen style is saved on the wrapper; the canvas body follows it.
  followSurfaceStyle(editor, widgetStyles.copyToBody);

  // While previewing, a click has to do what clicking does; see the adapter.
  noSelectingWhile(editor, function () {
    return editor.Commands.isActive("preview");
  });

  // A light on each protocol section of the settings panel, so a collapsed
  // section still says whether the widget uses it. Watches the views column,
  // which is where GrapesJS draws and redraws the panel.
  sectionLights(editor, { root: document.querySelector(".gjs-pn-views-container") || document.body });

  var pn = editor.Panels;
  var modal = editor.Modal;

  // ---- modals ------------------------------------------------------------
  function setModal(title, containerId) {
    var container = document.getElementById(containerId);
    container.style.display = "block";
    modal.open({ title: title, content: container, attributes: { class: "modal-login" } });
  }

  function showLoader() {
    $("#table-container").hide();
    $("#loader-table").show();
  }

  function hideLoader() {
    $("#table-container").show();
    $("#loader-table").hide();
  }

  function openProjects(mode) {
    projectsMode = mode;
    // Save leaves templates out of the list, so one picked in Load must not
    // linger as the name a project is saved under.
    if (mode === "Save" && selectedTemplate) {
      selectedTemplate = null;
      templateUrl = null;
      $("#project-name").val("");
    }
    setModal(mode, "table-panel");
    $("#save-button").toggle(mode === "Save");
    $("#load-button").toggle(mode === "Load");
    refreshProjects();
  }

  editor.Commands.add("open-projects", function (ed, sender, options) {
    openProjects((options && options.type) || "Save");
  });

  // ---- project table -----------------------------------------------------
  // A plain table rather than a plugin: it is one list with four columns.
  // Every cell is filled with textContent, because a project's name is text a
  // person typed. Sorting and formatting live in lib/projects-table.js.
  var projectRows = [];
  var projectsMode = "Save";
  // The template picked in the list, if any. Kept apart from the project id
  // because a template and a saved project can share a name.
  var selectedTemplate = null;
  var projectsProblem = null;
  var projectSort = projectsTable.DEFAULT_SORT;
  var projectsBody = document.querySelector("#projects-table tbody");

  function refreshProjects() {
    return fetch("/projects")
      .then(function (res) {
        return res.json();
      })
      .then(function (rows) {
        projectRows = Array.isArray(rows) ? rows : [];
        projectsProblem = null;
        renderProjects();
      })
      .catch(function (err) {
        console.log("Could not load projects", err);
        projectRows = [];
        projectsProblem = "Could not load projects";
        renderProjects();
      });
  }

  function projectCell(text, className) {
    var td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text === null || text === undefined ? "" : String(text);
    return td;
  }

  function renderProjects() {
    var selectedId = document.getElementById("project-name").getAttribute("id-project");

    document.querySelectorAll("#projects-table th[data-sort]").forEach(function (th) {
      if (th.getAttribute("data-sort") === projectSort.key) {
        th.setAttribute("aria-sort", projectSort.direction);
      } else {
        th.removeAttribute("aria-sort");
      }
    });

    projectsBody.textContent = "";

    var rows = projectsTable.orderProjects(
      projectRows,
      projectSort.key,
      projectSort.direction,
      projectsMode === "Load"
    );

    if (projectsProblem || !rows.length) {
      var empty = document.createElement("tr");
      empty.className = "o-empty";
      var message = projectCell(projectsProblem || "No saved projects yet");
      message.colSpan = 4;
      empty.appendChild(message);
      projectsBody.appendChild(empty);
      return;
    }

    rows.forEach(function (row) {
        var tr = document.createElement("tr");
        tr.tabIndex = 0;
        tr.setAttribute(
          "aria-selected",
          String(row.template ? row._id === selectedTemplate : !selectedTemplate && row._id === selectedId)
        );
        var name = projectCell(row.name);
        if (row.template) {
          var badge = document.createElement("span");
          badge.className = "o-badge";
          badge.textContent = "Template";
          name.appendChild(badge);
        }
        tr.appendChild(name);
        tr.appendChild(projectCell(projectsTable.formatSize(row.size), "o-num"));
        tr.appendChild(projectCell(row.date, "o-date"));

        var actions = document.createElement("td");
        actions.className = "o-actions";
        tr.appendChild(actions);
        tr.onclick = function () {
          selectProject(row, tr);
        };
        tr.onkeydown = function (e) {
          // Enter on the delete button belongs to the button.
          if (e.target !== tr) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectProject(row, tr);
          }
        };
        projectsBody.appendChild(tr);

        // Templates ship with OSCAR and cannot be deleted.
        if (row.template) return;

        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "o-icon-btn";
        remove.title = "Delete " + row.name;
        remove.setAttribute("aria-label", "Delete " + row.name);
        // A fixed SVG from ICONS, never anything a person typed.
        remove.innerHTML = icon("remove", 16);
        remove.onclick = function (e) {
          e.stopPropagation();
          confirmRemove(row);
        };
        actions.appendChild(remove);
      });
  }

  // Marks the row in place rather than re-rendering, so a keyboard user's
  // focus stays on the row they just chose.
  function selectProject(row, tr) {
    selectedTemplate = row.template ? row._id : null;
    $("#project-name").val(row.name).attr("id-project", row.template ? "" : row._id);
    templateUrl = row.template ? row.url : null;
    projectsBody.querySelectorAll("tr[aria-selected]").forEach(function (other) {
      other.setAttribute("aria-selected", String(other === tr));
    });
  }

  document.querySelectorAll("#projects-table th[data-sort] .o-sort").forEach(function (button) {
    button.onclick = function () {
      projectSort = projectsTable.nextSort(projectSort, button.parentNode.getAttribute("data-sort"));
      renderProjects();
    };
  });

  function confirmRemove(row) {
    $.confirm({
      title: "Delete Project",
      content:
        "Are you sure you want to delete this project? You won't be able to recover it afterwards.",
      buttons: {
        confirm: function () {
          $.ajax({ type: "DELETE", url: "/remove/" + row._id })
            .done(function (data) {
              refreshProjects();
              $.alert(data.error || data.msg);
            })
            .fail(function () {
              $.alert("Could not delete that project");
            });
        },
        cancel: function () {},
      },
    });
  }

  // ---- save --------------------------------------------------------------
  var projectName = document.getElementById("project-name");

  document.getElementById("save-button").onclick = function () {
    var name = (projectName.value || "").trim();
    if (!name) {
      $.alert("Give your project a name first");
      return;
    }
    saveProject(name, false);
  };

  function saveProject(name, overwrite) {
    showLoader();

    // The project JSON is sent flat alongside OSCAR's own `name`/`overwrite`
    // fields; the server strips those two before writing the file.
    var body = Object.assign(
      { name: name, overwrite: overwrite, grapesjs: grapesjs.version },
      editor.getProjectData()
    );

    postJSON("/save", body)
      .then(function (res) {
        hideLoader();

        if (!res || res.error) {
          $.alert((res && res.error) || "Could not be saved");
          return;
        }

        if (res.confirm) {
          $.confirm({
            title: "Overwriting",
            content: res.confirm,
            buttons: {
              confirm: function () {
                saveProject(name, true);
              },
              cancel: function () {},
            },
          });
          return;
        }

        refreshProjects();
        $.alert(res.msg);
        modal.close();
      })
      .catch(function () {
        hideLoader();
        $.alert("Could not reach the OSCAR server");
      });
  }

  // ---- load --------------------------------------------------------------
  var templateUrl = null;

  document.getElementById("load-button").onclick = function () {
    var id = projectName.getAttribute("id-project");
    if (templateUrl) {
      confirmLoadTemplate(templateUrl);
      return;
    }
    if (!id) {
      $.alert("Pick a project from the list first");
      return;
    }

    $.confirm({
      title: "Load",
      content:
        "If you load this project, you will lose all unsaved changes in the current one.",
      buttons: {
        confirm: function () {
          showLoader();

          fetch("/load/" + encodeURIComponent(id))
            .then(function (res) {
              return res.json();
            })
            .then(function (data) {
              hideLoader();

              if (!data || data.error || !Object.keys(data).length) {
                $.alert((data && data.error) || "That project could not be found");
                return;
              }

              // loadProjectData tears down the current page before reading
              // the new one, so a file that isn't a GrapesJS 0.21+ project
              // leaves the editor with no page at all. Check the shape first.
              if (!isProjectData(data)) {
                $.alert(
                  "This file isn't an OSCAR 2 project, so it can't be opened. " +
                    "Your current project hasn't been changed."
                );
                return;
              }

              editor.loadProjectData(data);
              $.alert("Loaded successfully");
              modal.close();
            })
            .catch(function () {
              hideLoader();
              $.alert("Could not reach the OSCAR server");
            });
        },
        cancel: function () {},
      },
    });
  };

  // ---- pages -------------------------------------------------------------
  // A surface can hold several pages -- a page per fixture group, or per
  // scene. GrapesJS has had the model for this all along (editor.Pages, and a
  // pages array in every project); what it lacks is any way to reach it.
  var pages = editor.Pages;

  function pageLabels() {
    return oscarPages.pageEntries(pages).map(function (entry) {
      return entry.label;
    });
  }

  function labelOf(page) {
    return projectFormat.pageLabel(page.getName(), pages.getAll().indexOf(page));
  }

  /**
   * Ask for a page name in a jquery-confirm form. Not window.prompt: Electron
   * does not implement it, so in the desktop app it would silently return
   * nothing and the page could never be renamed.
   */
  function askPageName(title, current, except, onName) {
    $.confirm({
      title: title,
      content:
        '<form action="" class="oscar-page-name-form">' +
        '<input class="oscar-page-name-input" type="text" maxlength="40" />' +
        "</form>",
      onContentReady: function () {
        var dialog = this;
        var input = dialog.$content.find(".oscar-page-name-input");
        // Set as a value, not written into the markup: a page name is
        // whatever someone typed.
        input.val(current).trigger("focus").trigger("select");
        dialog.$content.find("form").on("submit", function (e) {
          // Enter submits the form; without this the page would reload.
          e.preventDefault();
          dialog.$$confirm.trigger("click");
        });
      },
      buttons: {
        confirm: function () {
          var name = (this.$content.find(".oscar-page-name-input").val() || "").trim();
          if (!name) {
            $.alert("Give the page a name");
            return false;
          }
          // Two tabs reading the same cannot be told apart on a tablet.
          if (oscarPages.nameTaken(pageLabels(), name, except)) {
            $.alert('There is already a page called "' + name + '"');
            return false;
          }
          onName(name);
        },
        cancel: function () {},
      },
    });
  }

  function deletePage(page) {
    // Never the last one: GrapesJS would be left with no page to draw, and a
    // project with no pages is one OSCAR refuses to open.
    if (pages.getAll().length < 2) return;

    $.confirm({
      title: "Delete Page",
      // Built as text for the same reason as above.
      content: $("<div>").text(
        'Delete "' + labelOf(page) + '" and every widget on it? You won\'t be able to recover it afterwards.'
      ),
      buttons: {
        confirm: function () {
          if (pages.getAll().length < 2) return;
          // Move off the page first, so the canvas is never showing a page
          // that no longer exists.
          if (pages.getSelected() === page) {
            var all = pages.getAll();
            var index = all.indexOf(page);
            pages.select(all[index === 0 ? 1 : index - 1]);
          }
          pages.remove(page);
        },
        cancel: function () {},
      },
    });
  }

  function pageAction(label, title, onClick) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "oscar-page-action";
    button.textContent = label;
    button.setAttribute("aria-label", title);
    button.onclick = onClick;
    return button;
  }

  function renderPages() {
    var list = document.getElementById("pages-list");
    if (!list) return;

    var all = pages.getAll();
    list.innerHTML = "";

    oscarPages.pageEntries(pages).forEach(function (entry, index) {
      var page = all[index];
      var row = document.createElement("li");
      row.className = "oscar-page" + (entry.current ? " oscar-page-current" : "");

      var open = document.createElement("button");
      open.type = "button";
      open.className = "oscar-page-open";
      open.textContent = entry.label;
      open.onclick = function () {
        pages.select(page);
      };
      row.appendChild(open);

      row.appendChild(
        pageAction("Rename", "Rename " + entry.label, function () {
          askPageName("Rename page", entry.label, index, function (name) {
            page.setName(name);
          });
        })
      );

      if (all.length > 1) {
        row.appendChild(
          pageAction("Delete", "Delete " + entry.label, function () {
            deletePage(page);
          })
        );
      }

      list.appendChild(row);
    });
  }

  function addPage() {
    var input = document.getElementById("new-page-name");
    var name = ((input && input.value) || "").trim();

    if (name && oscarPages.nameTaken(pageLabels(), name)) {
      $.alert('There is already a page called "' + name + '"');
      return;
    }

    // Naming it is optional; a page left unnamed is given a name, because
    // GrapesJS would drop an empty one. Not simply "Page <count + 1>": after
    // a deletion that name may still be on another tab.
    var page = pages.add({ name: name || oscarPages.freePageName(pageLabels()) }, { select: true });
    if (!page) {
      $.alert("That page could not be added");
      return;
    }
    if (input) input.value = "";
  }

  editor.Commands.add("open-pages", function () {
    renderPages();
    setModal("Pages", "pages-panel");
  });

  document.getElementById("add-page-button").onclick = addPage;
  document.getElementById("new-page-name").onkeydown = function (e) {
    if (e.key === "Enter") addPage();
  };

  // The list may be open while pages change under it (a rename, a load).
  // page:update is what a rename fires, and it is also what tells the
  // storage manager the project changed.
  editor.on("page:add page:remove page:select page:update", renderPages);

  /**
   * Open a template: an HTML file with its CSS, read exactly the way Import
   * reads pasted code. Everything in the current surface is replaced, and the
   * name is cleared so the first save asks for a new one rather than
   * suggesting the template's.
   */
  function confirmLoadTemplate(url) {
    $.confirm({
      title: "Load",
      content:
        "If you load this template, you will lose all unsaved changes in the current project.",
      buttons: {
        confirm: function () {
          showLoader();

          fetch(url)
            .then(function (res) {
              if (!res.ok) throw new Error("status " + res.status);
              return res.text();
            })
            .then(function (html) {
              hideLoader();
              loadTemplate(html);
              selectedTemplate = null;
              templateUrl = null;
              $("#project-name").val("").attr("id-project", "");
              $.alert("Loaded successfully");
              modal.close();
            })
            .catch(function () {
              hideLoader();
              $.alert("That template could not be opened");
            });
        },
        cancel: function () {},
      },
    });
  }

  function loadTemplate(html) {
    editor.select();
    editor.Css.clear();
    // Nothing from the surface being replaced carries over; the template's
    // own style is put back while it is read.
    editor.getWrapper().setAttributes({});
    editor.setComponents(html);
    editor.UndoManager.clear();
  }

  // ---- preview mode ------------------------------------------------------
  // GrapesJS's preview hides the panels but leaves components draggable in
  // absolute mode, so dragging a button in preview pulls it apart.
  //
  // This locks the components rather than swallowing events in the canvas. An
  // earlier version did the latter, and it blocked pointerdown and touchmove
  // -- which is exactly what a drag-based widget like the XY pad needs, so it
  // would have been dead in preview. The button survived only because it uses
  // click, and the slider because its dragging is a browser default action.
  //
  // Locking components is what corrupted projects once, by being saved. It is
  // safe now: editor state is stripped on every path in and out of storage, so
  // it cannot persist. The /preview page has always worked this way.
  var PREVIEW_LOCK = {
    draggable: false,
    selectable: false,
    hoverable: false,
    editable: false,
    highlightable: false,
  };
  // Only the page on the canvas has components to lock. A page switched to
  // mid-preview arrives unlocked, so it is locked as it comes in; the lock
  // remembers what it has touched, so coming back to a page does not record
  // its locked state as the one to restore (see createLock).
  var previewLock = oscarPages.createLock(PREVIEW_LOCK, { avoidStore: true });
  var previewing = false;

  // The designer's preview shows the same tabs the tablet does: a surface
  // with several pages cannot be tried out from page one alone.
  var previewTabs = oscarPages.pageTabs(editor, {
    bar: document.getElementById("oscar-page-bar"),
    body: document.body,
    windows: function () {
      return oscarPages.widgetWindows(editor, window);
    },
  });

  // Only while previewing: a project being edited changes under a widget in
  // ways a viewless copy is never told about.
  var offstage = runOffstage(editor, { document: document });

  editor.on("page:select", function () {
    if (!previewing) return;
    editor.select();
    previewLock.lock(editor.getWrapper());
  });

  editor.on("command:run:preview", function () {
    // Hand the canvas to the preview page before locking, so the lock doesn't
    // travel with it. Every page goes across, not only the one showing, and
    // named, so a tab never has to guess.
    postJSON("/save/preview", {
      project: projectFormat.namePages(editor.getProjectData()),
    }).catch(function (err) {
      console.log("Could not hand off preview", err);
    });

    editor.select();
    previewing = true;
    previewLock.lock(editor.getWrapper());
    previewTabs.show();
    // As on the tablet: a fader on a page that is not showing still follows
    // the rig, or trying a surface out here would not show what it does.
    offstage.start();

    // The selection toolbar, badges and resize handles live outside the canvas
    // and would otherwise float over the control surface, delete button and
    // all.
    editor.getEl().classList.add("oscar-previewing");
  });

  editor.on("command:stop:preview", function () {
    previewing = false;
    offstage.stop();
    previewLock.release();
    previewTabs.hide();
    editor.getEl().classList.remove("oscar-previewing");
  });

  // ---- panel buttons -----------------------------------------------------
  // ---- widget styles -----------------------------------------------------
  // A style is chosen for the whole surface and recorded as two attributes on
  // its body, so it is saved with the project and reaches the preview and
  // every tablet with nothing else to set. lib/widget-styles.js lists the
  // styles; assets/css/styles/ holds their values.

  function surfaceStyle() {
    var attrs = editor.getWrapper().getAttributes();
    var style = attrs[widgetStyles.STYLE_ATTRIBUTE];
    var appearance = attrs[widgetStyles.APPEARANCE_ATTRIBUTE];
    return {
      style: widgetStyles.isStyle(style) ? style : widgetStyles.DEFAULT_STYLE,
      appearance: widgetStyles.isAppearance(appearance) ? appearance : widgetStyles.DEFAULT_APPEARANCE,
    };
  }

  function applySurfaceStyle(style, appearance) {
    var attrs = {};
    attrs[widgetStyles.STYLE_ATTRIBUTE] = style;
    attrs[widgetStyles.APPEARANCE_ATTRIBUTE] = appearance;
    editor.getWrapper().addAttributes(attrs);
  }

  /**
   * A small document showing the real widgets in one style: the same fonts,
   * tokens and widget rules the canvas loads, so a card looks exactly like the
   * surface will. Everything in it comes from the style registry, never from
   * anything a person typed.
   */
  function stylePreviewDocument(style, appearance) {
    var links = widgetStyles
      .canvasStylesheets()
      .map(function (href) {
        return '<link rel="stylesheet" href="' + href + '">';
      })
      .join("");

    return (
      '<!doctype html><html><head><meta charset="utf-8">' +
      links +
      "<style>" +
      widgetStyles.SURFACE_CSS +
      " body { height: 100vh; display: flex; align-items: center; justify-content: center;" +
      " gap: 10px; padding: 8px; overflow: hidden; }" +
      " .col { display: flex; flex-direction: column; gap: 8px; }" +
      " button { min-height: 28px; padding: 0 10px; font-size: 12px; }" +
      " input[type=range] { width: 64px; height: 22px; }" +
      " .oscar-xypad { width: 56px; height: 56px; flex-shrink: 0; }" +
      "</style></head>" +
      "<body " +
      widgetStyles.STYLE_ATTRIBUTE + '="' + style + '" ' +
      widgetStyles.APPEARANCE_ATTRIBUTE + '="' + appearance + '">' +
      '<div class="col"><button type="button">Off</button>' +
      '<button type="button" class="toggle">On</button>' +
      '<input type="range" min="0" max="100" value="60" style="--oscar-fill: 60%"></div>' +
      '<div class="oscar-xypad" style="--oscar-x: 65%; --oscar-y: 35%"></div>' +
      "</body></html>"
    );
  }

  var stylePanel = null;

  function buildStylePanel() {
    var panel = document.createElement("div");
    panel.className = "o-style-panel";

    var segmented = document.createElement("div");
    segmented.className = "o-segmented";
    segmented.setAttribute("role", "group");
    segmented.setAttribute("aria-label", "Appearance");
    widgetStyles.APPEARANCES.forEach(function (appearance) {
      var segment = document.createElement("button");
      segment.type = "button";
      segment.className = "o-segment";
      segment.setAttribute("data-appearance", appearance);
      segment.textContent = appearance === "dark" ? "Dark" : "Light";
      segment.onclick = function () {
        applySurfaceStyle(surfaceStyle().style, appearance);
        refreshStylePanel();
      };
      segmented.appendChild(segment);
    });

    var grid = document.createElement("div");
    grid.className = "o-style-grid";
    widgetStyles.CHOICES.forEach(function (entry) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "o-style-card";
      card.setAttribute("data-style", entry.id);

      if (entry === widgetStyles.OWN_STYLE) {
        // Nothing to picture: how it looks is whatever the page says. The
        // name stands alone in the middle, and the hint says what it means.
        card.className += " o-style-card-own";
        card.title = entry.hint;
      } else {
        // The preview is only a picture: the card is what gets clicked.
        var preview = document.createElement("iframe");
        preview.className = "o-style-preview";
        preview.tabIndex = -1;
        preview.setAttribute("aria-hidden", "true");
        card.appendChild(preview);
      }

      var name = document.createElement("span");
      name.className = "o-style-name";
      name.textContent = entry.label;
      card.appendChild(name);

      card.onclick = function () {
        applySurfaceStyle(entry.id, surfaceStyle().appearance);
        refreshStylePanel();
      };
      grid.appendChild(card);
    });

    panel.appendChild(segmented);
    panel.appendChild(grid);
    return panel;
  }

  function refreshStylePanel() {
    var current = surfaceStyle();

    stylePanel.querySelectorAll(".o-segment").forEach(function (segment) {
      segment.setAttribute("aria-pressed", String(segment.getAttribute("data-appearance") === current.appearance));
    });

    stylePanel.querySelectorAll(".o-style-card").forEach(function (card) {
      var style = card.getAttribute("data-style");
      card.setAttribute("aria-pressed", String(style === current.style));
      var preview = card.querySelector("iframe");
      if (!preview) return;
      // Rewriting the document restarts it; only do that when the picture
      // would actually change.
      var wanted = style + "/" + current.appearance;
      if (preview.getAttribute("data-showing") !== wanted) {
        preview.setAttribute("data-showing", wanted);
        preview.srcdoc = stylePreviewDocument(style, current.appearance);
      }
    });
  }

  editor.Commands.add("open-styles", function () {
    if (!stylePanel) stylePanel = buildStylePanel();
    refreshStylePanel();
    modal.open({ title: "Widget style", content: stylePanel, attributes: { class: "modal-login" } });
  });

  pn.addButton("options", {
    id: "open-styles",
    label: icon("palette"),
    command: function () {
      editor.runCommand("open-styles");
    },
    attributes: { title: "Widget style", "data-tooltip-pos": "bottom" },
  });

  // Reset to style: a widget someone recoloured by hand keeps that colour when
  // the surface changes style, which reads as switching "not working". This
  // takes its own appearance edits away so it follows the style again, and
  // leaves where it is and how big it is alone.
  editor.Commands.add("oscar-reset-style", function (ed) {
    var component = ed.getSelected();
    if (!component) return;
    component.setStyle(widgetStyles.withoutAppearance(component.getStyle()));
  });

  // Offered on OSCAR's own widgets and on the body, in the toolbar over a
  // selection. GrapesJS never saves a component's toolbar into the project,
  // so this editor-only button cannot leak into a saved file.
  editor.on("component:selected", function (component) {
    if (!widgetStyles.offersReset(component.get("type"))) return;
    var toolbar = component.get("toolbar") || [];
    var present = toolbar.some(function (item) {
      return item.command === "oscar-reset-style";
    });
    if (present) return;
    component.set(
      "toolbar",
      toolbar.concat([
        {
          label: icon("restore", 16),
          command: "oscar-reset-style",
          attributes: { title: "Reset to style" },
        },
      ])
    );
  });

  pn.addButton("options", {
    id: "open-save",
    label: icon("save"),
    command: function () {
      editor.runCommand("open-projects", { type: "Save" });
    },
    attributes: { title: "Save project", "data-tooltip-pos": "bottom" },
  });

  pn.addButton("options", {
    id: "open-pages",
    label: icon("pages"),
    command: function () {
      editor.runCommand("open-pages");
    },
    attributes: { title: "Pages", "data-tooltip-pos": "bottom" },
  });

  pn.addButton("options", {
    id: "open-load",
    label: icon("open"),
    command: function () {
      editor.runCommand("open-projects", { type: "Load" });
    },
    attributes: { title: "Load project", "data-tooltip-pos": "bottom" },
  });

  // ---- export ------------------------------------------------------------
  // Distinct from "See code" beside it, which is GrapesJS's own view of the
  // markup and cannot send anything. This one produces a file that does.
  oscarExport.install(editor, {
    host: ipServer,
    port: socketPort,
    projectName: function () {
      return projectName ? projectName.value : "";
    },
  });

  pn.addButton("options", {
    id: "oscar-export",
    label: icon("upload"),
    command: function () {
      editor.runCommand("oscar-export");
    },
    attributes: { title: "Publish your interface", "data-tooltip-pos": "bottom" },
  });

  // ---- locked mode -------------------------------------------------------
  // Locking leaves the control surface open to the network while the editor
  // answers only this computer. A locked OSCAR that looked unlocked would be
  // its own hazard, so the button states its condition plainly.
  var lockButtonId = "toggle-lock";

  function paintLockButton(locked) {
    var el = document.querySelector(".gjs-pn-options .oscar-lock-btn");
    if (!el) return;
    el.innerHTML = icon(locked ? "locked" : "unlocked");
    el.setAttribute("data-tooltip", locked ? "Locked: tap to allow editing" : "Lock editing");
    el.setAttribute("data-tooltip-pos", "bottom");
    el.classList.toggle("oscar-locked", !!locked);
  }

  function setLocked(locked) {
    postJSON("/lock", { locked: locked })
      .then(function (res) {
        if (res && res.error) {
          $.alert(res.error);
          return;
        }
        paintLockButton(res && res.locked);
      })
      .catch(function () {
        $.alert("Could not change the lock");
      });
  }

  pn.addButton("options", {
    id: lockButtonId,
    className: "oscar-lock-btn",
    label: icon("unlocked"),
    command: function () {
      var el = document.querySelector(".gjs-pn-options .oscar-lock-btn");
      setLocked(!(el && el.classList.contains("oscar-locked")));
    },
    attributes: { title: "Lock editing", "data-tooltip-pos": "bottom" },
  });

  fetch("/lock")
    .then(function (res) {
      return res.json();
    })
    .then(function (state) {
      paintLockButton(state && state.locked);
    })
    .catch(function () {});

  // ---- serial -------------------------------------------------------------
  // The panel is its own script (oscar_serial.js); it adds its own button
  // here, between the lock and About.
  if (typeof oscar_serial === "function") {
    oscar_serial({
      panels: pn,
      openModal: function () {
        setModal("Serial (Arduino)", "serial-panel");
      },
      alert: function (text) {
        $.alert(text);
      },
    });
  }

  pn.addButton("options", {
    id: "open-info",
    label: icon("help"),
    command: function () {
      setModal("About", "info-panel");
    },
    attributes: { title: "About", "data-tooltip-pos": "bottom" },
  });

  pn.addButton("devices-c", {
    id: "ipButton",
    className: "oscar-ip-label",
    label: "Server IP: " + ipServer,
    command: null,
    attributes: { title: "Point other devices at this address" },
    active: false,
    disable: true,
  });

  // ---- tooltips ----------------------------------------------------------
  // GrapesJS renders the panels during init, before any of this runs, and a
  // button does not re-render when its attributes change afterwards. Setting
  // the model alone is silently ignored, so the text is written onto the
  // elements as well. Buttons render in the order the panel holds them.
  // ---- toolbar order -----------------------------------------------------
  // Every button exists by now. GrapesJS can only append, so the ones that
  // belong elsewhere are moved: in the panel's own list and on the page
  // together, because retitle() below pairs the two by position.
  (function arrangeToolbar() {
    var panel = pn.getPanel("options");
    var row = document.querySelector(".gjs-pn-options .gjs-pn-buttons");
    if (!panel || !row) return;

    var buttons = panel.get("buttons");
    var models = buttons.models.slice();
    var els = Array.prototype.slice.call(row.querySelectorAll(".gjs-pn-btn"));
    // If the two ever disagree, moving either would mislabel the rest.
    if (models.length !== els.length) return;

    var ids = models.map(function (model) {
      return model.get("id");
    });
    var wanted = toolbarOrder.arrange(ids);

    wanted.forEach(function (id) {
      row.appendChild(els[ids.indexOf(id)]);
    });
    // Silent: the panel's view answers a reset by drawing every button again,
    // which would throw away the elements just moved.
    buttons.reset(
      wanted.map(function (id) {
        return models[ids.indexOf(id)];
      }),
      { silent: true }
    );
  })();

  function retitle(panelId, labels) {
    var panel = pn.getPanel(panelId);
    var els = document.querySelectorAll(".gjs-pn-" + panelId + " .gjs-pn-btn");
    if (!panel || !els.length) return;

    panel.get("buttons").forEach(function (button, index) {
      var label = labels[button.get("id")];
      var el = els[index];
      if (!label || !el) return;

      button.set("attributes", { title: label, "data-tooltip-pos": "bottom" });
      el.setAttribute("data-tooltip", label);
      el.setAttribute("data-tooltip-pos", "bottom");
      el.setAttribute("title", "");
    });
  }

  retitle("options", {
    "sw-visibility": "Show borders",
    // "Push", not "Preview": this is also what sends the layout to the
    // /preview page, which keeps showing the last pushed version until it is.
    preview: "Push to preview",
    fullscreen: "Fullscreen",
    "export-template": "See code",
    undo: "Undo",
    redo: "Redo",
    // Says what goes in. "Import" alone sat beside Load, which also brings
    // something in, and templates -- the other thing one might import -- are
    // opened from Load.
    "gjs-open-import-webpage": "Import HTML/CSS",
    "canvas-clear": "Clear canvas",
    "toggle-lock": null,
    "open-styles": "Widget style",
    "open-save": "Save project",
    "open-load": "Load project",
    "open-pages": "Pages",
    "oscar-export": "Publish your interface",
    "open-info": "About",
  });

  retitle("views", {
    "open-sm": "Style Manager",
    "open-tm": "OSC Settings",
    "open-layers": "Layers",
    "open-blocks": "Blocks",
  });

  // Anything else that still carries a title (modal contents, for instance).
  var titles = document.querySelectorAll("*[title]");
  for (var i = 0; i < titles.length; i++) {
    var el = titles[i];
    var title = (el.getAttribute("title") || "").trim();
    if (!title) continue;
    el.setAttribute("data-tooltip", title);
    el.setAttribute("title", "");
  }
}

},{"../../lib/html-document":4,"../../lib/project-format":8,"../../lib/projects-table":9,"../../lib/toolbar-order":12,"../../lib/widget-styles":13,"./adapters/grapesjs":34,"./export_dialog":35,"./pages":38,"jquery":32,"jquery-confirm":31}],37:[function(require,module,exports){
window.$ = window.jQuery = require("jquery");

// Every widget in lib/widgets/registry.js, wired to GrapesJS by the adapter.
var { widgetPlugins, runOffstage, followSurfaceStyle } = require("./adapters/grapesjs");
var widgetStyles = require("../../lib/widget-styles");

// Tabs, and the rule for staying on a page across a push; shared with the
// editor so its preview draws the same thing the tablet does.
var oscarPages = require("./pages");

var editor;
var tabs = null;
var offstage = null;

// One browserify bundle serves both the editor and the preview page, so each
// entry point only boots when its own container is on the page.
if (document.getElementById("gjs-oscar-preview")) {
  // Ask the server which address it is reachable on, so widgets default to
  // something other devices on the network can actually talk to.
  fetch("/connection")
    .then(function (res) {
      return res.json();
    })
    .catch(function () {
      return {};
    })
    .then(function (conn) {
      initGrape(conn.address || window.location.hostname || "localhost", conn.socketPort || 8081);
    });
}

function initGrape(ipServer, socketPort) {
  editor = grapesjs.init({
    // No Font Awesome from a CDN: every tablet would make a request that fails
    // at a venue with no internet, and nothing on this page uses it.
    cssIcons: "",
    height: "100%",
    container: "#gjs-oscar-preview",
    allowScripts: 1,
    panels: { defaults: [] },
    // No select tool on this page, ever. GrapesJS restarts its default command
    // whenever a page or project loads, preview mode or not, and that command
    // cancels every click in the canvas so it can select what was clicked.
    // A colour picker opens as the default action of a click, so with the tool
    // running it never opened on a tablet; buttons, sliders and text boxes
    // work by other means, which is why it went unnoticed.
    defaultCommand: "",
    // The same fonts, styles and widgets as the editor, so a tablet shows the
    // surface in the style it was designed in.
    canvas: { styles: widgetStyles.canvasStylesheets() },
    protectedCss: widgetStyles.SURFACE_CSS,
    // The preview only displays whatever the editor handed over; it must never
    // write into the editor's autosave.
    storageManager: false,
    plugins: [
      "oscar_socket",
      "oscar_ip",
      ...widgetPlugins(ipServer),
      "grapesjs-touch",
    ],
    pluginsOpts: {
      // `surface`: this page is a device showing the layout, so it agrees with
      // the others on what each widget shows. The editor never sets it.
      oscar_socket: { ipserver: ipServer, socketPort: socketPort, surface: true },
    },
  });

  tabs = oscarPages.pageTabs(editor, {
    bar: document.getElementById("oscar-page-bar"),
    body: document.body,
    windows: heldWindows,
  });

  // A page that is not showing still has to hear the rig, or its faders come
  // back where they were left rather than where the rig put them.
  offstage = runOffstage(editor, { document: document });

  // Pages.select brings the next page in with its components unlocked: the
  // lock was set on the components of the page that was showing, and these
  // are not those. On every switch, whoever asked for it -- a tab, or the
  // reselect after a push -- the page that came in is locked before anyone
  // can put a finger on it.
  editor.on("page:select", function () {
    lockDown();
    // The rig's word on a widget is recorded by the server but told to no
    // device, since every device showing that widget heard the rig itself
    // (lib/shared-sync.js). A device that was on another page did not, so
    // what it has cached for the page coming in may be behind. Ask again.
    if (editor.syncSharedState) editor.syncSharedState();
  });

  // The canvas body follows the style the surface was designed in.
  followSurfaceStyle(editor, widgetStyles.copyToBody);

  editor.on("load", function () {
    showLatest();

    // The editor's "Push to preview" button tells the server, which tells
    // every open preview page. Without this a tablet keeps showing the
    // previous push until someone walks over and reloads it.
    if (editor.socket) {
      editor.socket.on("preview:updated", showLatest);
    }
  });
}

function heldWindows() {
  return oscarPages.widgetWindows(editor, window);
}

/** Fetch whatever was last pushed and display it, ready to drive a show. */
function showLatest() {
  return fetch("/show/preview")
    .then(function (res) {
      return res.json();
    })
    .then(function (data) {
      // loadProjectData tears down the current page before reading the new
      // one, so only hand it something shaped like a GrapesJS project.
      if (!data || !Array.isArray(data.pages) || !data.pages.length) return;

      // A push mid-show must not throw whoever is driving back to page one.
      var wasOn = oscarPages.currentPageId(editor.Pages);

      // The load tears every view down, exactly as a page turn does: a
      // button held through a push must send its release first.
      oscarPages.releaseHeld(heldWindows());

      editor.loadProjectData(data);
      oscarPages.reselect(editor.Pages, wasOn);

      // Locked here as well as on page:select: a project that opens on the
      // page it was already on selects nothing.
      lockDown();
      tabs.show();
      // The load replaced every component; the widgets of the pages not
      // showing are the new project's from here on.
      offstage.start();
    })
    .catch(function (err) {
      console.log("Could not load the preview", err);
    });
}

/**
 * A preview is for driving the show, not editing it.
 *
 * Safe to set on the components here, unlike in the editor: this page never
 * saves anything (storageManager is off), so none of it can reach a file.
 *
 * Only the page on the canvas is reached: getWrapper() is that page's, and
 * the components of the others are locked as each is switched to.
 */
function lockDown() {
  editor.getWrapper().onAll(function (component) {
    component.set({
      editable: false,
      selectable: false,
      hoverable: false,
      draggable: false,
      highlightable: false,
    });
  });

  // GrapesJS's own preview mode hides the panels and makes the canvas full
  // size. Its "exit preview" button is hidden in preview.ejs.
  if (!editor.Commands.isActive("preview")) editor.runCommand("preview");
}

},{"../../lib/widget-styles":13,"./adapters/grapesjs":34,"./pages":38,"jquery":32}],38:[function(require,module,exports){
/**
 * Multiple pages: what the editor and the control surface have in common.
 *
 * A surface can hold more than one page -- a page per fixture group, or per
 * scene. The designer manages them in the editor; whoever drives the show
 * switches between them with a row of tabs. Both entry points require this
 * file, so the tabs the designer sees while previewing are the ones the
 * tablet draws.
 *
 * Nothing here touches `window` or GrapesJS when it is loaded: every function
 * is handed what it works on, which is what lets test/pages.test.js run it
 * under plain Node.
 */

var projectFormat = require("../../lib/project-format");

/**
 * The pages as a list of { id, label, current }.
 *
 * The label comes from lib/project-format.js, the same function that names
 * pages in a file: GrapesJS drops an empty page name when it saves, so page
 * one routinely has none, and a tab has to print something.
 */
function pageEntries(pages) {
  var selected = pages.getSelected();
  var selectedId = selected ? selected.getId() : null;
  return pages.getAll().map(function (page, index) {
    return {
      id: page.getId(),
      label: projectFormat.pageLabel(page.getName(), index),
      current: page.getId() === selectedId,
    };
  });
}

/**
 * Is `name` already the label of a page other than the one at `except`?
 *
 * Compared as the tabs print them, so "Page 2" typed by hand meets the
 * "Page 2" an unnamed second page is shown as.
 */
function nameTaken(labels, name, except) {
  var wanted = String(name).trim();
  return labels.some(function (label, index) {
    return index !== except && label === wanted;
  });
}

/**
 * The name for a page added without one: the first "Page N", counting up
 * from its position, that no tab already carries. By position alone, deleting
 * "Page 1" of two and adding a page made a second "Page 2".
 */
function freePageName(labels) {
  var index = labels.length;
  while (nameTaken(labels, projectFormat.defaultPageName(index))) index++;
  return projectFormat.defaultPageName(index);
}

/** The id of the page on the canvas, or null before there is one. */
function currentPageId(pages) {
  var selected = pages.getSelected();
  return selected ? selected.getId() : null;
}

/**
 * Go back to the page someone was on, if the project still has it.
 *
 * A push mid-show reloads the whole project, and GrapesJS opens a loaded
 * project on its first page. Whoever is driving page three must not be thrown
 * back to page one with a cue coming. Page ids are saved in the project, so
 * the same page carries the same id across pushes; one that was deleted in
 * the meantime is simply not there, and the first page is the honest answer.
 *
 * @returns true when the page was found and is now selected
 */
function reselect(pages, id) {
  if (!id) return false;
  var page = pages.get(id);
  if (!page) return false;
  if (currentPageId(pages) !== id) pages.select(page);
  return true;
}

/**
 * A lock that can be taken page by page and undone in one go.
 *
 * GrapesJS only builds the components of the page on the canvas, and
 * Pages.select brings the next page in untouched: whatever locked the first
 * page has not locked this one. So the lock is applied again on every switch.
 * Coming back to a page already locked must not record its locked values as
 * "what it was before", or undoing the lock would restore the lock; each
 * component is therefore remembered the first time it is touched and never
 * again.
 *
 * `options` is passed to component.set -- the editor passes avoidStore, so
 * locking never counts as an edit.
 */
function createLock(props, options) {
  var keys = Object.keys(props);
  // A Map, not a WeakMap: release() has to walk it.
  var touched = new Map();

  return {
    /** Lock every component under `root` that is not locked already. */
    lock: function (root) {
      if (!root || typeof root.onAll !== "function") return;
      root.onAll(function (component) {
        if (!touched.has(component)) {
          var previous = {};
          keys.forEach(function (key) {
            previous[key] = component.get(key);
          });
          touched.set(component, previous);
        }
        component.set(props, options);
      });
    },

    /** Put every component this lock touched back as it was found. */
    release: function () {
      touched.forEach(function (previous, component) {
        component.set(previous, options);
      });
      touched.clear();
    },

    get size() {
      return touched.size;
    },
  };
}

/**
 * Let go of every control a finger is on, before the page under it goes.
 *
 * Turning the page destroys the views of the page that was showing. A
 * momentary button held with one finger while another taps a tab has sent
 * its ON; its element is gone before the finger comes up, so the pointerup
 * lands nowhere and OFF never reaches the rig -- the fixture stays on, and
 * every tablet draws the button lit. The widgets already have a word for
 * "the hand is gone": a drag that loses the window counts as released
 * (the ctx contract in lib/widgets/index.js), which every widget that can be
 * held listens for as `blur` on its window. So that is what is said here,
 * while the widgets are still attached and can still send.
 *
 * `windows` is every window a widget may be listening on: the page's own
 * and the canvas frame's. One that is missing, or cannot dispatch, is
 * skipped -- a page turn must not fail on it.
 */
function releaseHeld(windows) {
  (windows || []).forEach(function (win) {
    if (!win || typeof win.dispatchEvent !== "function") return;
    var EventType = win.Event || (typeof Event === "function" ? Event : null);
    if (!EventType) return;
    try {
      win.dispatchEvent(new EventType("blur"));
    } catch (err) {
      console.warn("Could not release the controls being held:", err && err.message);
    }
  });
}

/** The windows a widget of this editor may be listening on. */
function widgetWindows(editor, top) {
  var windows = top ? [top] : [];
  var frame = editor && editor.Canvas && typeof editor.Canvas.getWindow === "function" ? editor.Canvas.getWindow() : null;
  if (frame && frame !== top) windows.push(frame);
  return windows;
}

/**
 * Draw the tabs into `bar`, and report whether there are any.
 *
 * The bar lives outside the GrapesJS canvas on purpose. Anything inside the
 * canvas loses its events to the preview lock, and a tab drawn as a component
 * is one the next person to edit the project can drag away or delete.
 *
 * A single page gets no bar at all: it would only take room from the
 * controls, and there is nowhere to switch to.
 */
function renderTabs(doc, bar, entries, onPick) {
  while (bar.firstChild) bar.removeChild(bar.firstChild);

  if (entries.length < 2) {
    bar.hidden = true;
    return false;
  }

  entries.forEach(function (entry) {
    var tab = doc.createElement("button");
    tab.type = "button";
    tab.className = "oscar-page-tab" + (entry.current ? " oscar-page-tab-current" : "");
    // textContent, never innerHTML: a page name is whatever someone typed.
    tab.textContent = entry.label;
    tab.setAttribute("aria-pressed", entry.current ? "true" : "false");
    tab.onclick = function () {
      if (!entry.current) onPick(entry.id);
    };
    bar.appendChild(tab);
  });

  bar.hidden = false;
  return true;
}

/**
 * Keep a tab bar in step with the editor's pages.
 *
 *   var tabs = pageTabs(editor, { bar, body, onSwitch });
 *   tabs.show() / tabs.hide() / tabs.render()
 *
 * `body` carries the oscar-has-pages class while the bar is up; the
 * stylesheet shortens the editor by the bar's height on that class, rather
 * than letting the bar float over the bottom row of someone's controls.
 * `onSwitch` runs after every page change made through the tabs.
 * `windows`, a function returning the windows the widgets listen on, is how
 * a tab lets go of whatever is being held before the page goes (releaseHeld).
 */
function pageTabs(editor, options) {
  var bar = options.bar;
  var body = options.body;
  var doc = options.document || bar.ownerDocument;
  var showing = false;

  function pick(id) {
    var page = editor.Pages.get(id);
    if (!page) return;
    // Before the select, not after: by then the held widget is detached and
    // has nothing left to send its release with.
    if (options.windows) releaseHeld(options.windows());
    editor.Pages.select(page);
    // The page:select listener below redraws; onSwitch is for the caller's
    // own follow-up (locking the page that came in).
    if (options.onSwitch) options.onSwitch(page);
  }

  function render() {
    var up = showing && renderTabs(doc, bar, pageEntries(editor.Pages), pick);
    if (!showing) bar.hidden = true;
    var had = body.classList.contains("oscar-has-pages");
    body.classList.toggle("oscar-has-pages", !!up);
    // The canvas measures itself once; tell it the room it has changed.
    if (had !== !!up && typeof editor.refresh === "function") editor.refresh();
  }

  if (typeof editor.on === "function") {
    editor.on("page:select page:add page:remove page:update", render);
  }

  return {
    render: render,
    show: function () {
      showing = true;
      render();
    },
    hide: function () {
      showing = false;
      render();
    },
  };
}

module.exports = {
  pageEntries: pageEntries,
  currentPageId: currentPageId,
  reselect: reselect,
  createLock: createLock,
  nameTaken: nameTaken,
  freePageName: freePageName,
  releaseHeld: releaseHeld,
  widgetWindows: widgetWindows,
  renderTabs: renderTabs,
  pageTabs: pageTabs,
};

},{"../../lib/project-format":8}]},{},[37,36]);
