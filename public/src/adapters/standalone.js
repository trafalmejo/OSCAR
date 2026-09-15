/**
 * The standalone adapter: OSCAR's widgets running on a page of their own.
 *
 * This is the second implementation of the `ctx` contract documented in
 * lib/widgets/index.js -- adapters/grapesjs.js is the first. That split is what
 * makes an exported interface possible at all: the widgets are already plain
 * DOM and already editor-free, so a working export is a new adapter, not a
 * second copy of the button, the slider and the pad.
 *
 * Where the GrapesJS adapter reads settings from a component model and sends
 * through the editor, this one reads them from the element's own
 * data-oscar-config and sends over socket.io.
 */

var { readWidget, WIDGET_SELECTOR } = require("../../../lib/export/config");

/**
 * The `ctx` one widget runs against.
 *
 * @param {Element} el
 * @param {object} config - this widget's settings, already parsed
 * @param {{ send: Function }} transport
 */
function contextFor(el, config, transport) {
  return {
    get: function (key) {
      return config[key];
    },

    set: function (key, value) {
      // The widget's own scratch space -- a slider remembering where its thumb
      // is between moves. It lives for as long as the page does and is not
      // written back to the markup: an exported file is the configuration, and
      // a surface must come up in the same state every time it is opened.
      config[key] = value;
    },

    send: function (message) {
      if (!message) return;
      transport.send(message.ip, message.port, message.address, message.args);
    },

    setClass: function (name, on) {
      if (on) el.classList.add(name);
      else el.classList.remove(name);
    },

    onChange: function () {
      // Nothing edits settings here: an exported page has no settings panel.
      // The widgets subscribe anyway, and expect an unsubscribe back.
      return function () {};
    },
  };
}

/**
 * Wire every widget on the page.
 *
 * @param {ParentNode} root
 * @param {{ send: Function }} transport
 * @returns {{ detach: Function, attached: number, skipped: number }}
 */
function attachAll(root, transport) {
  var elements = root.querySelectorAll(WIDGET_SELECTOR);
  var detachers = [];
  var skipped = 0;

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var widget = readWidget(el);

    if (!widget) {
      // Configuration that cannot be read leaves the control inert rather than
      // running it on the defaults; lib/export/config.js says why.
      skipped++;
      if (typeof console !== "undefined") {
        console.warn("OSCAR: a control's settings could not be read, so it is inactive", el);
      }
      continue;
    }

    detachers.push(widget.definition.attach(el, contextFor(el, widget.config, transport)));
  }

  return {
    attached: detachers.length,
    skipped: skipped,
    detach: function () {
      detachers.forEach(function (detach) {
        if (detach) detach();
      });
      detachers = [];
    },
  };
}

/**
 * The wire to OSCAR's OSC bridge.
 *
 * `io` is passed in rather than reached for, so this can be driven from a test
 * without a browser.
 *
 * @param {Function} io - the socket.io client factory
 * @param {{ host: string, port: number }} endpoint
 * @param {{ onStatus?: (state: string) => void }} [handlers]
 */
function createTransport(io, endpoint, handlers) {
  var url = "http://" + endpoint.host + ":" + endpoint.port;
  var onStatus = (handlers && handlers.onStatus) || function () {};

  var socket = io(url, {
    transports: ["websocket", "polling"],
    reconnectionDelayMax: 5000,
  });

  socket.on("connect", function () {
    onStatus("connected");
  });
  socket.on("disconnect", function () {
    onStatus("disconnected");
  });
  socket.on("connect_error", function () {
    onStatus("disconnected");
  });

  return {
    socket: socket,
    endpoint: endpoint,

    send: function (ip, port, address, args) {
      // Dropped rather than queued while the bridge is away. socket.io buffers
      // by default, so a reconnection would replay every position a slider
      // passed through while it was offline, in one burst, minutes late. On a
      // rig that is a visible glitch; a press that did not happen is not.
      if (!socket.connected) return false;

      socket.emit("osc", {
        ip: ip,
        port: port,
        address: address,
        args: Array.isArray(args) ? args : [args],
      });
      return true;
    },
  };
}

module.exports = { contextFor, attachAll, createTransport };
