"use strict";

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;
const NOTES_LIMIT = 2000;

/**
 * Compare two versions. Returns 1 if a is newer, -1 if older, 0 if equal.
 * A prerelease sorts below the release it leads to: 2.1.0-rc.1 < 2.1.0.
 */
function compareVersions(a, b) {
  const left = SEMVER.exec(String(a || ""));
  const right = SEMVER.exec(String(b || ""));
  if (!left || !right) return 0;

  for (let i = 1; i <= 3; i++) {
    const diff = Number(left[i]) - Number(right[i]);
    if (diff) return diff > 0 ? 1 : -1;
  }

  const preA = left[4];
  const preB = right[4];
  if (!preA && !preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;

  const partsA = preA.split(".");
  const partsB = preB.split(".");
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const x = partsA[i];
    const y = partsB[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    if (x !== y) {
      if (numeric) return Number(x) > Number(y) ? 1 : -1;
      return x > y ? 1 : -1;
    }
  }
  return 0;
}

/** Owner/repo out of package.json's repository url. */
function repoFromUrl(url) {
  const match = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(String(url || ""));
  return match ? match[1] + "/" + match[2] : null;
}

/**
 * Asks GitHub whether a newer OSCAR has been released.
 *
 * This is the only thing OSCAR sends over the internet, so it is built to be
 * unobtrusive: one request per launch at most, a short timeout, cached
 * results, never throws, and switched off entirely by OSCAR_NO_UPDATE_CHECK.
 * Venues are regularly offline and a failed check must cost nothing.
 *
 * GitHub's "latest release" excludes drafts and prereleases, so an unfinished
 * release can never be announced to anyone.
 */
function createUpdateChecker(options) {
  const {
    currentVersion,
    repo,
    enabled = true,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    // A day between checks: OSCAR is usually launched per show, not left running.
    ttlMs = 24 * 60 * 60 * 1000,
    // Back off for a while after a failure rather than retrying every request.
    failureTtlMs = 30 * 60 * 1000,
    timeoutMs = 5000,
  } = options || {};

  const NO_UPDATE = { available: false };

  let cached = null;
  let cachedAt = 0;
  let inFlight = null;

  async function request() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchImpl(
        "https://api.github.com/repos/" + repo + "/releases/latest",
        {
          signal: controller.signal,
          headers: {
            Accept: "application/vnd.github+json",
            // GitHub rejects requests without one.
            "User-Agent": "OSCAR/" + currentVersion,
          },
        }
      );

      if (!res || !res.ok) return NO_UPDATE;

      const release = await res.json();
      const latest = release && release.tag_name;
      if (!latest) return NO_UPDATE;

      if (compareVersions(latest, currentVersion) <= 0) return NO_UPDATE;

      return {
        available: true,
        current: currentVersion,
        version: String(latest).replace(/^v/, ""),
        name: release.name || latest,
        url: release.html_url,
        // Release notes can run to many kilobytes; send enough for a
        // "what's new" summary and no more.
        notes: String(release.body || "").slice(0, NOTES_LIMIT),
        publishedAt: release.published_at || null,
      };
    } catch {
      // Offline, blocked, rate limited, slow: all the same to the caller.
      return NO_UPDATE;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async check() {
      if (!enabled || !repo || !currentVersion) return NO_UPDATE;

      const age = now() - cachedAt;
      const ttl = cached && cached.available ? ttlMs : failureTtlMs;
      if (cached && age < ttl) return cached;

      // Collapse concurrent calls (several browser tabs asking at once).
      if (!inFlight) {
        inFlight = request().then((result) => {
          cached = result;
          cachedAt = now();
          inFlight = null;
          return result;
        });
      }
      return inFlight;
    },
  };
}

module.exports = { createUpdateChecker, compareVersions, repoFromUrl };
