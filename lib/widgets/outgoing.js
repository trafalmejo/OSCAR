"use strict";

const { toArgs } = require("../osc-args");
const { SLOTS } = require("../dmx/spec");
const { toWhole, toLevels, spread } = require("../dmx/levels");

/**
 * Decide what a widget should put on the wire, or null for silence.
 *
 * Every widget funnels through here, so the Enabled switch cannot be
 * implemented three slightly different ways, and a value that no argument type
 * can carry is dropped rather than guessed at.
 *
 * A widget hands over two readings of the same gesture:
 *
 *   raw   the value in the widget's own units -- 0-100, a cue number, "go" --
 *         which is what OSC carries
 *   unit  the same position as 0..1, which is what a DMX slot can be scaled
 *         from. Only the widget knows its own range, so only the widget can
 *         work this out; a slider labelled 20-2000 Hz still means "full" at the
 *         top.
 *
 * The result carries an OSC half, a DMX half, or both, and the adapter sends
 * whichever halves are present.
 */
function outgoing(config, raw, unit) {
  if (!config || !config.enabled) return null;

  const transport = config.transport || "osc";
  const wantsOsc = transport === "osc" || transport === "both";
  const wantsDmx = transport === "dmx" || transport === "both";

  const message = {};
  let sending = false;

  if (wantsOsc) {
    const args = oscArgs(config, raw);
    if (args) {
      message.ip = config.ip;
      message.port = config.port;
      message.address = config.message;
      message.args = args;
      sending = true;
    } else if (!wantsDmx) {
      return null;
    }
  }

  if (wantsDmx) {
    const dmx = dmxRequest(config, unit);
    if (dmx) {
      message.dmx = dmx;
      sending = true;
    }
  }

  return sending ? message : null;
}

/** The OSC arguments for one gesture, or null if any value cannot be sent. */
function oscArgs(config, raw) {
  // A list carries a widget that produces several values at once -- a pad
  // sends two, a colour three or four -- all sharing one argument type.
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
 * The DMX request for one gesture, or null.
 *
 * Null here means the widget stays where it is rather than going to zero. That
 * is the whole point: an unreadable level coerced to 0 is a blackout, and it
 * would look exactly like someone pulling the fader down.
 */
function dmxRequest(config, unit) {
  const levels = toLevels(unit);
  if (!levels) return null;

  const channel = toWhole(config.dmxChannel, 1, SLOTS);
  if (channel === null) return null;

  const count = toWhole(config.dmxCount, 1, SLOTS);
  if (count === null) return null;

  const universe = toWhole(config.dmxUniverse, 0, 63999);
  if (universe === null) return null;

  // The block cannot run past the end of the universe. The settings panel
  // refuses this too; a project file edited by hand reaches here instead.
  const fits = Math.min(count, SLOTS - channel + 1);

  return {
    protocol: config.dmxProtocol || "artnet",
    host: typeof config.dmxHost === "string" ? config.dmxHost.trim() : "",
    universe: universe,
    channel: channel,
    levels: spread(levels, fits),
    source: config.id,
  };
}

/**
 * The settings every widget shares, read off its host in one go.
 *
 * Widgets differ in how they produce a value, not in where it goes, so the
 * routing half of a settings panel is read the same way for all of them. A
 * widget adds its own keys on top.
 */
function routing(ctx) {
  return {
    id: ctx.id,
    enabled: ctx.get("enabled"),
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

module.exports = { outgoing, routing };
