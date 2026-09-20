/**
 * The standalone adapter: OSCAR's widgets running on a page of their own.
 *
 * The second implementation of the `ctx` contract in lib/widgets/index.js;
 * adapters/grapesjs.js is the first. That split is what makes a working
 * export possible at all: the widgets are plain DOM and know no editor, so an
 * exported page runs the very same button, fader and pad as the editor does,
 * through a different host, and any widget added to the registry runs here
 * without this file hearing about it.
 *
 * Where the GrapesJS adapter reads settings from a component model, this one
 * reads them from the element's data-oscar-config (lib/export/config.js).
 * The wire is the same one: `bridge` is what public/src/oscar_socket.js
 * builds for the editor and the preview -- sendOSC, sendDMX, onOscIn,
 * shareState, onSharedState -- so reconnecting, the snapshot a late device
 * starts from, and what is told again after the server restarts are one
 * piece of code on every page that shows a surface.
 *
 * No GrapesJS here, and no fetch: the page may have been opened by
 * double-clicking a file on a laptop that is not the one running OSCAR.
 */

var { readWidget, WIDGET_SELECTOR } = require("../../../lib/export/config");
var { readHost, readPort } = require("../../../lib/export/connection");

/**
 * Where OSCAR's bridge is: { host, port }, or { error }.
 *
 * Baked into the file when it was exported (window.OSCAR_EXPORT) and
 * overridable from the page's address, so a surface can follow OSCAR to
 * another machine without being exported again. There is no third source.
 * In particular not localhost:8081: a page that cannot tell where its OSCAR
 * is and guesses may find one -- somebody else's, driving another rig.
 * An override that cannot be read is refused rather than skipped for the
 * same reason: whoever typed it meant the page to go somewhere else.
 *
 * A page OSCAR serves itself (a published surface, /show/<name>) is told so
 * as it is served, and then OSCAR is wherever the page came from: the host in
 * its own address, and the bridge port it was handed. That outranks what was
 * baked in, which may name an address the computer no longer has. It is not
 * a guess, and so not a third source in the sense above: the page was handed
 * to this browser by the very OSCAR it is about to talk to.
 *
 * @param {object} baked window.OSCAR_EXPORT
 * @param {string} search window.location.search
 * @param {{ port: number, hostname: string }} [served] window.OSCAR_SERVED, with
 *        the hostname of the page's own address
 */
function resolveEndpoint(baked, search, served) {
  var params = new URLSearchParams(search || "");
  var source = baked && typeof baked === "object" ? baked : {};

  var host = readHost(source.host);
  var port = readPort(source.port);

  if (served && typeof served === "object") {
    var servedHost = readHost(served.hostname);
    var servedPort = readPort(served.port);
    // Both or neither: half of one address and half of another is nowhere.
    if (servedHost && servedPort !== null) {
      host = servedHost;
      port = servedPort;
    }
  }

  if (params.has("oscar-host")) {
    host = readHost(params.get("oscar-host"));
    if (!host) return { error: "The oscar-host in this page's address is not a name or an IP address." };
  }
  if (params.has("oscar-port")) {
    port = readPort(params.get("oscar-port"));
    if (port === null) return { error: "The oscar-port in this page's address is not a port number." };
  }

  if (!host || port === null) {
    return {
      error:
        "This file does not say where OSCAR is. Add ?oscar-host=ADDRESS&oscar-port=PORT " +
        "to the page's address, or export it again.",
    };
  }
  return { host: host, port: port };
}

function connected(bridge) {
  return !!(bridge && bridge.socket && bridge.socket.connected === true);
}

