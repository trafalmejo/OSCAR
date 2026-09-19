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
const { share, onShared } = require("./shared");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");
const { clamp } = require("../dmx/levels");

/**
 * How the colour is written on the wire.
 *
 * There is no one convention, which is why this is a setting and not a
 * decision baked into the widget: some software wants three channels, some
 * four, and some is happiest with the hex code a designer pastes out of a
 * palette.
 */
const FORMATS = [
  { id: "rgb", name: "3 values (r, g, b)" },
  { id: "rgba", name: "4 values (r, g, b, a)" },
  { id: "hex", name: "hex string (#rrggbb)" },
];

/**
 * The scale the channels are on. Resolume reads a colour parameter as 0-1;
 * TouchDesigner and pixel-minded software read 0-255. Guessing wrong sends
 * 255 where 1 was meant, which reads as white either way and hides the
 * mistake until something clips, so it is asked rather than assumed.
 */
const SCALES = [
  { id: "unit", name: "0 to 1" },
  { id: "byte", name: "0 to 255" },
];

const MAX = 255;

/** Bare or #-prefixed, three or six digits, or four or eight with an alpha. */
const HEX = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Read a hex colour as [r, g, b] bytes, or null.
 *
 * Null rather than black: #000000 is a colour someone may have chosen on
 * purpose, so it cannot double as "this could not be read". The short forms
 * are accepted because they are what a hand types into the Colour field
 * (#f80, or f80 without the hash), and the four- and eight-digit forms
 * because some software writes its colours with an alpha on the end; the
 * swatch has nowhere to show one, so it is dropped.
 */
function parseHex(raw) {
  if (typeof raw !== "string") return null;
  const match = HEX.exec(raw.trim());
  if (!match) return null;

  let digits = match[1];
  if (digits.length <= 4) {
    // #f0a is shorthand for #ff00aa: each digit doubles.
    digits = digits
      .split("")
      .map((d) => d + d)
      .join("");
  }
  return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16));
}

/** The one form <input type="color"> holds: lowercase #rrggbb. */
function toHex(rgb) {
  return "#" + rgb.map((byte) => ("0" + byte.toString(16)).slice(-2)).join("");
}

/** The same colour in the form the swatch holds, or null. */
function normaliseHex(raw) {
  const rgb = parseHex(raw);
  return rgb ? toHex(rgb) : null;
}

