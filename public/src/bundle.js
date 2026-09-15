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

module.exports = { ARG_TYPES, NUMERIC_ARG_TYPES, toArgs, isSendable, isFalsy };

},{}],4:[function(require,module,exports){
"use strict";

/**
 * OSCAR's own project file format version.
 *
 * Bump this ONLY when a saved project needs converting to stay readable --
 * not once per OSCAR release. Add the matching entry to MIGRATIONS when you
 * do, and a test for it.
 */
const CURRENT_FORMAT = 2;

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

  return { status: "ok", data, from, migrated: from < CURRENT_FORMAT };
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
    format: CURRENT_FORMAT,
    oscar: oscar || null,
    grapesjs: grapesjs || null,
    name,
    updatedAt: now().toISOString(),
    data,
  };
}

module.exports = {
  CURRENT_FORMAT,
  stripEditorState,
  MIGRATIONS,
  isGrapesProject,
  detectFormat,
  openProject,
  stampProject,
};

},{}],5:[function(require,module,exports){
"use strict";

const {
  field,
  enabled,
  connection,
  connectionChecks,
  transport,
  dmxConnection,
  dmxDefaults,
  dmxChecks,
} = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { ARG_TYPES, isSendable } = require("../osc-args");

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
   * Everything here is plain DOM, so porting to another editor means providing
   * those three, not rewriting the button.
   */
  attach: function (el, ctx) {
    let on = false;

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
      ctx.setClass(ON_CLASS, on);
      ctx.send(resolve(ctx, on));
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

    return function detach() {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("keyup", onKeyUp);
      if (root) root.removeEventListener("blur", release);
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

},{"../osc-args":3,"./fields":6,"./outgoing":7}],6:[function(require,module,exports){
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
    field("ip", "Ip", "text", { placeholder: "localhost" }),
    field("port", "Port", "number", { min: 1, max: 65535 }),
    field("message", "Message", "text", { placeholder: "/address" }),
  ];
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
  if (value === "localhost" || IPV4.test(String(value))) return null;
  return "That IP address isn't valid: " + value;
}

function checkPort(value) {
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

},{"../dmx/levels":1,"../dmx/spec":2}],7:[function(require,module,exports){
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

},{"../dmx/levels":1,"../dmx/spec":2,"../osc-args":3}],8:[function(require,module,exports){
"use strict";

const {
  field,
  enabled,
  connection,
  connectionChecks,
  checkNumber,
  transport,
  dmxConnection,
  dmxDefaults,
  dmxChecks,
} = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { NUMERIC_ARG_TYPES } = require("../osc-args");
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
    }

    el.addEventListener("input", onInput);
    // A settings edit changes the range or flips the direction under a thumb
    // that is already somewhere; re-apply rather than leave the two disagreeing.
    const stop = ctx.onChange(["min", "max", "value", "orientation", "invert"], apply);

    return function detach() {
      el.removeEventListener("input", onInput);
      if (stop) stop();
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

},{"../dmx/levels":1,"../osc-args":3,"./fields":6,"./outgoing":7}],9:[function(require,module,exports){
"use strict";

const {
  field,
  enabled,
  connection,
  connectionChecks,
  checkNumber,
  transport,
  dmxConnection,
  dmxDefaults,
  dmxChecks,
} = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { NUMERIC_ARG_TYPES } = require("../osc-args");
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
    }

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    const stop = ctx.onChange(["minX", "maxX", "minY", "maxY", "invertX", "invertY"], place);

    return function detach() {
      if (frame && cancelRaf) cancelRaf(frame);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      if (stop) stop();
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

},{"../dmx/levels":1,"../osc-args":3,"./fields":6,"./outgoing":7}],10:[function(require,module,exports){
/**
 * The GrapesJS adapter: the only file in OSCAR that knows what editor we use.
 *
 * It translates a neutral widget definition (lib/widgets/) into the things
 * GrapesJS wants -- a component type, a trait list, a block -- and supplies the
 * `ctx` the widget's behaviour runs against. Swapping editors means rewriting
 * this file; the widgets themselves do not change.
 */

/** Neutral field descriptor -> GrapesJS trait. */
function toTrait(field) {
  var trait = {
    // Every setting is a component property rather than an HTML attribute.
    // Attributes would end up in the exported markup, where they are noise at
    // best and a stale copy of the truth at worst.
    changeProp: true,
    name: field.key,
    label: field.label,
    type: field.type,
  };

  if (field.type === "select") {
    // GrapesJS wants { id, name }, which is the shape lib/widgets uses too.
    trait.options = field.options;
  }
  if (field.placeholder) trait.placeholder = field.placeholder;
  if (field.min !== undefined) trait.min = field.min;
  if (field.max !== undefined) trait.max = field.max;
  if (field.step !== undefined) trait.step = field.step;

  return trait;
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
 * A field may carry `showIf: { key, in: [...] }`, which is how the DMX half of
 * a panel stays out of the way of anyone sending only OSC. The rule is data
 * rather than a callback so the adapter can also work out which settings it has
 * to watch for the panel to keep up.
 */
function visibleFields(definition, config) {
  return definition.fields.filter(function (field) {
    var rule = field.showIf;
    if (!rule) return true;
    return rule.in.indexOf(config[rule.key]) !== -1;
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

/**
 * Build the `ctx` a widget's behaviour runs against.
 *
 * `set` writes with `silent` so that storing a value mid-drag cannot trigger
 * the validators or a re-render -- the old slider needed a `fromView` flag
 * threaded through its model to dodge exactly that, and the pad would have
 * fought its own handle.
 */
function contextFor(view, editor) {
  var model = view.model;

  return {
    // The component's own id, which is what names this widget's claim on a
    // block of DMX channels. It survives saving, loading and reconnecting, so a
    // tablet that drops off the wifi resumes driving the same channels instead
    // of appearing as a second source fighting the first.
    id: model.getId(),

    get: function (key) {
      return model.get(key);
    },

    set: function (key, value) {
      model.set(key, value, { silent: true });
    },

    // A message may carry an OSC half, a DMX half, or both; each goes out on
    // its own bridge and neither waits for the other.
    send: function (message) {
      if (!message) return;
      if (message.address && editor.sendOSC) {
        editor.sendOSC(message.ip, message.port, message.address, message.args);
      }
      if (message.dmx && editor.sendDMX) editor.sendDMX(message.dmx);
    },

    setClass: function (name, on) {
      // Straight onto the element, never onto the model: a class added to the
      // model is saved into the project file, so a surface stored while a
      // toggle happened to be on would reload wearing its on state.
      if (on) view.el.classList.add(name);
      else view.el.classList.remove(name);
    },

    onChange: function (keys, fn) {
      var event = keys
        .map(function (key) {
          return "change:" + key;
        })
        .join(" ");
      model.on(event, fn);
      return function () {
        model.off(event, fn);
      };
    },
  };
}

/**
 * Register one widget definition with GrapesJS.
 *
 * Returns a plugin function, which is what the editor's `plugins` list takes.
 */
function register(definition) {
  return function (editor, options) {
    var ipserver = (options && options.ipserver) || "localhost";

    var defaults = Object.assign({}, definition.defaults, { ip: ipserver });

    editor.DomComponents.addType(definition.name, {
      isComponent: function (el) {
        if (matches(definition, el)) return { type: definition.name };
      },

      model: {
        defaults: Object.assign(
          {
            tagName: definition.tag,
            attributes: Object.assign({}, definition.attributes),
            droppable: false,
            resizable: true,
            traits: visibleFields(definition, defaults).map(toTrait),
          },
          defaults,
          // A widget whose label is its text content renders that text as its
          // only child; anything else starts empty.
          definition.text ? { components: String(defaults[definition.text] || "") } : {}
        ),

        init: function () {
          var model = this;

          // A loaded project may already be set to DMX, and switching Output
          // has to bring the right half of the panel with it. GrapesJS renders
          // the trait list once per selection, so the panel is also told to
          // redraw the component it is showing.
          var reveals = revealKeys(definition);
          if (reveals.length) {
            // The type's traits were built from its defaults. A component read
            // back from a saved project may disagree with them, so its panel is
            // rebuilt -- but only when it would actually come out different.
            var wanted = visibleFields(definition, configOf(model, definition));
            var current = model.get("traits");
            if (!current || current.length !== wanted.length) {
              model.set("traits", wanted.map(toTrait));
            }

            model.on(
              reveals
                .map(function (key) {
                  return "change:" + key;
                })
                .join(" "),
              function () {
                model.set(
                  "traits",
                  visibleFields(definition, configOf(model, definition)).map(toTrait)
                );
                editor.trigger("component:toggled");
              }
            );
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

      view: {
        onRender: function () {
          if (this.oscarDetach) this.oscarDetach();
          this.oscarDetach = definition.attach(this.el, contextFor(this, editor));
        },

        removed: function () {
          // DMX is a stream: deleting a widget that was driving channels has to
          // hand them back, or the rig holds that widget's last look with
          // nothing left on the surface able to change it.
          if (editor.stopDMX) editor.stopDMX(this.model.getId());

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

module.exports = {
  register: register,
  toTrait: toTrait,
  matches: matches,
  visibleFields: visibleFields,
  revealKeys: revealKeys,
};

},{}],11:[function(require,module,exports){
/**
 * OSC button, wired to GrapesJS.
 *
 * The button itself lives in lib/widgets/button.js and knows nothing about the
 * editor; this is only the wiring.
 */
var { register } = require("./adapters/grapesjs");
var { button } = require("../../lib/widgets/button");

module.exports = register(button);

},{"../../lib/widgets/button":5,"./adapters/grapesjs":10}],12:[function(require,module,exports){
window.$ = $ = window.jQuery = require("jquery");

// These plugins attach themselves to whichever jQuery they are handed. The
// bundle carries its own copy of jQuery, so they must be required here rather
// than loaded as separate <script> tags -- otherwise they extend the page's
// jQuery and $.alert/$.confirm/.bootstrapTable go missing on this one.
require("bootstrap-table");
// jquery-confirm's CommonJS build exports an initialiser instead of running
// itself, so it has to be invoked with the jQuery it should extend.
require("jquery-confirm")(window, $);

// GrapesJS 0.21+ no longer ships Font Awesome, so OSCAR's icons are inline SVG.
var ICONS = {
  save: "M15,9H5V5H15M12,19A3,3 0 0,1 9,16A3,3 0 0,1 12,13A3,3 0 0,1 15,16A3,3 0 0,1 12,19M17,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3Z",
  open: "M19,20H4C2.89,20 2,19.1 2,18V6C2,4.89 2.89,4 4,4H10L12,6H19A2,2 0 0,1 21,8H21L4,8V18L6.14,10H23.21L20.93,18.5C20.7,19.37 19.92,20 19,20Z",
  help: "M15.07,11.25L14.17,12.17C13.45,12.89 13,13.5 13,15H11V14.5C11,13.39 11.45,12.39 12.17,11.67L13.41,10.41C13.78,10.05 14,9.55 14,9C14,7.89 13.1,7 12,7A2,2 0 0,0 10,9H8A4,4 0 0,1 12,5A4,4 0 0,1 16,9C16,9.88 15.64,10.67 15.07,11.25M13,19H11V17H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12C22,6.47 17.5,2 12,2Z",
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

var oscarButton = require("./oscar_button");
var oscarSlider = require("./oscar_slider");
var oscarXypad = require("./oscar_xypad");

/** Hand a widget plugin the address other devices should send to. */
function withIp(plugin, ipServer) {
  return function (editor) {
    plugin(editor, { ipserver: ipServer });
  };
}
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
    dragMode: "absolute",
    height: "100%",
    container: "#gjs",
    fromElement: true,
    allowScripts: 1,
    canvas: { styles: ["assets/css/toggle.css"] },
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
        return Object.assign(
          { oscarFormat: projectFormat.CURRENT_FORMAT },
          projectFormat.stripEditorState(data)
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
      withIp(oscarButton, ipServer),
      withIp(oscarSlider, ipServer),
      withIp(oscarXypad, ipServer),
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
        // Keep OSCAR's own palette (css/oscar_colors.css) rather than the
        // preset's theme.
        useCustomTheme: false,
        showStylesOnChange: true,
        modalImportTitle: "Import Template",
        modalImportLabel:
          '<div style="margin-bottom: 10px; font-size: 13px;">Paste here your HTML/CSS and click Import</div>',
        modalImportContent: function (editor) {
          return editor.getHtml() + "<style>" + editor.getCss() + "</style>";
        },
      },
    },
  });

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

  var tableReady = false;

  function openProjects(mode) {
    setModal(mode, "table-panel");
    $("#save-button").toggle(mode === "Save");
    $("#load-button").toggle(mode === "Load");

    if (!tableReady) {
      initTable();
      tableReady = true;
    } else {
      $("#projects-table").bootstrapTable("refresh");
    }
  }

  editor.Commands.add("open-projects", function (ed, sender, options) {
    openProjects((options && options.type) || "Save");
  });

  // ---- project table -----------------------------------------------------
  function initTable() {
    $("#projects-table").bootstrapTable({
      url: "/projects",
      height: 300,
      columns: [
        { title: "Name", field: "name", sortable: true },
        { title: "Size", field: "size", sortable: true, formatter: sizeFormatter },
        { title: "Saved", field: "date", sortable: true },
        {
          title: "",
          field: "action",
          clickToSelect: false,
          events: window.operateEvents,
          formatter: operateFormatter,
        },
      ],
      pagination: false,
      search: false,
      sortable: true,
      clickToSelect: true,
      singleSelect: true,
      onClickRow: function (row) {
        $("#project-name").val(row.name).attr("id-project", row._id);
      },
      onLoadError: function (status, jqXHR) {
        console.log("Could not load projects", jqXHR);
      },
    });
  }

  function sizeFormatter(value) {
    if (value !== 0 && !value) return "";
    return value < 1024 ? value + " B" : Math.round(value / 1024) + " KB";
  }

  function operateFormatter() {
    return '<a class="remove icon" href="javascript:void(0)" title="Remove">' + icon("remove") + "</a>";
  }

  window.operateEvents = {
    "click .remove": function (e, value, row) {
      $.confirm({
        title: "Delete Project",
        content:
          "Are you sure you want to delete this project? You won't be able to recover it afterwards.",
        buttons: {
          confirm: function () {
            $.ajax({ type: "DELETE", url: "/remove/" + row._id })
              .done(function (data) {
                $("#projects-table").bootstrapTable("refresh");
                $.alert(data.error || data.msg);
              })
              .fail(function () {
                $.alert("Could not delete that project");
              });
          },
          cancel: function () {},
        },
      });
    },
  };

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

        $("#projects-table").bootstrapTable("refresh");
        $.alert(res.msg);
        modal.close();
      })
      .catch(function () {
        hideLoader();
        $.alert("Could not reach the OSCAR server");
      });
  }

  // ---- load --------------------------------------------------------------
  document.getElementById("load-button").onclick = function () {
    var id = projectName.getAttribute("id-project");
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
  var beforePreview = null;

  editor.on("command:run:preview", function () {
    // Hand the canvas to the preview page before locking, so the lock doesn't
    // travel with it.
    postJSON("/save/preview", { project: editor.getProjectData() }).catch(function (err) {
      console.log("Could not hand off preview", err);
    });

    editor.select();
    beforePreview = [];
    editor.getWrapper().onAll(function (component) {
      var previous = {};
      Object.keys(PREVIEW_LOCK).forEach(function (key) {
        previous[key] = component.get(key);
      });
      beforePreview.push([component, previous]);
      component.set(PREVIEW_LOCK, { avoidStore: true });
    });

    // The selection toolbar, badges and resize handles live outside the canvas
    // and would otherwise float over the control surface, delete button and
    // all.
    editor.getEl().classList.add("oscar-previewing");
  });

  editor.on("command:stop:preview", function () {
    if (beforePreview) {
      beforePreview.forEach(function (entry) {
        entry[0].set(entry[1], { avoidStore: true });
      });
      beforePreview = null;
    }
    editor.getEl().classList.remove("oscar-previewing");
  });

  // ---- panel buttons -----------------------------------------------------
  pn.addButton("options", {
    id: "open-save",
    label: icon("save"),
    command: function () {
      editor.runCommand("open-projects", { type: "Save" });
    },
    attributes: { title: "Save project", "data-tooltip-pos": "bottom" },
  });

  pn.addButton("options", {
    id: "open-load",
    label: icon("open"),
    command: function () {
      editor.runCommand("open-projects", { type: "Load" });
    },
    attributes: { title: "Load project", "data-tooltip-pos": "bottom" },
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
    "gjs-open-import-webpage": "Import",
    "canvas-clear": "Clear canvas",
    "toggle-lock": null,
    "open-save": "Save project",
    "open-load": "Load project",
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

},{"../../lib/project-format":4,"./oscar_button":11,"./oscar_slider":14,"./oscar_xypad":15,"bootstrap-table":16,"jquery":18,"jquery-confirm":17}],13:[function(require,module,exports){
window.$ = window.jQuery = require("jquery");

var oscarButton = require("./oscar_button");
var oscarSlider = require("./oscar_slider");
var oscarXypad = require("./oscar_xypad");

var editor;

/** Hand a widget plugin the address other devices should send to. */
function withIp(plugin, ipServer) {
  return function (ed) {
    plugin(ed, { ipserver: ipServer });
  };
}

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
    height: "100%",
    container: "#gjs-oscar-preview",
    allowScripts: 1,
    panels: { defaults: [] },
    canvas: { styles: ["assets/css/toggle.css"] },
    // The preview only displays whatever the editor handed over; it must never
    // write into the editor's autosave.
    storageManager: false,
    plugins: [
      "oscar_socket",
      "oscar_ip",
      withIp(oscarButton, ipServer),
      withIp(oscarSlider, ipServer),
      withIp(oscarXypad, ipServer),
      "grapesjs-touch",
    ],
    pluginsOpts: {
      oscar_socket: { ipserver: ipServer, socketPort: socketPort },
    },
  });

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

      editor.loadProjectData(data);
      lockDown();
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

},{"./oscar_button":11,"./oscar_slider":14,"./oscar_xypad":15,"jquery":18}],14:[function(require,module,exports){
/**
 * OSC slider, wired to GrapesJS.
 *
 * The slider itself lives in lib/widgets/slider.js and knows nothing about the
 * editor; this is only the wiring.
 */
var { register } = require("./adapters/grapesjs");
var { slider } = require("../../lib/widgets/slider");

module.exports = register(slider);

},{"../../lib/widgets/slider":8,"./adapters/grapesjs":10}],15:[function(require,module,exports){
/**
 * OSC XY pad, wired to GrapesJS.
 *
 * The pad itself lives in lib/widgets/xypad.js and knows nothing about the
 * editor; this is only the wiring.
 */
var { register } = require("./adapters/grapesjs");
var { xypad } = require("../../lib/widgets/xypad");

module.exports = register(xypad);

},{"../../lib/widgets/xypad":9,"./adapters/grapesjs":10}],16:[function(require,module,exports){
(function (global){(function (){
/**
  * bootstrap-table - An extended table to integration with some of the most widely used CSS frameworks. (Supports Bootstrap, Semantic UI, Bulma, Material Design, Foundation)
  *
  * @version v1.27.3
  * @homepage https://bootstrap-table.com
  * @author wenzhixin <wenzhixin2010@gmail.com> (http://wenzhixin.net.cn/)
  * @license MIT
  */

!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e(require("jquery")):"function"==typeof define&&define.amd?define(["jquery"],e):(t="undefined"!=typeof globalThis?globalThis:t||self).BootstrapTable=e(t.jQuery)}(this,function(t){"use strict";function e(t,e){(null==e||e>t.length)&&(e=t.length);for(var n=0,i=Array(e);n<e;n++)i[n]=t[n];return i}function n(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function i(t,e){for(var n=0;n<e.length;n++){var i=e[n];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(t,h(i.key),i)}}function r(t,e,n){return e&&i(t.prototype,e),n&&i(t,n),Object.defineProperty(t,"prototype",{writable:!1}),t}function o(t,e){var n="undefined"!=typeof Symbol&&t[Symbol.iterator]||t["@@iterator"];if(!n){if(Array.isArray(t)||(n=d(t))||e){n&&(t=n);var i=0,r=function(){};return{s:r,n:function(){return i>=t.length?{done:!0}:{done:!1,value:t[i++]}},e:function(t){throw t},f:r}}throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}var o,a=!0,s=!1;return{s:function(){n=n.call(t)},n:function(){var t=n.next();return a=t.done,t},e:function(t){s=!0,o=t},f:function(){try{a||null==n.return||n.return()}finally{if(s)throw o}}}}function a(t,e,n){return(e=h(e))in t?Object.defineProperty(t,e,{value:n,enumerable:!0,configurable:!0,writable:!0}):t[e]=n,t}function s(t,e){var n=Object.keys(t);if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(t);e&&(i=i.filter(function(e){return Object.getOwnPropertyDescriptor(t,e).enumerable})),n.push.apply(n,i)}return n}function l(t){for(var e=1;e<arguments.length;e++){var n=null!=arguments[e]?arguments[e]:{};e%2?s(Object(n),!0).forEach(function(e){a(t,e,n[e])}):Object.getOwnPropertyDescriptors?Object.defineProperties(t,Object.getOwnPropertyDescriptors(n)):s(Object(n)).forEach(function(e){Object.defineProperty(t,e,Object.getOwnPropertyDescriptor(n,e))})}return t}function c(t,e){return function(t){if(Array.isArray(t))return t}(t)||function(t,e){var n=null==t?null:"undefined"!=typeof Symbol&&t[Symbol.iterator]||t["@@iterator"];if(null!=n){var i,r,o,a,s=[],l=!0,c=!1;try{if(o=(n=n.call(t)).next,0===e);else for(;!(l=(i=o.call(n)).done)&&(s.push(i.value),s.length!==e);l=!0);}catch(t){c=!0,r=t}finally{try{if(!l&&null!=n.return&&(a=n.return(),Object(a)!==a))return}finally{if(c)throw r}}return s}}(t,e)||d(t,e)||function(){throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}()}function u(t){return function(t){if(Array.isArray(t))return e(t)}(t)||function(t){if("undefined"!=typeof Symbol&&null!=t[Symbol.iterator]||null!=t["@@iterator"])return Array.from(t)}(t)||d(t)||function(){throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}()}function h(t){var e=function(t,e){if("object"!=typeof t||!t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var i=n.call(t,e);if("object"!=typeof i)return i;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==typeof e?e:e+""}function f(t){return f="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},f(t)}function d(t,n){if(t){if("string"==typeof t)return e(t,n);var i={}.toString.call(t).slice(8,-1);return"Object"===i&&t.constructor&&(i=t.constructor.name),"Map"===i||"Set"===i?Array.from(t):"Arguments"===i||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(i)?e(t,n):void 0}}var p,g,v="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:{},b={};function m(){if(g)return p;g=1;var t=function(t){return t&&t.Math===Math&&t};return p=t("object"==typeof globalThis&&globalThis)||t("object"==typeof window&&window)||t("object"==typeof self&&self)||t("object"==typeof v&&v)||t("object"==typeof p&&p)||function(){return this}()||Function("return this")()}var y,w,S,x,O,C,k,T,P={};function A(){return w?y:(w=1,y=function(t){try{return!!t()}catch(t){return!0}})}function I(){if(x)return S;x=1;var t=A();return S=!t(function(){return 7!==Object.defineProperty({},1,{get:function(){return 7}})[1]})}function $(){if(C)return O;C=1;var t=A();return O=!t(function(){var t=function(){}.bind();return"function"!=typeof t||t.hasOwnProperty("prototype")})}function E(){if(T)return k;T=1;var t=$(),e=Function.prototype.call;return k=t?e.bind(e):function(){return e.apply(e,arguments)},k}var R,j,_,N,L,F,D,B,V,H,M,U,z,q,W,G,K,Y,J,Q,X,Z,tt,et,nt,it,rt,ot,at,st,lt,ct,ut,ht,ft,dt,pt,gt,vt,bt,mt,yt={};function wt(){if(R)return yt;R=1;var t={}.propertyIsEnumerable,e=Object.getOwnPropertyDescriptor,n=e&&!t.call({1:2},1);return yt.f=n?function(t){var n=e(this,t);return!!n&&n.enumerable}:t,yt}function St(){return _?j:(_=1,j=function(t,e){return{enumerable:!(1&t),configurable:!(2&t),writable:!(4&t),value:e}})}function xt(){if(L)return N;L=1;var t=$(),e=Function.prototype,n=e.call,i=t&&e.bind.bind(n,n);return N=t?i:function(t){return function(){return n.apply(t,arguments)}},N}function Ot(){if(D)return F;D=1;var t=xt(),e=t({}.toString),n=t("".slice);return F=function(t){return n(e(t),8,-1)}}function Ct(){if(V)return B;V=1;var t=xt(),e=A(),n=Ot(),i=Object,r=t("".split);return B=e(function(){return!i("z").propertyIsEnumerable(0)})?function(t){return"String"===n(t)?r(t,""):i(t)}:i}function kt(){return M?H:(M=1,H=function(t){return null==t})}function Tt(){if(z)return U;z=1;var t=kt(),e=TypeError;return U=function(n){if(t(n))throw new e("Can't call method on "+n);return n}}function Pt(){if(W)return q;W=1;var t=Ct(),e=Tt();return q=function(n){return t(e(n))}}function At(){if(K)return G;K=1;var t="object"==typeof document&&document.all;return G=void 0===t&&void 0!==t?function(e){return"function"==typeof e||e===t}:function(t){return"function"==typeof t}}function It(){if(J)return Y;J=1;var t=At();return Y=function(e){return"object"==typeof e?null!==e:t(e)}}function $t(){if(X)return Q;X=1;var t=m(),e=At();return Q=function(n,i){return arguments.length<2?(r=t[n],e(r)?r:void 0):t[n]&&t[n][i];var r},Q}function Et(){if(tt)return Z;tt=1;var t=xt();return Z=t({}.isPrototypeOf)}function Rt(){if(nt)return et;nt=1;var t=m().navigator,e=t&&t.userAgent;return et=e?String(e):""}function jt(){if(rt)return it;rt=1;var t,e,n=m(),i=Rt(),r=n.process,o=n.Deno,a=r&&r.versions||o&&o.version,s=a&&a.v8;return s&&(e=(t=s.split("."))[0]>0&&t[0]<4?1:+(t[0]+t[1])),!e&&i&&(!(t=i.match(/Edge\/(\d+)/))||t[1]>=74)&&(t=i.match(/Chrome\/(\d+)/))&&(e=+t[1]),it=e}function _t(){if(at)return ot;at=1;var t=jt(),e=A(),n=m().String;return ot=!!Object.getOwnPropertySymbols&&!e(function(){var e=Symbol("symbol detection");return!n(e)||!(Object(e)instanceof Symbol)||!Symbol.sham&&t&&t<41})}function Nt(){if(lt)return st;lt=1;var t=_t();return st=t&&!Symbol.sham&&"symbol"==typeof Symbol.iterator}function Lt(){if(ut)return ct;ut=1;var t=$t(),e=At(),n=Et(),i=Nt(),r=Object;return ct=i?function(t){return"symbol"==typeof t}:function(i){var o=t("Symbol");return e(o)&&n(o.prototype,r(i))}}function Ft(){if(ft)return ht;ft=1;var t=String;return ht=function(e){try{return t(e)}catch(t){return"Object"}}}function Dt(){if(pt)return dt;pt=1;var t=At(),e=Ft(),n=TypeError;return dt=function(i){if(t(i))return i;throw new n(e(i)+" is not a function")}}function Bt(){if(vt)return gt;vt=1;var t=Dt(),e=kt();return gt=function(n,i){var r=n[i];return e(r)?void 0:t(r)}}function Vt(){if(mt)return bt;mt=1;var t=E(),e=At(),n=It(),i=TypeError;return bt=function(r,o){var a,s;if("string"===o&&e(a=r.toString)&&!n(s=t(a,r)))return s;if(e(a=r.valueOf)&&!n(s=t(a,r)))return s;if("string"!==o&&e(a=r.toString)&&!n(s=t(a,r)))return s;throw new i("Can't convert object to primitive value")}}var Ht,Mt,Ut,zt,qt,Wt,Gt,Kt,Yt,Jt,Qt,Xt,Zt,te,ee,ne,ie,re,oe,ae,se,le,ce,ue,he={exports:{}};function fe(){return Mt?Ht:(Mt=1,Ht=!1)}function de(){if(zt)return Ut;zt=1;var t=m(),e=Object.defineProperty;return Ut=function(n,i){try{e(t,n,{value:i,configurable:!0,writable:!0})}catch(e){t[n]=i}return i}}function pe(){if(qt)return he.exports;qt=1;var t=fe(),e=m(),n=de(),i="__core-js_shared__",r=he.exports=e[i]||n(i,{});return(r.versions||(r.versions=[])).push({version:"3.49.0",mode:t?"pure":"global",copyright:"© 2013–2025 Denis Pushkarev (zloirock.ru), 2025–2026 CoreJS Company (core-js.io). All rights reserved.",license:"https://github.com/zloirock/core-js/blob/v3.49.0/LICENSE",source:"https://github.com/zloirock/core-js"}),he.exports}function ge(){if(Gt)return Wt;Gt=1;var t=pe();return Wt=function(e,n){return t[e]||(t[e]=n||{})}}function ve(){if(Yt)return Kt;Yt=1;var t=Tt(),e=Object;return Kt=function(n){return e(t(n))}}function be(){if(Qt)return Jt;Qt=1;var t=xt(),e=ve(),n=t({}.hasOwnProperty);return Jt=Object.hasOwn||function(t,i){return n(e(t),i)}}function me(){if(Zt)return Xt;Zt=1;var t=xt(),e=0,n=Math.random(),i=t(1.1.toString);return Xt=function(t){return"Symbol("+(void 0===t?"":t)+")_"+i(++e+n,36)}}function ye(){if(ee)return te;ee=1;var t=m(),e=ge(),n=be(),i=me(),r=_t(),o=Nt(),a=t.Symbol,s=e("wks"),l=o?a.for||a:a&&a.withoutSetter||i;return te=function(t){return n(s,t)||(s[t]=r&&n(a,t)?a[t]:l("Symbol."+t)),s[t]}}function we(){if(ie)return ne;ie=1;var t=E(),e=It(),n=Lt(),i=Bt(),r=Vt(),o=ye(),a=TypeError,s=o("toPrimitive");return ne=function(o,l){if(!e(o)||n(o))return o;var c,u=i(o,s);if(u){if(void 0===l&&(l="default"),c=t(u,o,l),!e(c)||n(c))return c;throw new a("Can't convert object to primitive value")}return void 0===l&&(l="number"),r(o,l)}}function Se(){if(oe)return re;oe=1;var t=we(),e=Lt();return re=function(n){var i=t(n,"string");return e(i)?i:i+""}}function xe(){if(se)return ae;se=1;var t=m(),e=It(),n=t.document,i=e(n)&&e(n.createElement);return ae=function(t){return i?n.createElement(t):{}}}function Oe(){if(ce)return le;ce=1;var t=I(),e=A(),n=xe();return le=!t&&!e(function(){return 7!==Object.defineProperty(n("div"),"a",{get:function(){return 7}}).a})}function Ce(){if(ue)return P;ue=1;var t=I(),e=E(),n=wt(),i=St(),r=Pt(),o=Se(),a=be(),s=Oe(),l=Object.getOwnPropertyDescriptor;return P.f=t?l:function(t,c){if(t=r(t),c=o(c),s)try{return l(t,c)}catch(t){}if(a(t,c))return i(!e(n.f,t,c),t[c])},P}var ke,Te,Pe,Ae,Ie,$e,Ee,Re={};function je(){if(Te)return ke;Te=1;var t=I(),e=A();return ke=t&&e(function(){return 42!==Object.defineProperty(function(){},"prototype",{value:42,writable:!1}).prototype})}function _e(){if(Ae)return Pe;Ae=1;var t=It(),e=String,n=TypeError;return Pe=function(i){if(t(i))return i;throw new n(e(i)+" is not an object")}}function Ne(){if(Ie)return Re;Ie=1;var t=I(),e=Oe(),n=je(),i=_e(),r=Se(),o=TypeError,a=Object.defineProperty,s=Object.getOwnPropertyDescriptor,l="enumerable",c="configurable",u="writable";return Re.f=t?n?function(t,e,n){if(i(t),e=r(e),i(n),"function"==typeof t&&"prototype"===e&&"value"in n&&u in n&&!n[u]){var o=s(t,e);o&&o[u]&&(t[e]=n.value,n={configurable:c in n?n[c]:o[c],enumerable:l in n?n[l]:o[l],writable:!1})}return a(t,e,n)}:a:function(t,n,s){if(i(t),n=r(n),i(s),e)try{return a(t,n,s)}catch(t){}if("get"in s||"set"in s)throw new o("Accessors not supported");return"value"in s&&(t[n]=s.value),t},Re}function Le(){if(Ee)return $e;Ee=1;var t=I(),e=Ne(),n=St();return $e=t?function(t,i,r){return e.f(t,i,n(1,r))}:function(t,e,n){return t[e]=n,t},$e}var Fe,De,Be,Ve,He,Me,Ue,ze,qe,We,Ge,Ke,Ye,Je,Qe,Xe={exports:{}};function Ze(){if(De)return Fe;De=1;var t=I(),e=be(),n=Function.prototype,i=t&&Object.getOwnPropertyDescriptor,r=e(n,"name"),o=r&&"something"===function(){}.name,a=r&&(!t||t&&i(n,"name").configurable);return Fe={EXISTS:r,PROPER:o,CONFIGURABLE:a}}function tn(){if(Ve)return Be;Ve=1;var t=xt(),e=At(),n=pe(),i=t(Function.toString);return e(n.inspectSource)||(n.inspectSource=function(t){return i(t)}),Be=n.inspectSource}function en(){if(ze)return Ue;ze=1;var t=ge(),e=me(),n=t("keys");return Ue=function(t){return n[t]||(n[t]=e(t))}}function nn(){return We?qe:(We=1,qe={})}function rn(){if(Ke)return Ge;Ke=1;var t,e,n,i=function(){if(Me)return He;Me=1;var t=m(),e=At(),n=t.WeakMap;return He=e(n)&&/native code/.test(String(n))}(),r=m(),o=It(),a=Le(),s=be(),l=pe(),c=en(),u=nn(),h="Object already initialized",f=r.TypeError,d=r.WeakMap;if(i||l.state){var p=l.state||(l.state=new d);p.get=p.get,p.has=p.has,p.set=p.set,t=function(t,e){if(p.has(t))throw new f(h);return e.facade=t,p.set(t,e),e},e=function(t){return p.get(t)||{}},n=function(t){return p.has(t)}}else{var g=c("state");u[g]=!0,t=function(t,e){if(s(t,g))throw new f(h);return e.facade=t,a(t,g,e),e},e=function(t){return s(t,g)?t[g]:{}},n=function(t){return s(t,g)}}return Ge={set:t,get:e,has:n,enforce:function(i){return n(i)?e(i):t(i,{})},getterFor:function(t){return function(n){var i;if(!o(n)||(i=e(n)).type!==t)throw new f("Incompatible receiver, "+t+" required");return i}}}}function on(){if(Ye)return Xe.exports;Ye=1;var t=xt(),e=A(),n=At(),i=be(),r=I(),o=Ze().CONFIGURABLE,a=tn(),s=rn(),l=s.enforce,c=s.get,u=String,h=Object.defineProperty,f=t("".slice),d=t("".replace),p=t([].join),g=r&&!e(function(){return 8!==h(function(){},"length",{value:8}).length}),v=String(String).split("String"),b=Xe.exports=function(t,e,n){"Symbol("===f(u(e),0,7)&&(e="["+d(u(e),/^Symbol\(([^)]*)\).*$/,"$1")+"]"),n&&n.getter&&(e="get "+e),n&&n.setter&&(e="set "+e),(!i(t,"name")||o&&t.name!==e)&&(r?h(t,"name",{value:e,configurable:!0}):t.name=e),g&&n&&i(n,"arity")&&t.length!==n.arity&&h(t,"length",{value:n.arity});try{n&&i(n,"constructor")&&n.constructor?r&&h(t,"prototype",{writable:!1}):t.prototype&&(t.prototype=void 0)}catch(t){}var a=l(t);return i(a,"source")||(a.source=p(v,"string"==typeof e?e:"")),t};return Function.prototype.toString=b(function(){return n(this)&&c(this).source||a(this)},"toString"),Xe.exports}function an(){if(Qe)return Je;Qe=1;var t=At(),e=Ne(),n=on(),i=de();return Je=function(r,o,a,s){s||(s={});var l=s.enumerable,c=void 0!==s.name?s.name:o;if(t(a)&&n(a,c,s),s.global)l?r[o]=a:i(o,a);else{try{s.unsafe?r[o]&&(l=!0):delete r[o]}catch(t){}l?r[o]=a:e.f(r,o,{value:a,enumerable:!1,configurable:!s.nonConfigurable,writable:!s.nonWritable})}return r}}var sn,ln,cn,un,hn,fn,dn,pn,gn,vn,bn,mn,yn,wn,Sn,xn,On,Cn={};function kn(){if(un)return cn;un=1;var t=function(){if(ln)return sn;ln=1;var t=Math.ceil,e=Math.floor;return sn=Math.trunc||function(n){var i=+n;return(i>0?e:t)(i)}}();return cn=function(e){var n=+e;return n!=n||0===n?0:t(n)}}function Tn(){if(fn)return hn;fn=1;var t=kn(),e=Math.max,n=Math.min;return hn=function(i,r){var o=t(i);return o<0?e(o+r,0):n(o,r)}}function Pn(){if(pn)return dn;pn=1;var t=kn(),e=Math.min;return dn=function(n){var i=t(n);return i>0?e(i,9007199254740991):0}}function An(){if(vn)return gn;vn=1;var t=Pn();return gn=function(e){return t(e.length)}}function In(){if(mn)return bn;mn=1;var t=Pt(),e=Tn(),n=An(),i=function(i){return function(r,o,a){var s=t(r),l=n(s);if(0===l)return!i&&-1;var c,u=e(a,l);if(i&&o!=o){for(;l>u;)if((c=s[u++])!=c)return!0}else for(;l>u;u++)if((i||u in s)&&s[u]===o)return i||u||0;return!i&&-1}};return bn={includes:i(!0),indexOf:i(!1)}}function $n(){if(wn)return yn;wn=1;var t=xt(),e=be(),n=Pt(),i=In().indexOf,r=nn(),o=t([].push);return yn=function(t,a){var s,l=n(t),c=0,u=[];for(s in l)!e(r,s)&&e(l,s)&&o(u,s);for(;a.length>c;)e(l,s=a[c++])&&(~i(u,s)||o(u,s));return u},yn}function En(){return xn?Sn:(xn=1,Sn=["constructor","hasOwnProperty","isPrototypeOf","propertyIsEnumerable","toLocaleString","toString","valueOf"])}function Rn(){if(On)return Cn;On=1;var t=$n(),e=En().concat("length","prototype");return Cn.f=Object.getOwnPropertyNames||function(n){return t(n,e)},Cn}var jn,_n,Nn,Ln,Fn,Dn,Bn,Vn,Hn,Mn,Un,zn,qn,Wn,Gn,Kn,Yn,Jn,Qn,Xn,Zn,ti,ei,ni,ii,ri,oi,ai,si,li,ci={};function ui(){return jn||(jn=1,ci.f=Object.getOwnPropertySymbols),ci}function hi(){if(Nn)return _n;Nn=1;var t=$t(),e=xt(),n=Rn(),i=ui(),r=_e(),o=e([].concat);return _n=t("Reflect","ownKeys")||function(t){var e=n.f(r(t)),a=i.f;return a?o(e,a(t)):e}}function fi(){if(Fn)return Ln;Fn=1;var t=be(),e=hi(),n=Ce(),i=Ne();return Ln=function(r,o,a){for(var s=e(o),l=i.f,c=n.f,u=0;u<s.length;u++){var h=s[u];t(r,h)||a&&t(a,h)||l(r,h,c(o,h))}}}function di(){if(Bn)return Dn;Bn=1;var t=A(),e=At(),n=/#|\.prototype\./,i=function(n,i){var l=o[r(n)];return l===s||l!==a&&(e(i)?t(i):!!i)},r=i.normalize=function(t){return String(t).replace(n,".").toLowerCase()},o=i.data={},a=i.NATIVE="N",s=i.POLYFILL="P";return Dn=i}function pi(){if(Hn)return Vn;Hn=1;var t=m(),e=Ce().f,n=Le(),i=an(),r=de(),o=fi(),a=di();return Vn=function(s,l){var c,u,h,f,d,p=s.target,g=s.global,v=s.stat;if(c=g?t:v?t[p]||r(p,{}):t[p]&&t[p].prototype)for(u in l){if(f=l[u],h=s.dontCallGetSet?(d=e(c,u))&&d.value:c[u],!a(g?u:p+(v?".":"#")+u,s.forced)&&void 0!==h){if(typeof f==typeof h)continue;o(f,h)}(s.sham||h&&h.sham)&&n(f,"sham",!0),i(c,u,f,s)}}}function gi(){if(Un)return Mn;Un=1;var t=Ot();return Mn=Array.isArray||function(e){return"Array"===t(e)}}function vi(){if(qn)return zn;qn=1;var t=TypeError;return zn=function(e){if(e>9007199254740991)throw new t("Maximum allowed index exceeded");return e}}function bi(){if(Gn)return Wn;Gn=1;var t=I(),e=Ne(),n=St();return Wn=function(i,r,o){t?e.f(i,r,n(0,o)):i[r]=o},Wn}function mi(){if(Yn)return Kn;Yn=1;var t=I(),e=gi(),n=TypeError,i=Object.getOwnPropertyDescriptor,r=t&&!function(){if(void 0!==this)return!0;try{Object.defineProperty([],"length",{writable:!1}).length=1}catch(t){return t instanceof TypeError}}();return Kn=r?function(t,r){if(e(t)&&!i(t,"length").writable)throw new n("Cannot set read only .length");return t.length=r}:function(t,e){return t.length=e}}function yi(){if(Qn)return Jn;Qn=1;var t={};return t[ye()("toStringTag")]="z",Jn="[object z]"===String(t)}function wi(){if(Zn)return Xn;Zn=1;var t=yi(),e=At(),n=Ot(),i=ye()("toStringTag"),r=Object,o="Arguments"===n(function(){return arguments}());return Xn=t?n:function(t){var a,s,l;return void 0===t?"Undefined":null===t?"Null":"string"==typeof(s=function(t,e){try{return t[e]}catch(t){}}(a=r(t),i))?s:o?n(a):"Object"===(l=n(a))&&e(a.callee)?"Arguments":l}}function Si(){if(ei)return ti;ei=1;var t=xt(),e=A(),n=At(),i=wi(),r=$t(),o=tn(),a=function(){},s=r("Reflect","construct"),l=/^\s*(?:class|function)\b/,c=t(l.exec),u=!l.test(a),h=function(t){if(!n(t))return!1;try{return s(a,[],t),!0}catch(t){return!1}},f=function(t){if(!n(t))return!1;switch(i(t)){case"AsyncFunction":case"GeneratorFunction":case"AsyncGeneratorFunction":return!1}try{return u||!!c(l,o(t))}catch(t){return!0}};return f.sham=!0,ti=!s||e(function(){var t;return h(h.call)||!h(Object)||!h(function(){t=!0})||t})?f:h}function xi(){if(ii)return ni;ii=1;var t=gi(),e=Si(),n=It(),i=ye()("species"),r=Array;return ni=function(o){var a;return t(o)&&(a=o.constructor,(e(a)&&(a===r||t(a.prototype))||n(a)&&null===(a=a[i]))&&(a=void 0)),void 0===a?r:a}}function Oi(){if(oi)return ri;oi=1;var t=xi();return ri=function(e,n){return new(t(e))(0===n?0:n)}}function Ci(){if(si)return ai;si=1;var t=A(),e=ye(),n=jt(),i=e("species");return ai=function(e){return n>=51||!t(function(){var t=[];return(t.constructor={})[i]=function(){return{foo:1}},1!==t[e](Boolean).foo})}}!function(){if(li)return b;li=1;var t=pi(),e=A(),n=gi(),i=It(),r=ve(),o=An(),a=vi(),s=bi(),l=mi(),c=Oi(),u=Ci(),h=ye(),f=jt(),d=h("isConcatSpreadable"),p=f>=51||!e(function(){var t=[];return t[d]=!1,t.concat()[0]!==t}),g=function(t){if(!i(t))return!1;var e=t[d];return void 0!==e?!!e:n(t)};t({target:"Array",proto:!0,arity:1,forced:!p||!u("concat")},{concat:function(t){var e,n,i,u,h,f=r(this),d=c(f,0),p=0;for(e=-1,i=arguments.length;e<i;e++)if(g(h=-1===e?f:arguments[e]))for(u=o(h),a(p+u),n=0;n<u;n++,p++)n in h&&s(d,p,h[n]);else a(p+1),s(d,p++,h);return l(d,p),d}})}();var ki,Ti,Pi,Ai,Ii,$i,Ei,Ri,ji,_i,Ni={},Li={};function Fi(){if(Ti)return ki;Ti=1;var t=$n(),e=En();return ki=Object.keys||function(n){return t(n,e)}}function Di(){if(Ii)return Ai;Ii=1;var t=$t();return Ai=t("document","documentElement")}function Bi(){if(Ei)return $i;Ei=1;var t,e=_e(),n=function(){if(Pi)return Li;Pi=1;var t=I(),e=je(),n=Ne(),i=_e(),r=Pt(),o=Fi();return Li.f=t&&!e?Object.defineProperties:function(t,e){i(t);for(var a,s=r(e),l=o(e),c=l.length,u=0;c>u;)n.f(t,a=l[u++],s[a]);return t},Li}(),i=En(),r=nn(),o=Di(),a=xe(),s=en(),l="prototype",c="script",u=s("IE_PROTO"),h=function(){},f=function(t){return"<"+c+">"+t+"</"+c+">"},d=function(t){t.write(f("")),t.close();var e=t.parentWindow.Object;return t=null,e},p=function(){try{t=new ActiveXObject("htmlfile")}catch(t){}var e,n,r;p="undefined"!=typeof document?document.domain&&t?d(t):(n=a("iframe"),r="java"+c+":",n.style.display="none",o.appendChild(n),n.src=String(r),(e=n.contentWindow.document).open(),e.write(f("document.F=Object")),e.close(),e.F):d(t);for(var s=i.length;s--;)delete p[l][i[s]];return p()};return r[u]=!0,$i=Object.create||function(t,i){var r;return null!==t?(h[l]=e(t),r=new h,h[l]=null,r[u]=t):r=p(),void 0===i?r:n.f(r,i)}}function Vi(){if(ji)return Ri;ji=1;var t=ye(),e=Bi(),n=Ne().f,i=t("unscopables"),r=Array.prototype;return void 0===r[i]&&n(r,i,{configurable:!0,value:e(null)}),Ri=function(t){r[i][t]=!0}}!function(){if(_i)return Ni;_i=1;var t=pi(),e=In().includes,n=A(),i=Vi(),r=n(function(){return!Array(1).includes()}),o=n(function(){return[,1].includes(void 0,1)});t({target:"Array",proto:!0,forced:r||o},{includes:function(t){return e(this,t,arguments.length>1?arguments[1]:void 0)}}),i("includes")}();var Hi,Mi,Ui,zi={};!function(){if(Ui)return zi;Ui=1;var t=pi(),e=function(){if(Mi)return Hi;Mi=1;var t=I(),e=xt(),n=E(),i=A(),r=Fi(),o=ui(),a=wt(),s=ve(),l=Ct(),c=Object.assign,u=Object.defineProperty,h=e([].concat);return Hi=!c||i(function(){if(t&&1!==c({b:1},c(u({},"a",{enumerable:!0,get:function(){u(this,"b",{value:3,enumerable:!1})}}),{b:2})).b)return!0;var e={},n={},i=Symbol("assign detection"),o="abcdefghijklmnopqrst";return e[i]=7,o.split("").forEach(function(t){n[t]=t}),7!==c({},e)[i]||r(c({},n)).join("")!==o})?function(e,i){for(var c=s(e),u=arguments.length,f=1,d=o.f,p=a.f;u>f;)for(var g,v=l(arguments[f++]),b=d?h(r(v),d(v)):r(v),m=b.length,y=0;m>y;)g=b[y++],t&&!n(p,v,g)||(c[g]=v[g]);return c}:c,Hi}();t({target:"Object",stat:!0,arity:2,forced:Object.assign!==e},{assign:e})}();var qi,Wi={};!function(){if(qi)return Wi;qi=1;var t=pi(),e=ve(),n=Fi();t({target:"Object",stat:!0,forced:A()(function(){n(1)})},{keys:function(t){return n(e(t))}})}();var Gi,Ki,Yi,Ji,Qi,Xi,Zi,tr,er,nr,ir,rr,or,ar={};function sr(){if(Ki)return Gi;Ki=1;var t=wi(),e=String;return Gi=function(n){if("Symbol"===t(n))throw new TypeError("Cannot convert a Symbol value to a string");return e(n)}}function lr(){if(Ji)return Yi;Ji=1;var t=_e();return Yi=function(){var e=t(this),n="";return e.hasIndices&&(n+="d"),e.global&&(n+="g"),e.ignoreCase&&(n+="i"),e.multiline&&(n+="m"),e.dotAll&&(n+="s"),e.unicode&&(n+="u"),e.unicodeSets&&(n+="v"),e.sticky&&(n+="y"),n}}function cr(){if(Xi)return Qi;Xi=1;var t=A(),e=m().RegExp,n=t(function(){var t=e("a","y");return t.lastIndex=2,null!==t.exec("abcd")}),i=n||t(function(){return!e("a","y").sticky}),r=n||t(function(){var t=e("^r","gy");return t.lastIndex=2,null!==t.exec("str")});return Qi={BROKEN_CARET:r,MISSED_STICKY:i,UNSUPPORTED_Y:n}}function ur(){if(tr)return Zi;tr=1;var t=A(),e=m().RegExp;return Zi=t(function(){var t=e(".","s");return!(t.dotAll&&t.test("\n")&&"s"===t.flags)})}function hr(){if(nr)return er;nr=1;var t=A(),e=m().RegExp;return er=t(function(){var t=e("(?<a>b)","g");return"b"!==t.exec("b").groups.a||"bc"!=="b".replace(t,"$<a>c")})}function fr(){if(rr)return ir;rr=1;var t,e,n=E(),i=xt(),r=sr(),o=lr(),a=cr(),s=ge(),l=Bi(),c=rn().get,u=ur(),h=hr(),f=s("native-string-replace",String.prototype.replace),d=RegExp.prototype.exec,p=d,g=i("".charAt),v=i("".indexOf),b=i("".replace),m=i("".slice),y=(e=/b*/g,n(d,t=/a/,"a"),n(d,e,"a"),0!==t.lastIndex||0!==e.lastIndex),w=a.BROKEN_CARET,S=void 0!==/()??/.exec("")[1],x=function(t,e){for(var n=t.groups=l(null),i=0;i<e.length;i++){var r=e[i];n[r[0]]=t[r[1]]}};return(y||S||w||u||h)&&(p=function(t){var e,i,a,s=this,l=c(s),u=r(t),h=l.raw;if(h)return h.lastIndex=s.lastIndex,e=n(p,h,u),s.lastIndex=h.lastIndex,e&&l.groups&&x(e,l.groups),e;var O=l.groups,C=w&&s.sticky,k=n(o,s),T=s.source,P=0,A=u;if(C){k=b(k,"y",""),-1===v(k,"g")&&(k+="g"),A=m(u,s.lastIndex);var I=s.lastIndex>0&&g(u,s.lastIndex-1);s.lastIndex>0&&(!s.multiline||s.multiline&&"\n"!==I&&"\r"!==I&&"\u2028"!==I&&"\u2029"!==I)&&(T="(?: (?:"+T+"))",A=" "+A,P++),i=new RegExp("^(?:"+T+")",k)}S&&(i=new RegExp("^"+T+"$(?!\\s)",k)),y&&(a=s.lastIndex);var $=n(d,C?i:s,A);return C?$?($.input=u,$[0]=m($[0],P),$.index=s.lastIndex,s.lastIndex+=$[0].length):s.lastIndex=0:y&&$&&(s.lastIndex=s.global?$.index+$[0].length:a),S&&$&&$.length>1&&n(f,$[0],i,function(){for(var t=1;t<arguments.length-2;t++)void 0===arguments[t]&&($[t]=void 0)}),$&&O&&x($,O),$}),ir=p}function dr(){if(or)return ar;or=1;var t=pi(),e=fr();return t({target:"RegExp",proto:!0,forced:/./.exec!==e},{exec:e}),ar}dr();var pr,gr,vr,br,mr,yr,wr,Sr={};function xr(){if(gr)return pr;gr=1;var t=It(),e=Ot(),n=ye()("match");return pr=function(i){var r;return t(i)&&(void 0!==(r=i[n])?!!r:"RegExp"===e(i))}}function Or(){if(br)return vr;br=1;var t=xr(),e=TypeError;return vr=function(n){if(t(n))throw new e("The method doesn't accept regular expressions");return n}}function Cr(){if(yr)return mr;yr=1;var t=ye()("match");return mr=function(e){var n=/./;try{"/./"[e](n)}catch(i){try{return n[t]=!1,"/./"[e](n)}catch(t){}}return!1}}!function(){if(wr)return Sr;wr=1;var t=pi(),e=xt(),n=Or(),i=Tt(),r=sr(),o=Cr(),a=e("".indexOf);t({target:"String",proto:!0,forced:!o("includes")},{includes:function(t){return!!~a(r(i(this)),r(n(t)),arguments.length>1?arguments[1]:void 0)}})}();var kr,Tr,Pr,Ar,Ir,$r,Er,Rr={};function jr(){if(Tr)return kr;Tr=1;var t=Ot(),e=xt();return kr=function(n){if("Function"===t(n))return e(n)}}function _r(){if(Ar)return Pr;Ar=1;var t=jr(),e=Dt(),n=$(),i=t(t.bind);return Pr=function(t,r){return e(t),void 0===r?t:n?i(t,r):function(){return t.apply(r,arguments)}},Pr}function Nr(){if($r)return Ir;$r=1;var t=_r(),e=Ct(),n=ve(),i=An(),r=Oi(),o=bi(),a=function(a){var s=1===a,l=2===a,c=3===a,u=4===a,h=6===a,f=7===a,d=5===a||h;return function(p,g,v){for(var b,m,y=n(p),w=e(y),S=i(w),x=t(g,v),O=0,C=0,k=s?r(p,S):l||f?r(p,0):void 0;S>O;O++)if((d||O in w)&&(m=x(b=w[O],O,y),a))if(s)o(k,O,m);else if(m)switch(a){case 3:return!0;case 5:return b;case 6:return O;case 2:o(k,C++,b)}else switch(a){case 4:return!1;case 7:o(k,C++,b)}return h?-1:c||u?u:k}};return Ir={forEach:a(0),map:a(1),filter:a(2),some:a(3),every:a(4),find:a(5),findIndex:a(6),filterReject:a(7)}}!function(){if(Er)return Rr;Er=1;var t=pi(),e=Nr().find,n=Vi(),i="find",r=!0;i in[]&&Array(1)[i](function(){r=!1}),t({target:"Array",proto:!0,forced:r},{find:function(t){return e(this,t,arguments.length>1?arguments[1]:void 0)}}),n(i)}();var Lr,Fr,Dr,Br,Vr,Hr,Mr,Ur={};function zr(){if(Fr)return Lr;Fr=1;var t=A();return Lr=!t(function(){function t(){}return t.prototype.constructor=null,Object.getPrototypeOf(new t)!==t.prototype})}function qr(){if(Br)return Dr;Br=1;var t=be(),e=At(),n=ve(),i=en(),r=zr(),o=i("IE_PROTO"),a=Object,s=a.prototype;return Dr=r?a.getPrototypeOf:function(i){var r=n(i);if(t(r,o))return r[o];var l=r.constructor;return e(l)&&r instanceof l?l.prototype:r instanceof a?s:null},Dr}!function(){if(Mr)return Ur;Mr=1;var t=pi(),e=function(){if(Hr)return Vr;Hr=1;var t=I(),e=A(),n=xt(),i=qr(),r=Fi(),o=Pt(),a=n(wt().f),s=n([].push),l=t&&e(function(){var t=Object.create(null);return t[2]=2,!a(t,2)}),c=function(e){return function(n){for(var c,u=o(n),h=r(u),f=l&&null===i(u),d=h.length,p=0,g=[];d>p;)c=h[p++],t&&!(f?c in u:a(u,c))||s(g,e?[c,u[c]]:u[c]);return g}};return Vr={entries:c(!0),values:c(!1)}}().entries;t({target:"Object",stat:!0},{entries:function(t){return e(t)}})}();var Wr,Gr,Kr,Yr={};!function(){if(Kr)return Yr;Kr=1;var t=yi(),e=an(),n=function(){if(Gr)return Wr;Gr=1;var t=yi(),e=wi();return Wr=t?{}.toString:function(){return"[object "+e(this)+"]"}}();t||e(Object.prototype,"toString",n,{unsafe:!0})}();var Jr,Qr,Xr,Zr,to,eo,no,io,ro,oo,ao,so,lo,co,uo,ho,fo,po={};function go(){if(Qr)return Jr;Qr=1,dr();var t=E(),e=an(),n=fr(),i=A(),r=ye(),o=Le(),a=r("species"),s=RegExp.prototype;return Jr=function(l,c,u,h){var f=r(l),d=!i(function(){var t={};return t[f]=function(){return 7},7!==""[l](t)}),p=d&&!i(function(){var t=!1,e=/a/;if("split"===l){var n={};n[a]=function(){return e},(e={constructor:n,flags:""})[f]=/./[f]}return e.exec=function(){return t=!0,null},e[f](""),!t});if(!d||!p||u){var g=/./[f],v=c(f,""[l],function(e,i,r,o,a){var l=i.exec;return l===n||l===s.exec?d&&!a?{done:!0,value:t(g,i,r,o)}:{done:!0,value:t(e,r,i,o)}:{done:!1}});e(String.prototype,l,v[0]),e(s,f,v[1])}h&&o(s[f],"sham",!0)}}function vo(){if(Zr)return Xr;Zr=1;var t=Si(),e=Ft(),n=TypeError;return Xr=function(i){if(t(i))return i;throw new n(e(i)+" is not a constructor")}}function bo(){if(eo)return to;eo=1;var t=_e(),e=vo(),n=kt(),i=ye()("species");return to=function(r,o){var a,s=t(r).constructor;return void 0===s||n(a=t(s)[i])?o:e(a)}}function mo(){if(io)return no;io=1;var t=xt(),e=kn(),n=sr(),i=Tt(),r=t("".charAt),o=t("".charCodeAt),a=t("".slice),s=function(t){return function(s,l){var c,u,h=n(i(s)),f=e(l),d=h.length;return f<0||f>=d?t?"":void 0:(c=o(h,f))<55296||c>56319||f+1===d||(u=o(h,f+1))<56320||u>57343?t?r(h,f):c:t?a(h,f,f+2):u-56320+(c-55296<<10)+65536}};return no={codeAt:s(!1),charAt:s(!0)}}function yo(){if(oo)return ro;oo=1;var t=mo().charAt;return ro=function(e,n,i){return n+(i&&t(e,n).length||1)}}function wo(){if(co)return lo;co=1;var t=E(),e=be(),n=Et(),i=function(){if(so)return ao;so=1;var t=m(),e=A(),n=t.RegExp,i=!e(function(){var t=!0;try{n(".","d")}catch(e){t=!1}var e={},i="",r=t?"dgimsy":"gimsy",o=function(t,n){Object.defineProperty(e,t,{get:function(){return i+=n,!0}})},a={dotAll:"s",global:"g",ignoreCase:"i",multiline:"m",sticky:"y"};for(var s in t&&(a.hasIndices="d"),a)o(s,a[s]);return Object.getOwnPropertyDescriptor(n.prototype,"flags").get.call(e)!==r||i!==r});return ao={correct:i}}(),r=lr(),o=RegExp.prototype;return lo=i.correct?function(t){return t.flags}:function(a){return i.correct||!n(o,a)||e(a,"flags")?a.flags:t(r,a)}}function So(){if(ho)return uo;ho=1;var t=E(),e=_e(),n=At(),i=Ot(),r=fr(),o=TypeError;return uo=function(a,s){var l=a.exec;if(n(l)){var c=t(l,a,s);return null!==c&&e(c),c}if("RegExp"===i(a))return t(r,a,s);throw new o("RegExp#exec called on incompatible receiver")}}!function(){if(fo)return po;fo=1;var t=E(),e=xt(),n=go(),i=_e(),r=It(),o=Tt(),a=bo(),s=yo(),l=Pn(),c=sr(),u=Bt(),h=wo(),f=So(),d=cr(),p=A(),g=d.UNSUPPORTED_Y,v=Math.min,b=e([].push),m=e("".slice),y=e("".indexOf),w=!p(function(){var t=/(?:)/,e=t.exec;t.exec=function(){return e.apply(this,arguments)};var n="ab".split(t);return 2!==n.length||"a"!==n[0]||"b"!==n[1]}),S="c"==="abbc".split(/(b)*/)[1]||4!=="test".split(/(?:)/,-1).length||2!=="ab".split(/(?:ab)*/).length||4!==".".split(/(.?)(.?)/).length||".".split(/()()/).length>1||"".split(/.?/).length;n("split",function(e,n,d){var p="0".split(void 0,0).length?function(e,i){return void 0===e&&0===i?[]:t(n,this,e,i)}:n;return[function(n,i){var a=o(this),s=r(n)?u(n,e):void 0;return s?t(s,n,a,i):t(p,c(a),n,i)},function(t,e){var r=i(this),o=c(t);if(!S){var u=d(p,r,o,e,p!==n);if(u.done)return u.value}var w=a(r,RegExp),x=c(h(r)),O=!!~y(x,"u")||!!~y(x,"v");g?~y(x,"g")||(x+="g"):~y(x,"y")||(x+="y");var C=new w(g?"^(?:"+r.source+")":r,x),k=void 0===e?4294967295:e>>>0;if(0===k)return[];if(0===o.length)return null===f(C,o)?[o]:[];for(var T=0,P=0,A=[];P<o.length;){C.lastIndex=g?0:P;var I,$=f(C,g?m(o,P):o);if(null===$||(I=v(l(C.lastIndex+(g?P:0)),o.length))===T)P=s(o,P,O);else{if(b(A,m(o,T,P)),A.length===k)return A;for(var E=1;E<=$.length-1;E++)if(b(A,$[E]),A.length===k)return A;P=T=I}}return b(A,m(o,T)),A}]},S||!w,g)}();var xo,Oo,Co,ko,To,Po,Ao,Io={};function $o(){return Oo?xo:(Oo=1,xo="\t\n\v\f\r                　\u2028\u2029\ufeff")}function Eo(){if(ko)return Co;ko=1;var t=xt(),e=Tt(),n=sr(),i=$o(),r=t("".replace),o=RegExp("^["+i+"]+"),a=RegExp("(^|[^"+i+"])["+i+"]+$"),s=function(t){return function(i){var s=n(e(i));return 1&t&&(s=r(s,o,"")),2&t&&(s=r(s,a,"$1")),s}};return Co={start:s(1),end:s(2),trim:s(3)}}!function(){if(Ao)return Io;Ao=1;var t=pi(),e=Eo().trim,n=function(){if(Po)return To;Po=1;var t=Ze().PROPER,e=A(),n=$o();return To=function(i){return e(function(){return!!n[i]()||"​᠎"!=="​᠎"[i]()||t&&n[i].name!==i})}}();t({target:"String",proto:!0,forced:n("trim")},{trim:function(){return e(this)}})}();var Ro,jo,_o,No,Lo,Fo,Do,Bo,Vo,Ho={};function Mo(){return jo?Ro:(jo=1,Ro={CSSRuleList:0,CSSStyleDeclaration:0,CSSValueList:0,ClientRectList:0,DOMRectList:0,DOMStringList:0,DOMTokenList:1,DataTransferItemList:0,FileList:0,HTMLAllCollection:0,HTMLCollection:0,HTMLFormElement:0,HTMLSelectElement:0,MediaList:0,MimeTypeArray:0,NamedNodeMap:0,NodeList:1,PaintRequestList:0,Plugin:0,PluginArray:0,SVGLengthList:0,SVGNumberList:0,SVGPathSegList:0,SVGPointList:0,SVGStringList:0,SVGTransformList:0,SourceBufferList:0,StyleSheetList:0,TextTrackCueList:0,TextTrackList:0,TouchList:0})}function Uo(){if(No)return _o;No=1;var t=xe()("span").classList,e=t&&t.constructor&&t.constructor.prototype;return _o=e===Object.prototype?void 0:e}function zo(){if(Fo)return Lo;Fo=1;var t=A();return Lo=function(e,n){var i=[][e];return!!i&&t(function(){i.call(null,n||function(){return 1},1)})}}!function(){if(Vo)return Ho;Vo=1;var t=m(),e=Mo(),n=Uo(),i=function(){if(Bo)return Do;Bo=1;var t=Nr().forEach,e=zo()("forEach");return Do=e?[].forEach:function(e){return t(this,e,arguments.length>1?arguments[1]:void 0)},Do}(),r=Le(),o=function(t){if(t&&t.forEach!==i)try{r(t,"forEach",i)}catch(e){t.forEach=i}};for(var a in e)e[a]&&o(t[a]&&t[a].prototype);o(n)}();var qo,Wo={};!function(){if(qo)return Wo;qo=1;var t,e=pi(),n=jr(),i=Ce().f,r=Pn(),o=sr(),a=Or(),s=Tt(),l=Cr(),c=fe(),u=n("".slice),h=Math.min,f=l("startsWith");e({target:"String",proto:!0,forced:!!(c||f||(t=i(String.prototype,"startsWith"),!t||t.writable))&&!f},{startsWith:function(t){var e=o(s(this));a(t);var n=o(t),i=r(h(arguments.length>1?arguments[1]:void 0,e.length));return u(e,i,i+n.length)===n}})}();var Go,Ko={};!function(){if(Go)return Ko;Go=1;var t=pi(),e=Nr().filter;t({target:"Array",proto:!0,forced:!Ci()("filter")},{filter:function(t){return e(this,t,arguments.length>1?arguments[1]:void 0)}})}();var Yo,Jo,Qo,Xo,Zo,ta,ea,na,ia,ra,oa,aa,sa,la,ca,ua,ha,fa={};function da(){if(Jo)return Yo;Jo=1;var t=E(),e=_e(),n=Bt();return Yo=function(i,r,o){var a,s;e(i);try{if(!(a=n(i,"return"))){if("throw"===r)throw o;return o}a=t(a,i)}catch(t){s=!0,a=t}if("throw"===r)throw o;if(s)throw a;return e(a),o}}function pa(){if(Xo)return Qo;Xo=1;var t=_e(),e=da();return Qo=function(n,i,r,o){try{return o?i(t(r)[0],r[1]):i(r)}catch(t){e(n,"throw",t)}}}function ga(){return ta?Zo:(ta=1,Zo={})}function va(){if(na)return ea;na=1;var t=ye(),e=ga(),n=t("iterator"),i=Array.prototype;return ea=function(t){return void 0!==t&&(e.Array===t||i[n]===t)}}function ba(){if(ra)return ia;ra=1;var t=wi(),e=Bt(),n=kt(),i=ga(),r=ye()("iterator");return ia=function(o){if(!n(o))return e(o,r)||e(o,"@@iterator")||i[t(o)]}}function ma(){if(aa)return oa;aa=1;var t=E(),e=Dt(),n=_e(),i=Ft(),r=ba(),o=TypeError;return oa=function(a,s){var l=arguments.length<2?r(a):s;if(e(l))return n(t(l,a));throw new o(i(a)+" is not iterable")},oa}function ya(){if(ua)return ca;ua=1;var t=ye()("iterator"),e=!1;try{var n=0,i={next:function(){return{done:!!n++}},return:function(){e=!0}};i[t]=function(){return this},Array.from(i,function(){throw 2})}catch(t){}return ca=function(n,i){try{if(!i&&!e)return!1}catch(t){return!1}var r=!1;try{var o={};o[t]=function(){return{next:function(){return{done:r=!0}}}},n(o)}catch(t){}return r},ca}!function(){if(ha)return fa;ha=1;var t=pi(),e=function(){if(la)return sa;la=1;var t=_r(),e=E(),n=ve(),i=pa(),r=va(),o=Si(),a=An(),s=bi(),l=mi(),c=ma(),u=ba(),h=da(),f=Array;return sa=function(d){var p=o(this),g=arguments.length,v=g>1?arguments[1]:void 0,b=void 0!==v;b&&(v=t(v,g>2?arguments[2]:void 0));var m,y,w,S,x,O,C=n(d),k=u(C),T=0;if(!k||this===f&&r(k))for(m=a(C),y=p?new this(m):f(m);m>T;T++)O=b?v(C[T],T):C[T],s(y,T,O);else for(y=p?new this:[],x=(S=c(C,k)).next;!(w=e(x,S)).done;T++){O=b?i(S,v,[w.value,T],!0):w.value;try{s(y,T,O)}catch(t){h(S,"throw",t)}}return l(y,T),y},sa}();t({target:"Array",stat:!0,forced:!ya()(function(t){Array.from(t)})},{from:e})}();var wa,Sa,xa,Oa,Ca,ka,Ta,Pa,Aa,Ia,$a,Ea,Ra,ja,_a,Na,La,Fa,Da,Ba={};function Va(){if(Sa)return wa;Sa=1;var t,e,n,i=A(),r=At(),o=It(),a=Bi(),s=qr(),l=an(),c=ye(),u=fe(),h=c("iterator"),f=!1;return[].keys&&("next"in(n=[].keys())?(e=s(s(n)))!==Object.prototype&&(t=e):f=!0),!o(t)||i(function(){var e={};return t[h].call(e)!==e})?t={}:u&&(t=a(t)),r(t[h])||l(t,h,function(){return this}),wa={IteratorPrototype:t,BUGGY_SAFARI_ITERATORS:f}}function Ha(){if(Oa)return xa;Oa=1;var t=Ne().f,e=be(),n=ye()("toStringTag");return xa=function(i,r,o){i&&!o&&(i=i.prototype),i&&!e(i,n)&&t(i,n,{configurable:!0,value:r})}}function Ma(){if(ka)return Ca;ka=1;var t=Va().IteratorPrototype,e=Bi(),n=St(),i=Ha(),r=ga(),o=function(){return this};return Ca=function(a,s,l,c){var u=s+" Iterator";return a.prototype=e(t,{next:n(+!c,l)}),i(a,u,!1,!0),r[u]=o,a}}function Ua(){if(Ia)return Aa;Ia=1;var t=It();return Aa=function(e){return t(e)||null===e}}function za(){if(Ea)return $a;Ea=1;var t=Ua(),e=String,n=TypeError;return $a=function(i){if(t(i))return i;throw new n("Can't set "+e(i)+" as a prototype")}}function qa(){if(ja)return Ra;ja=1;var t=function(){if(Pa)return Ta;Pa=1;var t=xt(),e=Dt();return Ta=function(n,i,r){try{return t(e(Object.getOwnPropertyDescriptor(n,i)[r]))}catch(t){}},Ta}(),e=It(),n=Tt(),i=za();return Ra=Object.setPrototypeOf||("__proto__"in{}?function(){var r,o=!1,a={};try{(r=t(Object.prototype,"__proto__","set"))(a,[]),o=a instanceof Array}catch(t){}return function(t,a){return n(t),i(a),e(t)?(o?r(t,a):t.__proto__=a,t):t}}():void 0)}function Wa(){if(Na)return _a;Na=1;var t=pi(),e=E(),n=fe(),i=Ze(),r=At(),o=Ma(),a=qr(),s=qa(),l=Ha(),c=Le(),u=an(),h=ye(),f=ga(),d=Va(),p=i.PROPER,g=i.CONFIGURABLE,v=d.IteratorPrototype,b=d.BUGGY_SAFARI_ITERATORS,m=h("iterator"),y="keys",w="values",S="entries",x=function(){return this};return _a=function(i,h,d,O,C,k,T){o(d,h,O);var P,A,I,$=function(t){if(t===C&&N)return N;if(!b&&t&&t in j)return j[t];switch(t){case y:case w:case S:return function(){return new d(this,t)}}return function(){return new d(this)}},E=h+" Iterator",R=!1,j=i.prototype,_=j[m]||j["@@iterator"]||C&&j[C],N=!b&&_||$(C),L="Array"===h&&j.entries||_;if(L&&(P=a(L.call(new i)))!==Object.prototype&&P.next&&(n||a(P)===v||(s?s(P,v):r(P[m])||u(P,m,x)),l(P,E,!0,!0),n&&(f[E]=x)),p&&C===w&&_&&_.name!==w&&(!n&&g?c(j,"name",w):(R=!0,N=function(){return e(_,this)})),C)if(A={values:$(w),keys:k?N:$(y),entries:$(S)},T)for(I in A)(b||R||!(I in j))&&u(j,I,A[I]);else t({target:h,proto:!0,forced:b||R},A);return n&&!T||j[m]===N||u(j,m,N,{name:C}),f[h]=N,A}}function Ga(){return Fa?La:(Fa=1,La=function(t,e){return{value:t,done:e}})}!function(){if(Da)return Ba;Da=1;var t=mo().charAt,e=sr(),n=rn(),i=Wa(),r=Ga(),o="String Iterator",a=n.set,s=n.getterFor(o);i(String,"String",function(t){a(this,{type:o,string:e(t),index:0})},function(){var e,n=s(this),i=n.string,o=n.index;return o>=i.length?r(void 0,!0):(e=t(i,o),n.index+=e.length,r(e,!1))})}();var Ka=function(){return r(function t(){n(this,t)},null,[{key:"$",value:function(t){var e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:document;return"string"==typeof t?e.querySelector(t):t instanceof Element?t:null}},{key:"$$",value:function(t){var e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:document;return"string"==typeof t?Array.from(e.querySelectorAll(t)):t instanceof NodeList?Array.from(t):t instanceof Element?[t]:[]}},{key:"create",value:function(t){if("string"!=typeof t)return null;var e=t.trim();if(!e)return null;var n=document.createElement("template");return n.innerHTML=e,n.content.firstChild}},{key:"addClass",value:function(t,e){var n;if("string"==typeof t&&(t=this.$(t)),!t||!t.classList)return t;if(!e)return t;var i=e.split(" ").filter(function(t){return t});return(n=t.classList).add.apply(n,u(i)),t}},{key:"removeClass",value:function(t,e){var n;if("string"==typeof t&&(t=this.$(t)),!t||!t.classList)return t;if(!e)return t;var i=e.split(" ").filter(function(t){return t});return(n=t.classList).remove.apply(n,u(i)),t}},{key:"toggleClass",value:function(t,e){return"string"==typeof t&&(t=this.$(t)),t&&t.classList&&e?(e.split(" ").filter(function(t){return t}).forEach(function(e){return t.classList.toggle(e)}),t):t}},{key:"hasClass",value:function(t,e){return"string"==typeof t&&(t=this.$(t)),!(!t||!t.classList)&&(!!e&&t.classList.contains(e))}},{key:"attr",value:function(t,e,n){return"string"==typeof t&&(t=this.$(t)),t?void 0===n?t.getAttribute(e):(t.setAttribute(e,n),t):void 0===n?null:t}},{key:"removeAttr",value:function(t,e){return"string"==typeof t&&(t=this.$(t)),t?(t.removeAttribute(e),t):t}},{key:"data",value:function(t,e,n){return"string"==typeof t&&(t=this.$(t)),t?void 0===n?t.dataset[e]:(t.dataset[e]=n,t):void 0===n?void 0:t}},{key:"append",value:function(t,e){return"string"==typeof t&&(t=this.$(t)),"string"==typeof e&&(e=this.create(e)),t&&e&&t.appendChild(e),t}},{key:"prepend",value:function(t,e){return"string"==typeof t&&(t=this.$(t)),"string"==typeof e&&(e=this.create(e)),t&&e&&t.insertBefore(e,t.firstChild),t}},{key:"insertAfter",value:function(t,e){return"string"==typeof e&&(e=this.$(e)),"string"==typeof t&&(t=this.create(t)),e&&t&&e.parentNode&&e.parentNode.insertBefore(t,e.nextSibling),t}},{key:"insertBefore",value:function(t,e){return"string"==typeof e&&(e=this.$(e)),"string"==typeof t&&(t=this.create(t)),e&&t&&e.parentNode&&e.parentNode.insertBefore(t,e),t}},{key:"find",value:function(t,e){return"string"==typeof t&&(t=this.$(t)),t?Array.from(t.querySelectorAll(e)):[]}},{key:"findFirst",value:function(t,e){return"string"==typeof t&&(t=this.$(t)),t?t.querySelector(e):null}},{key:"css",value:function(t,e,n){return"string"==typeof t&&(t=this.$(t)),t?"object"===f(e)?(Object.assign(t.style,e),t):void 0===n?getComputedStyle(t)[e]:(t.style[e]=n,t):null}},{key:"width",value:function(t){return"string"==typeof t&&(t=this.$(t)),t?t.offsetWidth:0}},{key:"height",value:function(t){return"string"==typeof t&&(t=this.$(t)),t?t.offsetHeight:0}},{key:"outerWidth",value:function(t){var e=arguments.length>1&&void 0!==arguments[1]&&arguments[1];if("string"==typeof t&&(t=this.$(t)),!t)return 0;var n=t.offsetWidth;if(e){var i=getComputedStyle(t);n+=(parseInt(i.marginLeft,10)||0)+(parseInt(i.marginRight,10)||0)}return n}},{key:"outerHeight",value:function(t){var e=arguments.length>1&&void 0!==arguments[1]&&arguments[1];if("string"==typeof t&&(t=this.$(t)),!t)return 0;var n=t.offsetHeight;if(e){var i=getComputedStyle(t);n+=(parseInt(i.marginTop,10)||0)+(parseInt(i.marginBottom,10)||0)}return n}},{key:"val",value:function(t,e){return"string"==typeof t&&(t=this.$(t)),t?void 0===e?t.value:(t.value=e,t):void 0===e?null:t}},{key:"html",value:function(t,e){return"string"==typeof t&&(t=this.$(t)),t?void 0===e?t.innerHTML:(t.innerHTML=e,t):void 0===e?null:t}},{key:"text",value:function(t,e){return"string"==typeof t&&(t=this.$(t)),t?void 0===e?t.textContent:(t.textContent=e,t):void 0===e?null:t}},{key:"remove",value:function(t){return"string"==typeof t&&(t=this.$(t)),t&&t.parentNode?(t.parentNode.removeChild(t),t):t}},{key:"empty",value:function(t){return"string"==typeof t&&(t=this.$(t)),t?(t.innerHTML="",t):t}},{key:"each",value:function(t,e){return"string"==typeof t?t=this.$$(t):t instanceof NodeList?t=Array.from(t):Array.isArray(t)||(t=[t]),t.forEach(function(t,n){e.call(t,n,t)}),t}},{key:"parent",value:function(t,e){if("string"==typeof t&&(t=this.$(t)),!t)return null;var n=t.parentElement;if(e)for(;n&&!n.matches(e);)n=n.parentElement;return n}},{key:"children",value:function(t,e){if("string"==typeof t&&(t=this.$(t)),!t)return[];var n=Array.from(t.children);return e&&(n=n.filter(function(t){return t.matches(e)})),n}},{key:"next",value:function(t,e){if("string"==typeof t&&(t=this.$(t)),!t)return null;var n=t.nextElementSibling;if(e)for(;n&&!n.matches(e);)n=n.nextElementSibling;return n}},{key:"prev",value:function(t,e){if("string"==typeof t&&(t=this.$(t)),!t)return null;var n=t.previousElementSibling;if(e)for(;n&&!n.matches(e);)n=n.previousElementSibling;return n}},{key:"offset",value:function(t){if("string"==typeof t&&(t=this.$(t)),!t)return{top:0,left:0,width:0,height:0};var e=t.getBoundingClientRect();return{top:e.top+window.scrollY,left:e.left+window.scrollX,width:e.width,height:e.height}}},{key:"position",value:function(t){return"string"==typeof t&&(t=this.$(t)),t?{top:t.offsetTop,left:t.offsetLeft}:{top:0,left:0}}},{key:"is",value:function(t,e){return"string"==typeof t&&(t=this.$(t)),!!t&&t.matches(e)}}])}();function Ya(){var e,n,i;if(void 0!==t&&null!==(e=t.fn)&&void 0!==e&&null!==(e=e.bootstrapTable)&&void 0!==e&&e.theme&&!t.fn.bootstrapTable.theme.startsWith("bootstrap"))return;var r=5;return"undefined"!=typeof window&&null!==(n=window.bootstrap)&&void 0!==n&&null!==(n=n.Tooltip)&&void 0!==n&&n.VERSION?r=parseInt(window.bootstrap.Tooltip.VERSION,10):void 0!==t&&null!==(i=t.fn)&&void 0!==i&&null!==(i=i.dropdown)&&void 0!==i&&null!==(i=i.Constructor)&&void 0!==i&&i.VERSION&&(r=parseInt(t.fn.dropdown.Constructor.VERSION,10)),r}var Ja,Qa=Object.freeze({__proto__:null,assignIcons:function(t,e,n){for(var i=0,r=Object.keys(t);i<r.length;i++){var o=r[i];t[o][e]=n[o]}},getBootstrapVersion:Ya,getIcons:function(t,e){return t[e]||{}},getIconsPrefix:function(t){return{bootstrap3:"glyphicon",bootstrap4:"fa",bootstrap5:"bi","bootstrap-table":"icon",bulma:"fa",foundation:"fa",materialize:"material-icons",semantic:"fa"}[t]||"fa"},getSearchInput:function(t){if("string"==typeof t.options.searchSelector)return Ka.$(t.options.searchSelector);var e=t.$toolbar?t.$toolbar[0]:null;if(!e)return null;var n=Ka.find(e,".search input");return n.length>0?n[0]:null}}),Xa={};function Za(t){if("object"!==f(t)||null===t)return!1;for(var e=t;null!==Object.getPrototypeOf(e);)e=Object.getPrototypeOf(e);return Object.getPrototypeOf(t)===e}function ts(){for(var t=arguments.length,e=new Array(t),n=0;n<t;n++)e[n]=arguments[n];var i,r=e[0]||{},o=1,a=!1;for("boolean"==typeof r&&(a=r,r=e[o]||{},o++),"object"!==f(r)&&"function"!=typeof r&&(r={});o<e.length;o++){var s=e[o];if(null!=s)for(var l in s){var c=s[l];if("__proto__"!==l&&r!==c){var u=Array.isArray(c);if(a&&c&&(Za(c)||u)){var h=r[l];if(u&&Array.isArray(h)&&h.every(function(t){return!Za(t)&&!Array.isArray(t)})){r[l]=c;continue}i=u&&!Array.isArray(h)?[]:u||Za(h)?h:{},r[l]=ts(a,i,c)}else void 0!==c&&(r[l]=c)}}}return r}!function(){if(Ja)return Xa;Ja=1;var t=pi(),e=A(),n=ve(),i=qr(),r=zr();t({target:"Object",stat:!0,forced:e(function(){i(1)}),sham:!r},{getPrototypeOf:function(t){return i(n(t))}})}();var es,ns,is,rs,os,as,ss,ls,cs,us=Object.freeze({__proto__:null,compareObjects:function(t,e,n){var i=Object.keys(t),r=Object.keys(e);if(n&&i.length!==r.length)return!1;for(var o=0,a=i;o<a.length;o++){var s=a[o];if(r.includes(s)&&t[s]!==e[s])return!1}return!0},deepCopy:function(t){return void 0===t?t:ts(!0,Array.isArray(t)?[]:{},t)},extend:ts,isEmptyObject:function(){var t=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};return 0===Object.entries(t).length&&t.constructor===Object},isObject:Za}),hs={};function fs(){if(ns)return es;ns=1;var t=At(),e=It(),n=qa();return es=function(i,r,o){var a,s;return n&&t(a=r.constructor)&&a!==o&&e(s=a.prototype)&&s!==o.prototype&&n(i,s),i}}function ds(){if(rs)return is;rs=1;var t=Ne().f;return is=function(e,n,i){i in e||t(e,i,{configurable:!0,get:function(){return n[i]},set:function(t){n[i]=t}})}}function ps(){if(as)return os;as=1;var t=on(),e=Ne();return os=function(n,i,r){return r.get&&t(r.get,i,{getter:!0}),r.set&&t(r.set,i,{setter:!0}),e.f(n,i,r)}}function gs(){if(ls)return ss;ls=1;var t=$t(),e=ps(),n=ye(),i=I(),r=n("species");return ss=function(n){var o=t(n);i&&o&&!o[r]&&e(o,r,{configurable:!0,get:function(){return this}})}}!function(){if(cs)return hs;cs=1;var t=I(),e=m(),n=xt(),i=di(),r=fs(),o=Le(),a=Bi(),s=Rn().f,l=Et(),c=xr(),u=sr(),h=wo(),f=cr(),d=ds(),p=an(),g=A(),v=be(),b=rn().enforce,y=gs(),w=ye(),S=ur(),x=hr(),O=w("match"),C=e.RegExp,k=C.prototype,T=e.SyntaxError,P=n(k.exec),$=n("".charAt),E=n("".replace),R=n("".indexOf),j=n("".slice),_=/^\?<[^\s\d!#%&*+<=>@^][^\s!#%&*+<=>@^]*>/,N=/a/g,L=/a/g,F=new C(N)!==N,D=f.MISSED_STICKY,B=f.UNSUPPORTED_Y,V=t&&(!F||D||S||x||g(function(){return L[O]=!1,C(N)!==N||C(L)===L||"/a/i"!==String(C(N,"i"))}));if(i("RegExp",V)){for(var H=function(t,e){var n,i,s,f,d,p,g=l(k,this),m=c(t),y=void 0===e,w=[],O=t;if(!g&&m&&y&&t.constructor===H)return t;if((m||l(k,t))&&(t=t.source,y&&(e=h(O))),t=void 0===t?"":u(t),e=void 0===e?"":u(e),O=t,S&&"dotAll"in N&&(i=!!e&&R(e,"s")>-1)&&(e=E(e,/s/g,"")),n=e,D&&"sticky"in N&&(s=!!e&&R(e,"y")>-1)&&B&&(e=E(e,/y/g,"")),x&&(f=function(t){for(var e,n=t.length,i=0,r="",o=[],s=a(null),l=!1,c=!1,u=0,h="";i<n;i++){if("\\"===(e=$(t,i))){if(e+=$(t,++i),!c&&"\\"===$(e,1)){r+="\\x5c";continue}}else if("]"===e)l=!1;else if(!l)switch(!0){case"["===e:l=!0;break;case"("===e:r+=e,P(_,j(t,i+1))?(i+=2,c=!0,u++):"?"!==$(t,i+1)&&u++;continue;case">"===e&&c:if(""===h||v(s,h))throw new T("Invalid capture group name");s[h]=!0,o[o.length]=[h,u],c=!1,h="";continue}c?h+=e:r+=e}for(var f=0;f<o.length;f++)for(var d="\\k<"+o[f][0]+">",p="\\"+o[f][1];R(r,d)>-1;)r=E(r,d,p);return[r,o]}(t),t=f[0],w=f[1]),d=r(C(t,e),g?this:k,H),(i||s||w.length)&&(p=b(d),i&&(p.dotAll=!0,p.raw=H(function(t){for(var e,n=t.length,i=0,r="",o=!1;i<n;i++)"\\"!==(e=$(t,i))?o||"."!==e?("["===e?o=!0:"]"===e&&(o=!1),r+=e):r+="[\\s\\S]":r+=e+$(t,++i);return r}(t),n)),s&&(p.sticky=!0),w.length&&(p.groups=w)),t!==O)try{o(d,"source",""===O?"(?:)":O)}catch(t){}return d},M=s(C),U=0;M.length>U;)d(H,C,M[U++]);k.constructor=H,H.prototype=k,p(e,"RegExp",H,{constructor:!0})}y("RegExp")}();var vs,bs={};!function(){if(vs)return bs;vs=1;var t=Ze().PROPER,e=an(),n=_e(),i=sr(),r=A(),o=wo(),a="toString",s=RegExp.prototype,l=s[a],c=r(function(){return"/a/b"!==l.call({source:"a",flags:"b"})}),u=t&&l.name!==a;(c||u)&&e(s,a,function(){var t=n(this);return"/"+i(t.source)+"/"+i(o(t))},{unsafe:!0})}();var ms,ys,ws,Ss,xs,Os={};function Cs(){if(Ss)return ws;Ss=1;var t=xt(),e=ve(),n=Math.floor,i=t("".charAt),r=t("".replace),o=t("".slice),a=/\$([$&'`]|\d{1,2}|<[^>]*>)/g,s=/\$([$&'`]|\d{1,2})/g;return ws=function(t,l,c,u,h,f){var d=c+t.length,p=u.length,g=s;return void 0!==h&&(h=e(h),g=a),r(f,g,function(e,r){var a;switch(i(r,0)){case"$":return"$";case"&":return t;case"`":return o(l,0,c);case"'":return o(l,d);case"<":a=h[o(r,1,-1)];break;default:var s=+r;if(0===s)return e;if(s>p){var f=n(s/10);return 0===f?e:f<=p?void 0===u[f-1]?i(r,1):u[f-1]+i(r,1):e}a=u[s-1]}return void 0===a?"":a})}}!function(){if(xs)return Os;xs=1;var t=function(){if(ys)return ms;ys=1;var t=$(),e=Function.prototype,n=e.apply,i=e.call;return ms="object"==typeof Reflect&&Reflect.apply||(t?i.bind(n):function(){return i.apply(n,arguments)}),ms}(),e=E(),n=xt(),i=go(),r=A(),o=_e(),a=At(),s=It(),l=kn(),c=Pn(),u=sr(),h=Tt(),f=yo(),d=Bt(),p=Cs(),g=wo(),v=So(),b=ye()("replace"),m=Math.max,y=Math.min,w=n([].concat),S=n([].push),x=n("".indexOf),O=n("".slice),C=function(t){return void 0===t?t:String(t)},k="$0"==="a".replace(/./,"$0"),T=!!/./[b]&&""===/./[b]("a","$0");i("replace",function(n,i,r){var k=T?"$":"$0";return[function(t,n){var r=h(this),o=s(t)?d(t,b):void 0;return o?e(o,t,r,n):e(i,u(r),t,n)},function(e,n){var s=o(this),h=u(e),d=a(n);d||(n=u(n));var b=u(g(s));if("string"==typeof n&&!~x(n,k)&&!~x(n,"$<")&&!~x(b,"y")){var T=r(i,s,h,n);if(T.done)return T.value}var P,A=!!~x(b,"g");A&&(P=!!~x(b,"u")||!!~x(b,"v"),s.lastIndex=0);for(var I,$=[];null!==(I=v(s,h))&&(S($,I),A);){""===u(I[0])&&(s.lastIndex=f(h,c(s.lastIndex),P))}for(var E="",R=0,j=0;j<$.length;j++){for(var _,N=u((I=$[j])[0]),L=m(y(l(I.index),h.length),0),F=[],D=1;D<I.length;D++)S(F,C(I[D]));var B=I.groups;if(d){var V=w([N],F,L,h);void 0!==B&&S(V,B),_=u(t(n,void 0,V))}else _=p(N,h,L,F,B,n);L>=R&&(E+=O(h,R,L)+_,R=L+N.length)}return E+O(h,R)}]},!!r(function(){var t=/./;return t.exec=function(){var t=[];return t.groups={a:"7"},t},"7"!=="".replace(t,"$<a>")})||!k||T)}();var ks={"Æ":"AE","æ":"ae","Ø":"O","ø":"o","Å":"A","å":"a","Ä":"A","ä":"a","Ö":"O","ö":"o","Ü":"U","ü":"u","ẞ":"SS","ß":"ss","Œ":"OE","œ":"oe","Č":"C","č":"c","Ć":"C","ć":"c","Š":"S","š":"s","Ž":"Z","ž":"z","Ł":"L","ł":"l","Đ":"Dj","đ":"dj","Ń":"N","ń":"n","Ę":"E","ę":"e","Ą":"A","ą":"a","Ŕ":"R","ŕ":"r","Ğ":"G","ğ":"g","İ":"I","ı":"i","Ş":"S","ş":"s","Ă":"A","ă":"a","Â":"A","â":"a","Î":"I","î":"i","Ș":"S","ș":"s","Ț":"T","ț":"t","Α":"A","Ά":"A","α":"a","ά":"a","Β":"V","β":"v","Γ":"G","γ":"g","Δ":"D","δ":"d","Ε":"E","Έ":"E","ε":"e","έ":"e","Ζ":"Z","ζ":"z","Η":"I","Ή":"I","η":"i","ή":"i","Ι":"I","Ί":"I","ι":"i","ί":"i","Κ":"K","κ":"k","Λ":"L","λ":"l","Μ":"M","μ":"m","Ν":"N","ν":"n","Ξ":"X","ξ":"x","Ο":"O","Ό":"O","ο":"o","ό":"o","Π":"P","π":"p","Ρ":"R","ρ":"r","Σ":"S","σ":"s","ς":"s","Τ":"T","τ":"t","Υ":"Y","Ύ":"Y","υ":"y","ύ":"y","Φ":"F","φ":"f","Χ":"CH","χ":"ch","Ψ":"PS","ψ":"ps","Ω":"O","Ώ":"O","ω":"o","ώ":"o"};function Ts(t){for(var e=arguments.length,n=new Array(e>1?e-1:0),i=1;i<e;i++)n[i-1]=arguments[i];var r=!0,o=0,a=t.replace(/%s/g,function(){var t=n[o++];return void 0===t?(r=!1,""):t});return r?a:""}function Ps(t){return t.toString().replace(/'/g,"&#39;")}function As(t){return t?t.toString().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"):t}function Is(t){return t?t.toString().replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;"):t}var $s,Es=Object.freeze({__proto__:null,escapeApostrophe:Ps,escapeAttr:Is,escapeHTML:As,normalizeAccent:function(t){if("string"!=typeof t)return t;var e=new RegExp("[".concat(Object.keys(ks).join(""),"]"),"g");return t.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(e,function(t){return ks[t]}).toLowerCase().trim()},normalizeStyle:function(t){if(t){var e=t.trim();if(e)return e.replace(/;?\s*$/,"; ")}},removeHTML:function(t){return t?t.toString().replace(/(<([^>]+)>)/gi,"").replace(/&[#A-Za-z0-9]+;/gi,"").trim():t},sprintf:Ts,unescapeHTML:function(t){return"string"==typeof t&&t?t.toString().replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&"):t}}),Rs={};!function(){if($s)return Rs;$s=1;var t=pi(),e=jr(),n=In().indexOf,i=zo(),r=e([].indexOf),o=!!r&&1/r([1],1,-0)<0;t({target:"Array",proto:!0,forced:o||!i("indexOf")},{indexOf:function(t){var e=arguments.length>1?arguments[1]:void 0;return o?r(this,t,e)||0:n(this,t,e)}})}();var js,_s,Ns={};function Ls(t){return"string"==typeof t?t:Array.isArray(t)?t.map(function(t){return Ls(t)}).filter(function(t){return t}).join(" "):t&&"object"===f(t)?Object.entries(t).map(function(t){var e=c(t,2),n=e[0];return e[1]?n:""}).filter(function(t){return t}).join(" "):""}function Fs(t,e){if(!e)return t;var n=/\s*!important\s*$/i,i=function(t){return"string"==typeof t&&n.test(t)?{value:t.replace(n,""),priority:"important"}:{value:t,priority:""}};if("string"==typeof e)e.split(";").forEach(function(e){var n=e.indexOf(":");if(n>0){var r=e.substring(0,n).trim(),o=e.substring(n+1).trim(),a=i(o),s=a.value,l=a.priority;t.style.setProperty(r,s,l)}});else if(Array.isArray(e)){var r,a=o(e);try{for(a.s();!(r=a.n()).done;){var s=r.value;Fs(t,s)}}catch(t){a.e(t)}finally{a.f()}}else if("object"===f(e))for(var l=0,u=Object.entries(e);l<u.length;l++){var h=c(u[l],2),d=h[0],p=h[1],g=i(p),v=g.value,b=g.priority;t.style.setProperty(d,v,b)}return t}!function(){if(js)return Ns;js=1;var t=pi(),e=Nr().map;t({target:"Array",proto:!0,forced:!Ci()("map")},{map:function(t){return e(this,t,arguments.length>1?arguments[1]:void 0)}})}();var Ds,Bs=Object.freeze({__proto__:null,classToString:Ls,getScrollBarWidth:function(){if(void 0===_s){var t=Ka.create('<div class="fixed-table-scroll-inner"></div>'),e=Ka.create('<div class="fixed-table-scroll-outer"></div>');Ka.append(e,t),Ka.append(document.body,e);var n=t.offsetWidth;Ka.css(e,"overflow","scroll");var i=t.offsetWidth;n===i&&(i=e.clientWidth),Ka.remove(e),_s=n-i}return _s},h:function(t,e,n){var i=t instanceof HTMLElement?t:document.createElement(t),r=e||{},o=n||[];"A"===i.tagName&&(i.href="javascript:");for(var a=0,s=Object.entries(r);a<s.length;a++){var l=c(s[a],2),h=l[0],f=l[1];if(void 0!==f)if(["text","innerText"].includes(h))i.innerText=f;else if(["html","innerHTML"].includes(h))i.innerHTML=f;else if("children"===h)o.push.apply(o,u(f));else if("class"===h)i.setAttribute("class",Ls(f));else if("style"===h)"string"==typeof f?i.setAttribute("style",f):Fs(i,f);else if(h.startsWith("@")||h.startsWith("on")){var d=h.startsWith("@")?h.substring(1):h.substring(2).toLowerCase(),p=Array.isArray(f)?f:[f];i.addEventListener.apply(i,[d].concat(u(p)))}else h.startsWith(".")?i[h.substring(1)]=f:i.setAttribute(h,f)}return o.length&&i.append.apply(i,u(o)),i},htmlToNodes:function(t){if(t&&"object"===f(t)&&"jquery"in t)return Array.from(t);if(t instanceof Node)return[t];"string"!=typeof t&&(t=new String(t).toString());var e=document.createElement("div");return e.innerHTML=t,e.childNodes},isDomNode:function(t){return t instanceof Node||Boolean(t&&"object"===f(t)&&"number"==typeof t.length&&t.length>=0&&"jquery"in t)},parseStyle:Fs}),Vs={};function Hs(t){for(var e=0,n=Object.entries(t);e<n.length;e++){var i=c(n[e],2),r=i[0],o=i[1],a=r.split(/(?=[A-Z])/).join("-").toLowerCase();a!==r&&(t[a]=o,delete t[r])}return t}function Ms(t,e,n){var i=arguments.length>3&&void 0!==arguments[3]?arguments[3]:void 0;if(void 0!==i&&(n=i),"string"!=typeof e||t.hasOwnProperty(e)||!e.includes("."))return n?As(t[e]):t[e];var r,a=t,s=o(e.split("."));try{for(s.s();!(r=s.n()).done;){var l=r.value;if(null==a)return;a=a[l]}}catch(t){s.e(t)}finally{s.f()}return n?As(a):a}!function(){if(Ds)return Vs;Ds=1;var t,e=pi(),n=jr(),i=Ce().f,r=Pn(),o=sr(),a=Or(),s=Tt(),l=Cr(),c=fe(),u=n("".slice),h=Math.min,f=l("endsWith");e({target:"String",proto:!0,forced:!!(c||f||(t=i(String.prototype,"endsWith"),!t||t.writable))&&!f},{endsWith:function(t){var e=o(s(this));a(t);var n=o(t),i=arguments.length>1?arguments[1]:void 0,l=e.length,c=void 0===i?l:h(r(i),l);return u(e,c-n.length,c)===n}})}();var Us,zs=Object.freeze({__proto__:null,checkAutoMergeCells:function(t){var e,n=o(t);try{for(n.s();!(e=n.n()).done;)for(var i=e.value,r=0,a=Object.keys(i);r<a.length;r++){var s=a[r];if(s.startsWith("_")&&(s.endsWith("_rowspan")||s.endsWith("_colspan")))return!0}}catch(t){n.e(t)}finally{n.f()}return!1},findIndex:function(t,e){var n,i=o(t);try{for(i.s();!(n=i.n()).done;){var r=n.value;if(JSON.stringify(r)===JSON.stringify(e))return t.indexOf(r)}}catch(t){i.e(t)}finally{i.f()}return-1},flattenRowspanCells:function(t){for(var e=0;e<t.length;e++)for(var n=t[e],i=0,r=Object.keys(n);i<r.length;i++){var o=r[i];if(o.startsWith("_")&&o.endsWith("_rowspan")){var a=o.replace(/^_/,"").replace(/_rowspan$/,""),s=+n[o]||1;if(!(s<=1)){for(var l=Ms(n,a,!1),c=n.hasOwnProperty(a),u=1;u<s&&e+u<t.length;u++){var h=t[e+u];if(a.includes(".")&&!c){for(var d=a.split("."),p=h,g=0;g<d.length-1;g++)"object"===f(p[d[g]])&&null!==p[d[g]]||(p[d[g]]={}),p=p[d[g]];p[d[d.length-1]]=l}else h[a]=l;delete h["_".concat(a,"_rowspan")]}delete n[o]}}}},getFieldTitle:function(t,e){var n,i=o(t);try{for(i.s();!(n=i.n()).done;){var r=n.value;if(r.field===e)return r.title}}catch(t){i.e(t)}finally{i.f()}return""},getItemField:Ms,getRealDataAttr:Hs,hasRowspanCells:function(t){var e,n=o(t);try{for(n.s();!(e=n.n()).done;)for(var i=e.value,r=0,a=Object.keys(i);r<a.length;r++){var s=a[r];if(s.startsWith("_")&&s.endsWith("_rowspan")&&(+i[s]||0)>1)return!0}}catch(t){n.e(t)}finally{n.f()}return!1},setFieldIndex:function(t){var e,n=0,i=[],r=o(t[0]);try{for(r.s();!(e=r.n()).done;){n+=+e.value.colspan||1}}catch(t){r.e(t)}finally{r.f()}for(var a=0;a<t.length;a++){i[a]=[];for(var s=0;s<n;s++)i[a][s]=!1}for(var l=0;l<t.length;l++){var c,u=o(t[l]);try{for(u.s();!(c=u.n()).done;){var h=c.value,f=+h.rowspan||1,d=+h.colspan||1,p=i[l].indexOf(!1);h.colspanIndex=p,1===d?(h.fieldIndex=p,void 0===h.field&&(h.field=p)):h.colspanGroup=+h.colspan;for(var g=0;g<f;g++)for(var v=0;v<d;v++)i[l+g][p+v]=!0}}catch(t){u.e(t)}finally{u.f()}}},trToData:function(t,e){for(var n=[],i=[],r=Array.from(e),o=0;o<r.length;o++){var a=r[o],s={};s._id=Ka.attr(a,"id"),s._class=Ka.attr(a,"class"),s._data=Hs(l({},a.dataset)),s._style=Ka.attr(a,"style");for(var c=Ka.children(a,"td,th"),u=0;u<c.length;u++){for(var h=c[u],f=parseInt(Ka.attr(h,"colspan"),10)||1,d=parseInt(Ka.attr(h,"rowspan"),10)||1,p=u;i[o]&&i[o][p];p++);for(var g=p;g<p+f;g++)for(var v=o;v<o+d;v++)i[v]||(i[v]=[]),i[v][g]=!0;var b=t[p].field;s[b]=Ps(Ka.html(h).trim()),s["_".concat(b,"_id")]=Ka.attr(h,"id"),s["_".concat(b,"_class")]=Ka.attr(h,"class"),s["_".concat(b,"_rowspan")]=Ka.attr(h,"rowspan"),s["_".concat(b,"_colspan")]=Ka.attr(h,"colspan"),s["_".concat(b,"_title")]=Ka.attr(h,"title"),s["_".concat(b,"_data")]=Hs(l({},h.dataset)),s["_".concat(b,"_style")]=Ka.attr(h,"style")}n.push(s)}return n},updateFieldGroup:function(t,e){var n,i,r=(n=[]).concat.apply(n,u(t)),a=o(t);try{for(a.s();!(i=a.n()).done;){var s,l=o(i.value);try{for(l.s();!(s=l.n()).done;){var c=s.value;if(c.colspanGroup>1){for(var h=0,f=function(t){var e=r.filter(function(e){return e.fieldIndex===t}),n=e[e.length-1];if(!n)return 1;if(e.length>1)for(var i=0;i<e.length-1;i++)e[i].visible=n.visible;n.visible&&h++},d=c.colspanIndex;d<c.colspanIndex+c.colspanGroup;d++)f(d);c.colspan=h,c.visible=h>0}}}catch(t){l.e(t)}finally{l.f()}}}catch(t){a.e(t)}finally{a.f()}if(!(t.length<2)){var p,g=o(e);try{var v=function(){var t=p.value,e=r.filter(function(e){return e.fieldIndex===t.fieldIndex});if(e.length>1){var n,i=o(e);try{for(i.s();!(n=i.n()).done;){n.value.visible=t.visible}}catch(t){i.e(t)}finally{i.f()}}};for(g.s();!(p=g.n()).done;)v()}catch(t){g.e(t)}finally{g.f()}}}}),qs={};!function(){if(Us)return qs;Us=1;var t=E(),e=xt(),n=go(),i=_e(),r=It(),o=Pn(),a=sr(),s=Tt(),l=Bt(),c=yo(),u=wo(),h=So(),f=e("".indexOf);n("match",function(e,n,d){return[function(n){var i=s(this),o=r(n)?l(n,e):void 0;return o?t(o,n,i):new RegExp(n)[e](a(i))},function(t){var e=i(this),r=a(t),s=d(n,e,r);if(s.done)return s.value;var l=a(u(e));if(!~f(l,"g"))return h(e,r);var p=!!~f(l,"u")||!!~f(l,"v");e.lastIndex=0;for(var g,v=[],b=0;null!==(g=h(e,r));){var m=a(g[0]);v[b]=m,""===m&&(e.lastIndex=c(r,o(e.lastIndex),p)),b++}return 0===b?null:v}]})}();var Ws,Gs,Ks,Ys,Js,Qs={};function Xs(){return Gs?Ws:(Gs=1,Ws=Object.is||function(t,e){return t===e?0!==t||1/t==1/e:t!=t&&e!=e})}function Zs(){if(Js)return Ys;Js=1;var t=Pt(),e=Vi(),n=ga(),i=rn(),r=Ne().f,o=Wa(),a=Ga(),s=fe(),l=I(),c="Array Iterator",u=i.set,h=i.getterFor(c);Ys=o(Array,"Array",function(e,n){u(this,{type:c,target:t(e),index:0,kind:n})},function(){var t=h(this),e=t.target,n=t.index++;if(!e||n>=e.length)return t.target=null,a(void 0,!0);switch(t.kind){case"keys":return a(n,!1);case"values":return a(e[n],!1)}return a([n,e[n]],!1)},"values");var f=n.Arguments=n.Array;if(e("keys"),e("values"),e("entries"),!s&&l&&"values"!==f.name)try{r(f,"name",{value:"values"})}catch(t){}return Ys}!function(){if(Ks)return Qs;Ks=1;var t=E(),e=go(),n=_e(),i=It(),r=Tt(),o=Xs(),a=sr(),s=Bt(),l=So();e("search",function(e,c,u){return[function(n){var o=r(this),l=i(n)?s(n,e):void 0;return l?t(l,n,o):new RegExp(n)[e](a(o))},function(t){var e=n(this),i=a(t),r=u(c,e,i);if(r.done)return r.value;var s=e.lastIndex;o(s,0)||(e.lastIndex=0);var h=l(e,i);return o(e.lastIndex,s)||(e.lastIndex=s),null===h?-1:h.index}]})}(),Zs();var tl,el,nl,il={};function rl(){if(el)return tl;el=1;var t=xt();return tl=t([].slice)}!function(){if(nl)return il;nl=1;var t=pi(),e=gi(),n=Si(),i=It(),r=Tn(),o=An(),a=Pt(),s=bi(),l=mi(),c=ye(),u=Ci(),h=rl(),f=u("slice"),d=c("species"),p=Array,g=Math.max;t({target:"Array",proto:!0,forced:!f},{slice:function(t,c){var u,f,v,b=a(this),m=o(b),y=r(t,m),w=r(void 0===c?m:c,m);if(e(b)&&(u=b.constructor,(n(u)&&(u===p||e(u.prototype))||i(u)&&null===(u=u[d]))&&(u=void 0),u===p||void 0===u))return h(b,y,w);for(f=new(void 0===u?p:u)(g(w-y,0)),v=0;y<w;y++,v++)y in b&&s(f,v,b[y]);return l(f,v),f}})}();var ol,al={};!function(){if(ol)return al;ol=1;var t=m(),e=Mo(),n=Uo(),i=Zs(),r=Le(),o=Ha(),a=ye()("iterator"),s=i.values,l=function(t,n){if(t){if(t[a]!==s)try{r(t,a,s)}catch(e){t[a]=s}if(o(t,n,!0),e[n])for(var l in i)if(t[l]!==i[l])try{r(t,l,i[l])}catch(e){t[l]=i[l]}}};for(var c in e)l(t[c]&&t[c].prototype,c);l(n,"DOMTokenList")}();var sl,ll,cl,ul,hl,fl,dl,pl,gl,vl,bl,ml,yl,wl,Sl,xl,Ol={};function Cl(){if(cl)return ll;cl=1;var t=m(),e=I(),n=Object.getOwnPropertyDescriptor;return ll=function(i){if(!e)return t[i];var r=n(t,i);return r&&r.value}}function kl(){if(dl)return fl;dl=1;var t=an();return fl=function(e,n,i){for(var r in n)t(e,r,n[r],i);return e}}function Tl(){if(gl)return pl;gl=1;var t=Et(),e=TypeError;return pl=function(n,i){if(t(i,n))return n;throw new e("Incorrect invocation")}}function Pl(){if(bl)return vl;bl=1;var t=TypeError;return vl=function(e,n){if(e<n)throw new t("Not enough arguments");return e}}function Al(){if(yl)return ml;yl=1;var t=rl(),e=Math.floor,n=function(i,r){var o=i.length;if(o<8)for(var a,s,l=1;l<o;){for(s=l,a=i[l];s&&r(i[s-1],a)>0;)i[s]=i[--s];s!==l++&&(i[s]=a)}else for(var c=e(o/2),u=n(t(i,0,c),r),h=n(t(i,c),r),f=u.length,d=h.length,p=0,g=0;p<f||g<d;)i[p+g]=p<f&&g<d?r(u[p],h[g])<=0?u[p++]:h[g++]:p<f?u[p++]:h[g++];return i};return ml=n}function Il(){if(Sl)return wl;Sl=1,Zs(),function(){if(sl)return Ol;sl=1;var t=pi(),e=xt(),n=Tn(),i=RangeError,r=String.fromCharCode,o=String.fromCodePoint,a=e([].join);t({target:"String",stat:!0,arity:1,forced:!!o&&1!==o.length},{fromCodePoint:function(t){for(var e,o=[],s=arguments.length,l=0;s>l;){if(n(e=+arguments[l],1114111)!==e)throw new i(e+" is not a valid code point");o[l++]=e<65536?r(e):r(55296+((e-=65536)>>10),e%1024+56320)}return a(o,"")}})}();var t=pi(),e=m(),n=Cl(),i=$t(),r=E(),o=xt(),a=I(),s=function(){if(hl)return ul;hl=1;var t=A(),e=ye(),n=I(),i=fe(),r=e("iterator");return ul=!t(function(){var t=new URL("b?a=1&b=2&c=3","https://a"),e=t.searchParams,o=new URLSearchParams("a=1&a=2&b=3"),a="";return t.pathname="c%20d",e.forEach(function(t,n){e.delete("b"),a+=n+t}),o.delete("a",2),o.delete("b",void 0),i&&(!t.toJSON||!o.has("a",1)||o.has("a",2)||!o.has("a",void 0)||o.has("b"))||!e.size&&(i||!n)||!e.sort||"https://a/c%20d?a=1&c=3"!==t.href||"3"!==e.get("c")||"a=1"!==String(new URLSearchParams("?a=1"))||!e[r]||"a"!==new URL("https://a@b").username||"b"!==new URLSearchParams(new URLSearchParams("a=b")).get("a")||"xn--e1aybc"!==new URL("https://тест").host||"#%D0%B1"!==new URL("https://a#б").hash||"a1c3"!==a||"x"!==new URL("https://x",void 0).host})}(),l=an(),c=ps(),u=kl(),h=Ha(),f=Ma(),d=rn(),p=Tl(),g=At(),v=be(),b=_r(),y=wi(),w=_e(),S=It(),x=sr(),O=Bi(),C=St(),k=ma(),T=ba(),P=Ga(),$=Pl(),R=ye(),j=Al(),_=R("iterator"),N="URLSearchParams",L=N+"Iterator",F=d.set,D=d.getterFor(N),B=d.getterFor(L),V=n("fetch"),H=n("Request"),M=n("Headers"),U=H&&H.prototype,z=M&&M.prototype,q=e.TypeError,W=e.encodeURIComponent,G=String.fromCharCode,K=i("String","fromCodePoint"),Y=parseInt,J=o("".charAt),Q=o([].join),X=o([].push),Z=o("".replace),tt=o([].shift),et=o([].splice),nt=o("".split),it=o("".slice),rt=o(/./.exec),ot=/\+/g,at=/^[0-9a-f]+$/i,st=function(t,e){var n=it(t,e,e+2);return rt(at,n)?Y(n,16):NaN},lt=function(t){for(var e=0,n=128;n>0&&0!==(t&n);n>>=1)e++;return e},ct=function(t){var e=null,n=t.length;switch(n){case 1:e=t[0];break;case 2:e=(31&t[0])<<6|63&t[1];break;case 3:e=(15&t[0])<<12|(63&t[1])<<6|63&t[2];break;case 4:e=(7&t[0])<<18|(63&t[1])<<12|(63&t[2])<<6|63&t[3]}return null===e||e>1114111||e>=55296&&e<=57343||e<(n>3?65536:n>2?2048:n>1?128:0)?null:e},ut=function(t){for(var e=(t=Z(t,ot," ")).length,n="",i=0;i<e;){var r=J(t,i);if("%"===r){if("%"===J(t,i+1)||i+3>e){n+="%",i++;continue}var o=st(t,i+1);if(o!=o){n+=r,i++;continue}i+=2;var a=lt(o);if(0===a)r=G(o);else{if(1===a||a>4){n+="�",i++;continue}for(var s=[o],l=1;l<a&&!(++i+3>e||"%"!==J(t,i));){var c=st(t,i+1);if(c!=c||c>191||c<128)break;if(1===l){if(224===o&&c<160)break;if(237===o&&c>159)break;if(240===o&&c<144)break;if(244===o&&c>143)break}X(s,c),i+=2,l++}if(s.length!==a){n+="�";continue}var u=ct(s);if(null===u){for(var h=0;h<a;h++)n+="�";i++;continue}r=K(u)}}n+=r,i++}return n},ht=/[!'()~]|%20/g,ft={"!":"%21","'":"%27","(":"%28",")":"%29","~":"%7E","%20":"+"},dt=function(t){return ft[t]},pt=function(t){return Z(W(t),ht,dt)},gt=f(function(t,e){F(this,{type:L,target:D(t).entries,index:0,kind:e})},N,function(){var t=B(this),e=t.target,n=t.index++;if(!e||n>=e.length)return t.target=null,P(void 0,!0);var i=e[n];switch(t.kind){case"keys":return P(i.key,!1);case"values":return P(i.value,!1)}return P([i.key,i.value],!1)},!0),vt=function(t){this.entries=[],this.url=null,void 0!==t&&(S(t)?this.parseObject(t):this.parseQuery("string"==typeof t?"?"===J(t,0)?it(t,1):t:x(t)))};vt.prototype={type:N,bindURL:function(t){this.url=t,this.update()},parseObject:function(t){var e,n,i,o,a,s,l,c=this.entries,u=T(t);if(u)for(n=(e=k(t,u)).next;!(i=r(n,e)).done;){if(a=(o=k(w(i.value))).next,(s=r(a,o)).done||(l=r(a,o)).done||!r(a,o).done)throw new q("Expected sequence with length 2");X(c,{key:x(s.value),value:x(l.value)})}else for(var h in t)v(t,h)&&X(c,{key:h,value:x(t[h])})},parseQuery:function(t){if(t)for(var e,n,i=this.entries,r=nt(t,"&"),o=0;o<r.length;)(e=r[o++]).length&&(n=nt(e,"="),X(i,{key:ut(tt(n)),value:ut(Q(n,"="))}))},serialize:function(){for(var t,e=this.entries,n=[],i=0;i<e.length;)t=e[i++],X(n,pt(t.key)+"="+pt(t.value));return Q(n,"&")},update:function(){this.entries.length=0,this.parseQuery(this.url.query)},updateURL:function(){this.url&&this.url.update()}};var bt=function(){p(this,mt);var t=F(this,new vt(arguments.length>0?arguments[0]:void 0));a||(this.size=t.entries.length)},mt=bt.prototype;if(u(mt,{append:function(t,e){var n=D(this);$(arguments.length,2),X(n.entries,{key:x(t),value:x(e)}),a||this.size++,n.updateURL()},delete:function(t){for(var e=D(this),n=$(arguments.length,1),i=e.entries,r=x(t),o=n<2?void 0:arguments[1],s=void 0===o?o:x(o),l=0;l<i.length;){var c=i[l];c.key!==r||void 0!==s&&c.value!==s?l++:et(i,l,1)}a||(this.size=i.length),e.updateURL()},get:function(t){var e=D(this).entries;$(arguments.length,1);for(var n=x(t),i=0;i<e.length;i++)if(e[i].key===n)return e[i].value;return null},getAll:function(t){var e=D(this).entries;$(arguments.length,1);for(var n=x(t),i=[],r=0;r<e.length;r++)e[r].key===n&&X(i,e[r].value);return i},has:function(t){for(var e=D(this).entries,n=$(arguments.length,1),i=x(t),r=n<2?void 0:arguments[1],o=void 0===r?r:x(r),a=0;a<e.length;){var s=e[a++];if(s.key===i&&(void 0===o||s.value===o))return!0}return!1},set:function(t,e){var n=D(this);$(arguments.length,2);for(var i,r=n.entries,o=!1,s=x(t),l=x(e),c=0;c<r.length;c++)(i=r[c]).key===s&&(o?et(r,c--,1):(o=!0,i.value=l));o||X(r,{key:s,value:l}),a||(this.size=r.length),n.updateURL()},sort:function(){var t=D(this);j(t.entries,function(t,e){return t.key>e.key?1:-1}),t.updateURL()},forEach:function(t){for(var e,n=D(this).entries,i=b(t,arguments.length>1?arguments[1]:void 0),r=0;r<n.length;)i((e=n[r++]).value,e.key,this)},keys:function(){return new gt(this,"keys")},values:function(){return new gt(this,"values")},entries:function(){return new gt(this,"entries")}},{enumerable:!0}),l(mt,_,mt.entries,{name:"entries"}),l(mt,"toString",function(){return D(this).serialize()},{enumerable:!0}),a&&c(mt,"size",{get:function(){return D(this).entries.length},configurable:!0,enumerable:!0}),h(bt,N),t({global:!0,constructor:!0,forced:!s},{URLSearchParams:bt}),!s&&g(M)){var yt=o(z.has),wt=o(z.set),Ot=function(t){if(S(t)){var e,n=t.body;if(y(n)===N)return e=t.headers?new M(t.headers):new M,yt(e,"content-type")||wt(e,"content-type","application/x-www-form-urlencoded;charset=UTF-8"),O(t,{body:C(0,x(n)),headers:C(0,e)})}return t};if(g(V)&&t({global:!0,enumerable:!0,dontCallGetSet:!0,forced:!0},{fetch:function(t){return V(t,arguments.length>1?Ot(arguments[1]):{})}}),g(H)){var Ct=function(t){return p(this,U),new H(t,arguments.length>1?Ot(arguments[1]):{})};U.constructor=Ct,Ct.prototype=U,t({global:!0,constructor:!0,dontCallGetSet:!0,forced:!0},{Request:Ct})}}return wl={URLSearchParams:bt,getState:D}}function $l(t){return t.detailView&&t.detailViewIcon&&!t.cardView}function El(t){return!isNaN(parseFloat(t))&&isFinite(t)}xl||(xl=1,Il());var Rl=Object.freeze({__proto__:null,addQueryToUrl:function(t,e){for(var n=t.split("#"),i=c(n[0].split("?"),2),r=i[0],o=i[1],a=new URLSearchParams(o),s=0,l=Object.entries(e);s<l.length;s++){var u=c(l[s],2),h=u[0],f=u[1];a.set(h,f)}return"".concat(r,"?").concat(a.toString(),"#").concat(n.slice(1).join("#"))},calculateObjectValue:function(t,e,n,i){var r=e;if("string"==typeof e){var a=e.split(".");if(a.length>1){r=window;var s,l=o(a);try{for(l.s();!(s=l.n()).done;){r=r[s.value]}}catch(t){l.e(t)}finally{l.f()}}else r=window[e]}return null!==r&&"object"===f(r)?r:"function"==typeof r?r.apply(t,n||[]):!r&&"string"==typeof e&&n&&Ts.apply(void 0,[e].concat(u(n)))?Ts.apply(void 0,[e].concat(u(n))):i},debounce:function(t,e,n){var i;return function(){var r=this,o=arguments,a=n&&!i;clearTimeout(i),i=setTimeout(function(){i=null,n||t.apply(r,o)},e),a&&t.apply(r,o)}},getDetailViewIndexOffset:function(t){return $l(t)&&"right"!==t.detailViewAlign?1:0},getEventName:function(t){var e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"";return e=e||"".concat(+new Date).concat(~~(1e6*Math.random())),"".concat(t,"-").concat(e)},hasDetailViewIcon:$l,isIEBrowser:function(){return navigator.userAgent.includes("MSIE ")||/Trident.*rv:11\./.test(navigator.userAgent)},isNumeric:El});var jl=Object.freeze({__proto__:null,regexCompare:function(t,e){try{var n=e.match(/^\/(.*?)\/([gim]*)$/);if(-1!==t.toString().search(n?new RegExp(n[1],n[2]):new RegExp(e,"gim")))return!0}catch(t){return console.error(t),!1}return!1},replaceSearchMark:function(t,e){var n=t instanceof Element,i=n?t:document.createElement("div"),r=new RegExp(e,"gim"),a=function(t,e){for(var n,i=[],r=0;null!==(n=e.exec(t));){r!==n.index&&i.push(document.createTextNode(t.substring(r,n.index)));var o=document.createElement("mark");o.innerText=n[0],i.push(o),r=n.index+n[0].length}if(i.length)return r!==t.length&&i.push(document.createTextNode(t.substring(r))),i},s=function(t){for(var e=0;e<t.childNodes.length;e++){var n=t.childNodes[e];if(n.nodeType===document.TEXT_NODE){var i=a(n.data,r);if(i){var l,c=o(i);try{for(c.s();!(l=c.n()).done;){var u=l.value;t.insertBefore(u,n)}}catch(t){c.e(t)}finally{c.f()}t.removeChild(n),e+=i.length-1}}n.nodeType===document.ELEMENT_NODE&&s(n)}};return n||(i.innerHTML=t),s(i),n?i:i.innerHTML},sort:function(t,e,n,i,r,o){if(null==t&&(t=""),null==e&&(e=""),i.sortStable&&t===e&&(t=r,e=o),El(t)&&El(e))return(t=parseFloat(t))<(e=parseFloat(e))?-1*n:t>e?n:0;if(i.sortEmptyLast){if(""===t)return 1;if(""===e)return-1}return t===e?0:("string"!=typeof t&&(t=t.toString()),-1===t.localeCompare(e)?-1*n:n)}});var _l=Object.freeze({__proto__:null,getCheckboxHtml:function(t){var e=t.name,n=t.value,i=void 0===n?"":n,r=t.checked,o=void 0!==r&&r,a=t.disabled,s=void 0!==a&&a,l=t.label,c=void 0===l?"":l,u=t.extraClass,h=void 0===u?"":u,f=t.centered,d=void 0===f||f,p=t.withLabel,g=void 0!==p&&p,v=o?' checked="checked"':"",b=s?' disabled="disabled"':"",m=void 0!==i&&""!==i?' value="'.concat(Is(i),'"'):"",y=h?" ".concat(h):"",w=Is(e),S=As(c);return 5===Ya()?g?'<label class="dropdown-item dropdown-item-marker d-flex align-items-center gap-2">\n        <input class="form-check-input m-0'.concat(y,'" type="checkbox" name="').concat(w,'"').concat(m).concat(v).concat(b," />\n        <span>").concat(S,"</span>\n      </label>"):'<div class="form-check'.concat(d?" d-flex justify-content-center":"",'">\n      <input class="form-check-input').concat(y,'" type="checkbox" name="').concat(w,'"').concat(m).concat(v).concat(b," />\n    </div>"):g?'<label><input type="checkbox" name="'.concat(w,'"').concat(m).concat(v).concat(b).concat(y,"> <span>").concat(S,"</span></label>"):'<label><input type="checkbox" name="'.concat(w,'"').concat(m).concat(v).concat(b).concat(y," /><span></span></label>")},getCheckboxVdomConfig:function(t){var e=t.inputAttrs,n=t.formCheckClass,i=t.formCheckInputClass,r=t.centered,o=void 0===r||r;if(5===Ya()){var a=o?" d-flex justify-content-center":"";return{inputAttrs:l(l({},e),{},{class:i}),wrapperAttrs:{class:"".concat(n).concat(a)},wrapperTag:"div",hasSpan:!1}}return{inputAttrs:e,wrapperAttrs:{},wrapperTag:"label",hasSpan:!0}},getDropdownColumnCheckboxHtml:function(t){var e=t.dataField,n=t.value,i=t.checked?' checked="checked"':"",r=t.disabled?' disabled="disabled"':"",o=As(t.label);return 5===Ya()?'<label class="dropdown-item dropdown-item-marker d-flex align-items-center gap-2">\n      <input class="form-check-input m-0" type="checkbox" data-field="'.concat(Is(e),'" value="').concat(Is(n),'"').concat(i).concat(r," />\n      <span>").concat(o,"</span>\n    </label>"):'<input type="checkbox" data-field="'.concat(Is(e),'" value="').concat(Is(n),'"').concat(i).concat(r,"> <span>").concat(o,"</span>")},wrapCheckbox:function(t){var e=!(arguments.length>1&&void 0!==arguments[1])||arguments[1];return 5===Ya()?'<div class="form-check'.concat(e?" d-flex justify-content-center":"",'">').concat(t,"</div>"):"<label>".concat(t,"<span></span></label>")}}),Nl=l(l(l(l(l(l(l(l({},Qa),us),Es),Bs),zs),jl),Rl),_l),Ll=Nl.getBootstrapVersion(),Fl={3:{classes:{buttonActive:"active",buttons:"default",buttonsDropdown:"btn-group",buttonsGroup:"btn-group",buttonsPrefix:"btn",dropdownActive:"active",dropup:"dropup",input:"form-control",inputGroup:"input-group",inputPrefix:"input-",paginationActive:"active",paginationDropdown:"btn-group dropdown",pull:"pull",select:"form-control"},html:{dropdownCaret:'<span class="caret"></span>',icon:'<i class="%s %s"></i>',inputGroup:'<div class="input-group">%s<span class="input-group-btn">%s</span></div>',pageDropdown:['<ul class="dropdown-menu" role="menu">',"</ul>"],pageDropdownItem:'<li role="menuitem" class="%s"><a href="#">%s</a></li>',pagination:['<ul class="pagination%s">',"</ul>"],paginationItem:'<li class="page-item%s"><a class="page-link" aria-label="%s" href="javascript:void(0)">%s</a></li>',searchButton:'<button class="%s" type="button" name="search" title="%s">%s %s</button>',searchClearButton:'<button class="%s" type="button" name="clearSearch" title="%s">%s %s</button>',searchInput:'<input class="%s%s" type="text" placeholder="%s">',toolbarDropdown:['<ul class="dropdown-menu" role="menu">',"</ul>"],toolbarDropdownItem:'<li class="dropdown-item-marker" role="menuitem"><label>%s</label></li>',toolbarDropdownSeparator:'<li class="divider"></li>'}},4:{classes:{buttonActive:"active",buttons:"secondary",buttonsDropdown:"btn-group",buttonsGroup:"btn-group",buttonsPrefix:"btn",dropdownActive:"active",dropup:"dropup",input:"form-control",inputGroup:"btn-group",inputPrefix:"form-control-",paginationActive:"active",paginationDropdown:"btn-group dropdown",pull:"float",select:"form-control"},html:{dropdownCaret:'<span class="caret"></span>',icon:'<i class="%s %s"></i>',inputGroup:'<div class="input-group">%s<div class="input-group-append">%s</div></div>',pageDropdown:['<div class="dropdown-menu">',"</div>"],pageDropdownItem:'<a class="dropdown-item %s" href="#">%s</a>',pagination:['<ul class="pagination%s">',"</ul>"],paginationItem:'<li class="page-item%s"><a class="page-link" aria-label="%s" href="javascript:void(0)">%s</a></li>',searchButton:'<button class="%s" type="button" name="search" title="%s">%s %s</button>',searchClearButton:'<button class="%s" type="button" name="clearSearch" title="%s">%s %s</button>',searchInput:'<input class="%s%s" type="text" placeholder="%s">',toolbarDropdown:['<div class="dropdown-menu dropdown-menu-right">',"</div>"],toolbarDropdownItem:'<label class="dropdown-item dropdown-item-marker">%s</label>',toolbarDropdownSeparator:'<div class="dropdown-divider"></div>'}},5:{classes:{buttonActive:"active",buttons:"secondary",buttonsDropdown:"btn-group",buttonsGroup:"btn-group",buttonsPrefix:"btn",dropdownActive:"active",dropup:"dropup",formCheck:"form-check",formCheckInput:"form-check-input",input:"form-control",inputGroup:"btn-group",inputPrefix:"form-control-",paginationActive:"active",paginationDropdown:"btn-group dropdown",pull:"float",select:"form-select"},html:{dataToggle:"data-bs-toggle",dropdownCaret:'<span class="caret"></span>',icon:'<i class="%s %s"></i>',inputGroup:'<div class="input-group">%s%s</div>',pageDropdown:['<div class="dropdown-menu">',"</div>"],pageDropdownItem:'<a class="dropdown-item %s" href="#">%s</a>',pagination:['<ul class="pagination%s">',"</ul>"],paginationItem:'<li class="page-item%s"><a class="page-link" aria-label="%s" href="javascript:void(0)">%s</a></li>',searchButton:'<button class="%s" type="button" name="search" title="%s">%s %s</button>',searchClearButton:'<button class="%s" type="button" name="clearSearch" title="%s">%s %s</button>',searchInput:'<input class="%s%s" type="text" placeholder="%s">',toolbarDropdown:['<div class="dropdown-menu dropdown-menu-end">',"</div>"],toolbarDropdownItem:'<label class="dropdown-item dropdown-item-marker">%s</label>',toolbarDropdownSeparator:'<div class="dropdown-divider"></div>'}}}[Ll||5],Dl={ajax:void 0,ajaxOptions:{},buttons:{},buttonsAlign:"right",buttonsAttributeTitle:"title",buttonsClass:Fl.classes.buttons,buttonsOrder:["paginationSwitch","refresh","toggle","fullscreen","columns"],buttonsPrefix:Fl.classes.buttonsPrefix,buttonsToolbar:void 0,cache:!0,cardView:!1,checkboxHeader:!0,classes:"table table-bordered table-hover",clickToSelect:!1,columns:[[]],contentType:"application/json",customSearch:void 0,customSort:void 0,data:[],dataField:"rows",dataType:"json",detailFilter:function(t,e){return!0},detailFormatter:function(t,e){return""},detailView:!1,detailViewAlign:"left",detailViewByClick:!1,detailViewIcon:!0,escape:!1,escapeTitle:!0,filterOptions:{filterAlgorithm:"and"},fixedScroll:!1,footerField:"footer",footerStyle:function(t){return{}},headerStyle:function(t){return{}},height:void 0,icons:{},iconSize:void 0,iconsPrefix:void 0,idField:void 0,ignoreClickToSelectOn:function(t){var e=t.tagName;return["A","BUTTON"].includes(e)},loadingFontSize:"auto",loadingTemplate:function(t){return'<span class="loading-wrap">\n    <span class="loading-text">'.concat(t,'</span>\n    <span class="animation-wrap"><span class="animation-dot"></span></span>\n    </span>\n  ')},locale:void 0,maintainMetaData:!1,method:"get",minimumCountColumns:1,multipleSelectRow:!1,pageList:[10,25,50,100],pageNumber:1,pageSize:10,pagination:!1,paginationDetailHAlign:"left",paginationHAlign:"right",paginationLoadMore:!1,paginationLoop:!0,paginationNextText:"&rsaquo;",paginationPagesBySide:1,paginationParts:["pageInfo","pageSize","pageList"],paginationPreText:"&lsaquo;",paginationSuccessivelySize:5,paginationUseIntermediate:!1,paginationVAlign:"bottom",queryParams:function(t){return t},queryParamsType:"limit",regexSearch:!1,rememberOrder:!1,responseHandler:function(t){return t},rowAttributes:function(t,e){return{}},rowStyle:function(t,e){return{}},search:!1,searchable:!1,searchAccentNeutralise:!1,searchAlign:"right",searchHighlight:!1,searchOnEnterKey:!1,searchSelector:!1,searchText:"",searchTimeOut:500,selectItemName:"btSelectItem",serverSort:!0,showButtonIcons:!0,showButtonText:!1,showColumns:!1,showColumnsSearch:!1,showColumnsToggleAll:!1,showExtendedPagination:!1,showFooter:!1,showFullscreen:!1,showHeader:!0,showPaginationSwitch:!1,showRefresh:!1,showSearchButton:!1,showSearchClearButton:!1,showToggle:!1,sidePagination:"client",silentSort:!0,singleSelect:!1,smartDisplay:!0,sortable:!0,sortClass:void 0,sortEmptyLast:!1,sortName:void 0,sortOrder:void 0,sortReset:!1,sortResetPage:!1,sortStable:!1,strictSearch:!1,theadClasses:"",toolbar:void 0,toolbarAlign:"left",totalField:"total",totalNotFiltered:0,totalNotFilteredField:"totalNotFiltered",totalRows:0,trimOnSearch:!0,undefinedText:"-",uniqueId:void 0,url:void 0,virtualScroll:!1,virtualScrollItemHeight:void 0,visibleSearch:!1,onAll:function(t,e){return!1},onCheck:function(t){return!1},onCheckAll:function(t){return!1},onCheckSome:function(t){return!1},onClickCell:function(t,e,n,i){return!1},onClickRow:function(t,e){return!1},onCollapseRow:function(t,e){return!1},onColumnSwitch:function(t,e){return!1},onColumnSwitchAll:function(t){return!1},onDblClickCell:function(t,e,n,i){return!1},onDblClickRow:function(t,e){return!1},onExpandRow:function(t,e,n){return!1},onLoadError:function(t){return!1},onLoadSuccess:function(t){return!1},onPageChange:function(t,e){return!1},onPostBody:function(){return!1},onPostFooter:function(){return!1},onPostHeader:function(){return!1},onPreBody:function(t){return!1},onRefresh:function(t){return!1},onRefreshOptions:function(t){return!1},onResetView:function(){return!1},onScrollBody:function(){return!1},onSearch:function(t){return!1},onSort:function(t,e){return!1},onToggle:function(t){return!1},onTogglePagination:function(t){return!1},onUncheck:function(t){return!1},onUncheckAll:function(t){return!1},onUncheckSome:function(t){return!1},onVirtualScroll:function(t,e){return!1}},Bl={formatAllRows:function(){return"All"},formatClearSearch:function(){return"Clear Search"},formatColumns:function(){return"Columns"},formatColumnsToggleAll:function(){return"Toggle all"},formatDetailPagination:function(t){return"Showing ".concat(t," rows")},formatFullscreen:function(){return"Fullscreen"},formatLoadingMessage:function(){return"Loading, please wait"},formatNoMatches:function(){return"No matching records found"},formatPaginationSwitch:function(){return"Hide/Show pagination"},formatPaginationSwitchDown:function(){return"Show pagination"},formatPaginationSwitchUp:function(){return"Hide pagination"},formatRecordsPerPage:function(t){return"".concat(t," rows per page")},formatRefresh:function(){return"Refresh"},formatSearch:function(){return"Search"},formatShowingRows:function(t,e,n,i){return void 0!==i&&i>0&&i>n?"Showing ".concat(t," to ").concat(e," of ").concat(n," rows (filtered from ").concat(i," total rows)"):"Showing ".concat(t," to ").concat(e," of ").concat(n," rows")},formatSRPaginationNextText:function(){return"next page"},formatSRPaginationPageText:function(t){return"to page ".concat(t)},formatSRPaginationPreText:function(){return"previous page"},formatToggleOff:function(){return"Hide card view"},formatToggleOn:function(){return"Show card view"}},Vl={align:void 0,cardVisible:!0,cellStyle:void 0,checkbox:!1,checkboxEnabled:!0,class:void 0,clickToSelect:!0,colspan:void 0,detailFormatter:void 0,escape:void 0,events:void 0,falign:void 0,field:void 0,footerFormatter:void 0,footerStyle:void 0,formatter:void 0,halign:void 0,order:"asc",radio:!1,rowspan:void 0,searchable:!0,searchFormatter:!0,searchHighlightFormatter:!1,showSelectTitle:!1,sortable:!1,sorter:void 0,sortName:void 0,switchable:!0,switchableLabel:void 0,title:void 0,titleTooltip:void 0,valign:void 0,visible:!0,width:void 0,widthUnit:"px"};Object.assign(Dl,Bl);var Hl,Ml={COLUMN_DEFAULTS:Vl,CONSTANTS:Fl,DEFAULTS:Dl,EVENTS:{"all.bs.table":"onAll","check-all.bs.table":"onCheckAll","check-some.bs.table":"onCheckSome","check.bs.table":"onCheck","click-cell.bs.table":"onClickCell","click-row.bs.table":"onClickRow","collapse-row.bs.table":"onCollapseRow","column-switch-all.bs.table":"onColumnSwitchAll","column-switch.bs.table":"onColumnSwitch","dbl-click-cell.bs.table":"onDblClickCell","dbl-click-row.bs.table":"onDblClickRow","expand-row.bs.table":"onExpandRow","load-error.bs.table":"onLoadError","load-success.bs.table":"onLoadSuccess","page-change.bs.table":"onPageChange","post-body.bs.table":"onPostBody","post-footer.bs.table":"onPostFooter","post-header.bs.table":"onPostHeader","pre-body.bs.table":"onPreBody","refresh-options.bs.table":"onRefreshOptions","refresh.bs.table":"onRefresh","reset-view.bs.table":"onResetView","scroll-body.bs.table":"onScrollBody","search.bs.table":"onSearch","sort.bs.table":"onSort","toggle-pagination.bs.table":"onTogglePagination","toggle.bs.table":"onToggle","uncheck-all.bs.table":"onUncheckAll","uncheck-some.bs.table":"onUncheckSome","uncheck.bs.table":"onUncheck","virtual-scroll.bs.table":"onVirtualScroll"},ICONS:{glyphicon:{clearSearch:"glyphicon-trash",columns:"glyphicon-th icon-th",detailClose:"glyphicon-minus icon-minus",detailOpen:"glyphicon-plus icon-plus",fullscreen:"glyphicon-fullscreen",paginationSwitchDown:"glyphicon-collapse-down icon-chevron-down",paginationSwitchUp:"glyphicon-collapse-up icon-chevron-up",refresh:"glyphicon-refresh icon-refresh",search:"glyphicon-search",toggleOff:"glyphicon-list-alt icon-list-alt",toggleOn:"glyphicon-list-alt icon-list-alt"},fa:{clearSearch:"fa-trash",columns:"fa-th-list",detailClose:"fa-minus",detailOpen:"fa-plus",fullscreen:"fa-arrows-alt",paginationSwitchDown:"fa-caret-square-down",paginationSwitchUp:"fa-caret-square-up",refresh:"fa-sync",search:"fa-search",toggleOff:"fa-toggle-off",toggleOn:"fa-toggle-on"},bi:{clearSearch:"bi-trash",columns:"bi-list-ul",detailClose:"bi-dash",detailOpen:"bi-plus",fullscreen:"bi-arrows-move",paginationSwitchDown:"bi-caret-down-square",paginationSwitchUp:"bi-caret-up-square",refresh:"bi-arrow-clockwise",search:"bi-search",toggleOff:"bi-toggle-off",toggleOn:"bi-toggle-on"},icon:{clearSearch:"icon-trash-2",columns:"icon-list",detailClose:"icon-minus",detailOpen:"icon-plus",fullscreen:"icon-maximize",paginationSwitchDown:"icon-arrow-up-circle",paginationSwitchUp:"icon-arrow-down-circle",refresh:"icon-refresh-cw",search:"icon-search",toggleOff:"icon-toggle-right",toggleOn:"icon-toggle-right"},"material-icons":{clearSearch:"delete",columns:"view_list",detailClose:"remove",detailOpen:"add",fullscreen:"fullscreen",paginationSwitchDown:"grid_on",paginationSwitchUp:"grid_off",refresh:"refresh",search:"search",sort:"sort",toggleOff:"tablet",toggleOn:"tablet_android"}},LOCALES:{en:Bl,"en-US":Bl},METHODS:["getOptions","refreshOptions","getData","getFooterData","getSelections","load","append","prepend","remove","removeAll","insertRow","updateRow","getRowByUniqueId","updateByUniqueId","removeByUniqueId","updateCell","updateCellByUniqueId","showRow","hideRow","getHiddenRows","showColumn","hideColumn","getVisibleColumns","getHiddenColumns","showAllColumns","hideAllColumns","mergeCells","checkAll","uncheckAll","checkInvert","check","uncheck","checkBy","uncheckBy","refresh","destroy","resetView","showLoading","hideLoading","togglePagination","toggleFullscreen","toggleView","resetSearch","filterBy","sortBy","sortReset","scrollTo","getScrollPosition","selectPage","prevPage","nextPage","toggleDetailView","expandRow","collapseRow","expandRowByUniqueId","collapseRowByUniqueId","expandAllRows","collapseAllRows","updateColumnTitle","updateFormatText"],THEME:"bootstrap".concat(Ll),VERSION:"1.27.3"},Ul={initConstants:function(){var e=this.options;this.constants=Ml.CONSTANTS,this.constants.theme=t.fn.bootstrapTable.theme,this.constants.dataToggle=this.constants.html.dataToggle||"data-toggle";var n=Nl.getIconsPrefix(t.fn.bootstrapTable.theme);"string"==typeof e.icons&&(e.icons=Nl.calculateObjectValue(null,e.icons)),e.iconsPrefix=e.iconsPrefix||t.fn.bootstrapTable.defaults.iconsPrefix||n,e.icons=Object.assign(Nl.getIcons(Ml.ICONS,e.iconsPrefix),t.fn.bootstrapTable.defaults.icons,e.icons);var i=e.buttonsPrefix?"".concat(e.buttonsPrefix,"-"):"";this.constants.buttonsClass=[e.buttonsPrefix,i+e.buttonsClass,Nl.sprintf("".concat(i,"%s"),e.iconSize)].join(" ").trim(),this.buttons=Nl.calculateObjectValue(this,e.buttons,[],{}),"object"!==f(this.buttons)&&(this.buttons={})},initLocale:function(){if(this.options.locale){var e=t.fn.bootstrapTable.locales,n=this.options.locale.split(/-|_/);n[0]=n[0].toLowerCase(),n[1]&&(n[1]=n[1].toUpperCase());var i={};e[this.options.locale]?i=e[this.options.locale]:e[n.join("-")]?i=e[n.join("-")]:e[n[0]]&&(i=e[n[0]]),this._defaultLocales=this._defaultLocales||{};for(var r=0,o=Object.entries(i);r<o.length;r++){var a=c(o[r],2),s=a[0],l=a[1],u=this._defaultLocales.hasOwnProperty(s)?this._defaultLocales[s]:Ml.DEFAULTS[s];this.options[s]===u&&(this.options[s]=l,this._defaultLocales[s]=l)}}},initContainer:function(){var e=["top","both"].includes(this.options.paginationVAlign)?'<div class="fixed-table-pagination clearfix"></div>':"",n=["bottom","both"].includes(this.options.paginationVAlign)?'<div class="fixed-table-pagination"></div>':"",i=Nl.calculateObjectValue(this.options,this.options.loadingTemplate,[this.options.formatLoadingMessage()]);this.$container=t('\n      <div class="bootstrap-table '.concat(this.constants.theme,'">\n      <div class="fixed-table-toolbar"></div>\n      ').concat(e,'\n      <div class="fixed-table-container">\n      <div class="fixed-table-header"><table></table></div>\n      <div class="fixed-table-body">\n      <div class="fixed-table-loading">\n      ').concat(i,'\n      </div>\n      </div>\n      <div class="fixed-table-footer"></div>\n      </div>\n      ').concat(n,"\n      </div>\n    ")),this.$container.insertAfter(this.$el),this.$tableContainer=this.$container.find(".fixed-table-container"),this.$tableHeader=this.$container.find(".fixed-table-header"),this.$tableBody=this.$container.find(".fixed-table-body"),this.$tableLoading=this.$container.find(".fixed-table-loading"),this.$tableFooter=this.$el.find("tfoot"),this.options.buttonsToolbar?this.$toolbar=t("body").find(this.options.buttonsToolbar):this.$toolbar=this.$container.find(".fixed-table-toolbar"),this.$pagination=this.$container.find(".fixed-table-pagination"),this.$tableBody.append(this.$el),this.$container.after('<div class="clearfix"></div>'),this.$el.addClass(this.options.classes),this.$tableLoading.addClass(this.options.classes),this.options.height&&(this.$tableContainer.addClass("fixed-height"),this.options.showFooter&&this.$tableContainer.addClass("has-footer"),this.options.classes.split(" ").includes("table-bordered")&&(this.$tableBody.append('<div class="fixed-table-border"></div>'),this.$tableBorder=this.$tableBody.find(".fixed-table-border"),this.$tableLoading.addClass("fixed-table-border")),this.$tableFooter=this.$container.find(".fixed-table-footer"))},initTable:function(){var e=this,n=[];if(this.$header=this.$el.find(">thead"),this.$header.length?this.options.theadClasses&&this.$header.addClass(this.options.theadClasses):this.$header=t('<thead class="'.concat(this.options.theadClasses,'"></thead>')).appendTo(this.$el),this._headerTrClasses=[],this._headerTrStyles=[],this.$header.find("tr").each(function(i,r){var o=t(r),a=[];o.find("th").each(function(e,n){var i=t(n);void 0!==i.data("field")&&i.data("field","".concat(i.data("field")));var r=Object.assign({},i.data());for(var o in r)t.fn.bootstrapTable.columnDefaults.hasOwnProperty(o)&&delete r[o];a.push(Nl.extend({},{_data:Nl.getRealDataAttr(r),title:i.html(),class:i.attr("class"),titleTooltip:i.attr("title"),rowspan:i.attr("rowspan")?+i.attr("rowspan"):void 0,colspan:i.attr("colspan")?+i.attr("colspan"):void 0,scope:i.attr("scope")?i.attr("scope"):void 0,style:Nl.normalizeStyle(i.attr("style"))},i.data()))}),n.push(a),o.attr("class")&&e._headerTrClasses.push(o.attr("class")),o.attr("style")&&e._headerTrStyles.push(o.attr("style"))}),Array.isArray(this.options.columns[0])||(this.options.columns=[this.options.columns]),this.options.columns=Nl.extend(!0,[],n,this.options.columns),this.columns=[],this.fieldsColumnsIndex=[],!1!==this.optionsColumnsChanged&&Nl.setFieldIndex(this.options.columns),this.options.columns.forEach(function(t,n){t.forEach(function(t,i){var r=Nl.extend({},Ml.COLUMN_DEFAULTS,t,{passed:t});void 0!==r.fieldIndex&&(e.columns[r.fieldIndex]=r,e.fieldsColumnsIndex[r.field]=r.fieldIndex),e.options.columns[n][i]=r})}),!this.options.data.length){var i=Nl.trToData(this.columns,this.$el.find(">tbody>tr").get());i.length&&(this.options.data=i,this.fromHtml=!0)}this.options.pagination&&"server"!==this.options.sidePagination||(this.footerData=Nl.trToData(this.columns,this.$el.find(">tfoot>tr").get())),this.footerData&&this.$el.find("tfoot").html("<tr></tr>"),!this.options.showFooter||this.options.cardView?this.$tableFooter.hide():this.$tableFooter.show()}},zl={};!function(){if(Hl)return zl;Hl=1;var t=pi(),e=Nr().findIndex,n=Vi(),i="findIndex",r=!0;i in[]&&Array(1)[i](function(){r=!1}),t({target:"Array",proto:!0,forced:r},{findIndex:function(t){return e(this,t,arguments.length>1?arguments[1]:void 0)}}),n(i)}();var ql,Wl,Gl,Kl={};function Yl(){if(Wl)return ql;Wl=1;var t=Ft(),e=TypeError;return ql=function(n,i){if(!delete n[i])throw new e("Cannot delete property "+t(i)+" of "+t(n))}}!function(){if(Gl)return Kl;Gl=1;var t=pi(),e=ve(),n=Tn(),i=kn(),r=An(),o=mi(),a=vi(),s=Oi(),l=bi(),c=Yl(),u=Ci()("splice"),h=Math.max,f=Math.min;t({target:"Array",proto:!0,forced:!u},{splice:function(t,u){var d,p,g,v,b,m,y=e(this),w=r(y),S=n(t,w),x=arguments.length;for(0===x?d=p=0:1===x?(d=0,p=w-S):(d=x-2,p=f(h(i(u),0),w-S)),a(w+d-p),g=s(y,p),v=0;v<p;v++)(b=S+v)in y&&l(g,v,y[b]);if(o(g,p),d<p){for(v=S;v<w-p;v++)m=v+d,(b=v+p)in y?y[m]=y[b]:c(y,m);for(v=w;v>w-p+d;v--)c(y,v-1)}else if(d>p)for(v=w-p;v>S;v--)m=v+d-1,(b=v+p-1)in y?y[m]=y[b]:c(y,m);for(v=0;v<d;v++)y[v+S]=arguments[v+2];return o(y,w-p+d),g}})}();var Jl,Ql,Xl,Zl,tc,ec,nc,ic=function(){return r(function t(e){var i=this;n(this,t),this.rows=e.rows,this.scrollEl=e.scrollEl,this.contentEl=e.contentEl,this.callback=e.callback,this.itemHeight=e.itemHeight,this.cache={},this.scrollTop=this.scrollEl.scrollTop,this.initDOM(this.rows,e.fixedScroll),this.scrollEl.scrollTop=this.scrollTop,this.lastCluster=0;var r=function(){i.lastCluster!==(i.lastCluster=i.getNum())&&(i.initDOM(i.rows),i.callback(i.startIndex,i.endIndex))};this.scrollEl.addEventListener("scroll",r,!1),this.destroy=function(){i.contentEl.innerHtml="",i.scrollEl.removeEventListener("scroll",r,!1)}},[{key:"initDOM",value:function(t,e){void 0===this.clusterHeight?(this.cache.scrollTop=this.scrollEl.scrollTop,this.cache.data=this.contentEl.innerHTML=t[0]+t[0]+t[0],this.getRowsHeight(t)):0===this.blockHeight&&this.getRowsHeight(t);var n=this.initData(t,this.getNum(e)),i=n.rows.join(""),r=this.checkChanges("data",i),o=this.checkChanges("top",n.topOffset),a=this.checkChanges("bottom",n.bottomOffset),s=[];r&&o?(n.topOffset&&s.push(this.getExtra("top",n.topOffset)),s.push(i),n.bottomOffset&&s.push(this.getExtra("bottom",n.bottomOffset)),this.startIndex=n.start,this.endIndex=n.end,this.contentEl.innerHTML=s.join(""),e&&(this.contentEl.scrollTop=this.cache.scrollTop)):a&&(this.contentEl.lastChild.style.height="".concat(n.bottomOffset,"px"))}},{key:"getRowsHeight",value:function(){if(void 0===this.itemHeight||0===this.itemHeight){var t=this.contentEl.children,e=t[Math.floor(t.length/2)];this.itemHeight=e.offsetHeight}this.blockHeight=50*this.itemHeight,this.clusterRows=200,this.clusterHeight=4*this.blockHeight}},{key:"getNum",value:function(t){return this.scrollTop=t?this.cache.scrollTop:this.scrollEl.scrollTop,Math.floor(this.scrollTop/(this.clusterHeight-this.blockHeight))||0}},{key:"initData",value:function(t,e){if(t.length<50)return{topOffset:0,bottomOffset:0,rowsAbove:0,rows:t};var n=Math.max((this.clusterRows-50)*e,0),i=n+this.clusterRows,r=Math.max(n*this.itemHeight,0),o=Math.max((t.length-i)*this.itemHeight,0),a=[],s=n;r<1&&s++;for(var l=n;l<i;l++)t[l]&&a.push(t[l]);return{start:n,end:i,topOffset:r,bottomOffset:o,rowsAbove:s,rows:a}}},{key:"checkChanges",value:function(t,e){var n=e!==this.cache[t];return this.cache[t]=e,n}},{key:"getExtra",value:function(t,e){var n=document.createElement("tr");return n.className="virtual-scroll-".concat(t),e&&(n.style.height="".concat(e,"px")),n.outerHTML}}])}(),rc={initBodyEvent:function(){var e=this;this.$body.find("> tr[data-index] > td").off("click dblclick").on("click dblclick",function(n){var i=t(n.currentTarget);if(!(i.find(".detail-icon").length||i.index()-Nl.getDetailViewIndexOffset(e.options)<0)){var r=i.parent(),o=t(n.target).parents(".card-views").children(),a=t(n.target).parents(".card-view"),s=r.data("index"),l=e.data[s],c=e.options.cardView?o.index(a):i[0].cellIndex,u=e.getVisibleFields()[c-Nl.getDetailViewIndexOffset(e.options)],h=e.columns[e.fieldsColumnsIndex[u]],f=Nl.getItemField(l,u,e.options.escape,h.escape);if(e.trigger("click"===n.type?"click-cell":"dbl-click-cell",u,f,l,i),e.trigger("click"===n.type?"click-row":"dbl-click-row",l,r,u),"click"===n.type&&e.options.clickToSelect&&h.clickToSelect&&!Nl.calculateObjectValue(e.options,e.options.ignoreClickToSelectOn,[n.target])){var d=r.find(Nl.sprintf('[name="%s"]',e.options.selectItemName));d.length&&d[0].click()}"click"===n.type&&e.options.detailViewByClick&&e.toggleDetailView(s,e.header.detailFormatters[e.fieldsColumnsIndex[u]])}}).off("mousedown").on("mousedown",function(t){e.multipleSelectRowCtrlKey=t.ctrlKey||t.metaKey,e.multipleSelectRowShiftKey=t.shiftKey}),this.$body.find("> tr[data-index] > td > .detail-icon").off("click").on("click",function(n){return n.preventDefault(),e.toggleDetailView(t(n.currentTarget).parent().parent().data("index")),!1}),this.$selectItem=this.$body.find(Nl.sprintf('[name="%s"]',this.options.selectItemName)),this.$selectItem.off("click").on("click",function(n){n.stopImmediatePropagation();var i=t(n.currentTarget);e._toggleCheck(i.prop("checked"),i.data("index"))}),this.header.events.forEach(function(n,i){var r=n;if(r){if("string"==typeof r&&(r=Nl.calculateObjectValue(null,r)),!r)throw new Error("Unknown event in the scope: ".concat(n));var o=e.header.fields[i],a=e.getVisibleFields().indexOf(o);if(-1!==a){a+=Nl.getDetailViewIndexOffset(e.options);var s=function(n){if(!r.hasOwnProperty(n))return 1;var i=r[n];e.$body.find(">tr:not(.no-records-found)").each(function(r,s){var l=t(s),c=l.find(e.options.cardView?".card-views>.card-view":">td").eq(a),u=n.indexOf(" "),h=n.substring(0,u),f=n.substring(u+1);c.find(f).off(h).on(h,function(t){var n=l.data("index"),r=e.data[n],a=r[o];i.apply(e,[t,a,r,n])})})};for(var l in r)s(l)}}})},initHiddenRows:function(){this.hiddenRows=[]},initRow:function(t,e,n,i){var r=this;if(!(Nl.findIndex(this.hiddenRows,t)>-1)){var o=Nl.calculateObjectValue(this.options,this.options.rowStyle,[t,e],{}),a=Nl.calculateObjectValue(this.options,this.options.rowAttributes,[t,e],{}),s={};if(t._data&&!Nl.isEmptyObject(t._data))for(var h=0,d=Object.entries(t._data);h<d.length;h++){var p=c(d[h],2),g=p[0],v=p[1];if("index"===g)return;s["data-".concat(g)]="object"===f(v)?JSON.stringify(v):v}var b=Nl.h("tr",l(l({id:Array.isArray(t)?void 0:t._id,class:o&&o.classes||(Array.isArray(t)?void 0:t._class),style:o&&o.css||(Array.isArray(t)?void 0:t._style),"data-index":e,"data-uniqueid":Nl.getItemField(t,this.options.uniqueId,!1),"data-has-detail-view":this.options.detailView&&Nl.calculateObjectValue(null,this.options.detailFilter,[e,t])?"true":void 0},a),s)),m=[],y="";Nl.hasDetailViewIcon(this.options)&&(y=Nl.h("td"),Nl.calculateObjectValue(null,this.options.detailFilter,[e,t])&&y.append(Nl.h("a",{class:"detail-icon",href:"#",html:Nl.sprintf(this.constants.html.icon,this.options.iconsPrefix,this.options.icons.detailOpen)}))),y&&"right"!==this.options.detailViewAlign&&m.push(y);var w=this.header.fields.map(function(n,i){var o,a=r.columns[i],s=Nl.getItemField(t,n,r.options.escape,a.escape),l={class:r.header.classes[i]?[r.header.classes[i]]:[],style:r.header.styles[i]?[r.header.styles[i]]:[]},h="card-view card-view-field-".concat(n);if((!r.fromHtml&&!r.autoMergeCells||void 0!==s||a.checkbox||a.radio)&&a.visible&&(!r.options.cardView||a.cardVisible)){for(var f=0,d=["class","style","id","rowspan","colspan","title"];f<d.length;f++){var p=d[f],g=t["_".concat(n,"_").concat(p)];g&&(l[p]?l[p].push(g):l[p]=g)}var v=Nl.calculateObjectValue(r.header,r.header.cellStyles[i],[s,t,e,n],{});if(v.classes&&l.class.push(v.classes),v.css&&l.style.push(v.css),o=Nl.calculateObjectValue(a,r.header.formatters[i],[s,t,e,n],s),a.checkbox||a.radio||(o=null==o?r.options.undefinedText:o),a.searchable&&r.searchText&&r.options.searchHighlight&&!a.checkbox&&!a.radio){var b=r.searchText.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");if(r.options.searchAccentNeutralise&&"string"==typeof o){var m=new RegExp("".concat(Nl.normalizeAccent(b)),"gmi").exec(Nl.normalizeAccent(o));m&&(b=o.substring(m.index,m.index+b.length))}var y=Nl.replaceSearchMark(o,b);o=Nl.calculateObjectValue(a,a.searchHighlightFormatter,[o,r.searchText],y)}if(t["_".concat(n,"_data")]&&!Nl.isEmptyObject(t["_".concat(n,"_data")]))for(var w=0,S=Object.entries(t["_".concat(n,"_data")]);w<S.length;w++){var x=c(S[w],2),O=x[0],C=x[1];if("index"===O)return;l["data-".concat(O)]=C}if(a.checkbox||a.radio){var k=a.checkbox?"checkbox":"radio",T=Nl.isObject(o)&&o.hasOwnProperty("checked")?o.checked:(!0===o||s)&&!1!==o,P=!a.checkboxEnabled||o&&o.disabled,A=r.header.formatters[i]&&("string"==typeof o||Nl.isDomNode(o))?Nl.htmlToNodes(o):[];t[r.header.stateField]=!0===o||!!s||o&&o.checked;var I={"data-index":e,name:r.options.selectItemName,type:k,value:t[r.options.idField],checked:T?"checked":void 0,disabled:P?"disabled":void 0},$=Nl.getCheckboxVdomConfig({inputAttrs:I,formCheckClass:r.constants.classes.formCheck,formCheckInputClass:r.constants.classes.formCheckInput}),E=[Nl.h("input",$.inputAttrs)];$.hasSpan&&E.push(Nl.h("span"));var R=[Nl.h($.wrapperTag,$.wrapperAttrs,E)].concat(u(A));return Nl.h(r.options.cardView?"div":"td",{class:[r.options.cardView?h:"bs-checkbox",a.class],style:r.options.cardView?void 0:l.style},R)}if(r.options.cardView){if(r.options.smartDisplay&&""===o)return Nl.h("div",{class:h});var j=r.options.showHeader?Nl.h("span",{class:["card-view-title",v.classes],style:l.style,html:Nl.getFieldTitle(r.columns,n)}):"";return Nl.h("div",{class:h},[j,Nl.h("span",{class:["card-view-value",v.classes],style:l.style},u(Nl.htmlToNodes(o)))])}return Nl.h("td",l,u(Nl.htmlToNodes(o)))}}).filter(function(t){return t});return m.push.apply(m,u(w)),y&&"right"===this.options.detailViewAlign&&m.push(y),this.options.cardView?b.append(Nl.h("td",{colspan:this.header.fields.length},[Nl.h("div",{class:"card-views"},m)])):b.append.apply(b,m),b}},initBody:function(e,n){var i=this,r=this.getData();this.trigger("pre-body",r),this.$body=this.$el.find(">tbody"),this.$body.length||(this.$body=t("<tbody></tbody>").appendTo(this.$el)),this.options.pagination&&"server"!==this.options.sidePagination||(this.pageFrom=1,this.pageTo=r.length);var o=[],a=t(document.createDocumentFragment()),s=!1,l=[];this.autoMergeCells=Nl.checkAutoMergeCells(r.slice(this.pageFrom-1,this.pageTo));for(var c=this.pageFrom-1;c<this.pageTo;c++){var u=r[c],h=this.initRow(u,c,r,a);if(s=s||!!h,h&&h instanceof Node){var f=this.options.uniqueId,d=[h];if(f&&u.hasOwnProperty(f)){var p=u[f],g=this.$body.find(Nl.sprintf('> tr[data-uniqueid="%s"][data-has-detail-view]',p)).next();g.is("tr.detail-view")&&(l.push(c),n&&p===n||d.push(g[0]))}this.options.virtualScroll?o.push(t("<div>").html(d).html()):a.append(d)}}this.$el.removeAttr("role"),s?this.options.virtualScroll?(this.virtualScroll&&this.virtualScroll.destroy(),this.virtualScroll=new ic({rows:o,fixedScroll:e,scrollEl:this.$tableBody[0],contentEl:this.$body[0],itemHeight:this.options.virtualScrollItemHeight,callback:function(t,e){i.fitHeader(),i.initBodyEvent(),i.trigger("virtual-scroll",t,e)}})):this.$body.html(a):(this.$body.html('<tr class="no-records-found">'.concat(Nl.sprintf('<td colspan="%s">%s</td>',this.getVisibleFields().length+Nl.getDetailViewIndexOffset(this.options),this.options.formatNoMatches()),"</tr>")),this.$el.attr("role","presentation")),l.forEach(function(t){i.expandRow(t)}),e||this.scrollTo(0),this.initBodyEvent(),this.initFooter(),this.resetView(),this.updateSelected(),"server"!==this.options.sidePagination&&(this.options.totalRows=r.length),this.trigger("post-body",r)},resetView:function(t){var e=0;if(t&&t.height&&(this.options.height=t.height),this.$tableContainer.toggleClass("has-card-view",this.options.cardView),this.options.height){var n=this.$tableBody.get(0);this.hasScrollBar=n.scrollWidth>n.clientWidth}if(!this.options.cardView&&this.options.showHeader&&this.options.height?(this.$tableHeader.show(),this.resetHeader(),e+=this.$header.outerHeight(!0)+1):(this.$tableHeader.hide(),this.trigger("post-header")),!this.options.cardView&&this.options.showFooter&&(this.$tableFooter.show(),this.fitFooter(),this.options.height&&(e+=this.$tableFooter.outerHeight(!0))),this.$container.hasClass("fullscreen"))this.$tableContainer.css("height",""),this.$tableContainer.css("width","");else if(this.options.height){this.$tableBorder&&(this.$tableBorder.css("width",""),this.$tableBorder.css("height",""));var i=this.$toolbar.outerHeight(!0),r=this.$pagination.outerHeight(!0),o=this.options.height-i-r,a=this.$tableBody.find(">table"),s=a.outerHeight();if(this.$tableContainer.css("height","".concat(o,"px")),this.$tableBorder&&a.is(":visible")){var l=o-s-2;this.hasScrollBar&&(l-=Nl.getScrollBarWidth()),this.$tableBorder.css("width","".concat(a.outerWidth(),"px")),this.$tableBorder.css("height","".concat(l,"px"))}}this.options.cardView?(this.$el.css("margin-top","0"),this.$tableContainer.css("padding-bottom","0"),this.$tableFooter.hide()):(this.resetCaret(),this.$tableContainer.css("padding-bottom","".concat(e,"px"))),this.trigger("reset-view")},showLoading:function(){this.$tableLoading.toggleClass("open",!0);var t=this.options.loadingFontSize;"auto"===this.options.loadingFontSize&&(t=.04*this.$tableLoading.width(),t=Math.max(12,t),t=Math.min(32,t),t="".concat(t,"px"));var e=this.$tableLoading.find(".loading-wrap");e.length?e.css("font-size",t):this.$tableLoading.css("font-size",t),this.$tableLoading.find(".loading-text").css("font-size",t)},hideLoading:function(){this.$tableLoading.toggleClass("open",!1)},scrollTo:function(e){var n={unit:"px",value:0};"object"===f(e)?n=Object.assign(n,e):"string"==typeof e&&"bottom"===e?n.value=this.$tableBody[0].scrollHeight:"string"!=typeof e&&"number"!=typeof e||(n.value=e);var i=n.value;"rows"===n.unit&&(i=0,this.$body.find("> tr:lt(".concat(n.value,")")).each(function(e,n){i+=t(n).outerHeight(!0)})),this.$tableBody.scrollTop(i)},getScrollPosition:function(){return this.$tableBody.scrollTop()},showRow:function(t){this._toggleRow(t,!0)},hideRow:function(t){this._toggleRow(t,!1)},_toggleRow:function(t,e){var n;if(t.hasOwnProperty("index")?n=this.getData()[t.index]:t.hasOwnProperty("uniqueId")&&(n=this.getRowByUniqueId(t.uniqueId)),n){var i=Nl.findIndex(this.hiddenRows,n);e||-1!==i?e&&i>-1&&this.hiddenRows.splice(i,1):this.hiddenRows.push(n),this.initBody(!0),this.initPagination()}},getHiddenRows:function(t){if(t)return this.initHiddenRows(),this.initBody(!0),void this.initPagination();var e,n=[],i=o(this.getData());try{for(i.s();!(e=i.n()).done;){var r=e.value;this.hiddenRows.includes(r)&&n.push(r)}}catch(t){i.e(t)}finally{i.f()}return this.hiddenRows=n,n},showColumn:function(t){this._toggleColumns(Array.isArray(t)?t:[t],!0,!0)},hideColumn:function(t){this._toggleColumns(Array.isArray(t)?t:[t],!1,!0)},_toggleColumnVisibility:function(t,e){return void 0!==t&&this.columns[t].visible!==e&&(this.columns[t].visible=e,!0)},_updateAfterColumnToggle:function(t,e,n){if(this.initHeader(),this.initSearch(),this.initPagination(),this.initBody(),this.options.showColumns){var i=this.$toolbar.find('.keep-open input:not(".toggle-all")').prop("disabled",!1);if(n){var r,a=o(t);try{for(a.s();!(r=a.n()).done;){var s=r.value;i.filter(Nl.sprintf('[value="%s"]',s)).prop("checked",e)}}catch(t){a.e(t)}finally{a.f()}}i.filter(":checked").length<=this.options.minimumCountColumns&&i.filter(":checked").prop("disabled",!0)}},_toggleColumns:function(t,e,n){if(t.length){var i,r=[],a=o(t);try{for(a.s();!(i=a.n()).done;){var s=i.value,l=this.fieldsColumnsIndex[s];this._toggleColumnVisibility(l,e)&&r.push(l)}}catch(t){a.e(t)}finally{a.f()}r.length&&this._updateAfterColumnToggle(r,e,n)}},showAllColumns:function(){this._toggleAllColumns(!0)},hideAllColumns:function(){this._toggleAllColumns(!1)},_toggleAllColumns:function(e){var n,i=this,r=o(this.columns.slice().reverse());try{for(r.s();!(n=r.n()).done;){var a=n.value;if(a.switchable){if(!e&&this.options.showColumns&&this.getVisibleColumns().filter(function(t){return t.switchable}).length===this.options.minimumCountColumns)continue;a.visible=e}}}catch(t){r.e(t)}finally{r.f()}if(this.initHeader(),this.initSearch(),this.initPagination(),this.initBody(),this.options.showColumns){var s=this.$toolbar.find('.keep-open input[type="checkbox"]:not(".toggle-all")').prop("disabled",!1);e?s.prop("checked",e):s.get().reverse().forEach(function(n){s.filter(":checked").length>i.options.minimumCountColumns&&t(n).prop("checked",e)}),s.filter(":checked").length<=this.options.minimumCountColumns&&s.filter(":checked").prop("disabled",!0)}},mergeCells:function(t){var e,n,i=t.index,r=this.getVisibleFields().indexOf(t.field),o=+t.rowspan||1,a=+t.colspan||1,s=this.$body.find(">tr[data-index]");r+=Nl.getDetailViewIndexOffset(this.options);var l=s.eq(i).find(">td").eq(r);if(!(i<0||r<0||i>=this.data.length)){for(e=i;e<i+o;e++)for(n=r;n<r+a;n++)s.eq(e).find(">td").eq(n).hide();l.attr("rowspan",o).attr("colspan",a).show()}},getVisibleColumns:function(){var t=this;return this.columns.filter(function(e){return e.visible&&!t.isSelectionColumn(e)})},getHiddenColumns:function(){return this.columns.filter(function(t){return!t.visible})}},oc={updateSelected:function(){var e=this.$selectItem.filter(":enabled").length&&this.$selectItem.filter(":enabled").length===this.$selectItem.filter(":enabled").filter(":checked").length;this.$selectAll.add(this.$selectAll_).prop("checked",e),this.$selectItem.each(function(e,n){t(n).closest("tr")[t(n).prop("checked")?"addClass":"removeClass"]("selected")})},isSelectionColumn:function(t){return t.radio||t.checkbox},getSelections:function(){var t=this;return(this.options.maintainMetaData?this.options.data:this.data).filter(function(e){return!0===e[t.header.stateField]})},updateRows:function(){var e=this;this.$selectItem.each(function(n,i){e.data[t(i).data("index")][e.header.stateField]=t(i).prop("checked")})},resetRows:function(){if(this.data.length&&(this.$selectAll.prop("checked",!1),this.$selectItem.prop("checked",!1)),this.header.stateField){var t,e=o(this.data);try{for(e.s();!(t=e.n()).done;){t.value[this.header.stateField]=!1}}catch(t){e.e(t)}finally{e.f()}}this.initHiddenRows()},checkAll:function(){this._toggleCheckAll(!0)},uncheckAll:function(){this._toggleCheckAll(!1)},_toggleCheckAll:function(t){var e=this.getSelections();this.$selectAll.add(this.$selectAll_).prop("checked",t),this.$selectItem.filter(":enabled").prop("checked",t),this.updateRows(),this.updateSelected();var n=this.getSelections();t?this.trigger("check-all",n,e):this.trigger("uncheck-all",n,e)},checkInvert:function(){var e=this.$selectItem.filter(":enabled"),n=e.filter(":checked");e.each(function(e,n){t(n).prop("checked",!t(n).prop("checked"))}),this.updateRows(),this.updateSelected(),this.trigger("uncheck-some",n),n=this.getSelections(),this.trigger("check-some",n)},check:function(t){this._toggleCheck(!0,t)},uncheck:function(t){this._toggleCheck(!1,t)},_toggleCheck:function(t,e){var n=this.$selectItem.filter('[data-index="'.concat(e,'"]')),i=this.data[e];if(n.is(":radio")||this.options.singleSelect||this.options.multipleSelectRow&&!this.multipleSelectRowCtrlKey&&!this.multipleSelectRowShiftKey){var r,a=o(this.options.data);try{for(a.s();!(r=a.n()).done;){r.value[this.header.stateField]=!1}}catch(t){a.e(t)}finally{a.f()}this.$selectItem.filter(":checked").not(n).prop("checked",!1)}if(i[this.header.stateField]=t,this.options.multipleSelectRow){if(this.multipleSelectRowShiftKey&&this.multipleSelectRowLastSelectedIndex>=0)for(var s=c(this.multipleSelectRowLastSelectedIndex<e?[this.multipleSelectRowLastSelectedIndex,e]:[e,this.multipleSelectRowLastSelectedIndex],2),l=s[0],u=s[1],h=l+1;h<u;h++)this.data[h][this.header.stateField]=!0,this.$selectItem.filter('[data-index="'.concat(h,'"]')).prop("checked",!0);this.multipleSelectRowCtrlKey=!1,this.multipleSelectRowShiftKey=!1,this.multipleSelectRowLastSelectedIndex=t?e:-1}n.prop("checked",t),this.updateSelected(),this.trigger(t?"check":"uncheck",this.data[e],n)},checkBy:function(t){this._toggleCheckBy(!0,t)},uncheckBy:function(t){this._toggleCheckBy(!1,t)},_toggleCheckBy:function(t,e){var n=this;if(e.hasOwnProperty("field")&&e.hasOwnProperty("values")){var i=[];this.data.forEach(function(r,o){if(!r.hasOwnProperty(e.field))return!1;if(e.values.includes(r[e.field])){var a=n.$selectItem.filter(":enabled").filter(Nl.sprintf('[data-index="%s"]',o)),s=!!e.hasOwnProperty("onlyCurrentPage")&&e.onlyCurrentPage;if(!(a=t?a.not(":checked"):a.filter(":checked")).length&&s)return;a.prop("checked",t),r[n.header.stateField]=t,i.push(r),n.trigger(t?"check":"uncheck",r,a)}}),this.updateSelected(),this.trigger(t?"check-some":"uncheck-some",i)}}},ac={};!function(){if(nc)return ac;nc=1;var t=pi(),e=xt(),n=Dt(),i=ve(),r=An(),o=Yl(),a=sr(),s=A(),l=Al(),c=zo(),u=function(){if(Ql)return Jl;Ql=1;var t=Rt().match(/firefox\/(\d+)/i);return Jl=!!t&&+t[1]}(),h=function(){if(Zl)return Xl;Zl=1;var t=Rt();return Xl=/MSIE|Trident/.test(t)}(),f=jt(),d=function(){if(ec)return tc;ec=1;var t=Rt().match(/AppleWebKit\/(\d+)\./);return tc=!!t&&+t[1]}(),p=[],g=e(p.sort),v=e(p.push),b=s(function(){p.sort(void 0)}),m=s(function(){p.sort(null)}),y=c("sort"),w=!s(function(){if(f)return f<70;if(!(u&&u>3)){if(h)return!0;if(d)return d<603;var t,e,n,i,r="";for(t=65;t<76;t++){switch(e=String.fromCharCode(t),t){case 66:case 69:case 70:case 72:n=3;break;case 68:case 71:n=4;break;default:n=2}for(i=0;i<47;i++)p.push({k:e+i,v:n})}for(p.sort(function(t,e){return e.v-t.v}),i=0;i<p.length;i++)e=p[i].k.charAt(0),r.charAt(r.length-1)!==e&&(r+=e);return"DGBEFHACIJK"!==r}});t({target:"Array",proto:!0,forced:b||!m||!y||!w},{sort:function(t){void 0!==t&&n(t);var e=i(this);if(w)return void 0===t?g(e):g(e,t);var s,c,u=[],h=r(e);for(c=0;c<h;c++)c in e&&v(u,e[c]);for(l(u,function(t){return function(e,n){if(void 0===n)return-1;if(void 0===e)return 1;if(void 0!==t)return+t(e,n)||0;var i=a(e),r=a(n);return i===r?0:i>r?1:-1}}(t)),s=r(u),c=0;c<s;)e[c]=u[c++];for(;c<h;)o(e,c++);return e}})}();var sc,lc,cc,uc,hc,fc={};function dc(){if(lc)return sc;lc=1;var t=m();return sc=t}function pc(){if(uc)return cc;uc=1;var t=xt();return cc=t(1.1.valueOf)}!function(){if(hc)return fc;hc=1;var t=pi(),e=fe(),n=I(),i=m(),r=dc(),o=xt(),a=di(),s=be(),l=fs(),c=Et(),u=Lt(),h=we(),f=A(),d=Rn().f,p=Ce().f,g=Ne().f,v=pc(),b=Eo().trim,y="Number",w=i[y],S=r[y],x=w.prototype,O=i.TypeError,C=o("".slice),k=o("".charCodeAt),T=function(t){var e,n,i,r,o,a,s,l,c=h(t,"number");if(u(c))throw new O("Cannot convert a Symbol value to a number");if("string"==typeof c&&c.length>2)if(c=b(c),43===(e=k(c,0))||45===e){if(88===(n=k(c,2))||120===n)return NaN}else if(48===e){switch(k(c,1)){case 66:case 98:i=2,r=49;break;case 79:case 111:i=8,r=55;break;default:return+c}for(a=(o=C(c,2)).length,s=0;s<a;s++)if((l=k(o,s))<48||l>r)return NaN;return parseInt(o,i)}return+c},P=a(y,!w(" 0o1")||!w("0b1")||w("+0x1")),$=function(t){var e,n=arguments.length<1?0:w(function(t){var e=h(t,"number");return"bigint"==typeof e?e:T(e)}(t));return c(x,e=this)&&f(function(){v(e)})?l(Object(n),this,$):n};$.prototype=x,P&&!e&&(x.constructor=$),t({global:!0,constructor:!0,wrap:!0,forced:P},{Number:$});var E=function(t,e){for(var i,r=n?d(e):"MAX_VALUE,MIN_VALUE,NaN,NEGATIVE_INFINITY,POSITIVE_INFINITY,EPSILON,MAX_SAFE_INTEGER,MIN_SAFE_INTEGER,isFinite,isInteger,isNaN,isSafeInteger,parseFloat,parseInt,fromString,range".split(","),o=0;r.length>o;o++)s(e,i=r[o])&&!s(t,i)&&g(t,i,p(e,i))};e&&S&&E(r[y],S),(P||e)&&E(r[y],w)}();var gc={initServer:function(e,n){var i=this,r={},a=this.header.fields.indexOf(this.options.sortName),s={searchText:this.searchText,sortName:this.options.sortName,sortOrder:this.options.sortOrder};if(this.header.sortNames[a]&&(s.sortName=this.header.sortNames[a]),this.options.pagination&&"server"===this.options.sidePagination&&(s.pageSize=this.options.pageSize===this.options.formatAllRows()?this.options.totalRows:this.options.pageSize,s.pageNumber=this.options.pageNumber),this.options.url||this.options.ajax){if("limit"===this.options.queryParamsType&&(s={search:s.searchText,sort:s.sortName,order:s.sortOrder},this.options.pagination&&"server"===this.options.sidePagination&&(s.offset=this.options.pageSize===this.options.formatAllRows()?0:this.options.pageSize*(this.options.pageNumber-1),s.limit=this.options.pageSize,0!==s.limit&&this.options.pageSize!==this.options.formatAllRows()||delete s.limit)),this.options.search&&"server"===this.options.sidePagination&&this.options.searchable&&this.columns.filter(function(t){return t.searchable}).length){s.searchable=[];var l,c=o(this.columns);try{for(c.s();!(l=c.n()).done;){var u=l.value;!u.checkbox&&u.searchable&&(this.options.visibleSearch&&u.visible||!this.options.visibleSearch)&&s.searchable.push(u.field)}}catch(t){c.e(t)}finally{c.f()}}if(Nl.isEmptyObject(this.filterColumnsPartial)||(s.filter=JSON.stringify(this.filterColumnsPartial,null)),Nl.extend(s,n||{}),!1!==(r=Nl.calculateObjectValue(this.options,this.options.queryParams,[s],r))){e||this.showLoading();var h=Nl.extend({},Nl.calculateObjectValue(null,this.options.ajaxOptions),{type:this.options.method,url:this.options.url,data:"application/json"===this.options.contentType&&"post"===this.options.method?JSON.stringify(r):r,cache:this.options.cache,contentType:this.options.contentType,dataType:this.options.dataType,success:function(t,n,r){var o=Nl.calculateObjectValue(i.options,i.options.responseHandler,[t,r],t);"client"===i.options.sidePagination&&i.options.paginationLoadMore&&(i._paginationLoaded=i.data.length===o.length),i.load(o),i.trigger("load-success",o,r&&r.status,r),e||i.hideLoading(),"server"===i.options.sidePagination&&i.options.pageNumber>1&&o[i.options.totalField]>0&&!o[i.options.dataField].length&&i.updatePagination()},error:function(t){if(t&&0===t.status&&i._xhrAbort)i._xhrAbort=!1;else{var n=[];"server"===i.options.sidePagination&&((n={})[i.options.totalField]=0,n[i.options.dataField]=[]),i.load(n),i.trigger("load-error",t&&t.status,t),e||i.hideLoading()}}});return this.options.ajax?Nl.calculateObjectValue(this,this.options.ajax,[h],null):(this._xhr&&4!==this._xhr.readyState&&(this._xhrAbort=!0,this._xhr.abort()),this._xhr=t.ajax(h)),r}}},initData:function(t,e){"append"===e?this.options.data=this.options.data.concat(t):"prepend"===e?this.options.data=[].concat(t).concat(this.options.data):(t=t||Nl.deepCopy(this.options.data),this.options.data=Array.isArray(t)?t:t[this.options.dataField]),this.data=u(this.options.data),this.options.sortReset&&(this.unsortedData=u(this.data)),"server"!==this.options.sidePagination&&this.initSort()},initSort:function(){var t=this,e=this.options.sortName,n="desc"===this.options.sortOrder?-1:1,i=this.header.fields.indexOf(this.options.sortName);-1!==i?(this.options.sortStable&&this.data.forEach(function(t,e){t.hasOwnProperty("_position")||(t._position=e)}),Nl.hasRowspanCells(this.data)&&Nl.flattenRowspanCells(this.data),this.options.customSort?Nl.calculateObjectValue(this.options,this.options.customSort,[this.options.sortName,this.options.sortOrder,this.data]):this.data.sort(function(r,o){t.header.sortNames[i]&&(e=t.header.sortNames[i]);var a=Nl.getItemField(r,e,t.options.escape),s=Nl.getItemField(o,e,t.options.escape),l=Nl.calculateObjectValue(t.header,t.header.sorters[i],[a,s,r,o]);return void 0!==l?t.options.sortStable&&0===l?n*(r._position-o._position):n*l:Nl.sort(a,s,n,t.options,r._position,o._position)}),void 0!==this.options.sortClass&&setTimeout(function(){t.$el.removeClass(t.options.sortClass);var e=t.$header.find('[data-field="'.concat(t.options.sortName,'"]')).index();t.$el.find("tr td:nth-child(".concat(e+1,")")).addClass(t.options.sortClass)},250)):this.options.sortReset&&(this.data=u(this.unsortedData))},onSort:function(e){var n=e.type,i=e.currentTarget,r="keypress"===n?t(i):t(i).parent(),o=this.$header.find("th").eq(r.index());if(this.$header.add(this.$header_).find("span.order").remove(),this.options.sortName===r.data("field")){var a=this.options.sortOrder,s=this.columns[this.fieldsColumnsIndex[r.data("field")]].sortOrder||this.columns[this.fieldsColumnsIndex[r.data("field")]].order;void 0===a?this.options.sortOrder="asc":"asc"===a?this.options.sortOrder=this.options.sortReset?"asc"===s?"desc":void 0:"desc":"desc"===this.options.sortOrder&&(this.options.sortOrder=this.options.sortReset?"desc"===s?"asc":void 0:"asc"),void 0===this.options.sortOrder&&(this.options.sortName=void 0)}else this.options.sortName=r.data("field"),this.options.rememberOrder?this.options.sortOrder="asc"===r.data("order")?"desc":"asc":this.options.sortOrder=this.columns[this.fieldsColumnsIndex[r.data("field")]].sortOrder||this.columns[this.fieldsColumnsIndex[r.data("field")]].order;r.add(o).data("order",this.options.sortOrder),this.resetCaret(),this._sort()},_sort:function(){if("server"===this.options.sidePagination&&this.options.serverSort)return this.options.pageNumber=1,this.trigger("sort",this.options.sortName,this.options.sortOrder),void this.initServer(this.options.silentSort);this.options.pagination&&this.options.sortResetPage&&(this.options.pageNumber=1,this.initPagination()),this.trigger("sort",this.options.sortName,this.options.sortOrder),this.initSort(),this.initBody()},sortReset:function(){this.options.sortName=void 0,this.options.sortOrder=void 0,this._sort()},sortBy:function(t){this.options.sortName=t.field,this.options.sortOrder=t.hasOwnProperty("sortOrder")?t.sortOrder:"asc",this._sort()},getData:function(t){var e=this,n=this.options.data;if(!(this.searchText||this.options.customSearch||void 0!==this.options.sortName||this.enableCustomSort)&&Nl.isEmptyObject(this.filterColumns)&&"function"!=typeof this.options.filterOptions.filterAlgorithm&&Nl.isEmptyObject(this.filterColumnsPartial)||t&&t.unfiltered||(n=this.data),t&&!t.includeHiddenRows){var i=this.getHiddenRows();n=n.filter(function(t){return-1===Nl.findIndex(i,t)})}return t&&t.useCurrentPage&&(n=n.slice(this.pageFrom-1,this.pageTo)),t&&t.formatted?n.map(function(t){for(var n={},i=0,r=Object.entries(t);i<r.length;i++){var o=c(r[i],2),a=o[0],s=o[1],l=e.columns[e.fieldsColumnsIndex[a]];l&&(n[a]=Nl.calculateObjectValue(l,e.header.formatters[l.fieldIndex],[s,t,t.index,l.field],s))}return n}):n},getFooterData:function(){var t;return null!==(t=this.footerData)&&void 0!==t?t:[]},load:function(t){var e=t;this.options.pagination&&"server"===this.options.sidePagination&&(this.options.totalRows=e[this.options.totalField],this.options.totalNotFiltered=e[this.options.totalNotFilteredField],this.footerData=e[this.options.footerField]?[e[this.options.footerField]]:void 0);var n=this.options.fixedScroll||e.fixedScroll;e=Array.isArray(e)?e:e[this.options.dataField],this.initData(e),this.initSearch(),this.initPagination(),this.initBody(n)},append:function(t){this.initData(t,"append"),this.initSearch(),this.initPagination(),this.initSort(),this.initBody(!0)},prepend:function(t){this.initData(t,"prepend"),this.initSearch(),this.initPagination(),this.initSort(),this.initBody(!0)},remove:function(t){for(var e=0,n=this.options.data.length-1;n>=0;n--){var i=this.options.data[n],r=Nl.getItemField(i,t.field,this.options.escape,i.escape);void 0===r&&"$index"!==t.field||(!i.hasOwnProperty(t.field)&&"$index"===t.field&&t.values.includes(n)||t.values.includes(r))&&(e++,this.options.data.splice(n,1))}e&&("server"===this.options.sidePagination&&(this.options.totalRows-=e,this.data=u(this.options.data)),this.initSearch(),this.initPagination(),this.initSort(),this.initBody(!0))},removeAll:function(){this.options.data.length>0&&(this.data.splice(0,this.data.length),this.options.data.splice(0,this.options.data.length),this.initSearch(),this.initPagination(),this.initBody(!0))},insertRow:function(t){if(t.hasOwnProperty("index")&&t.hasOwnProperty("row")){var e=this.data[t.index],n=this.options.data.indexOf(e);-1!==n?(this.data.splice(t.index,0,t.row),this.options.data.splice(n,0,t.row),this.initSearch(),this.initPagination(),this.initSort(),this.initBody(!0)):this.append([t.row])}},updateRow:function(t){var e,n=o(Array.isArray(t)?t:[t]);try{for(n.s();!(e=n.n()).done;){var i=e.value;if(i.hasOwnProperty("index")&&i.hasOwnProperty("row")){var r=this.data[i.index],a=this.options.data.indexOf(r);i.hasOwnProperty("replace")&&i.replace?(this.data[i.index]=i.row,this.options.data[a]=i.row):(Nl.extend(this.data[i.index],i.row),Nl.extend(this.options.data[a],i.row))}}}catch(t){n.e(t)}finally{n.f()}this.initSearch(),this.initPagination(),this.initSort(),this.initBody(!0)},getRowByUniqueId:function(t){var e,n,i=this.options.uniqueId,r=t,o=null;for(e=this.options.data.length-1;e>=0;e--){n=this.options.data[e];var a=Nl.getItemField(n,i,this.options.escape,n.escape);if(void 0!==a&&("string"==typeof a?r=t.toString():"number"==typeof a&&(Number(a)===a&&a%1==0?r=parseInt(t,10):a===Number(a)&&0!==a&&(r=parseFloat(t))),a===r)){o=n;break}}return o},updateByUniqueId:function(t){var e,n=null,i=o(Array.isArray(t)?t:[t]);try{for(i.s();!(e=i.n()).done;){var r=e.value;if(r.hasOwnProperty("id")&&r.hasOwnProperty("row")){var a=this.options.data.indexOf(this.getRowByUniqueId(r.id));-1!==a&&(r.hasOwnProperty("replace")&&r.replace?this.options.data[a]=r.row:Nl.extend(this.options.data[a],r.row),n=r.id)}}}catch(t){i.e(t)}finally{i.f()}this.initSearch(),this.initPagination(),this.initSort(),this.initBody(!0,n)},removeByUniqueId:function(t){var e=this.options.data.length,n=this.getRowByUniqueId(t);n&&this.options.data.splice(this.options.data.indexOf(n),1),e!==this.options.data.length&&("server"===this.options.sidePagination&&(this.options.totalRows-=1,this.data=u(this.options.data)),this.initSearch(),this.initPagination(),this.initBody(!0))},_updateCellOnly:function(e,n){if(-1!==n){var i=this.initRow(this.data[n],n),r=this.getVisibleFields().indexOf(e);-1!==r&&(r+=Nl.getDetailViewIndexOffset(this.options),this.$body.find(">tr[data-index=".concat(n,"]")).find(">td:eq(".concat(r,")")).replaceWith(t(i).find(">td:eq(".concat(r,")"))),this.initBodyEvent(),this.initFooter(),this.resetView(),this.updateSelected())}},updateCell:function(t){if(t.hasOwnProperty("index")&&t.hasOwnProperty("field")&&t.hasOwnProperty("value")){var e=this.data[t.index],n=this.options.data.indexOf(e);this.data[t.index][t.field]=t.value,this.options.data[n][t.field]=t.value,!1!==t.reinit?(this.initSort(),this.initBody(!0)):this._updateCellOnly(t.field,t.index)}},updateCellByUniqueId:function(t){var e=this;(Array.isArray(t)?t:[t]).forEach(function(t){var n=t.id,i=t.field,r=t.value,o=e.getRowByUniqueId(n),a=e.data.indexOf(o),s=e.options.data.indexOf(o);o&&-1!==a&&(e.data[a][i]=r,e.options.data[s][i]=r)}),!1!==t.reinit?(this.initSort(),this.initBody(!0)):this._updateCellOnly(t.field,this.data.indexOf(this.getRowByUniqueId(t.id)))}},vc={toggleDetailView:function(t,e){this.$body.find(Nl.sprintf('> tr[data-index="%s"]',t)).next().is("tr.detail-view")?this.collapseRow(t):this.expandRow(t,e),this.resetView()},expandRow:function(t,e){var n=this.data[t],i=this.$body.find(Nl.sprintf('> tr[data-index="%s"][data-has-detail-view]',t));if(this.options.detailViewIcon&&i.find("a.detail-icon").html(Nl.sprintf(this.constants.html.icon,this.options.iconsPrefix,this.options.icons.detailClose)),!i.next().is("tr.detail-view")){i.after(Nl.sprintf('<tr class="detail-view"><td colspan="%s"></td></tr>',i.children("td").length));var r=i.next().find("td"),o=e||this.options.detailFormatter,a=Nl.calculateObjectValue(this.options,o,[t,n,r],"");1===r.length&&r.append(a),this.trigger("expand-row",t,n,r)}},expandRowByUniqueId:function(t){var e=this.getRowByUniqueId(t);e&&this.expandRow(this.data.indexOf(e))},collapseRow:function(t){var e=this.data[t],n=this.$body.find(Nl.sprintf('> tr[data-index="%s"][data-has-detail-view]',t));n.next().is("tr.detail-view")&&(this.options.detailViewIcon&&n.find("a.detail-icon").html(Nl.sprintf(this.constants.html.icon,this.options.iconsPrefix,this.options.icons.detailOpen)),this.trigger("collapse-row",t,e,n.next()),n.next().remove())},collapseRowByUniqueId:function(t){var e=this.getRowByUniqueId(t);e&&this.collapseRow(this.data.indexOf(e))},expandAllRows:function(){for(var e=this.$body.find("> tr[data-index][data-has-detail-view]"),n=0;n<e.length;n++)this.expandRow(t(e[n]).data("index"))},collapseAllRows:function(){for(var e=this.$body.find("> tr[data-index][data-has-detail-view]"),n=0;n<e.length;n++)this.collapseRow(t(e[n]).data("index"))}},bc={initHeader:function(){var e=this,n={},i=[];this.header={fields:[],styles:[],classes:[],formatters:[],detailFormatters:[],events:[],sorters:[],sortNames:[],cellStyles:[],searchables:[]},Nl.updateFieldGroup(this.options.columns,this.columns),this.options.columns.forEach(function(t,r){var o=[];o.push("<tr".concat(Nl.sprintf(' class="%s"',e._headerTrClasses[r])," ").concat(Nl.sprintf(' style="%s"',e._headerTrStyles[r]),">"));var a="";if(0===r&&Nl.hasDetailViewIcon(e.options)){var s=e.options.columns.length>1?' rowspan="'.concat(e.options.columns.length,'"'):"";a='<th class="detail"'.concat(s,'>\n          <div class="fht-cell"></div>\n          </th>')}a&&"right"!==e.options.detailViewAlign&&o.push(a),t.forEach(function(t,i){var a=Nl.sprintf(' class="%s"',t.class),s=t.widthUnit,l=parseFloat(t.width),u=t.halign?t.halign:t.align,h=Nl.sprintf("text-align: %s; ",u),d=Nl.sprintf("text-align: %s; ",t.align),p=Nl.sprintf("vertical-align: %s; ",t.valign);if(p+=Nl.sprintf("width: %s; ",!t.checkbox&&!t.radio||l?l?l+s:void 0:t.showSelectTitle?void 0:"36px"),void 0!==t.fieldIndex||t.visible){var g=Nl.calculateObjectValue(null,e.options.headerStyle,[t]),v=[],b=[],m="";if(g&&g.css)for(var y=0,w=Object.entries(g.css);y<w.length;y++){var S=c(w[y],2),x=S[0],O=S[1];v.push("".concat(x,": ").concat(O))}if(g&&g.classes&&(m=Nl.sprintf(' class="%s"',t.class?[t.class,g.classes].join(" "):g.classes)),void 0!==t.fieldIndex){if(e.header.fields[t.fieldIndex]=t.field,e.header.styles[t.fieldIndex]=d+p,e.header.classes[t.fieldIndex]=t.class,e.header.formatters[t.fieldIndex]=t.formatter,e.header.detailFormatters[t.fieldIndex]=t.detailFormatter,e.header.events[t.fieldIndex]=t.events,e.header.sorters[t.fieldIndex]=t.sorter,e.header.sortNames[t.fieldIndex]=t.sortName,e.header.cellStyles[t.fieldIndex]=t.cellStyle,e.header.searchables[t.fieldIndex]=t.searchable,!t.visible)return;if(e.options.cardView&&!t.cardVisible)return;n[t.field]=t}if(Object.keys(t._data||{}).length>0)for(var C=0,k=Object.entries(t._data);C<k.length;C++){var T=c(k[C],2),P=T[0],A=T[1];b.push("data-".concat(P,"='").concat("object"===f(A)?JSON.stringify(A):A,"'"))}o.push("<th".concat(Nl.sprintf(' title="%s"',t.titleTooltip)),t.checkbox||t.radio?Nl.sprintf(' class="bs-checkbox %s"',t.class||""):m||a,Nl.sprintf(' style="%s"',(t.style||"")+h+p+v.join("; ")||void 0),Nl.sprintf(' rowspan="%s"',t.rowspan),Nl.sprintf(' colspan="%s"',t.colspan),Nl.sprintf(' scope="%s"',t.scope),Nl.sprintf(' data-field="%s"',t.field),0===i&&r>0?" data-not-first-th":"",b.length>0?b.join(" "):"",">"),o.push(Nl.sprintf('<div class="th-inner %s">',e.options.sortable&&t.sortable?"sortable".concat("center"===u?" sortable-center":""," both"):""));var I=e.options.escape&&e.options.escapeTitle?Nl.escapeHTML(t.title):t.title,$=I;t.checkbox&&(I="",!e.options.singleSelect&&e.options.checkboxHeader&&(I=Nl.getCheckboxHtml({name:"btSelectAll",centered:!0,withLabel:!1})),e.header.stateField=t.field),t.radio&&(I="",e.header.stateField=t.field),!I&&t.showSelectTitle&&(I+=$),o.push(I),o.push("</div>"),o.push('<div class="fht-cell"></div>'),o.push("</div>"),o.push("</th>")}}),a&&"right"===e.options.detailViewAlign&&o.push(a),o.push("</tr>"),o.length>3&&i.push(o.join(""))}),this.$header.html(i.join("")),this.$header.find("th[data-field]").each(function(e,i){t(i).data(n[t(i).data("field")])}),this.$container.off("click",".th-inner").on("click",".th-inner",function(n){var i=t(n.currentTarget);if(e.options.detailView&&!i.parent().hasClass("bs-checkbox")&&i.closest(".bootstrap-table")[0]!==e.$container[0])return!1;e.options.sortable&&i.parent().data().sortable&&e.onSort(n)});var r=Nl.getEventName("resize.bootstrap-table",this.$el.attr("id"));t(window).off(r),!this.options.showHeader||this.options.cardView?(this.$header.hide(),this.$tableHeader.hide(),this.$tableLoading.css("top",0)):(this.$header.show(),this.$tableHeader.show(),this.$tableLoading.css("top",this.$header.outerHeight()+1),this.resetCaret(),t(window).on(r,function(){return e.resetView()})),this.$selectAll=this.$header.find('[name="btSelectAll"]'),this.$selectAll.off("click").on("click",function(n){n.stopPropagation();var i=t(n.currentTarget).prop("checked");e[i?"checkAll":"uncheckAll"](),e.updateSelected()})},getVisibleFields:function(){var t,e=[],n=o(this.header.fields);try{for(n.s();!(t=n.n()).done;){var i=t.value,r=this.columns[this.fieldsColumnsIndex[i]];r&&r.visible&&(!this.options.cardView||r.cardVisible)&&e.push(i)}}catch(t){n.e(t)}finally{n.f()}return e},resetHeader:function(){var t=this;this._setDelayTimeout("header",function(){return t.fitHeader()},this.$el.is(":hidden")?100:0)},fitHeader:function(){var e=this;if(this.$el.is(":hidden"))this._setDelayTimeout("header",function(){return e.fitHeader()},100);else{var n=this.$tableBody.get(0),i=this.hasScrollBar&&n.scrollHeight>n.clientHeight+this.$header.outerHeight()?Nl.getScrollBarWidth():0;this.$el.css("margin-top",-this.$header.outerHeight());var r=this.$tableHeader.find(":focus");if(r.length>0){var o=r.parents("th");if(o.length>0){var a=o.attr("data-field");if(void 0!==a){var s=this.$header.find("[data-field='".concat(a,"']"));s.length>0&&s.find(":input").addClass("focus-temp")}}}this.$header_=this.$header.clone(!0,!0),this.$selectAll_=this.$header_.find('[name="btSelectAll"]');var l=this.$el.find("caption"),c=this.$tableHeader.css("margin-right",i).find("table").css("width",this.$el.outerWidth()).html("").attr("class",this.$el.attr("class"));l.length>0&&c.append(l.clone(!0,!0)),c.append(this.$header_),this.$tableLoading.css("width",this.$el.outerWidth());var u=t(".focus-temp:visible:eq(0)");u.length>0&&(u.focus(),this.$header.find(".focus-temp").removeClass("focus-temp")),this.$header.find("th[data-field]").each(function(n,i){e.$header_.find(Nl.sprintf('th[data-field="%s"]',t(i).data("field"))).data(t(i).data())});for(var h=this.getVisibleFields(),f=this.$header_.find("th"),d=this.$body.find(">tr:not(.no-records-found,.virtual-scroll-top)").eq(0);d.length&&d.find('>td[colspan]:not([colspan="1"])').length;)d=d.next();var p=d.find("> *").length;d.find("> *").each(function(n,i){var r=t(i);if(Nl.hasDetailViewIcon(e.options)&&(0===n&&"right"!==e.options.detailViewAlign||n===p-1&&"right"===e.options.detailViewAlign)){var o=f.filter(".detail"),a=o.innerWidth()-o.find(".fht-cell").width();o.find(".fht-cell").width(r.innerWidth()-a)}else{var s=n-Nl.getDetailViewIndexOffset(e.options),l=e.$header_.find(Nl.sprintf('th[data-field="%s"]',h[s]));l.length>1&&(l=t(f[r[0].cellIndex]));var c=l.innerWidth()-l.find(".fht-cell").width();l.find(".fht-cell").width(r.innerWidth()-c)}}),this.horizontalScroll(),this.trigger("post-header")}},resetCaret:function(){var e=this.options,n=e.sortName,i=e.sortOrder,r="asc"===i?"ascending":"descending";this.$header.find("th").each(function(e,o){var a=t(o).data("field")===n;t(o).attr("aria-sort",a?r:null).find(".sortable").removeClass("desc asc").addClass(a?i:"both")})},initFooter:function(){if(this.options.showFooter&&!this.options.cardView){var t=this.getData(),e=[],n="";Nl.hasDetailViewIcon(this.options)&&(n=Nl.h("th",{class:"detail"},[Nl.h("div",{class:"th-inner"}),Nl.h("div",{class:"fht-cell"})])),n&&"right"!==this.options.detailViewAlign&&e.push(n);var i,r=o(this.columns);try{for(r.s();!(i=r.n()).done;){var a=i.value,s=this.footerData&&this.footerData.length>0;if(a.visible&&(!s||a.field in this.footerData[0])){if(this.options.cardView&&!a.cardVisible)return;var c=Nl.calculateObjectValue(null,a.footerStyle||this.options.footerStyle,[a]),h=c&&c.css||{},f=s&&this.footerData[0]["_".concat(a.field,"_colspan")]||0,d=s&&this.footerData[0][a.field]||"";d=Nl.calculateObjectValue(a,a.footerFormatter,[t,d],d),e.push(Nl.h("th",{class:[a.class,c&&c.classes],style:l({"text-align":a.falign?a.falign:a.align,"vertical-align":a.valign},h),colspan:f||void 0},[Nl.h("div",{class:"th-inner"},u(Nl.htmlToNodes(d))),Nl.h("div",{class:"fht-cell"})]))}}}catch(t){r.e(t)}finally{r.f()}n&&"right"===this.options.detailViewAlign&&e.push(n),this.options.height||this.$tableFooter.length||(this.$el.append("<tfoot><tr></tr></tfoot>"),this.$tableFooter=this.$el.find("tfoot")),this.$tableFooter.find("tr").length||this.$tableFooter.html("<table><thead><tr></tr></thead></table>"),this.$tableFooter.find("tr").html(e),this.trigger("post-footer",this.$tableFooter)}},fitFooter:function(){var e=this;if(this.$el.is(":hidden"))this._setDelayTimeout("footer",function(){return e.fitFooter()},100);else{var n=this.$tableBody.get(0),i=this.hasScrollBar&&n.scrollHeight>n.clientHeight+this.$header.outerHeight()?Nl.getScrollBarWidth():0;this.$tableFooter.css("margin-right",i).find("table").css("width",this.$el.outerWidth()).attr("class",this.$el.attr("class"));var r=this.$tableFooter.find("th"),o=this.$body.find(">tr:first-child:not(.no-records-found)");for(r.find(".fht-cell").width("auto");o.length&&o.find('>td[colspan]:not([colspan="1"])').length;)o=o.next();var a=o.find("> *").length;o.find("> *").each(function(n,i){var o=t(i);if(Nl.hasDetailViewIcon(e.options)&&(0===n&&"left"===e.options.detailViewAlign||n===a-1&&"right"===e.options.detailViewAlign)){var s=r.filter(".detail"),l=s.innerWidth()-s.find(".fht-cell").width();s.find(".fht-cell").width(o.innerWidth()-l)}else{var c=r.eq(n),u=c.innerWidth()-c.find(".fht-cell").width();c.find(".fht-cell").width(o.innerWidth()-u)}}),this.horizontalScroll()}},horizontalScroll:function(){var t=this;this.$tableBody.off("scroll").on("scroll",function(){var e=t.$tableBody.scrollLeft();t.options.showHeader&&t.options.height&&t.$tableHeader.scrollLeft(e),t.options.showFooter&&!t.options.cardView&&t.$tableFooter.scrollLeft(e),t.trigger("scroll-body",t.$tableBody)})},updateColumnTitle:function(e){e.hasOwnProperty("field")&&e.hasOwnProperty("title")&&(this.columns[this.fieldsColumnsIndex[e.field]].title=this.options.escape&&this.options.escapeTitle?Nl.escapeHTML(e.title):e.title,this.columns[this.fieldsColumnsIndex[e.field]].visible&&(this.$header.find("th[data-field]").each(function(n,i){if(t(i).data("field")===e.field)return t(t(i).find(".th-inner")[0]).html(e.title),!1}),this.resetView()))}},mc={initPagination:function(){var t=this,e=this.options;if(e.pagination){this.$pagination.show();var n,i,r,o,a,s,l,c=[],u=!1,h=this.getData({includeHiddenRows:!1}),f=e.pageList;if("string"==typeof f&&(f=f.replace(/\[|\]| /g,"").toLowerCase().split(",")),f=f.map(function(t){return"string"==typeof t?t.toLowerCase()===e.formatAllRows().toLowerCase()||["all","unlimited"].includes(t.toLowerCase())?e.formatAllRows():+t:t}),this.paginationParts=e.paginationParts,"string"==typeof this.paginationParts&&(this.paginationParts=this.paginationParts.replace(/\[|\]| |'/g,"").split(",")),"server"!==e.sidePagination&&(e.totalRows=h.length),this.totalPages=0,e.pageSize<=0&&(console.warn("pageSize must be a positive number, falling back to show all rows."),e.pageSize=e.totalRows||1,u=!0),e.totalRows&&(e.pageSize===e.formatAllRows()&&(e.pageSize=e.totalRows,u=!0),this.totalPages=1+~~((e.totalRows-1)/e.pageSize),e.totalPages=this.totalPages),this.totalPages>0&&e.pageNumber>this.totalPages&&(e.pageNumber=this.totalPages),this.pageFrom=(e.pageNumber-1)*e.pageSize+1,this.pageTo=e.pageNumber*e.pageSize,this.pageTo>e.totalRows&&(this.pageTo=e.totalRows),this.options.pagination&&"server"!==this.options.sidePagination&&(this.options.totalNotFiltered=this.options.data.length),this.options.showExtendedPagination||(this.options.totalNotFiltered=void 0),(this.paginationParts.includes("pageInfo")||this.paginationParts.includes("pageInfoShort")||this.paginationParts.includes("pageSize"))&&c.push('<div class="'.concat(this.constants.classes.pull,"-").concat(e.paginationDetailHAlign,' pagination-detail">')),this.paginationParts.includes("pageInfo")||this.paginationParts.includes("pageInfoShort")){var d=this.options.totalRows;"client"===this.options.sidePagination&&this.options.paginationLoadMore&&!this._paginationLoaded&&this.totalPages>1&&(d+=" +");var p=this.paginationParts.includes("pageInfoShort")?e.formatDetailPagination(d):e.formatShowingRows(this.pageFrom,this.pageTo,d,e.totalNotFiltered);c.push('<span class="pagination-info">\n      '.concat(p,"\n      </span>"))}if(this.paginationParts.includes("pageSize")){c.push('<div class="page-list">');var g=['<div class="'.concat(this.constants.classes.paginationDropdown,'">\n        <button class="').concat(this.constants.buttonsClass,' dropdown-toggle" type="button" ').concat(this.constants.dataToggle,'="dropdown">\n        <span class="page-size">\n        ').concat(u?e.formatAllRows():e.pageSize,"\n        </span>\n        ").concat(this.constants.html.dropdownCaret,"\n        </button>\n        ").concat(this.constants.html.pageDropdown[0])];f.forEach(function(n,i){var r;(!e.smartDisplay||0===i||f[i-1]<e.totalRows||n===e.formatAllRows())&&(r=u?n===e.formatAllRows()?t.constants.classes.dropdownActive:"":n===e.pageSize?t.constants.classes.dropdownActive:"",g.push(Nl.sprintf(t.constants.html.pageDropdownItem,r,n)))}),g.push("".concat(this.constants.html.pageDropdown[1],"</div>")),c.push(e.formatRecordsPerPage(g.join("")))}if((this.paginationParts.includes("pageInfo")||this.paginationParts.includes("pageInfoShort")||this.paginationParts.includes("pageSize"))&&c.push("</div></div>"),this.paginationParts.includes("pageList")){c.push('<div class="'.concat(this.constants.classes.pull,"-").concat(e.paginationHAlign,' pagination">'),Nl.sprintf(this.constants.html.pagination[0],Nl.sprintf(" pagination-%s",e.iconSize)),Nl.sprintf(this.constants.html.paginationItem," page-pre",e.formatSRPaginationPreText(),e.paginationPreText)),this.totalPages<e.paginationSuccessivelySize?(i=1,r=this.totalPages):r=(i=e.pageNumber-e.paginationPagesBySide)+2*e.paginationPagesBySide,e.pageNumber<e.paginationSuccessivelySize-1&&(r=e.paginationSuccessivelySize),e.paginationSuccessivelySize>this.totalPages-i&&(i=i-(e.paginationSuccessivelySize-(this.totalPages-i))+1),i<1&&(i=1),r>this.totalPages&&(r=this.totalPages);var v=Math.round(e.paginationPagesBySide/2),b=function(n){var i=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"";return Nl.sprintf(t.constants.html.paginationItem,i+(n===e.pageNumber?" ".concat(t.constants.classes.paginationActive):""),e.formatSRPaginationPageText(n),n)};if(i>1){var m=e.paginationPagesBySide;for(m>=i&&(m=i-1),n=1;n<=m;n++)c.push(b(n));i-1===m+1?(n=i-1,c.push(b(n))):i-1>m&&(i-2*e.paginationPagesBySide>e.paginationPagesBySide&&e.paginationUseIntermediate?(n=Math.round((i-v)/2+v),c.push(b(n," page-intermediate"))):c.push(Nl.sprintf(this.constants.html.paginationItem," page-first-separator disabled","","...")))}for(n=i;n<=r;n++)c.push(b(n));if(this.totalPages>r){var y=this.totalPages-(e.paginationPagesBySide-1);for(r>=y&&(y=r+1),r+1===y-1?(n=r+1,c.push(b(n))):y>r+1&&(this.totalPages-r>2*e.paginationPagesBySide&&e.paginationUseIntermediate?(n=Math.round((this.totalPages-v-r)/2+r),c.push(b(n," page-intermediate"))):c.push(Nl.sprintf(this.constants.html.paginationItem," page-last-separator disabled","","..."))),n=y;n<=this.totalPages;n++)c.push(b(n))}c.push(Nl.sprintf(this.constants.html.paginationItem," page-next",e.formatSRPaginationNextText(),e.paginationNextText)),c.push(this.constants.html.pagination[1],"</div>")}this.$pagination.html(c.join(""));var w=["bottom","both"].includes(e.paginationVAlign)?" ".concat(this.constants.classes.dropup):"";this.$pagination.last().find(".page-list > div").addClass(w),e.onlyInfoPagination||(o=this.$pagination.find(".page-list a"),a=this.$pagination.find(".page-pre"),s=this.$pagination.find(".page-next"),l=this.$pagination.find(".page-item").not(".page-next, .page-pre, .page-last-separator, .page-first-separator"),this.totalPages<=1&&this.$pagination.find("div.pagination").hide(),e.smartDisplay&&(f.length<2||e.totalRows<=f[0])&&this.$pagination.find("div.page-list").hide(),this.$pagination[this.getData().length?"show":"hide"](),e.paginationLoop||(1===e.pageNumber&&a.addClass("disabled"),e.pageNumber===this.totalPages&&s.addClass("disabled")),u&&(e.pageSize=e.formatAllRows()),o.off("click").on("click",function(e){return t.onPageListChange(e)}),a.off("click").on("click",function(e){return t.onPagePre(e)}),s.off("click").on("click",function(e){return t.onPageNext(e)}),l.off("click").on("click",function(e){return t.onPageNumber(e)}))}else this.$pagination.hide()},updatePagination:function(e){e&&t(e.currentTarget).hasClass("disabled")||(this.options.maintainMetaData||this.resetRows(),this.initPagination(),this.trigger("page-change",this.options.pageNumber,this.options.pageSize),"server"===this.options.sidePagination||"client"===this.options.sidePagination&&this.options.paginationLoadMore&&!this._paginationLoaded&&this.options.pageNumber===this.totalPages?this.initServer():this.initBody())},onPageListChange:function(e){e.preventDefault();var n=t(e.currentTarget);return n.parent().addClass(this.constants.classes.dropdownActive).siblings().removeClass(this.constants.classes.dropdownActive),this.options.pageSize=n.text().toUpperCase()===this.options.formatAllRows().toUpperCase()?this.options.formatAllRows():+n.text(),this.$toolbar.find(".page-size").text(this.options.pageSize),this.updatePagination(e),!1},onPagePre:function(e){if(!t(e.target).hasClass("disabled"))return e.preventDefault(),this.options.pageNumber-1==0?this.options.pageNumber=this.options.totalPages:this.options.pageNumber--,this.updatePagination(e),!1},onPageNext:function(e){if(!t(e.target).hasClass("disabled"))return e.preventDefault(),this.options.pageNumber+1>this.options.totalPages?this.options.pageNumber=1:this.options.pageNumber++,this.updatePagination(e),!1},onPageNumber:function(e){if(e.preventDefault(),this.options.pageNumber!==+t(e.currentTarget).text())return this.options.pageNumber=+t(e.currentTarget).text(),this.updatePagination(e),!1},selectPage:function(t){t>0&&t<=this.options.totalPages&&(this.options.pageNumber=t,this.updatePagination())},prevPage:function(){this.options.pageNumber>1&&(this.options.pageNumber--,this.updatePagination())},nextPage:function(){this.options.pageNumber<this.options.totalPages&&(this.options.pageNumber++,this.updatePagination())},togglePagination:function(){this.options.pagination=!this.options.pagination;var t=this.options.showButtonIcons?this.options.pagination?this.options.icons.paginationSwitchDown:this.options.icons.paginationSwitchUp:"",e=this.options.showButtonText?this.options.pagination?this.options.formatPaginationSwitchUp():this.options.formatPaginationSwitchDown():"";this.$toolbar.find('button[name="paginationSwitch"]').html("".concat(Nl.sprintf(this.constants.html.icon,this.options.iconsPrefix,t)," ").concat(e)),this.updatePagination(),this.trigger("toggle-pagination",this.options.pagination)}},yc={initSearchText:function(){if(this.options.search&&(this.searchText="",""!==this.options.searchText)){var e=Nl.getSearchInput(this);t(e).val(this.options.searchText),this.onSearch({currentTarget:e,firedByInitSearchText:!0})}},initSearch:function(){var e=this;if(this.filterOptions=this.filterOptions||this.options.filterOptions,"server"!==this.options.sidePagination){if(this.options.customSearch)return this.data=Nl.calculateObjectValue(this.options,this.options.customSearch,[this.options.data,this.searchText,this.filterColumns]),this.options.sortReset&&(this.unsortedData=u(this.data)),void this.initSort();var n=this.searchText&&(this.fromHtml?Nl.escapeHTML(this.searchText):this.searchText),i=n?n.toLowerCase():"",r=Nl.isEmptyObject(this.filterColumns)?null:this.filterColumns;this.options.searchAccentNeutralise&&(i=Nl.normalizeAccent(i)),"function"==typeof this.filterOptions.filterAlgorithm?this.data=this.options.data.filter(function(t){return e.filterOptions.filterAlgorithm.apply(null,[t,r])}):"string"==typeof this.filterOptions.filterAlgorithm&&(this.data=r?this.options.data.filter(function(t){var n=e.filterOptions.filterAlgorithm;if(!["and","or"].includes(n))return!0;for(var i in r)if(Object.prototype.hasOwnProperty.call(r,i)){var o=Nl.getItemField(t,i,!1),a=Array.isArray(r[i]),s=!a&&r[i]===o||a&&r[i].includes(o);if(s&&"or"===n)return!0;if(!s&&"and"===n)return!1}return"and"===n}):u(this.options.data));var o=this.getVisibleFields();this.data=i?this.data.filter(function(r,a){for(var s=0;s<e.header.fields.length;s++)if(e.header.searchables[s]&&(!e.options.visibleSearch||-1!==o.indexOf(e.header.fields[s]))){var l=Nl.isNumeric(e.header.fields[s])?parseInt(e.header.fields[s],10):e.header.fields[s],c=e.columns[e.fieldsColumnsIndex[l]],u=Nl.getItemField(r,l,!1);if(e.options.searchAccentNeutralise&&(u=Nl.normalizeAccent(u)),c&&c.searchFormatter&&(u=Nl.calculateObjectValue(c,e.header.formatters[s],[u,r,a,c.field],u),e.header.formatters[s]&&"number"!=typeof u&&(u=t("<div>").html(u).text())),"string"==typeof u||"number"==typeof u)if(e.options.strictSearch){if("".concat(u).toLowerCase()===i)return!0}else if(e.options.regexSearch){if(Nl.regexCompare(u,n))return!0}else{var h=/(?:(<=|=>|=<|>=|>|<)(?:\s+)?(-?\d+)?|(-?\d+)?(\s+)?(<=|=>|=<|>=|>|<))/gm.exec(e.searchText),f=!1;if(h){var d=h[1]||"".concat(h[5],"l"),p=h[2]||h[3],g=parseInt(u,10),v=parseInt(p,10);switch(d){case">":case"<l":f=g>v;break;case"<":case">l":f=g<v;break;case"<=":case"=<":case">=l":case"=>l":f=g<=v;break;case">=":case"=>":case"<=l":case"=<l":f=g>=v}}if(f||"".concat(u).toLowerCase().includes(i))return!0}}return!1}):this.data,this.options.sortReset&&(this.unsortedData=u(this.data)),this.initSort()}},onSearch:function(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},n=e.currentTarget,i=e.firedByInitSearchText,r=!(arguments.length>1&&void 0!==arguments[1])||arguments[1];if(void 0!==n&&t(n).length&&r){var o=t(n).val().trim();if(this.options.trimOnSearch&&t(n).val()!==o&&t(n).val(o),this.searchText===o)return;var a=Nl.getSearchInput(this),s=t(a),l=n instanceof jQuery?n:t(n);(l.is(s)||l.hasClass("search-input"))&&(this.searchText=o,this.options.searchText=o)}i||(this.options.pageNumber=1),this.initSearch(),i?"client"===this.options.sidePagination&&this.updatePagination():this.updatePagination(),this.trigger("search",this.searchText)},resetSearch:function(e){var n=Nl.getSearchInput(this),i=e||"";t(n).val(i),this.searchText=i,this.options.searchText=i,this.onSearch({currentTarget:n},!1)},filterBy:function(t,e){this.filterOptions=Nl.isEmptyObject(e)?this.options.filterOptions:Nl.extend({},this.options.filterOptions,e),this.filterColumns=Nl.isEmptyObject(t)?{}:t,this.options.pageNumber=1,this.initSearch(),this.updatePagination()}},wc={renderButton:function(t,e){var n,i=this.options;if(e.hasOwnProperty("html"))n="function"==typeof e.html?e.html():e.html;else{var r=this.constants.buttonsClass;if(e.hasOwnProperty("attributes")&&e.attributes.class&&(r+=" ".concat(e.attributes.class)),n='<button class="'.concat(r,'" type="button" name="').concat(t,'"'),e.hasOwnProperty("attributes"))for(var o=0,a=Object.entries(e.attributes);o<a.length;o++){var s=c(a[o],2),l=s[0],u=s[1];if("class"!==l){var h="title"===l?i.buttonsAttributeTitle:l;n+=" ".concat(h,'="').concat(u,'"')}}n+=">",i.showButtonIcons&&e.hasOwnProperty("icon")&&(n+="".concat(Nl.sprintf(this.constants.html.icon,i.iconsPrefix,e.icon)," ")),i.showButtonText&&e.hasOwnProperty("text")&&(n+=e.text),n+="</button>"}return n},initToolbar:function(){var e,n,i,r=this,a=this.options,s=0;this.$toolbar.find(".bs-bars").children().length&&t("body").append(t(a.toolbar)),this.$toolbar.html(""),"string"!=typeof a.toolbar&&"object"!==f(a.toolbar)||t(Nl.sprintf('<div class="bs-bars %s-%s"></div>',this.constants.classes.pull,a.toolbarAlign)).appendTo(this.$toolbar).append(t(a.toolbar)),e=['<div class="'.concat(["columns","columns-".concat(a.buttonsAlign),this.constants.classes.buttonsGroup,"".concat(this.constants.classes.pull,"-").concat(a.buttonsAlign)].join(" "),'">')],"string"==typeof a.buttonsOrder&&(a.buttonsOrder=a.buttonsOrder.replace(/\[|\]| |'/g,"").split(",")),this.buttons=Object.assign(this.buttons,{paginationSwitch:{text:a.pagination?a.formatPaginationSwitchUp():a.formatPaginationSwitchDown(),icon:a.pagination?a.icons.paginationSwitchDown:a.icons.paginationSwitchUp,render:!1,event:this.togglePagination,attributes:{"aria-label":a.formatPaginationSwitch(),title:a.formatPaginationSwitch()}},refresh:{text:a.formatRefresh(),icon:a.icons.refresh,render:!1,event:this.refresh,attributes:{"aria-label":a.formatRefresh(),title:a.formatRefresh()}},toggle:{text:a.formatToggleOn(),icon:a.icons.toggleOff,render:!1,event:this.toggleView,attributes:{"aria-label":a.formatToggleOn(),title:a.formatToggleOn()}},fullscreen:{text:a.formatFullscreen(),icon:a.icons.fullscreen,render:!1,event:this.toggleFullscreen,attributes:{"aria-label":a.formatFullscreen(),title:a.formatFullscreen()}},columns:{render:!1,html:function(){var t=[];if(t.push('<div class="keep-open '.concat(r.constants.classes.buttonsDropdown,'">\n            <button class="').concat(r.constants.buttonsClass,' dropdown-toggle" type="button" ').concat(r.constants.dataToggle,'="dropdown"\n            aria-label="').concat(a.formatColumns(),'" ').concat(a.buttonsAttributeTitle,'="').concat(a.formatColumns(),'">\n            ').concat(a.showButtonIcons?Nl.sprintf(r.constants.html.icon,a.iconsPrefix,a.icons.columns):"","\n            ").concat(a.showButtonText?a.formatColumns():"","\n            ").concat(r.constants.html.dropdownCaret,"\n            </button>\n            ").concat(r.constants.html.toolbarDropdown[0])),a.showColumnsSearch&&(t.push(Nl.sprintf(r.constants.html.toolbarDropdownItem,Nl.sprintf('<input type="text" class="%s" name="columnsSearch" placeholder="%s" autocomplete="off">',r.constants.classes.input,a.formatSearch()))),t.push(r.constants.html.toolbarDropdownSeparator)),a.showColumnsToggleAll){var e=r.getVisibleColumns().length===r.columns.filter(function(t){return!r.isSelectionColumn(t)}).length;t.push(Nl.getCheckboxHtml({name:"toggle-all",checked:e,label:a.formatColumnsToggleAll(),extraClass:"toggle-all",centered:!1,withLabel:!0})),t.push(r.constants.html.toolbarDropdownSeparator)}var n=0;return r.columns.forEach(function(t){t.visible&&n++}),r.columns.forEach(function(e,i){if(!r.isSelectionColumn(e)&&(!a.cardView||e.cardVisible)){var o=e.visible?' checked="checked"':"",l=n<=a.minimumCountColumns&&o?' disabled="disabled"':"";if(e.switchable){var c=Nl.getDropdownColumnCheckboxHtml({dataField:e.field,value:i,checked:!!o,disabled:!!l,label:e.switchableLabel||e.title});5===Nl.getBootstrapVersion()?t.push(c):t.push(Nl.sprintf(r.constants.html.toolbarDropdownItem,c)),s++}}}),t.push(r.constants.html.toolbarDropdown[1],"</div>"),t.join("")}}});for(var l={},h=0,d=Object.entries(this.buttons);h<d.length;h++){var p=c(d[h],2),g=p[0],v=p[1];l[g]=this.renderButton(g,v);var b="show".concat(g.charAt(0).toUpperCase()).concat(g.substring(1)),m=a[b];!(!v.hasOwnProperty("render")||v.hasOwnProperty("render")&&v.render)||void 0!==m&&!0!==m||(a[b]=!0),a.buttonsOrder.includes(g)||a.buttonsOrder.push(g)}var y,w=o(a.buttonsOrder);try{for(w.s();!(y=w.n()).done;){var S=y.value;a["show".concat(S.charAt(0).toUpperCase()).concat(S.substring(1))]&&e.push(l[S])}}catch(t){w.e(t)}finally{w.f()}if(e.push("</div>"),this.showToolbar||e.length>2)if(e.some(function(t){return Nl.isDomNode(t)})){var x,O=t(e[0]),C=o(e.slice(1,-1));try{for(C.s();!(x=C.n()).done;){var k=x.value;O.append.apply(O,u(Nl.htmlToNodes(k)))}}catch(t){C.e(t)}finally{C.f()}this.$toolbar.append(O)}else this.$toolbar.append(e.join(""));for(var T=function(){var t=c(A[P],2),e=t[0],n=t[1];if(n.hasOwnProperty("event")){if("function"==typeof n.event||"string"==typeof n.event){var i="string"==typeof n.event?window[n.event]:n.event;return r.$toolbar.find('button[name="'.concat(e,'"]')).off("click").on("click",function(){return i.call(r)}),1}for(var o=function(){var t=c(s[a],2),n=t[0],i=t[1],o="string"==typeof i?window[i]:i;r.$toolbar.find('button[name="'.concat(e,'"]')).off(n).on(n,function(){return o.call(r)})},a=0,s=Object.entries(n.event);a<s.length;a++)o()}},P=0,A=Object.entries(this.buttons);P<A.length;P++)T();if(a.showColumns){var I=(i=this.$toolbar.find(".keep-open")).find('input[type="checkbox"]:not(".toggle-all")'),$=i.find('input[type="checkbox"].toggle-all');if(s<=a.minimumCountColumns&&i.find("input").prop("disabled",!0),i.find("li, label").off("click").on("click",function(t){t.stopImmediatePropagation()}),I.off("click").on("click",function(e){var n=e.currentTarget,i=t(n);r._toggleColumns([i.data("field")],i.prop("checked"),!1),r.trigger("column-switch",i.data("field"),i.prop("checked")),$.prop("checked",I.filter(":checked").length===r.columns.filter(function(t){return!r.isSelectionColumn(t)}).length)}),$.off("click").on("click",function(e){var n=e.currentTarget;r._toggleAllColumns(t(n).prop("checked")),r.trigger("column-switch-all",t(n).prop("checked"))}),a.showColumnsSearch){var E=i.find('[name="columnsSearch"]'),R=i.find(".dropdown-item-marker");E.on("keyup paste change",function(e){var n=e.currentTarget,i=t(n).val().toLowerCase();R.show(),I.each(function(e,n){var r=t(n).parents(".dropdown-item-marker");r.text().toLowerCase().includes(i)||r.hide()})})}}var j=function(t){var e=t.is("select")?"change":"keyup drop blur mouseup";t.off(e).on(e,function(t){a.searchOnEnterKey&&13!==t.keyCode||[37,38,39,40].includes(t.keyCode)||(clearTimeout(n),n=setTimeout(function(){r.onSearch({currentTarget:t.currentTarget})},a.searchTimeOut))})};if((a.search||this.showSearchClearButton)&&"string"!=typeof a.searchSelector){e=[];var _=Nl.sprintf(this.constants.html.searchButton,this.constants.buttonsClass,a.formatSearch(),a.showButtonIcons?Nl.sprintf(this.constants.html.icon,a.iconsPrefix,a.icons.search):"",a.showButtonText?a.formatSearch():""),N=Nl.sprintf(this.constants.html.searchClearButton,this.constants.buttonsClass,a.formatClearSearch(),a.showButtonIcons?Nl.sprintf(this.constants.html.icon,a.iconsPrefix,a.icons.clearSearch):"",a.showButtonText?a.formatClearSearch():""),L='<input class="'.concat(this.constants.classes.input,"\n        ").concat(Nl.sprintf(" %s%s",this.constants.classes.inputPrefix,a.iconSize),'\n        search-input" type="search" aria-label="').concat(a.formatSearch(),'" placeholder="').concat(a.formatSearch(),'" autocomplete="off">'),F=L;if(a.showSearchButton||a.showSearchClearButton){var D=(a.showSearchButton?_:"")+(a.showSearchClearButton?N:"");F=a.search?Nl.sprintf(this.constants.html.inputGroup,L,D):D}e.push(Nl.sprintf('\n        <div class="'.concat(this.constants.classes.pull,"-").concat(a.searchAlign," search ").concat(this.constants.classes.inputGroup,'">\n          %s\n        </div>\n      '),F)),this.$toolbar.append(e.join(""));var B=Nl.getSearchInput(this),V=t(B);a.showSearchButton?(this.$toolbar.find(".search button[name=search]").off("click").on("click",function(){clearTimeout(n),n=setTimeout(function(){r.onSearch({currentTarget:B})},a.searchTimeOut)}),a.searchOnEnterKey&&j(V)):j(V),a.showSearchClearButton&&this.$toolbar.find(".search button[name=clearSearch]").click(function(){r.resetSearch()})}else"string"==typeof a.searchSelector&&j(t(Nl.getSearchInput(this)))},refresh:function(t){t&&t.url&&(this.options.url=t.url),t&&t.pageNumber&&(this.options.pageNumber=t.pageNumber),t&&t.pageSize&&(this.options.pageSize=t.pageSize),t&&t.query&&(this.options.url=Nl.addQueryToUrl(this.options.url,t.query)),this.trigger("refresh",this.initServer(t&&t.silent))},toggleView:function(){this.options.cardView=!this.options.cardView,this.initHeader();var t=this.options.showButtonIcons?this.options.cardView?this.options.icons.toggleOn:this.options.icons.toggleOff:"",e=this.options.cardView?this.options.formatToggleOff():this.options.formatToggleOn();this.$toolbar.find('button[name="toggle"]').html("".concat(Nl.sprintf(this.constants.html.icon,this.options.iconsPrefix,t)," ").concat(this.options.showButtonText?e:"")).attr("aria-label",e).attr(this.options.buttonsAttributeTitle,e),this.initBody(),this.trigger("toggle",this.options.cardView)},toggleFullscreen:function(){this.$el.closest(".bootstrap-table").toggleClass("fullscreen"),this.resetView()}},Sc=function(){function e(i,r){n(this,e),this.options=r,this.$el=t(i),this.$el_=this.$el.clone(),this._timeoutId={header:0,footer:0}}return r(e,[{key:"init",value:function(){this.initConstants(),this.initLocale(),this.initContainer(),this.initTable(),this.initHeader(),this.initData(),this.initHiddenRows(),this.initToolbar(),this.initPagination(),this.initBody(),this.initSearchText(),this.initServer()}},{key:"trigger",value:function(n){for(var i,r,o="".concat(n,".bs.table"),a=arguments.length,s=new Array(a>1?a-1:0),l=1;l<a;l++)s[l-1]=arguments[l];(i=this.options)[e.EVENTS[o]].apply(i,[].concat(s,[this])),this.$el.trigger(t.Event(o,{sender:this}),s),(r=this.options).onAll.apply(r,[o].concat([].concat(s,[this]))),this.$el.trigger(t.Event("all.bs.table",{sender:this}),[o,s])}},{key:"getOptions",value:function(){var t=Nl.extend({},this.options);return delete t.data,Nl.extend(!0,{},t)}},{key:"refreshOptions",value:function(t){Nl.compareObjects(this.options,t,!0)||(this.optionsColumnsChanged=!!t.columns,this.options=Nl.extend(this.options,t),this.trigger("refresh-options",this.options),this.destroy(),this.init())}},{key:"_setDelayTimeout",value:function(t,e,n){clearTimeout(this._timeoutId[t]),this._timeoutId[t]=setTimeout(e,n)}},{key:"destroy",value:function(){for(var e=0,n=Object.keys(this._timeoutId);e<n.length;e++){var i=n[e];clearTimeout(this._timeoutId[i])}this.$el.insertBefore(this.$container),t(this.options.toolbar).insertBefore(this.$el),this.$container.next().remove(),this.$container.remove(),this.$el.html(this.$el_.html()).css("margin-top","0").attr("class",this.$el_.attr("class")||"");var r=Nl.getEventName("resize.bootstrap-table",this.$el.attr("id"));t(window).off(r)}},{key:"updateFormatText",value:function(t,e){/^format/.test(t)&&this.options[t]&&("string"==typeof e?this.options[t]=function(){return e}:"function"==typeof e&&(this.options[t]=e),this.initToolbar(),this.initPagination(),this.initBody())}}])}();return Object.assign(Sc.prototype,Ul),Object.assign(Sc.prototype,bc),Object.assign(Sc.prototype,gc),Object.assign(Sc.prototype,wc),Object.assign(Sc.prototype,yc),Object.assign(Sc.prototype,mc),Object.assign(Sc.prototype,rc),Object.assign(Sc.prototype,oc),Object.assign(Sc.prototype,vc),Sc.VERSION=Ml.VERSION,Sc.DEFAULTS=Ml.DEFAULTS,Sc.LOCALES=Ml.LOCALES,Sc.COLUMN_DEFAULTS=Ml.COLUMN_DEFAULTS,Sc.METHODS=Ml.METHODS,Sc.EVENTS=Ml.EVENTS,t.BootstrapTable=Sc,t.fn.bootstrapTable=function(e){for(var n=arguments.length,i=new Array(n>1?n-1:0),r=1;r<n;r++)i[r-1]=arguments[r];var o;return this.each(function(n,r){var a=t(r).data("bootstrap.table");if("string"==typeof e){var s;if(!Ml.METHODS.includes(e))throw new Error("Unknown method: ".concat(e));if(!a)return;return o=(s=a)[e].apply(s,i),void("destroy"===e&&t(r).removeData("bootstrap.table"))}if(a)console.warn("You cannot initialize the table more than once!");else{var l=Nl.extend(!0,{},Sc.DEFAULTS,t(r).data(),"object"===f(e)&&e);a=new t.BootstrapTable(r,l),t(r).data("bootstrap.table",a),a.init()}}),void 0===o?this:o},t.fn.bootstrapTable.Constructor=Sc,t.fn.bootstrapTable.theme=Ml.THEME,t.fn.bootstrapTable.VERSION=Ml.VERSION,t.fn.bootstrapTable.icons=Ml.ICONS,t.fn.bootstrapTable.defaults=Sc.DEFAULTS,t.fn.bootstrapTable.columnDefaults=Sc.COLUMN_DEFAULTS,t.fn.bootstrapTable.events=Sc.EVENTS,t.fn.bootstrapTable.locales=Sc.LOCALES,t.fn.bootstrapTable.methods=Sc.METHODS,t.fn.bootstrapTable.utils=Nl,t(function(){t('[data-toggle="table"]').bootstrapTable()}),Sc});

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"jquery":18}],17:[function(require,module,exports){
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
},{"jquery":18}],18:[function(require,module,exports){
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

},{}]},{},[13,12]);
