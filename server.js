"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const express = require("express");
const cors = require("cors");
const osc = require("osc");
const { Server } = require("socket.io");

const { lanAddress, isLoopbackAddress } = require("./lib/net");
const { ProjectStore } = require("./lib/projects");
const { PublishedStore } = require("./lib/published");
const { createUpdateChecker, repoFromUrl } = require("./lib/updates");
const { CURRENT_FORMAT } = require("./lib/project-format");
const { Settings } = require("./lib/settings");
const { buildMessage, isPort } = require("./lib/osc-message");
const { receiver: oscReceiver, listenOn, atMostOncePer, parse: parseOsc } = require("./lib/osc-in");
const { portsFromEnv } = require("./lib/ports");
const { createRemoteMidi } = require("./lib/midi/remote");
const features = require("./lib/features");
const { buildRequest: buildDmxRequest, readSource, createDmxOutput, openDmxSocket, createUsbDmx, isUsb } = require("./lib/dmx");
const { sharedSync } = require("./lib/shared-sync");
const { SerialLink, serialControl, isSerialTarget } = require("./lib/serial");
const { extensionIds, loadExtensions } = require("./lib/extensions");
const { createSurfaces } = require("./lib/surfaces");
const createRouter = require("./routes/index");

const pkg = require("./package.json");

// Every port in one object (lib/ports.js), so a feature that needs one --
// OSC in, DMX out -- reads ports.oscIn or ports.dmx rather than the
// environment. A bad value stops the server here, with the variable named.
const ports = portsFromEnv(process.env);
const HTTP_PORT = ports.http;
const SOCKET_PORT = ports.socket;
// Source ports OSCAR sends OSC from.
const LAN_PORT = ports.lan;
const LOCAL_PORT = ports.local;
// Where the rig sends OSC back to.
const OSC_IN_PORT = ports.oscIn;
// Source port Art-Net and sACN leave from; 0 is any free port.
const DMX_PORT = ports.dmx;
// Quitting OSCAR hands back the DMX channels it drives, so a rig is never left
// lit with nothing able to change it. A permanent installation that should
// hold its last look through a restart sets this.
const DMX_HOLD_ON_EXIT = process.env.OSCAR_DMX_HOLD_ON_EXIT === "1";

const PROJECTS_DIR =
  process.env.OSCAR_PROJECTS_DIR || path.join(__dirname, "projects");
// Where an assistant's drafts land (lib/mcp/tools.js create_surface): beside
// the projects, listed in the editor's Load window for a person to review.
const DRAFTS_DIR = path.join(PROJECTS_DIR, "assistant");

let serverIP = lanAddress();

const app = express();
// The OSCAR version is recorded in every saved project, so a file can always
// say what wrote it.
const store = new ProjectStore(PROJECTS_DIR, { oscarVersion: pkg.version });
// Beside the projects rather than inside the app: the packaged app's own
// folder is read-only, and a published surface should survive an update.
const published = new PublishedStore(path.join(PROJECTS_DIR, "published"));

// Locked mode is remembered across restarts, so an installation that reboots
// overnight comes back locked rather than open. OSCAR_LOCKED forces it on at
// startup for anyone scripting a kiosk.
const settings = new Settings(
  process.env.OSCAR_SETTINGS_FILE || path.join(path.dirname(PROJECTS_DIR), "oscar-settings.json")
);
if (process.env.OSCAR_LOCKED === "1") settings.set("locked", true);

const lock = {
  isLocked: () => !!settings.get("locked"),
  setLocked: (value) => settings.set("locked", value),
};

app.set("views", path.join(__dirname, "public"));
app.set("view engine", "ejs");

// The editor is opened both as http://localhost:8080 and http://<lan-ip>:8080,
// and phones/tablets on the LAN hit the second form, so keep CORS permissive
// on what is by design a local-network tool.
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb", extended: true }));

// Checking for a new release is the only request OSCAR makes to the internet.
// Set OSCAR_NO_UPDATE_CHECK=1 to switch it off; everything else still works.
const updates = createUpdateChecker({
  currentVersion: pkg.version,
  repo: repoFromUrl(pkg.repository && pkg.repository.url),
  enabled: process.env.OSCAR_NO_UPDATE_CHECK !== "1",
});

