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
 * and is the quickest thing to type. A value holding a comma or a semicolon
 * is the price of that choice; OSC values rarely do.
 */
function parseOptions(raw) {
  const options = [];
  for (const part of String(raw === null || raw === undefined ? "" : raw).split(/[,;]/)) {
    const item = part.trim();
    if (!item) continue;
    const split = item.indexOf("=");
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
 * moment a choice is made. On DMX the option's value is the level, 0-255,
 * so "Off=0, Half=128, Full=255" is a three-step dimmer.
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
    category: "OSC",
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
    dmxDefaults(1)
  ),

  fields: [enabled(), transport()]
    .concat(connection())
    .concat([
      listen(),
      field("options", "Options", "text", { placeholder: "Red=1, Green=2, Blue=3" }),
      field("value", "Selected", "text"),
      field("argType", "Argument type", "select", { options: ARG_TYPES }),
    ])
    .concat(dmxFields()),

  checks: Object.assign({}, connectionChecks(), dmxChecks(1), {
    options: checkOptions,
    value: checkValue,
    argType: checkArgType(function (config) {
      return values(config.options).concat([config.value]);
    }),
  }),

  attach: function (el, ctx) {
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
      const raw = el.value;
      ctx.set("value", raw);
      ctx.send(outgoing(routing(ctx), raw, levelOf(raw)));
    }

    /**
     * Take a value the rig sent: select the option that sends it, and stop
     * there. Compared as text, so the 1 an int option comes back as finds
     * "Red=1". A value no option sends, or nothing OSCAR could read, is
     * ignored rather than shown as a blank box.
     */
    function adopt(values) {
      const value = values[0];
      if (value === null || value === undefined || typeof value === "object") return;
      const wanted = String(value);
      if (!offers(parseOptions(ctx.get("options")), wanted)) return;
      ctx.set("value", wanted);
      el.value = wanted;
    }

    el.addEventListener("input", onPick);
    const stop = ctx.onChange(["options", "value"], render);
    const stopOsc = follow(ctx, adopt);

    return function detach() {
      el.removeEventListener("input", onPick);
      if (stop) stop();
      if (stopOsc) stopOsc();
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

/** Every option has to be sendable as the chosen type, and there has to be one. */
function checkOptions(raw, config) {
  const options = parseOptions(raw);
  if (!options.length) return "List the options like: Red=1, Green=2, Blue=3";
  const argType = (config && config.argType) || "i";
  for (const option of options) {
    const complaint = refusal(argType, option.value);
    if (complaint) return complaint;
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
