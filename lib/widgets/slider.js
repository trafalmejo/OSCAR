"use strict";

const {
  field,
  enabled,
  listen,
  connection,
  connectionChecks,
  checkNumber,
  transport,
  dmxFields,
  dmxDefaults,
  dmxChecks,
} = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { follow } = require("./incoming");
const { share, onShared } = require("./shared");
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
      share(ctx, { value: value });
    }

    function hold() {
      held = true;
    }

    function release() {
      held = false;
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
      if (held) return null;
      const value = toNumber(raw);
      if (value === null) return null;
      const kept = within(value, ctx.get("min"), ctx.get("max"));
      ctx.set("value", kept);
      apply();
      return kept;
    }

    /**
     * Take a value the rig sent, and pass it on to the other devices once:
     * they heard the rig too, so the server finds nothing changed in what
     * they say back, and a device joining later starts where the rig left
     * the thumb.
     */
    function adopt(values) {
      const kept = take(values[0]);
      if (kept !== null) share(ctx, { value: kept });
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

module.exports = { slider, ORIENTATIONS };
