/**
 * Connects the editor to OSCAR's bridge: OSC out to the rig, whatever the rig
 * sends back, and DMX out to the fixtures.
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
}
