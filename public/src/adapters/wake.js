/**
 * Coming back.
 *
 * A phone that locks its screen, switches to another app or walks out of
 * Wi-Fi range has its page paused, and iOS and Android close its socket
 * without a word to the page. socket.io learns of that when a ping goes
 * unanswered, tens of seconds after the screen is on again, and then waits
 * out its back-off before trying; a hand already on a fader cannot wait that
 * long. This is the "tablet drops off after half an hour" of every gallery
 * thread, seen from the page's side.
 *
 * So the page listens for the moments it comes back -- the tab shown again,
 * the page restored from the back-forward cache, the network returning --
 * and does one of two things:
 *
 *   - the socket says it is away: it is told to try again now, not after
 *     the back-off;
 *   - the socket says it is connected: it is asked for the snapshot
 *     (state:sync) and given PROBE_MS to answer. No answer means the socket
 *     is dead without knowing it, and it is dropped and made again. An
 *     answer is the catch-up: what the other devices did while this one
 *     was asleep.
 *
 * Nothing here sends a move. A move made while asleep was never made, and
 * the page says so when the bridge returns (adapters/standalone.js).
 *
 * @param {object} deps
 * @param {object} [deps.doc] the document, for visibilitychange
 * @param {object} [deps.win] the window, for pageshow and online
 * @param {() => boolean} deps.connected what the socket says of itself
 * @param {() => void} deps.reconnect drop the socket and connect again, now
 * @param {() => void} deps.sync ask for the snapshot
 * @param {(fn: Function) => void} deps.onSynced be told whenever a snapshot arrives
 * @param {Function} [deps.setTimeout] [deps.clearTimeout] [deps.now] for the tests
 * @returns {{ wake: () => void, stop: () => void }}
 */

/** How long a connected socket has to answer a sync before it is not believed. */
var PROBE_MS = 3000;
/** Wakes closer together than this are one wake: an unlock fires several events. */
var SETTLE_MS = 500;

function listen(target, event, fn) {
  if (!target || typeof target.addEventListener !== "function") return function () {};
  target.addEventListener(event, fn);
  return function () {
    if (typeof target.removeEventListener === "function") target.removeEventListener(event, fn);
  };
}

function watchWake(deps) {
  var later = deps.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
  var cancel = deps.clearTimeout || function (timer) { clearTimeout(timer); };
  var now = deps.now || function () { return Date.now(); };
  var doc = deps.doc;
  var win = deps.win;
  var probe = null;
  var lastWake = -Infinity;
  var stopped = false;

  function answered() {
    if (probe) cancel(probe);
    probe = null;
  }
  deps.onSynced(answered);

  function wake() {
    if (stopped) return;
    var at = now();
    if (at - lastWake < SETTLE_MS) return;
    lastWake = at;
    if (!deps.connected()) {
      deps.reconnect();
      return;
    }
    if (probe) return;
    deps.sync();
    probe = later(function () {
      probe = null;
      if (!stopped) deps.reconnect();
    }, PROBE_MS);
    // Only Node has unref, and only a test runs this there.
    if (probe && typeof probe.unref === "function") probe.unref();
  }

  var offs = [
    listen(doc, "visibilitychange", function () {
      var visible = doc && typeof doc.visibilityState === "string" ? doc.visibilityState === "visible" : !(doc && doc.hidden);
      if (visible) wake();
    }),
    // Restored from the back-forward cache: the page is as it was, socket
    // and all, except that the socket is long gone. A plain load also fires
    // this, with persisted false, and is still connecting: left alone.
    listen(win, "pageshow", function (event) {
      if (event && event.persisted === true) wake();
    }),
    listen(win, "online", function () {
      wake();
    }),
  ];

  return {
    wake: wake,
    stop: function () {
      stopped = true;
      answered();
      offs.forEach(function (off) {
        off();
      });
    },
  };
}

module.exports = { watchWake: watchWake, PROBE_MS: PROBE_MS, SETTLE_MS: SETTLE_MS };
