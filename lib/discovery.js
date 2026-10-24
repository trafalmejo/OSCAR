"use strict";

/**
 * OSCAR announcing itself on the local network, so a phone can find it
 * without an address being typed.
 *
 * A DNS-SD service, `_oscar._tcp`, the way printers and Chromecasts are
 * found: the HTTP port is the service's port, and the TXT record carries
 * what a device needs to go further -- the bridge port, so it need not ask,
 * and the version. The instance name is the computer's, so a room with two
 * OSCARs lists two names and not two addresses.
 *
 * It only says "I am here". Nothing is listened for and nothing is sent
 * on anyone's behalf; the web pages were open to the network already, and
 * this makes them findable, not more reachable. OSCAR_NO_DISCOVERY=1 keeps
 * it quiet, for a venue that would rather nothing announced itself, and a
 * network that drops multicast (some venue Wi-Fi does, by policy) costs one
 * line in the console and nothing else: a show never waits on this.
 *
 * The records are announced on a beat, unasked, every few seconds. On a
 * computer where the mDNS port is shared with Apple's Bonjour, Chrome,
 * TeamViewer and Windows itself (a Windows machine, in short), this
 * process is never handed the phones' questions and so never answers them:
 * a phone heard OSCAR only in the moments it announced itself, which the
 * library does at start and then ever more rarely. A few hundred bytes
 * every fifteen seconds is what a printer does, and it keeps a phone that
 * opens its app an hour into the show finding OSCAR within a breath.
 *
 * The responder is also opened afresh whenever the computer's addresses
 * change, and every so often regardless. The socket belongs to the addresses
 * it was opened with: when a DHCP lease moved this computer from one address
 * to another mid-session, OSCAR kept running and stopped being findable,
 * silently, until it was restarted. And on Windows, where several programs
 * share the mDNS port, only the socket opened last is handed what arrives:
 * a phone heard OSCAR's beat ("added") but its question for the port and
 * address went to whichever program had bound the port most recently, and
 * the name never resolved. A fresh socket every twenty seconds keeps OSCAR
 * the one that answers, most of the time; the beat covers the rest.
 *
 * `Bonjour` is handed in so a test can run this without touching a socket;
 * so are the clock and the list of interfaces.
 */

const os = require("os");

const SERVICE_TYPE = "oscar";
const NAME_MAX = 63; // a DNS-SD instance name is at most 63 bytes
const WATCH_MS = 15 * 1000; // how often the records are announced and the computer's addresses looked at
// How long a responder is kept before a fresh one is opened anyway. Short
// on Windows, where the newest socket on the port is the one that hears.
const REFRESH_MS = process.platform === "win32" ? 20 * 1000 : 10 * 60 * 1000;

/** "OSCAR on studio-pc": the name a phone lists, short and only printable. */
function instanceName(hostname) {
  const host = String(hostname || "")
    .replace(/\.local$/i, "")
    .replace(/[^\x20-\x7e]/g, "")
    .trim();
  const name = "OSCAR on " + (host || "this computer");
  return name.length > NAME_MAX ? name.slice(0, NAME_MAX).trim() : name;
}

/** The computer's addresses on the network, as one sorted line, for telling a change. */
function addressesOf(networkInterfaces) {
  let all;
  try {
    all = networkInterfaces();
  } catch (err) {
    return "";
  }
  const found = [];
  for (const name of Object.keys(all || {})) {
    for (const entry of all[name] || []) {
      if (!entry || entry.internal) continue;
      const family = entry.family === 4 || entry.family === "IPv4" ? "4" : entry.family === 6 || entry.family === "IPv6" ? "6" : "";
      if (family === "4" || (family === "6" && !/^fe80/i.test(entry.address))) found.push(entry.address);
    }
  }
  return found.sort().join(" ");
}

/**
 * @param {object} deps
 * @param {Function} deps.Bonjour the `Bonjour` class of bonjour-service, or a stand-in
 * @param {string} deps.hostname os.hostname()
 * @param {number} deps.httpPort
 * @param {number} deps.socketPort
 * @param {string} deps.version
 * @param {object} [deps.env] process.env
 * @param {boolean} [deps.enabled] the feature switch (lib/features.js)
 * @param {{ log(line), error(line) }} [deps.log]
 * @param {Function} [deps.networkInterfaces] os.networkInterfaces, or a stand-in
 * @param {number} [deps.watchMs] how often the records are announced and the addresses looked at
 * @param {number} [deps.refreshMs] how long before announcing again regardless
 */
