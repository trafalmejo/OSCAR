"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { outgoing, only, routing } = require("../../lib/widgets/outgoing");
const { field, dmxFields, dmxDefaults, dmxChecks, sendsDmx, sendsOsc, TRANSPORTS } = require("../../lib/widgets/fields");

/**
 * outgoing() is the one funnel every widget's value goes through. The OSC
 * half has been covered by the widgets' own tests since the beginning; this
 * file is about the DMX half and how the two sit together.
 */

function config(overrides) {
  return Object.assign(
    { enabled: true, ip: "10.0.0.5", port: 7000, message: "/x", argType: "f" },
    dmxDefaults(1),
    overrides
  );
}

test("OSC by default: a widget with no Output setting at all sends what it always did", () => {
  const message = outgoing({ enabled: true, ip: "10.0.0.5", port: 7000, message: "/x", argType: "f" }, 50, 0.5);
  assert.deepStrictEqual(message, { ip: "10.0.0.5", port: 7000, address: "/x", args: [{ type: "f", value: 50 }] });
  assert.deepStrictEqual(Object.keys(outgoing(config({}), 50, 0.5)).sort(), ["address", "args", "ip", "port"], "and with Output at its default");
});

test("on DMX the message is a block of levels and nothing for OSC", () => {
  const message = outgoing(config({ transport: "dmx", dmxChannel: 10, dmxHost: " 10.0.0.9 " }), 50, 0.5);
  assert.deepStrictEqual(message, {
    dmx: { protocol: "artnet", host: "10.0.0.9", universe: 1, channel: 10, levels: [128] },
  });
});

test("on both, one object carries both halves", () => {
  const message = outgoing(config({ transport: "both" }), 50, 0.5);
  assert.strictEqual(message.address, "/x");
  assert.deepStrictEqual(message.dmx.levels, [128]);
});

test("several values from one widget land on consecutive channels: a colour is three", () => {
  const message = outgoing(config({ transport: "dmx", dmxCount: 3 }), [255, 0, 128], [1, 0, 0.5]);
  assert.deepStrictEqual(message.dmx.levels, [255, 0, 128]);
});

test("one value over a wider block repeats; a block too narrow for the values is refused", () => {
  assert.deepStrictEqual(outgoing(config({ transport: "dmx", dmxCount: 3 }), 100, 1).dmx.levels, [255, 255, 255]);
  assert.strictEqual(outgoing(config({ transport: "dmx", dmxCount: 1 }), [1, 2], [0.1, 0.2]), null);
});

test("a block that runs past channel 512 is refused, never truncated", () => {
  assert.ok(outgoing(config({ transport: "dmx", dmxChannel: 512, dmxCount: 1 }), 1, 1));
  assert.strictEqual(outgoing(config({ transport: "dmx", dmxChannel: 512, dmxCount: 2 }), 1, 1), null);
  assert.strictEqual(outgoing(config({ transport: "dmx", dmxChannel: 513 }), 1, 1), null);
  assert.strictEqual(outgoing(config({ transport: "dmx", dmxChannel: 0 }), 1, 1), null);
});

test("the universe is checked against the protocol", () => {
  assert.ok(outgoing(config({ transport: "dmx", dmxProtocol: "artnet", dmxUniverse: 0 }), 1, 1));
  assert.strictEqual(outgoing(config({ transport: "dmx", dmxProtocol: "sacn", dmxUniverse: 0 }), 1, 1), null);
  assert.strictEqual(outgoing(config({ transport: "dmx", dmxProtocol: "artnet", dmxUniverse: 40000 }), 1, 1), null);
  assert.ok(outgoing(config({ transport: "dmx", dmxProtocol: "sacn", dmxUniverse: 40000 }), 1, 1));
  assert.strictEqual(outgoing(config({ transport: "dmx", dmxProtocol: "midi" }), 1, 1), null);
});

test("a level that cannot be read is silence on DMX, never zero", () => {
  for (const bad of [null, undefined, "", "abc", NaN, [0.5, null], []]) {
    assert.strictEqual(outgoing(config({ transport: "dmx" }), 1, bad), null, JSON.stringify(bad));
  }
});

test("the halves are independent: what one wire cannot carry does not silence the other", () => {
  // A button whose Value ON is "go" cannot send that as a float, but it can
  // still put its dimmer to full.
  const message = outgoing(config({ transport: "both" }), "go", 1);
  assert.ok(!("address" in message));
  assert.deepStrictEqual(message.dmx.levels, [255]);
  // And a good OSC value with an unreadable level still goes out as OSC.
  const osc = outgoing(config({ transport: "both" }), 50, null);
  assert.strictEqual(osc.address, "/x");
  assert.ok(!("dmx" in osc));
  // Neither is a message.
  assert.strictEqual(outgoing(config({ transport: "both" }), "go", null), null);
});

