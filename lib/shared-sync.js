"use strict";

/**
 * Passing widget state between the devices on one surface, over the socket
 * each of them already holds for OSC.
 *
 * Three events, kept apart from osc, osc:in and dmx because they are neither
 * a message to the rig nor one from it:
 *   state:set      device -> server   { id, state }   one widget's new state
 *                                     + heard: true   the rig said so, and
 *                                                     said so to everyone:
 *                                                     record it, tell nobody
 *                                     + release: {..} what to make of the
 *                                                     widget if this device
 *                                                     goes away first
 *   state:changed  server -> others   { id, state }   that widget's whole
 *                                                     state, after the change
 *   state:all      server -> device   { id: state }   everything, on connect
 *                                                     and after a new layout
 *   state:sync     device -> server   (nothing)       "hand me everything
 *                                                     again"; answered with
 *                                                     state:all to that
 *                                                     device alone
 *
 * Two rules keep this from becoming a loop. The sender is never told what it
 * just said: state:changed goes to every device but that one. And nothing is
 * broadcast unless the record actually changed (SharedState.apply returning
 * null), so a device repeating back the value it was handed dies here.
 * A widget adopting what arrives never re-shares it, and the browser side
 * refuses a share made while one is being adopted; between the three, a
 * value can travel from one device to every other exactly once.
 *
 * The socket objects are socket.io's, but only emit, on and broadcast.emit
 * are used, so a test can hand this a stand-in.
 */

const { SharedState, isSharable, MAX_WIDGETS, MAX_KEYS } = require("./shared-state");

/**
 * Is this a patch worth holding on to until the device goes away? It is
 * checked again by the store when it is applied; this only keeps a page from
 * parking a megabyte against each of a thousand ids in the meantime.
 */
function isRelease(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.length <= MAX_KEYS && keys.every((key) => isSharable(patch[key]));
}

/**
 * Wire one device that has just connected.
 *
 * It is handed everything first: a tablet joining mid-show has to draw the
 * surface the others already see, or it disagrees with the one next to it
 * until somebody touches every control on it.
 */
function join(store, socket) {
  socket.emit("state:all", store.snapshot());

  // What this device asked to have undone if it goes away: id -> patch. A
  // momentary button is on only for as long as a finger is on it, and a
  // tablet that drops off the network mid-press never says the finger came
  // up; without this every other device would draw the button lit until
  // somebody pressed it again.
  const releases = new Map();

  socket.on("state:set", (msg) => {
    if (!msg || typeof msg !== "object") return;
    const state = store.apply(msg.id, msg.state, { heard: msg.heard === true });

    // The latest word from this device on this widget decides whether there
    // is anything to undo, changed or not: the share that says the finger
    // came up carries no release, and so clears the one the press left.
    if (typeof msg.id === "string" && isRelease(msg.release)) {
      // Bounded like the store, for the same reason: a page inventing ids.
      if (releases.has(msg.id) || releases.size < MAX_WIDGETS) releases.set(msg.id, msg.release);
    } else {
      releases.delete(msg.id);
    }

    // Nothing changed: this device was repeating back what it was told, or
    // sent something no widget can show. Stopping here is what keeps two
    // tablets from trading the same value between them all evening.
    if (!state) return;
    // `heard` marks a value the device took from the rig rather than from a
    // hand. Every device on the layout has the same Listen setting and was
    // sent the same OSC message, so the others already show it: the record
    // is kept for whoever joins later, and nobody is told. Telling them
    // would be one redundant broadcast per device per message on a fader
    // stream, and one that arrives late drags a thumb back to a value the
    // rig has already moved on from.
    if (msg.heard === true) return;
    socket.broadcast.emit("state:changed", { id: msg.id, state });
  });

  // A surface with several pages only runs the widgets of the page it is
  // showing, so a device hears the rig for that page and no other. What the
  // rig said about the rest was recorded here as `heard` and, by the rule
  // above, told to nobody -- which is right for the devices that were
  // showing that page and leaves this one behind. It asks as it turns the
  // page, and is handed what a device joining now would be. Nothing is
  // written and nobody else is told, so there is nothing here to loop.
  socket.on("state:sync", () => {
    socket.emit("state:all", store.snapshot());
  });

  socket.on("disconnect", () => {
    for (const [id, patch] of releases) {
      // A record that is gone was forgotten with its layout; undoing it
      // would bring the id back onto a surface that may not have it.
      if (!store.get(id)) continue;
      const state = store.apply(id, patch);
      if (state) socket.broadcast.emit("state:changed", { id, state });
    }
    releases.clear();
  });
}

/**
 * A new layout has been pushed: forget every record and tell every device,
 * so none of them hands a stale position to a widget that happens to share
 * an id with one that is gone.
 */
function reset(store, io) {
  store.clear();
  io.emit("state:all", {});
}

/** One store, wired to every device that connects to `io`. */
function sharedSync(io, store) {
  const shared = store || new SharedState();
  io.on("connection", (socket) => join(shared, socket));
  return {
    store: shared,
    reset: () => reset(shared, io),
  };
}

module.exports = { join, reset, sharedSync };
