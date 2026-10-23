"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { motion, SOURCES, RATE_MIN, RATE_MAX } = require("../../lib/widgets/motion");
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
    report(reading) {
      phone.watching.filter((w) => !w.stopped).forEach((w) => w.fn(reading));
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

test("on a laptop the box says to open it on a phone, and sends nothing", () => {
  const { el, ctx, detach } = mountWith(null);
  assert.strictEqual(el.textContent, "Motion · open on a phone");
  assert.strictEqual(el.getAttribute("data-motion"), "phone");
  assert.deepStrictEqual(ctx.sent, []);
  detach();
});

test("on a phone the sensor is watched at once, and readings go out as three floats at the rate asked for", async () => {
  const phone = fakePhone();
  const { el, ctx, detach } = mountWith(phone, { rate: 50, source: "acceleration", message: "/tilt", ip: "10.0.0.7", port: 9000 });
  assert.strictEqual(phone.watching.length, 1);
  assert.strictEqual(phone.watching[0].kind, "acceleration");
  assert.strictEqual(el.getAttribute("data-motion"), "waiting");

  phone.report({ x: 0.12345, y: -1, z: 9.81 });
  assert.strictEqual(el.getAttribute("data-motion"), "live");
  assert.deepStrictEqual(ctx.sent, [], "not on the reading itself: the ticker sends");
  await tick(40);
  assert.strictEqual(ctx.sent.length, 1);
  assert.deepStrictEqual(ctx.sent[0], {
    ip: "10.0.0.7",
    port: 9000,
    address: "/tilt",
    args: [
      { type: "f", value: 0.123 },
      { type: "f", value: -1 },
      { type: "f", value: 9.81 },
    ],
  });
  assert.strictEqual(el.textContent, "Motion · 0.12  -1.00  9.81");
  // The same reading again is not news; a new one is.
  await tick(40);
  assert.strictEqual(ctx.sent.length, 1);
  phone.report({ x: 0.2, y: -1, z: 9.81 });
  await tick(40);
  assert.strictEqual(ctx.sent.length, 2);
  assert.deepStrictEqual(ctx.shared, [], "a phone's own reading is never shared with the other devices");

  detach();
  assert.strictEqual(phone.watching[0].stopped, true, "detached: the sensor is let go");
  phone.report({ x: 1, y: 1, z: 1 });
  await tick(40);
  assert.strictEqual(ctx.sent.length, 2);
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

test("changing the source watches the new one and lets go of the old; a disabled widget keeps reading and sends nothing", async () => {
  const phone = fakePhone();
  const { ctx, detach } = mountWith(phone, { rate: 50 });
  ctx.edit("source", "rotation");
  assert.strictEqual(phone.watching[0].stopped, true);
  assert.strictEqual(phone.watching[1].kind, "rotation");
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

test("the settings panel refuses a rate or a source a phone cannot give", () => {
  assert.strictEqual(motion.checks.rate(20), null);
  assert.match(motion.checks.rate(0), /between/);
  assert.match(motion.checks.rate(RATE_MAX + 1), /between/);
  assert.match(motion.checks.rate("fast"), /between/);
  assert.strictEqual(RATE_MIN, 1);
  for (const source of SOURCES) assert.strictEqual(motion.checks.source(source.id), null);
  assert.match(motion.checks.source("gps"), /readings/);
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
