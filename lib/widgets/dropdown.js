"use strict";

const {
  field,
  oscFields,
  enabled,
  connectionChecks,
  dmxFields,
  dmxDefaults,
  dmxChecks,
  sendsDmx,
} = require("./fields");
const { midiFields, midiDefaults, midiChecks } = require("./midi-fields");
const { outgoing, routing, asCtx } = require("./outgoing");
const { follow } = require("./incoming");
const { share, onShared } = require("./shared");
const { refusal, checkArgType, levelOf } = require("./typed");
const { ARG_TYPES } = require("../osc-args");

/**
 * Turn the designer's option list into options.
 *
 * One option per line would read better, but every setting in the panel is a
 * single-line control, so a newline can never be typed into one. Commas and
 * semicolons are the separators that survive the panel:
 *
 *   Red=1, Green=2, Blue=3
 *   Off=0; Half=128; Full=255
 *
 * An item with no "=" is its own label and value, so a bare "1, 2, 3" works
 * and is the quickest thing to type. A label or value holding a comma or a
 * semicolon is the price of that choice; OSC values rarely do. The split is
 * at the LAST "=": labels are written for people and do hold one ("EQ=flat"),
 * values are written for a rig and almost never do.
 */
function parseOptions(raw) {
  const options = [];
  for (const part of String(raw === null || raw === undefined ? "" : raw).split(/[,;]/)) {
    const item = part.trim();
    if (!item) continue;
    const split = item.lastIndexOf("=");
    if (split === -1) {
      options.push({ label: item, value: item });
      continue;
    }
    const label = item.slice(0, split).trim();
    const value = item.slice(split + 1).trim();
    options.push({ label: label || value, value: value });
  }
  return options;
}

/** The designer's text is content, never markup. */
function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, function (character) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character];
  });
}

/**
 * OSC dropdown: a fixed list of cues, each sending its own value.
 *
 * A native select, because a tablet renders it as the platform's own picker
 * -- a wheel on iOS, a sheet on Android -- which beats anything hand-drawn
 * for hitting the right row with a thumb. One pick is one message: a
 * dropdown has no half-typed states to flood the wire with, so it sends the
 * moment a choice is made -- by pointer or touch. A keyboard walking a closed
 * list raises a pick for every row it passes, and those are no more choices
 * than the 1 in 12.5 is a number: they wait for Enter, or for the list to be
 * left. On DMX the option's value is the level, 0-255, so "Off=0, Half=128,
 * Full=255" is a three-step dimmer; the panel refuses an option that is not
 * one while DMX's Enable is ticked.
 *
 * With Listen on, a value arriving at Message selects the option that sends
 * it; a value no option sends changes nothing.
 */
