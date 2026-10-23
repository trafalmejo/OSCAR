"use strict";

const { field, enabled, oscFields, connectionChecks, checkNumber } = require("./fields");
const { outgoing, routing, asCtx } = require("./outgoing");
const { NUMERIC_ARG_TYPES, toNumber } = require("../osc-args");

/**
 * Motion: the phone itself as a control.
 *
 * A phone carries an accelerometer, a gyroscope and a compass, and a page
 * can read them. This widget turns those readings into OSC, sent at a
 * steady rate, so tilting the phone pans a light or steers a camera the way
 * a fader would, with no hand on the screen.
 *
 * Each reading is its own stream on its own address, under the widget's
 * Message: `/motion/orientation`, `/motion/acceleration`, and so on, each
 * ticked on or off in the settings. One widget can send all of them, and
 * the box says which, on what address, with the live values beside each.
 * Pages from before the split had one Source and one address; those keep
 * sending that reading on the plain Message, so nothing already on a wall
 * changes address (see datasetsOn).
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
 * received either. And every stream is throttled to Rate, latest reading
 * wins, so a sensor that fires sixty times a second does not put sixty
 * messages a second on a venue's Wi-Fi unless that is what was asked for.
 */

/**
 * The readings a phone offers, by the name the host's device.motion.watch
 * takes. `key` is the setting that switches each on; `keys` the values a
 * reading carries, in the order they are sent.
 */
const SOURCES = [
  {
    id: "orientation",
    key: "sendOrientation",
    name: "Orientation",
    keys: ["x", "y", "z"],
    hint: "Which way the phone is held, in degrees: alpha (turn around the vertical, 0 to 360), beta (tilt front to back, -180 to 180), gamma (tilt side to side, -90 to 90).",
  },
  {
    id: "acceleration",
    key: "sendAcceleration",
    name: "Acceleration",
    keys: ["x", "y", "z"],
    hint: "How the phone is being moved, in m/s², gravity taken out: zero when still, a spike on a shake.",
  },
  {
    id: "gravity",
    key: "sendGravity",
    name: "Acceleration with gravity",
    keys: ["x", "y", "z"],
    hint: "The same with gravity left in: a steady tilt reading, about 9.8 on whichever axis points down.",
  },
  {
    id: "rotation",
    key: "sendRotation",
    name: "Rotation rate",
    keys: ["x", "y", "z"],
    hint: "How fast the phone is turning, in degrees a second around each axis: zero when still.",
  },
  {
    id: "heading",
    key: "sendHeading",
    name: "Compass heading",
    keys: ["x"],
    hint: "Degrees from north, 0 to 360, one value. Needs a phone with a compass, and a browser that shares it.",
  },
];

const RATE_MIN = 1;
const RATE_MAX = 60;

/** What the box says it is doing, on its data-motion attribute (styled in toggle.css). */
const STATES = ["phone", "tap", "waiting", "live"];

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function isOn(value) {
  return value === true || value === "true";
}

/**
 * Which readings this widget sends, and whether it is a page from before
 * the split. Such a page has no send* setting at all, only a Source: that
 * one reading, on the plain Message. A page with the settings sends each
 * ticked reading on its own address under the Message.
 */
/** A ctx's get as a plain function: a host may bind it to itself. */
function getOf(ctx) {
  return function (key) {
    return ctx.get(key);
  };
}

function datasetsOn(get) {
  const flagged = SOURCES.some((source) => get(source.key) !== undefined);
  if (!flagged) {
    const legacy = String(get("source") || "orientation");
    return { legacy: true, sources: SOURCES.filter((source) => source.id === legacy) };
  }
  return { legacy: false, sources: SOURCES.filter((source) => isOn(get(source.key))) };
}

/** Where a reading goes: the Message with the reading's name under it, or the Message itself for a page from before. */
function addressFor(message, source, legacy) {
  const base = String(message == null ? "" : message).trim().replace(/\/+$/, "");
  if (legacy) return base;
  return (base || "") + "/" + source.id;
}

/** A ctx that answers Message with one reading's address and everything else as the widget's. */
function routedTo(ctx, address) {
  return {
    get: function (key) {
      return key === "message" ? address : ctx.get(key);
    },
  };
}

/** A reading as the widget keeps it: the values the source carries, rounded; null when one is missing. */
function readingOf(source, reading) {
  const kept = {};
  for (const key of source.keys) {
    const value = toNumber(reading && reading[key]);
    if (value === null) return null;
    kept[key] = round(value);
  }
  return kept;
}

function sameReading(source, a, b) {
  return !!a && !!b && source.keys.every((key) => a[key] === b[key]);
}

