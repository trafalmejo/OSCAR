"use strict";

const { toArgs } = require("../osc-args");

/**
 * Decide the message a widget should put on the wire, or null for silence.
 *
 * Every widget funnels through here, so the Enabled switch cannot be
 * implemented three slightly different ways, and a value that no argument type
 * can carry is dropped rather than guessed at.
 */
function outgoing(config, raw) {
  if (!config || !config.enabled) return null;

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

  return {
    ip: config.ip,
    port: config.port,
    address: config.message,
    args: args,
  };
}

module.exports = { outgoing };
