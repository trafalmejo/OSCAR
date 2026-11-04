"use strict";

/**
 * The phone as a browser offers it (public/src/device.js), with a window
 * that fires what the test says.
 */

const test = require("node:test");
const assert = require("node:assert");

const { browserDevice, formFactor } = require("../public/src/device");

function fakeWindow(options) {
  const listeners = {};
  const win = {
    navigator: options && options.vibrate ? { vibrate: (ms) => (win.vibrated.push(ms), true) } : {},
    vibrated: [],
    addEventListener: (type, fn) => (listeners[type] = listeners[type] || []).push(fn),
    removeEventListener: (type, fn) => (listeners[type] = (listeners[type] || []).filter((f) => f !== fn)),
    fire: (type, event) => (listeners[type] || []).forEach((fn) => fn(event)),
    count: (type) => (listeners[type] || []).length,
  };
  if (options && options.absolute) win.ondeviceorientationabsolute = null;
  if (!options || options.sensors !== false) {
    win.DeviceMotionEvent = function () {};
    win.DeviceOrientationEvent = function () {};
    if (options && (options.ios || options.chromium)) {
      win.DeviceMotionEvent.requestPermission = async () => options.answer || "granted";
      win.DeviceOrientationEvent.requestPermission = async () => options.answer || "granted";
    }
    win.navigator.userAgent = options && options.ios ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" : "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 Chrome/155.0.0.0 Mobile";
  }
  return win;
}

test("each kind of reading is taken from the event that carries it, as x, y, z", () => {
  const win = fakeWindow();
  const device = browserDevice(win);
  const heard = {};
  const stops = ["orientation", "acceleration", "gravity", "rotation"].map((kind) => device.motion.watch(kind, (r) => (heard[kind] = r)));
  win.fire("deviceorientation", { alpha: 10, beta: 20, gamma: 30 });
  win.fire("devicemotion", {
    acceleration: { x: 1, y: 2, z: 3 },
    accelerationIncludingGravity: { x: 1, y: 2, z: 12.8 },
    rotationRate: { alpha: 4, beta: 5, gamma: 6 },
  });
  assert.deepStrictEqual(heard, {
    orientation: { x: 10, y: 20, z: 30 },
    acceleration: { x: 1, y: 2, z: 3 },
    gravity: { x: 1, y: 2, z: 12.8 },
    rotation: { x: 4, y: 5, z: 6 },
  });
  // The compass: iOS says the heading, Android gives an absolute alpha the other way round.
  const stopHeading = device.motion.watch("heading", (r) => (heard.heading = r));
  win.fire("deviceorientation", { alpha: 10, beta: 20, gamma: 30, webkitCompassHeading: 123.5 });
  assert.deepStrictEqual(heard.heading, { x: 123.5 }, "an iPhone");
  win.fire("deviceorientation", { alpha: 10, beta: 20, gamma: 30 });
  assert.deepStrictEqual(heard.heading, { x: 123.5 }, "a relative alpha is not a heading");
  const android = fakeWindow({ absolute: true });
  const compass = browserDevice(android);
  let bearing = null;
  compass.motion.watch("heading", (r) => (bearing = r));
  assert.strictEqual(android.count("deviceorientationabsolute"), 1, "Android's own event");
  android.fire("deviceorientationabsolute", { absolute: true, alpha: 90, beta: 0, gamma: 0 });
  assert.deepStrictEqual(bearing, { x: 270 });
  stopHeading();
  // A sensor the phone has not got reports nulls: not a reading.
  delete heard.acceleration;
  win.fire("devicemotion", { acceleration: { x: null, y: null, z: null }, rotationRate: null });
  assert.strictEqual(heard.acceleration, undefined);
  stops.forEach((stop) => stop());
  assert.strictEqual(win.count("devicemotion") + win.count("deviceorientation"), 0);
});

test("Android: no tap needed; iPhone: a tap, answered through the event class", async () => {
  const android = browserDevice(fakeWindow());
  assert.strictEqual(android.motion.needsTap(), false);
  assert.strictEqual(await android.motion.ask(), true);
  // Chrome 155 on a Pixel 9 offers requestPermission too, and answers without a tap.
  const chromium = browserDevice(fakeWindow({ chromium: true }));
  assert.strictEqual(chromium.motion.needsTap(), false, "the function alone is not a reason to ask");

  const iphone = browserDevice(fakeWindow({ ios: true }));
  assert.strictEqual(iphone.motion.needsTap(), true);
  assert.strictEqual(await iphone.motion.ask(), true);
  assert.strictEqual(iphone.motion.needsTap(), false, "once allowed, allowed");

  const refused = browserDevice(fakeWindow({ ios: true, answer: "denied" }));
  assert.strictEqual(await refused.motion.ask(), false);
  assert.strictEqual(refused.motion.needsTap(), true);
});

test("vibration where the browser has it, the torch nowhere, and nothing without a window", () => {
  const win = fakeWindow({ vibrate: true });
  const device = browserDevice(win);
  assert.strictEqual(device.vibrate(120), true);
  assert.deepStrictEqual(win.vibrated, [120]);
  assert.strictEqual(browserDevice(fakeWindow()).vibrate(120), false, "an iPhone's Safari");
  assert.strictEqual(device.torch(true), false);
  assert.strictEqual(browserDevice(undefined), null);
  assert.strictEqual(browserDevice(fakeWindow({ sensors: false })).motion.watch("orientation", () => {}), null, "a laptop: nothing to watch");
});

test("a device's shape is judged from touch and the shorter side of the screen, never the user agent", () => {
  const shaped = (touch, width, height, agent) => ({ navigator: { maxTouchPoints: touch, userAgent: agent || "" }, screen: { width, height } });
  assert.strictEqual(formFactor(shaped(5, 393, 852)), "phone", "an iPhone");
  assert.strictEqual(formFactor(shaped(5, 412, 915)), "phone", "an Android phone: CSS pixels, not the panel's 1080");
  assert.strictEqual(formFactor(shaped(5, 820, 1180, "Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari")), "tablet", "an iPad, whatever it calls itself");
  assert.strictEqual(formFactor(shaped(10, 1280, 800)), "tablet", "an Android tablet, landscape");
  assert.strictEqual(formFactor(shaped(0, 1920, 1080)), "desktop", "a laptop");
  assert.strictEqual(formFactor(shaped(10, 2560, 1440)), "tablet", "a touch laptop is counted as a tablet: coarse on purpose");
  assert.strictEqual(formFactor({ navigator: { maxTouchPoints: 5 }, screen: {} }), "tablet", "touch with no screen size is not a phone");
  assert.strictEqual(formFactor({ ontouchstart: null, navigator: {}, screen: { width: 400, height: 800 } }), "phone", "an old browser says touch another way");
  assert.strictEqual(formFactor(undefined), "desktop", "and nothing without a window");
});
