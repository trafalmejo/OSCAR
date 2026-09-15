"use strict";

const { matchesAddress } = require("../osc-address");

/**
 * Deciding whether an incoming OSC message is this widget's business.
 *
 * The mirror of outgoing(): every widget that follows the rig funnels through
 * here, so the Listen switch cannot be implemented three slightly different
 * ways, and a widget that was never asked to listen can never be moved from
 * the network.
 *
 * What this module does *not* do matters as much as what it does. It hands a
 * widget values and nothing else -- never a message to send, and never the
 * context to send one with. A value that arrived from outside and went straight
 * back out is a loop between OSCAR and any software that echoes its own state,
 * and the only way to be sure no widget closes that loop is to give the
 * receive path nothing to close it with. The host enforces the same thing from
 * its side: ctx.send() is refused while an incoming message is being
 * delivered (see the ctx contract in index.js).
 */

/**
 * The values an incoming message carries for a widget, or null.
 *
 * Enabled is the master switch, and a widget that is off is deaf as well as
 * silent: a surface is switched off to be laid out while the rig is live, and
 * a thumb that keeps jumping under the pointer is not laid out.
 *
 * `config.message` is the widget's own address, or a list of them for a widget
 * that answers to several (an XY pad in two-message mode). It is always taken
 * literally; the incoming address is the pattern (lib/osc-address.js). An
 * address also always reaches itself: some software exposes addresses like
 * /layer[1]/opacity and echoes them verbatim, and read as a pattern that
 * string would never match its own widget.
 *
 * @returns {{address: string, values: Array}|null}  `address` is the widget's
 *   own address that matched, so a widget with several knows which one.
 */
function incoming(config, message) {
  if (!config || !config.enabled || !config.listen) return null;
  if (!message || typeof message.address !== "string" || !Array.isArray(message.args)) return null;

  const addresses = Array.isArray(config.message) ? config.message : [config.message];
  for (const address of addresses) {
    if (message.address === address || matchesAddress(message.address, address)) {
      return { address: address, values: message.args.slice() };
    }
  }
  return null;
}

/**
 * Follow the messages a widget's own address attracts.
 *
 * This is the whole of what a widget writes to receive: it applies the
 * values to its element and stores them with ctx.set, and that is all.
 *
 *   const stopOsc = follow(ctx, function (values, address) { ... });
 *   ... in detach:  if (stopOsc) stopOsc();
 *
 * Enabled, Listen and Message are read afresh for every message, because all
 * three can be edited while the widget is live. `addresses`, if given, is a
 * function returning the address or addresses to follow instead of Message.
 *
 * @returns an unsubscribe function, or null where the host cannot receive.
 */
function follow(ctx, fn, addresses) {
  if (typeof ctx.onOsc !== "function") return null;
  return ctx.onOsc(function (message) {
    const wanted = addresses ? addresses() : ctx.get("message");
    const config = { enabled: ctx.get("enabled"), listen: ctx.get("listen"), message: wanted };
    const match = incoming(config, message);
    if (match) fn(match.values, match.address);
  });
}

module.exports = { incoming, follow };
