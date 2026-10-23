"use strict";

const { field, enabled, oscFields, connectionChecks, checkNumber } = require("./fields");
const { outgoing, routing, asCtx } = require("./outgoing");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");

/**
 * Motion: the phone itself as a control.
 *
 * A phone carries an accelerometer and a gyroscope, and a page can read
 * them. This widget turns one of those readings into an OSC message of
 * three floats, sent at a steady rate, so tilting the phone pans a light or
 * steers a camera the way a fader would, with no hand on the screen.
 *
 * What the widget needs that the other widgets do not is the phone. It
 * asks its host for it through `ctx.device.motion` (the ctx contract in
 * index.js); a host that has none, the editor on a laptop, leaves the
 * widget saying so, and the designer lays it out and sets its address like
 * any other. iPhones hand the sensors over only after a tap, so until the
 * host says it is allowed the widget is a button that asks.
 *
 * Nothing here is shared between devices, on purpose: a reading is one
 * phone's own, and two phones on one surface are two streams. Nothing is
 * received either. And the stream is throttled to Rate, latest reading
 * wins, so a sensor that fires sixty times a second does not put sixty
 * messages a second on a venue's Wi-Fi unless that is what was asked for.
 */

/** The readings a phone offers, by the name the host's device.motion.watch takes. */
const SOURCES = [
  { id: "orientation", name: "Orientation (alpha, beta, gamma)" },
  { id: "acceleration", name: "Acceleration (x, y, z)" },
  { id: "gravity", name: "Acceleration with gravity (x, y, z)" },
  { id: "rotation", name: "Rotation rate (alpha, beta, gamma)" },
];

const RATE_MIN = 1;
const RATE_MAX = 60;

/** What the box says it is doing, on its data-motion attribute (styled in toggle.css). */
const STATES = ["phone", "tap", "waiting", "live"];

function round(value) {
  return Math.round(value * 1000) / 1000;
}

