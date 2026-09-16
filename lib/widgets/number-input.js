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
const { commitOn, refusal, checkArgType, levelOf } = require("./typed");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");

/**
 * OSC number box: type an exact value instead of hunting for it with a fader.
 *
 * Some values are known -- 127, 0.5, cue 12 -- and dragging a slider until
 * it happens to land on one is guesswork. Sends on Enter, on leaving the box
 * and on a click of the stepper arrows, never per keystroke; typed.js says
 * why. Min, Max and Step are optional: blank means no limit, and a value
 * outside the limits, or off the step, is refused and not sent -- the box
 * keeps the text and the browser marks it, so the operator sees what was not
 * accepted rather than a rig at a clamped value nobody typed.
 *
 * On DMX the number is a level: 0-255 as typed, or, with Min and Max both
 * set, scaled within them as a slider's would be. With Listen on, a value
 * arriving at Message fills the box, kept inside the limits so the box and
 * its range agree -- unless the box is being typed into.
 */
const numberInput = {
  name: "oscar-number-input",
  tag: "input",
  // Only what never changes; min, max and step follow the settings and are
  // put on the element by attach. The enterkeyhint puts "send" on a phone
  // keyboard's Enter, which is what it does here.
  attributes: { type: "number", class: "oscar-number-input", enterkeyhint: "send" },

  sends: true,
  receives: true,
  dmx: true,

  block: {
    label: "Number Input",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M4,17V9H2V7H6V17H4M22,15C22,16.11 21.1,17 20,17H16V15H20V13H18V11H20V9H16V7H20A2,2 0 0,1 ' +
      '22,9V10.5A1.5,1.5 0 0,1 20.5,12A1.5,1.5 0 0,1 22,13.5V15M14,15V17H8V13C8,11.89 8.9,11 ' +
      '10,11H12V9H8V7H12A2,2 0 0,1 14,9V11C14,12.11 13.1,13 12,13H10V15H14Z"/></svg>',
  },

  defaults: Object.assign(
    {
      enabled: true,
      ip: "localhost",
      port: 7000,
      message: "/number1",
      listen: false,
      value: 0,
      min: "",
      max: "",
      step: "",
      argType: "f",
    },
    dmxDefaults(1)
  ),

  fields: [enabled(), transport()]
    .concat(connection())
    .concat([
      listen(),
      field("value", "Value", "number", { step: "any" }),
      field("min", "Min", "number", { step: "any", placeholder: "no limit" }),
      field("max", "Max", "number", { step: "any", placeholder: "no limit" }),
      field("step", "Step", "number", { step: "any", min: 0, placeholder: "any" }),
      field("argType", "Argument type", "select", { options: NUMERIC_ARG_TYPES }),
    ])
    .concat(dmxFields()),

  checks: Object.assign({}, connectionChecks(), dmxChecks(1), {
    value: checkValue,
    min: checkLimit("Min", "max"),
    max: checkLimit("Max", "min"),
    step: checkStep,
    argType: checkArgType(function (config) {
      return [config.value];
    }),
  }),

  attach: function (el, ctx) {
    const entry = commitOn(el, function (raw) {
      const value = toNumber(raw);
      // A cleared or half-typed box is a question, not a zero: Number("") is
      // 0, and 0 is a real cue. Nothing goes out, and the text stays as typed
      // so it can be finished.
      if (value === null) return;
      if (!accepts(ctx, value)) return;
      ctx.set("value", value);
      ctx.send(resolve(ctx, value));
    });

    apply();

    /**
     * Push the limits and the value onto the native input. The limits go on
     * the element too, not only into accepts(): the stepper arrows stop at
     * them, and the browser paints a value outside them as out of range.
     */
    function apply() {
      el.min = attribute(ctx.get("min"));
      el.max = attribute(ctx.get("max"));
      el.step = attribute(ctx.get("step")) || "any";
      const value = toNumber(ctx.get("value"));
      entry.show(value === null ? "" : String(value));
    }

    /**
     * Take a value the rig sent: it fills the box and goes no further. Kept
     * inside the limits, as the slider keeps a value inside its range, so
     * the box never shows a number it would itself refuse.
     */
    function adopt(values) {
      if (entry.editing()) return;
      const value = toNumber(values[0]);
      if (value === null) return;
      ctx.set("value", within(value, ctx.get("min"), ctx.get("max")));
      apply();
    }

    const stop = ctx.onChange(["value", "min", "max", "step"], apply);
    // The host rewriting the element strips min, max and step with the rest,
    // and a box with no max lets the stepper run past the range.
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(apply) : null;
    const stopOsc = follow(ctx, adopt);

    return function detach() {
      entry.detach();
      if (stop) stop();
      if (stopRewrite) stopRewrite();
      if (stopOsc) stopOsc();
    };
  },
};

/** A limit as the element wants it: a number's text, or "" for none. */
function attribute(raw) {
  const number = toNumber(raw);
  return number === null ? "" : String(number);
}

/** Does a typed value sit inside the limits and on the step? */
function accepts(ctx, value) {
  const min = toNumber(ctx.get("min"));
  const max = toNumber(ctx.get("max"));
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return onStep(value, ctx.get("step"), min);
}

/**
 * Whether a value is a whole number of steps from the base, which the
 * browser takes to be Min, or 0 without one. Measured with a tolerance,
 * because 0.3 is not three of 0.1 in floating point.
 */
function onStep(value, step, min) {
  const size = toNumber(step);
  if (size === null || size <= 0) return true;
  const steps = (value - (min === null ? 0 : min)) / size;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/** Keep a received value inside the limits, each of which may be absent. */
function within(value, min, max) {
  const lo = toNumber(min);
  const hi = toNumber(max);
  let result = value;
  if (lo !== null) result = Math.max(lo, result);
  if (hi !== null) result = Math.min(hi, result);
  return result;
}

function resolve(ctx, value) {
  return outgoing(routing(ctx), value, levelOf(value, ctx.get("min"), ctx.get("max")));
}

function blank(value) {
  return value === "" || value === null || value === undefined;
}

/**
 * Blank is allowed -- it is how you say "no limit" -- and nonsense is not.
 * The two limits must also be the right way round: the browser treats every
 * value as out of range when Min is above Max, and the box goes dead.
 */
function checkLimit(label, otherKey) {
  return function (value, config) {
    if (blank(value)) return null;
    const number = toNumber(value);
    if (number === null) return label + " has to be a number, or blank for no limit";
    const other = toNumber(config && config[otherKey]);
    if (other !== null && (otherKey === "max" ? number > other : number < other)) {
      return "Min has to be at most Max";
    }
    return null;
  };
}

function checkStep(value) {
  if (blank(value)) return null;
  const number = toNumber(value);
  if (number === null || number <= 0) return "Step has to be a number above zero, or blank for any";
  return null;
}

/**
 * Judged against the type that will carry it and the limits it has to sit
 * inside: a value the box would refuse from the keyboard is refused from the
 * panel too, and for the same reasons.
 */
function checkValue(value, config) {
  const number = toNumber(value);
  if (number === null) return "The value has to be a number";
  const complaint = refusal((config && config.argType) || "f", value);
  if (complaint) return complaint;
  const min = toNumber(config && config.min);
  const max = toNumber(config && config.max);
  if (min !== null && number < min) return "The value has to be at least " + min;
  if (max !== null && number > max) return "The value has to be at most " + max;
  if (!onStep(number, config && config.step, min)) return "The value has to be a whole number of steps from " + (min === null ? 0 : min);
  return null;
}

module.exports = { numberInput };
