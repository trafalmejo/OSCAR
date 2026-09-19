/**
 * Connects the editor to OSCAR's bridge: OSC out to the rig, whatever the rig
 * sends back, DMX out to the fixtures, and the widget state this page shares
 * with every other device showing the same surface.
 *
 * The page is served from one port while the bridge listens on another, so
 * this is a cross-origin connection by design -- the server opts back into it
 * via its socket.io CORS config.
 *
 * Both the address and the port come from the server (/connection). The port
 * is not always 8081: OSCAR_SOCKET_PORT moves it, and a second instance on the
 * same machine must move it.
 */
function oscar_socket(editor, options) {
  var host = (options && options.ipserver) || window.location.hostname || "localhost";
  var port = (options && options.socketPort) || 8081;

  editor.ipserver = host;
  editor.socket = io("http://" + host + ":" + port, {
    transports: ["websocket", "polling"],
    reconnectionDelayMax: 5000,
  });

  /**
   * Send an OSC message. `args` may be a single value or a list -- a button
   * sends one, an XY pad two, a colour three or four.
   */
  editor.sendOSC = function (ip, port, address, args) {
    if (!editor.socket) return;
    editor.socket.emit("osc", {
      ip: ip,
      port: port,
      address: address,
      args: Array.isArray(args) ? args : [args],
    });
  };

  // ---- DMX ----------------------------------------------------------------
  // A separate event from `osc` on purpose: DMX is a stream the server keeps
  // alive, not a message it forwards, and the two are validated by different
  // gates (lib/dmx/request.js against lib/osc-message.js).

  /** Put one widget's levels on its block of channels: { source, protocol, host, universe, channel, levels }. */
  editor.sendDMX = function (request) {
    if (!editor.socket) return;
    editor.socket.emit("dmx", request);
  };

  /** Give a widget's channels up. Sent when a widget is deleted or leaves DMX. */
  editor.stopDMX = function (source) {
    if (!editor.socket) return;
    editor.socket.emit("dmx:stop", { source: source });
  };

  // ---- OSC coming back ----------------------------------------------------
  // One socket handler for the page rather than one per widget: a fader being
  // driven from outside arrives sixty times a second, and every widget has to
  // be offered it because any of them might be listening on that address.
  // Deciding who cares is each widget's own job (lib/widgets/incoming.js).
  var oscListeners = [];

  editor.socket.on("osc:in", function (message) {
    if (!message || typeof message.address !== "string" || !Array.isArray(message.args)) return;
    // A copy, so a widget detaching mid-delivery cannot make the loop skip
    // the one after it.
    oscListeners.slice().forEach(function (fn) {
      try {
        fn(message);
      } catch (err) {
        console.warn("A widget mishandled an incoming OSC message:", err && err.message);
      }
    });
  });

  /** Subscribe to every incoming message. Returns an unsubscribe function. */
  editor.onOscIn = function (fn) {
    oscListeners.push(fn);
    return function () {
      oscListeners = oscListeners.filter(function (other) {
        return other !== fn;
      });
    };
  };

  editor.socket.on("connect", function () {
    console.log("OSC bridge connected");
  });

  editor.socket.on("connect_error", function (err) {
    console.warn("OSC bridge unavailable:", err && err.message);
  });

  // Only a page that shows the surface agrees with the others about it
  // (`surface` in the options, which the preview sets and the editor does
  // not). The editor is where the layout is made, not a device on it: there
  // a widget's stored fields are the project, so an operator moving a fader
  // on a tablet would rewrite the saved default in the designer's open file;
  // and the project open in the editor need not be the one the tablets were
  // pushed, while its widget ids are short random strings that can meet
  // theirs by accident. Without shareState and onSharedState the adapter
  // offers widgets neither share nor onShared.
  if (options && options.surface) shareSurface(editor);
}

/**
 * What the other devices show.
 *
 * Several tablets on one surface have to agree: the operator who toggles a
 * button and the one watching it must see the same thing, or the second
 * one's next press sends an edge that has already been sent. The server
 * keeps one record per widget (lib/shared-sync.js) and passes each change
 * to every device but the one that made it.
 */
