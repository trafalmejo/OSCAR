"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { portsFromEnv, planPorts, DEFAULTS, VARIABLES } = require("../lib/ports");

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

// --- serve:at ---------------------------------------------------------------

test("one number on the command line places every port a copy needs", () => {
  const { variables, ports, notes } = planPorts(["18100"], {});
  assert.deepStrictEqual(variables, {
    OSCAR_HTTP_PORT: "18100",
    OSCAR_SOCKET_PORT: "18101",
    OSCAR_OSC_IN_PORT: "18102",
    OSCAR_LAN_PORT: "18103",
    OSCAR_LOCAL_PORT: "18104",
  });
  assert.strictEqual(ports.dmx, DEFAULTS.dmx, "DMX is not derived");
  assert.deepStrictEqual(notes, []);
});

test("a port typed on the command line beats one left in the environment", () => {
  // OSCAR_HTTP_PORT=8080 in a shell profile must not put the copy started
  // with `serve:at 18100` on the show's port; the typed number is the ask.
  const { variables, ports, notes } = planPorts(["18100"], { OSCAR_HTTP_PORT: "8080" });
  assert.strictEqual(variables.OSCAR_HTTP_PORT, "18100");
  assert.strictEqual(ports.http, 18100);
  assert.strictEqual(ports.socket, 18101, "the rest derive from the typed port");
  assert.strictEqual(notes.length, 1, "and the operator is told");
  assert.match(notes[0], /OSCAR_HTTP_PORT=8080/);
  assert.match(notes[0], /18100/);

  // Agreeing values are not worth a note.
  assert.deepStrictEqual(planPorts(["18100"], { OSCAR_HTTP_PORT: "18100" }).notes, []);
});

test("a derived port yields to a variable already in the environment", () => {
  const { variables, ports } = planPorts(["18100"], { OSCAR_LAN_PORT: "5010" });
  assert.strictEqual(variables.OSCAR_LAN_PORT, undefined);
  assert.strictEqual(ports.lan, 5010);
  assert.strictEqual(ports.local, 18104);
});

test("explicit socket and osc-in arguments are honoured", () => {
  const { ports } = planPorts(["18200", "18250", "18260"], {});
  assert.strictEqual(ports.socket, 18250);
  assert.strictEqual(ports.oscIn, 18260);
});

test("a malformed argument is refused, not silently replaced by the derived port", () => {
  // `serve:at 18200 1820l` used to start on 18201 with no message.
  for (const bad of ["1820l", "0", "70000", "", "8080.5"]) {
    assert.throws(() => planPorts(["18200", bad], {}), /OSCAR_SOCKET_PORT/, JSON.stringify(bad));
    assert.throws(() => planPorts(["18200", "18201", bad], {}), /OSCAR_OSC_IN_PORT/, JSON.stringify(bad));
  }
  assert.throws(() => planPorts(["808O"], {}), /OSCAR_HTTP_PORT/);
  assert.throws(() => planPorts([], {}), /HTTP port/);
});

test("a malformed variable stops the plan the way it stops a plain start", () => {
  assert.throws(() => planPorts(["18100"], { OSCAR_SOCKET_PORT: "18201x" }), /OSCAR_SOCKET_PORT/);
});

test("two ports landing on the same number are refused before anything binds", () => {
  // An OSC-in port typed as http + 3 is the LAN source port, and UDP does
  // not share.
  assert.throws(() => planPorts(["18200", "18201", "18203"], {}), /OSCAR_LAN_PORT.*OSCAR_OSC_IN_PORT|OSCAR_OSC_IN_PORT.*OSCAR_LAN_PORT/);
  assert.throws(() => planPorts(["18200", "18200"], {}), /OSCAR_HTTP_PORT.*OSCAR_SOCKET_PORT/);
  assert.throws(() => planPorts(["18100"], { OSCAR_LAN_PORT: "18101" }), /18101/);
  // Including one the derivation does not touch.
  assert.throws(() => planPorts(["18100"], { OSCAR_DMX_PORT: "18101" }), /OSCAR_DMX_PORT/);
});

test("the DMX source port is any free port unless pinned, and 0 may be asked for by name", () => {
  // Binding Art-Net's own port would collide with node software on the same
  // machine, and the nodes do not care which port a packet came from.
  assert.strictEqual(DEFAULTS.dmx, 0);
  assert.strictEqual(portsFromEnv({ OSCAR_DMX_PORT: "6454" }).dmx, 6454);
  assert.strictEqual(portsFromEnv({ OSCAR_DMX_PORT: "0" }).dmx, 0, "an explicit 0 overrides a pinned profile");
  assert.throws(() => portsFromEnv({ OSCAR_HTTP_PORT: "0" }), /OSCAR_HTTP_PORT/, "only where any port is meaningful");
  assert.doesNotThrow(() => planPorts(["18100"], { OSCAR_DMX_PORT: "0" }), "0 collides with nothing");
});

test("a derived port past the top of the range is refused", () => {
  assert.throws(() => planPorts(["65534"], {}), /OSCAR_OSC_IN_PORT/);
});