/**
 * The `ctx` one widget runs against.
 *
 * The two loop guards are the GrapesJS adapter's, for the same reasons:
 * `send` is shut while an incoming OSC message is being delivered, and both
 * `send` and `share` while another device's state is. A widget cannot lift
 * either.
 *
 * What this host adds is that nothing is said while the bridge is away.
 * socket.io queues what is emitted while disconnected and replays it on
 * reconnect: every position a fader passed through while the tablet was out
 * of Wi-Fi range, in one burst, minutes late, into a running show. A move
 * that never happened is the lesser evil, and the banner says the page is
 * offline while it is. Sharing is dropped with it: telling the other tablets
 * about a move the rig never got would have them agree on something untrue.
 *
 * Two limits, stated because a guarantee that overstates itself is worse
 * than none. The widget has still moved on screen: a dropped move leaves the
 * page showing a position the rig never got, and nothing can reconcile them
 * afterwards -- sending the page's position on reconnect is the stale replay
 * again, and the rig's position is not something OSCAR knows. So each drop
 * is reported through `onDropped`, and the page says so when the bridge
 * returns. And "away" means socket.io has noticed. A Wi-Fi link that goes
 * quiet without closing leaves `connected` true until the ping times out,
 * tens of seconds later; a move made in that window is written to a TCP
 * stream that delivers it late if the link comes back first. /preview has
 * the same exposure, and no check made in a browser closes it.
 *
 * @param {Element} el
 * @param {object} config this widget's settings, read off the element
 * @param {object} bridge what oscar_socket() built
 * @param {string|null} id the element's id: the widget's name on the wire
 * @param {Function} [onDropped] called for each message dropped because the
 *        bridge was away
 */
function contextFor(el, config, bridge, id, onDropped) {
  var delivering = 0;
  var adopting = 0;

  var ctx = {
    get: function (key) {
      return config[key];
    },

    // The widget's scratch space -- a fader remembering where its thumb is.
    // It lives as long as the page and is never written back to the markup:
    // the file is the configuration, and a surface comes up the same way
    // every time it is opened.
    set: function (key, value) {
      config[key] = value;
    },

    send: function (message) {
      if (delivering) {
        console.warn("OSCAR: a widget tried to answer incoming OSC with outgoing OSC; dropped", message);
        return;
      }
      if (adopting) {
        console.warn("OSCAR: a widget tried to answer another device's state by sending; dropped", message);
        return;
      }
      if (!message) return;
      if (!connected(bridge)) {
        if (typeof onDropped === "function") onDropped();
        return;
      }

      if (message.address && bridge.sendOSC) {
        bridge.sendOSC(message.ip, message.port, message.address, message.args);
      }
      if (message.dmx && bridge.sendDMX) {
        // The id names this widget's claim on its channels. It is the id the
        // widget has in the project, so the exported page takes over the
        // channels the editor's copy was driving instead of fighting it for
        // them. Without one there is no claim to make.
        if (id) bridge.sendDMX(Object.assign({ source: id }, message.dmx));
        else console.warn("OSCAR: a control with no id cannot drive DMX; dropped", el);
      }
    },

    setClass: function (name, on) {
      if (on) el.classList.add(name);
      else el.classList.remove(name);
    },

    // Nothing edits settings here: an exported page has no settings panel,
    // and set() is silent by contract. The widgets subscribe all the same,
    // and are owed an unsubscribe.
    onChange: function () {
      return function () {};
    },

    // No onRewrite: nothing on this page re-applies a stored copy of the
    // element, so nothing a widget wrote onto it is ever wiped. It is
    // optional in the contract and the widgets check for it.
  };

  if (bridge.onOscIn) {
    ctx.onOsc = function (fn) {
      return bridge.onOscIn(function (message) {
        delivering++;
        try {
          fn(message);
        } finally {
          delivering--;
        }
      });
    };
  }

  // Shared state is keyed by the widget's id, which the editor pins into the
  // project (pinId in adapters/grapesjs.js), so every copy of this file, and
  // a /preview page showing the same layout, agree on what a control shows.
  if (id && bridge.shareState) {
    ctx.share = function (state, how) {
      if (adopting) {
        console.warn("OSCAR: a widget tried to re-share the state it was handed; dropped", state);
        return;
      }
      if (!connected(bridge)) return;
      var heard = delivering > 0 || !!(how && how.heard === true);
      bridge.shareState(id, state, { heard: heard, release: how && how.release });
    };
  }

  if (id && bridge.onSharedState) {
    ctx.onShared = function (fn) {
      return bridge.onSharedState(id, function (state) {
        adopting++;
        try {
          fn(state);
        } finally {
          adopting--;
        }
      });
    };
  }

  return ctx;
}