const dropdown = {
  name: "oscar-dropdown",
  tag: "select",
  attributes: { class: "oscar-dropdown" },

  sends: true,
  receives: true,
  dmx: true,

  block: {
    label: "Dropdown",
    category: "IO Widgets",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M2,5H22A1,1 0 0,1 23,6V18A1,1 0 0,1 22,19H2A1,1 0 0,1 1,18V6A1,1 0 0,1 ' +
      '2,5M3,7V17H21V7H3M15,10H19L17,13L15,10Z"/></svg>',
  },

  defaults: Object.assign(
    {
      enabled: true,
      ip: "localhost",
      port: 7000,
      message: "/dropdown1",
      listen: false,
      options: "Red=1, Green=2, Blue=3",
      value: "1",
      argType: "i",
    },
    dmxDefaults(1),
    midiDefaults("program")
  ),

  fields: [enabled()]
    .concat(oscFields())
    .concat([
      field("options", "Options", "text", { placeholder: "Red=1, Green=2, Blue=3" }),
      field("value", "Selected", "text"),
      field("argType", "Argument type", "select", { section: "osc", options: ARG_TYPES }),
    ])
    .concat(dmxFields())
    .concat(midiFields()),

  checks: Object.assign({}, connectionChecks(), dmxChecks(1), midiChecks(1), {
    options: checkOptions,
    value: checkValue,
    // Sending DMX decides whether the options have to be levels, so switching
    // it on is judged like editing them: from either side, as argType is.
    dmxEnabled: function (value, config) {
      const next = Object.assign({}, config, { dmxEnabled: value, transport: undefined });
      return checkOptions(next.options, next);
    },
    argType: checkArgType(function (config) {
      return values(config.options).concat([config.value]);
    }),
  }),

  /** How a state for drive() is asked for: one of the rows. */
  driveInput: function (config) {
    return { kind: "choice", options: parseOptions(config.options) };
  },

  /**
   * What picking this row sends: { state: { value }, message }, or null for
   * a value the list does not offer. See `drive` in lib/widgets/index.js.
   */
  drive: function (config, state) {
    const value = text(state && state.value);
    if (!offers(parseOptions(config.options), value)) return null;
    return { state: { value: value }, message: outgoing(routing(asCtx(config)), value, levelOf(value)) };
  },

  attach: function (el, ctx) {
    // Whether the last thing to touch the list was a key, and whether a pick
    // made that way is still waiting to be sent.
    let byKey = false;
    let pending = false;

    render();

    /**
     * Build the list from the Options setting.
     *
     * The option elements are never part of the saved widget: the setting is
     * the one source of truth, and rendering from it on every attach means an
     * edited list cannot drift from the markup. A stored selection the list
     * no longer offers falls back to the first option, and is stored as such,
     * so the box and the project agree on what is showing.
     */
    function render() {
      pending = false;
      const options = parseOptions(ctx.get("options"));
      el.innerHTML = options
        .map(function (option) {
          return '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + "</option>";
        })
        .join("");

      const selected = text(ctx.get("value"));
      if (offers(options, selected)) {
        el.value = selected;
      } else if (options.length) {
        el.value = options[0].value;
        ctx.set("value", options[0].value);
      }
    }

    // A select raises `input` and `change` together for one pick, so one of
    // them is enough; `input` is the one every host can raise, as a
    // browser does for anything a control's value changes through.
    function onPick() {
      if (byKey) pending = true;
      else commit();
    }

    function commit() {
      pending = false;
      const raw = el.value;
      ctx.set("value", raw);
      const message = outgoing(routing(ctx), raw, levelOf(raw));
      ctx.send(message);
      // Only a pick that went out is news: a row chosen on a disabled list
      // reached nothing, and must not be shown as chosen on the other devices.
      if (message) share(ctx, { value: raw });
    }

    // An open list keeps its arrow keys to itself and raises one pick when a
    // row is chosen, often with the Enter that chose it already seen here;
    // so Enter also ends keyboard mode and that pick goes straight out.
    function onKeyDown(e) {
      if (e.key !== "Enter") {
        byKey = true;
        return;
      }
      byKey = false;
      if (pending) commit();
    }

    function onPointerDown() {
      byKey = false;
    }

    // Tabbing away from a row is choosing it, as leaving a text box is.
    function onBlur() {
      byKey = false;
      if (pending) commit();
    }

    /**
     * Take a value the rig sent: select the option that sends it, and stop
     * there. Compared as text, so the 1 an int option comes back as finds
     * "Red=1". A value no option sends, or nothing OSCAR could read, is
     * ignored rather than shown as a blank box.
     */
    function adopt(values) {
      // Every device heard the rig, so it is recorded for whoever joins later
      // and passed to nobody.
      if (take(values[0])) share(ctx, { value: el.value }, { heard: true });
    }

    /** Another device picked. Shown, and never shared again: it came from there. */
    function adoptShared(state) {
      if (state) take(state.value);
    }

    /** Show a value that arrived, from the rig or from another device. */
    function take(value) {
      if (value === null || value === undefined || typeof value === "object") return false;
      const wanted = String(value);
      if (!offers(parseOptions(ctx.get("options")), wanted)) return false;
      ctx.set("value", wanted);
      el.value = wanted;
      // Something has spoken since the keyboard passed by; sending the passed
      // row now would answer it.
      pending = false;
      return true;
    }

    el.addEventListener("input", onPick);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("blur", onBlur);
    const stop = ctx.onChange(["options", "value"], render);
    const stopOsc = follow(ctx, adopt);
    const stopShared = onShared(ctx, adoptShared);

    return function detach() {
      el.removeEventListener("input", onPick);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("blur", onBlur);
      if (stop) stop();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

function text(value) {
  return value === null || value === undefined ? "" : String(value);
}

function offers(options, value) {
  return options.some(function (option) {
    return option.value === value;
  });
}

function values(raw) {
  return parseOptions(raw).map(function (option) {
    return option.value;
  });
}

/**
 * Every option has to be sendable, and there has to be one.
 *
 * Sendable on every protocol switched on: as the chosen type on OSC, and as a
 * level, 0-255, on DMX. "A=abc" is a fine string and no level at all, and
 * "A=300" is no level either -- pinned to 255, or -5 to a blackout, it would
 * be a cue the designer never wrote. Without this the dropdown looks live
 * and that option sends nothing.
 *
 * Two options may not send the same value: the value is all that is stored
 * and all that comes back from the rig, so the second could be picked but
 * never shown again.
 */
function checkOptions(raw, config) {
  const options = parseOptions(raw);
  if (!options.length) return "List the options like: Red=1, Green=2, Blue=3";
  const argType = (config && config.argType) || "i";
  const seen = {};
  for (const option of options) {
    const complaint = refusal(argType, option.value);
    if (complaint) return complaint;
    if (sendsDmx(config) && levelOf(option.value) === null) {
      return 'The value "' + option.value + '" is not a DMX level; on DMX every option has to be a number from 0 to 255';
    }
    if (seen["=" + option.value]) return 'Two options send "' + option.value + '"; each option needs its own value';
    seen["=" + option.value] = true;
  }
  return null;
}

/** The selection has to be one of the options; the list is what can be picked. */
function checkValue(value, config) {
  const options = parseOptions(config && config.options);
  if (options.length && !offers(options, text(value))) {
    return 'The selection "' + value + '" is not one of the options';
  }
  return refusal((config && config.argType) || "i", value);
}

module.exports = { dropdown, parseOptions };