// Whatever has been added to this OSCAR (lib/extensions.js). Usually nothing.
// The folder is where whoever builds an installer puts what it should carry.
const extensions = loadExtensions(extensionIds(process.env, path.join(__dirname, "extensions")));
extensions.mount(app, express.static);

// What a bug report always needs: which OSCAR, on what, run how.
function diagnostics() {
  return {
    oscar: pkg.version,
    projectFormat: CURRENT_FORMAT,
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    electron: process.versions.electron || null,
    // "My Arduino does nothing" is unanswerable without knowing whether this
    // build can open a port at all, and whether it thinks it has one.
    serial: serial.status(),
    // The same question for MIDI: is there a driver, and what does it see.
    midi: midi.status(),
    // Behaviour nobody can reproduce is sometimes an extension's.
    extensions: extensions.list(),
  };
}

// ---- MIDI -------------------------------------------------------------------

// Up here for the reason the serial cable is: diagnostics() is handed to the
// router, and reads this.
// An OSC message from outside. For the published surfaces OSCAR works out what
// it does to each widget itself and says the state to every device, as it says
// a hand on a button (lib/surfaces.js): one reading, the same everywhere, a
// phone across the internet included. The raw message still goes to every
// page, for the editor's canvas and the widgets OSCAR cannot yet follow for.
// `surfaces` is made further down; nothing arrives before it is.
function heardOsc(message, source) {
  // Tagged at the door: the widgets' From (oscListenFrom) reads it wherever
  // the message is read -- here, on published pages, in the editor.
  const tagged = Object.assign({}, message, { source: source === "serial" ? "serial" : "network" });
  io.emit("osc:in", tagged);
  if (surfaces) surfaces.hearOsc(tagged).catch((err) => console.error("OSC in: " + reason(err)));
}

const MIDI_EVENTS = { open: "sending to", closed: "let go of", listening: "listening to", deaf: "stopped listening to" };
// Supervised, not in-process: RtMidi can abort in the native code -- waking
// from sleep with a stale Windows handle does it -- and an abort ends its
// process. In the worker that costs a moment of MIDI, reported below and
// restarted; in the server it cost the whole show (lib/midi/remote.js).
const midi = createRemoteMidi({
  onEvent: (event, name) => console.log("MIDI: " + (MIDI_EVENTS[event] || event) + " " + name),
  onError: (err) => console.error("MIDI: " + reason(err)),
});

function sendMIDI(input) {
  // False for a malformed request as well as for a port that is not there;
  // the second has already been said, once, by onError.
  return midi.send(input);
}

// ---- The serial cable ------------------------------------------------------

// Up here, ahead of the router that is handed it: a const cannot be read
// before its line has run. `io` and `bannerShown` are further down, and are
// only touched from callbacks that cannot fire before serial.restore().
//
// A board on a USB cable: a widget whose Ip is the word "serial" sends here
// (lib/serial-target.js). On a build with no serial driver this still exists
// and says so; nothing below has to ask whether it may be used.
let serialLine = null;

const serialLink = new SerialLink({
  onChange: (status) => {
    const before = serialLine;
    const where = status.path + " at " + status.bitrate + " baud";
    if (status.state === "open") serialLine = "  Serial: sending to " + where;
    else if (status.state === "waiting") serialLine = "  Serial: waiting for " + where + " (" + status.error + ")";
    else if (status.state === "idle") serialLine = "  Serial: disconnected";
    else return; // "opening" is over in a moment, one way or the other
    // A board that is not plugged in fails the same way every two seconds;
    // that is one piece of news, not one per attempt.
    if (bannerShown && serialLine !== before) console.log(serialLine);
  },
  // A board that talks back is a sensor, and reaches the widgets the same
  // way the network does: a meter with Listen on can show a potentiometer.
  onMessage: (packet) => {
    const message = parseOsc(packet);
    if (message) heardOsc(message, "serial");
  },
  // A sketch that also Serial.println()s down the same line produces one of
  // these per line it prints.
  onError: atMostOncePer(5000, (err, missed) => {
    console.error("Serial: " + reason(err) + (missed ? " (and " + missed + " more since the last note)" : ""));
  }),
});

