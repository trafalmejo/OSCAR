/**
 * A surface's connection to OSCAR through a relay, for a device that is not
 * on OSCAR's network: a visitor's phone on 4G.
 *
 * It is shaped like the socket.io socket the rest of the page already uses
 * (on, emit, connected), so oscar_socket.js and every widget work unchanged.
 * What differs is what it is willing to carry:
 *
 *   - "state:set" goes out as { t: "set", w: <widget id>, s: <state> }. That is
 *     the whole of what a stranger's phone can say: this control, this state.
 *     OSCAR looks the control up in the surface as it was published and does
 *     the sending itself (lib/surfaces.js), so a page that has been tampered
 *     with can aim at nothing the owner did not put on the surface.
 *   - "osc", "dmx" and "message" -- a destination chosen by the page -- are
 *     dropped here and would be ignored at the other end anyway.
 *   - A state the page only *heard* from the rig is not passed on: every
 *     device hears the rig itself.
 *
 * A finger on a fader fires sixty times a second. Only the latest state of
 * each control is kept and sent at most every FLUSH_MS, so the fader shows
 * where the finger is now rather than replaying where it was, and a phone
 * stays inside the relay's rate limit.
 *
 * "Connected" means OSCAR is at the other end, not merely the relay: a
 * control that lights up with nobody listening would be a lie.
 *
 * A visitor's pass (the relay's bot check, a cookie good for twelve hours)
 * is asked for when the socket opens. A page left open on a wall outlives
 * it; when its socket then drops and the relay refuses the next one, the
 * page asks the socket's address plainly: 403 means the pass has run out,
 * and the page reloads itself once to earn a new one (the check passes
 * unseen). Once only, remembered for the tab, so a device the check keeps
 * refusing is left on the check page's own words and never spins.
 *
 * @param {string} url wss://.../ws
 * @param {{ WebSocket?: Function, setTimeout?: Function, clearTimeout?: Function, now?: Function, fetch?: Function, reload?: Function, storage?: object }} [deps] for tests
 */
