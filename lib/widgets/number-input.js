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
  sendsDmx,
} = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { follow } = require("./incoming");
const { share, onShared } = require("./shared");
const { commitOn, refusal, checkArgType, levelOf, dmxRange } = require("./typed");
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
 * set, scaled within them as a slider's would be. Without both, 0-255 are
 * the box's limits whatever else is set, and a number outside them is refused
 * like any other: a mistyped -1 pinned to 0 would be a blackout. With Listen
 * on, a value arriving at Message fills the box, brought inside the limits
 * and onto the step so the box and its settings agree -- unless the box is
 * being typed into.
 *
 * The settings are judged together, not one by one. Min, Max, Step, Output
 * and Argument type each decide whether the Value already in the box can be
 * sent, so each of them refuses an edit that would strand it: a box holding
 * a number it will itself refuse sends nothing on Enter, and looks fine.
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
    transport: function (value, config) {
      return stranded(config, "transport", value);
    },
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
      // Every refusal comes before the value is stored. A number the wire
      // will not take -- 3000000000 as an int -- must not end up in the
      // project either, where the panel's own check would refuse it.
      if (complaintAbout(settings(ctx), value)) return;
      ctx.set("value", value);
      const message = resolve(ctx, value);
      ctx.send(message);
      // Only a number that went out is news for the other devices.
      if (message) share(ctx, { value: value });
    });

    apply();

    /**
     * Push the limits and the value onto the native input. The limits go on
     * the element too, not only into accepts(): the stepper arrows stop at
     * them, and the browser paints a value outside them as out of range.
     */
    function apply() {
      const range = limits(settings(ctx));
      el.min = attribute(range.min);
      el.max = attribute(range.max);
      el.step = attribute(ctx.get("step")) || "any";
      const value = toNumber(ctx.get("value"));
      entry.show(value === null ? "" : String(value));
    }

    /**
     * Take a value the rig sent: it fills the box and goes no further.
     * Brought inside the limits and onto the step, as the slider keeps a
     * value inside its range, so the box never shows a number it would
     * itself refuse: Enter on what the rig sent has to re-send it.
     */
    function adopt(values) {
      const fitted = take(values[0]);
      // Every device heard the rig: recorded for whoever joins later, passed
      // to nobody.
      if (fitted !== null) share(ctx, { value: fitted }, { heard: true });
    }

    /** Another device typed. Shown, and never shared again: it came from there. */
    function adoptShared(state) {
      if (state) take(state.value);
    }

    /** Show a number that arrived; returns what was shown, or null. */
    function take(raw) {
      if (entry.editing()) return null;
      const value = toNumber(raw);
      if (value === null) return null;
      const fitted = nearest(settings(ctx), value);
      // What even the nearest number cannot fix -- a value past an int, limits
      // that leave no room -- is ignored rather than shown and then refused.
      if (complaintAbout(settings(ctx), fitted)) return null;
      ctx.set("value", fitted);
      apply();
      return fitted;
    }

    const stop = ctx.onChange(["value", "min", "max", "step", "transport"], apply);
    // The host rewriting the element strips min, max and step with the rest,
    // and a box with no max lets the stepper run past the range.
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(apply) : null;
    const stopOsc = follow(ctx, adopt);
    const stopShared = onShared(ctx, adoptShared);

    return function detach() {
      entry.detach();
      if (stop) stop();
      if (stopRewrite) stopRewrite();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

/** A limit as the element wants it: a number's text, or "" for none. */
function attribute(raw) {
  const number = toNumber(raw);
  return number === null ? "" : String(number);
}

/** The settings that decide whether a number can go out. */
function settings(ctx) {
  return {
    min: ctx.get("min"),
    max: ctx.get("max"),
    step: ctx.get("step"),
    argType: ctx.get("argType"),
    transport: ctx.get("transport"),
  };
}

/**
 * The limits in force, each of which may be null for none.
 *
 * On DMX without both Min and Max the number is the level itself, so 0-255
 * bound it as well as whatever single limit is set. `dmx` says the bounds
 * came from there, so a complaint can say why.
 */
function limits(config) {
  let min = toNumber(config && config.min);
  let max = toNumber(config && config.max);
  if (!sendsDmx(config) || (min !== null && max !== null)) return { min: min, max: max, dmx: false };
  const level = dmxRange(min, max);
  min = min === null ? level.min : Math.max(min, level.min);
  max = max === null ? level.max : Math.min(max, level.max);
  return { min: min, max: max, dmx: true };
}

/**
 * Why this number cannot be sent under these settings, or null. The one
 * judgement behind the keyboard, the panel's Value, and every setting that
 * could strand the Value.
 */
function complaintAbout(config, number) {
  const complaint = refusal((config && config.argType) || "f", number);
  if (complaint) return complaint;
  const range = limits(config);
  const why = range.dmx ? " (a DMX level is 0-255; set both Min and Max to type in other units)" : "";
  if (range.min !== null && number < range.min) return "The value has to be at least " + range.min + why;
  if (range.max !== null && number > range.max) return "The value has to be at most " + range.max + why;
  if (!onStep(number, config && config.step, range.min)) {
    return "The value has to be a whole number of steps from " + (range.min === null ? 0 : range.min);
  }
  return null;
}

/**
 * Would this edit leave the Value already in the box unsendable? A Value
 * that is not a number at all is left to its own check.
 */
function stranded(config, key, value) {
  const next = Object.assign({}, config);
  next[key] = value;
  const held = toNumber(next.value);
  if (held === null) return null;
  const complaint = complaintAbout(next, held);
  return complaint ? complaint + "; change the value first" : null;
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

/**
 * The number nearest a received one that the box would accept: inside the
 * limits, then on the step, stepping back in if rounding left the range.
 */
function nearest(config, value) {
  const range = limits(config);
  let result = value;
  if (range.min !== null) result = Math.max(range.min, result);
  if (range.max !== null) result = Math.min(range.max, result);

  const size = toNumber(config.step);
  if (size === null || size <= 0) return result;
  const base = range.min === null ? 0 : range.min;
  let steps = Math.round((result - base) / size);
  if (range.max !== null && base + steps * size > range.max) steps -= 1;
  // Trimmed, because three steps of 0.1 is 0.30000000000000004 and that is
  // what the box would show.
  return Number((base + steps * size).toPrecision(12));
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
    const key = otherKey === "max" ? "min" : "max";
    // Clearing a limit can strand the Value too: on DMX it brings 0-255 back.
    if (blank(value)) return stranded(config, key, value);
    const number = toNumber(value);
    if (number === null) return label + " has to be a number, or blank for no limit";
    const other = toNumber(config && config[otherKey]);
    if (other !== null && (otherKey === "max" ? number > other : number < other)) {
      return "Min has to be at most Max";
    }
    return stranded(config, key, value);
  };
}

function checkStep(value, config) {
  if (blank(value)) return stranded(config, "step", value);
  const number = toNumber(value);
  if (number === null || number <= 0) return "Step has to be a number above zero, or blank for any";
  return stranded(config, "step", value);
}

/**
 * Judged against the type that will carry it and the limits it has to sit
 * inside: a value the box would refuse from the keyboard is refused from the
 * panel too, and for the same reasons.
 */
function checkValue(value, config) {
  const number = toNumber(value);
  if (number === null) return "The value has to be a number";
  return complaintAbout(config, number);
}

module.exports = { numberInput };