const serial = serialControl({ link: serialLink, settings });

// Said once per outage rather than once per fader movement.
const reportSerialDrop = atMostOncePer(5000, (address, missed) => {
  const status = serial.status();
  const why = !status.supported
    ? status.reason
    : status.path
      ? "the port is not open" + (status.error ? " (" + status.error + ")" : "")
      : "no serial port is connected; pick one in the editor's Serial panel";
  console.error("Not sent to serial: " + address + (missed ? " and " + missed + " more" : "") + " -- " + why);
});

app.use(
  "/",
  createRouter({
    store,
    serverIP: () => serverIP,
    socketPort: () => SOCKET_PORT,
    midiPorts: () => midi.ports(),
    oscInPort: () => OSC_IN_PORT,
    updates,
    diagnostics,
    // `io` and `shared` are created below; this only runs once a request arrives.
    onPreviewPush: () => {
      // The widget ids in the old records may not exist in the new layout,
      // and a stale position on a fresh surface is worse than none at all.
      shared.reset();
      io.emit("preview:updated");
    },
    lock,
    serial,
    published,
    // Unpublishing has no store event of its own, so the route says it, and
    // every editor's LIVE pill recounts.
    onPublishedChanged: () => io.emit("published:changed"),
    // The pill's network log, backlog for a window that has just opened.
    // `liveLog` is created below; this only runs once a request arrives.
    liveLog: () => liveLog.slice(),
    draftsDir: DRAFTS_DIR,
    templatesDir: path.join(__dirname, "public", "templates"),
    extensions,
  })
);

// ---- OSC transport --------------------------------------------------------

// Two sockets: one bound to the LAN address for devices on the network, one
// bound to loopback for software running on this same machine.
const udpLan = new osc.UDPPort({
  localAddress: "0.0.0.0",
  localPort: LAN_PORT,
  metadata: true,
});

const udpLocal = new osc.UDPPort({
  localAddress: "127.0.0.1",
  localPort: LOCAL_PORT,
  metadata: true,
});

// Something that is not OSC arriving at a port is one error per packet, at
// packet rate; a line every few seconds with a count says the same thing
// without burying everything else in the log. The OSC-in receiver throttles
// its own calls to this; the send sockets are wrapped below.
function reportBadPacket(label) {
  return (err, missed) => {
    const more = missed ? " (and " + missed + " more since the last note)" : "";
    console.error("Ignoring what is not OSC on the " + label + " port: " + reason(err) + more);
  };
}

function reason(err) {
  return String((err && err.message) || err);
}

for (const [label, port] of [["LAN", udpLan], ["local", udpLocal]]) {
  const badPacket = atMostOncePer(5000, reportBadPacket(label));
  // osc.js reports a failed bind and an undecodable packet the same way; a
  // code means the socket itself, and is worth every line.
  port.on("error", (err) => {
    if (err && err.code) console.error("OSC " + label + " socket error:", reason(err));
    else badPacket(err);
  });
  port.open();
  // Software that answers to the port a request came from sends its reply
  // here, not to the OSC-in port; a widget following the rig hears both.
  listenOn(port, (message) => heardOsc(message));
}

/**
 * @param {string} ip
 * @param {number|string} port
 * @param {string} address
 * @param {Array} args - one entry per value; an XY pad sends two, a colour three
 */
function sendOSC(ip, port, address, args) {
  const message = buildMessage(address, args);

  // The cable has no ports, so the port is not looked at; the message is held
  // to exactly the same standard as one bound for the network.
  if (isSerialTarget(ip)) {
    if (!message) {
      console.error("Ignoring a malformed OSC message for", address);
      return;
    }
    if (serial.send(message)) console.log("Sending", address, JSON.stringify(message.args), "to serial");
    else reportSerialDrop(address);
    return;
  }

  if (!message || !isPort(port)) {
    console.error("Ignoring a malformed OSC message for", address);
    return;
  }

  const target = ip === "localhost" || ip === "127.0.0.1" ? udpLocal : udpLan;

  console.log("Sending", address, JSON.stringify(message.args), "to", ip + ":" + port);
  try {
    target.send(message, ip, Number(port));
  } catch (err) {
    console.error("Could not send OSC message:", err.message);
  }
}

