"use strict";

const { field, enabled, listen, connection, connectionChecks } = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { follow } = require("./incoming");
const { share, onShared } = require("./shared");
const { commitOn, refusal, checkArgType } = require("./typed");
const { ARG_TYPES } = require("../osc-args");

/**
 * OSC text box: type a value, press Enter, and it goes out.
 *
 * The full argument-type list, not only string: the thing that makes a typed
 * box useful is that it carries whatever is typed -- a clip name today, a cue
 * number tomorrow -- and the panel refuses a value the chosen type cannot
 * carry rather than sending nothing without a word. Sends on Enter and on
 * leaving the field, never per keystroke; typed.js says why. Not a DMX
 * widget: text is not a level.
 *
 * With Listen on, a value arriving at Message is shown in the box -- unless
 * the box is being typed into, in which case the operator's half-written
 * value outranks the network.
 */
const textInput = {
  name: "oscar-text-input",
  tag: "input",
  // Browsers offer previously typed text in any text box; on a control
  // surface those suggestions are noise over the cue being typed. The
  // enterkeyhint puts "send" on a phone keyboard's Enter, which is what it
  // does here.
  attributes: { type: "text", class: "oscar-text-input", autocomplete: "off", enterkeyhint: "send" },

  sends: true,
  receives: true,
  dmx: false,

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
    message: "/text1",
    listen: false,
    value: "",
    placeholder: "Type, then press Enter",
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
    argType: checkArgType(function (config) {
      return text(config.value).trim() ? [config.value] : [];
    }),
  }),

  attach: function (el, ctx) {
    const entry = commitOn(el, function (raw) {
      // An empty box has nothing in it to send. Left to the argument types it
      // would still go out -- "" as a string, F as a bool, a bare address as
      // none -- and F is a real cue fired by pressing Enter on nothing. The
      // emptiness is kept, so a cleared box stays cleared after a reload.
      if (!raw.trim()) {
        ctx.set("value", "");
        return;
      }
      // Refused before it is stored: "GO" in a float box goes nowhere, and
      // must not end up in the project, where the panel would refuse it.
      if (refusal(ctx.get("argType") || "s", raw)) return;
      ctx.set("value", raw);
      const message = outgoing(routing(ctx), raw);
      ctx.send(message);
      // Only text that went out is news for the other devices. Longer than
      // the server will record is simply not shared.
      if (message) share(ctx, { value: raw });
    });

    apply();

    /** Show the stored text, so a reload does not empty the box. */
    function apply() {
      const hint = ctx.get("placeholder");
      el.placeholder = hint === null || hint === undefined ? "" : String(hint);
      entry.show(text(ctx.get("value")));
    }

    /**
     * Take a value the rig sent: it fills the box and goes no further. A
     * number or a bool is shown as its text; a value OSCAR could not read,
     * or a message with no argument, changes nothing.
     */
    function adopt(values) {
      // Every device heard the rig: recorded for whoever joins later, passed
      // to nobody.
      if (take(values[0])) share(ctx, { value: text(values[0]) }, { heard: true });
    }

    /** Another device typed. Shown, and never shared again: it came from there. */
    function adoptShared(state) {
      if (state) take(state.value);
    }

    /** Show text that arrived, unless a hand is typing here. */
    function take(value) {
      if (entry.editing()) return false;
      if (value === null || value === undefined || typeof value === "object") return false;
      ctx.set("value", text(value));
      apply();
      return true;
    }

    const stop = ctx.onChange(["value", "placeholder"], apply);
    // The host rewriting the element strips the placeholder with the rest.
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

function text(value) {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * A blank Value is fine under any type: it is the box's starting text, and an
 * empty box sends nothing, so a float box may start empty. Anything typed
 * there has to be sendable as the chosen type.
 */
function checkValue(value, config) {
  if (!text(value).trim()) return null;
  return refusal((config && config.argType) || "s", value);
}

module.exports = { textInput };
