"use strict";

const { field, enabled, connection, connectionChecks, checkNumber } = require("./fields");
const { NUMERIC_ARG_TYPES } = require("../osc-args");
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
    argType: "f",
  },

  fields: [enabled()].concat(connection()).concat([
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

    return function detach() {
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
