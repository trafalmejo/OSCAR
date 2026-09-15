(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
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

},{"../widgets":5}],2:[function(require,module,exports){
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

},{}],3:[function(require,module,exports){
"use strict";

const { field, enabled, connection, connectionChecks } = require("./fields");
const { outgoing } = require("./outgoing");
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

  defaults: {
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

  fields: [enabled(), field("label", "Label", "text")]
    .concat(connection())
    .concat([
      field("mode", "Mode", "select", { options: MODES }),
      field("valueOn", "Value ON", "text"),
      field("valueOff", "Value OFF", "text"),
      field("argType", "Argument type", "select", { options: ARG_TYPES }),
    ]),

  checks: Object.assign({}, connectionChecks(), {
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

/** The message for one edge, or null if it cannot or should not be sent. */
function resolve(ctx, on) {
  return outgoing(
    {
      enabled: ctx.get("enabled"),
      ip: ctx.get("ip"),
      port: ctx.get("port"),
      message: ctx.get("message"),
      argType: ctx.get("argType"),
    },
    on ? ctx.get("valueOn") : ctx.get("valueOff")
  );
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

},{"../osc-args":2,"./fields":4,"./outgoing":6}],4:[function(require,module,exports){
"use strict";

/**
 * The vocabulary a widget uses to describe its settings panel.
 *
 * A widget lists fields; something else turns them into whatever the editor of
 * the day uses for its inspector. Nothing here knows what that editor is, so a
 * widget definition outlives the choice of one.
 *
 * Field shape:
 *   { key, label, type, options?, min?, max?, step?, placeholder? }
 *   type: "text" | "number" | "select" | "checkbox"
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
  checkIp: checkIp,
  checkPort: checkPort,
  checkMessage: checkMessage,
  checkNumber: checkNumber,
  IPV4: IPV4,
};

},{}],5:[function(require,module,exports){
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
 */

const { button } = require("./button");
const { slider } = require("./slider");
const { xypad } = require("./xypad");
const { outgoing } = require("./outgoing");

const WIDGETS = [button, slider, xypad];

module.exports = { WIDGETS, button, slider, xypad, outgoing };

},{"./button":3,"./outgoing":6,"./slider":7,"./xypad":8}],6:[function(require,module,exports){
"use strict";

const { toArgs } = require("../osc-args");

/**
 * Decide the message a widget should put on the wire, or null for silence.
 *
 * Every widget funnels through here, so the Enabled switch cannot be
 * implemented three slightly different ways, and a value that no argument type
 * can carry is dropped rather than guessed at.
 */
function outgoing(config, raw) {
  if (!config || !config.enabled) return null;

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

  return {
    ip: config.ip,
    port: config.port,
    address: config.message,
    args: args,
  };
}

module.exports = { outgoing };

},{"../osc-args":2}],7:[function(require,module,exports){
"use strict";

const { field, enabled, connection, connectionChecks, checkNumber } = require("./fields");
const { outgoing } = require("./outgoing");
const { NUMERIC_ARG_TYPES } = require("../osc-args");

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

  defaults: {
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

  fields: [enabled()].concat(connection()).concat([
    field("min", "Min", "number", { step: "any" }),
    field("max", "Max", "number", { step: "any" }),
    field("value", "Value", "number", { step: "any" }),
    field("orientation", "Orientation", "select", { options: ORIENTATIONS }),
    field("invert", "Invert", "checkbox"),
    field("argType", "Argument type", "select", { options: NUMERIC_ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
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

function resolve(ctx, value) {
  return outgoing(
    {
      enabled: ctx.get("enabled"),
      ip: ctx.get("ip"),
      port: ctx.get("port"),
      message: ctx.get("message"),
      argType: ctx.get("argType"),
    },
    value
  );
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

},{"../osc-args":2,"./fields":4,"./outgoing":6}],8:[function(require,module,exports){
"use strict";

const { field, enabled, connection, connectionChecks, checkNumber } = require("./fields");
const { outgoing } = require("./outgoing");
const { NUMERIC_ARG_TYPES } = require("../osc-args");

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

  defaults: {
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

  fields: [enabled()].concat(connection()).concat([
    field("sendMode", "Send", "select", { options: SEND_MODES }),
    field("minX", "Min X", "number", { step: "any" }),
    field("maxX", "Max X", "number", { step: "any" }),
    field("minY", "Min Y", "number", { step: "any" }),
    field("maxY", "Max Y", "number", { step: "any" }),
    field("invertX", "Invert X", "checkbox"),
    field("invertY", "Invert Y", "checkbox"),
    field("argType", "Argument type", "select", { options: NUMERIC_ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
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

      const config = {
        enabled: ctx.get("enabled"),
        ip: ctx.get("ip"),
        port: ctx.get("port"),
        message: ctx.get("message"),
        argType: ctx.get("argType"),
      };

      if (ctx.get("sendMode") === "two") {
        ctx.send(outgoing(Object.assign({}, config, { message: config.message + "/x" }), values.x));
        ctx.send(outgoing(Object.assign({}, config, { message: config.message + "/y" }), values.y));
        return;
      }
      ctx.send(outgoing(config, [values.x, values.y]));
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

module.exports = { xypad, SEND_MODES };

},{"../osc-args":2,"./fields":4,"./outgoing":6}],9:[function(require,module,exports){
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

},{"../../../lib/export/config":1}],10:[function(require,module,exports){
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

},{"./adapters/standalone":9}]},{},[10]);
