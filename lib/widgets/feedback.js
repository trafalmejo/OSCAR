"use strict";

const { field, enabled, oscFields, checkMessage, checkListenFrom } = require("./fields");
const { follow } = require("./incoming");
const { onShared } = require("./shared");
const { toNumber } = require("../osc-args");

/**
 * Device feedback: the show reaching the phone.
 *
 * Everything else on a surface is the phone reaching the show. This widget
 * points the other way: a message arriving at its address makes the phone
 * do something a person feels or sees -- a vibration, a flash of colour
 * over the widget's box, the torch on or off -- so a cue can be felt in a
 * pocket, or a crowd's phones can light up together.
 *
 * It sends nothing, ever, so it has no Ip or Port: Message is the address
 * it follows, and Listen is on from the start because following is the
 * whole of what it does. A value above zero, or a message with no value at
 * all, is "go"; zero is "stop", which only the torch has a use for. Software
 * that pulses a cue sends 1 then 0.
 *
 * The vibration and the torch belong to the phone, and the widget asks its
 * host for them through `ctx.device` (the ctx contract in index.js): a
 * browser on Android can vibrate, one on an iPhone cannot, and only the
 * OSCAR app can reach the torch. The flash is the widget's own box and
 * works everywhere, the editor included. Where a feeling is asked for that
 * the host cannot give, the box says so and does what it can.
 *
 * On a phone that cannot hear the rig (through the relay), OSCAR hears for
 * it and passes the state on (lib/surfaces.js, `hear` below), so the
 * widget acts on what another device shows exactly as on what the rig sent.
 */

/** On the element while it flashes. Styled in public/assets/css/toggle.css. */
const FLASH_CLASS = "oscar-flash";

const MS_MAX = 10000;

