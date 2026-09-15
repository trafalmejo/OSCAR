"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { createUpdateChecker, compareVersions, repoFromUrl } = require("../lib/updates");

function release(tag, extra) {
  return Object.assign(
    {
      tag_name: tag,
      name: "OSCAR " + tag,
      html_url: "https://github.com/trafalmejo/OSCAR/releases/tag/" + tag,
      body: "notes",
      published_at: "2026-09-12T00:00:00Z",
    },
    extra
  );
}

/** A fetch stand-in that records calls and replies however the test wants. */
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (typeof reply === "function") return reply(url, opts);
    return reply;
  };
  fn.calls = calls;
  return fn;
}

const ok = (body) => ({ ok: true, json: async () => body });

test("compareVersions orders releases, prereleases below their release", () => {
  assert.strictEqual(compareVersions("2.1.0", "2.0.0"), 1);
  assert.strictEqual(compareVersions("2.0.0", "2.1.0"), -1);
  assert.strictEqual(compareVersions("2.0.0", "2.0.0"), 0);
  assert.strictEqual(compareVersions("v2.0.1", "2.0.0"), 1, "a leading v is ignored");
  assert.strictEqual(compareVersions("2.10.0", "2.9.0"), 1, "numeric, not lexical");
  assert.strictEqual(compareVersions("2.1.0-rc.1", "2.1.0"), -1);
  assert.strictEqual(compareVersions("2.1.0", "2.1.0-rc.1"), 1);
  assert.strictEqual(compareVersions("2.1.0-rc.2", "2.1.0-rc.1"), 1);
});

test("repoFromUrl reads owner/repo from package.json's url", () => {
  assert.strictEqual(repoFromUrl("https://github.com/trafalmejo/OSCAR"), "trafalmejo/OSCAR");
  assert.strictEqual(repoFromUrl("https://github.com/trafalmejo/OSCAR.git"), "trafalmejo/OSCAR");
  assert.strictEqual(repoFromUrl("git@github.com:trafalmejo/OSCAR.git"), "trafalmejo/OSCAR");
  assert.strictEqual(repoFromUrl("https://example.com/nope"), null);
});

test("reports an update when the release is newer", async () => {
  const checker = createUpdateChecker({
    currentVersion: "2.0.0",
    repo: "trafalmejo/OSCAR",
    fetchImpl: fakeFetch(ok(release("v2.1.0"))),
  });

  const result = await checker.check();
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.version, "2.1.0", "the v prefix is stripped");
  assert.strictEqual(result.current, "2.0.0");
  assert.match(result.url, /^https:\/\/github\.com\//);
});

test("says nothing when already current or ahead", async () => {
  for (const tag of ["v2.0.0", "v1.9.9"]) {
    const checker = createUpdateChecker({
      currentVersion: "2.0.0",
      repo: "trafalmejo/OSCAR",
      fetchImpl: fakeFetch(ok(release(tag))),
    });
    assert.deepStrictEqual(await checker.check(), { available: false }, tag);
  }
});

test("being offline is silent, never an error", async () => {
  const checker = createUpdateChecker({
    currentVersion: "2.0.0",
    repo: "trafalmejo/OSCAR",
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    },
  });
  assert.deepStrictEqual(await checker.check(), { available: false });
});

test("a rate limited or failing response is silent", async () => {
  const checker = createUpdateChecker({
    currentVersion: "2.0.0",
    repo: "trafalmejo/OSCAR",
    fetchImpl: fakeFetch({ ok: false, status: 403, json: async () => ({}) }),
  });
  assert.deepStrictEqual(await checker.check(), { available: false });
});

test("a slow endpoint is abandoned rather than delaying startup", async () => {
  let aborted = false;
  const checker = createUpdateChecker({
    currentVersion: "2.0.0",
    repo: "trafalmejo/OSCAR",
    timeoutMs: 20,
    fetchImpl: (url, opts) =>
      new Promise((resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      }),
  });

  assert.deepStrictEqual(await checker.check(), { available: false });
  assert.ok(aborted, "the request was aborted by the timeout");
});

test("OSCAR_NO_UPDATE_CHECK stops it reaching the network at all", async () => {
  const fetchImpl = fakeFetch(ok(release("v9.9.9")));
  const checker = createUpdateChecker({
    currentVersion: "2.0.0",
    repo: "trafalmejo/OSCAR",
    enabled: false,
    fetchImpl,
  });

  assert.deepStrictEqual(await checker.check(), { available: false });
  assert.strictEqual(fetchImpl.calls.length, 0, "no request was made");
});

test("the answer is cached, so launching does not hammer GitHub", async () => {
  const fetchImpl = fakeFetch(ok(release("v2.1.0")));
  let clock = 0;
  const checker = createUpdateChecker({
    currentVersion: "2.0.0",
    repo: "trafalmejo/OSCAR",
    fetchImpl,
    ttlMs: 1000,
    now: () => clock,
  });

  await checker.check();
  await checker.check();
  assert.strictEqual(fetchImpl.calls.length, 1, "second call served from cache");

  clock = 1001;
  await checker.check();
  assert.strictEqual(fetchImpl.calls.length, 2, "checked again once the cache expired");
});

test("concurrent checks collapse into one request", async () => {
  const fetchImpl = fakeFetch(
    () => new Promise((resolve) => setTimeout(() => resolve(ok(release("v2.1.0"))), 10))
  );
  const checker = createUpdateChecker({
    currentVersion: "2.0.0",
    repo: "trafalmejo/OSCAR",
    fetchImpl,
  });

  const results = await Promise.all([checker.check(), checker.check(), checker.check()]);
  assert.strictEqual(fetchImpl.calls.length, 1, "three tabs asking made one request");
  for (const r of results) assert.strictEqual(r.available, true);
});

test("identifies itself to GitHub, which rejects requests without a User-Agent", async () => {
  const fetchImpl = fakeFetch(ok(release("v2.1.0")));
  const checker = createUpdateChecker({
    currentVersion: "2.0.0",
    repo: "trafalmejo/OSCAR",
    fetchImpl,
  });

  await checker.check();
  const headers = fetchImpl.calls[0].opts.headers;
  assert.match(headers["User-Agent"], /^OSCAR\//);
  assert.match(fetchImpl.calls[0].url, /repos\/trafalmejo\/OSCAR\/releases\/latest$/);
});

test("very long release notes are trimmed before being sent on", async () => {
  const checker = createUpdateChecker({
    currentVersion: "2.0.0",
    repo: "trafalmejo/OSCAR",
    fetchImpl: fakeFetch(ok(release("v2.1.0", { body: "x".repeat(50000) }))),
  });

  const result = await checker.check();
  assert.ok(result.notes.length <= 2000, "notes were capped, got " + result.notes.length);
});

test("a garbled reply is treated as no update", async () => {
  for (const body of [{}, { tag_name: null }, { tag_name: "not-a-version" }]) {
    const checker = createUpdateChecker({
      currentVersion: "2.0.0",
      repo: "trafalmejo/OSCAR",
      fetchImpl: fakeFetch(ok(body)),
    });
    assert.deepStrictEqual(await checker.check(), { available: false }, JSON.stringify(body));
  }
});