// ---- DMX transport --------------------------------------------------------

// Unlike OSC, DMX is a stream the server keeps alive on the widgets' behalf
// (lib/dmx/output.js). Every request is checked here as strictly as an OSC
// message is; a request that fails is silence, never a guess.
let dmxLine = null;

const dmxSocket = openDmxSocket({
  port: DMX_PORT,
  onReady: (address) => {
    dmxLine = "  DMX out (Art-Net, sACN) from UDP " + address.port + "; USB interfaces on their serial port";
    if (bannerShown) console.log(dmxLine);
  },
  onError: (err) => {
    dmxLine =
      "  NOT sending DMX: UDP " + DMX_PORT + " " +
      (err && err.code === "EADDRINUSE" ? "is already in use" : "could not be opened (" + reason(err) + ")") +
      ".\n  OSC still works. Leave OSCAR_DMX_PORT unset to send from any free port.";
    if (bannerShown) console.log(dmxLine);
  },
});

// A USB interface (Enttec Pro, DMXKing, Open DMX) takes the frame on a serial
// port instead of the network; lib/dmx/usb.js. The output does not know which
// is which: it hands every frame here with where it is for.
const usbDmx = createUsbDmx({
  onError: atMostOncePer(5000, (err, path) => {
    console.error("USB DMX" + (path ? " on " + path : "") + ": " + reason(err));
  }),
  onStatus: (text) => console.log(text),
});

function sendDmxFrame(packet, port, host, target) {
  if (target && isUsb(target.protocol)) return usbDmx.send(target.protocol, host, packet);
  return dmxSocket.send(packet, port, host);
}

const dmx = createDmxOutput(sendDmxFrame, {
  sourceName: "OSCAR " + pkg.version,
  // A node that cannot be reached fails on every keepalive; one line every
  // few seconds with a count is the same news without burying the log.
  onError: atMostOncePer(5000, (err, missed) => {
    console.error("DMX could not be sent: " + reason(err) + (missed ? " (and " + missed + " more)" : ""));
  }),
  onStream: (event, stream) => {
    const where = isUsb(stream.protocol)
      ? stream.protocol + " on " + (stream.host || "the first USB interface")
      : stream.protocol + " universe " + stream.universe + " at " + stream.host + ":" + stream.port;
    console.log(event === "open" ? "DMX: driving " + where : "DMX: released " + where);
    // The zero frame has gone; the serial port can be let go of.
    if (event === "release" && isUsb(stream.protocol)) usbDmx.release(stream.protocol, stream.host).catch(() => {});
  },
});

function sendDMX(input) {
  const request = buildDmxRequest(input);
  if (!request) {
    console.error("Ignoring a malformed DMX request");
    return;
  }
  dmx.set(request.source, request);
}

