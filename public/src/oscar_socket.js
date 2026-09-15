/**
 * Connects the editor to OSCAR's OSC and DMX bridge.
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

  /**
   * Drive a block of DMX channels.
   *
   * Unlike an OSC message this does not describe a single packet. It tells the
   * server what this widget's channels are worth from now on; the server keeps
   * a frame per universe and repeats it, because fixtures that stop hearing
   * from a source do not hold their look, they time out.
   */
  editor.sendDMX = function (request) {
    if (!editor.socket) return;
    editor.socket.emit("dmx", request);
  };

  /** Give a widget's channels up. Sent when a widget is deleted. */
  editor.stopDMX = function (source) {
    if (!editor.socket) return;
    editor.socket.emit("dmx:stop", { source: source });
  };

  editor.socket.on("connect", function () {
    console.log("OSCAR bridge connected");
  });

  editor.socket.on("connect_error", function (err) {
    console.warn("OSCAR bridge unavailable:", err && err.message);
  });
}
