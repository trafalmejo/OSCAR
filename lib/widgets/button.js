"use strict";

const {
  field,
  enabled,
  listen,
  connection,
  connectionChecks,
  transport,
  dmxFields,
  dmxDefaults,
  dmxChecks,
} = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { follow } = require("./incoming");
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

  fields: [enabled(), field("label", "Label", "text"), transport()]
    .concat(connection())
    .concat([
      listen(),
      field("mode", "Mode", "select", { options: MODES }),
      field("valueOn", "Value ON", "text"),
      field("valueOff", "Value OFF", "text"),
      field("argType", "Argument type", "select", { options: ARG_TYPES }),
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
    }

    /**
     * Take an edge the rig sent. Paints, and for a toggle adopts it as the
     * state -- through paint(), never setOn(), which is the path that sends.
     */
    function adopt(values) {
      const next = asEdge(ctx, values[0]);
      if (next === null) return;
      if (isMomentary()) {
        // The finger outranks the rig for as long as it is down.
        if (on) return;
        echo = next;
      } else {
        on = next;
        echo = false;
      }
      paint();
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
