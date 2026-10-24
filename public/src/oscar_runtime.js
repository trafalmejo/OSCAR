/**
 * The runtime an exported OSCAR interface carries with it.
 *
 * Built into public/src/runtime.bundle.js (npm run build), which POST /export
 * inlines into every exported file next to the socket.io client. All of the
 * behaviour is in adapters/standalone.js, where a test can reach it; this
 * file only hands it the browser.
 */

var standalone = require("./adapters/standalone");
var oscarSocket = require("./oscar_socket");
var relaySocket = require("./relay_socket");
var { browserDevice } = require("./device");

/**
 * Who this page is, for OSCAR's network log: "show:<id>" for a surface OSCAR
 * serves at /show/<id>, "file" for a copy opened from disk or served
 * elsewhere.
 */
function pageFrom(location) {
  var match = /^\/show\/([a-z0-9][a-z0-9-]*)\/?$/.exec((location && location.pathname) || "");
  return match ? "show:" + match[1] : "file";
}

/**
 * What this device is called, for OSCAR's network log and its Running
 * window. `?device=Bar%20left` on the page's address names it, so a printed
 * QR code or a bookmark can carry the name, and it is kept on the device
 * for the next open; `?device=` with nothing after it forgets it. It is a
 * label and nothing more: OSCAR sends nothing differently for it.
 */
function deviceName(location, storage) {
  var KEY = "oscarDevice";
  var said = null;
  try {
    said = new URLSearchParams((location && location.search) || "").get("device");
  } catch (err) {
    said = null;
  }
  if (said !== null) said = said.trim();
  try {
    if (said !== null) {
      if (said) storage.setItem(KEY, said);
      else storage.removeItem(KEY);
    }
    return storage.getItem(KEY) || undefined;
  } catch (err) {
    // A browser that keeps nothing (private mode, or no storage at all).
    return said || undefined;
  }
}

function localStorageOf(win) {
  try {
    return win.localStorage;
  } catch (err) {
    return null;
  }
}

function boot() {
  var device = deviceName(window.location, localStorageOf(window));
  standalone.start({
    document: document,
    window: window,
    // The browser's own device: vibration where the browser has it (Android;
    // an iPhone's Safari does not), and nothing the app alone can do. A
    // widget that is app-only checks `device.app`, which the browser's
    // device sets false. The OSCAR app runs this same runtime with a
    // device of its own.
    device: browserDevice(window),
    baked: window.OSCAR_EXPORT,
    search: window.location.search,
    // Set only on a page OSCAR is serving itself; see resolveEndpoint.
    served: window.OSCAR_SERVED
      ? { port: window.OSCAR_SERVED.port, hostname: window.location.hostname }
      : null,
    // Set only on a page a relay is serving, to a device that is not on
    // OSCAR's network: { url } of the room's WebSocket. It outranks the rest.
    relay: window.OSCAR_RELAY && typeof window.OSCAR_RELAY.url === "string" ? window.OSCAR_RELAY : null,
    connectRelay:
      typeof WebSocket === "function"
        ? function (url) {
            var bridge = {};
            oscarSocket(bridge, { socket: relaySocket(url), surface: true });
            return bridge;
          }
        : null,
    // `surface`: an exported page is a device showing the layout, exactly as
    // /preview is, so it agrees with the others on what each widget shows.
    connect:
      typeof io === "function"
        ? function (host, port) {
            var bridge = {};
            oscarSocket(bridge, { ipserver: host, socketPort: port, device: device, surface: true, from: pageFrom(window.location) });
            return bridge;
          }
        : null,
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
