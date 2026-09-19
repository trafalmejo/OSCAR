"use strict";

const { field, enabled, listen, checkMessage, checkNumber, ORIENTATIONS } = require("./fields");
const { follow } = require("./incoming");
const { toNumber } = require("../osc-args");
const { unitOf } = require("../dmx/levels");

/** The longest delay setTimeout can hold. */
const MAX_DELAY = 2147483647;

/** On the element while a peak marker is showing. Styled in public/assets/css/toggle.css. */
const PEAK_CLASS = "oscar-peak";

function pct(unit) {
  return (unit * 100).toFixed(2) + "%";
}

/**
 * OSC meter: a level display, not a control.
 *
 * Every other widget points outward -- a finger lands on it and a message
 * leaves. This one points inward: it shows a number that arrived from the
 * rig, so an operator can watch an audio level, a fixture's intensity or a
 * playhead without reading it off another screen. It sends nothing, ever, so
 * it has no Ip or Port: Message is the address it follows, and Listen is on
 * from the start because following is the whole of what it does.
 *
 * The bar and the peak marker are pseudo-elements driven by two custom
 * properties. Real children would be selectable and draggable out of the
 * component in the editor, and would have to be rebuilt on every repaint.
 * There are no event listeners at all: pointer events are left on so the
 * designer can still select and move it, and nothing else is listened for.
 *
 * Peak hold runs on a clock, because the sources worth metering (Resolume,
 * TouchDesigner) send only when a value changes: a marker that waited for
 * the next reading before falling would sit on a peak from minutes ago, and
 * "Peak hold (s)" would not mean what its number says. So a reading at or
 * above the marker moves it up at once, and once the hold has passed the
 * marker falls back onto the bar by itself. It falls to the last reading that
 * arrived, never to zero: the bar is still the truth about what the meter was
 * told, and the timer only stops the marker claiming a peak is recent when it
 * is not. The timer repaints and does nothing else -- it cannot send, because
 * a meter has nothing to send with.
 */
