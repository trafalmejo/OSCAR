"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { outgoing, only, routing } = require("../../lib/widgets/outgoing");
const { field, dmxFields, dmxDefaults, dmxChecks, sendsDmx, sendsOsc, upgradeRouting, SECTIONS } = require("../../lib/widgets/fields");

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

test("OSC by default: a widget with neither checkbox in its settings sends what it always did", () => {
  const message = outgoing({ enabled: true, ip: "10.0.0.5", port: 7000, message: "/x", argType: "f" }, 50, 0.5);
  assert.deepStrictEqual(message, { ip: "10.0.0.5", port: 7000, address: "/x", args: [{ type: "f", value: 50 }] });
  assert.deepStrictEqual(Object.keys(outgoing(config({}), 50, 0.5)).sort(), ["address", "args", "ip", "port"], "and with both checkboxes at their defaults");
});

test("on DMX the message is a block of levels and nothing for OSC", () => {
  const message = outgoing(config({ oscEnabled: false, dmxEnabled: true, dmxChannel: 10, dmxHost: " 10.0.0.9 " }), 50, 0.5);
  assert.deepStrictEqual(message, {
    dmx: { protocol: "artnet", host: "10.0.0.9", universe: 1, channel: 10, levels: [128] },
  });
});

test("on both, one object carries both halves", () => {
  const message = outgoing(config({ oscEnabled: true, dmxEnabled: true }), 50, 0.5);
  assert.strictEqual(message.address, "/x");
  assert.deepStrictEqual(message.dmx.levels, [128]);
});

test("several values from one widget land on consecutive channels: a colour is three", () => {
  const message = outgoing(config({ oscEnabled: false, dmxEnabled: true, dmxCount: 3 }), [255, 0, 128], [1, 0, 0.5]);
  assert.deepStrictEqual(message.dmx.levels, [255, 0, 128]);
});

test("one value over a wider block repeats; a block too narrow for the values is refused", () => {
  assert.deepStrictEqual(outgoing(config({ oscEnabled: false, dmxEnabled: true, dmxCount: 3 }), 100, 1).dmx.levels, [255, 255, 255]);
  assert.strictEqual(outgoing(config({ oscEnabled: false, dmxEnabled: true, dmxCount: 1 }), [1, 2], [0.1, 0.2]), null);
});

test("a block that runs past channel 512 is refused, never truncated", () => {
  assert.ok(outgoing(config({ oscEnabled: false, dmxEnabled: true, dmxChannel: 512, dmxCount: 1 }), 1, 1));
  assert.strictEqual(outgoing(config({ oscEnabled: false, dmxEnabled: true, dmxChannel: 512, dmxCount: 2 }), 1, 1), null);
  assert.strictEqual(outgoing(config({ oscEnabled: false, dmxEnabled: true, dmxChannel: 513 }), 1, 1), null);
  assert.strictEqual(outgoing(config({ oscEnabled: false, dmxEnabled: true, dmxChannel: 0 }), 1, 1), null);
});

test("the universe is checked against the protocol", () => {
  assert.ok(outgoing(config({ oscEnabled: false, dmxEnabled: true, dmxProtocol: "artnet", dmxUniverse: 0 }), 1, 1));
  assert.strictEqual(outgoing(config({ oscEnabled: false, dmxEnabled: true, dmxProtocol: "sacn", dmxUniverse: 0 }), 1, 1), null);
  assert.strictEqual(outgoing(config({ oscEnabled: false, dmxEnabled: true, dmxProtocol: "artnet", dmxUniverse: 40000 }), 1, 1), null);
  assert.ok(outgoing(config({ oscEnabled: false, dmxEnabled: true, dmxProtocol: "sacn", dmxUniverse: 40000 }), 1, 1));
  assert.strictEqual(outgoing(config({ oscEnabled: false, dmxEnabled: true, dmxProtocol: "midi" }), 1, 1), null);
});

test("a level that cannot be read is silence on DMX, never zero", () => {
  for (const bad of [null, undefined, "", "abc", NaN, [0.5, null], []]) {
    assert.strictEqual(outgoing(config({ oscEnabled: false, dmxEnabled: true }), 1, bad), null, JSON.stringify(bad));
  }
});

