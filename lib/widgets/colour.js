"use strict";

const { field, enabled, connection, connectionChecks } = require("./fields");
const { message, coalesce } = require("./commit");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");

/**
 * How the colour reaches the other end.
 *
 * There is no single convention, which is exactly why this is a setting rather
 * than a decision baked into the widget: some software wants three channels,
 * some wants four, and some is happiest with the hex string a designer would
 * paste out of a palette.
 */
const COLOUR_FORMATS = [
  { id: "rgb", name: "3 values (r, g, b)" },
  { id: "rgba", name: "4 values (r, g, b, a)" },
  { id: "hex", name: "hex string (#rrggbb)" },
];

/**
 * The scale the channels are expressed on.
 *
 * Normalised is the more common one for a colour *parameter*; 8-bit is what
 * you want when the other end is really asking for a pixel value. Guessing
 * wrong sends 255 where 1 was meant, which reads as white either way and hides
 * the mistake until something clips.
 */
const COLOUR_SCALES = [
  { id: "unit", name: "0 to 1 (normalised)" },
  { id: "byte", name: "0 to 255 (8-bit)" },
];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Parse a hex colour into 0-255 channels, or null.
 *
 * Null rather than black: #000000 is a real colour someone may have chosen on
 * purpose, so it must not double as "we could not read this". A colour we
 * cannot read drops the message instead.
 */
function parseHex(raw) {
  const match = HEX.exec(String(raw == null ? "" : raw).trim());
  if (!match) return null;

  let digits = match[1];
  if (digits.length === 3) {
    // #f0a is shorthand for #ff00aa.
    digits = digits.charAt(0) + digits.charAt(0) + digits.charAt(1) + digits.charAt(1) +
      digits.charAt(2) + digits.charAt(2);
  }

  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
  };
}

/** The form `<input type="color">` insists on: lowercase #rrggbb, or null. */
function normaliseHex(raw) {
  const rgb = parseHex(raw);
  if (!rgb) return null;
  return (
    "#" +
    [rgb.r, rgb.g, rgb.b]
      .map(function (channel) {
        return ("0" + channel.toString(16)).slice(-2);
      })
      .join("")
  );
}