/**
 * Leave a control visibly off, and say why where someone debugging will
 * look. It is never attached, so it cannot send: see readWidget for why it
 * does not get the defaults instead.
 */
function markInert(el, problem) {
  console.warn("OSCAR: a control is switched off because " + problem, el);
  if (typeof el.setAttribute === "function") {
    el.setAttribute("data-oscar-inert", problem);
    el.setAttribute("title", "Switched off: " + problem);
  }
  if (el.style) el.style.opacity = "0.35";
}

/**
 * Wire every widget under `root`.
 *
 * @param {Function} [onDropped] see contextFor
 * @returns {{ attached: number, inert: number, detach: Function }}
 */
function attachAll(root, bridge, onDropped) {
  var elements = root.querySelectorAll(WIDGET_SELECTOR);
  var detachers = [];
  var inert = 0;

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var widget = readWidget(el);
    if (!widget) continue;

    if (widget.problem) {
      inert++;
      markInert(el, widget.problem);
      continue;
    }

    var id = (typeof el.getAttribute === "function" && el.getAttribute("id")) || null;
    try {
      detachers.push(widget.definition.attach(el, contextFor(el, widget.config, bridge, id, onDropped)));
    } catch (err) {
      // One control that cannot start must not take the surface with it.
      inert++;
      markInert(el, "it failed to start (" + (err && err.message) + ")");
    }
  }

  return {
    attached: detachers.length,
    inert: inert,
    detach: function () {
      detachers.forEach(function (detach) {
        if (typeof detach === "function") detach();
      });
      detachers = [];
    },
  };
}

var BANNER_STYLE = [
  "position:fixed",
  "top:0",
  "left:0",
  "right:0",
  "z-index:2147483647",
  "margin:0",
  "padding:10px 14px",
  "font:14px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
  "color:#fff",
  "text-align:center",
  // A notice must never eat a press meant for the control underneath it.
  "pointer-events:none",
  "transition:opacity .3s",
].join(";");

var BANNER_COLOURS = { waiting: "#5f6368", offline: "#b3261e", online: "#1a7f37" };

/**
 * The one thing every report about a dead export needed someone to say.
 *
 * A page that looks right and sends nothing is indistinguishable from a
 * broken one, so it states which it is, for as long as the bridge does not
 * answer. Once it does the notice fades: this is used during a show, and
 * nothing may sit on top of a control. Styled inline so that no stylesheet,
 * the project's own included, can give it back its pointer events.
 *
 * `linger` is how long an "online" notice stays, for one that has more to
 * say than "connected"; it still never takes a press.
 *
 * @returns {(state: "waiting"|"offline"|"online", text: string, linger?: number) => void}
 */
function statusBanner(doc) {
  var el = doc.createElement("div");
  el.setAttribute("role", "status");
  el.setAttribute("data-oscar-status", "waiting");
  doc.body.appendChild(el);

  var hideTimer = null;

  return function show(state, text, linger) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    el.setAttribute("data-oscar-status", state);
    el.setAttribute("style", BANNER_STYLE + ";opacity:1;background:" + (BANNER_COLOURS[state] || BANNER_COLOURS.offline));
    el.textContent = text;

    if (state === "online") {
      hideTimer = setTimeout(function () {
        el.setAttribute("style", BANNER_STYLE + ";opacity:0;background:" + BANNER_COLOURS.online);
      }, linger || 2000);
      // Only Node has unref, and only a test runs this there: a notice
      // waiting to fade is no reason to keep a process alive.
      if (hideTimer && typeof hideTimer.unref === "function") hideTimer.unref();
    }
  };
}

/**
 * Start an exported page.
 *
 * Everything it needs is handed in, so a test can start one without a
 * browser: `connect(host, port)` returns the bridge (oscar_socket.js in the
 * real page).
 *
 * @param {{ document: Document, baked: object, search: string,
 *           connect: ((host: string, port: number) => object)|null }} env
 */
