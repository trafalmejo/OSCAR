"use strict";

/**
 * Passing widget state between the devices on one surface, over the socket
 * each of them already holds for OSC.
 *
 * Three events, kept apart from osc, osc:in and dmx because they are neither
 * a message to the rig nor one from it:
 *   state:set      device -> server   { id, state }   one widget's new state
 *   state:changed  server -> others   { id, state }   that widget's whole
 *                                                     state, after the change
 *   state:all      server -> device   { id: state }   everything, on connect
 *                                                     and after a new layout
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

const { SharedState } = require("./shared-state");

/**
 * Wire one device that has just connected.
 *
 * It is handed everything first: a tablet joining mid-show has to draw the
 * surface the others already see, or it disagrees with the one next to it
 * until somebody touches every control on it.
 */
function join(store, socket) {
  socket.emit("state:all", store.snapshot());

  socket.on("state:set", (msg) => {
    if (!msg || typeof msg !== "object") return;
    const state = store.apply(msg.id, msg.state);
    // Nothing changed: this device was repeating back what it was told, or
    // sent something no widget can show. Stopping here is what keeps two
    // tablets from trading the same value between them all evening.
    if (!state) return;
    socket.broadcast.emit("state:changed", { id: msg.id, state });
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
