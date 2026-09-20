"use strict";

const {
  field,
  oscFields,
  enabled,
  connectionChecks,
  checkNumber,
  dmxFields,
  dmxDefaults,
  dmxChecks,
} = require("./fields");
const { outgoing, only, routing, asCtx } = require("./outgoing");
const { follow } = require("./incoming");
const { share, onShared } = require("./shared");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");
const { unitOf } = require("../dmx/levels");

const SEND_MODES = [
  { id: "one", name: "One message, two values" },
  { id: "two", name: "Two messages (/x and /y)" },
];

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * OSC XY pad: drag anywhere in the square to send two values at once.
 *
 * One message carrying both values is the default, which is what most software
 * expects for a position. Two separate messages suits targets that want one
 * value per address. With Listen on, the handle follows the same shape coming
 * back: /pad with two values, or /pad/x and /pad/y with one each -- except
 * while a finger is dragging it. The same pad on another device moves it the
 * same way, Listen or not: every tablet on the surface shows one { x, y }.
 * On DMX, X lands on the first channel of the block and Y on the next: pan
 * and tilt on a moving head.
 */
const xypad = {
  name: "oscar-xypad",
  tag: "div",
  // The handle is drawn by CSS on this element, not by a child. A child would
  // swallow the drag, the way a button's label used to.
  attributes: { class: "oscar-xypad" },

  sends: true,
  receives: true,
  dmx: true,

  block: {
    label: "XY Pad",
    category: "IO Widgets",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M3,3H21A2,2 0 0,1 23,5V19A2,2 0 0,1 21,21H3A2,2 0 0,1 1,19V5A2,2 0 0,1 3,3M3,5V19H21V5H3' +
      'M15,9A2,2 0 0,1 17,11A2,2 0 0,1 15,13A2,2 0 0,1 13,11A2,2 0 0,1 15,9Z"/></svg>',
  },

  defaults: Object.assign(
    {
      enabled: true,
      ip: "localhost",
      port: 7000,
      message: "/pad",
      listen: false,
      sendMode: "one",
      minX: 0,
      maxX: 100,
      minY: 0,
      maxY: 100,
      x: 0,
      y: 0,
      invertX: false,
      invertY: false,
      argType: "f",
    },
    dmxDefaults(2)
  ),

  fields: [enabled()]
    .concat(oscFields())
    .concat([
      field("sendMode", "Send", "select", { options: SEND_MODES }),
      field("minX", "Min X", "number", { step: "any" }),
      field("maxX", "Max X", "number", { step: "any" }),
      field("minY", "Min Y", "number", { step: "any" }),
      field("maxY", "Max Y", "number", { step: "any" }),
      field("invertX", "Invert X", "checkbox"),
      field("invertY", "Invert Y", "checkbox"),
      field("argType", "Argument type", "select", { section: "osc", options: NUMERIC_ARG_TYPES }),
    ])
    .concat(dmxFields()),

  checks: Object.assign({}, connectionChecks(), dmxChecks(2), {
    minX: checkNumber("Min X"),
    maxX: checkNumber("Max X"),
    minY: checkNumber("Min Y"),
    maxY: checkNumber("Max Y"),
  }),

  /** How a state for drive() is asked for: a position, and the range of each axis. */
  driveInput: function (config) {
    return {
      kind: "position",
      minX: toNumber(config.minX),
      maxX: toNumber(config.maxX),
      minY: toNumber(config.minY),
      maxY: toNumber(config.maxY),
    };
  },

  /**
   * What putting the handle here sends: { state: { x, y }, messages }, each
   * axis kept inside its range. Several messages, because a pad set to send
   * its axes apart sends three. See `drive` in lib/widgets/index.js.
   */
  drive: function (config, state) {
    const x = toNumber(state && state.x);
    const y = toNumber(state && state.y);
    if (x === null || y === null) return null;
    const values = { x: within(x, config.minX, config.maxX), y: within(y, config.minY, config.maxY) };
    return { state: values, messages: resolveAll(asCtx(config), values) };
  },

  attach: function (el, ctx) {
    let dragging = false;
    let frame = null;
    let pending = null;

    place();

    /** Put the handle where the stored values say, after a load. */
    function place() {
      const fx = fraction(ctx.get("x"), ctx.get("minX"), ctx.get("maxX"));
      const fy = fraction(ctx.get("y"), ctx.get("minY"), ctx.get("maxY"));

      const left = ctx.get("invertX") ? 1 - fx : fx;
      // Screen coordinates run downward; a control surface reads upward.
      const top = ctx.get("invertY") ? fy : 1 - fy;

      paint(left, top);
    }

    function paint(left, top) {
      el.style.setProperty("--oscar-x", (left * 100).toFixed(2) + "%");
      el.style.setProperty("--oscar-y", (top * 100).toFixed(2) + "%");
    }

    function fraction(value, min, max) {
      const lo = Number(min);
      const hi = Number(max);
      const v = Number(value);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(v)) return 0;
      if (hi === lo) return 0;
      return clamp((v - lo) / (hi - lo), 0, 1);
    }

    function onPointerDown(e) {
      e.preventDefault();
      // Capture keeps the drag alive if the finger leaves the pad, so a value
      // can be held at the very edge.
      try {
        el.setPointerCapture(e.pointerId);
      } catch (err) {
        /* older engines manage without it */
      }
      dragging = true;
      track(e);
    }

    function onPointerMove(e) {
      if (dragging) track(e);
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      track(e, true);
    }

    /**
     * A pointerup that lands on another window -- alt-tab, a notification --
     * never reaches the pad. Without this the drag would stay open and the
     * pad deaf to the rig until the next press. There is no pointer to read,
     * so the last position it had is what goes out.
     */
    function onBlur() {
      if (!dragging) return;
      dragging = false;
      flush();
    }

    /** Work out the values under the pointer and schedule them. */
    function track(e, final) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const px = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const py = clamp((e.clientY - rect.top) / rect.height, 0, 1);

      const fx = ctx.get("invertX") ? 1 - px : px;
      const fy = ctx.get("invertY") ? py : 1 - py;

      const minX = Number(ctx.get("minX"));
      const maxX = Number(ctx.get("maxX"));
      const minY = Number(ctx.get("minY"));
      const maxY = Number(ctx.get("maxY"));

      const x = round(minX + (maxX - minX) * fx);
      const y = round(minY + (maxY - minY) * fy);

      paint(px, py);
      ctx.set("x", x);
      ctx.set("y", y);

      pending = { x: x, y: y };
      if (final) {
        // The last position must be exact: whatever is downstream ends up
        // where the operator let go, not one frame short of it.
        flush();
      } else {
        schedule();
      }
    }

    // A drag fires far more often than anything needs; one send per frame is
    // plenty and keeps a busy surface from flooding the network. Where there
    // are no frames -- outside a browser -- every move sends, which is what a
    // test wants anyway.
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
      if (!pending) return;

      const values = pending;
      pending = null;

      resolveAll(ctx, values).forEach(function (message) {
        ctx.send(message);
      });
      // One position for the other devices, whichever way it went out.
      share(ctx, { x: values.x, y: values.y });
    }

    /** The address, or pair of addresses, the pad answers to. */
    function addresses() {
      const message = ctx.get("message");
      if (ctx.get("sendMode") === "two") return [message + "/x", message + "/y"];
      return message;
    }

    /**
     * Take a position the rig sent: one message with both values, or one
     * axis at a time. Stores it and moves the handle through place(), the
     * view-only path -- a value that came in must never go back out. Then
     * has the position recorded as heard: the other devices were sent the
     * same message, so nobody needs telling, but a device joining later
     * starts where the rig left the handle.
     */
    function adopt(values, address) {
      // The finger outranks the rig for as long as it is down.
      if (dragging) return;

      if (ctx.get("sendMode") === "two") {
        const value = toNumber(values[0]);
        if (value === null) return;
        const axis = address === ctx.get("message") + "/x" ? "x" : "y";
        ctx.set(axis, within(value, ctx.get("min" + axis.toUpperCase()), ctx.get("max" + axis.toUpperCase())));
      } else {
        const x = toNumber(values[0]);
        const y = toNumber(values[1]);
        // Half a position is no position; a handle moved along one axis
        // only would misreport the other.
        if (x === null || y === null) return;
        ctx.set("x", within(x, ctx.get("minX"), ctx.get("maxX")));
        ctx.set("y", within(y, ctx.get("minY"), ctx.get("maxY")));
      }
      place();
      share(ctx, { x: ctx.get("x"), y: ctx.get("y") }, { heard: true });
    }

    /**
     * Take the position another device shows. Never shared again: it came
     * from there. The record is merged from everything ever shared for this
     * pad, so each axis is taken on its own; one that cannot be read is
     * left where it is rather than guessed at.
     */
    function adoptShared(state) {
      if (dragging) return;
      const x = toNumber(state.x);
      const y = toNumber(state.y);
      if (x === null && y === null) return;
      if (x !== null) ctx.set("x", within(x, ctx.get("minX"), ctx.get("maxX")));
      if (y !== null) ctx.set("y", within(y, ctx.get("minY"), ctx.get("maxY")));
      place();
    }

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    // Guarded so the widget can be exercised outside a browser.
    const root = typeof window === "undefined" ? null : window;
    if (root) root.addEventListener("blur", onBlur);
    const stop = ctx.onChange(["minX", "maxX", "minY", "maxY", "invertX", "invertY"], place);
    // The handle position is an inline property, which goes when the host
    // rewrites the element's attributes; the stored x and y put it back.
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(place) : null;
    const stopOsc = follow(ctx, adopt, addresses);
    const stopShared = onShared(ctx, adoptShared);

    return function detach() {
      if (frame && cancelRaf) cancelRaf(frame);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      if (root) root.removeEventListener("blur", onBlur);
      if (stop) stop();
      if (stopRewrite) stopRewrite();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

/**
 * Everything one position puts on the wire, in the order it leaves. Entries
 * may be null, which send() takes to mean nothing.
 */
function resolveAll(ctx, values) {
  const config = routing(ctx);
  const units = [
    unitOf(values.x, ctx.get("minX"), ctx.get("maxX")),
    unitOf(values.y, ctx.get("minY"), ctx.get("maxY")),
  ];
  if (ctx.get("sendMode") !== "two") return [outgoing(config, [values.x, values.y], units)];
  // Two OSC messages, but one DMX frame: pan and tilt are one position on a
  // moving head, and a half-updated block would swing it through somewhere
  // nobody pointed at.
  const osc = only(config, "osc");
  return [
    outgoing(osc && Object.assign({}, osc, { message: config.message + "/x" }), values.x),
    outgoing(osc && Object.assign({}, osc, { message: config.message + "/y" }), values.y),
    outgoing(only(config, "dmx"), null, units),
  ];
}

/** Keep a received value inside an axis's range, so handle and value agree. */
function within(value, min, max) {
  const lo = toNumber(min);
  const hi = toNumber(max);
  if (lo === null || hi === null) return value;
  return clamp(value, Math.min(lo, hi), Math.max(lo, hi));
}

module.exports = { xypad, SEND_MODES };