function valuesOf(source, reading) {
  return source.keys.map((key) => reading[key]);
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
    sendOrientation: true,
    sendAcceleration: false,
    sendGravity: false,
    sendRotation: false,
    sendHeading: false,
    rate: 20,
  },

  fields: [enabled(), field("label", "Label", "text")]
    .concat(oscFields({ receives: false }))
    .concat(
      SOURCES.map((source) =>
        field(source.key, source.name, "checkbox", {
          hint: source.hint + " Sent on Message/" + source.id + ", as " + source.keys.length + (source.keys.length === 1 ? " value." : " values."),
        })
      )
    )
    .concat([
      field("rate", "Rate (per second)", "number", { min: RATE_MIN, max: RATE_MAX, hint: "Messages a second at most, per reading. The latest reading wins." }),
      field("argType", "Argument type", "select", { section: "osc", dir: "out", options: NUMERIC_ARG_TYPES }),
    ]),

  checks: Object.assign(withoutListen(connectionChecks()), {
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
   * widget on a phone's behalf (lib/surfaces.js). The reading stands in for
   * the first stream the widget sends, on that stream's address. The state
   * is the reading as the widget keeps it, rounded as it rounds; the message
   * may be null for a widget switched off.
   */
  drive: function (config, state) {
    const x = toNumber(state && state.x);
    const y = toNumber(state && state.y);
    const z = toNumber(state && state.z);
    if (x === null || y === null || z === null) return null;
    const kept = { x: round(x), y: round(y), z: round(z) };
    const ctx = asCtx(config);
    const on = datasetsOn(getOf(ctx));
    const first = on.sources[0] || SOURCES[0];
    const address = addressFor(ctx.get("message"), first, on.legacy);
    const values = first.keys.length === 1 ? [kept.x] : [kept.x, kept.y, kept.z];
    return { state: kept, message: outgoing(routing(routedTo(ctx, address)), values) };
  },

  attach: function (el, ctx) {
    const device = ctx.device && ctx.device.motion ? ctx.device.motion : null;
    // Per stream: the latest reading, the one last sent, and how to stop watching.
    let streams = [];
    let ticker = null;
    let shown = "phone";

    function words() {
      if (shown === "phone") return "open on a phone";
      if (shown === "tap") return "tap to enable motion";
      if (shown === "waiting") return "waiting for the sensor";
      return "";
    }

    /** One line per stream: its name, the live values, and where it goes. */
    function lines() {
      const on = datasetsOn(getOf(ctx));
      return on.sources.map(function (source) {
        const stream = streams.find((s) => s.source === source);
        const values = stream && stream.latest ? valuesOf(source, stream.latest).map((v) => v.toFixed(2)).join("  ") : "";
        return source.id + (values ? "  " + values : "") + "  → " + addressFor(ctx.get("message"), source, on.legacy);
      });
    }

    function paint() {
      const label = ctx.get("label");
      const text = words();
      const head = label ? (text ? label + " · " + text : label) : text;
      const rows = shown === "tap" ? [] : lines();
      el.textContent = [head].concat(rows).filter(Boolean).join("\n");
      el.setAttribute("data-motion", shown);
    }

    function show(state) {
      shown = STATES.indexOf(state) === -1 ? "phone" : state;
      paint();
    }

    /** One reading from the phone for one stream. Kept, not sent: the ticker sends. */
    function onReading(stream, reading) {
      const kept = readingOf(stream.source, reading);
      if (!kept) return;
      stream.latest = kept;
      if (shown !== "live") show("live");
    }

    function tick() {
      let painted = false;
      const on = datasetsOn(getOf(ctx));
      for (const stream of streams) {
        if (!stream.latest || sameReading(stream.source, stream.sent, stream.latest)) continue;
        stream.sent = stream.latest;
        const address = addressFor(ctx.get("message"), stream.source, on.legacy);
        ctx.send(outgoing(routing(routedTo(ctx, address)), valuesOf(stream.source, stream.latest)));
        painted = true;
      }
      if (painted) paint();
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
      const on = datasetsOn(getOf(ctx));
      streams = on.sources.map(function (source) {
        const stream = { source: source, latest: null, sent: null, stop: null };
        const stop = typeof device.watch === "function" ? device.watch(source.id, (reading) => onReading(stream, reading)) : null;
        stream.stop = typeof stop === "function" ? stop : null;
        return stream;
      });
      const watching = streams.some((s) => s.stop);
      show(watching ? "waiting" : "phone");
      if (watching) startTicker();
    }

    function stopWatching_() {
      for (const stream of streams) if (stream.stop) stream.stop();
      streams = [];
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

    const watchedKeys = SOURCES.map((source) => source.key).concat(["source"]);
    const stopSources = ctx.onChange(watchedKeys, function () {
      if (streams.length || shown === "waiting" || shown === "live") startWatching();
      else paint();
    });
    const stopRate = ctx.onChange(["rate"], function () {
      if (ticker !== null) startTicker();
    });
    const stopWords = ctx.onChange(["label", "message"], paint);
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(paint) : null;

    return function detach() {
      stopWatching_();
      el.removeEventListener("click", onTap);
      if (stopSources) stopSources();
      if (stopRate) stopRate();
      if (stopWords) stopWords();
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

function checkRate(value) {
  const rate = toNumber(value);
  if (rate !== null && rate >= RATE_MIN && rate <= RATE_MAX) return null;
  return "Rate has to be between " + RATE_MIN + " and " + RATE_MAX + " messages a second";
}

const checkRateNumber = checkNumber("Rate"); // kept for callers that only need "is a number"

module.exports = { motion, SOURCES, RATE_MIN, RATE_MAX, checkRate, checkRateNumber, datasetsOn, addressFor };
