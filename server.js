"use strict";

const path = require("path");
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
const { receiver: oscReceiver, listenOn, atMostOncePer } = require("./lib/osc-in");
const { portsFromEnv } = require("./lib/ports");
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

const PROJECTS_DIR =
  process.env.OSCAR_PROJECTS_DIR || path.join(__dirname, "projects");

let serverIP = lanAddress();

const app = express();
// The OSCAR version is recorded in every saved project, so a file can always
// say what wrote it.
const store = new ProjectStore(PROJECTS_DIR, { oscarVersion: pkg.version });

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
    onPreviewPush: () => io.emit("preview:updated"),
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
  listenOn(port, (message) => io.emit("osc:in", message));
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

const io = new Server(SOCKET_PORT, {
  // socket.io v3+ blocks cross-origin by default, and the page is served from
  // a different port than this socket, so it must be opted back in.
  cors: { origin: "*", methods: ["GET", "POST"] },
});

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
  onMessage: (message) => io.emit("osc:in", message),
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
  if (oscInLine) console.log(oscInLine);
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
  udpLan.close();
  udpLocal.close();
  oscIn.close();
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

module.exports = { app, httpServer, io };
