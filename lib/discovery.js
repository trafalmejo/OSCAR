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
 * `Bonjour` is handed in so a test can run this without touching a socket.
 */

const SERVICE_TYPE = "oscar";
const NAME_MAX = 63; // a DNS-SD instance name is at most 63 bytes

/** "OSCAR on studio-pc": the name a phone lists, short and only printable. */
function instanceName(hostname) {
  const host = String(hostname || "")
    .replace(/\.local$/i, "")
    .replace(/[^\x20-\x7e]/g, "")
    .trim();
  const name = "OSCAR on " + (host || "this computer");
  return name.length > NAME_MAX ? name.slice(0, NAME_MAX).trim() : name;
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
 */
function createDiscovery(deps) {
  const env = deps.env || {};
  const log = deps.log || console;
  const quiet = env.OSCAR_NO_DISCOVERY === "1" || deps.enabled === false;
  const name = instanceName(deps.hostname);
  let instance = null;
  let service = null;

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
      try {
        instance = new deps.Bonjour();
        service = instance.publish({
          name,
          type: SERVICE_TYPE,
          port: Number(deps.httpPort),
          txt: { http: String(deps.httpPort), socket: String(deps.socketPort), v: String(deps.version || "") },
        });
        if (service && typeof service.on === "function") {
          service.on("error", (err) => {
            // A network with no multicast, or a name already taken by another
            // OSCAR that is this one restarted: said once, and that is all.
            log.error("  Not announcing on the network: " + ((err && err.message) || err));
          });
        }
        return true;
      } catch (err) {
        log.error("  Not announcing on the network: " + ((err && err.message) || err));
        instance = null;
        service = null;
        return false;
      }
    },

    /**
     * Say goodbye, so phones drop this OSCAR from their lists at once rather
     * than when its record times out. Bounded: a quit never waits on it.
     */
    stop() {
      const had = instance;
      instance = null;
      service = null;
      if (!had) return Promise.resolve();
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
    },
  };
}

module.exports = { createDiscovery, instanceName, SERVICE_TYPE };
