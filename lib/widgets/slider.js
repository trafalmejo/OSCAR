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