test("the halves are independent: what one wire cannot carry does not silence the other", () => {
  // A button whose Value ON is "go" cannot send that as a float, but it can
  // still put its dimmer to full.
  const message = outgoing(config({ oscEnabled: true, dmxEnabled: true }), "go", 1);
  assert.ok(!("address" in message));
  assert.deepStrictEqual(message.dmx.levels, [255]);
  // And a good OSC value with an unreadable level still goes out as OSC.
  const osc = outgoing(config({ oscEnabled: true, dmxEnabled: true }), 50, null);
  assert.strictEqual(osc.address, "/x");
  assert.ok(!("dmx" in osc));
  // Neither is a message.
  assert.strictEqual(outgoing(config({ oscEnabled: true, dmxEnabled: true }), "go", null), null);
});

test("Enabled off is silence whichever protocols are switched on", () => {
  for (const oscEnabled of [true, false]) {
    for (const dmxEnabled of [true, false]) {
      assert.strictEqual(outgoing(config({ oscEnabled, dmxEnabled, enabled: false }), 50, 0.5), null);
    }
  }
});

test("both checkboxes off is allowed, and silent", () => {
  assert.strictEqual(outgoing(config({ oscEnabled: false, dmxEnabled: false }), 50, 0.5), null);
});

test("a checkbox reads as on only when it says so, never because it holds something", () => {
  // A file edited by hand can hold the text; anything else is off. "false"
  // is a non-empty string, and must not switch DMX on.
  for (const on of [true, "true"]) assert.strictEqual(sendsDmx({ dmxEnabled: on }), true, JSON.stringify(on));
  for (const off of [false, "false", "", 0, 1, null, undefined, {}, "yes"]) {
    assert.strictEqual(sendsDmx({ dmxEnabled: off }), false, JSON.stringify(off));
  }
  assert.strictEqual(sendsOsc({ oscEnabled: "false" }), false);
  assert.strictEqual(sendsOsc({ oscEnabled: null }), true, "no word either way means OSC, as it always has");
});

test("a project saved with the old Output setting still goes where it was told to", () => {
  // That word is what the person chose; the checkboxes on such a widget only
  // hold their defaults, so it has to outvote them until it is upgraded.
  const stale = { oscEnabled: true, dmxEnabled: false };
  assert.deepStrictEqual(Object.keys(outgoing(config(Object.assign({ transport: "dmx" }, stale)), 50, 0.5)), ["dmx"]);
  assert.deepStrictEqual(Object.keys(outgoing(config(Object.assign({ transport: "both" }, stale)), 50, 0.5)).sort(), ["address", "args", "dmx", "ip", "port"]);
  assert.strictEqual(outgoing(config({ transport: "osc", dmxEnabled: true }), 50, 0.5).dmx, undefined);

  assert.deepStrictEqual(upgradeRouting({ transport: "dmx" }), { oscEnabled: false, dmxEnabled: true });
  assert.deepStrictEqual(upgradeRouting({ transport: "both" }), { oscEnabled: true, dmxEnabled: true });
  assert.deepStrictEqual(upgradeRouting({ transport: "osc" }), { oscEnabled: true, dmxEnabled: false });
  for (const none of [{}, { transport: "" }, { transport: null }, { transport: 3 }, null]) {
    assert.strictEqual(upgradeRouting(none), null, JSON.stringify(none));
  }
});

test("levels are 0..1 scaled onto 0..255 and clamped, whatever the widget's own units were", () => {
  assert.deepStrictEqual(outgoing(config({ oscEnabled: false, dmxEnabled: true }), 0, 0).dmx.levels, [0]);
  assert.deepStrictEqual(outgoing(config({ oscEnabled: false, dmxEnabled: true }), 1, 1).dmx.levels, [255]);
  assert.deepStrictEqual(outgoing(config({ oscEnabled: false, dmxEnabled: true }), 1, 1.5).dmx.levels, [255]);
  assert.deepStrictEqual(outgoing(config({ oscEnabled: false, dmxEnabled: true }), 1, -1).dmx.levels, [0]);
});

