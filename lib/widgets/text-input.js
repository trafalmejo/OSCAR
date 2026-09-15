"use strict";

const { field, enabled, listen, connection, connectionChecks } = require("./fields");
const { onIncoming } = require("./incoming");
const { message, commit } = require("./commit");
const { ARG_TYPES, isSendable } = require("../osc-args");

/**
 * OSC text entry: type a string, press Enter, send it.
 *
 * The full argument-type list rather than just string, because the thing that
 * makes a typed box useful is that it carries whatever you type -- a clip name
 * today, a cue number tomorrow -- and forcing "s" would mean dropping in a
 * different widget for the second case.
 */
const textInput = {
  name: "oscar-text",
  tag: "input",
  attributes: { type: "text", class: "oscar-entry" },

  block: {
    label: "Text Input",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M17,7H22V17H17V19A1,1 0 0,0 18,20H20V22H17.5C16.95,22 16,21.55 16,21C16,21.55 15.05,22 ' +
      '14.5,22H12V20H14A1,1 0 0,0 15,19V5A1,1 0 0,0 14,4H12V2H14.5C15.05,2 16,2.45 16,3C16,2.45 ' +
      '16.95,2 17.5,2H20V4H18A1,1 0 0,0 17,5V7M2,7H13V9H4V15H13V17H2V7M20,15V9H17V15H20Z"/></svg>',
  },

  defaults: {
    enabled: true,
    ip: "localhost",
    port: 7000,
    message: "/text",
    value: "",
    placeholder: "Type, then press Enter",
    listen: false,
    argType: "s",
  },

  fields: [enabled()].concat(connection()).concat([
    listen(),
    field("value", "Value", "text"),
    field("placeholder", "Placeholder", "text"),
    field("argType", "Argument type", "select", { options: ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
    value: checkValue,
  }),

  attach: function (el, ctx) {
    apply();

    /** Show the stored text, so a reload does not empty the box. */
    function apply() {
      const value = ctx.get("value");
      el.value = value == null ? "" : String(value);
      const hint = ctx.get("placeholder");
      el.placeholder = hint == null ? "" : String(hint);
    }

    const stop = commit(el, function (raw) {
      ctx.set("value", raw);
      ctx.send(message(ctx, raw));
    });

    const unsubscribe = ctx.onChange(["value", "placeholder"], apply);


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

/** Judged against the type it will be sent as: "abc" is fine as s, not as f. */
function checkValue(value, config) {
  const argType = (config && config.argType) || "s";
  if (isSendable(argType, value)) return null;
  return 'The value "' + value + '" cannot be sent as ' + argType;
}

module.exports = { textInput };
