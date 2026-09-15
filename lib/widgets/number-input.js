"use strict";

const { field, enabled, listen, connection, connectionChecks } = require("./fields");
const { onIncoming } = require("./incoming");
const { message, commit } = require("./commit");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");

/** A blank limit means "no limit", which is different from a limit of zero. */
function limit(raw) {
  return toNumber(raw);
}

/**
 * OSC number entry: type an exact value instead of hunting for it with a fader.
 *
 * The whole point of the request behind this widget is that some values are
 * known -- 127, 0.5, cue 12 -- and dragging a slider until it happens to land
 * on one is guesswork.
 */
const numberInput = {
  name: "oscar-number",
  tag: "input",
  attributes: { type: "number", class: "oscar-entry", step: "any" },

  block: {
    label: "Number Input",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M4,17V9H2V7H6V17H4M22,15C22,16.11 21.1,17 20,17H16V15H20V13H18V11H20V9H16V7H20A2,2 0 0,1 ' +
      '22,9V10.5A1.5,1.5 0 0,1 20.5,12A1.5,1.5 0 0,1 22,13.5V15M14,15V17H8V13C8,11.89 8.9,11 ' +
      '10,11H12V9H8V7H12A2,2 0 0,1 14,9V11C14,12.11 13.1,13 12,13H10V15H14Z"/></svg>',
  },

  defaults: {
    enabled: true,
    ip: "localhost",
    port: 7000,
    message: "/number",
    value: 0,
    min: "",
    max: "",
    step: "any",
    listen: false,
    argType: "f",
  },

  fields: [enabled()].concat(connection()).concat([
    listen(),
    field("value", "Value", "number", { step: "any" }),
    field("min", "Min", "number", { step: "any", placeholder: "no limit" }),
    field("max", "Max", "number", { step: "any", placeholder: "no limit" }),
    field("step", "Step", "text", { placeholder: "any" }),
    field("argType", "Argument type", "select", { options: NUMERIC_ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
    min: checkLimit("Min"),
    max: checkLimit("Max"),
    value: checkValue,
  }),

  attach: function (el, ctx) {
    apply();

    /**
     * Push the configured range and value onto the native input.
     *
     * min/max go on the element too, not only into the clamp below, so the
     * stepper arrows and a phone's numeric keypad already know the range.
     */
    function apply() {
      const low = limit(ctx.get("min"));
      const high = limit(ctx.get("max"));
      el.min = low === null ? "" : String(low);
      el.max = high === null ? "" : String(high);
      el.step = String(ctx.get("step") || "any");

      const value = toNumber(ctx.get("value"));
      el.value = value === null ? "" : String(value);
    }

    function clamp(value) {
      const low = limit(ctx.get("min"));
      const high = limit(ctx.get("max"));
      let result = value;
      if (low !== null) result = Math.max(low, result);
      if (high !== null) result = Math.min(high, result);
      return result;
    }

    const stop = commit(el, function (raw) {
      const value = toNumber(raw);
      // Number("") and Number(null) are both 0, and on a rig 0 means off. An
      // empty or half-typed box is a question, not a zero: send nothing, and
      // leave the text exactly as it was typed so it can be finished.
      if (value === null) return raw;

      const clamped = clamp(value);
      ctx.set("value", clamped);
      ctx.send(message(ctx, clamped));
      // Show what actually went out. Typing 500 into a box limited to 255 and
      // watching it stay at 500 while the rig sits at 255 is a lie.
      el.value = String(clamped);
      return el.value;
    });

    const unsubscribe = ctx.onChange(["value", "min", "max", "step"], apply);


    // A value arriving from the network fills the control but never leaves it
    // again. Answering an incoming message with an outgoing one is the loop
    // that ends only when somebody pulls a cable.
    const stopOsc = onIncoming(ctx, function (values) {
      if (!values.length) return;
      ctx.set("value", values[0]);
      apply();
    });

    return function detach() {
      if (stopOsc) stopOsc();
      stop();
      if (unsubscribe) unsubscribe();
    };
  },
};

/** Blank is allowed -- it is how you say "unbounded". Nonsense is not. */
function checkLimit(label) {
  return function (value) {
    if (value === "" || value === null || value === undefined) return null;
    if (Number.isFinite(Number(value))) return null;
    return label + " has to be a number, or empty for no limit";
  };
}

function checkValue(value, config) {
  if (toNumber(value) === null) return "The value has to be a number";

  const number = Number(value);
  const low = limit(config && config.min);
  const high = limit(config && config.max);
  if (low !== null && number < low) return "The value has to be at least " + low;
  if (high !== null && number > high) return "The value has to be at most " + high;
  return null;
}

module.exports = { numberInput };