function start(env) {
  var doc = env.document;
  var show = statusBanner(doc);
  if (env.relay) return startOnRelay(env, show);
  var where = resolveEndpoint(env.baked, env.search, env.served);

  // With nowhere to send, nothing is attached: every control stays inert
  // rather than looking alive, and the banner stays up saying why.
  if (where.error) {
    show("offline", where.error);
    return { error: where.error };
  }
  if (typeof env.connect !== "function") {
    show("offline", "This file is missing its socket.io client, so it cannot reach OSCAR. Export it again.");
    return { error: "no socket.io client" };
  }

  var label = where.host + ":" + where.port;
  var bridge = env.connect(where.host, where.port);
  // Moves made since the bridge was last there, which it never got.
  var dropped = 0;
  var wired = attachAll(doc, bridge, function () {
    dropped++;
  });
  var off = wired.inert
    ? " " + wired.inert + " control(s) on this page are switched off: their settings could not be read."
    : "";

  var offline =
    "No connection to OSCAR at " + label + ". These controls send nothing until OSCAR is running " +
    "there and this device can reach it -- a browser cannot send OSC or DMX by itself." + off;

  show("waiting", "Connecting to OSCAR at " + label + "..." + off);

  bridge.socket.on("connect", function () {
    if (!dropped) {
      show("online", "Connected to OSCAR at " + label + "." + off);
      return;
    }
    // Said once, as the bridge returns, and for longer than "connected": the
    // fader on screen and the light it drives disagree, and the operator is
    // the only one who can know which is right.
    var count = dropped;
    dropped = 0;
    show(
      "online",
      "Connected to OSCAR at " + label + ". " + count + " move(s) made while it was unreachable were " +
        "not sent, so a control may show a position the rig never got. Move it again to send it." + off,
      10000
    );
  });
  bridge.socket.on("disconnect", function () {
    show("offline", offline);
  });
  bridge.socket.on("connect_error", function () {
    show("offline", offline);
  });

  return { bridge: bridge, wired: wired, endpoint: where };
}

/**
 * The same page, reached through a relay by a device that is not on OSCAR's
 * network. It says less than it does at home: there is no address to name,
 * and a visitor is not the person who can fix the installation.
 */
function startOnRelay(env, show) {
  var doc = env.document;
  if (typeof env.connectRelay !== "function") {
    show("offline", "This browser cannot hold the connection this page needs.");
    return { error: "no WebSocket" };
  }
  var bridge = env.connectRelay(env.relay.url);
  var wired = attachAll(doc, bridge, function () {});
  var away = "This installation is not reachable right now. The controls will work again when it is back.";

  show("waiting", "Connecting...");
  bridge.socket.on("connect", function () {
    show("online", "Connected.");
  });
  bridge.socket.on("disconnect", function () {
    show("offline", bridge.socket.full ? "A lot of people are playing with this right now. It will let you in as soon as there is room." : away);
  });
  bridge.socket.on("relay:full", function () {
    show("offline", "A lot of people are playing with this right now. It will let you in as soon as there is room.");
  });

  // How long a move takes to reach the installation and come back. Small and
  // out of the way: it is there for whoever set this up, measuring a venue.
  var readout = null;
  bridge.socket.on("relay:latency", function (ms) {
    if (!readout) {
      readout = doc.createElement("div");
      readout.setAttribute("data-oscar-latency", "");
      readout.setAttribute("aria-hidden", "true");
      readout.style.cssText =
        "position:fixed;right:6px;bottom:6px;z-index:2147483646;padding:2px 6px;border-radius:6px;" +
        "background:rgba(0,0,0,.45);color:#fff;font:10px/1.4 system-ui,sans-serif;pointer-events:none;opacity:.6";
      doc.body.appendChild(readout);
    }
    readout.textContent = ms + " ms";
  });

  return { bridge: bridge, wired: wired, relay: env.relay.url };
}

module.exports = {
  resolveEndpoint: resolveEndpoint,
  contextFor: contextFor,
  attachAll: attachAll,
  statusBanner: statusBanner,
  start: start,
};
