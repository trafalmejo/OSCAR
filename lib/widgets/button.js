"use strict";

const { field, enabled, listen, connection, connectionChecks } = require("./fields");
const { outgoing } = require("./outgoing");
const { incoming } = require("./incoming");
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

  defaults: {
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

  fields: [enabled(), field("label", "Label", "text")]
    .concat(connection())
    .concat([
      listen(),
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

    const stopOsc = ctx.onOsc
      ? ctx.onOsc(function (message) {
          const match = incoming(
            { listen: ctx.get("listen"), message: ctx.get("message") },
            message
          );
          // A bare address carries no state to adopt -- /play says a thing
          // happened, not whether anything is now on.
          if (!match || !match.values.length) return;
          if (adopt(stateFor(match.values[0]))) share();
        })
      : null;

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
