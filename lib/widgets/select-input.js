"use strict";

const { field, enabled, connection, connectionChecks } = require("./fields");
const { message } = require("./commit");
const { ARG_TYPES, isSendable } = require("../osc-args");

/**
 * Turn the designer's option list into options.
 *
 * One option per line would read better, but every trait in the settings panel
 * is a single-line control -- text, number, select or checkbox -- so a newline
 * can never be typed into one. Commas are the only separator that survives the
 * panel, so commas it is:
 *
 *   Red=1, Green=2, Blue=3
 *
 * An item with no "=" is its own label and value, so a bare "1, 2, 3" works
 * and is the quickest thing to type. A value containing a comma is the price
 * of that choice; OSC values rarely do.
 */
function parseOptions(raw) {
  const options = [];

  for (const part of String(raw == null ? "" : raw).split(",")) {
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
 * A native `<select>` because a tablet renders it as the platform's own picker
 * -- a full-height wheel on iOS, a sheet on Android -- which beats anything
 * hand-drawn for hitting the right row with a thumb.
 */
const selectInput = {
  name: "oscar-select",
  tag: "select",
  attributes: { class: "oscar-select" },

  block: {
    label: "Dropdown",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M2,5H22A1,1 0 0,1 23,6V18A1,1 0 0,1 22,19H2A1,1 0 0,1 1,18V6A1,1 0 0,1 ' +
      '2,5M3,7V17H21V7H3M15,10H19L17,13L15,10Z"/></svg>',
  },

  defaults: {
    enabled: true,
    ip: "localhost",
    port: 7000,
    message: "/preset",
    options: "One=1, Two=2, Three=3",
    value: "1",
    argType: "i",
  },

  fields: [enabled()].concat(connection()).concat([
    field("options", "Options", "text", { placeholder: "Red=1, Green=2, Blue=3" }),
    field("value", "Value", "text"),
    field("argType", "Argument type", "select", { options: ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
    options: checkOptions,
  }),

  attach: function (el, ctx) {
    render();

    /**
     * Rebuild the list from the Options setting.
     *
     * The <option> elements are never part of the saved component: the setting
     * is the single source of truth, and rendering from it on every attach
     * means an edited list cannot drift from the markup. The cost is that an
     * exported page needs OSCAR to fill the list in, which the preview does.
     */
    function render() {
      const options = parseOptions(ctx.get("options"));
      const selected = String(ctx.get("value") == null ? "" : ctx.get("value"));

      el.innerHTML = options
        .map(function (option) {
          return (
            '<option value="' +
            escapeHtml(option.value) +
            '">' +
            escapeHtml(option.label) +
            "</option>"
          );
        })
        .join("");

      // Only restore a selection the list still offers; otherwise leave the
      // browser on the first option, which is what it is actually showing.
      const has = options.some(function (option) {
        return option.value === selected;
      });
      if (has) el.value = selected;
      else if (options.length) ctx.set("value", options[0].value);
    }

    // One pick, one message. A dropdown has no intermediate states to flood
    // with -- `change` fires once, when a choice is actually made.
    function onChange() {
      const raw = el.value;
      ctx.set("value", raw);
      ctx.send(message(ctx, raw));
    }

    el.addEventListener("change", onChange);
    const stop = ctx.onChange(["options", "value"], render);

    return function detach() {
      el.removeEventListener("change", onChange);
      if (stop) stop();
    };
  },
};

function checkOptions(value, config) {
  const options = parseOptions(value);
  if (!options.length) return "List the options like: Red=1, Green=2, Blue=3";

  const argType = (config && config.argType) || "s";
  for (const option of options) {
    if (!isSendable(argType, option.value)) {
      return 'The value "' + option.value + '" cannot be sent as ' + argType;
    }
  }
  return null;
}

module.exports = { selectInput, parseOptions };