function relaySocket(url, deps) {
  var options = deps || {};
  var Socket = options.WebSocket || WebSocket;
  var later = options.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
  var cancel = options.clearTimeout || function (timer) { clearTimeout(timer); };
  var now = options.now || function () { return typeof performance !== "undefined" ? performance.now() : Date.now(); };
  var fetchFn = options.fetch || (typeof fetch === "function" ? fetch : null);
  var reload = options.reload || function () { if (typeof location !== "undefined") location.reload(); };
  var storage = options.storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  var RELOADED_KEY = "oscarRelayReloaded";

  var FLUSH_MS = 40;
  var ECHO_MS = 10000;
  var RETRY_MIN = 1000;
  var RETRY_MAX = 15000;

  var listeners = Object.create(null);
  var ws = null;
  var closed = false;
  var retry = RETRY_MIN;
  var retryTimer = null;
  var flushTimer = null;
  var echoTimer = null;
  // Latest state per widget waiting to go: id -> { s, r }. Order of first touch is kept.
  var pending = Object.create(null);
  var order = [];

  var socket = {
    connected: false,
    /** Set when the room is full, so the page can say so instead of retrying every second. */
    full: false,
    on: function (event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      return socket;
    },
    emit: function (event, payload) {
      if (event === "state:set") return queue(payload);
      if (event === "state:sync") return send({ t: "sync" });
      // "osc", "dmx", "dmx:stop", "message": not this device's to say.
      return socket;
    },
    close: function () {
      closed = true;
      stopTimers();
      if (ws) ws.close();
    },
  };

  function fire(event, payload) {
    (listeners[event] || []).slice().forEach(function (fn) {
      try {
        fn(payload);
      } catch (err) {
        if (typeof console !== "undefined") console.warn("OSCAR relay: a listener failed:", err && err.message);
      }
    });
  }

  function send(message) {
    if (!ws || ws.readyState !== 1) return socket;
    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      // The close that follows is what gets handled.
    }
    return socket;
  }

  function queue(payload) {
    if (!payload || typeof payload.id !== "string" || !payload.state || typeof payload.state !== "object") return socket;
    if (payload.heard) return socket;
    if (!pending[payload.id]) order.push(payload.id);
    pending[payload.id] = { s: payload.state, r: payload.release || null };
    if (!flushTimer) flushTimer = later(flush, FLUSH_MS);
    return socket;
  }

  function flush() {
    flushTimer = null;
    var ids = order;
    var batch = pending;
    order = [];
    pending = Object.create(null);
    if (!socket.connected) return; // Dropped, as a move made while OSCAR is unreachable always is.
    ids.forEach(function (id) {
      var message = { t: "set", w: id, s: batch[id].s };
      if (batch[id].r) message.r = batch[id].r;
      send(message);
    });
  }

  function setOnline(online) {
    if (online === socket.connected) return;
    socket.connected = online;
    fire(online ? "connect" : "disconnect");
    if (online) {
      send({ t: "sync" });
      measure();
    }
  }

  /** How long a move takes to reach OSCAR and come back, for the readout on the page. */
  function measure() {
    if (echoTimer) cancel(echoTimer);
    echoTimer = null;
    if (!socket.connected) return;
    if (typeof document === "undefined" || !document.hidden) send({ t: "echo", n: now() });
    echoTimer = later(measure, ECHO_MS);
  }

  function stopTimers() {
    [retryTimer, flushTimer, echoTimer].forEach(function (timer) {
      if (timer) cancel(timer);
    });
    retryTimer = flushTimer = echoTimer = null;
  }

  function connect() {
    if (closed) return;
    retryTimer = null;
    try {
      ws = new Socket(url);
    } catch (err) {
      return again();
    }
    var opened = false;
    ws.onopen = function () {
      opened = true;
      retry = RETRY_MIN;
      socket.full = false;
      // In again: a later expiry may need the one reload once more.
      try {
        if (storage) storage.removeItem(RELOADED_KEY);
      } catch (err) {
        /* a browser that keeps nothing */
      }
    };
    ws.onmessage = function (event) {
      var message;
      try {
        message = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      if (!message || typeof message !== "object") return;
      if (message.t === "host") setOnline(message.online === true);
      else if (message.t === "all") fire("state:all", message.states && typeof message.states === "object" ? message.states : {});
      else if (message.t === "state" && typeof message.w === "string") fire("state:changed", { id: message.w, state: message.s });
      else if (message.t === "osc" && typeof message.a === "string") fire("osc:in", { address: message.a, args: Array.isArray(message.v) ? message.v : [] });
      else if (message.t === "echo" && typeof message.n === "number") fire("relay:latency", Math.max(0, Math.round(now() - message.n)));
      else if (message.t === "full") {
        socket.full = true;
        fire("relay:full");
      }
    };
    ws.onclose = function () {
      ws = null;
      setOnline(false);
      // Refused before it opened: perhaps the pass. Ask, and meanwhile try again.
      if (!opened && !closed) askWhy();
      again();
    };
    ws.onerror = function () {
      fire("connect_error");
    };
  }

  var asking = false;
  /** A plain request to the socket's address: 403 says the pass has run out, and a reload earns a new one. */
  function askWhy() {
    if (asking || !fetchFn) return;
    var reloaded = false;
    try {
      reloaded = !!(storage && storage.getItem(RELOADED_KEY));
    } catch (err) {
      reloaded = true; // nothing to remember by: never risk a loop
    }
    if (reloaded) return;
    asking = true;
    var probe;
    try {
      probe = fetchFn(url.replace(/^ws/, "http"), { credentials: "same-origin", cache: "no-store" });
    } catch (err) {
      asking = false;
      return;
    }
    Promise.resolve(probe).then(
      function (res) {
        asking = false;
        if (closed || !res || res.status !== 403) return;
        try {
          storage.setItem(RELOADED_KEY, "1");
        } catch (err) {
          return; // cannot remember the reload: do not make it
        }
        reload();
      },
      function () {
        asking = false; // the relay itself is away: the retries handle that
      }
    );
  }

  function again() {
    if (closed || retryTimer) return;
    // A full room is asked again slowly; everything else backs off from a second to fifteen.
    var wait = socket.full ? RETRY_MAX : retry;
    retry = Math.min(RETRY_MAX, retry * 2);
    retryTimer = later(connect, wait + Math.floor(Math.random() * 400));
  }

  connect();
  return socket;
}

if (typeof module !== "undefined" && module.exports) module.exports = relaySocket;
