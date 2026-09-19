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

function boot() {
  standalone.start({
    document: document,
    baked: window.OSCAR_EXPORT,
    search: window.location.search,
    // Set only on a page OSCAR is serving itself; see resolveEndpoint.
    served: window.OSCAR_SERVED
      ? { port: window.OSCAR_SERVED.port, hostname: window.location.hostname }
      : null,
    // `surface`: an exported page is a device showing the layout, exactly as
    // /preview is, so it agrees with the others on what each widget shows.
    connect:
      typeof io === "function"
        ? function (host, port) {
            var bridge = {};
            oscarSocket(bridge, { ipserver: host, socketPort: port, surface: true });
            return bridge;
          }
        : null,
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
