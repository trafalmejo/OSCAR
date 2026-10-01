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
 *
 * `room` is the socket.io room of the devices it shares with: those showing
 * the same surface. Without one it shares with every device there is.
 */
function join(store, socket, room) {
  // Asked for at each send: socket.io makes a broadcast afresh every time.
  const others = () => (room && typeof socket.to === "function" ? socket.to(room) : socket.broadcast);
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
    others().emit("state:changed", { id: msg.id, state });
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
      if (state) others().emit("state:changed", { id, state });
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

// A page says which surface it shows; a page inventing surfaces would
// otherwise be handed a record of its own each time. Past this many, a
// newcomer shares the record of the pages that said nothing.
const MAX_SCOPES = 200;

/** The socket.io room of the devices showing one surface. */
const roomOf = (scope) => "state:" + scope;

/**
 * A record per surface, wired to every device that connects to `io`.
 *
 * Two projects made from the same template carry the same widget ids, and
 * one record for everything had each moving the other's controls. So the
 * record is kept per *scope*: the surface a page shows ("lobby"), the
 * preview ("preview"), or "" for a page that does not say -- a file opened
 * from disk, a page built before pages named themselves -- which share one
 * record between them as every page once did.
 *
 * @param {object} io socket.io's server, or a stand-in
 * @param {{ scopeOf?: (socket) => string } | SharedState} [options]
 *        scopeOf says which surface a device shows; without it there is one
 *        scope. A SharedState, as this took before, is that one scope's record.
 */
function sharedSync(io, options) {
  const given = options instanceof SharedState ? options : null;
  const scopeOf = options && !given && typeof options.scopeOf === "function" ? options.scopeOf : () => "";
  const stores = new Map(); // scope -> SharedState
  let watchers = [];

  /** The scope a surface's record is kept under: its own, or "" once there are too many. */
  function keyFor(scope) {
    const key = typeof scope === "string" ? scope : "";
    return key === "" || stores.has(key) || stores.size < MAX_SCOPES ? key : "";
  }

  function storeFor(scope) {
    const key = keyFor(scope);
    let store = stores.get(key);
    if (!store) {
      store = key === "" && given ? given : new SharedState();
      stores.set(key, store);
      // Whoever follows the states is told which surface a change was on.
      store.onChange((id, state, info) => {
        for (const fn of watchers.slice()) {
          try {
            fn(id, state, Object.assign({}, info, { surface: key }));
          } catch (err) {
            // Whoever is watching is not this record's problem.
          }
        }
      });
    }
    return store;
  }

  /** Every device of one scope, or with a stand-in that has no rooms, every device. */
  const devices = (scope) => (typeof io.to === "function" ? io.to(roomOf(scope)) : io);

  io.on("connection", (socket) => {
    let said = "";
    try {
      said = scopeOf(socket);
    } catch (err) {
      // A device that cannot be placed shares with the others that cannot.
    }
    const scope = keyFor(said);
    if (typeof socket.join === "function") socket.join(roomOf(scope));
    join(storeFor(scope), socket, roomOf(scope));
  });

  return {
    /** The record of the pages that do not say which surface they show. */
    store: storeFor(""),
    storeFor,

    /**
     * Say something to every device showing a surface. The pages that do not
     * say which surface they show are told as well, as they always were: a
     * file opened from disk still follows a schedule and the rig.
     */
    tell(scope, event, payload) {
      const key = keyFor(scope);
      if (typeof io.to !== "function") return io.emit(event, payload);
      devices(key).emit(event, payload);
      if (key !== "") devices("").emit(event, payload);
    },

    /** Be told of every change on every surface: fn(id, state, { heard?, surface }). Returns an unsubscribe function. */
    onChange(fn) {
      if (typeof fn !== "function") return function () {};
      watchers.push(fn);
      return () => {
        watchers = watchers.filter((other) => other !== fn);
      };
    },

    /** Is anybody following the states? */
    watched: () => watchers.length > 0,

    /** Forget one surface's record and tell its devices; with no scope, every record and every device. */
    reset(scope) {
      if (typeof scope === "string") {
        storeFor(scope).clear();
        devices(scope).emit("state:all", {});
        return;
      }
      for (const store of stores.values()) store.clear();
      io.emit("state:all", {});
    },
  };
}

module.exports = { join, reset, sharedSync, roomOf, MAX_SCOPES };