const motion = {
  name: "oscar-motion",
  tag: "div",
  attributes: { class: "oscar-motion" },

  sends: true,
  receives: false,
  dmx: false,

  block: {
    label: "Motion",
    category: "IO Widgets",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M17,1H7A2,2 0 0,0 5,3V21A2,2 0 0,0 7,23H17A2,2 0 0,0 19,21V3A2,2 0 0,0 17,1M17,19H7V5H17V19M12,6' +
      'L8,10H11V14H13V10H16L12,6M12,18L16,14H13V12H11V14H8L12,18Z"/></svg>',
  },

  defaults: {
    enabled: true,
    label: "Motion",
    ip: "localhost",
    port: 7000,
    message: "/motion",
    argType: "f",
    oscEnabled: true,
    oscVia: "network",
    oscSendWhen: "user",
    oscLoopGuard: true,
    source: "orientation",
    rate: 20,
  },

  fields: [enabled(), field("label", "Label", "text")]
    .concat(oscFields({ receives: false }))
    .concat([
      field("source", "Source", "select", { options: SOURCES, hint: "Which reading the phone sends, as three values in this order." }),
      field("rate", "Rate (per second)", "number", { min: RATE_MIN, max: RATE_MAX, hint: "Messages a second at most. The latest reading wins." }),
      field("argType", "Argument type", "select", { section: "osc", dir: "out", options: NUMERIC_ARG_TYPES }),
    ]),

  checks: Object.assign(withoutListen(connectionChecks()), {
    source: checkSource,
    rate: checkRate,
  }),

  /**
   * How a state for drive() is asked for: three numbers, whatever the source
   * calls them. A kind of its own, so a panel that offers on/off, a value or
   * a position does not offer a sensor reading as one of those.
   */
  driveInput: function () {
    return { kind: "vector", keys: ["x", "y", "z"] };
  },

  /**
   * What a reading sends, worked out with no phone: for OSCAR driving the
   * widget on a phone's behalf (lib/surfaces.js). The state is the reading
   * as the widget keeps it, rounded as it rounds; the message may be null for
   * a widget switched off.
   */
  drive: function (config, state) {
    const x = toNumber(state && state.x);
    const y = toNumber(state && state.y);
    const z = toNumber(state && state.z);
    if (x === null || y === null || z === null) return null;
    const kept = { x: round(x), y: round(y), z: round(z) };
    return { state: kept, message: outgoing(routing(asCtx(config)), [kept.x, kept.y, kept.z]) };
  },

  attach: function (el, ctx) {
    const device = ctx.device && ctx.device.motion ? ctx.device.motion : null;
    let stopWatching = null;
    // The latest reading, and the one last sent; a tick sends only a change.
    let latest = null;
    let sent = null;
    let ticker = null;
    let shown = "phone";

    function words() {
      if (shown === "phone") return "open on a phone";
      if (shown === "tap") return "tap to enable motion";
      if (shown === "waiting") return "waiting for the sensor";
      return latest ? latest.x.toFixed(2) + "  " + latest.y.toFixed(2) + "  " + latest.z.toFixed(2) : "";
    }

    function paint() {
      const label = ctx.get("label");
      const text = words();
      el.textContent = label ? (text ? label + " · " + text : label) : text;
      el.setAttribute("data-motion", shown);
    }

    function show(state) {
      shown = STATES.indexOf(state) === -1 ? "phone" : state;
      paint();
    }

    /** One reading from the phone. Kept, not sent: the ticker sends. */
    function onReading(reading) {
      const x = toNumber(reading && reading.x);
      const y = toNumber(reading && reading.y);
      const z = toNumber(reading && reading.z);
      if (x === null || y === null || z === null) return;
      latest = { x: round(x), y: round(y), z: round(z) };
      if (shown !== "live") show("live");
    }

    function tick() {
      if (!latest) return;
      if (sent && sent.x === latest.x && sent.y === latest.y && sent.z === latest.z) return;
      sent = latest;
      ctx.send(outgoing(routing(ctx), [latest.x, latest.y, latest.z]));
      paint();
    }

    function rateMs() {
      const rate = toNumber(ctx.get("rate"));
      const perSecond = rate === null ? 20 : Math.min(RATE_MAX, Math.max(RATE_MIN, rate));
      return Math.round(1000 / perSecond);
    }

    function startTicker() {
      stopTicker();
      ticker = setInterval(tick, rateMs());
      // Under Node a pending timer keeps the process alive; a browser's has nothing to unref.
      if (ticker && typeof ticker.unref === "function") ticker.unref();
    }

    function stopTicker() {
      if (ticker !== null) clearInterval(ticker);
      ticker = null;
    }

    function startWatching() {
      stopWatching_();
      latest = null;
      sent = null;
      const source = ctx.get("source");
      const stop = typeof device.watch === "function" ? device.watch(source, onReading) : null;
      stopWatching = typeof stop === "function" ? stop : null;
      show(stopWatching ? "waiting" : "phone");
      if (stopWatching) startTicker();
    }

    function stopWatching_() {
      if (stopWatching) stopWatching();
      stopWatching = null;
      stopTicker();
    }

    /** The tap iPhones ask for, and only that: a tap anywhere else does nothing. */
    function onTap() {
      if (shown !== "tap" || typeof device.ask !== "function") return;
      Promise.resolve()
        .then(function () {
          return device.ask();
        })
        .then(
          function (allowed) {
            if (allowed) startWatching();
            else show("tap");
          },
          function () {
            show("tap");
          }
        );
    }

    if (!device) {
      show("phone");
    } else if (typeof device.needsTap === "function" && device.needsTap()) {
      show("tap");
    } else {
      startWatching();
    }
    el.addEventListener("click", onTap);

    const stopSource = ctx.onChange(["source"], function () {
      if (stopWatching) startWatching();
    });
    const stopRate = ctx.onChange(["rate"], function () {
      if (ticker !== null) startTicker();
    });
    const stopLabel = ctx.onChange(["label"], paint);
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(paint) : null;

    return function detach() {
      stopWatching_();
      el.removeEventListener("click", onTap);
      if (stopSource) stopSource();
      if (stopRate) stopRate();
      if (stopLabel) stopLabel();
      if (stopRewrite) stopRewrite();
    };
  },
};

/** The connection checks, minus the one for a Data in setting this widget has not got. */
function withoutListen(checks) {
  const kept = Object.assign({}, checks);
  delete kept.oscListenFrom;
  return kept;
}

function checkSource(value) {
  return SOURCES.some((source) => source.id === value) ? null : "Source has to be one of the readings a phone offers";
}

function checkRate(value) {
  const rate = toNumber(value);
  if (rate !== null && rate >= RATE_MIN && rate <= RATE_MAX) return null;
  return "Rate has to be between " + RATE_MIN + " and " + RATE_MAX + " messages a second";
}

const checkRateNumber = checkNumber("Rate"); // kept for callers that only need "is a number"

module.exports = { motion, SOURCES, RATE_MIN, RATE_MAX, checkRate, checkRateNumber };
