/**
 * Connects the editor to OSCAR's OSC bridge, in both directions: messages out
 * to the rig, OSC coming back in, and the widget state this page shares with
 * every other device showing the same surface.
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

  // ---- OSC coming back ----------------------------------------------------
  // One socket handler for the whole page rather than one per widget: a fader
  // being driven from outside arrives sixty times a second, and every widget
  // has to be offered it because any of them might be listening on that
  // address. Deciding who cares is each widget's own job.
  var oscListeners = [];

  editor.socket.on("osc:in", function (message) {
    if (!message || !message.address) return;
    // A copy of the list, so a widget detaching mid-delivery cannot make the
    // loop skip the one after it.
    oscListeners.slice().forEach(function (fn) {
      try {
        fn(message);
      } catch (err) {
        console.warn("A widget mishandled an incoming OSC message:", err && err.message);
      }
    });
  });

  editor.onOscIn = function (fn) {
    oscListeners.push(fn);
    return function () {
      oscListeners = oscListeners.filter(function (other) {
        return other !== fn;
      });
    };
  };

  // ---- shared widget state ------------------------------------------------
  // Several tablets showing the same surface have to agree: the operator who
  // toggles a button and the one watching it must see the same thing, or the
  // second one's next press sends an edge that has already been sent.
  var stateListeners = {};
  // The last state the server told us about, kept so a widget that attaches
  // after the catch-up snapshot still gets it -- the page loads its layout
  // asynchronously, so that order is the normal one, not the exception.
  var stateById = {};

  function deliver(id, state) {
    stateById[id] = state;
    (stateListeners[id] || []).slice().forEach(function (fn) {
      try {
        fn(state);
      } catch (err) {
        console.warn("A widget mishandled a shared state update:", err && err.message);
      }
    });
  }

  editor.socket.on("state:all", function (all) {
    stateById = {};
    Object.keys(all || {}).forEach(function (id) {
      deliver(id, all[id]);
    });
  });

  editor.socket.on("state:changed", function (msg) {
    if (!msg || !msg.id) return;
    deliver(msg.id, msg.state);
  });

  /**
   * Publish one widget's state.
   *
   * Nothing is echoed back to the sender, and the server drops a change that
   * changes nothing, so a device repeating what it was just told goes no
   * further than the server.
   */
  editor.shareState = function (id, state) {
    if (!editor.socket || !id) return;
    editor.socket.emit("state:set", { id: id, state: state });
  };

  editor.onSharedState = function (id, fn) {
    (stateListeners[id] = stateListeners[id] || []).push(fn);
    if (stateById[id]) fn(stateById[id]);
    return function () {
      stateListeners[id] = (stateListeners[id] || []).filter(function (other) {
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
}
