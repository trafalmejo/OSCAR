"use strict";

/**
 * Telemetry: anonymous counts of how OSCAR is used, so decisions about what
 * to build next are informed by something better than guessing.
 *
 * The whole contract is this file, on purpose, so anyone auditing the open
 * source can read in one screen everything OSCAR can ever say about them:
 *
 *   - EVENTS below is the complete list. An event not named there, or a
 *     property not named for it, is dropped before it exists. Values are
 *     primitives, strings capped short: no free text, no addresses, no
 *     project contents, ever.
 *   - Anonymous: one random id, minted once and kept in the settings file
 *     (delete it and you are somebody new). Events are sent with
 *     $process_person_profile false, so no person exists on the other end.
 *   - Off is off: the About window's switch (settings key "telemetry"),
 *     or OSCAR_NO_TELEMETRY=1 for a venue that scripts its machines, or a
 *     build without a key baked in -- any of the three, and tell() is a
 *     no-op.
 *   - Quiet: events queue and go as one batch, at most every FLUSH_MS and
 *     once at quit. A failure drops the batch silently -- a show's night
 *     never includes analytics retries, and an offline venue never sees a
 *     log line about it.
 *
 * The sender is a bare HTTPS POST to PostHog's batch endpoint: no SDK, so
 * there is nothing here that could autocapture, replay or grow an appetite.
 */

const crypto = require("node:crypto");

/** Everything OSCAR can say, and every word it can use to say it. */
const EVENTS = {
  app_start: ["version", "os", "arch"],
  template_loaded: ["template"],
  draft_loaded: ["template"],
  surface_published: ["widgets", "osc", "midi", "dmx"],
  mcp_tool_called: ["tool"],
};

/** The PostHog project this build reports to; empty = telemetry dormant. */
const KEY = "";
const HOST = "https://us.i.posthog.com";
const FLUSH_MS = 15 * 60 * 1000;
const QUEUE_CAP = 100;
const STRING_CAP = 60;

/**
 * @param {object} deps
 *   settings   lib/settings.js: get/set, holds the switch and the anonymous id
 *   key, host, flushMs, fetchFn, now, env   injectable for tests
 */
function createTelemetry(deps) {
  const settings = deps.settings;
  const key = deps.key !== undefined ? deps.key : KEY;
  const host = deps.host || HOST;
  const flushMs = deps.flushMs || FLUSH_MS;
  const doFetch = deps.fetchFn || fetch;
  const now = deps.now || (() => new Date());
  const env = deps.env || process.env;

  let queue = [];
  let timer = null;

  function enabled() {
    if (!key) return false;
    if (env.OSCAR_NO_TELEMETRY === "1") return false;
    return settings.get("telemetry") !== false;
  }

  /** The anonymous id, minted once. Deleting it from the settings file makes this OSCAR somebody new. */
  function who() {
    let id = settings.get("telemetryId");
    if (!id) {
      id = crypto.randomBytes(16).toString("hex");
      settings.set("telemetryId", id);
    }
    return id;
  }

  function flush() {
    timer = null;
    if (!queue.length || !enabled()) return;
    const batch = queue;
    queue = [];
    doFetch(host + "/batch/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, batch }),
    }).catch(() => {
      // Dropped, silently: telemetry never earns a retry loop or a log line.
    });
  }

  return {
    enabled,

    /** Whether this build can speak at all: a key baked in and no kill switch. The About window's switch is separate. */
    wired() {
      return !!key && env.OSCAR_NO_TELEMETRY !== "1";
    },

    /**
     * Say one thing, if it is on the list. Unknown events and properties
     * are dropped here, which is what makes EVENTS the whole truth.
     * @returns {boolean} whether the event was queued
     */
    tell(event, props) {
      if (!enabled()) return false;
      const allowed = EVENTS[event];
      if (!allowed) return false;
      const properties = { $lib: "oscar", $process_person_profile: false };
      for (const name of allowed) {
        const value = props ? props[name] : undefined;
        if (value === undefined || value === null) continue;
        if (typeof value === "number" || typeof value === "boolean") properties[name] = value;
        else properties[name] = String(value).slice(0, STRING_CAP);
      }
      queue.push({ event, distinct_id: who(), timestamp: now().toISOString(), properties });
      if (queue.length > QUEUE_CAP) queue.splice(0, queue.length - QUEUE_CAP);
      if (!timer) {
        timer = setTimeout(flush, flushMs);
        if (timer.unref) timer.unref();
      }
      return true;
    },

    /** One last batch, best effort, for quitting. */
    close() {
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}

module.exports = { createTelemetry, EVENTS, KEY, HOST };
