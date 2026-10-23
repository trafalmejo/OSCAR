"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { feedback, FLASH_CLASS } = require("../../lib/widgets/feedback");
const { fakeElement, fakeContext } = require("../helpers/fake-dom");

function fakePhone(options) {
  const phone = { vibrated: [], torched: [] };
  if (!options || options.vibrate !== false) phone.vibrate = (ms) => phone.vibrated.push(ms) && true;
  if (!options || options.torch !== false) phone.torch = async (on) => phone.torched.push(on);
  return phone;
}

function mountWith(phone, overrides) {
  const el = fakeElement();
  const ctx = fakeContext(Object.assign({}, feedback.defaults, overrides));
  if (phone) ctx.device = phone;
  const detach = feedback.attach(el, ctx);
  return { el, ctx, detach };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test("a message at its address vibrates the phone and flashes the box; nothing goes back out", async () => {
  const phone = fakePhone();
  const { el, ctx, detach } = mountWith(phone, { message: "/cue", vibrateMs: 150, flashMs: 20 });
  assert.strictEqual(el.textContent, "Feedback · on /cue: vibrate, flash");
  assert.strictEqual(el.style.properties["--oscar-flash"], "#ff3663");

  ctx.receive("/cue", [1]);
  assert.deepStrictEqual(phone.vibrated, [150]);
  assert.strictEqual(ctx.classes[FLASH_CLASS], true);
  await tick(40);
  assert.strictEqual(ctx.classes[FLASH_CLASS], false, "the flash is over");
  assert.deepStrictEqual(ctx.sent, []);
  assert.deepStrictEqual(ctx.shared, []);

  // A bare message is go; zero is not.
  ctx.receive("/cue", []);
  assert.deepStrictEqual(phone.vibrated, [150, 150]);
  ctx.receive("/cue", [0]);
  assert.deepStrictEqual(phone.vibrated, [150, 150]);
  ctx.receive("/elsewhere", [1]);
  assert.deepStrictEqual(phone.vibrated, [150, 150], "another address is not its business");
  detach();
});

test("the torch follows the value: on above zero, off at zero, and off again when the page goes", async () => {
  const phone = fakePhone();
  const { ctx, detach } = mountWith(phone, { torch: true, vibrate: false, flash: false });
  ctx.receive("/feedback", [1]);
  ctx.receive("/feedback", [1]);
  assert.deepStrictEqual(phone.torched, [true], "said once, not on every message");
  ctx.receive("/feedback", [0]);
  assert.deepStrictEqual(phone.torched, [true, false]);
  ctx.receive("/feedback", [0.5]);
  detach();
  assert.deepStrictEqual(phone.torched, [true, false, true, false], "a torch left on by a page that is gone would stay on");
});

test("on a page OSCAR serves, the cue arrives as a state: each new one acts once, the same one again does not, and the one from before the page opened never", () => {
  const phone = fakePhone();
  const el = fakeElement();
  const ctx = fakeContext(Object.assign({}, feedback.defaults, { flash: false }));
  ctx.device = phone;
  ctx.followed = true;
  // The host hands the state already known over as the widget subscribes.
  const subscribe = ctx.onShared.bind(ctx);
  ctx.onShared = (fn) => {
    const stop = subscribe(fn);
    fn({ value: 1, at: 1000 });
    return stop;
  };
  const detach = feedback.attach(el, ctx);
  assert.deepStrictEqual(phone.vibrated, [], "a cue from before this page opened is not a cue for it");

  ctx.receiveShared({ value: 1, at: 2000 });
  assert.deepStrictEqual(phone.vibrated, [200]);
  ctx.receiveShared({ value: 1, at: 2000 });
  assert.deepStrictEqual(phone.vibrated, [200], "the snapshot after a reconnect: the same cue, not a new one");
  ctx.receiveShared({ value: 1, at: 3000 });
  assert.deepStrictEqual(phone.vibrated, [200, 200], "the same value again is a second cue");
  ctx.receiveShared({ value: 0, at: 4000 });
  assert.deepStrictEqual(phone.vibrated, [200, 200]);
  // With OSCAR hearing for it, the page's own ear is shut: no double buzz.
  ctx.receive("/feedback", [1]);
  assert.deepStrictEqual(phone.vibrated, [200, 200]);
  detach();
});

test("on a page that reads the rig itself, a state from another device is not a second ear", () => {
  const phone = fakePhone();
  const { ctx, detach } = mountWith(phone, { flash: false });
  ctx.receiveShared({ value: 1, at: 5000 });
  assert.deepStrictEqual(phone.vibrated, []);
  ctx.receive("/feedback", [1]);
  assert.deepStrictEqual(phone.vibrated, [200]);
  detach();
});

test("hear() is what OSCAR follows the rig with for the pages it serves: the value, and when, so every cue is news", () => {
  const before = Date.now();
  const heard = feedback.hear(feedback.defaults, [1]);
  assert.strictEqual(heard.value, 1);
  assert.ok(typeof heard.at === "number" && heard.at >= before);
  assert.strictEqual(feedback.hear(feedback.defaults, []).value, 1, "a bare message is go");
  assert.strictEqual(feedback.hear(feedback.defaults, [0]).value, 0);
  assert.strictEqual(feedback.hear(feedback.defaults, ["loud"]), null);
});

test("where the host cannot give what is asked for, the box says so and still flashes", () => {
  const { el, ctx, detach } = mountWith(null, { torch: true, flashMs: 5000 });
  assert.strictEqual(el.textContent, "Feedback · on /feedback: flash · needs the app for vibration and torch");
  ctx.receive("/feedback", [1]);
  assert.strictEqual(ctx.classes[FLASH_CLASS], true);
  ctx.edit("torch", false);
  ctx.edit("vibrate", false);
  assert.strictEqual(el.textContent, "Feedback · on /feedback: flash");
  ctx.edit("message", "/cue");
  ctx.edit("flash", false);
  assert.strictEqual(el.textContent, "Feedback · on /cue: nothing");
  const browser = fakePhone({ torch: false });
  const second = mountWith(browser, { torch: true, label: "Lights", message: "/go" });
  assert.strictEqual(second.el.textContent, "Lights · on /go: vibrate, flash · needs the app for torch");
  const app = mountWith(fakePhone(), { torch: true, label: "" });
  assert.strictEqual(app.el.textContent, "on /feedback: vibrate, flash, torch");
  app.detach();
  second.detach();
  detach();
});

test("Enabled off, or Listen off, makes it deaf", () => {
  const phone = fakePhone();
  const off = mountWith(phone, { enabled: false });
  off.ctx.receive("/feedback", [1]);
  const deaf = mountWith(phone, { listen: false });
  deaf.ctx.receive("/feedback", [1]);
  assert.deepStrictEqual(phone.vibrated, []);
  off.detach();
  deaf.detach();
});

test("the settings panel refuses a flash or a vibration that is not a time, and a colour that is a rule", () => {
  assert.strictEqual(feedback.checks.flashMs(300), null);
  assert.match(feedback.checks.flashMs(0), /between/);
  assert.match(feedback.checks.vibrateMs(99999), /between/);
  assert.strictEqual(feedback.checks.flashColour("red"), null);
  assert.strictEqual(feedback.checks.flashColour("#ff3663"), null);
  assert.match(feedback.checks.flashColour(""), /colour/);
  assert.match(feedback.checks.flashColour("red; background: url(x)"), /rule/);
});

test("the colour and the words come back after the host rewrites the element", () => {
  const { el, ctx, detach } = mountWith(fakePhone(), { flashColour: "gold" });
  const before = el.snapshot();
  el.wipe();
  ctx.rewrite();
  assert.strictEqual(el.snapshot(), before);
  assert.strictEqual(el.style.properties["--oscar-flash"], "gold");
  detach();
});
