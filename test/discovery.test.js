"use strict";

/**
 * OSCAR announcing itself (lib/discovery.js), with a stand-in for
 * bonjour-service that records what was published.
 */

const test = require("node:test");
const assert = require("node:assert");

const { createDiscovery, instanceName, addressesOf, SERVICE_TYPE } = require("../lib/discovery");

function fakeBonjour() {
  const made = [];
  function Bonjour(options, onError) {
    const instance = {
      options, // what the responder was opened with: the interface to announce on, and the bind address
      onError, // where bonjour-service sends its socket's errors; without one it rethrows them
      published: [],
      unpublished: false,
      destroyed: false,
      server: { mdns: { said: [], respond(records, cb) { this.said.push(records); if (cb) cb(); } } },
      publish(options) {
        const handlers = {};
        const service = {
          options,
          records() {
            return [{ type: "PTR", name: "_oscar._tcp.local" }];
          },
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

test("a failed multicast send is a line in the log, not the end of the server", () => {
  // bonjour-service hands its socket's errors to a callback given at
  // construction, and rethrows them when there is none: an EHOSTUNREACH on
  // one announcement took a whole OSCAR down on 2026-10-28.
  const lines = [];
  const log = { log() {}, error: (line) => lines.push(line) };
  const { Bonjour, made } = fakeBonjour();
  const discovery = createDiscovery({ Bonjour, hostname: "x", httpPort: 1, socketPort: 2, env: {}, log });
  assert.strictEqual(discovery.start(), true);
  assert.strictEqual(typeof made[0].onError, "function", "the library is given somewhere to send socket errors");
  made[0].onError(new Error("send EHOSTUNREACH 224.0.0.251:5353"));
  assert.deepStrictEqual(lines, ["  Not announcing on the network: send EHOSTUNREACH 224.0.0.251:5353"]);
  assert.strictEqual(discovery.silent, null, "still announcing: the next beat may well get through");
});

test("the responder is opened on OSCAR's own interface, bound to every address, and on none while there is no network", () => {
  // Left to itself the library announces on "0.0.0.0", which is whatever
  // interface the system likes best: on Windows a VPN's unplugged tunnel
  // adapter at metric 1 took every announcement on 2026-10-28.
  const { Bonjour, made } = fakeBonjour();
  const discovery = createDiscovery({ Bonjour, hostname: "x", httpPort: 1, socketPort: 2, env: {}, log: quiet, address: () => "192.168.2.66" });
  assert.strictEqual(discovery.start(), true);
  assert.deepStrictEqual(made[0].options, { interface: "192.168.2.66", bind: "0.0.0.0" });

  const alone = fakeBonjour();
  createDiscovery({ Bonjour: alone.Bonjour, hostname: "x", httpPort: 1, socketPort: 2, env: {}, log: quiet, address: () => "127.0.0.1" }).start();
  assert.strictEqual(alone.made[0].options, undefined, "no network yet: the library's own choice, until an address comes");
});

test("the announcement is made again when the computer's address changes, and every so often regardless", async () => {
  const { Bonjour, made } = fakeBonjour();
  const lines = [];
  let nets = { "Wi-Fi": [{ address: "192.168.2.11", family: "IPv4", internal: false }, { address: "fe80::1", family: "IPv6", internal: false }], lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }] };
  const discovery = createDiscovery({ Bonjour, hostname: "x", httpPort: 1, socketPort: 2, env: {}, log: { log: (l) => lines.push(l), error() {} }, networkInterfaces: () => nets, address: () => nets["Wi-Fi"][0].address, watchMs: 15, refreshMs: 10000 });
  assert.strictEqual(discovery.start(), true);
  assert.strictEqual(made[0].options.interface, "192.168.2.11");
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(made.length, 1, "nothing changed: the same responder");
  assert.ok(made[0].server.mdns.said.length >= 2, "the records said again on the beat, unasked: " + made[0].server.mdns.said.length);
  assert.deepStrictEqual(made[0].server.mdns.said[0], [{ type: "PTR", name: "_oscar._tcp.local" }]);
  // The DHCP lease moves the computer.
  nets = { "Wi-Fi": [{ address: "192.168.2.66", family: "IPv4", internal: false }] };
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(made.length, 2, "a fresh responder for the new address");
  assert.strictEqual(made[1].options.interface, "192.168.2.66", "opened on the new address");
  assert.strictEqual(made[0].destroyed, true, "the old one gone");
  assert.strictEqual(made[0].unpublished, false, "no goodbye: the service is still here");
  assert.deepStrictEqual(lines, ["  Announcing on the network again: the computer's address changed."]);
  assert.strictEqual(discovery.silent, null);
  await discovery.stop();
  assert.strictEqual(made[1].unpublished, true, "the goodbye comes at the end");

  // And, with nothing changing, again after a while anyway.
  const again = fakeBonjour();
  const steady = createDiscovery({ Bonjour: again.Bonjour, hostname: "x", httpPort: 1, socketPort: 2, env: {}, log: quiet, networkInterfaces: () => nets, watchMs: 15, refreshMs: 30 });
  steady.start();
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(again.made.length >= 2, "announced again by time: " + again.made.length);
  await steady.stop();

  assert.strictEqual(addressesOf(() => nets), "192.168.2.66");
  assert.strictEqual(addressesOf(() => { throw new Error("no"); }), "");
});

test("the name a phone lists is the computer's, kept short and printable", () => {
  assert.strictEqual(instanceName("studio-pc"), "OSCAR on studio-pc");
  assert.strictEqual(instanceName("Studio-PC.local"), "OSCAR on Studio-PC");
  assert.strictEqual(instanceName(""), "OSCAR on this computer");
  assert.strictEqual(instanceName(undefined), "OSCAR on this computer");
  assert.strictEqual(instanceName("café\u0007"), "OSCAR on caf");
  assert.ok(instanceName("h".repeat(200)).length <= 63);
});