const meter = {
  name: "oscar-meter",
  tag: "div",
  // Only the class, which is what tells a meter from any other div when a
  // project is parsed. orient follows the setting, and a copy here would be
  // re-applied by the host over the real one on every class or style edit.
  attributes: { class: "oscar-meter" },

  sends: false,
  receives: true,
  dmx: false,

  block: {
    label: "Meter",
    category: "OSC",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M3,7H21A2,2 0 0,1 23,9V15A2,2 0 0,1 21,17H3A2,2 0 0,1 1,15V9A2,2 0 0,1 3,7' +
      'M3,9V15H21V9H3M5,11H13V13H5V11M16,11H18V13H16V11Z"/></svg>',
  },

  defaults: {
    enabled: true,
    message: "/meter1",
    // A meter exists to follow something; unlike a control, there is nothing
    // it could start doing on its own that a hand would have to fight.
    listen: true,
    min: 0,
    max: 100,
    value: 0,
    orientation: "horizontal",
    // Seconds a peak stays marked. 0 turns the marker off.
    peakHold: 0,
  },

  fields: [
    enabled(),
    field("message", "Message", "text", { section: "osc", placeholder: "/address" }),
    listen(),
    field("min", "Min", "number", { step: "any" }),
    field("max", "Max", "number", { step: "any" }),
    field("value", "Value", "number", { step: "any" }),
    field("orientation", "Orientation", "select", { options: ORIENTATIONS }),
    field("peakHold", "Peak hold (s)", "number", { min: 0, step: "any" }),
  ],

  checks: {
    message: checkMessage,
    min: checkNumber("Min"),
    max: checkNumber("Max"),
    value: checkNumber("Value"),
    peakHold: checkPeakHold,
  },

  attach: function (el, ctx) {
    // The reading the marker sits at, in the meter's own units, and when it
    // was taken. Kept as a reading rather than a fraction so that editing the
    // range under a held peak re-places the marker instead of leaving it at
    // a stale pixel. Null until the first reading: a marker is a record of
    // what arrived, and nothing has.
    let peak = null;
    let peakAt = 0;
    // The pending fall of the marker, while it is above the bar.
    let fall = null;

    paint();

    /** Seconds of hold as milliseconds, or 0 for no marker at all. */
    function holdMs() {
      const seconds = toNumber(ctx.get("peakHold"));
      return seconds !== null && seconds > 0 ? seconds * 1000 : 0;
    }

    /** Where a reading sits in the configured range, 0..1, or null. */
    function unit(value) {
      return unitOf(value, ctx.get("min"), ctx.get("max"));
    }

    /**
     * Draw what is stored: the bar from Value, the marker from the held peak.
     *
     * The view-only path, so it can be run again after the host rewrites the
     * element. A stored value that cannot be placed -- unreadable, or a range
     * of zero width -- leaves the bar where it is rather than emptying it: an
     * empty bar reports silence on a channel that may be at full.
     */
    function paint() {
      el.setAttribute("orient", ctx.get("orientation") || "horizontal");

      const level = unit(ctx.get("value"));
      if (level !== null) el.style.setProperty("--oscar-level", pct(level));

      if (!holdMs()) peak = null;
      const held = peak === null ? null : unit(peak);
      if (held !== null) el.style.setProperty("--oscar-peak", pct(held));
      ctx.setClass(PEAK_CLASS, held !== null);

      // Every path that can lift the marker off the bar, or change how long
      // it may stay there, ends in a paint -- so this is the one place the
      // fall is armed, and an edit to Peak hold re-times a marker already up.
      const bar = unit(ctx.get("value"));
      arm(held !== null && bar !== null && held > bar);
    }

    /** Have the marker fall when its hold runs out, or call that off. */
    function arm(wanted) {
      if (fall !== null) clearTimeout(fall);
      fall = null;
      if (!wanted) return;
      // setTimeout takes a 32-bit delay: anything longer (a hold of 25 days
      // or more) overflows and fires after a millisecond, dropping the marker
      // at once. Wait the longest it can, and drop() goes round again.
      fall = setTimeout(drop, Math.min(MAX_DELAY, Math.max(0, peakAt + holdMs() - Date.now())));
      // Under Node a pending timer keeps the process alive, and a meter left
      // mounted must not hold a test run or a shutdown open for its hold
      // time. A browser's timer is a plain number and has nothing to unref.
      if (fall && typeof fall.unref === "function") fall.unref();
    }

    /**
     * The hold has run out with no reading to move the marker: bring it down
     * onto the bar. View only -- nothing is stored and nothing is sent. The
     * marker lands on the last reading, and its hold starts again from now,
     * so a lower reading a moment later leaves it there for the full time.
     */
    function drop() {
      fall = null;
      // Woken early by the delay cap above: the hold has not run out yet.
      if (Date.now() < peakAt + holdMs()) {
        arm(true);
        return;
      }
      const current = toNumber(ctx.get("value"));
      // A value that cannot be placed leaves the marker alone, as it leaves
      // the bar alone: there is nowhere true to move it to.
      if (current === null || unit(current) === null) return;
      peak = current;
      peakAt = Date.now();
      paint();
    }

    /**
     * Take a reading from the rig. Stores it, decides the peak, repaints, and
     * nothing else: a value that came in never goes back out.
     */
    function adopt(values) {
      const value = toNumber(values[0]);
      // An unreadable value holds the last reading. Dropping to zero would
      // report silence on a channel that may be at full, which is the
      // dangerous direction for a display to fail in.
      if (value === null) return;

      // Stored silently, so a re-render repaints where the level actually
      // was rather than back at the configured default.
      ctx.set("value", value);

      const hold = holdMs();
      if (hold) {
        const now = Date.now();
        const rising = unit(value);
        const held = peak === null ? null : unit(peak);
        // Compared as fractions rather than as readings so that a range
        // running downward (min above max) still marks its loudest point.
        if (held === null || rising === null || rising >= held || now - peakAt >= hold) {
          peak = value;
          peakAt = now;
        }
      }
      paint();
    }

    // Editing the range, the orientation or the value in the panel has to
    // move the bar, or the designer is laying out a widget they cannot see
    // working. Enabled is not watched: a meter switched off freezes where it
    // is, and switching it back on shows the same until the next reading.
    const stop = ctx.onChange(["min", "max", "value", "orientation", "peakHold"], paint);
    // The host rewriting the element strips orient, the custom properties
    // and the peak class, and losing them shows an empty, flat meter.
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(paint) : null;
    // follow() reads Enabled and Listen for every message, so a disabled
    // meter is deaf and holds its last reading rather than dropping to zero.
    const stopOsc = follow(ctx, adopt);

    return function detach() {
      // A marker left to fall after its element is gone would paint onto
      // nothing, and in the editor onto a view that has been replaced.
      arm(false);
      if (stop) stop();
      if (stopRewrite) stopRewrite();
      if (stopOsc) stopOsc();
    };
  },
};

function checkPeakHold(value) {
  const seconds = toNumber(value);
  if (seconds !== null && seconds >= 0) return null;
  return "Peak hold has to be a number of seconds, 0 for none";
}

module.exports = { meter, PEAK_CLASS };
