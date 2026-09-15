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
  assert.strictEqual(incoming(config, { address: "/slider1" }), null, "no args list means an unparsed message");
  assert.strictEqual(incoming(config, { address: 7, args: [] }), null);
});

test("the incoming address may be a pattern; the widget's address never is", () => {
  const config = { listen: true, message: "/ch[1]" };
  assert.ok(incoming({ listen: true, message: "/ch1" }, { address: "/ch[1-3]", args: [1] }));
  assert.strictEqual(incoming(config, { address: "/ch1", args: [1] }), null);
  assert.ok(incoming(config, { address: "/ch*", args: [1] }), "reached by a pattern, as any address is");
});

test("a widget with several addresses is told which one matched", () => {
  const config = { listen: true, message: ["/pad/x", "/pad/y"] };
  assert.deepStrictEqual(incoming(config, { address: "/pad/y", args: [3] }), { address: "/pad/y", values: [3] });
  assert.deepStrictEqual(incoming(config, { address: "/pad/*", args: [3] }).address, "/pad/x", "the first that matches");
  assert.strictEqual(incoming(config, { address: "/pad", args: [1, 2] }), null);
});

test("the values handed on are a copy, so one widget cannot edit what the next one hears", () => {
  const args = [1, 2];
  const match = incoming({ listen: true, message: "/pad" }, { address: "/pad", args });
  match.values.push(3);
  assert.deepStrictEqual(args, [1, 2]);
});

test("routing hands back values and never a message to send", () => {
  // The shape is the widget-side half of the loop guard: nothing in this
  // result can be handed to ctx.send.
  const match = incoming({ listen: true, message: "/pad" }, { address: "/pad", args: [1, 2] });
  assert.deepStrictEqual(Object.keys(match).sort(), ["address", "values"]);
});

// --- follow -----------------------------------------------------------------

test("a subscription reads Listen and Message afresh for every message", () => {
  // Both can be edited while the widget is live, and a subscription that
  // captured them once would keep answering to the old address.
  const ctx = fakeContext({ listen: false, message: "/a" });
  const heard = [];
  follow(ctx, (values) => heard.push(values[0]));

  ctx.receive("/a", [1]);
  assert.deepStrictEqual(heard, [], "Listen was off");

  ctx.edit("listen", true);
  ctx.receive("/a", [2]);
  ctx.edit("message", "/b");
  ctx.receive("/a", [3]);
  ctx.receive("/b", [4]);
  assert.deepStrictEqual(heard, [2, 4]);
});

test("a widget can follow addresses other than Message, worked out per message", () => {
  const ctx = fakeContext({ listen: true, message: "/pad", sendMode: "two" });
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
  const ctx = fakeContext({ listen: true, message: "/a" });
  delete ctx.onOsc;
  assert.strictEqual(follow(ctx, () => {}), null, "and gets no subscription to undo");
});

test("unsubscribing stops the messages", () => {
  const ctx = fakeContext({ listen: true, message: "/a" });
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