test("Enabled off is silence on every transport", () => {
  for (const transport of TRANSPORTS.map((t) => t.id)) {
    assert.strictEqual(outgoing(config({ transport, enabled: false }), 50, 0.5), null, transport);
  }
});

test("levels are 0..1 scaled onto 0..255 and clamped, whatever the widget's own units were", () => {
  assert.deepStrictEqual(outgoing(config({ transport: "dmx" }), 0, 0).dmx.levels, [0]);
  assert.deepStrictEqual(outgoing(config({ transport: "dmx" }), 1, 1).dmx.levels, [255]);
  assert.deepStrictEqual(outgoing(config({ transport: "dmx" }), 1, 1.5).dmx.levels, [255]);
  assert.deepStrictEqual(outgoing(config({ transport: "dmx" }), 1, -1).dmx.levels, [0]);
});

test("only() narrows the settings to one transport, or nothing", () => {
  assert.strictEqual(only(config({ transport: "osc" }), "dmx"), null);
  assert.strictEqual(only(config({ transport: "dmx" }), "osc"), null);
  assert.strictEqual(only(config({ transport: "both" }), "osc").transport, "osc");
  assert.strictEqual(only(config({ transport: "both" }), "dmx").transport, "dmx");
  assert.strictEqual(only(config({}), "osc").transport, "osc", "no Output setting means OSC");
  assert.strictEqual(only(null, "osc"), null);
  assert.strictEqual(outgoing(null, 1, 1), null);
});

test("routing() reads every shared setting off the host, and missing ones read as OSC only", () => {
  const ctx = { get: (key) => ({ enabled: true, ip: "a", port: 1, message: "/m", argType: "i" })[key] };
  const read = routing(ctx);
  assert.strictEqual(read.transport, undefined);
  assert.strictEqual(sendsOsc(read), true);
  assert.strictEqual(sendsDmx(read), false);
  assert.strictEqual(sendsDmx({ transport: "both" }), true);
  assert.strictEqual(sendsOsc({ transport: "dmx" }), false);
});

// --- the field vocabulary ---------------------------------------------------

test("a showIf rule is data, and a malformed one is refused when the field is built", () => {
  assert.deepStrictEqual(field("a", "A", "text", { showIf: { key: "transport", in: ["dmx"] } }).showIf, {
    key: "transport",
    in: ["dmx"],
  });
  assert.throws(() => field("a", "A", "text", { showIf: () => true }), /showIf/);
  assert.throws(() => field("a", "A", "text", { showIf: { key: "transport" } }), /showIf/);
  assert.throws(() => field("a", "A", "text", { showIf: { in: ["dmx"] } }), /showIf/);
  for (const f of dmxFields()) assert.deepStrictEqual(f.showIf, { key: "transport", in: ["dmx", "both"] });
});

test("the DMX checks refuse what the wire would refuse, while there is still a human looking", () => {
  const checks = dmxChecks(2);
  assert.strictEqual(checks.dmxUniverse(0, { dmxProtocol: "artnet" }), null);
  assert.match(checks.dmxUniverse(0, { dmxProtocol: "sacn" }), /sACN/);
  assert.match(checks.dmxUniverse("", { dmxProtocol: "artnet" }), /universe/);
  assert.match(checks.dmxUniverse(1.5, {}), /universe/);

  assert.strictEqual(checks.dmxProtocol("sacn", { dmxUniverse: 1 }), null);
  assert.match(checks.dmxProtocol("sacn", { dmxUniverse: 0 }), /change the universe first/);
  assert.match(checks.dmxProtocol("midi", { dmxUniverse: 1 }), /Unknown/);

  assert.strictEqual(checks.dmxChannel(1, { dmxCount: 2 }), null);
  assert.match(checks.dmxChannel(0, {}), /between 1 and 512/);
  assert.match(checks.dmxChannel(512, { dmxCount: 2 }), /past the end/);
  assert.strictEqual(checks.dmxChannel(511, { dmxCount: 2 }), null);

  assert.strictEqual(checks.dmxCount(2, { dmxChannel: 1 }), null);
  assert.match(checks.dmxCount(1, { dmxChannel: 1 }), /between 2 and 512/, "a pad needs two channels");
  assert.match(checks.dmxCount(3, { dmxChannel: 511 }), /past the end/);
  assert.match(checks.dmxCount("", { dmxChannel: 1 }), /between/);
  assert.strictEqual(dmxChecks(1).dmxCount(1, { dmxChannel: 1 }), null);
});

test("the DMX defaults name a universe both protocols accept, and a block as wide as the widget", () => {
  const defaults = dmxDefaults(3);
  assert.strictEqual(defaults.transport, "osc");
  assert.strictEqual(defaults.dmxUniverse, 1);
  assert.strictEqual(defaults.dmxCount, 3);
  assert.strictEqual(dmxDefaults().dmxCount, 1);
  assert.strictEqual(dmxChecks(3).dmxProtocol("sacn", defaults), null);
  assert.strictEqual(dmxChecks(3).dmxProtocol("artnet", defaults), null);
});
