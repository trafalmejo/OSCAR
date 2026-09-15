"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { portsFromEnv, DEFAULTS, VARIABLES } = require("../lib/ports");

test("with nothing set, every port is its default", () => {
  assert.deepStrictEqual(portsFromEnv({}), DEFAULTS);
});

test("each port can be moved on its own", () => {
  const ports = portsFromEnv({ OSCAR_HTTP_PORT: "18100", OSCAR_OSC_IN_PORT: "18102" });
  assert.strictEqual(ports.http, 18100);
  assert.strictEqual(ports.oscIn, 18102);
  assert.strictEqual(ports.socket, DEFAULTS.socket);
});

test("every port has a variable, so nothing can only be moved by editing code", () => {
  assert.deepStrictEqual(Object.keys(VARIABLES).sort(), Object.keys(DEFAULTS).sort());
  for (const name of Object.values(VARIABLES)) assert.match(name, /^OSCAR_[A-Z_]+_PORT$/);
});

test("a value that is not a port is refused rather than silently defaulted", () => {
  // Falling back to 8080 on a typo is how a development copy lands on top of
  // the show's OSCAR.
  for (const bad of ["808O", "0", "70000", "-1", "8080.5"]) {
    assert.throws(() => portsFromEnv({ OSCAR_HTTP_PORT: bad }), /OSCAR_HTTP_PORT/, bad);
  }
});

test("an empty variable counts as unset", () => {
  assert.strictEqual(portsFromEnv({ OSCAR_SOCKET_PORT: "" }).socket, DEFAULTS.socket);
});