/** 128 -> 0.502, not 0.5019607843137255: nobody downstream needs that tail. */
function round(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * OSC colour picker.
 *
 * A native `<input type="color">` rather than a hand-drawn wheel: it is the one
 * colour control every tablet already knows how to open, it is reachable by
 * keyboard, and it cannot be broken by a CSS change.
 */
const colour = {
  name: "oscar-colour",
  tag: "input",
  attributes: { type: "color", class: "oscar-colour" },

  block: {
    label: "Colour",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M17.5,12A1.5,1.5 0 0,1 16,10.5A1.5,1.5 0 0,1 17.5,9A1.5,1.5 0 0,1 19,10.5A1.5,1.5 0 0,1 ' +
      '17.5,12M14.5,8A1.5,1.5 0 0,1 13,6.5A1.5,1.5 0 0,1 14.5,5A1.5,1.5 0 0,1 16,6.5A1.5,1.5 0 0,1 ' +
      '14.5,8M9.5,8A1.5,1.5 0 0,1 8,6.5A1.5,1.5 0 0,1 9.5,5A1.5,1.5 0 0,1 11,6.5A1.5,1.5 0 0,1 ' +
      '9.5,8M6.5,12A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,1 6.5,9A1.5,1.5 0 0,1 8,10.5A1.5,1.5 0 0,1 ' +
      '6.5,12M12,3A9,9 0 0,0 3,12A9,9 0 0,0 12,21A1.5,1.5 0 0,0 13.5,19.5C13.5,19.11 13.35,18.76 ' +
      '13.11,18.5C12.88,18.23 12.73,17.88 12.73,17.5A1.5,1.5 0 0,1 14.23,16H16A5,5 0 0,0 ' +
      '21,11C21,6.58 16.97,3 12,3Z"/></svg>',
  },

  defaults: {
    enabled: true,
    ip: "localhost",
    port: 7000,
    message: "/colour",
    value: "#ff0000",
    format: "rgb",
    scale: "unit",
    alpha: 1,
    argType: "f",
  },

  fields: [enabled()].concat(connection()).concat([
    field("value", "Colour", "text", { placeholder: "#rrggbb" }),
    field("format", "Send as", "select", { options: COLOUR_FORMATS }),
    field("scale", "Range", "select", { options: COLOUR_SCALES }),
    field("alpha", "Alpha", "number", { min: 0, max: 1, step: "any" }),
    field("argType", "Argument type", "select", { options: NUMERIC_ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
    value: checkColour,
    alpha: checkAlpha,
  }),

  attach: function (el, ctx) {
    apply();

    /**
     * Put the stored colour on the swatch after a load.
     *
     * The native control falls back to #000000 when handed anything it does not
     * recognise, so a project saved with a bad hex would silently come back
     * black. Only write a colour we could parse.
     */
    function apply() {
      const hex = normaliseHex(ctx.get("value"));
      if (hex) el.value = hex;
    }

    // Dragging inside the OS colour picker fires `input` continuously, and a
    // colour is worth watching live -- you pick by looking at the rig, not at
    // the swatch. One send per frame keeps that live without flooding; `change`
    // (the picker being dismissed) sends the final colour exactly.
    const stream = coalesce(function (hex) {
      ctx.send(resolve(ctx, hex));
    });

    function onInput() {
      const hex = normaliseHex(el.value);
      if (!hex) return;
      ctx.set("value", hex);
      stream.push(hex);
    }

    function onChange() {
      onInput();
      stream.flush();
    }

    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    // A format or scale edit changes what the same colour means on the wire;
    // nothing is sent until the next pick, but the swatch must still agree with
    // a hand-edited Colour field.
    const stop = ctx.onChange(["value"], apply);

    return function detach() {
      stream.stop();
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", onChange);
      if (stop) stop();
    };
  },
};

/** The values this colour becomes, in order, or null if it cannot be sent. */
function channels(ctx, hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;

  const byte = ctx.get("scale") === "byte";
  const scale = function (channel) {
    return byte ? channel : round(channel / 255);
  };

  const values = [scale(rgb.r), scale(rgb.g), scale(rgb.b)];
  if (ctx.get("format") !== "rgba") return values;

  // Alpha is configured rather than picked: `<input type="color">` has no
  // alpha channel at all. It is always typed as 0-1 in the panel and scaled
  // here, so switching Range does not silently reinterpret it.
  // toNumber, not Number: Number("") is 0 and Number.isFinite(0) is true, so a
  // blank alpha would sail through as fully transparent. A blank or mistyped
  // alpha is a question, and answering it with a guess is how a cue goes out
  // wrong in front of an audience.
  const alpha = toNumber(ctx.get("alpha"));
  if (alpha === null) return null;

  values.push(byte ? Math.round(alpha * 255) : round(alpha));
  return values;
}

function resolve(ctx, raw) {
  if (ctx.get("format") === "hex") {
    const hex = normaliseHex(raw);
    if (hex === null) return null;
    // A hex colour is a string by definition; the Argument type setting
    // governs the numeric formats and has nothing to say here.
    return message(ctx, hex, { argType: "s" });
  }

  const values = channels(ctx, raw);
  if (values === null) return null;
  return message(ctx, values);
}

function checkColour(value) {
  if (normaliseHex(value)) return null;
  return "A colour is a hex code, like #ff8800";
}

function checkAlpha(value) {
  const alpha = toNumber(value);
  if (alpha !== null && alpha >= 0 && alpha <= 1) return null;
  return "Alpha has to be a number between 0 and 1";
}

module.exports = { colour, COLOUR_FORMATS, COLOUR_SCALES, parseHex, normaliseHex };
