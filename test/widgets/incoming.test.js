"use strict";

/**
 * The receive helper every listening widget goes through. Its shape is the
 * loop guard: it hands back values, never a message to send.
 */

const test = require("node:test");
const assert = require("node:assert");

const { incoming, follow } = require("../../lib/widgets/incoming");
const { fakeContext } = require("../helpers/fake-dom");

test("Listen off means an incoming message is never this widget's business", () => {
  const message = { address: "/slider1", args: [50] };
  assert.strictEqual(incoming({ enabled: true, listen: false, message: "/slider1" }, message), null);
  assert.strictEqual(incoming({ enabled: true, message: "/slider1" }, message), null, "unset counts as off");
  assert.strictEqual(incoming(null, message), null);
});

test("Enabled off makes a widget deaf as well as silent", () => {
  // The master switch, as fields.js calls it: a surface is switched off to be
  // laid out while the rig is live, and a control that keeps jumping under
  // the pointer is not being laid out.
  const message = { address: "/slider1", args: [50] };
  assert.strictEqual(incoming({ enabled: false, listen: true, message: "/slider1" }, message), null);
  assert.strictEqual(incoming({ listen: true, message: "/slider1" }, message), null, "unset counts as off");
  assert.ok(incoming({ enabled: true, listen: true, message: "/slider1" }, message));
});

test("an address always reaches itself, even one that holds pattern characters", () => {
  // Some software exposes addresses like /layer[1]/opacity and echoes them
  // verbatim; read as a pattern, that string could never match its own widget.
  const config = { enabled: true, listen: true, message: "/layer[1]/opacity" };
  assert.deepStrictEqual(incoming(config, { address: "/layer[1]/opacity", args: [0.5] }), {
    address: "/layer[1]/opacity",
    values: [0.5],
  });
  assert.strictEqual(incoming(config, { address: "/layer1/opacity", args: [0.5] }), null, "the literal is not a class");
  assert.ok(incoming(config, { address: "/layer*/opacity", args: [0.5] }), "a wider pattern still reaches it");
  const several = { enabled: true, listen: true, message: ["/p{a}/x", "/p{a}/y"] };
  assert.strictEqual(incoming(several, { address: "/p{a}/y", args: [1] }).address, "/p{a}/y");
});

test("a listening widget takes the values at its own address and no other", () => {
  const config = { enabled: true, listen: true, message: "/slider1" };
  assert.deepStrictEqual(incoming(config, { address: "/slider1", args: [50] }), {
    address: "/slider1",
    values: [50],
  });
  assert.strictEqual(incoming(config, { address: "/slider2", args: [50] }), null);
  assert.strictEqual(incoming(config, null), null);
  assert.strictEqual(incoming(config, { address: "/slider1" }), null, "no args list means an unparsed message");
  assert.strictEqual(incoming(config, { address: 7, args: [] }), null);
});

test("the incoming address may be a pattern; the widget's address never is", () => {
  const config = { enabled: true, listen: true, message: "/ch[1]" };
  assert.ok(incoming({ enabled: true, listen: true, message: "/ch1" }, { address: "/ch[1-3]", args: [1] }));
  assert.strictEqual(incoming(config, { address: "/ch1", args: [1] }), null);
  assert.ok(incoming(config, { address: "/ch*", args: [1] }), "reached by a pattern, as any address is");
});

test("a widget with several addresses is told which one matched", () => {
  const config = { enabled: true, listen: true, message: ["/pad/x", "/pad/y"] };
  assert.deepStrictEqual(incoming(config, { address: "/pad/y", args: [3] }), { address: "/pad/y", values: [3] });
  assert.deepStrictEqual(incoming(config, { address: "/pad/*", args: [3] }).address, "/pad/x", "the first that matches");
  assert.strictEqual(incoming(config, { address: "/pad", args: [1, 2] }), null);
});

test("the values handed on are a copy, so one widget cannot edit what the next one hears", () => {
  const args = [1, 2];
  const match = incoming({ enabled: true, listen: true, message: "/pad" }, { address: "/pad", args });
  match.values.push(3);
  assert.deepStrictEqual(args, [1, 2]);
});

test("routing hands back values and never a message to send", () => {
  // The shape is the widget-side half of the loop guard: nothing in this
  // result can be handed to ctx.send.
  const match = incoming({ enabled: true, listen: true, message: "/pad" }, { address: "/pad", args: [1, 2] });
  assert.deepStrictEqual(Object.keys(match).sort(), ["address", "values"]);
});

// --- follow -----------------------------------------------------------------

test("a subscription reads Enabled, Listen and Message afresh for every message", () => {
  // All three can be edited while the widget is live, and a subscription
  // that captured them once would keep answering to the old address.
  const ctx = fakeContext({ enabled: true, listen: false, message: "/a" });
  const heard = [];
  follow(ctx, (values) => heard.push(values[0]));

  ctx.receive("/a", [1]);
  assert.deepStrictEqual(heard, [], "Listen was off");

  ctx.edit("listen", true);
  ctx.receive("/a", [2]);
  ctx.edit("message", "/b");
  ctx.receive("/a", [3]);
  ctx.receive("/b", [4]);
  ctx.edit("enabled", false);
  ctx.receive("/b", [5]);
  ctx.edit("enabled", true);
  ctx.receive("/b", [6]);
  assert.deepStrictEqual(heard, [2, 4, 6]);
});

test("a widget can follow addresses other than Message, worked out per message", () => {
  const ctx = fakeContext({ enabled: true, listen: true, message: "/pad", sendMode: "two" });
  const heard = [];
  follow(
    ctx,
    (values, address) => heard.push(address + "=" + values[0]),
    () => (ctx.get("sendMode") === "two" ? ["/pad/x", "/pad/y"] : "/pad")
  );

  ctx.receive("/pad/y", [7]);
  ctx.receive("/pad", [1, 2]);
  ctx.edit("sendMode", "one");
  ctx.receive("/pad", [1, 2]);
  ctx.receive("/pad/y", [7]);
  assert.deepStrictEqual(heard, ["/pad/y=7", "/pad=1"]);
});

test("a host with no network behind it can leave onOsc off entirely", () => {
  const ctx = fakeContext({ enabled: true, listen: true, message: "/a" });
  delete ctx.onOsc;
  assert.strictEqual(follow(ctx, () => {}), null, "and gets no subscription to undo");
});

test("unsubscribing stops the messages", () => {
  const ctx = fakeContext({ enabled: true, listen: true, message: "/a" });
  let heard = 0;
  const stop = follow(ctx, () => heard++);
  ctx.receive("/a", [1]);
  stop();
  ctx.receive("/a", [1]);
  assert.strictEqual(heard, 1);
  assert.strictEqual(ctx.listening(), 0);
});

test("the test host refuses a send made while delivering, so a looping widget cannot pass its tests", () => {
  const ctx = fakeContext({ listen: true, message: "/a", enabled: true });
  follow(ctx, () => ctx.send({ ip: "localhost", port: 7000, address: "/a", args: [] }));
  assert.throws(() => ctx.receive("/a", [1]), /answered an incoming OSC message/);
  assert.deepStrictEqual(ctx.sent, []);
  // And it recovers: a send from a hand afterwards is still fine.
  ctx.send({ ip: "localhost", port: 7000, address: "/a", args: [] });
  assert.strictEqual(ctx.sent.length, 1);
});
