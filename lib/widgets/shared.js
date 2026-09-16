"use strict";

/**
 * Agreeing with the other devices on the surface.
 *
 * Several tablets showing one layout each run their own copy of a widget,
 * and a copy that does not hear about the others is wrong the moment one of
 * them is touched: a toggle that one operator switched on still draws off
 * on the next tablet, and its next press sends the ON edge again. So a
 * widget tells the host what it now shows -- { on }, { value }, { x, y } --
 * every time a hand changes it, and follows what the host says the others
 * show. Neither needs switching on: two tablets agreeing is not a feature
 * anyone should have to find.
 *
 * Both host methods are optional (see the ctx contract in index.js), so
 * every widget goes through here rather than checking for them itself.
 *
 * The rules that keep this from becoming a loop are the host's and the
 * server's, not the widget's, and a widget cannot break them: the host
 * refuses share() and send() while a shared state is being delivered, and
 * the server passes a change on only when it changed something. What a
 * widget owes in return is to treat what arrives the way it treats what
 * the rig sends -- apply it to the element, store it with set(), and
 * nothing else -- and to ignore it while a hand is on the control.
 */

/** Tell the other devices what this widget now shows. */
function share(ctx, state) {
  if (typeof ctx.share === "function") ctx.share(state);
}

/**
 * Follow this widget's state as the other devices report it.
 *
 *   const stopShared = onShared(ctx, function (state) { ... });
 *   ... in detach:  if (stopShared) stopShared();
 *
 * `state` is whatever the widgets on the other devices shared, merged, so
 * a key may be missing and a value is to be read with toNumber() from
 * osc-args.js or checked for the type expected, never assumed.
 *
 * @returns an unsubscribe function, or null where the host has no other
 *   devices to speak of.
 */
function onShared(ctx, fn) {
  if (typeof ctx.onShared !== "function") return null;
  return ctx.onShared(fn);
}

module.exports = { share, onShared };
