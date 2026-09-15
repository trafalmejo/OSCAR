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

  sends: true,
  receives: false,
  dmx: true,

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
   * `ctx` is the whole of what a widget may assume about its host; the
   * contract is at the top of index.js. Everything here is plain DOM, so
   * porting to another editor means providing that, not rewriting the button.
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

    // The on state lives here, not in the host's model, so it is never saved;
    // the cost is that the host wipes the class when it rewrites the element,
    // and a toggle that is on would paint as off while the rig stays on.
    const stopRewrite = ctx.onRewrite
      ? ctx.onRewrite(function () {
          ctx.setClass(ON_CLASS, on);
        })
      : null;

    return function detach() {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("keyup", onKeyUp);
      if (root) root.removeEventListener("blur", release);
      if (stopRewrite) stopRewrite();
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
