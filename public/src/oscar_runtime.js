/**
 * The runtime an exported OSCAR interface carries with it.
 *
 * Built into public/src/runtime.bundle.js, which is inlined into every export.
 * There is no editor here, no GrapesJS and no OSCAR server serving the page --
 * the file may well have been opened by double-clicking it on a laptop that is
 * not the one running OSCAR.
 */

var { attachAll, createTransport } = require("./adapters/standalone");

var DEFAULT_PORT = 8081;

/**
 * Where OSCAR's OSC bridge is.
 *
 * Baked in at export time, because the alternative -- asking the page's own
 * origin for /connection, the way the editor does -- is exactly what cannot
 * work here. An exported page is opened from a file:// URL or from some other
 * web server, so that request either 404s or is not made at all, and the page
 * would have no idea where to send. The editor knows the answer at the moment
 * of export, so it writes it down.
 *
 * The query string overrides it so a surface can follow OSCAR to another
 * machine without being exported again.
 */
function endpoint() {
  var baked = window.OSCAR_EXPORT || {};
  var params = new URLSearchParams(window.location.search);

  var host =
    params.get("oscar-host") || baked.host || window.location.hostname || "localhost";

  var port = Number(params.get("oscar-port") || baked.port);
  // A port of 0 means "any free port" to a TCP stack, which reaches nothing,
  // so an unreadable value falls back to OSCAR's default rather than to zero.
  if (!Number.isInteger(port) || port < 1 || port > 65535) port = DEFAULT_PORT;

  return { host: String(host), port: port };
}

/**
 * The one thing every report about a broken export needed someone to say.
 *
 * A page that looks right and sends nothing is indistinguishable from a page
 * that is broken, so it states which it is. Once the bridge answers the notice
 * fades: during a show nothing may sit on top of a control.
 */
function statusNotice(where) {
  var el = document.createElement("div");
  el.className = "oscar-status";
  el.setAttribute("role", "status");
  document.body.appendChild(el);

  var hideTimer = null;

  return function show(state) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    if (state === "connected") {
      el.className = "oscar-status oscar-status-ok";
      el.textContent = "Connected to OSCAR at " + where + ".";
      hideTimer = setTimeout(function () {
        el.className = "oscar-status oscar-status-ok oscar-status-hidden";
      }, 2000);
      return;
    }

    el.className = "oscar-status";
    el.textContent =
      "No connection to OSCAR at " +
      where +
      ". These controls cannot send anything until OSCAR is running there and " +
      "this device can reach it -- a browser cannot send OSC by itself.";
  };
}

function boot() {
  var where = endpoint();
  var label = where.host + ":" + where.port;

  if (typeof io !== "function") {
    console.error("OSCAR: this export is missing its socket.io client");
    return;
  }

  var show = statusNotice(label);
  show("disconnected");

  var transport = createTransport(io, where, { onStatus: show });
  var wired = attachAll(document, transport);

  console.log(
    "OSCAR: " +
      wired.attached +
      " control(s) pointed at the OSC bridge on " +
      label +
      (wired.skipped ? ", " + wired.skipped + " skipped" : "")
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
