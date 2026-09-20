"use strict";

const { toArgs } = require("../osc-args");
const { SLOTS, protocol } = require("../dmx/spec");
const { toWhole, toLevels, spread } = require("../dmx/levels");
const { sendsOsc, sendsDmx } = require("./fields");
const { SERIAL_HOST, isSerialTarget } = require("../serial-target");

/**
 * Decide what a widget should put on the wire, or null for silence.
 *
 * Every widget funnels through here, so the Enabled switch cannot be
 * implemented three slightly different ways, and a value that no argument
 * type can carry is dropped rather than guessed at.
 *
 * A widget hands over two readings of the same gesture:
 *
 *   raw    the value in the widget's own units -- 0-100, a cue number, "go"
 *          -- which is what OSC carries. A list for a widget that produces
 *          several values at once: a pad two, a colour three.
 *   units  the same gesture as 0..1 (a list for several), which is what a
 *          DMX slot is scaled from. Only the widget knows its own range, so
 *          only the widget can work this out (unitOf in lib/dmx/levels.js);
 *          a slider labelled 20-2000 Hz still means "full" at the top. A
 *          button passes 1 or 0. Omitted by a widget that cannot drive DMX.
 *
 * The result is { ip, port, address, args } for OSC, { dmx: {...} } for DMX,
 * or both on one object when both protocols are switched on, and the host sends whichever
 * halves are present. The halves are independent: a button whose Value ON
 * is "go" cannot send that as a float, but it can still put its dimmer to
 * full, and silence on one wire is no reason for silence on the other.
 */
function outgoing(config, raw, units) {
  if (!config || !config.enabled) return null;

  const message = {};
  let sending = false;

  if (sendsOsc(config)) {
    const args = oscArgs(config, raw);
    if (args) {
      // The cable is named once, in one spelling, so the server never has to
      // wonder whether " Serial" is a host name. The port rides along unread.
      message.ip = isSerialTarget(config.ip) ? SERIAL_HOST : config.ip;
      message.port = config.port;
      message.address = config.message;
      message.args = args;
      sending = true;
    }
  }

  if (sendsDmx(config)) {
    const dmx = dmxRequest(config, units);
    if (dmx) {
      message.dmx = dmx;
      sending = true;
    }
  }

  return sending ? message : null;
}

/** The OSC arguments for one gesture, or null if any value cannot be sent. */
function oscArgs(config, raw) {
  const values = Array.isArray(raw) ? raw : [raw];
  const args = [];
  for (const value of values) {
    const built = toArgs(config.argType, value);
    // One unsendable value spoils the message. Sending the rest would put a
    // position on the wire with a coordinate silently missing from it.
    if (built === null) return null;
    for (const arg of built) args.push(arg);
  }
  return args;
}

/**
 * The DMX half for one gesture, or null.
 *
 * Null means the fixture stays where it is rather than going to zero. That
 * is the whole point: an unreadable level coerced to 0 is a blackout, and it
 * would look exactly like someone pulling the fader down. The block is
 * refused, not truncated, when it runs past channel 512 or is too narrow for
 * the widget's values; the settings panel refuses both too, and a project
 * file edited by hand reaches here instead.
 */
function dmxRequest(config, units) {
  const spec = protocol(config.dmxProtocol);
  if (!spec) return null;

  const universe = toWhole(config.dmxUniverse, spec.minUniverse, spec.maxUniverse);
  const channel = toWhole(config.dmxChannel, 1, SLOTS);
  const count = toWhole(config.dmxCount, 1, SLOTS);
  if (universe === null || channel === null || count === null) return null;
  if (channel + count - 1 > SLOTS) return null;

  const levels = spread(toLevels(units), count);
  if (levels === null) return null;

  return {
    protocol: spec.id,
    host: typeof config.dmxHost === "string" ? config.dmxHost.trim() : "",
    universe: universe,
    channel: channel,
    levels: levels,
  };
}

/**
 * The same settings limited to one transport, or null when they do not use
 * it. For a widget that sends its OSC in several messages but its DMX in one
 * -- the pad in two-message mode -- so each half goes out exactly once.
 */
function only(config, protocol) {
  if (!config) return null;
  if (protocol === "osc" && !sendsOsc(config)) return null;
  if (protocol === "dmx" && !sendsDmx(config)) return null;
  // `transport` is the old one-setting form of the same choice (fields.js);
  // cleared, so it cannot outvote the two checkboxes set here.
  return Object.assign({}, config, {
    transport: undefined,
    oscEnabled: protocol === "osc",
    dmxEnabled: protocol === "dmx",
  });
}

/**
 * The settings every sending widget shares, read off its host in one go.
 *
 * Widgets differ in how they produce a value, not in where it goes, so the
 * routing half of a panel is read the same way for all of them. Keys a widget
 * does not have read as undefined, which outgoing() treats as OSC only.
 */
/** Settings held as a plain object, read the way a widget reads a host. For drive(). */
function asCtx(config) {
  return {
    get: function (key) {
      return config ? config[key] : undefined;
    },
  };
}

function routing(ctx) {
  return {
    enabled: ctx.get("enabled"),
    oscEnabled: ctx.get("oscEnabled"),
    dmxEnabled: ctx.get("dmxEnabled"),
    // Only ever set on a widget from a project saved before the checkboxes.
    transport: ctx.get("transport"),
    ip: ctx.get("ip"),
    port: ctx.get("port"),
    message: ctx.get("message"),
    argType: ctx.get("argType"),
    dmxProtocol: ctx.get("dmxProtocol"),
    dmxHost: ctx.get("dmxHost"),
    dmxUniverse: ctx.get("dmxUniverse"),
    dmxChannel: ctx.get("dmxChannel"),
    dmxCount: ctx.get("dmxCount"),
  };
}

module.exports = { outgoing, only, routing, asCtx };
