"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { motion, SOURCES, RATE_MIN, RATE_MAX, datasetsOn, addressFor } = require("../../lib/widgets/motion");
const { fakeElement, fakeContext } = require("../helpers/fake-dom");

/** A phone's sensors as a host offers them: readings arrive when the test says. */
function fakePhone(options) {
  const phone = {
    watching: [],
    asked: 0,
    allow: !options || options.allow !== false,
    tapFirst: !!(options && options.tapFirst),
    motion: {
      needsTap: () => phone.tapFirst && phone.asked === 0,
      ask: async () => {
        phone.asked++;
        return phone.allow;
      },
      watch(kind, fn) {
        const entry = { kind, fn, stopped: false };
        phone.watching.push(entry);
        return () => {
          entry.stopped = true;
        };
      },
    },
    /** A reading for every stream being watched, or for one kind. */
    report(reading, kind) {
      phone.watching.filter((w) => !w.stopped && (!kind || w.kind === kind)).forEach((w) => w.fn(reading));
    },
  };
  return phone;
}

/** Mount the widget with a phone (or none) and the given settings; timers are the test's. */
function mountWith(phone, overrides) {
  const el = fakeElement();
  const ctx = fakeContext(Object.assign({}, motion.defaults, overrides));
  if (phone) ctx.device = phone;
  const detach = motion.attach(el, ctx);
  return { el, ctx, detach };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const sentAs = (ctx) => ctx.sent.map((m) => [m.address, m.args.map((a) => a.value)]);

test("on a laptop the box says to open it on a phone, lists what it would send and where, and sends nothing", () => {
  const { el, ctx, detach } = mountWith(null, { message: "/tilt", sendAcceleration: true });
  assert.strictEqual(el.textContent, "Motion · open on a phone\norientation  → /tilt/orientation\nacceleration  → /tilt/acceleration");
  assert.strictEqual(el.getAttribute("data-motion"), "phone");
  assert.deepStrictEqual(ctx.sent, []);
  detach();
});

test("on a phone every ticked reading is watched at once, and each goes out on its own address at the rate asked for", async () => {
  const phone = fakePhone();
  const { el, ctx, detach } = mountWith(phone, { rate: 50, sendOrientation: false, sendAcceleration: true, sendHeading: true, message: "/tilt", ip: "10.0.0.7", port: 9000 });
  assert.deepStrictEqual(
    phone.watching.map((w) => w.kind),
    ["acceleration", "heading"]
  );
  assert.strictEqual(el.getAttribute("data-motion"), "waiting");
  assert.strictEqual(el.textContent, "Motion · waiting for the sensor\nacceleration  → /tilt/acceleration\nheading  → /tilt/heading");
  phone.report({ x: 0.1234, y: -2, z: 9.81 }, "acceleration");
  phone.report({ x: 270.5 }, "heading");
  assert.strictEqual(el.getAttribute("data-motion"), "live");
  await tick(40);
  assert.deepStrictEqual(sentAs(ctx), [
    ["/tilt/acceleration", [0.123, -2, 9.81]],
    ["/tilt/heading", [270.5]],
  ]);
  assert.strictEqual(ctx.sent[0].ip, "10.0.0.7");
  assert.strictEqual(ctx.sent[0].port, 9000);
  assert.strictEqual(el.textContent, "Motion\nacceleration  0.12  -2.00  9.81  → /tilt/acceleration\nheading  270.50  → /tilt/heading");
  // The same reading again is not another message; a new one on one stream is one message.
  phone.report({ x: 0.1234, y: -2, z: 9.81 }, "acceleration");
  phone.report({ x: 271 }, "heading");
  await tick(40);
  assert.deepStrictEqual(sentAs(ctx).slice(2), [["/tilt/heading", [271]]]);
  detach();
  assert.ok(phone.watching.every((w) => w.stopped), "detach lets the sensors go");
});

test("a page from before the split keeps its one Source on the plain Message, so nothing on a wall changes address", async () => {
  const phone = fakePhone();
  const legacy = { enabled: true, label: "Motion", ip: "localhost", port: 7000, message: "/tilt", argType: "f", oscEnabled: true, oscVia: "network", oscSendWhen: "user", oscLoopGuard: true, source: "gravity", rate: 50 };
  const el = fakeElement();
  const ctx = fakeContext(legacy);
  ctx.device = phone;
  const detach = motion.attach(el, ctx);
  assert.deepStrictEqual(phone.watching.map((w) => w.kind), ["gravity"]);
  phone.report({ x: 0, y: 0, z: 9.8 });
  await tick(40);
  assert.deepStrictEqual(sentAs(ctx), [["/tilt", [0, 0, 9.8]]]);
  assert.strictEqual(el.textContent, "Motion\ngravity  0.00  0.00  9.80  → /tilt");
  assert.deepStrictEqual(datasetsOn((k) => legacy[k]).legacy, true);
  assert.strictEqual(addressFor("/tilt/", SOURCES[0], false), "/tilt/orientation");
  assert.strictEqual(addressFor("", SOURCES[4], false), "/heading");
  detach();
});

test("the latest reading wins: sixty readings a second at a rate of 20 is twenty messages, not sixty", async () => {
  const phone = fakePhone();
  const { ctx, detach } = mountWith(phone, { rate: 20 });
  for (let i = 0; i < 12; i++) phone.report({ x: i, y: 0, z: 0 });
  await tick(60);
  assert.ok(ctx.sent.length >= 1 && ctx.sent.length <= 2, "sent " + ctx.sent.length);
  assert.strictEqual(ctx.sent[0].args[0].value, 11, "the last one");
  detach();
});

test("an iPhone asks for a tap first: the box is a button until the tap is allowed", async () => {
  const phone = fakePhone({ tapFirst: true });
  const { el, ctx, detach } = mountWith(phone);
  assert.strictEqual(el.getAttribute("data-motion"), "tap");
  assert.strictEqual(el.textContent, "Motion · tap to enable motion");
  assert.strictEqual(phone.watching.length, 0, "nothing watched before the tap");
  el.fire("click");
  await tick(5);
  assert.strictEqual(phone.asked, 1);
  assert.strictEqual(phone.watching.length, 1);
  assert.strictEqual(el.getAttribute("data-motion"), "waiting");
  // A second tap is not another request.
  el.fire("click");
  await tick(5);
  assert.strictEqual(phone.asked, 1);
  assert.deepStrictEqual(ctx.sent, []);
  detach();
});

test("a tap that is refused leaves the box asking", async () => {
  const phone = fakePhone({ tapFirst: true, allow: false });
  const { el, detach } = mountWith(phone);
  el.fire("click");
  await tick(5);
  assert.strictEqual(phone.watching.length, 0);
  assert.strictEqual(el.getAttribute("data-motion"), "tap");
  detach();
});

test("ticking a reading on or off watches the new set and lets go of the old; a disabled widget keeps reading and sends nothing", async () => {
  const phone = fakePhone();
  const { ctx, el, detach } = mountWith(phone, { rate: 50 });
  ctx.edit("sendRotation", true);
  assert.strictEqual(phone.watching[0].stopped, true);
  assert.deepStrictEqual(phone.watching.filter((w) => !w.stopped).map((w) => w.kind), ["orientation", "rotation"]);
  ctx.edit("sendOrientation", false);
  assert.deepStrictEqual(phone.watching.filter((w) => !w.stopped).map((w) => w.kind), ["rotation"]);
  ctx.edit("message", "/phone");
  assert.strictEqual(el.textContent, "Motion · waiting for the sensor\nrotation  → /phone/rotation");
  ctx.edit("enabled", false);
  phone.report({ x: 1, y: 2, z: 3 });
  await tick(40);
  assert.deepStrictEqual(ctx.sent, [], "Enabled off is silent");
  detach();
});

test("a reading with a value the phone has not got is ignored, never read as 0", async () => {
  const phone = fakePhone();
  const { ctx, detach } = mountWith(phone, { rate: 50 });
  phone.report({ x: 1, y: null, z: 3 });
  phone.report({ x: "nope", y: 2, z: 3 });
  await tick(40);
  assert.deepStrictEqual(ctx.sent, []);
  detach();
});

test("OSCAR driving the widget for a phone sends the first ticked reading on that reading's address", () => {
  const config = Object.assign({}, motion.defaults, { message: "/tilt", sendOrientation: false, sendGravity: true, sendHeading: true });
  const driven = motion.drive(config, { x: 1, y: 2, z: 3 });
  assert.deepStrictEqual(driven.state, { x: 1, y: 2, z: 3 });
  assert.strictEqual(driven.message.address, "/tilt/gravity");
  const compass = motion.drive(Object.assign({}, config, { sendGravity: false }), { x: 90, y: 0, z: 0 });
  assert.strictEqual(compass.message.address, "/tilt/heading");
  assert.deepStrictEqual(compass.message.args.map((a) => a.value), [90]);
  assert.strictEqual(motion.drive(config, { x: 1 }), null);
});

test("the settings panel refuses a rate a phone cannot give, and offers every reading as a switch of its own", () => {
  assert.strictEqual(motion.checks.rate(20), null);
  assert.match(motion.checks.rate(0), /between/);
  assert.match(motion.checks.rate(RATE_MAX + 1), /between/);
  assert.match(motion.checks.rate("fast"), /between/);
  assert.strictEqual(RATE_MIN, 1);
  for (const source of SOURCES) {
    const switchFor = motion.fields.find((f) => f.key === source.key);
    assert.ok(switchFor && switchFor.type === "checkbox", source.id);
    assert.ok(switchFor.hint.includes("Message/" + source.id), "the hint says where it goes");
    assert.ok(Object.prototype.hasOwnProperty.call(motion.defaults, source.key));
  }
  assert.ok(!motion.checks.source, "Source is no longer a setting");
  assert.ok(!motion.checks.oscListenFrom, "no Data in on this widget, so no check for its From");
});

test("what the box shows comes back after the host rewrites the element", () => {
  const phone = fakePhone();
  const { el, ctx, detach } = mountWith(phone);
  const before = el.snapshot();
  el.wipe();
  ctx.rewrite();
  assert.strictEqual(el.snapshot(), before);
  detach();
});