/** 128 -> 0.502, not 0.5019607843137255: nothing downstream needs the tail. */
function round(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * OSC colour picker.
 *
 * A native <input type="color"> rather than a hand-drawn wheel: it is the one
 * colour control every tablet already knows how to open, it works with a
 * keyboard, and a CSS edit cannot break it. Dragging inside the OS picker
 * fires input continuously; one send per frame keeps a fixture following
 * the hand without flooding the network, and the change event -- the picker
 * being dismissed -- sends the exact colour chosen.
 *
 * On the wire the colour is three channels, four with an Alpha, or the hex
 * string, on the scale Range says. On DMX it is red, green and blue on three
 * consecutive channels, whatever the OSC format: an RGB fixture is exactly
 * that block, and alpha is not a thing a fixture has (an RGBA fixture's
 * fourth channel is amber).
 *
 * With Listen on, a colour arriving at Message fills the swatch, in either
 * shape OSCAR itself sends: the hex string, or three channels on the same
 * Range (a fourth, alpha, is ignored). Anything unreadable leaves the swatch
 * alone: the native control falls back to black when handed a value it does
 * not understand, and a rig sending nonsense must not black a colour out.
 */
const colour = {
  name: "oscar-colour",
  tag: "input",
  // The slider is an input too; the type is what tells them apart when a
  // project is parsed.
  attributes: { type: "color" },

  sends: true,
  receives: true,
  dmx: true,

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

  defaults: Object.assign(
    {
      enabled: true,
      ip: "localhost",
      port: 7000,
      message: "/colour",
      listen: false,
      value: "#ff0000",
      format: "rgb",
      scale: "unit",
      alpha: 1,
      argType: "f",
    },
    dmxDefaults(3)
  ),

  fields: [enabled(), transport()]
    .concat(connection())
    .concat([
      listen(),
      field("value", "Colour", "text", { placeholder: "#rrggbb" }),
      field("format", "Send as", "select", { options: FORMATS }),
      field("scale", "Range", "select", { options: SCALES }),
      // Alpha is configured, not picked: the native control has no alpha
      // channel. Always typed as 0-1 whatever Range says, so switching Range
      // does not silently reinterpret it.
      field("alpha", "Alpha", "number", { min: 0, max: 1, step: "any", showIf: { key: "format", in: ["rgba"] } }),
      // A hex string is a string by definition; the argument type only has
      // something to say about the numeric formats.
      field("argType", "Argument type", "select", { options: NUMERIC_ARG_TYPES, showIf: { key: "format", in: ["rgb", "rgba"] } }),
    ])
    .concat(dmxFields()),

  checks: Object.assign({}, connectionChecks(), dmxChecks(3), {
    value: checkColour,
    alpha: checkAlpha,
    // One rule, asked from each of the three settings that can bring the
    // combination about, so it is refused whichever is edited last.
    argType: checkWholeNumbers,
    scale: checkWholeNumbers,
    format: checkWholeNumbers,
  }),

  attach: function (el, ctx) {
    // True from the first move inside the picker until it is dismissed. The
    // network is ignored for as long as it is: a colour arriving mid-pick
    // would snatch the swatch out from under the hand.
    //
    // Deliberately NOT set on click or focus. A picker that reports only on
    // OK (the Windows dialog, Android) would be covered that way, but a
    // cancelled dialog fires nothing a page can rely on, and the flag would
    // stay up: a picker deaf to the rig for good is worse than a swatch
    // repainted behind an open dialog, which the next OK puts right.
    let picking = false;
    let frame = null;
    let pending = null;
    // The colour last sent during this pick. The change event repeats the
    // colour the last input already put on a frame, and one pick is one
    // colour, not two copies of it.
    let last = null;

    apply();

    /**
     * Put the stored colour on the swatch after a load. Only a colour that
     * could be read: the native control turns anything else into black.
     */
    function apply() {
      const hex = normaliseHex(ctx.get("value"));
      if (hex) el.value = hex;
    }

    /** Take the swatch's colour as the current one; null if it is unreadable. */
    function read() {
      const hex = normaliseHex(el.value);
      if (hex === null) return null;
      ctx.set("value", hex);
      pending = hex;
      return hex;
    }

    function onInput() {
      picking = true;
      if (read() !== null) schedule();
    }

    /** The picker was dismissed: what it holds is the exact colour chosen. */
    function onChange() {
      read();
      release();
    }

    /**
     * The end of a pick: the change event, or focus leaving the control or
     * the window before one arrived -- the picker closed by an alt-tab, say.
     * What the swatch last held is what goes out, exactly and at once, and
     * the rig is heard again. The next pick starts afresh, so choosing the
     * same colour again later is sent again.
     */
    function release() {
      picking = false;
      flush();
      last = null;
    }

    // A drag across the picker fires far more often than anything needs;
    // one send per frame is plenty. Where there are no frames -- outside a
    // browser -- every move sends, which is what a test wants anyway.
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
    const cancelRaf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : null;

    function schedule() {
      if (!raf) return flush();
      if (frame) return;
      frame = raf(function () {
        frame = null;
        flush();
      });
    }

    function flush() {
      if (frame && cancelRaf) {
        cancelRaf(frame);
        frame = null;
      }
      if (pending === null) return;
      const hex = pending;
      pending = null;
      if (hex === last) return;
      last = hex;
      const message = resolve(ctx, hex);
      ctx.send(message);
      // Only a colour that went out is news for the other devices.
      if (message) share(ctx, { value: hex });
    }

    /**
     * Take a colour the rig sent. Stores it and fills the swatch through
     * apply(), the view-only path -- a colour that came in must never go
     * back out.
     */
    function adopt(values) {
      const hex = fromWire(values, ctx.get("scale"));
      // Every device heard the rig: recorded for whoever joins later, passed
      // to nobody.
      if (take(hex)) share(ctx, { value: hex }, { heard: true });
    }

    /** Another device picked. Shown, and never shared again: it came from there. */
    function adoptShared(state) {
      if (state) take(normaliseHex(state.value));
    }

    /** Fill the swatch with a colour that arrived, unless a hand is picking. */
    function take(hex) {
      if (picking || hex === null) return false;
      ctx.set("value", hex);
      apply();
      return true;
    }

    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    el.addEventListener("blur", release);
    // Guarded so the widget can be exercised outside a browser.
    const root = typeof window === "undefined" ? null : window;
    if (root) root.addEventListener("blur", release);

    // A hand-edited Colour field has to reach the swatch; a format or scale
    // edit changes what the same colour means on the wire, and nothing is
    // sent until the next pick.
    const stop = ctx.onChange(["value"], apply);
    // The value is a property, not an attribute, and survives the host
    // rewriting the element; put back anyway, because that is one assumption
    // about the host fewer.
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(apply) : null;
    const stopOsc = follow(ctx, adopt);
    const stopShared = onShared(ctx, adoptShared);

    return function detach() {
      if (frame && cancelRaf) cancelRaf(frame);
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", onChange);
      el.removeEventListener("blur", release);
      if (root) root.removeEventListener("blur", release);
      if (stop) stop();
      if (stopRewrite) stopRewrite();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

/**
 * The OSC values one colour becomes, in order, or null if it cannot be sent.
 *
 * A blank or mistyped Alpha refuses the message rather than filling in a
 * number: Number("") is 0, and 0 alpha is fully transparent, which on a media
 * server is the layer going dark. toNumber() returns null for it instead. A
 * readable alpha past either end pins there, as a unit does on DMX.
 */
function oscValues(ctx, rgb) {
  const byte = ctx.get("scale") === "byte";
  const values = rgb.map((channel) => (byte ? channel : round(channel / MAX)));
  if (ctx.get("format") !== "rgba") return values;

  const alpha = toNumber(ctx.get("alpha"));
  if (alpha === null) return null;
  const unit = clamp(alpha, 0, 1);
  values.push(byte ? Math.round(unit * MAX) : round(unit));
  return values;
}

/**
 * What one colour puts on the wire, or null.
 *
 * The DMX half is always red, green and blue as 0..1, whatever the OSC
 * format: a fixture takes channels, not strings, and never an alpha. The two
 * halves are independent, so an alpha that cannot be read silences OSC and
 * leaves DMX driving the fixture.
 */
function resolve(ctx, hex) {
  const rgb = parseHex(hex);
  if (rgb === null) return null;
  const units = rgb.map((channel) => channel / MAX);
  const config = routing(ctx);

  if (ctx.get("format") === "hex") {
    return outgoing(Object.assign(config, { argType: "s" }), toHex(rgb), units);
  }
  return outgoing(config, oscValues(ctx, rgb), units);
}

/**
 * Read a colour off the wire, in whichever shape it arrives, or null.
 *
 * The hex string OSCAR sends in hex mode comes back as one string; the
 * channels it sends otherwise come back as three or four values on the
 * configured Range, and only the first three are read: the swatch has
 * nowhere to show an alpha. Numbers spelled as text are numbers. A channel
 * past either end of the range pins there, as a received slider value does;
 * a channel that cannot be read at all leaves the swatch as it was, the
 * same as the send path, where an unreadable value is dropped rather than
 * read as 0 -- and 0, 0, 0 is black.
 *
 * Channels are tried BEFORE the hex code. "255" and "000" are both valid
 * three-digit hex codes, so software that sends its channels as text
 * ("255", "128", "0") would otherwise paint #225555, and "000" first would
 * paint black: an unrelated colour, adopted silently. Three readable numbers
 * are never a hex code; a string is only taken as one when it is the only
 * value, which is what OSCAR itself sends, starts with '#', or has six digits. The rule lives here and not in parseHex because a bare "100" typed
 * into the Colour field is still a hex code.
 */
function fromWire(values, scale) {
  if (!Array.isArray(values) || !values.length) return null;

  const rgb = channelsOf(values, scale);
  if (rgb) return toHex(rgb);

  // A list that failed to read as channels is NOT then tried as a hex code,
  // unless it says so with a '#' or is too long to be a channel. Without this, channels sent as text with
  // one of them unreadable -- "000", "  ", "0" -- fell through to reading
  // "000" as a short hex code and painted black: the blackout-by-nonsense
  // this widget exists to refuse. A lone string is the hex form OSCAR sends.
  const first = values[0];
  if (typeof first !== "string") return null;
  // Six digits or more cannot be a channel on either Range, so they stay a
  // hex code; it is the bare short forms that a number can pass for.
  const bare = first.trim();
  if (values.length > 1 && bare.charAt(0) !== "#" && bare.length < 6) return null;
  return normaliseHex(first);
}

/** The first three values as bytes, or null unless all three are numbers. */
function channelsOf(values, scale) {
  if (values.length < 3) return null;

  const full = scale === "byte" ? 1 : MAX;
  const rgb = [];
  for (let i = 0; i < 3; i++) {
    const number = toNumber(values[i]);
    if (number === null) return null;
    rgb.push(Math.round(clamp(number * full, 0, MAX)));
  }
  return rgb;
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

/**
 * Whole numbers on a 0 to 1 range leave two values per channel: #808080
 * rounds to 1, 1, 1 and #7f7f7f to 0, 0, 0, so every colour reaches the rig
 * as one of eight primaries, and an Alpha of 0.25 goes out as 0 -- fully
 * transparent. Nobody means that; someone who picks int wants 0 to 255.
 * Refused in the panel rather than rewritten on the wire, so what is
 * configured stays what is sent. The hex format ignores the argument type,
 * so it is left alone.
 */
function checkWholeNumbers(value, config) {
  if (!config) return null;
  if (config.format === "hex" || config.argType !== "i" || config.scale !== "unit") return null;
  return "Whole numbers need Range set to 0 to 255: on 0 to 1 every channel would round to 0 or 1";
}

module.exports = { colour, FORMATS, SCALES, parseHex, normaliseHex, fromWire };
