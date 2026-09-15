"use strict";

const path = require("path");
const dgram = require("dgram");
const express = require("express");
const cors = require("cors");
const osc = require("osc");
const { Server } = require("socket.io");

const { lanAddress } = require("./lib/net");
const { ProjectStore } = require("./lib/projects");
const { createUpdateChecker, repoFromUrl } = require("./lib/updates");
const { CURRENT_FORMAT } = require("./lib/project-format");
const { Settings } = require("./lib/settings");
const { buildMessage, isPort } = require("./lib/osc-message");
const { parse: parseIncoming } = require("./lib/osc-in");
const { SharedState } = require("./lib/shared-state");
const { buildRequest, readSource, createDmxOutput } = require("./lib/dmx");
const createRouter = require("./routes/index");

const pkg = require("./package.json");

const HTTP_PORT = Number(process.env.OSCAR_HTTP_PORT) || 8080;
const SOCKET_PORT = Number(process.env.OSCAR_SOCKET_PORT) || 8081;
// Source ports OSCAR sends OSC from.
const LAN_PORT = Number(process.env.OSCAR_LAN_PORT) || 5001;
const LOCAL_PORT = Number(process.env.OSCAR_LOCAL_PORT) || 5002;
// Where OSCAR listens for OSC coming back. 9000 is what TouchOSC, Lemur and
// most of the software OSCAR drives offer first when asked where to send.
const OSC_IN_PORT = Number(process.env.OSCAR_OSC_IN_PORT) || 9000;
// Source port OSCAR sends Art-Net and sACN from. 0 takes whatever is free,
// which is what you want on a machine that may also be running node software
// listening on 6454; set OSCAR_DMX_PORT=6454 for a node that insists on it.
const DMX_PORT = Number(process.env.OSCAR_DMX_PORT) || 0;
// Quitting OSCAR releases the DMX channels it owns, so a rig is never left lit
// with nothing able to change it. A permanent installation that should hold its
// last look through a restart sets this instead.
const DMX_HOLD_ON_EXIT = process.env.OSCAR_DMX_HOLD_ON_EXIT === "1";

const PROJECTS_DIR =
  process.env.OSCAR_PROJECTS_DIR || path.join(__dirname, "projects");

let serverIP = lanAddress();

const app = express();
// The OSCAR version is recorded in every saved project, so a file can always
// say what wrote it.
const store = new ProjectStore(PROJECTS_DIR, { oscarVersion: pkg.version });

// What every device showing the surface agrees on, so two tablets do not each
// hold their own idea of whether a button is down.
const shared = new SharedState();

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

// What a bug report always needs: which OSCAR, on what, run how.
function diagnostics() {
  return {
    oscar: pkg.version,
    projectFormat: CURRENT_FORMAT,
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    electron: process.versions.electron || null,
  };
}

