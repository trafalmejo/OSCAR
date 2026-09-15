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
