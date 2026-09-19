"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { readHost, readPort, readConnection } = require("../../lib/export/connection");

test("a port is a whole number from 1 to 65535, typed or not", () => {
  assert.strictEqual(readPort(8081), 8081);
  assert.strictEqual(readPort("8081"), 8081);
  assert.strictEqual(readPort(" 18271 "), 18271);
  // Number() makes 0 of the first three, and 0 reaches nothing.
  for (const bad of ["", "  ", null, undefined, 0, "0", 65536, "-1", "80.5", "8081x", "1e3", NaN, {}, []]) {
    assert.strictEqual(readPort(bad), null, JSON.stringify(bad));
  }
});

test("a host is a name or an address and nothing that could escape where it is written", () => {
  for (const good of ["localhost", "192.168.0.5", "oscar.local", "stage-pc", "[::1]", "[fe80::1]"]) {
    assert.strictEqual(readHost(good), good);
  }
  assert.strictEqual(readHost("  192.168.0.5 "), "192.168.0.5");
  for (const bad of ["", " ", null, 5, "http://x", "a:8081", "a/b", "a b", "x-->", '"><script>', "a'b", "-x", "x-", "::1"]) {
    assert.strictEqual(readHost(bad), null, JSON.stringify(bad));
  }
});

test("the dialog's connection is checked whole, and each refusal says what to fix", () => {
  assert.deepStrictEqual(readConnection({ host: "192.168.0.5", port: "8081" }), { host: "192.168.0.5", port: 8081 });
  assert.match(readConnection(null).error, /where OSCAR/);
  assert.match(readConnection({ host: " ", port: 1 }).error, /where OSCAR/);
  assert.match(readConnection({ host: "http://x", port: 1 }).error, /not an address/);
  assert.match(readConnection({ host: "x", port: "" }).error, /port/);
});