app.use(
  "/",
  createRouter({
    store,
    serverIP: () => serverIP,
    socketPort: () => SOCKET_PORT,
    updates,
    diagnostics,
    // `io` is created below; this only runs once a request arrives.
    onPreviewPush: () => {
      // A new layout makes the old state meaningless -- the widget ids may not
      // even exist in it -- and a stale position on a fresh surface is worse
      // than none at all.
      shared.clear();
      io.emit("state:all", {});
      io.emit("preview:updated");
    },
    lock,
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

for (const [label, port] of [["LAN", udpLan], ["local", udpLocal]]) {
  port.on("error", (err) => console.error("OSC " + label + " socket error:", err.message));
  port.open();
}

/**
 * @param {string} ip
 * @param {number|string} port
 * @param {string} address
 * @param {Array} args - one entry per value; an XY pad sends two, a colour three
 */
function sendOSC(ip, port, address, args) {
  const message = buildMessage(address, args);
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

// A plain UDP socket rather than one of the osc.UDPPort pairs above: Art-Net
// and sACN packets are raw bytes, and an OSC port would try to read what comes
// back as OSC.
const udpDmx = dgram.createSocket({ type: "udp4", reuseAddr: true });
udpDmx.on("error", (err) => console.error("DMX socket error:", err.message));
udpDmx.bind(DMX_PORT, () => {
  // Art-Net's default target is a broadcast address, and a UDP socket refuses
  // to send to one until it has been bound and told to allow it.
  try {
    udpDmx.setBroadcast(true);
  } catch (err) {
    console.error("Could not enable UDP broadcast, Art-Net may not reach its nodes:", err.message);
  }
});

const dmx = createDmxOutput(
  (packet, port, host) =>
    new Promise((resolve, reject) => {
      udpDmx.send(packet, port, host, (err) => (err ? reject(err) : resolve()));
    }),
  {
    sourceName: "OSCAR " + pkg.version,
    onError: (err) => console.error("DMX stream error:", err.message),
  }
);

/**
 * @param {object} input {protocol, host, universe, channel, levels, source}
 */
function sendDMX(input) {
  const request = buildRequest(input);
  if (!request) {
    console.error("Ignoring a malformed DMX request");
    return;
  }

  dmx
    .set(request.source, request)
    .catch((err) => console.error("Could not send DMX:", err.message));
}

const io = new Server(SOCKET_PORT, {
  // socket.io v3+ blocks cross-origin by default, and the page is served from
  // a different port than this socket, so it must be opted back in.
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ---- OSC coming back ------------------------------------------------------

// The other half of the bridge. A browser cannot hold a UDP socket any more
// than it can open one, so OSCAR receives on its behalf and relays what
// arrives; a widget with Listen on picks out the addresses it cares about.
const udpIn = new osc.UDPPort({
  localAddress: "0.0.0.0",
  localPort: OSC_IN_PORT,
  metadata: true,
});

// The startup banner and this socket become ready in whichever order they
// like, and the line belongs in the banner. Whichever happens second prints
// it, and it is only ever printed once the socket is genuinely bound -- a
// banner claiming to listen, printed above an error saying it does not, would
// be worse than saying nothing.
let oscInReady = false;
let bannerShown = false;

function announceOscIn() {
  if (oscInReady && bannerShown) console.log("  Listening for OSC on: UDP " + OSC_IN_PORT);
}

udpIn.on("ready", () => {
  oscInReady = true;
  announceOscIn();
});

udpIn.on("message", (packet) => {
  const message = parseIncoming(packet);
  // Anything that isn't a message OSCAR can act on is dropped here rather than
  // shipped to every browser for each of them to reject separately.
  if (!message) return;
  io.emit("osc:in", message);
});

udpIn.on("error", (err) => {
  // A busy port must not take OSCAR down with it: everything else -- the
  // editor, the tablets, sending -- works perfectly well without listening,
  // and a show that will not start is a worse failure than one that cannot
  // receive. Say so once, clearly, and carry on.
  if (err.code === "EADDRINUSE") {
    console.error("");
    console.error("  Nothing is listening for OSC: port " + OSC_IN_PORT + " is already in use.");
    console.error("  Sending still works. Set OSCAR_OSC_IN_PORT to a free port to receive.");
    console.error("");
    return;
  }
  console.error("OSC input socket error:", err.message);
});

udpIn.open();

io.on("connection", (socket) => {
  console.log("Editor connected (" + socket.id + ")");

  // A device arriving mid-show has to be told where everything already is,
  // or it draws a surface that disagrees with the one next to it until
  // somebody touches every control on it.
  socket.emit("state:all", shared.snapshot());

  // One widget's state, from whoever moved it.
  socket.on("state:set", (msg) => {
    if (!msg) return;
    const state = shared.apply(msg.id, msg.state);
    // Nothing changed: this was a device repeating back what it was told.
    // Stopping here is what keeps two tablets from trading the same value
    // between them for the rest of the evening.
    if (!state) return;
    // To everyone except the sender, which already has it.
    socket.broadcast.emit("state:changed", { id: msg.id, state });
  });

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

  // One widget's claim on a block of DMX channels:
  // { protocol, host, universe, channel, levels, source }.
  socket.on("dmx", (msg) => {
    try {
      sendDMX(msg);
    } catch (err) {
      console.error("Bad DMX request:", err.message);
    }
  });

  // Give a widget's channels back, or every channel when no source is named.
  socket.on("dmx:stop", (msg) => {
    try {
      const source = msg && msg.source !== undefined ? readSource(msg.source) : undefined;
      if (source === null) return;
      dmx.stop(source).catch((err) => console.error("Could not release DMX:", err.message));
    } catch (err) {
      console.error("Bad DMX release:", err.message);
    }
  });

  // Deliberately no DMX release here. A phone locking its screen or a wifi
  // blip would black out the rig, and holding the last look is the far safer
  // failure: the stream stays alive until a widget is deleted or OSCAR quits.
  socket.on("disconnect", () => console.log("Editor disconnected (" + socket.id + ")"));
});

const httpServer = app.listen(HTTP_PORT, () => {
  console.log("");
  console.log("  OSCAR is running.");
  console.log("");
  console.log("    On this computer:   http://localhost:" + HTTP_PORT);
  console.log("    On your network:    http://" + serverIP + ":" + HTTP_PORT);
  console.log("");
  console.log("  Projects folder:      " + PROJECTS_DIR);
  bannerShown = true;
  announceOscIn();
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

function shutdown() {
  console.log("\nShutting OSCAR down...");

  // Releasing is an instruction, not a dropped value: it is the one moment
  // OSCAR knows for certain that nobody is driving these channels any more.
  const released = DMX_HOLD_ON_EXIT
    ? Promise.resolve(dmx.close())
    : dmx.stop().catch((err) => console.error("Could not release DMX:", err.message));

  released.then(() => {
    // A socket that never bound -- the input port was busy -- throws on close,
    // and refusing to shut down over that would be an odd way to go.
    for (const port of [udpLan, udpLocal, udpIn, udpDmx]) {
      try {
        port.close();
      } catch (err) {
        /* it was never open */
      }
    }
    io.close();
    httpServer.close(() => process.exit(0));
  });

  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

module.exports = { app, httpServer, io };
