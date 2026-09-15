(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

const { MAX_LEVEL } = require("./spec");

/**
 * Turning what a control is worth into what a DMX slot can hold.
 *
 * Every function here returns null rather than a number it had to invent. The
 * reasoning is lib/osc-message.js's, and it matters more here: a DMX slot is
 * unsigned, 0 is a real command meaning "off", and Number(null), Number("") and
 * Number(false) are all 0. A value that arrived broken must not reach a dimmer
 * as a blackout.
 */

/** A number, or null -- never an accidental zero. */
function toNumber(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "boolean") return null;
  if (typeof raw === "object") return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

/** A whole number inside a range, or null. Used for universes and channels. */
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
 * Where a control sits within its own range, as 0..1, or null.
 *
 * This is the one place a widget's units (0-100, -1..1, 20-2000Hz) are turned
 * into something protocol-neutral, so the widget keeps owning its range and
 * DMX never has to know what a slider was labelled.
 *
 * A range of zero width is not scalable. Returning 0 there would look like a
 * value; it is the absence of one.
 */
function unitOf(value, min, max) {
  const v = toNumber(value);
  const lo = toNumber(min);
  const hi = toNumber(max);
  if (v === null || lo === null || hi === null || hi === lo) return null;
  return clamp((v - lo) / (hi - lo), 0, 1);
}

/**
 * 0..1 -> 0..255.
 *
 * Clamped before rounding, deliberately: a control that overshoots its range
 * should pin at full or at zero, which is what the fixture can do anyway. That
 * is a different thing from a value that could not be read, which is null.
 */
function toLevel(unit) {
  const number = toNumber(unit);
  if (number === null) return null;
  return Math.round(clamp(number, 0, 1) * MAX_LEVEL);
}

/**
 * A list of 0..1 values -> a list of levels, or null if any one of them fails.
 *
 * One bad coordinate spoils the set, the same way a half-built OSC message is
 * refused: sending pan without tilt puts a light somewhere nobody asked for.
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
 * Lay a widget's levels across the channel block it was given.
 *
 * Values fill in order and the last one repeats to the end, so one slider over
 * three channels dims an RGB fixture as a whole, while an XY pad over two
 * channels lands on pan and tilt. A block shorter than the widget's values
 * truncates -- the settings panel is where that gets pointed out.
 */
function spread(levels, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(levels[Math.min(i, levels.length - 1)]);
  }
  return out;
}

