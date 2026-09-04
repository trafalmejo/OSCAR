/**
 * Connects the editor to OSCAR's OSC bridge.
 *
 * The page is served from :8080 while the bridge listens on :8081, so this is
 * a cross-origin connection by design -- the server opts back into it via its
 * socket.io CORS config.
 */
function oscar_socket(editor, options) {
  var host = (options && options.ipserver) || window.location.hostname || "localhost";

  editor.ipserver = host;
  editor.socket = io("http://" + host + ":8081", {
    transports: ["websocket", "polling"],
    reconnectionDelayMax: 5000,
  });

  editor.socket.on("connect", function () {
    console.log("OSC bridge connected");
  });

  editor.socket.on("connect_error", function (err) {
    console.warn("OSC bridge unavailable:", err && err.message);
  });
}
