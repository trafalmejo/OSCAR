"use strict";

const { matchesAddress } = require("../osc-in");

/**
 * Decide whether an incoming OSC message is this widget's business.
 *
 * The mirror of outgoing(): every widget funnels through here, so the Listen
 * switch cannot be implemented three slightly different ways, and a widget that
 * was never asked to listen can never be moved from the network.
 *
 * Returning the values rather than applying them keeps the decision separable
 * from the effect -- which is the whole reason the loop guard is testable. What
 * this function does *not* do is as important as what it does: it never
 * produces a message to send. Adopting a value and sending it back is how a
 * fader and its target spend a show screaming at each other.
 */
function incoming(config, message) {
  // Listen is off by default, so a surface built before this existed, or built
  // by someone who never opened the setting, behaves exactly as it always did.
  if (!config || !config.listen) return null;
  if (!message || !Array.isArray(message.args)) return null;
  if (!matchesAddress(message.address, config.message)) return null;

  return { address: message.address, values: message.args };
}

/**
 * Follow the messages a widget's own Message address attracts.
 *
 * The subscription every widget would otherwise write out for itself: read
 * Listen and Message off the context each time, because both can be edited
 * while the widget is live, and hand on only the values. A widget that answers
 * to more than one address -- the pad in two-message mode -- calls incoming()
 * directly instead.
 *
 * @returns an unsubscribe function, or null where the host cannot receive.
 */
function onIncoming(ctx, fn) {
  if (!ctx.onOsc) return null;
  return ctx.onOsc(function (message) {
    const match = incoming({ listen: ctx.get("listen"), message: ctx.get("message") }, message);
    if (match) fn(match.values, match.address);
  });
}

module.exports = { incoming, onIncoming };