function shareSurface(editor) {
  // Both keyed by widget id, which is whatever the server passed on. Made
  // without a prototype so that an id can name nothing but a record: on a
  // plain object "constructor" is already there and is not a list, and
  // "__proto__" is not a key at all but the object's prototype.
  var stateListeners = Object.create(null);
  // The last state this page knows of for each widget -- told by the server
  // or shared from here -- kept so a widget that attaches after the snapshot
  // still gets it. The page loads its layout after connecting, so that order
  // is the usual one, not the exception.
  var stateById = Object.create(null);
  // What each widget asked to have undone should this device go away.
  var releaseById = Object.create(null);
  var connectedBefore = false;
  // True from a reconnect until the snapshot that follows it.
  var rejoining = false;

  function merged(known, state) {
    var next = {};
    [known, state].forEach(function (from) {
      if (!from || typeof from !== "object") return;
      Object.keys(from).forEach(function (key) {
        next[key] = from[key];
      });
    });
    return next;
  }

  function deliverState(id, state) {
    if (!state || typeof state !== "object") return;
    stateById[id] = state;
    (stateListeners[id] || []).slice().forEach(function (fn) {
      try {
        fn(state);
      } catch (err) {
        console.warn("A widget mishandled another device's state:", err && err.message);
      }
    });
  }

  function emitState(id, state, heard) {
    var msg = { id: id, state: state };
    if (heard) msg.heard = true;
    if (releaseById[id]) msg.release = releaseById[id];
    editor.socket.emit("state:set", msg);
  }

  editor.socket.on("connect", function () {
    rejoining = connectedBefore;
    connectedBefore = true;
  });

  // Everything at once: on connect, and emptied after a new layout is pushed,
  // when the old records may name widgets that no longer exist.
  editor.socket.on("state:all", function (all) {
    var before = stateById;
    var wasRejoining = rejoining;
    rejoining = false;
    stateById = Object.create(null);
    if (all && typeof all === "object") {
      Object.keys(all).forEach(function (id) {
        deliverState(id, all[id]);
      });
    }
    if (!wasRejoining) return;
    // The socket came back, and the server may have restarted and lost its
    // records while this page went on showing the surface. Whatever it no
    // longer knows is told again, or the tablets already here would agree
    // among themselves and the next one to join would start from the
    // project's defaults. What the server does know wins: it was delivered
    // above, and is not argued with.
    Object.keys(before).forEach(function (id) {
      if (stateById[id]) return;
      stateById[id] = before[id];
      emitState(id, before[id], false);
    });
  });

  editor.socket.on("state:changed", function (msg) {
    if (!msg || typeof msg.id !== "string") return;
    deliverState(msg.id, msg.state);
  });

  /**
   * Tell the other devices what one widget now shows. The server never
   * echoes it back here, and drops a change that changes nothing, so a
   * value adopted from another device goes no further than the server.
   * `how` is { heard, release }: see share() in lib/widgets/shared.js.
   */
  editor.shareState = function (id, state, how) {
    if (!editor.socket || typeof id !== "string" || !id) return;
    if (!state || typeof state !== "object") return;
    // Remembered here too: the server does not tell a device what it said
    // itself, and this is what is told again after a reconnect.
    stateById[id] = merged(stateById[id], state);
    if (how && how.release && typeof how.release === "object") releaseById[id] = how.release;
    else delete releaseById[id];
    emitState(id, state, !!(how && how.heard));
  };

  /**
   * Follow one widget's state as the other devices report it. Handed the
   * state already known, if any, so a widget attaching after the snapshot
   * arrived starts where the others are. Returns an unsubscribe function.
   */
  editor.onSharedState = function (id, fn) {
    (stateListeners[id] = stateListeners[id] || []).push(fn);
    if (stateById[id]) fn(stateById[id]);
    return function () {
      stateListeners[id] = (stateListeners[id] || []).filter(function (other) {
        return other !== fn;
      });
    };
  };
}