module.exports = { toNumber, toWhole, unitOf, toLevel, toLevels, spread, clamp };

},{"./spec":2}],2:[function(require,module,exports){
"use strict";

/**
 * The fixed numbers the two DMX-over-Ethernet specifications agree on.
 *
 * Kept apart from the encoders so the browser half of OSCAR can validate a
 * universe or a channel without pulling in Buffer, dgram or a socket.
 */

/** A DMX universe is 512 slots, and every slot is one byte. */
const SLOTS = 512;
const MAX_LEVEL = 255;

const ARTNET_PORT = 6454;
const SACN_PORT = 5568;

/**
 * Art-Net addresses a universe with a 15-bit Port-Address (Net + Sub-Net +
 * Universe), so 0 is a perfectly ordinary universe. E1.31 reserves 0 and
 * 64000-65535, leaving 1-63999 for data.
 */
const PROTOCOLS = [
  {
    id: "artnet",
    name: "Art-Net",
    port: ARTNET_PORT,
    minUniverse: 0,
    maxUniverse: 32767,
  },
  {
    id: "sacn",
    name: "sACN (E1.31)",
    port: SACN_PORT,
    minUniverse: 1,
    maxUniverse: 63999,
  },
];

/** The same list reduced to what a settings panel needs. */
const PROTOCOL_OPTIONS = PROTOCOLS.map(function (spec) {
  return { id: spec.id, name: spec.name };
});

function protocol(id) {
  for (const spec of PROTOCOLS) {
    if (spec.id === id) return spec;
  }
  return null;
}

/** E1.31 maps each universe onto its own multicast group, 239.255.<hi>.<lo>. */
function sacnMulticast(universe) {
  return "239.255." + ((universe >> 8) & 0xff) + "." + (universe & 0xff);
}

/**
 * Where a request goes when Host was left blank.
 *
 * Both defaults are the "I don't know the node's address" answer each protocol
 * was designed around: Art-Net broadcasts, sACN multicasts. Naming a host is
 * still better on a busy network, which is why the field exists.
 */
function defaultHost(id, universe) {
  return id === "sacn" ? sacnMulticast(universe) : "255.255.255.255";
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
};

},{}],3:[function(require,module,exports){
"use strict";

/**
 * A widget's settings, written onto exported markup and read back off it.
 *
 * Inside the editor every setting is a component property and deliberately not
 * an HTML attribute -- public/src/adapters/grapesjs.js explains why: an
 * attribute is a second copy of the truth that goes stale the moment someone
 * edits the panel, and it would be saved into every project file.
 *
 * That leaves exported markup saying `<input type="range">` and nothing about
 * where it should send, which is why an exported page never worked. So the
 * settings are attached to the elements here, at export time and only there,
 * and read back by the standalone runtime. Nothing written by this module is
 * ever stored in a project.
 *
 * Nothing here touches a DOM: `readWidget` asks its argument for
 * `getAttribute`, which a real element, a parsed document and a test double all
 * answer.
 */

const { WIDGETS } = require("../widgets");

/** Marks an element as an OSCAR widget, and says which one. */
const NAME_ATTR = "data-oscar";

/**
 * Carries the settings, as JSON rather than one attribute per key.
 *
 * Attributes are strings, and these values are not: `invert` is a boolean and
 * `port` is a number. Spreading them over `data-oscar-invert="false"` would
 * hand the runtime the string "false", which is truthy, and a slider would
 * silently run backwards. JSON survives the round trip with its types intact.
 */
const CONFIG_ATTR = "data-oscar-config";

/** Finds every exported widget on a page. */
const WIDGET_SELECTOR = "[" + NAME_ATTR + "]";

const BY_NAME = Object.create(null);
for (const widget of WIDGETS) BY_NAME[widget.name] = widget;

/** The widget definition registered under this name, or null. */
function definitionFor(name) {
  return BY_NAME[name] || null;
}

/**
 * The attributes that carry one widget's configuration.
 *
 * Only the keys the widget itself declares are written: everything else on a
 * component is editor bookkeeping (position, layers, selection) and has no
 * business travelling with a control surface.
 *
 * @param {string} name - a widget name, e.g. "oscar-slider"
 * @param {object} config - that widget's current settings
 * @returns {object|null} attributes to set, or null if this is not a widget
 */
function exportAttributes(name, config) {
  const definition = definitionFor(name);
  if (!definition) return null;

  const settings = {};
  for (const key of Object.keys(definition.defaults)) {
    const value = config ? config[key] : undefined;
    // An absent key is left out rather than written as null. readWidget fills
    // gaps from the widget's own defaults, and null is a value, not a gap.
    if (value !== undefined) settings[key] = value;
  }

  const attributes = {};
  attributes[NAME_ATTR] = name;
  attributes[CONFIG_ATTR] = JSON.stringify(settings);
  return attributes;
}

/**
 * Read a widget back off an element, or null if this element is not one.
 *
 * @param {{ getAttribute: (name: string) => string|null }} el
 * @returns {{ name: string, definition: object, config: object }|null}
 */
function readWidget(el) {
  if (!el || typeof el.getAttribute !== "function") return null;

  const name = el.getAttribute(NAME_ATTR);
  const definition = definitionFor(name);
  if (!definition) return null;

  const settings = parseConfig(el.getAttribute(CONFIG_ATTR));
  // Unreadable configuration is not quietly replaced by the defaults. The
  // defaults point at localhost:7000 /slider1, so a damaged widget would come
  // back to life aimed at whatever happens to be listening there -- a control
  // that does nothing is far easier to diagnose than one that fires at the
  // wrong rig.
  if (!settings) return null;

  return {
    name: name,
    definition: definition,
    // Merged over the defaults so a hand-written element only has to state
    // what it wants to change.
    config: Object.assign({}, definition.defaults, settings),
  };
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

module.exports = {
  NAME_ATTR,
  CONFIG_ATTR,
  WIDGET_SELECTOR,
  definitionFor,
  exportAttributes,
  readWidget,
  parseConfig,
};

},{"../widgets":13}],4:[function(require,module,exports){
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
      return [{ type: "i", value: Math.round(number) }];
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
 * Parse a number without the traps JavaScript lays for you: Number("") and
 * Number(null) are both 0, and either would quietly become a real value.
 */
function toNumber(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "boolean") return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

/** Is this a value the given argument type can actually send? */
function isSendable(argType, raw) {
  return toArgs(argType, raw) !== null;
}

module.exports = { ARG_TYPES, NUMERIC_ARG_TYPES, toArgs, toNumber, isSendable, isFalsy };

},{}],5:[function(require,module,exports){
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

},{"./osc-message":6}],6:[function(require,module,exports){
"use strict";

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
 * Values that must never be read as a number.
 *
 * JSON has no NaN, so a NaN sent from a browser arrives as null -- and
 * Number(null) is 0, as is Number(""). A missing value would quietly become
 * zero, which on a lighting rig means "off". Refuse them instead.
 */
function isUnusableNumber(value) {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    typeof value === "boolean" ||
    typeof value === "object"
  );
}

function coerce(type, value) {
  switch (type) {
    case "i": {
      if (isUnusableNumber(value)) return null;
      const number = Number(value);
      if (!Number.isFinite(number)) return null;
      return { type: "i", value: Math.trunc(number) };
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
      if (isUnusableNumber(value)) return null;
      const number = Number(value);
      if (!Number.isFinite(number)) return null;
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

function isPort(port) {
  const number = Number(port);
  return Number.isInteger(number) && number > 0 && number <= 65535;
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

module.exports = { buildMessage, isAddress, isPort, MAX_ARGS };

},{}],7:[function(require,module,exports){
"use strict";

/**
 * Naming the serial port as somewhere a widget can send.
 *
 * A widget says where it sends with an IP and a port. A board on a USB cable
 * has neither, so the word `serial` stands in the IP field and the server
 * routes the message down the cable instead of onto the network.
 *
 * Kept in its own file, away from lib/serial.js: the validators in
 * lib/widgets/ run inside the browser bundle, and lib/serial.js reaches for a
 * native serial module that has no business being browserified.
 */

const SERIAL_HOST = "serial";

/** Is this widget aimed at the board on the cable rather than the network? */
function isSerialTarget(ip) {
  return String(ip == null ? "" : ip).trim().toLowerCase() === SERIAL_HOST;
}

module.exports = { SERIAL_HOST, isSerialTarget };

},{}],8:[function(require,module,exports){
"use strict";

const {
  field,
  enabled,
  listen,
  connection,
  connectionChecks,
  transport,
  dmxConnection,
  dmxDefaults,
  dmxChecks,
} = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { onIncoming } = require("./incoming");
const { ARG_TYPES, isSendable, isFalsy } = require("../osc-args");

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
 * alternates between them on each press.
 */
const button = {
  name: "oscar-button",
  tag: "button",
  // The label is plain text inside the button, not a child element. A child
  // intercepted every click and drag: grabbing a button by its label tore the
  // label out, and clicking selected the text rather than the button.
  text: "label",

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
      listen: false,
      ip: "localhost",
      port: 7000,
      message: "/push1",
      mode: "momentary",
      valueOn: "1",
      valueOff: "0",
      argType: "i",
    },
    dmxDefaults(1)
  ),

  fields: [enabled(), field("label", "Label", "text"), transport()]
    .concat(connection())
    .concat([
      listen(),
      field("mode", "Mode", "select", { options: MODES }),
      field("valueOn", "Value ON", "text"),
      field("valueOff", "Value OFF", "text"),
      field("argType", "Argument type", "select", { options: ARG_TYPES }),
    ])
    .concat(dmxConnection()),

  checks: Object.assign({}, connectionChecks(), dmxChecks(), {
    valueOn: checkValue,
    valueOff: checkValue,
  }),

  /**
   * Bind a live button to an element.
   *
   * `ctx` is the whole of what a widget may assume about its host:
   *   get(key)             read a setting
   *   send(message)        put a message on the wire, or ignore null
   *   setClass(name, on)   reflect state visually
   *   share(state)         tell the other devices, if the host has any
   *   onOsc / onShared     hear from the network
   * Everything here is plain DOM, so porting to another editor means providing
   * those, not rewriting the button.
   */
  attach: function (el, ctx) {
    let on = false;

    /**
     * Show a state, and say whether it was news.
     *
     * Guarding on the current state means a key repeat, a duplicated pointer
     * event, a second blur, or a state that another tablet is repeating back at
     * us cannot be acted on twice -- downstream, a repeated ON is a retrigger.
     */
    function show(next) {
      if (next === on) return false;
      on = next;
      ctx.setClass(ON_CLASS, on);
      return true;
    }

    /** The one place an edge is decided: this button, under a finger. */
    function setOn(next) {
      if (!show(next)) return;
      ctx.send(resolve(ctx, next));
      share();
    }

    function share() {
      if (ctx.share) ctx.share({ on: on });
    }

    /**
     * Take a state decided elsewhere -- the target software, or another tablet.
     *
     * The button lights up and nothing leaves. Sending the edge on would mean
     * the value we were just told about coming straight back at whoever told
     * us, which between two tablets is a ping-pong with no end.
     */
    function adopt(next) {
      return show(!!next);
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

    /**
     * Read an incoming value as on or off.
     *
     * The configured values come first, so a button set up to send "go" and
     * "stop" recognises its own vocabulary coming back. Anything else falls
     * back to the same reading of "off" the send path uses, which covers the
     * 0/1 and T/F almost everything actually emits.
     */
    function stateFor(value) {
      const text = String(value == null ? "" : value).trim();
      if (text === String(ctx.get("valueOff")).trim()) return false;
      if (text === String(ctx.get("valueOn")).trim()) return true;
      return !isFalsy(value);
    }

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("keyup", onKeyUp);

    const stopOsc = onIncoming(ctx, function (values) {
      // A bare address carries no state to adopt -- /play says a thing
      // happened, not whether anything is now on.
      if (!values.length) return;
      if (adopt(stateFor(values[0]))) share();
    });

    const stopShared = ctx.onShared
      ? ctx.onShared(function (state) {
          if (state && state.on !== undefined) adopt(state.on);
        })
      : null;

    // Without this, alt-tabbing mid-press strands the button on and whatever
    // it drives stays on with it -- the pointerup lands on another window.
    // Guarded so the widget can be exercised outside a browser.
    const root = typeof window === "undefined" ? null : window;
    if (root) root.addEventListener("blur", release);

    return function detach() {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("keyup", onKeyUp);
      if (root) root.removeEventListener("blur", release);
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

/**
 * The message for one edge, or null if it cannot or should not be sent.
 *
 * On DMX a button is a bump: its channels go to full while it is on and to
 * zero when it is off. Value ON and Value OFF are hand-typed OSC payloads --
 * a cue number, a clip name, "go" -- with no range to scale them against, so
 * reading them as levels would be a guess. Full and out is the one reading
 * that is never a surprise; a level in between is what a slider is for.
 */
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

},{"../osc-args":4,"./fields":11,"./incoming":12,"./outgoing":17}],9:[function(require,module,exports){
"use strict";

const { field, enabled, listen, connection, connectionChecks } = require("./fields");
const { onIncoming } = require("./incoming");
const { message, coalesce } = require("./commit");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");

/**
 * How the colour reaches the other end.
 *
 * There is no single convention, which is exactly why this is a setting rather
 * than a decision baked into the widget: some software wants three channels,
 * some wants four, and some is happiest with the hex string a designer would
 * paste out of a palette.
 */
const COLOUR_FORMATS = [
  { id: "rgb", name: "3 values (r, g, b)" },
  { id: "rgba", name: "4 values (r, g, b, a)" },
  { id: "hex", name: "hex string (#rrggbb)" },
];

/**
 * The scale the channels are expressed on.
 *
 * Normalised is the more common one for a colour *parameter*; 8-bit is what
 * you want when the other end is really asking for a pixel value. Guessing
 * wrong sends 255 where 1 was meant, which reads as white either way and hides
 * the mistake until something clips.
 */
const COLOUR_SCALES = [
  { id: "unit", name: "0 to 1 (normalised)" },
  { id: "byte", name: "0 to 255 (8-bit)" },
];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Parse a hex colour into 0-255 channels, or null.
 *
 * Null rather than black: #000000 is a real colour someone may have chosen on
 * purpose, so it must not double as "we could not read this". A colour we
 * cannot read drops the message instead.
 */
function parseHex(raw) {
  const match = HEX.exec(String(raw == null ? "" : raw).trim());
  if (!match) return null;

  let digits = match[1];
  if (digits.length === 3) {
    // #f0a is shorthand for #ff00aa.
    digits = digits.charAt(0) + digits.charAt(0) + digits.charAt(1) + digits.charAt(1) +
      digits.charAt(2) + digits.charAt(2);
  }

  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
  };
}

/** The form `<input type="color">` insists on: lowercase #rrggbb, or null. */
function normaliseHex(raw) {
  const rgb = parseHex(raw);
  if (!rgb) return null;
  return (
    "#" +
    [rgb.r, rgb.g, rgb.b]
      .map(function (channel) {
        return ("0" + channel.toString(16)).slice(-2);
      })
      .join("")
  );
}

/** 128 -> 0.502, not 0.5019607843137255: nobody downstream needs that tail. */
function round(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * OSC colour picker.
 *
 * A native `<input type="color">` rather than a hand-drawn wheel: it is the one
 * colour control every tablet already knows how to open, it is reachable by
 * keyboard, and it cannot be broken by a CSS change.
 */
const colour = {
  name: "oscar-colour",
  tag: "input",
  attributes: { type: "color", class: "oscar-colour" },

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

  defaults: {
    enabled: true,
    ip: "localhost",
    port: 7000,
    message: "/colour",
    value: "#ff0000",
    format: "rgb",
    scale: "unit",
    alpha: 1,
    listen: false,
    argType: "f",
  },

  fields: [enabled()].concat(connection()).concat([
    listen(),
    field("value", "Colour", "text", { placeholder: "#rrggbb" }),
    field("format", "Send as", "select", { options: COLOUR_FORMATS }),
    field("scale", "Range", "select", { options: COLOUR_SCALES }),
    field("alpha", "Alpha", "number", { min: 0, max: 1, step: "any" }),
    field("argType", "Argument type", "select", { options: NUMERIC_ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
    value: checkColour,
    alpha: checkAlpha,
  }),

  attach: function (el, ctx) {
    apply();

    /**
     * Put the stored colour on the swatch after a load.
     *
     * The native control falls back to #000000 when handed anything it does not
     * recognise, so a project saved with a bad hex would silently come back
     * black. Only write a colour we could parse.
     */
    function apply() {
      const hex = normaliseHex(ctx.get("value"));
      if (hex) el.value = hex;
    }

    // Dragging inside the OS colour picker fires `input` continuously, and a
    // colour is worth watching live -- you pick by looking at the rig, not at
    // the swatch. One send per frame keeps that live without flooding; `change`
    // (the picker being dismissed) sends the final colour exactly.
    const stream = coalesce(function (hex) {
      ctx.send(resolve(ctx, hex));
    });

    function onInput() {
      const hex = normaliseHex(el.value);
      if (!hex) return;
      ctx.set("value", hex);
      stream.push(hex);
    }

    function onChange() {
      onInput();
      stream.flush();
    }

    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    // A format or scale edit changes what the same colour means on the wire;
    // nothing is sent until the next pick, but the swatch must still agree with
    // a hand-edited Colour field.
    const stop = ctx.onChange(["value"], apply);

    // A colour coming back from the rig fills the swatch and goes no further.
    // Answering an incoming message with an outgoing one is the loop that ends
    // only when somebody pulls a cable.
    const stopOsc = onIncoming(ctx, function (values) {
      const hex = hexFromIncoming(values, ctx.get("scale"));
      if (!hex) return;
      ctx.set("value", hex);
      apply();
    });

    return function detach() {
      stream.stop();
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", onChange);
      if (stop) stop();
      if (stopOsc) stopOsc();
    };
  },
};

/** The values this colour becomes, in order, or null if it cannot be sent. */
function channels(ctx, hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;

  const byte = ctx.get("scale") === "byte";
  const scale = function (channel) {
    return byte ? channel : round(channel / 255);
  };

  const values = [scale(rgb.r), scale(rgb.g), scale(rgb.b)];
  if (ctx.get("format") !== "rgba") return values;

  // Alpha is configured rather than picked: `<input type="color">` has no
  // alpha channel at all. It is always typed as 0-1 in the panel and scaled
  // here, so switching Range does not silently reinterpret it.
  // toNumber, not Number: Number("") is 0 and Number.isFinite(0) is true, so a
  // blank alpha would sail through as fully transparent. A blank or mistyped
  // alpha is a question, and answering it with a guess is how a cue goes out
  // wrong in front of an audience.
  const alpha = toNumber(ctx.get("alpha"));
  if (alpha === null) return null;

  values.push(byte ? Math.round(alpha * 255) : round(alpha));
  return values;
}

function resolve(ctx, raw) {
  if (ctx.get("format") === "hex") {
    const hex = normaliseHex(raw);
    if (hex === null) return null;
    // A hex colour is a string by definition; the Argument type setting
    // governs the numeric formats and has nothing to say here.
    return message(ctx, hex, { argType: "s" });
  }

  const values = channels(ctx, raw);
  if (values === null) return null;
  return message(ctx, values);
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
 * Read a colour off the wire, in whichever shape it arrives.
 *
 * A target sending a colour back may send the hex string OSCAR sends in hex
 * mode, or the three or four channels it sends otherwise. Alpha is ignored:
 * the native swatch has nowhere to show it.
 *
 * Returns null for anything unreadable, which leaves the swatch as it was --
 * the same reasoning as the send path, where a value that cannot be parsed is
 * dropped rather than read as 0.
 */
function hexFromIncoming(values, scale) {
  if (!values || !values.length) return null;

  if (typeof values[0] === "string") return normaliseHex(values[0]);
  if (values.length < 3) return null;

  const full = scale === "byte" ? 1 : 255;
  const channels = [];
  for (let i = 0; i < 3; i++) {
    const number = toNumber(values[i]);
    if (number === null) return null;
    const byte = Math.round(number * full);
    if (byte < 0 || byte > 255) return null;
    channels.push(byte.toString(16).padStart(2, "0"));
  }
  return "#" + channels.join("");
}

module.exports = {
  colour,
  COLOUR_FORMATS,
  COLOUR_SCALES,
  parseHex,
  normaliseHex,
  hexFromIncoming,
};

},{"../osc-args":4,"./commit":10,"./fields":11,"./incoming":12}],10:[function(require,module,exports){
"use strict";

const { outgoing } = require("./outgoing");

/**
 * When a value goes on the wire, and the ctx -> config bridge every widget needs.
 *
 * outgoing.js decides *what* a message contains; this decides *when* one is
 * produced at all. The two are separate because the answer differs per widget:
 * a pad streams while a finger moves, a typed field must not.
 */

/** The settings every widget sends with, read off ctx in one place. */
function config(ctx, overrides) {
  return Object.assign(
    {
      enabled: ctx.get("enabled"),
      ip: ctx.get("ip"),
      port: ctx.get("port"),
      message: ctx.get("message"),
      argType: ctx.get("argType"),
    },
    overrides || {}
  );
}

/** The message a widget's current settings would send for `raw`, or null. */
function message(ctx, raw, overrides) {
  return outgoing(config(ctx, overrides), raw);
}

/**
 * Send a typed field on commit, never on keystroke.
 *
 * Typing "12.5" into a box would otherwise put /level 1, /level 12, /level 12.5
 * on the wire -- three cues where one was meant, and the intermediate 1 is a
 * real value a rig will act on. Worse, a held backspace floods the network.
 *
 * So: Enter commits, and so does leaving the field (the browser's `change`,
 * which fires on blur only when the text actually differs, and also covers a
 * number box's stepper arrows). Enter always fires even when nothing changed,
 * because re-sending the same cue on purpose is a normal thing to want; the
 * `last` guard exists only so that the `change` a browser fires immediately
 * after Enter is not counted a second time.
 *
 * `send` returns the value that was actually committed -- a number box clamps,
 * so what it sent is not always what was typed -- or nothing to accept the
 * value as given.
 */
function commit(el, send) {
  let last = el.value;

  function fire(force) {
    const value = el.value;
    if (!force && value === last) return;
    const committed = send(value);
    last = committed === undefined ? value : committed;
  }

  function onKeyDown(e) {
    if (e.key !== "Enter") return;
    // Inside a form this would submit and reload the surface mid-show.
    if (e.preventDefault) e.preventDefault();
    fire(true);
  }

  function onChange() {
    fire(false);
  }

  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("change", onChange);

  return function detach() {
    el.removeEventListener("keydown", onKeyDown);
    el.removeEventListener("change", onChange);
  };
}

/**
 * One send per animation frame, for a control that streams while it is dragged.
 *
 * `push` schedules, `flush` sends the pending value immediately -- the last
 * value of a drag must be exact, not one frame short of where the hand
 * stopped. Where there are no frames (outside a browser) every push sends,
 * which is what a test wants anyway.
 */
function coalesce(send) {
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
  const cancelRaf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : null;

  let frame = null;
  let pending = null;
  let waiting = false;

  function flush() {
    if (frame && cancelRaf) {
      cancelRaf(frame);
      frame = null;
    }
    if (!waiting) return;
    const value = pending;
    waiting = false;
    pending = null;
    send(value);
  }

  return {
    push: function (value) {
      pending = value;
      waiting = true;
      if (!raf) return flush();
      if (frame) return;
      frame = raf(function () {
        frame = null;
        flush();
      });
    },
    flush: flush,
    stop: function () {
      if (frame && cancelRaf) cancelRaf(frame);
      frame = null;
      waiting = false;
    },
  };
}

module.exports = { config, message, commit, coalesce };

},{"./outgoing":17}],11:[function(require,module,exports){
"use strict";

const { SLOTS, PROTOCOL_OPTIONS, protocol } = require("../dmx/spec");
const { toWhole } = require("../dmx/levels");

/**
 * The vocabulary a widget uses to describe its settings panel.
 *
 * A widget lists fields; something else turns them into whatever the editor of
 * the day uses for its inspector. Nothing here knows what that editor is, so a
 * widget definition outlives the choice of one.
 *
 * Field shape:
 *   { key, label, type, options?, min?, max?, step?, placeholder?, showIf? }
 *   type: "text" | "number" | "select" | "checkbox"
 *
 * `showIf` is { key, in: [...] }: a rule, not a function, so an adapter can see
 * which setting it has to watch without being handed a closure to guess at.
 */

const { SERIAL_HOST, isSerialTarget } = require("../serial-target");

const TYPES = ["text", "number", "select", "checkbox"];

function field(key, label, type, extra) {
  const spec = Object.assign({ key: key, label: label, type: type }, extra || {});
  if (TYPES.indexOf(spec.type) === -1) {
    throw new Error("unknown field type: " + spec.type);
  }
  return spec;
}

/**
 * The master switch, and the first field on every widget.
 *
 * It reads as what it is: a widget can be laid out, positioned and styled
 * while silent, which is how you build a surface without firing cues at a rig
 * that is mid-show. It sits above even the label, because whether a control is
 * live matters more than what it is called.
 */
function enabled() {
  return field("enabled", "Enabled", "checkbox");
}

/**
 * Where a widget sends. Every widget carries these, in this order, so a button
 * and a pad feel like the same instrument when you click between them.
 */
function connection() {
  return [
    field("ip", "Ip", "text", { placeholder: "localhost, or " + SERIAL_HOST }),
    field("port", "Port", "number", { min: 1, max: 65535 }),
    field("message", "Message", "text", { placeholder: "/address" }),
  ];
}

/**
 * Follow the value at the Message address back from the target software.
 *
 * Off by default, and deliberately so: a surface that starts moving on its own
 * the first time it is opened is alarming, and plenty of software echoes back
 * what it was just sent. Whoever wants a fader to track the rig asks for it.
 */
function listen() {
  return field("listen", "Listen", "checkbox");
}

/**
 * Where a widget's value goes.
 *
 * OSC reaches software; DMX reaches fixtures. A widget that can do both at once
 * is the point of putting this on every widget rather than inventing a second
 * family of DMX-only controls: one fader can ride a media server's opacity and
 * a house dimmer together, and a momentary button behaves like a momentary
 * button whichever it is driving.
 */
const TRANSPORTS = [
  { id: "osc", name: "OSC" },
  { id: "dmx", name: "DMX (Art-Net / sACN)" },
  { id: "both", name: "OSC and DMX" },
];

const DMX_TRANSPORTS = ["dmx", "both"];

function transport() {
  return field("transport", "Output", "select", { options: TRANSPORTS });
}

/** True when this widget's settings say it should be putting DMX on the wire. */
function sendsDmx(config) {
  return DMX_TRANSPORTS.indexOf((config && config.transport) || "osc") !== -1;
}

/**
 * The DMX half of a widget's settings.
 *
 * Hidden until Output asks for DMX, so the panel someone opens on a plain OSC
 * button is the panel OSCAR has always had. Where the OSC half needs an address
 * and a port, DMX needs a protocol, a node, a universe and a block of channels.
 */
function dmxConnection() {
  const only = { showIf: { key: "transport", in: DMX_TRANSPORTS } };

  return [
    field("dmxProtocol", "DMX protocol", "select", Object.assign({ options: PROTOCOL_OPTIONS }, only)),
    field("dmxHost", "DMX node", "text", Object.assign({ placeholder: "broadcast" }, only)),
    field("dmxUniverse", "DMX universe", "number", Object.assign({ min: 0, max: 63999 }, only)),
    field("dmxChannel", "DMX channel", "number", Object.assign({ min: 1, max: SLOTS }, only)),
    field("dmxCount", "DMX channels", "number", Object.assign({ min: 1, max: SLOTS }, only)),
  ];
}

/**
 * The defaults that go with dmxConnection().
 *
 * Universe 1 rather than 0 because it is the one universe number both
 * protocols accept, so switching protocol never silently stops the output.
 * `values` is how many channels this widget naturally drives -- one for a
 * fader, two for a pad's pan and tilt.
 */
function dmxDefaults(values) {
  return {
    transport: "osc",
    dmxProtocol: "artnet",
    dmxHost: "",
    dmxUniverse: 1,
    dmxChannel: 1,
    dmxCount: values || 1,
  };
}

function checkDmxUniverse(value, config) {
  const spec = protocol((config && config.dmxProtocol) || "artnet") || protocol("artnet");
  if (toWhole(value, spec.minUniverse, spec.maxUniverse) !== null) return null;
  return (
    "A " + spec.name + " universe is a whole number between " +
    spec.minUniverse + " and " + spec.maxUniverse
  );
}

function checkDmxChannel(value) {
  if (toWhole(value, 1, SLOTS) !== null) return null;
  return "A DMX channel is a whole number between 1 and " + SLOTS;
}

function checkDmxCount(value, config) {
  const count = toWhole(value, 1, SLOTS);
  if (count === null) return "A widget has to cover at least one DMX channel";

  const channel = toWhole(config && config.dmxChannel, 1, SLOTS);
  // Silently sending the part that fits would leave half a fixture responding,
  // which reads as a broken light rather than a wrong setting.
  if (channel !== null && channel + count - 1 > SLOTS) {
    return "Channel " + channel + " plus " + count + " channels runs past the end of the universe";
  }
  return null;
}

/** The validators that go with dmxConnection(). */
function dmxChecks() {
  return {
    dmxUniverse: checkDmxUniverse,
    dmxChannel: checkDmxChannel,
    dmxCount: checkDmxCount,
  };
}

const IPV4 =
  /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/;

/**
 * Validators return a complaint, or null when the value is fine.
 *
 * They run when someone edits a field, so a value that cannot be sent is
 * caught while there is still a human looking at it. The send path refuses bad
 * values too -- these two guards cover different moments, not the same one
 * twice: a project file can be edited by hand, and a field can be left mid-edit.
 */
function checkIp(value) {
  // `serial` is a destination as much as an address is: the board on the USB
  // cable, which has no address of its own.
  if (isSerialTarget(value)) return null;
  if (value === "localhost" || IPV4.test(String(value))) return null;
  return 'That IP address isn\'t valid: ' + value + ' (try an address, "localhost", or "' + SERIAL_HOST + '")';
}

function checkPort(value, config) {
  // A cable has no port number. Refusing whatever is left in the field would
  // mean nagging about a value nothing reads.
  if (config && isSerialTarget(config.ip)) return null;

  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port <= 65535) return null;
  return "The port has to be a whole number between 1 and 65535";
}

function checkMessage(value) {
  const address = String(value == null ? "" : value);
  if (address.length > 1 && address.charAt(0) === "/") return null;
  return "An OSC message is a path, like /master/level";
}

function checkNumber(label) {
  return function (value) {
    if (value !== "" && value !== null && Number.isFinite(Number(value))) return null;
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
  connection: connection,
  connectionChecks: connectionChecks,
  transport: transport,
  TRANSPORTS: TRANSPORTS,
  sendsDmx: sendsDmx,
  dmxConnection: dmxConnection,
  dmxDefaults: dmxDefaults,
  dmxChecks: dmxChecks,
  checkIp: checkIp,
  checkPort: checkPort,
  checkMessage: checkMessage,
  checkNumber: checkNumber,
  IPV4: IPV4,
};

},{"../dmx/levels":1,"../dmx/spec":2,"../serial-target":7}],12:[function(require,module,exports){
"use strict";

const { matchesAddress } = require("../osc-in");

/**
 * Decide whether an incoming OSC message is this widget's business.
 *
 * The mirror of outgoing(): every widget funnels through here, so the Listen
 * switch cannot be implemented three slightly different ways, and a widget that
 * was never asked to listen can never be moved from the network.
 *
 * Returning the values rather than applying them keeps the decision separable
 * from the effect -- which is the whole reason the loop guard is testable. What
 * this function does *not* do is as important as what it does: it never
 * produces a message to send. Adopting a value and sending it back is how a
 * fader and its target spend a show screaming at each other.
 */
function incoming(config, message) {
  // Listen is off by default, so a surface built before this existed, or built
  // by someone who never opened the setting, behaves exactly as it always did.
  if (!config || !config.listen) return null;
  if (!message || !Array.isArray(message.args)) return null;
  if (!matchesAddress(message.address, config.message)) return null;

  return { address: message.address, values: message.args };
}

/**
 * Follow the messages a widget's own Message address attracts.
 *
 * The subscription every widget would otherwise write out for itself: read
 * Listen and Message off the context each time, because both can be edited
 * while the widget is live, and hand on only the values. A widget that answers
 * to more than one address -- the pad in two-message mode -- calls incoming()
 * directly instead.
 *
 * @returns an unsubscribe function, or null where the host cannot receive.
 */
function onIncoming(ctx, fn) {
  if (!ctx.onOsc) return null;
  return ctx.onOsc(function (message) {
    const match = incoming({ listen: ctx.get("listen"), message: ctx.get("message") }, message);
    if (match) fn(match.values, match.address);
  });
}

module.exports = { incoming, onIncoming };

},{"../osc-in":5}],13:[function(require,module,exports){
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
 * The contract an adapter must provide as `ctx`:
 *   get(key)                 read a setting
 *   set(key, value)          store a value the widget computed; must not
 *                            re-validate or re-render, or a drag fights itself
 *   send(message | null)     put a message on the wire; null means stay silent
 *   setClass(name, on)       reflect state visually
 *   onChange(keys, fn)       run fn when any of those settings is edited;
 *                            returns an unsubscribe function
 *   onOsc(fn)                run fn({ address, args }) for OSC arriving from
 *                            the network; returns an unsubscribe function
 *   share(state)             publish this widget's state to the other devices
 *                            showing the same surface
 *   onShared(fn)             run fn(state) when one of them publishes
 *
 * The last three are optional: a host that has no network behind it may leave
 * them off, and every widget checks before reaching for them.
 *
 * Widgets that display rather than control go the other way: they publish a
 * plain function on their element for whatever is receiving OSC to call. The
 * meter's is el.oscarSetLevel(value) -- see lib/widgets/meter.js.
 */

const { button } = require("./button");
const { slider } = require("./slider");
const { xypad } = require("./xypad");
const { colour } = require("./colour");
const { textInput } = require("./text-input");
const { numberInput } = require("./number-input");
const { selectInput } = require("./select-input");
const { meter } = require("./meter");
const { media } = require("./media");
const { outgoing } = require("./outgoing");
const { incoming, onIncoming } = require("./incoming");

const WIDGETS = [
  button,
  slider,
  xypad,
  colour,
  textInput,
  numberInput,
  selectInput,
  meter,
  media,
];

module.exports = {
  WIDGETS,
  button,
  slider,
  xypad,
  colour,
  textInput,
  numberInput,
  selectInput,
  meter,
  media,
  outgoing,
  incoming,
  onIncoming,
};

},{"./button":8,"./colour":9,"./incoming":12,"./media":14,"./meter":15,"./number-input":16,"./outgoing":17,"./select-input":18,"./slider":19,"./text-input":20,"./xypad":21}],14:[function(require,module,exports){
"use strict";

const { field, enabled, listen, connection, connectionChecks } = require("./fields");
const { onIncoming } = require("./incoming");
const { outgoing } = require("./outgoing");
const { ARG_TYPES, isSendable } = require("../osc-args");

/**
 * What one tile can send.
 *
 * Clip selection is an index or a name, which is how Resolume, Millumin,
 * QLab and Ableton all address a cue. "bool" and "no argument" are dropped
 * from the list because they carry no identity: every tile would send the
 * identical message and the grid would be a row of buttons wearing pictures.
 */
const ITEM_ARG_TYPES = ARG_TYPES.filter(function (type) {
  return type.id !== "bool" && type.id !== "none";
});

const ITEM_CLASS = "oscar-media-item";
const THUMB_CLASS = "oscar-media-thumb";
const LABEL_CLASS = "oscar-media-label";
const SELECTED_CLASS = "oscar-selected";

const DEFAULT_ITEMS = "Clip 1|1; Clip 2|2; Clip 3|3";

/**
 * Split one configured line into a tile.
 *
 * The format is `label`, `label|value` or `label|value|image`.
 *
 * Items are separated by a semicolon OR a newline, and that is a concession to
 * the settings panel rather than a preference: a trait is a single-line text
 * input, so a newline cannot be typed into one. Semicolons are what a person
 * can actually enter; newlines are accepted as well so a project file edited by
 * hand, or generated by a script, reads the way a list should.
 *
 * The cost is that a label cannot itself contain `;` or `|`. That is the price
 * of staying inside the four trait types OSCAR has, and it buys a designer the
 * ability to set up a twenty-clip gallery without a new kind of settings UI.
 */
function parseItems(raw) {
  const text = String(raw == null ? "" : raw);

  return text
    .split(/[\n;]/)
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean)
    .filter(function (line) {
      // A line with neither a label nor a picture would draw an empty square
      // that sends something when tapped -- a trap, not a tile. A picture with
      // no label is fine, and is what a gallery of stills usually wants.
      const parts = line.split("|");
      return (parts[0] || "").trim() !== "" || (parts[2] || "").trim() !== "";
    })
    .map(function (line, index) {
      const parts = line.split("|").map(function (part) {
        return part.trim();
      });
      return {
        label: parts[0],
        // No value given means the tile sends its own position. A clip grid is
        // almost always addressed by index, so the common case is the one that
        // needs the least typing.
        value: parts.length > 1 && parts[1] !== "" ? parts[1] : String(index + 1),
        image: parts.length > 2 ? parts[2] : "",
      };
    });
}

/**
 * OSC media browser: a grid of thumbnails, one tap picks one.
 *
 * The need it answers is an operator on a tablet choosing which video plays in
 * a room -- browsing pictures rather than remembering that the calming forest
 * loop is clip 7. Picking a tile sends its value, which is exactly the message
 * a clip-launching program already listens for.
 *
 * It is a chooser, not a media library: it displays images the designer points
 * it at and it sends a selection. It does not upload, store, transcode or
 * preview video.
 */
const media = {
  name: "oscar-media",
  tag: "div",
  attributes: { class: "oscar-media" },

  block: {
    label: "Media Browser",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M4,4H10V10H4V4M14,4H20V10H14V4M4,14H10V20H4V14M14,14H20V20H14V14M16,16V18H18V16H16Z"/></svg>',
  },

  defaults: {
    enabled: true,
    ip: "localhost",
    port: 7000,
    message: "/clip",
    items: DEFAULT_ITEMS,
    columns: 3,
    showLabels: true,
    // 1-based, matching what an item with no explicit value sends. 0 is
    // "nothing picked yet", which is the honest state of a surface that has
    // just been laid out.
    selected: 0,
    listen: false,
    argType: "i",
  },

  fields: [enabled()].concat(connection()).concat([
    listen(),
    field("items", "Items", "text", {
      placeholder: "Intro|1; Waves|2|images/waves.png",
    }),
    field("columns", "Columns", "number", { min: 1, max: 12, step: 1 }),
    field("showLabels", "Show labels", "checkbox"),
    field("selected", "Selected", "number", { min: 0, step: 1 }),
    field("argType", "Argument type", "select", { options: ITEM_ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
    items: checkItems,
    columns: checkColumns,
    selected: checkSelected,
  }),

  attach: function (el, ctx) {
    // Everything this widget put in the element, so it can take exactly that
    // back out again and never touch anything it did not create.
    let tiles = [];
    let items = [];

    // The element's own document, not a global one: the canvas is an iframe,
    // and a node built by the outer document belongs to the wrong tree.
    const doc = el.ownerDocument;

    build();

    /** Draw the grid the settings describe. */
    function build() {
      clear();
      if (!doc) return;

      items = parseItems(ctx.get("items"));

      const columns = Math.max(1, Math.round(Number(ctx.get("columns")) || 1));
      // Written straight onto the element rather than left to a CSS variable,
      // so the layout holds up in engines that will not substitute a variable
      // inside repeat().
      el.style.setProperty("grid-template-columns", "repeat(" + columns + ", 1fr)");

      const withLabels = ctx.get("showLabels") !== false;

      items.forEach(function (item, index) {
        const tile = doc.createElement("div");
        tile.classList.add(ITEM_CLASS);

        if (item.image) {
          const thumb = doc.createElement("img");
          thumb.classList.add(THUMB_CLASS);
          // setAttribute, not innerHTML: the label and the URL are typed by a
          // person into a settings field, and building markup out of them
          // would make that field a way to inject script into the surface.
          thumb.setAttribute("src", item.image);
          // The label is already on screen, so an alt repeating it is noise to
          // a screen reader.
          thumb.setAttribute("alt", "");
          tile.appendChild(thumb);
        }

        if (withLabels) {
          const label = doc.createElement("span");
          label.classList.add(LABEL_CLASS);
          label.textContent = item.label;
          tile.appendChild(label);
        }

        // Click rather than pointerdown: a finger dragging the grid to scroll
        // it must not pick whatever it started on, and only click distinguishes
        // the two. There is nothing to be gained from firing early here -- this
        // picks a clip, it is not a drum pad.
        const onClick = function () {
          pick(index);
        };
        tile.addEventListener("click", onClick);

        tiles.push(tile);
        // Kept next to the element so detach removes the listener it added,
        // not one it guessed at.
        tile.oscarOnClick = onClick;
        el.appendChild(tile);
      });

      paintSelection();
    }

    function clear() {
      tiles.forEach(function (tile) {
        if (tile.oscarOnClick) tile.removeEventListener("click", tile.oscarOnClick);
        // Guarded: a re-render can have emptied the element underneath us, and
        // removing a node that is no longer a child throws.
        if (tile.parentNode === el) el.removeChild(tile);
      });
      tiles = [];
    }

    /** Show which tile is the current choice. */
    function paintSelection() {
      const selected = Number(ctx.get("selected"));
      tiles.forEach(function (tile, index) {
        if (index + 1 === selected) tile.classList.add(SELECTED_CLASS);
        else tile.classList.remove(SELECTED_CLASS);
      });
    }

    /**
     * Choose a tile.
     *
     * Picking the tile that is already picked still sends. Re-selecting a clip
     * is a real instruction -- it restarts it -- and swallowing the second tap
     * would make the grid feel broken to anyone trying exactly that.
     */
    function pick(index) {
      const item = items[index];
      if (!item) return;

      // Silent: this is the widget recording what the hand did, not a settings
      // edit, and a re-validate mid-show is the last thing anyone needs.
      ctx.set("selected", index + 1);
      paintSelection();

      ctx.send(
        outgoing(
          {
            enabled: ctx.get("enabled"),
            ip: ctx.get("ip"),
            port: ctx.get("port"),
            message: ctx.get("message"),
            argType: ctx.get("argType"),
          },
          item.value
        )
      );
    }

    const stopBuild = ctx.onChange(["items", "columns", "showLabels"], build);
    // Separate from the rebuild: setting the selection in the panel should move
    // a highlight, not tear down and re-create every thumbnail, which would
    // make every image flash as it reloads.
    const stopPaint = ctx.onChange(["selected"], paintSelection);

    /**
     * Which tile carries this value?
     *
     * Compared as text, because a value typed into the Items field is a string
     * and the same clip number arrives off the wire as a number.
     */
    function indexOfValue(value) {
      if (value === null || value === undefined) return null;
      const wanted = String(value);
      for (let i = 0; i < items.length; i++) {
        if (String(items[i].value) === wanted) return i;
      }
      return null;
    }

    // The software says which clip is playing, and the grid follows it. Only
    // the highlight moves -- re-sending would relaunch the clip that is already
    // running, which is the loop this whole design avoids.
    const stopOsc = onIncoming(ctx, function (values) {
      const index = indexOfValue(values[0]);
      if (index === null) return;
      ctx.set("selected", index + 1);
      paintSelection();
    });

    return function detach() {
      if (stopOsc) stopOsc();
      clear();
      if (stopBuild) stopBuild();
      if (stopPaint) stopPaint();
    };
  },
};

function checkItems(value, config) {
  const text = String(value == null ? "" : value).trim();
  // An empty gallery is a work in progress, not a mistake.
  if (!text) return null;

  const items = parseItems(text);
  if (!items.length) return "List the items like: Intro|1; Waves|2";

  const argType = (config && config.argType) || "i";
  for (const item of items) {
    if (isSendable(argType, item.value)) continue;
    // Caught here because the alternative is a tile that looks fine and does
    // nothing: the send path drops an unsendable value rather than guessing.
    return (
      'Item "' + item.label + '" would send "' + item.value + '", which cannot be sent as ' + argType
    );
  }
  return null;
}

function checkColumns(value) {
  const columns = Number(value);
  if (Number.isInteger(columns) && columns >= 1 && columns <= 12) return null;
  return "Columns has to be a whole number between 1 and 12";
}

function checkSelected(value) {
  const selected = Number(value);
  if (Number.isInteger(selected) && selected >= 0) return null;
  return "Selected is the position of an item, or 0 for none";
}

module.exports = {
  media,
  parseItems,
  ITEM_ARG_TYPES,
  ITEM_CLASS,
  THUMB_CLASS,
  LABEL_CLASS,
  SELECTED_CLASS,
  DEFAULT_ITEMS,
};

},{"../osc-args":4,"./fields":11,"./incoming":12,"./outgoing":17}],15:[function(require,module,exports){
"use strict";

const { field, enabled, listen, connection, connectionChecks, checkNumber } = require("./fields");
const { onIncoming } = require("./incoming");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");
const { ORIENTATIONS } = require("./slider");

/** The class that shows a peak marker is live. Styled in public/assets/css/toggle.css. */
const PEAK_CLASS = "oscar-peak";

/**
 * The method a meter publishes on its element so something outside can feed it.
 *
 * Named as a constant because it is a contract, not an implementation detail:
 * whatever ends up receiving OSC calls it, and both sides should be able to
 * point at the same line when they disagree.
 */
const LEVEL_HOOK = "oscarSetLevel";

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function pct(fraction) {
  return (fraction * 100).toFixed(2) + "%";
}

/**
 * OSC meter: a level display, not a control.
 *
 * Every other widget in OSCAR points outward -- a finger lands on it and a
 * message leaves. This one points inward: it shows a number that arrived from
 * somewhere else, so an operator can watch an audio level, a fixture's
 * intensity or a playhead without reading it off another screen.
 *
 * It sends nothing, ever. Its Ip / Port / Message settings therefore describe
 * where the level is expected to COME FROM rather than where anything goes,
 * and Argument type describes what the incoming value is expected to be.
 * Keeping the same five settings as every other widget is deliberate: a
 * surface where half the panels are laid out differently is a surface you have
 * to re-learn per widget.
 *
 * Feeding it: call el.oscarSetLevel(value). See LEVEL_HOOK below.
 */
const meter = {
  name: "oscar-meter",
  tag: "div",
  // The bar and the peak marker are pseudo-elements, as on the XY pad. Real
  // children would be dragged out of the component in the editor and would
  // have to be rebuilt on every repaint.
  attributes: { class: "oscar-meter", orient: "horizontal" },

  block: {
    label: "Meter",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M3,13H7V21H3V13M9,3H13V21H9V3M15,9H19V21H15V9M1,21H23V23H1V21Z"/></svg>',
  },

  defaults: {
    enabled: true,
    ip: "localhost",
    port: 7000,
    message: "/meter1",
    min: 0,
    max: 100,
    value: 0,
    orientation: "horizontal",
    // Seconds the highest recent level stays marked. 0 turns the marker off.
    peakHold: 0,
    listen: false,
    argType: "f",
  },

  fields: [enabled()].concat(connection()).concat([
    listen(),
    field("min", "Min", "number", { step: "any" }),
    field("max", "Max", "number", { step: "any" }),
    field("value", "Value", "number", { step: "any" }),
    field("orientation", "Orientation", "select", { options: ORIENTATIONS }),
    field("peakHold", "Peak hold (s)", "number", { min: 0, step: "any" }),
    field("argType", "Argument type", "select", { options: NUMERIC_ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
    min: checkNumber("Min"),
    max: checkNumber("Max"),
    value: checkNumber("Value"),
    peakHold: checkPeakHold,
  }),

  attach: function (el, ctx) {
    // Both are fractions of the span, 0..1, so the range can be edited
    // underneath a held peak without the marker jumping to a stale pixel.
    let peak = 0;
    let peakAt = 0;

    apply();

    /**
     * Show a level that arrived from outside.
     *
     * This is the whole of the meter's public surface. It is deliberately a
     * plain function on the element rather than a setting write: levels arrive
     * as fast as the source sends them, and routing every frame through the
     * settings layer would run the validators and re-render the component
     * dozens of times a second.
     */
    function show(value) {
      // A disabled meter freezes rather than dropping to zero: "off" and "no
      // longer being told" are different things, and a bar that fell to the
      // floor would read as the former.
      if (!ctx.get("enabled")) return;

      const fraction = fractionOf(value);
      // The same rule as the send path, for the same reason. A value that will
      // not parse is not zero -- painting an empty bar would report silence on
      // a channel that may be at full. Leave the last known level showing.
      if (fraction === null) return;

      // Stored silently so a re-render (a style edit, a resize) repaints where
      // the level actually was rather than back at the configured default.
      ctx.set("value", Number(value));
      paint(fraction);
    }

    /** Re-read everything from the settings and repaint. */
    function apply() {
      el.setAttribute("orient", ctx.get("orientation") || "horizontal");
      const fraction = fractionOf(ctx.get("value"));
      paint(fraction === null ? 0 : fraction);
    }

    function fractionOf(value) {
      const min = Number(ctx.get("min"));
      const max = Number(ctx.get("max"));
      const raw = Number(value);
      if (value === "" || value === null || value === undefined) return null;
      if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(raw)) return null;
      if (max === min) return 0;
      return clamp((raw - min) / (max - min), 0, 1);
    }

    function paint(fraction) {
      const hold = Number(ctx.get("peakHold"));
      const holding = Number.isFinite(hold) && hold > 0;
      const now = Date.now();

      // A peak rises instantly and falls only once its hold has expired, which
      // is what makes a brief overshoot visible at all -- at 30 frames a
      // second the eye never catches it otherwise.
      if (!holding || fraction >= peak || now - peakAt >= hold * 1000) {
        peak = fraction;
        peakAt = now;
      }

      el.style.setProperty("--oscar-level", pct(fraction));
      el.style.setProperty("--oscar-peak", pct(holding ? peak : fraction));
      ctx.setClass(PEAK_CLASS, holding);
    }

    // Editing the range, the orientation or the value in the panel has to move
    // the bar, or the designer is laying out a widget they cannot see working.
    // It is also what makes the meter useful on its own, before anything is
    // feeding it live.
    const stop = ctx.onChange(["min", "max", "value", "orientation", "peakHold"], apply);

    // Published last, so it cannot be called against a half-built meter.
    el[LEVEL_HOOK] = show;

    // A meter exists to follow something, so this is the whole point of it --
    // but it still reads Listen, because a meter pointed at a busy address in
    // a half-built surface should be able to sit still.
    const stopOsc = onIncoming(ctx, function (values) {
      const level = toNumber(values[0]);
      // An unreadable level leaves the bar where it was. Dropping to zero
      // would report silence on a channel that may be at full.
      if (level === null) return;
      show(level);
    });

    return function detach() {
      if (stopOsc) stopOsc();
      // Cleared rather than left pointing at a dead closure: a caller that
      // holds on to a removed element should find nothing to call.
      if (el[LEVEL_HOOK] === show) delete el[LEVEL_HOOK];
      if (stop) stop();
    };
  },
};

function checkPeakHold(value) {
  const seconds = Number(value);
  if (value !== "" && value !== null && Number.isFinite(seconds) && seconds >= 0) return null;
  return "Peak hold has to be a number of seconds, 0 for none";
}

module.exports = { meter, PEAK_CLASS, LEVEL_HOOK };

},{"../osc-args":4,"./fields":11,"./incoming":12,"./slider":19}],16:[function(require,module,exports){
"use strict";

const { field, enabled, listen, connection, connectionChecks } = require("./fields");
const { onIncoming } = require("./incoming");
const { message, commit } = require("./commit");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");

/** A blank limit means "no limit", which is different from a limit of zero. */
function limit(raw) {
  return toNumber(raw);
}

/**
 * OSC number entry: type an exact value instead of hunting for it with a fader.
 *
 * The whole point of the request behind this widget is that some values are
 * known -- 127, 0.5, cue 12 -- and dragging a slider until it happens to land
 * on one is guesswork.
 */
const numberInput = {
  name: "oscar-number",
  tag: "input",
  attributes: { type: "number", class: "oscar-entry", step: "any" },

  block: {
    label: "Number Input",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M4,17V9H2V7H6V17H4M22,15C22,16.11 21.1,17 20,17H16V15H20V13H18V11H20V9H16V7H20A2,2 0 0,1 ' +
      '22,9V10.5A1.5,1.5 0 0,1 20.5,12A1.5,1.5 0 0,1 22,13.5V15M14,15V17H8V13C8,11.89 8.9,11 ' +
      '10,11H12V9H8V7H12A2,2 0 0,1 14,9V11C14,12.11 13.1,13 12,13H10V15H14Z"/></svg>',
  },

  defaults: {
    enabled: true,
    ip: "localhost",
    port: 7000,
    message: "/number",
    value: 0,
    min: "",
    max: "",
    step: "any",
    listen: false,
    argType: "f",
  },

  fields: [enabled()].concat(connection()).concat([
    listen(),
    field("value", "Value", "number", { step: "any" }),
    field("min", "Min", "number", { step: "any", placeholder: "no limit" }),
    field("max", "Max", "number", { step: "any", placeholder: "no limit" }),
    field("step", "Step", "text", { placeholder: "any" }),
    field("argType", "Argument type", "select", { options: NUMERIC_ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
    min: checkLimit("Min"),
    max: checkLimit("Max"),
    value: checkValue,
  }),

  attach: function (el, ctx) {
    apply();

    /**
     * Push the configured range and value onto the native input.
     *
     * min/max go on the element too, not only into the clamp below, so the
     * stepper arrows and a phone's numeric keypad already know the range.
     */
    function apply() {
      const low = limit(ctx.get("min"));
      const high = limit(ctx.get("max"));
      el.min = low === null ? "" : String(low);
      el.max = high === null ? "" : String(high);
      el.step = String(ctx.get("step") || "any");

      const value = toNumber(ctx.get("value"));
      el.value = value === null ? "" : String(value);
    }

    function clamp(value) {
      const low = limit(ctx.get("min"));
      const high = limit(ctx.get("max"));
      let result = value;
      if (low !== null) result = Math.max(low, result);
      if (high !== null) result = Math.min(high, result);
      return result;
    }

    const stop = commit(el, function (raw) {
      const value = toNumber(raw);
      // Number("") and Number(null) are both 0, and on a rig 0 means off. An
      // empty or half-typed box is a question, not a zero: send nothing, and
      // leave the text exactly as it was typed so it can be finished.
      if (value === null) return raw;

      const clamped = clamp(value);
      ctx.set("value", clamped);
      ctx.send(message(ctx, clamped));
      // Show what actually went out. Typing 500 into a box limited to 255 and
      // watching it stay at 500 while the rig sits at 255 is a lie.
      el.value = String(clamped);
      return el.value;
    });

    const unsubscribe = ctx.onChange(["value", "min", "max", "step"], apply);


    // A value arriving from the network fills the control but never leaves it
    // again. Answering an incoming message with an outgoing one is the loop
    // that ends only when somebody pulls a cable.
    const stopOsc = onIncoming(ctx, function (values) {
      if (!values.length) return;
      ctx.set("value", values[0]);
      apply();
    });

    return function detach() {
      if (stopOsc) stopOsc();
      stop();
      if (unsubscribe) unsubscribe();
    };
  },
};

/** Blank is allowed -- it is how you say "unbounded". Nonsense is not. */
function checkLimit(label) {
  return function (value) {
    if (value === "" || value === null || value === undefined) return null;
    if (Number.isFinite(Number(value))) return null;
    return label + " has to be a number, or empty for no limit";
  };
}

function checkValue(value, config) {
  if (toNumber(value) === null) return "The value has to be a number";

  const number = Number(value);
  const low = limit(config && config.min);
  const high = limit(config && config.max);
  if (low !== null && number < low) return "The value has to be at least " + low;
  if (high !== null && number > high) return "The value has to be at most " + high;
  return null;
}

module.exports = { numberInput };

},{"../osc-args":4,"./commit":10,"./fields":11,"./incoming":12}],17:[function(require,module,exports){
"use strict";

const { toArgs } = require("../osc-args");
const { SLOTS } = require("../dmx/spec");
const { toWhole, toLevels, spread } = require("../dmx/levels");

/**
 * Decide what a widget should put on the wire, or null for silence.
 *
 * Every widget funnels through here, so the Enabled switch cannot be
 * implemented three slightly different ways, and a value that no argument type
 * can carry is dropped rather than guessed at.
 *
 * A widget hands over two readings of the same gesture:
 *
 *   raw   the value in the widget's own units -- 0-100, a cue number, "go" --
 *         which is what OSC carries
 *   unit  the same position as 0..1, which is what a DMX slot can be scaled
 *         from. Only the widget knows its own range, so only the widget can
 *         work this out; a slider labelled 20-2000 Hz still means "full" at the
 *         top.
 *
 * The result carries an OSC half, a DMX half, or both, and the adapter sends
 * whichever halves are present.
 */
function outgoing(config, raw, unit) {
  if (!config || !config.enabled) return null;

  const transport = config.transport || "osc";
  const wantsOsc = transport === "osc" || transport === "both";
  const wantsDmx = transport === "dmx" || transport === "both";

  const message = {};
  let sending = false;

  if (wantsOsc) {
    const args = oscArgs(config, raw);
    if (args) {
      message.ip = config.ip;
      message.port = config.port;
      message.address = config.message;
      message.args = args;
      sending = true;
    } else if (!wantsDmx) {
      return null;
    }
  }

  if (wantsDmx) {
    const dmx = dmxRequest(config, unit);
    if (dmx) {
      message.dmx = dmx;
      sending = true;
    }
  }

  return sending ? message : null;
}

/** The OSC arguments for one gesture, or null if any value cannot be sent. */
function oscArgs(config, raw) {
  // A list carries a widget that produces several values at once -- a pad
  // sends two, a colour three or four -- all sharing one argument type.
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
 * The DMX request for one gesture, or null.
 *
 * Null here means the widget stays where it is rather than going to zero. That
 * is the whole point: an unreadable level coerced to 0 is a blackout, and it
 * would look exactly like someone pulling the fader down.
 */
function dmxRequest(config, unit) {
  const levels = toLevels(unit);
  if (!levels) return null;

  const channel = toWhole(config.dmxChannel, 1, SLOTS);
  if (channel === null) return null;

  const count = toWhole(config.dmxCount, 1, SLOTS);
  if (count === null) return null;

  const universe = toWhole(config.dmxUniverse, 0, 63999);
  if (universe === null) return null;

  // The block cannot run past the end of the universe. The settings panel
  // refuses this too; a project file edited by hand reaches here instead.
  const fits = Math.min(count, SLOTS - channel + 1);

  return {
    protocol: config.dmxProtocol || "artnet",
    host: typeof config.dmxHost === "string" ? config.dmxHost.trim() : "",
    universe: universe,
    channel: channel,
    levels: spread(levels, fits),
    source: config.id,
  };
}

/**
 * The settings every widget shares, read off its host in one go.
 *
 * Widgets differ in how they produce a value, not in where it goes, so the
 * routing half of a settings panel is read the same way for all of them. A
 * widget adds its own keys on top.
 */
function routing(ctx) {
  return {
    id: ctx.id,
    enabled: ctx.get("enabled"),
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

module.exports = { outgoing, routing };

},{"../dmx/levels":1,"../dmx/spec":2,"../osc-args":4}],18:[function(require,module,exports){
"use strict";

const { field, enabled, listen, connection, connectionChecks } = require("./fields");
const { onIncoming } = require("./incoming");
const { message } = require("./commit");
const { ARG_TYPES, isSendable } = require("../osc-args");

/**
 * Turn the designer's option list into options.
 *
 * One option per line would read better, but every trait in the settings panel
 * is a single-line control -- text, number, select or checkbox -- so a newline
 * can never be typed into one. Commas are the only separator that survives the
 * panel, so commas it is:
 *
 *   Red=1, Green=2, Blue=3
 *
 * An item with no "=" is its own label and value, so a bare "1, 2, 3" works
 * and is the quickest thing to type. A value containing a comma is the price
 * of that choice; OSC values rarely do.
 */
function parseOptions(raw) {
  const options = [];

  for (const part of String(raw == null ? "" : raw).split(",")) {
    const item = part.trim();
    if (!item) continue;

    const split = item.indexOf("=");
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
 * A native `<select>` because a tablet renders it as the platform's own picker
 * -- a full-height wheel on iOS, a sheet on Android -- which beats anything
 * hand-drawn for hitting the right row with a thumb.
 */
const selectInput = {
  name: "oscar-select",
  tag: "select",
  attributes: { class: "oscar-select" },

  block: {
    label: "Dropdown",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M2,5H22A1,1 0 0,1 23,6V18A1,1 0 0,1 22,19H2A1,1 0 0,1 1,18V6A1,1 0 0,1 ' +
      '2,5M3,7V17H21V7H3M15,10H19L17,13L15,10Z"/></svg>',
  },

  defaults: {
    enabled: true,
    ip: "localhost",
    port: 7000,
    message: "/preset",
    options: "One=1, Two=2, Three=3",
    value: "1",
    listen: false,
    argType: "i",
  },

  fields: [enabled()].concat(connection()).concat([
    listen(),
    field("options", "Options", "text", { placeholder: "Red=1, Green=2, Blue=3" }),
    field("value", "Value", "text"),
    field("argType", "Argument type", "select", { options: ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
    options: checkOptions,
  }),

  attach: function (el, ctx) {
    render();

    /**
     * Rebuild the list from the Options setting.
     *
     * The <option> elements are never part of the saved component: the setting
     * is the single source of truth, and rendering from it on every attach
     * means an edited list cannot drift from the markup. The cost is that an
     * exported page needs OSCAR to fill the list in, which the preview does.
     */
    function render() {
      const options = parseOptions(ctx.get("options"));
      const selected = String(ctx.get("value") == null ? "" : ctx.get("value"));

      el.innerHTML = options
        .map(function (option) {
          return (
            '<option value="' +
            escapeHtml(option.value) +
            '">' +
            escapeHtml(option.label) +
            "</option>"
          );
        })
        .join("");

      // Only restore a selection the list still offers; otherwise leave the
      // browser on the first option, which is what it is actually showing.
      const has = options.some(function (option) {
        return option.value === selected;
      });
      if (has) el.value = selected;
      else if (options.length) ctx.set("value", options[0].value);
    }

    // One pick, one message. A dropdown has no intermediate states to flood
    // with -- `change` fires once, when a choice is actually made.
    function onChange() {
      const raw = el.value;
      ctx.set("value", raw);
      ctx.send(message(ctx, raw));
    }

    el.addEventListener("change", onChange);
    const stop = ctx.onChange(["options", "value"], render);


    // A value arriving from the network fills the control but never leaves it
    // again. Answering an incoming message with an outgoing one is the loop
    // that ends only when somebody pulls a cable.
    const stopOsc = onIncoming(ctx, function (values) {
      if (!values.length) return;
      ctx.set("value", values[0]);
      render();
    });

    return function detach() {
      if (stopOsc) stopOsc();
      el.removeEventListener("change", onChange);
      if (stop) stop();
    };
  },
};

function checkOptions(value, config) {
  const options = parseOptions(value);
  if (!options.length) return "List the options like: Red=1, Green=2, Blue=3";

  const argType = (config && config.argType) || "s";
  for (const option of options) {
    if (!isSendable(argType, option.value)) {
      return 'The value "' + option.value + '" cannot be sent as ' + argType;
    }
  }
  return null;
}

module.exports = { selectInput, parseOptions };

},{"../osc-args":4,"./commit":10,"./fields":11,"./incoming":12}],19:[function(require,module,exports){
"use strict";

const {
  field,
  enabled,
  listen,
  connection,
  connectionChecks,
  checkNumber,
  transport,
  dmxConnection,
  dmxDefaults,
  dmxChecks,
} = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { onIncoming } = require("./incoming");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");
const { unitOf } = require("../dmx/levels");

const ORIENTATIONS = [
  { id: "horizontal", name: "Horizontal" },
  { id: "vertical", name: "Vertical" },
];

/**
 * OSC slider.
 *
 * With Invert on, the value sent is mirrored within [Min, Max] while the thumb
 * stays where the hand put it.
 */
const slider = {
  name: "oscar-slider",
  tag: "input",
  attributes: { type: "range", step: "0.01", min: "0", max: "100", orient: "horizontal" },

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
      listen: false,
      ip: "localhost",
      port: 7000,
      message: "/slider1",
      min: 0,
      max: 100,
      value: 0,
      orientation: "horizontal",
      invert: false,
      argType: "f",
    },
    dmxDefaults(1)
  ),

  fields: [enabled(), transport()]
    .concat(connection())
    .concat([
      listen(),
      field("min", "Min", "number", { step: "any" }),
      field("max", "Max", "number", { step: "any" }),
      field("value", "Value", "number", { step: "any" }),
      field("orientation", "Orientation", "select", { options: ORIENTATIONS }),
      field("invert", "Invert", "checkbox"),
      field("argType", "Argument type", "select", { options: NUMERIC_ARG_TYPES }),
    ])
    .concat(dmxConnection()),

  checks: Object.assign({}, connectionChecks(), dmxChecks(), {
    min: checkNumber("Min"),
    max: checkNumber("Max"),
    value: checkValue,
  }),

  attach: function (el, ctx) {
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
      if (!Number.isFinite(value)) return;
      el.value = String(ctx.get("invert") ? max - value + min : value);
    }

    function onInput() {
      const raw = Number(el.value);
      const min = Number(ctx.get("min"));
      const max = Number(ctx.get("max"));
      const value = ctx.get("invert") ? max - raw + min : raw;

      ctx.set("value", value);
      ctx.send(resolve(ctx, value));
      share(value);
    }

    /** Tell the other devices showing this surface where the thumb went. */
    function share(value) {
      if (ctx.share) ctx.share({ value: value });
    }

    /**
     * Take a position decided elsewhere -- the target software, or another
     * tablet -- and show it.
     *
     * It moves the thumb and stops there. The missing ctx.send is the point: a
     * value that arrived from outside and goes straight back out is a loop, and
     * against software that echoes its own state it is one that never settles.
     *
     * @returns whether the thumb actually moved.
     */
    function adopt(raw) {
      // The usual rule: an unreadable value is dropped, never read as 0.
      const value = toNumber(raw);
      if (value === null) return false;

      const low = Math.min(Number(ctx.get("min")), Number(ctx.get("max")));
      const high = Math.max(Number(ctx.get("min")), Number(ctx.get("max")));
      const settled =
        Number.isFinite(low) && Number.isFinite(high)
          ? Math.min(high, Math.max(low, value))
          : value;

      if (settled === Number(ctx.get("value"))) return false;
      ctx.set("value", settled);
      apply();
      return true;
    }

    el.addEventListener("input", onInput);
    // A settings edit changes the range or flips the direction under a thumb
    // that is already somewhere; re-apply rather than leave the two disagreeing.
    const stop = ctx.onChange(["min", "max", "value", "orientation", "invert"], apply);

    const stopOsc = onIncoming(ctx, function (values) {
      // Passing on what the rig said keeps a tablet that connects later in step
      // with one that heard it. Both tablets report the same value, so the
      // second report changes nothing and is dropped server-side.
      if (adopt(values[0])) share(Number(ctx.get("value")));
    });

    const stopShared = ctx.onShared
      ? ctx.onShared(function (state) {
          if (state && state.value !== undefined) adopt(state.value);
        })
      : null;

    return function detach() {
      el.removeEventListener("input", onInput);
      if (stop) stop();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

/**
 * A slider's full travel is a channel's full travel: wherever Min and Max are
 * pinned, the bottom of the fader is 0 and the top is 255. Invert is already
 * baked into `value`, so it flips DMX along with OSC.
 */
function resolve(ctx, value) {
  return outgoing(routing(ctx), value, unitOf(value, ctx.get("min"), ctx.get("max")));
}

function checkValue(value, config) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "The value has to be a number";
  const min = Number(config.min);
  const max = Number(config.max);
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  if (number < low || number > high) {
    return "The value has to be between " + low + " and " + high;
  }
  return null;
}

module.exports = { slider, ORIENTATIONS };

},{"../dmx/levels":1,"../osc-args":4,"./fields":11,"./incoming":12,"./outgoing":17}],20:[function(require,module,exports){
"use strict";

const { field, enabled, listen, connection, connectionChecks } = require("./fields");
const { onIncoming } = require("./incoming");
const { message, commit } = require("./commit");
const { ARG_TYPES, isSendable } = require("../osc-args");

/**
 * OSC text entry: type a string, press Enter, send it.
 *
 * The full argument-type list rather than just string, because the thing that
 * makes a typed box useful is that it carries whatever you type -- a clip name
 * today, a cue number tomorrow -- and forcing "s" would mean dropping in a
 * different widget for the second case.
 */
const textInput = {
  name: "oscar-text",
  tag: "input",
  attributes: { type: "text", class: "oscar-entry" },

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
    ip: "localhost",
    port: 7000,
    message: "/text",
    value: "",
    placeholder: "Type, then press Enter",
    listen: false,
    argType: "s",
  },

  fields: [enabled()].concat(connection()).concat([
    listen(),
    field("value", "Value", "text"),
    field("placeholder", "Placeholder", "text"),
    field("argType", "Argument type", "select", { options: ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
    value: checkValue,
  }),

  attach: function (el, ctx) {
    apply();

    /** Show the stored text, so a reload does not empty the box. */
    function apply() {
      const value = ctx.get("value");
      el.value = value == null ? "" : String(value);
      const hint = ctx.get("placeholder");
      el.placeholder = hint == null ? "" : String(hint);
    }

    const stop = commit(el, function (raw) {
      ctx.set("value", raw);
      ctx.send(message(ctx, raw));
    });

    const unsubscribe = ctx.onChange(["value", "placeholder"], apply);


    // A value arriving from the network fills the control but never leaves it
    // again. Answering an incoming message with an outgoing one is the loop
    // that ends only when somebody pulls a cable.
    const stopOsc = onIncoming(ctx, function (values) {
      if (!values.length) return;
      ctx.set("value", values[0]);
      apply();
    });

    return function detach() {
      if (stopOsc) stopOsc();
      stop();
      if (unsubscribe) unsubscribe();
    };
  },
};

/** Judged against the type it will be sent as: "abc" is fine as s, not as f. */
function checkValue(value, config) {
  const argType = (config && config.argType) || "s";
  if (isSendable(argType, value)) return null;
  return 'The value "' + value + '" cannot be sent as ' + argType;
}

module.exports = { textInput };

},{"../osc-args":4,"./commit":10,"./fields":11,"./incoming":12}],21:[function(require,module,exports){
"use strict";

const {
  field,
  enabled,
  listen,
  connection,
  connectionChecks,
  checkNumber,
  transport,
  dmxConnection,
  dmxDefaults,
  dmxChecks,
} = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { incoming } = require("./incoming");
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
 * value per address.
 */
const xypad = {
  name: "oscar-xypad",
  tag: "div",
  // The handle is drawn by CSS on this element, not by a child. A child would
  // swallow the drag, the way a button's label used to.
  attributes: { class: "oscar-xypad" },

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
      listen: false,
      ip: "localhost",
      port: 7000,
      message: "/pad",
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
    // Two channels by default, because a pad over two consecutive channels is
    // pan and tilt on a moving head -- the reason to want a pad on DMX at all.
    dmxDefaults(2)
  ),

  fields: [enabled(), transport()]
    .concat(connection())
    .concat([
      listen(),
      field("sendMode", "Send", "select", { options: SEND_MODES }),
      field("minX", "Min X", "number", { step: "any" }),
      field("maxX", "Max X", "number", { step: "any" }),
      field("minY", "Min Y", "number", { step: "any" }),
      field("maxY", "Max Y", "number", { step: "any" }),
      field("invertX", "Invert X", "checkbox"),
      field("invertY", "Invert Y", "checkbox"),
      field("argType", "Argument type", "select", { options: NUMERIC_ARG_TYPES }),
    ])
    .concat(dmxConnection()),

  checks: Object.assign({}, connectionChecks(), dmxChecks(), {
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

    /**
     * Where a value sits in its range, for drawing the handle.
     *
     * Unreadable settings put the handle in the corner, which is honest about
     * knowing nothing. The send path uses unitOf directly and drops instead --
     * a handle in the corner is a picture, a zero on a dimmer is a blackout.
     */
    function fraction(value, min, max) {
      const unit = unitOf(value, min, max);
      return unit === null ? 0 : unit;
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
      // X lands on the first channel of the block and Y on the next, which on
      // a moving head is pan and tilt.
      const units = [
        unitOf(values.x, ctx.get("minX"), ctx.get("maxX")),
        unitOf(values.y, ctx.get("minY"), ctx.get("maxY")),
      ];

      if (ctx.get("sendMode") !== "two") {
        ctx.send(outgoing(config, [values.x, values.y], units));
        share();
        return;
      }

      // Splitting into /x and /y is an OSC arrangement. The pad still holds one
      // block of DMX channels and may only claim it once: a second claim under
      // the same widget replaces the first, so sending X then Y would leave the
      // rig holding Y alone.
      const route = config.transport || "osc";
      if (route !== "dmx") {
        ctx.send(outgoing(retarget(config, "osc", config.message + "/x"), values.x));
        ctx.send(outgoing(retarget(config, "osc", config.message + "/y"), values.y));
      }
      if (route !== "osc") {
        ctx.send(outgoing(retarget(config, "dmx"), null, units));
      }
      share();
    }

    /** Tell the other devices showing this surface where the handle went. */
    function share() {
      if (ctx.share) ctx.share({ x: Number(ctx.get("x")), y: Number(ctx.get("y")) });
    }

    function settle(value, minKey, maxKey) {
      // The usual rule: an unreadable value is dropped, never read as 0.
      const number = toNumber(value);
      if (number === null) return null;
      const low = Math.min(Number(ctx.get(minKey)), Number(ctx.get(maxKey)));
      const high = Math.max(Number(ctx.get(minKey)), Number(ctx.get(maxKey)));
      if (!Number.isFinite(low) || !Number.isFinite(high)) return number;
      return clamp(number, low, high);
    }

    /**
     * Take a position decided elsewhere -- the target software, or another
     * tablet -- and show it. Either axis may be left alone by passing something
     * unreadable, which is what two-message mode does.
     *
     * Nothing is sent. A value that arrived from outside and goes straight back
     * out is a loop, and against software that echoes its own state it is one
     * that never settles.
     *
     * @returns whether the handle actually moved.
     */
    function adopt(rawX, rawY) {
      // A hand on the pad outranks the network; snapping the handle out from
      // under a finger mid-drag is not a value anyone asked for.
      if (dragging) return false;

      const x = settle(rawX, "minX", "maxX");
      const y = settle(rawY, "minY", "maxY");

      let moved = false;
      if (x !== null && x !== Number(ctx.get("x"))) {
        ctx.set("x", x);
        moved = true;
      }
      if (y !== null && y !== Number(ctx.get("y"))) {
        ctx.set("y", y);
        moved = true;
      }

      if (moved) place();
      return moved;
    }

    /** Whichever addresses this pad answers to, given how it sends. */
    function onIncoming(message) {
      const config = { listen: ctx.get("listen"), message: ctx.get("message") };

      if (ctx.get("sendMode") === "two") {
        const x = incoming(Object.assign({}, config, { message: config.message + "/x" }), message);
        const y = incoming(Object.assign({}, config, { message: config.message + "/y" }), message);
        if ((x && adopt(x.values[0], null)) || (y && adopt(null, y.values[0]))) share();
        return;
      }

      const both = incoming(config, message);
      // Both values ride in one message, in the order they were sent in.
      if (both && adopt(both.values[0], both.values[1])) share();
    }

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    const stop = ctx.onChange(["minX", "maxX", "minY", "maxY", "invertX", "invertY"], place);

    const stopOsc = ctx.onOsc ? ctx.onOsc(onIncoming) : null;
    const stopShared = ctx.onShared
      ? ctx.onShared(function (state) {
          if (state) adopt(state.x, state.y);
        })
      : null;

    return function detach() {
      if (frame && cancelRaf) cancelRaf(frame);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      if (stop) stop();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

/** The same settings aimed at one transport, optionally at another address. */
function retarget(config, route, message) {
  const next = Object.assign({}, config, { transport: route });
  if (message !== undefined) next.message = message;
  return next;
}

module.exports = { xypad, SEND_MODES };

},{"../dmx/levels":1,"../osc-args":4,"./fields":11,"./incoming":12,"./outgoing":17}],22:[function(require,module,exports){
/**
 * The standalone adapter: OSCAR's widgets running on a page of their own.
 *
 * This is the second implementation of the `ctx` contract documented in
 * lib/widgets/index.js -- adapters/grapesjs.js is the first. That split is what
 * makes an exported interface possible at all: the widgets are already plain
 * DOM and already editor-free, so a working export is a new adapter, not a
 * second copy of the button, the slider and the pad.
 *
 * Where the GrapesJS adapter reads settings from a component model and sends
 * through the editor, this one reads them from the element's own
 * data-oscar-config and sends over socket.io.
 */

var { readWidget, WIDGET_SELECTOR } = require("../../../lib/export/config");

/**
 * The `ctx` one widget runs against.
 *
 * @param {Element} el
 * @param {object} config - this widget's settings, already parsed
 * @param {{ send: Function }} transport
 */
function contextFor(el, config, transport) {
  return {
    get: function (key) {
      return config[key];
    },

    set: function (key, value) {
      // The widget's own scratch space -- a slider remembering where its thumb
      // is between moves. It lives for as long as the page does and is not
      // written back to the markup: an exported file is the configuration, and
      // a surface must come up in the same state every time it is opened.
      config[key] = value;
    },

    send: function (message) {
      if (!message) return;
      transport.send(message.ip, message.port, message.address, message.args);
    },

    setClass: function (name, on) {
      if (on) el.classList.add(name);
      else el.classList.remove(name);
    },

    onChange: function () {
      // Nothing edits settings here: an exported page has no settings panel.
      // The widgets subscribe anyway, and expect an unsubscribe back.
      return function () {};
    },
  };
}

/**
 * Wire every widget on the page.
 *
 * @param {ParentNode} root
 * @param {{ send: Function }} transport
 * @returns {{ detach: Function, attached: number, skipped: number }}
 */
function attachAll(root, transport) {
  var elements = root.querySelectorAll(WIDGET_SELECTOR);
  var detachers = [];
  var skipped = 0;

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var widget = readWidget(el);

    if (!widget) {
      // Configuration that cannot be read leaves the control inert rather than
      // running it on the defaults; lib/export/config.js says why.
      skipped++;
      if (typeof console !== "undefined") {
        console.warn("OSCAR: a control's settings could not be read, so it is inactive", el);
      }
      continue;
    }

    detachers.push(widget.definition.attach(el, contextFor(el, widget.config, transport)));
  }

  return {
    attached: detachers.length,
    skipped: skipped,
    detach: function () {
      detachers.forEach(function (detach) {
        if (detach) detach();
      });
      detachers = [];
    },
  };
}

/**
 * The wire to OSCAR's OSC bridge.
 *
 * `io` is passed in rather than reached for, so this can be driven from a test
 * without a browser.
 *
 * @param {Function} io - the socket.io client factory
 * @param {{ host: string, port: number }} endpoint
 * @param {{ onStatus?: (state: string) => void }} [handlers]
 */
function createTransport(io, endpoint, handlers) {
  var url = "http://" + endpoint.host + ":" + endpoint.port;
  var onStatus = (handlers && handlers.onStatus) || function () {};

  var socket = io(url, {
    transports: ["websocket", "polling"],
    reconnectionDelayMax: 5000,
  });

  socket.on("connect", function () {
    onStatus("connected");
  });
  socket.on("disconnect", function () {
    onStatus("disconnected");
  });
  socket.on("connect_error", function () {
    onStatus("disconnected");
  });

  return {
    socket: socket,
    endpoint: endpoint,

    send: function (ip, port, address, args) {
      // Dropped rather than queued while the bridge is away. socket.io buffers
      // by default, so a reconnection would replay every position a slider
      // passed through while it was offline, in one burst, minutes late. On a
      // rig that is a visible glitch; a press that did not happen is not.
      if (!socket.connected) return false;

      socket.emit("osc", {
        ip: ip,
        port: port,
        address: address,
        args: Array.isArray(args) ? args : [args],
      });
      return true;
    },
  };
}

module.exports = { contextFor, attachAll, createTransport };

},{"../../../lib/export/config":3}],23:[function(require,module,exports){
/**
 * The runtime an exported OSCAR interface carries with it.
 *
 * Built into public/src/runtime.bundle.js, which is inlined into every export.
 * There is no editor here, no GrapesJS and no OSCAR server serving the page --
 * the file may well have been opened by double-clicking it on a laptop that is
 * not the one running OSCAR.
 */

var { attachAll, createTransport } = require("./adapters/standalone");

var DEFAULT_PORT = 8081;

/**
 * Where OSCAR's OSC bridge is.
 *
 * Baked in at export time, because the alternative -- asking the page's own
 * origin for /connection, the way the editor does -- is exactly what cannot
 * work here. An exported page is opened from a file:// URL or from some other
 * web server, so that request either 404s or is not made at all, and the page
 * would have no idea where to send. The editor knows the answer at the moment
 * of export, so it writes it down.
 *
 * The query string overrides it so a surface can follow OSCAR to another
 * machine without being exported again.
 */
function endpoint() {
  var baked = window.OSCAR_EXPORT || {};
  var params = new URLSearchParams(window.location.search);

  var host =
    params.get("oscar-host") || baked.host || window.location.hostname || "localhost";

  var port = Number(params.get("oscar-port") || baked.port);
  // A port of 0 means "any free port" to a TCP stack, which reaches nothing,
  // so an unreadable value falls back to OSCAR's default rather than to zero.
  if (!Number.isInteger(port) || port < 1 || port > 65535) port = DEFAULT_PORT;

  return { host: String(host), port: port };
}

/**
 * The one thing every report about a broken export needed someone to say.
 *
 * A page that looks right and sends nothing is indistinguishable from a page
 * that is broken, so it states which it is. Once the bridge answers the notice
 * fades: during a show nothing may sit on top of a control.
 */
function statusNotice(where) {
  var el = document.createElement("div");
  el.className = "oscar-status";
  el.setAttribute("role", "status");
  document.body.appendChild(el);

  var hideTimer = null;

  return function show(state) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    if (state === "connected") {
      el.className = "oscar-status oscar-status-ok";
      el.textContent = "Connected to OSCAR at " + where + ".";
      hideTimer = setTimeout(function () {
        el.className = "oscar-status oscar-status-ok oscar-status-hidden";
      }, 2000);
      return;
    }

    el.className = "oscar-status";
    el.textContent =
      "No connection to OSCAR at " +
      where +
      ". These controls cannot send anything until OSCAR is running there and " +
      "this device can reach it -- a browser cannot send OSC by itself.";
  };
}

function boot() {
  var where = endpoint();
  var label = where.host + ":" + where.port;

  if (typeof io !== "function") {
    console.error("OSCAR: this export is missing its socket.io client");
    return;
  }

  var show = statusNotice(label);
  show("disconnected");

  var transport = createTransport(io, where, { onStatus: show });
  var wired = attachAll(document, transport);

  console.log(
    "OSCAR: " +
      wired.attached +
      " control(s) pointed at the OSC bridge on " +
      label +
      (wired.skipped ? ", " + wired.skipped + " skipped" : "")
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

},{"./adapters/standalone":22}]},{},[23]);