test("only() narrows the settings to one protocol, or nothing", () => {
  assert.strictEqual(only(config({ oscEnabled: true, dmxEnabled: false }), "dmx"), null);
  assert.strictEqual(only(config({ oscEnabled: false, dmxEnabled: true }), "osc"), null);
  const both = config({ oscEnabled: true, dmxEnabled: true });
  assert.deepStrictEqual([sendsOsc(only(both, "osc")), sendsDmx(only(both, "osc"))], [true, false]);
  assert.deepStrictEqual([sendsOsc(only(both, "dmx")), sendsDmx(only(both, "dmx"))], [false, true]);
  assert.strictEqual(sendsOsc(only(config({}), "osc")), true, "the defaults mean OSC");
  // The old word must not survive the narrowing and outvote it.
  assert.strictEqual(sendsOsc(only(config({ transport: "both" }), "dmx")), false);
  assert.strictEqual(only(null, "osc"), null);
  assert.strictEqual(outgoing(null, 1, 1), null);
});

test("routing() reads every shared setting off the host, and missing ones read as OSC only", () => {
  const ctx = { get: (key) => ({ enabled: true, ip: "a", port: 1, message: "/m", argType: "i" })[key] };
  const read = routing(ctx);
  assert.strictEqual(read.transport, undefined);
  assert.strictEqual(sendsOsc(read), true);
  assert.strictEqual(sendsDmx(read), false);
  assert.strictEqual(sendsDmx({ oscEnabled: true, dmxEnabled: true }), true);
  assert.strictEqual(sendsOsc({ oscEnabled: false, dmxEnabled: true }), false);
});

// --- the field vocabulary ---------------------------------------------------

test("a showIf rule is data, and a malformed one is refused when the field is built", () => {
  assert.deepStrictEqual(field("a", "A", "text", { showIf: { key: "format", in: ["rgba"] } }).showIf, {
    key: "format",
    in: ["rgba"],
  });
  assert.throws(() => field("a", "A", "text", { showIf: () => true }), /showIf/);
  assert.throws(() => field("a", "A", "text", { showIf: { key: "format" } }), /showIf/);
  assert.throws(() => field("a", "A", "text", { showIf: { in: ["dmx"] } }), /showIf/);
});

test("a field names its protocol's section, and an unknown section is refused when the field is built", () => {
  assert.deepStrictEqual(SECTIONS.map((s) => s.id), ["osc", "midi", "dmx"], "one section per protocol, in panel order");
  assert.strictEqual(field("a", "A", "text", { section: "osc" }).section, "osc");
  assert.strictEqual(field("a", "A", "text").section, undefined, "none means the widget's own settings");
  assert.throws(() => field("a", "A", "text", { section: "sacn" }), /unknown section/);
  const dmx = dmxFields();
  assert.strictEqual(dmx[0].key, "dmxEnabled", "the checkbox leads its section");
  assert.strictEqual(dmx[0].label, "Data out", "the direction; the section title says which protocol");
  assert.deepStrictEqual(dmx.slice(1).map((f) => f.label), ["Send when", "Protocol", "Node or port", "Universe", "Channel", "Channels"]);
  for (const f of dmx) assert.strictEqual(f.section, "dmx", f.key);
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

  // A node the wire would refuse, or one no packet could reach, is refused
  // in the panel: the server's only complaint is a console line the packaged
  // app never shows, and a widget driving nothing looks like a broken light.
  assert.strictEqual(checks.dmxHost("", {}), null, "blank is the protocol's default");
  assert.strictEqual(checks.dmxHost(undefined, {}), null);
  assert.strictEqual(checks.dmxHost(" 192.168.1.20 ", {}), null);
  assert.strictEqual(checks.dmxHost("2.255.255.255", {}), null, "a subnet's broadcast");
  assert.strictEqual(checks.dmxHost("node-1.local", {}), null);
  assert.match(checks.dmxHost("192.168.1.300", {}), /DMX node/, "digits and dots must be an IPv4 address");
  assert.match(checks.dmxHost("1.2.3", {}), /DMX node/);
  assert.match(checks.dmxHost("bad host", {}), /DMX node/);
  assert.match(checks.dmxHost("node_1", {}), /DMX node/);
  assert.match(checks.dmxHost(12, {}), /DMX node/);
});

