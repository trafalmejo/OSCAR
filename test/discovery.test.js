"use strict";

/**
 * OSCAR announcing itself (lib/discovery.js), with a stand-in for
 * bonjour-service that records what was published.
 */

const test = require("node:test");
const assert = require("node:assert");

const { createDiscovery, instanceName, SERVICE_TYPE } = require("../lib/discovery");

function fakeBonjour() {
  const made = [];
  function Bonjour() {
    const instance = {
      published: [],
      unpublished: false,
      destroyed: false,
      publish(options) {
        const handlers = {};
        const service = {
          options,
          on(event, fn) {
            handlers[event] = fn;
          },
          fail(err) {
            if (handlers.error) handlers.error(err);
          },
        };
        instance.published.push(service);
        return service;
      },
      unpublishAll(cb) {
        instance.unpublished = true;
        cb();
      },
      destroy() {
        instance.destroyed = true;
      },
    };
    made.push(instance);
    return instance;
  }
  return { Bonjour, made };
}

const quiet = { log() {}, error() {} };

test("OSCAR announces _oscar._tcp on its HTTP port, with the bridge port and version in the record", async () => {
  const { Bonjour, made } = fakeBonjour();
  const discovery = createDiscovery({ Bonjour, hostname: "studio-pc", httpPort: 18100, socketPort: 18101, version: "2.1.0", env: {}, log: quiet });
  assert.strictEqual(discovery.silent, "not started");
  assert.strictEqual(discovery.start(), true);
  assert.strictEqual(discovery.silent, null);
  assert.strictEqual(made.length, 1);
  assert.deepStrictEqual(made[0].published[0].options, {
    name: "OSCAR on studio-pc",
    type: SERVICE_TYPE,
    port: 18100,
    txt: { http: "18100", socket: "18101", v: "2.1.0" },
  });
  assert.strictEqual(discovery.start(), false, "once");

  await discovery.stop();
  assert.strictEqual(made[0].unpublished, true, "a goodbye, so phones drop it at once");
  assert.strictEqual(made[0].destroyed, true);
  await discovery.stop();
});

test("OSCAR_NO_DISCOVERY=1 and the feature switch keep it quiet", () => {
  const { Bonjour, made } = fakeBonjour();
  const off = createDiscovery({ Bonjour, hostname: "x", httpPort: 1, socketPort: 2, env: { OSCAR_NO_DISCOVERY: "1" }, log: quiet });
  assert.strictEqual(off.start(), false);
  assert.strictEqual(off.silent, "OSCAR_NO_DISCOVERY=1");
  const hidden = createDiscovery({ Bonjour, hostname: "x", httpPort: 1, socketPort: 2, env: {}, enabled: false, log: quiet });
  assert.strictEqual(hidden.start(), false);
  assert.strictEqual(hidden.silent, "switched off");
  assert.strictEqual(made.length, 0);
});

test("a network that refuses, or a library that throws, costs one line and nothing else", () => {
  const lines = [];
  const log = { log() {}, error: (line) => lines.push(line) };
  const { Bonjour, made } = fakeBonjour();
  const discovery = createDiscovery({ Bonjour, hostname: "x", httpPort: 1, socketPort: 2, env: {}, log });
  discovery.start();
  made[0].published[0].fail(new Error("EADDRINUSE"));
  assert.deepStrictEqual(lines, ["  Not announcing on the network: EADDRINUSE"]);

  const throwing = createDiscovery({
    Bonjour: function () {
      throw new Error("no multicast here");
    },
    hostname: "x",
    httpPort: 1,
    socketPort: 2,
    env: {},
    log,
  });
  assert.strictEqual(throwing.start(), false);
  assert.strictEqual(lines[1], "  Not announcing on the network: no multicast here");
  assert.strictEqual(throwing.silent, "not started");
  // And without the library at all (a test, or a build without it), nothing.
  assert.strictEqual(createDiscovery({ hostname: "x", httpPort: 1, socketPort: 2, env: {}, log }).start(), false);
});

test("the name a phone lists is the computer's, kept short and printable", () => {
  assert.strictEqual(instanceName("studio-pc"), "OSCAR on studio-pc");
  assert.strictEqual(instanceName("Studio-PC.local"), "OSCAR on Studio-PC");
  assert.strictEqual(instanceName(""), "OSCAR on this computer");
  assert.strictEqual(instanceName(undefined), "OSCAR on this computer");
  assert.strictEqual(instanceName("café\u0007"), "OSCAR on caf");
  assert.ok(instanceName("h".repeat(200)).length <= 63);
});
