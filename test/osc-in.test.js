"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { parse, matchesAddress, plainValue } = require("../lib/osc-in");
const { incoming, onIncoming } = require("../lib/widgets/incoming");
const { MAX_ARGS } = require("../lib/osc-message");
const { fakeContext } = require("./helpers/fake-dom");

// --- reading a packet -------------------------------------------------------

test("a received message becomes an address and plain values", () => {
  const message = parse({
    address: "/master/level",
    args: [{ type: "f", value: 0.5 }, { type: "i", value: 3 }, { type: "s", value: "go" }],
  });

  assert.deepStrictEqual(message, { address: "/master/level", args: [0.5, 3, "go"] });
});

test("T and F arrive as their type tag, not as a value", () => {
  // osc.js sets no `value` for T/F -- the type tag is the whole argument, and
  // reading .value would hand every widget undefined.
  const message = parse({ address: "/on", args: [{ type: "T" }, { type: "F" }] });
  assert.deepStrictEqual(message.args, [true, false]);
});

test("a bare address is a message, with nothing attached", () => {
  assert.deepStrictEqual(parse({ address: "/play" }), { address: "/play", args: [] });
  assert.deepStrictEqual(parse({ address: "/play", args: [] }).args, []);
});

test("anything that isn't an OSC message is refused", () => {
  assert.strictEqual(parse(null), null);
  assert.strictEqual(parse({}), null);
  assert.strictEqual(parse({ address: "" }), null);
  assert.strictEqual(parse({ address: "/" }), null, "a lone slash is not a path");
  assert.strictEqual(parse({ address: "master/level" }), null, "an address starts with /");
  assert.strictEqual(parse({ address: 7 }), null);
});

test("an absurd number of arguments is dropped rather than relayed", () => {
  const args = new Array(MAX_ARGS + 1).fill({ type: "f", value: 1 });
  assert.strictEqual(parse({ address: "/flood", args }), null);
});

test("the sender is not kept -- which machine moved a fader is not a widget's business", () => {
  const message = parse({ address: "/x", args: [{ type: "f", value: 1 }], sender: "10.0.0.9" });
  assert.deepStrictEqual(Object.keys(message).sort(), ["address", "args"]);
});

test("plainValue leaves a value that is already plain alone", () => {
  assert.strictEqual(plainValue(4), 4);
  assert.strictEqual(plainValue("go"), "go");
  assert.strictEqual(plainValue(undefined), null);
  assert.strictEqual(plainValue({ type: "f" }), null, "a typed argument with no value");
});

// --- address matching -------------------------------------------------------

test("an address with no wildcards has to match exactly", () => {
  assert.ok(matchesAddress("/master/level", "/master/level"));
  assert.ok(!matchesAddress("/master/level", "/master/level2"));
  assert.ok(!matchesAddress("/master", "/master/level"));
  assert.ok(!matchesAddress("/Master", "/master"));
});

test("OSC wildcards are honoured, because software sends them", () => {
  assert.ok(matchesAddress("/layer*/clip", "/layer3/clip"));
  assert.ok(matchesAddress("/layer?/clip", "/layer3/clip"));
  assert.ok(!matchesAddress("/layer?/clip", "/layer33/clip"));
  assert.ok(matchesAddress("/ch[1-3]", "/ch2"));
  assert.ok(!matchesAddress("/ch[1-3]", "/ch4"));
  assert.ok(matchesAddress("/ch[!1-3]", "/ch4"));
  assert.ok(matchesAddress("/{play,stop}", "/stop"));
  assert.ok(!matchesAddress("/{play,stop}", "/pause"));
});

test("a wildcard stays inside one part of the path", () => {
  // /eos/* addresses the channels of /eos, not everything underneath it.
  assert.ok(!matchesAddress("/eos/*", "/eos/chan/1"));
  assert.ok(matchesAddress("/eos/*", "/eos/chan"));
});

test("a widget's own address is never read as a pattern", () => {
  // Someone who types /pad[1] in the settings panel means that address.
  assert.ok(!matchesAddress("/pad1", "/pad[1]"));
  assert.ok(matchesAddress("/pad[1]", "/pad1"), "the incoming side is the pattern");
});

test("a malformed pattern matches nothing instead of throwing", () => {
  assert.ok(!matchesAddress("/ch[1-3", "/ch2"), "an unclosed class is a literal");
  assert.ok(matchesAddress("/ch[1-3", "/ch[1-3"));
  assert.ok(!matchesAddress(null, "/x"));
  assert.ok(!matchesAddress("/x", undefined));
});

test("regex metacharacters in an address are matched, not interpreted", () => {
  assert.ok(matchesAddress("/a.b", "/a.b"));
  assert.ok(!matchesAddress("/a.b", "/axb"));
  assert.ok(matchesAddress("/a+b", "/a+b"));
});

// --- the routing decision ---------------------------------------------------

test("Listen off means an incoming message is never this widget's business", () => {
  const message = { address: "/slider1", args: [50] };
  assert.strictEqual(incoming({ listen: false, message: "/slider1" }, message), null);
  assert.strictEqual(incoming({ message: "/slider1" }, message), null, "unset counts as off");
  assert.strictEqual(incoming(null, message), null);
});

test("a listening widget takes the values at its own address and no other", () => {
  const config = { listen: true, message: "/slider1" };

  assert.deepStrictEqual(incoming(config, { address: "/slider1", args: [50] }), {
    address: "/slider1",
    values: [50],
  });

  assert.strictEqual(incoming(config, { address: "/slider2", args: [50] }), null);
  assert.strictEqual(incoming(config, null), null);
  assert.strictEqual(incoming(config, { address: "/slider1" }), null, "unparsed message");
});

test("a subscription reads Listen and Message afresh for every message", () => {
  // Both can be edited while the widget is live, and a subscription that
  // captured them once would keep answering to the old address.
  const ctx = fakeContext({ listen: false, message: "/a" });
  const heard = [];
  onIncoming(ctx, (values) => heard.push(values[0]));

  ctx.receive("/a", [1]);
  assert.deepStrictEqual(heard, [], "Listen was off");

  ctx.edit("listen", true);
  ctx.receive("/a", [2]);
  ctx.edit("message", "/b");
  ctx.receive("/a", [3]);
  ctx.receive("/b", [4]);
  assert.deepStrictEqual(heard, [2, 4]);
});

test("a host with no network behind it can leave onOsc off entirely", () => {
  const ctx = fakeContext({ listen: true, message: "/a" });
  delete ctx.onOsc;
  assert.strictEqual(onIncoming(ctx, () => {}), null, "and gets no subscription to undo");
});

test("unsubscribing stops the messages", () => {
  const ctx = fakeContext({ listen: true, message: "/a" });
  let heard = 0;
  const stop = onIncoming(ctx, () => heard++);

  ctx.receive("/a", [1]);
  stop();
  ctx.receive("/a", [1]);
  assert.strictEqual(heard, 1);
});

test("routing hands back values and never a message to send", () => {
  // The shape is the whole loop guard: there is no way to act on this result
  // by putting something on the wire.
  const match = incoming({ listen: true, message: "/pad" }, { address: "/pad", args: [1, 2] });
  assert.deepStrictEqual(Object.keys(match).sort(), ["address", "values"]);
  assert.deepStrictEqual(match.values, [1, 2]);
});