const io = new Server(SOCKET_PORT, {
  // socket.io v3+ blocks cross-origin by default, and the page is served from
  // a different port than this socket, so it must be opted back in.
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// What every device showing the surface agrees each widget is doing, so the
// tablet next to the one that toggled a button draws it on too, and its next
// press sends the right edge (lib/shared-sync.js).
const shared = sharedSync(io);

// ---- OSC coming back ------------------------------------------------------

// The other half of the bridge. A browser cannot hold a UDP socket any more
// than it can open one, so OSCAR receives on its behalf and relays every
// message to every browser; a widget with Listen on picks out its own address.
//
// The socket and the startup banner become ready in whichever order they
// like, and the listening line belongs in the banner, below the addresses.
// So the line is held until both have happened, and it is only ever the
// truth: a banner claiming to listen above an error saying it does not would
// be worse than saying nothing.
let oscInLine = null;
let bannerShown = false;

function announceOscIn(line) {
  oscInLine = line;
  if (bannerShown) console.log(line);
}

const oscIn = oscReceiver({
  port: OSC_IN_PORT,
  UDPPort: osc.UDPPort,
  onMessage: (message) => heardOsc(message),
  onReady: () => announceOscIn("  Listening for OSC on:  UDP " + OSC_IN_PORT),
  onError: (err) => {
    // A port that cannot be opened must not take OSCAR down with it. The
    // editor, the tablets and sending all work without listening, and a show
    // that will not start is a worse failure than one that cannot receive.
    const why =
      err && err.code === "EADDRINUSE"
        ? "is already in use"
        : "could not be opened (" + ((err && err.code) || reason(err)) + ")";
    announceOscIn(
      "  NOT listening for OSC: UDP " + OSC_IN_PORT + " " + why + ".\n" +
        "  Sending still works. Set OSCAR_OSC_IN_PORT to a free port to receive."
    );
  },
  onBadPacket: reportBadPacket("OSC-in"),
});

// Back to the board chosen last time, so an installation that reboots
// overnight drives it again with nobody there. Down here rather than beside
// the link because a port that fails at once reports before this returns, and
// that report reads the banner state declared above.
// Only while serial is offered (lib/features.js): a remembered port opened by
// a hidden feature is a port silently stolen from whatever else needs it --
// an Open DMX interface on the same FTDI cable, say.
if (features.SERIAL) {
  const complaint = serial.restore();
  if (complaint) serialLine = "  Serial: NOT sending to the remembered port. " + complaint;
}

io.on("connection", (socket) => {
  console.log("Editor connected (" + socket.id + ")");

  // One message, any number of values: { ip, port, address, args }.
  socket.on("osc", (msg) => {
    try {
      if (!msg) return;
      sendOSC(msg.ip, msg.port, msg.address, msg.args);
    } catch (err) {
      console.error("Bad OSC message:", err.message);
    }
  });

  // The single-value form OSCAR sent before. Kept for anything written
  // against it, including custom code inside someone's project.
  socket.on("message", (clientIP, ip, port, address, type, value) => {
    try {
      sendOSC(ip, port, address, [{ type, value }]);
    } catch (err) {
      console.error("Bad OSC message:", err.message);
    }
  });

  // One widget's block of channels: { source, protocol, host, universe, channel, levels }.
  socket.on("dmx", (request) => {
    try {
      sendDMX(request);
    } catch (err) {
      console.error("Bad DMX request:", err.message);
    }
  });

  // One widget's MIDI: { port, messages }.
  socket.on("midi", (request) => {
    try {
      sendMIDI(request);
    } catch (err) {
      console.error("Bad MIDI request:", err.message);
    }
  });

  // The MIDI inputs this page's widgets listen on: parts of names, "*" for all, "" for the first.
  socket.on("midi:want", (parts) => {
    const list = Array.isArray(parts) ? parts.filter((part) => typeof part === "string" && part.length <= 200).slice(0, 64) : [];
    if (list.length) midiWanted.set(socket.id, list);
    else midiWanted.delete(socket.id);
    listenForMidi();
  });
  socket.on("disconnect", () => {
    if (midiWanted.delete(socket.id)) listenForMidi();
  });

  // Learn: the next thing anybody plays, for the editor to fill a widget's
  // MIDI settings from. It names the hardware, so it is for whoever may edit.
  socket.on("midi:learn", () => {
    if (lock.isLocked() && !isLoopbackAddress(socket.handshake.address)) {
      socket.emit("midi:learned", { error: "OSCAR is locked." });
      return;
    }
    if (!midi.supported) {
      socket.emit("midi:learned", { error: midi.status().reason || "This build of OSCAR cannot use MIDI." });
      return;
    }
    const stop = midi.learn((result) => {
      socket.off("disconnect", stop);
      socket.off("midi:learn:stop", stop);
      socket.emit(
        "midi:learned",
        result
          ? { port: result.port, type: result.heard.type, channel: result.heard.channel, number: result.heard.number }
          : { error: "Nothing was played." }
      );
    });
    socket.once("disconnect", stop);
    socket.once("midi:learn:stop", stop);
  });

  // A widget giving its channels up: deleted, or switched back to OSC. This
  // is the only thing that releases channels short of quitting. A browser
  // disconnecting deliberately does not, because a phone locking its screen
  // mid-show must not black the stage out.
  socket.on("dmx:stop", (msg) => {
    const source = readSource(msg && msg.source);
    if (source) dmx.stop(source);
  });

  socket.on("disconnect", () => console.log("Editor disconnected (" + socket.id + ")"));
});

// Acting on a published surface with no browser showing it (lib/surfaces.js):
// which widget and what state, never where to send.
//
// onActivity feeds the editor's LIVE pill: IN as the server consumes OSC or
// MIDI for a published surface, OUT as it sends on one's behalf. The lights
// are throttled so a fader at 60 Hz costs a flicker, not a socket message
// per move; the log coalesces repeats of the same event into one row with a
// count, flushed a few times a second, and keeps the latest rows for the
// window to read when it opens (GET /live/log).
const activityAt = { in: 0, out: 0 };
const LIVE_LOG_KEEP = 200;
const LIVE_LOG_FLUSH_MS = 300;
const liveLog = [];
let liveLogPending = new Map(); // key -> entry being coalesced
let liveLogTimer = null;

function flushLiveLog() {
  liveLogTimer = null;
  for (const entry of liveLogPending.values()) {
    liveLog.push(entry);
    io.emit("live:log", entry);
  }
  if (liveLog.length > LIVE_LOG_KEEP) liveLog.splice(0, liveLog.length - LIVE_LOG_KEEP);
  liveLogPending = new Map();
}

function tellActivity(event) {
  if (!event || !event.dir) return;
  const at = Date.now();
  if (at - activityAt[event.dir] >= 200) {
    activityAt[event.dir] = at;
    io.emit("live:activity", { dir: event.dir });
  }
  const key = event.dir + "|" + event.protocol + "|" + event.what + "|" + (event.surface || "");
  const held = liveLogPending.get(key);
  if (held) {
    held.n += event.n || 1;
    held.at = at;
  } else {
    liveLogPending.set(key, { at, dir: event.dir, protocol: event.protocol, what: event.what, surface: event.surface, n: event.n || 1 });
  }
  if (!liveLogTimer) liveLogTimer = setTimeout(flushLiveLog, LIVE_LOG_FLUSH_MS);
}
const surfaces = createSurfaces({ published, sendOSC, sendDMX, sendMIDI, shared, io, onActivity: tellActivity });

// The pill's count follows publishing without waiting for the editor's next
// poll. Unpublishing is told by the route that does it (onPublishedChanged).
surfaces.onPublished(() => io.emit("published:changed"));

// MIDI in. What arrives is handed to every page, as incoming OSC is, and the
// widgets that listen for it follow (lib/widgets/midi-in.js). A published
// widget whose Send when bridges data in is driven instead, as a hand would
// drive it, here, once (lib/surfaces.js hearMidi); the rest are recorded
// while anybody is watching the states, as OSC is (hearOsc).
midi.onMessage((heard, port, first) => {
  io.emit("midi:in", { heard, port, first });
  surfaces.hearMidi(heard, port, first).catch((err) => console.error("MIDI in: " + reason(err)));
});

// Only the inputs somebody wants are opened: on Windows an input belongs to
// whoever opened it first. Each page says which ones its widgets listen on
// ("midi:want", below); the published surfaces count too -- always for a
// widget that bridges, and while anybody watches for the rest -- asked
// after every few seconds so one published a moment ago is noticed.
const midiWanted = new Map(); // socket id -> parts of port names
let publishedWant = [];
function listenForMidi() {
  const parts = new Set(publishedWant);
  for (const wanted of midiWanted.values()) for (const part of wanted) parts.add(part);
  midi.listenFor(Array.from(parts));
}
if (midi.supported) {
  const askPublished = () =>
    surfaces
      .midiPorts()
      .then((parts) => {
        publishedWant = parts;
        listenForMidi();
      })
      .catch((err) => console.error("MIDI in: " + reason(err)));
  askPublished();
  setInterval(askPublished, 3000).unref();
}

// Last, so an extension finds everything it is handed already working.
extensions.start({
  version: pkg.version,
  app,
  io,
  settings,
  projectsDir: PROJECTS_DIR,
  lock,
  surfaces,
  features: extensions.features(),
  log: console,
});

// ---- MCP: OSCAR for AI assistants -------------------------------------------
// Levels one and two (lib/mcp/): read and diagnose, and build drafts for a
// person to review. Loopback only, a fresh bearer token each boot, and no
// tool that touches the wire. features.MCP off = the route does not exist.
let mcpToken = null;
if (features.MCP) {
  const { buildTools } = require("./lib/mcp/tools");
  const { attachMcp } = require("./lib/mcp/http");
  mcpToken = attachMcp(app, {
    version: pkg.version,
    tools: buildTools({
      version: pkg.version,
      features: extensions.features(),
      httpPort: () => HTTP_PORT,
      oscInPort: () => OSC_IN_PORT,
      socketPort: () => SOCKET_PORT,
      store,
      published,
      midi,
      liveLog: () => liveLog.slice(),
      lock,
      draftsDir: DRAFTS_DIR,
    }),
  });
}

const httpServer = app.listen(HTTP_PORT, () => {
  console.log("");
  console.log("  OSCAR is running.");
  console.log("");
  console.log("    On this computer:   http://localhost:" + HTTP_PORT);
  console.log("    On your network:    http://" + serverIP + ":" + HTTP_PORT);
  console.log("");
  console.log("  Projects folder:      " + PROJECTS_DIR);
  bannerShown = true;
  // The MCP handshake: where an assistant's shim finds this OSCAR. Written
  // once the port is certain, readable by this user alone, and gone stale
  // the moment OSCAR restarts (the token dies with the process).
  if (mcpToken) {
    const handshake = process.env.OSCAR_MCP_FILE || path.join(os.homedir(), ".oscar", "mcp.json");
    try {
      fs.mkdirSync(path.dirname(handshake), { recursive: true });
      fs.writeFileSync(handshake, JSON.stringify({ url: "http://127.0.0.1:" + HTTP_PORT + "/mcp", token: mcpToken, version: pkg.version }, null, 1) + "\n", { mode: 0o600 });
      console.log("  Assistants (MCP):     http://127.0.0.1:" + HTTP_PORT + "/mcp -- token in " + handshake);
    } catch (err) {
      console.error("Could not write the MCP handshake file: " + err.message);
    }
  }
  if (oscInLine) console.log(oscInLine);
  if (dmxLine) console.log(dmxLine);
  if (serialLine) console.log(serialLine);
  for (const extension of extensions.list()) {
    console.log("  Extension:            " + extension.name + (extension.version ? " " + extension.version : ""));
  }
  if (lock.isLocked()) {
    console.log("");
    console.log("  LOCKED: other devices can use the controls but not edit.");
  }
  console.log("");

  // When Electron forks this file it waits for this before opening a window.
  if (process.send) {
    process.send({ type: "ready", port: HTTP_PORT, address: serverIP });
  }

  if (process.env.OSCAR_NO_OPEN !== "1") {
    // Loaded lazily so `require`-ing this file for tests has no side effects.
    require("open")("http://localhost:" + HTTP_PORT).catch(() => {});
  }
});

httpServer.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("Port " + HTTP_PORT + " is already in use. Is OSCAR already running?");
    process.exit(1);
  }
  throw err;
});