test("the DMX defaults name a universe both protocols accept, and a block as wide as the widget", () => {
  const defaults = dmxDefaults(3);
  assert.strictEqual(defaults.oscEnabled, true);
  assert.strictEqual(defaults.dmxEnabled, false);
  assert.strictEqual("transport" in defaults, false);
  assert.strictEqual(defaults.dmxUniverse, 1);
  assert.strictEqual(defaults.dmxCount, 3);
  assert.strictEqual(dmxDefaults().dmxCount, 1);
  assert.strictEqual(dmxChecks(3).dmxProtocol("sacn", defaults), null);
  assert.strictEqual(dmxChecks(3).dmxProtocol("artnet", defaults), null);
});

// --- the panel's status lights -------------------------------------------------

test("each direction of a section has its own light, on only when it would really happen", () => {
  const { sectionStatus, enabled } = require("../../lib/widgets/fields");
  const { slider } = require("../../lib/widgets/slider");
  const { meter } = require("../../lib/widgets/meter");
  const { textInput } = require("../../lib/widgets/text-input");
  const of = (overrides) => sectionStatus(slider.fields, Object.assign({}, slider.defaults, overrides));

  assert.deepStrictEqual(of({}), { osc: { in: false, out: true }, dmx: { out: false }, midi: { in: false, out: false } }, "a new slider sends OSC and nothing else");
  assert.deepStrictEqual(of({ listen: true }), { osc: { in: true, out: true }, dmx: { out: false }, midi: { in: false, out: false } });
  assert.deepStrictEqual(of({ listen: true, oscEnabled: false }), { osc: { in: true, out: false }, dmx: { out: false }, midi: { in: false, out: false } }, "following the rig while sending nothing");
  assert.deepStrictEqual(of({ oscEnabled: false, dmxEnabled: true }), { osc: { in: false, out: false }, dmx: { out: true }, midi: { in: false, out: false } });
  // The master switch stops every direction of every protocol. Green over a
  // widget it has silenced would be a lie, and the collapsed section is the
  // one that gets trusted at a glance.
  assert.deepStrictEqual(of({ listen: true, dmxEnabled: true, enabled: false }), { osc: { in: false, out: false }, dmx: { out: false }, midi: { in: false, out: false } });
  assert.deepStrictEqual(of({ midiEnabled: true }).midi, { in: false, out: true });
  assert.deepStrictEqual(of({ midiListen: true }).midi, { in: true, out: false }, "a controller working the widget, which says nothing back");
  assert.deepStrictEqual(of({ midiEnabled: true, midiListen: true, enabled: false }).midi, { in: false, out: false }, "the master switch silences MIDI too");
  assert.deepStrictEqual(of({ transport: "dmx" }).dmx, { out: true }, "an old project's Output word counts");

  // A direction the widget does not have has no light: DMX never listens,
  // a meter never sends, a text box has no DMX section at all.
  assert.deepStrictEqual(sectionStatus(meter.fields, meter.defaults), { osc: { in: true }, midi: { in: false } }, "a meter follows, over OSC or MIDI, and sends over neither");
  assert.deepStrictEqual(sectionStatus(textInput.fields, textInput.defaults), { osc: { in: false, out: true } });
  assert.deepStrictEqual(sectionStatus(null, null), {});

  // The master switch says what it is over, in the label and on hover.
  assert.strictEqual(enabled().key, "enabled", "the stored setting keeps its name, so no project changes");
  assert.strictEqual(enabled().label, "Master comms");
  assert.match(enabled().hint, /sends nothing on any protocol/);
  assert.match(enabled().hint, /ignores incoming/);
});

test("the OSC section is built in one place, for the directions a widget has", () => {
  const { oscFields } = require("../../lib/widgets/fields");
  const keys = (options) => oscFields(options).map((f) => f.key);
  assert.deepStrictEqual(keys(), ["listen", "oscEnabled", "oscSendWhen", "oscLoopGuard", "ip", "port", "message"]);
  assert.deepStrictEqual(keys({ sends: false }), ["listen", "message"], "a widget that only follows has nowhere to send");
  assert.deepStrictEqual(keys({ receives: false }), ["oscEnabled", "oscSendWhen", "oscLoopGuard", "ip", "port", "message"]);
  for (const f of oscFields()) assert.strictEqual(f.section, "osc", f.key);
  assert.match(oscFields()[0].hint, /not sent back out unless/);
});