function createDiscovery(deps) {
  const env = deps.env || {};
  const log = deps.log || console;
  const quiet = env.OSCAR_NO_DISCOVERY === "1" || deps.enabled === false;
  const name = instanceName(deps.hostname);
  const networkInterfaces = typeof deps.networkInterfaces === "function" ? deps.networkInterfaces : os.networkInterfaces;
  const watchMs = deps.watchMs || WATCH_MS;
  const refreshMs = deps.refreshMs || REFRESH_MS;
  let instance = null;
  let service = null;
  let watcher = null;
  let addresses = "";
  let announcedAt = 0;
  let complained = false;

  function complain(err) {
    // A network with no multicast, or a name already taken by another OSCAR
    // that is this one restarted: said once, and that is all.
    if (complained) return;
    complained = true;
    log.error("  Not announcing on the network: " + ((err && err.message) || err));
  }

  /** Open a responder and publish. True when it took. */
  function publish() {
    try {
      instance = new deps.Bonjour();
      service = instance.publish({
        name,
        type: SERVICE_TYPE,
        port: Number(deps.httpPort),
        txt: { http: String(deps.httpPort), socket: String(deps.socketPort), v: String(deps.version || "") },
      });
      if (service && typeof service.on === "function") service.on("error", complain);
      announcedAt = Date.now();
      return true;
    } catch (err) {
      complain(err);
      instance = null;
      service = null;
      return false;
    }
  }

  /** Let the responder go, with a goodbye where it can be said. Bounded: nothing waits long on it. */
  function letGo(had) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 1000);
      if (timer.unref) timer.unref();
      try {
        had.unpublishAll(() => {
          try {
            had.destroy();
          } catch (err) {
            /* already gone */
          }
          clearTimeout(timer);
          resolve();
        });
      } catch (err) {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  /** A new responder in place of the old: the old one goes quietly (no goodbye: the service is still here). */
  function announceAgain(why, said) {
    const had = instance;
    instance = null;
    service = null;
    if (had) {
      try {
        had.destroy();
      } catch (err) {
        /* already gone */
      }
    }
    if (publish() && said !== false) log.log("  Announcing on the network again: " + why + ".");
  }

  /** The records, said once more without being asked. True when the library let us. */
  function announce() {
    try {
      const mdns = instance && instance.server && instance.server.mdns;
      if (!service || typeof service.records !== "function" || !mdns || typeof mdns.respond !== "function") return false;
      mdns.respond(service.records(), function () {});
      return true;
    } catch (err) {
      return false;
    }
  }

  function look() {
    if (!instance) return;
    const now = addressesOf(networkInterfaces);
    if (now !== addresses) {
      addresses = now;
      announceAgain("the computer's address changed");
    } else if (Date.now() - announcedAt >= refreshMs) {
      announceAgain("time", false); // routine: not worth a line each time
    } else {
      announce();
    }
  }

  return {
    name,
    type: SERVICE_TYPE,
    /** Why it is not announcing, or null while it is. */
    get silent() {
      if (quiet) return env.OSCAR_NO_DISCOVERY === "1" ? "OSCAR_NO_DISCOVERY=1" : "switched off";
      return service ? null : "not started";
    },

    start() {
      if (quiet || service || typeof deps.Bonjour !== "function") return false;
      addresses = addressesOf(networkInterfaces);
      if (!publish()) return false;
      watcher = setInterval(look, watchMs);
      if (watcher.unref) watcher.unref();
      return true;
    },

    /**
     * Say goodbye, so phones drop this OSCAR from their lists at once rather
     * than when its record times out. Bounded: a quit never waits on it.
     */
    stop() {
      if (watcher) clearInterval(watcher);
      watcher = null;
      const had = instance;
      instance = null;
      service = null;
      if (!had) return Promise.resolve();
      return letGo(had);
    },
  };
}

module.exports = { createDiscovery, instanceName, addressesOf, SERVICE_TYPE, WATCH_MS, REFRESH_MS };