let shuttingDown = false;

function shutdown() {
  // The app's request and its fallback signal can both arrive.
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nShutting OSCAR down...");
  udpLan.close();
  udpLocal.close();
  oscIn.close();
  // Let go of the port without forgetting it: the next start reopens it.
  serial.close();
  // An open MIDI port left behind can keep the instrument from anyone else.
  midi.close();
  io.close();
  // The channels are handed back before the socket goes, so the zero frames
  // and sACN's terminated packets actually leave; the fallback exit below
  // bounds how long an unreachable node can hold that up.
  const released = (DMX_HOLD_ON_EXIT ? Promise.resolve(dmx.close()) : dmx.stopAll()).then(() => usbDmx.close());
  released.then(() => dmxSocket.close());
  // Extensions get the same bounded wait the rig does.
  const letGo = Promise.all([released, extensions.stop()]);
  httpServer.close(() => letGo.then(() => process.exit(0)));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// The packaged app forks this file with an IPC channel and cannot deliver a
// signal on Windows (its kill() is TerminateProcess, which runs nothing
// here), so it asks over the channel instead. The channel closing without a
// request means the app is gone; shutting down then releases the rig as a
// quit would and leaves no orphaned server holding the ports.
if (process.send) {
  process.on("message", (msg) => {
    if (msg && msg.type === "shutdown") shutdown();
  });
  process.on("disconnect", shutdown);
}

module.exports = { app, httpServer, io };