const feedback = {
  name: "oscar-feedback",
  tag: "div",
  attributes: { class: "oscar-feedback" },

  sends: false,
  receives: true,
  dmx: false,

  block: {
    label: "Device feedback",
    category: "IO Widgets",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M17,1H7A2,2 0 0,0 5,3V21A2,2 0 0,0 7,23H17A2,2 0 0,0 19,21V3A2,2 0 0,0 17,1M17,19H7V5H17V19' +
      'M1,9H3V15H1V9M21,9H23V15H21V9M12,7L9,12H11V17L15,11H13L12,7Z"/></svg>',
  },

  defaults: {
    enabled: true,
    label: "Feedback",
    message: "/feedback",
    // It exists to follow something; there is nothing it could start doing
    // on its own that a hand would have to fight.
    listen: true,
    oscListenFrom: "any",
    vibrate: true,
    vibrateMs: 200,
    flash: true,
    flashColour: "#ff3663",
    flashMs: 300,
    torch: false,
  },

  fields: [enabled(), field("label", "Label", "text")]
    .concat(oscFields({ sends: false }))
    .concat([
      field("vibrate", "Vibrate", "checkbox", { hint: "Android phones and the OSCAR app. A browser on an iPhone cannot." }),
      field("vibrateMs", "Vibration (ms)", "number", { min: 1, max: MS_MAX }),
      field("flash", "Flash the box", "checkbox"),
      field("flashColour", "Flash colour", "text", { placeholder: "#ff3663" }),
      field("flashMs", "Flash (ms)", "number", { min: 1, max: MS_MAX }),
      field("torch", "Torch", "checkbox", { hint: "The OSCAR app only: on above zero, off at zero." }),
    ]),

  checks: {
    message: checkMessage,
    oscListenFrom: checkListenFrom,
    vibrateMs: checkMs("Vibration"),
    flashMs: checkMs("Flash"),
    flashColour: checkColour,
  },

  /**
   * The state a message puts the widget in: { value, at }, a bare message
   * counting as 1. For OSCAR following the rig on behalf of the pages it
   * serves (lib/surfaces.js). `at` is when the cue arrived: OSCAR tells
   * the devices of a state only when it changed, and a cue is news every
   * time, however often the same value is sent -- two "/cue 1" are two
   * vibrations. The stamp makes each one a change.
   */
  hear: function (config, values) {
    const value = values && values.length ? toNumber(values[0]) : 1;
    return value === null ? null : { value: value, at: Date.now() };
  },

  attach: function (el, ctx) {
    const device = ctx.device || null;
    let flashTimer = null;
    let torchOn = false;

    function canVibrate() {
      return !!(device && typeof device.vibrate === "function");
    }
    function canTorch() {
      return !!(device && typeof device.torch === "function");
    }

    function paint() {
      const label = ctx.get("label") || "";
      const missing = [];
      if (ctx.get("vibrate") && !canVibrate()) missing.push("vibration");
      if (ctx.get("torch") && !canTorch()) missing.push("torch");
      el.textContent = missing.length ? (label ? label + " · " : "") + "needs the app for " + missing.join(" and ") : label;
      const colour = String(ctx.get("flashColour") || "").trim();
      if (colour) el.style.setProperty("--oscar-flash", colour);
      ctx.setClass(FLASH_CLASS, flashTimer !== null);
    }

    function ms(key) {
      const value = toNumber(ctx.get(key));
      return value !== null && value > 0 ? Math.min(MS_MAX, value) : 0;
    }

    /** Act on a value: above zero is go, zero is stop. Never sends, never shares. */
    function act(value) {
      if (value === null) return;
      const on = value > 0;
      if (on && ctx.get("vibrate") && canVibrate() && ms("vibrateMs")) {
        try {
          device.vibrate(ms("vibrateMs"));
        } catch (err) {
          /* a phone that will not */
        }
      }
      if (on && ctx.get("flash") && ms("flashMs")) flash(ms("flashMs"));
      if (ctx.get("torch") && canTorch() && torchOn !== on) {
        torchOn = on;
        try {
          const done = device.torch(on);
          if (done && typeof done.catch === "function") done.catch(function () {});
        } catch (err) {
          /* no torch after all */
        }
      }
    }

    function flash(duration) {
      if (flashTimer !== null) clearTimeout(flashTimer);
      flashTimer = setTimeout(function () {
        flashTimer = null;
        ctx.setClass(FLASH_CLASS, false);
      }, duration);
      if (flashTimer && typeof flashTimer.unref === "function") flashTimer.unref();
      ctx.setClass(FLASH_CLASS, true);
    }

    paint();

    // Who hears the rig for this widget. On a page OSCAR serves, OSCAR does
    // (ctx.followed), and the cue arrives as a state; everywhere else the
    // page reads the message itself. Never both: that would be two buzzes.
    const followed = ctx.followed === true;
    const stopOsc = follow(ctx, function (values) {
      if (followed) return;
      act(values.length ? toNumber(values[0]) : 1);
    });
    // The state already known is handed over as the widget subscribes: a
    // cue from before this page opened, which is not a cue for it. Only a
    // state that arrives afterwards, and is newer than the last, is one.
    let live = false;
    let lastAt = null;
    const stopShared = onShared(ctx, function (state) {
      if (!followed || !state || state.value === undefined) return;
      const at = toNumber(state.at);
      const seen = at !== null && at === lastAt;
      if (at !== null) lastAt = at;
      if (!live || seen) return;
      act(toNumber(state.value));
    });
    live = true;
    const stopChange = ctx.onChange(["label", "flashColour", "vibrate", "torch"], paint);
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(paint) : null;

    return function detach() {
      if (flashTimer !== null) clearTimeout(flashTimer);
      flashTimer = null;
      // A torch left on by a page that is going away stays on; say stop.
      if (torchOn && canTorch()) {
        try {
          const done = device.torch(false);
          if (done && typeof done.catch === "function") done.catch(function () {});
        } catch (err) {
          /* already dark */
        }
      }
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
      if (stopChange) stopChange();
      if (stopRewrite) stopRewrite();
    };
  },
};

function checkMs(what) {
  return function (value) {
    const n = toNumber(value);
    if (n !== null && n >= 1 && n <= MS_MAX) return null;
    return what + " has to be between 1 and " + MS_MAX + " milliseconds";
  };
}

function checkColour(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "Flash colour has to be a colour, like #ff3663 or red";
  if (/[;{}<>]/.test(text)) return "Flash colour has to be a colour, not a style rule";
  return null;
}

module.exports = { feedback, FLASH_CLASS };
