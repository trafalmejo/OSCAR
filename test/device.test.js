"use strict";

/**
 * The phone as a browser offers it (public/src/device.js), with a window
 * that fires what the test says.
 */

const test = require("node:test");
const assert = require("node:assert");

const { browserDevice } = require("../public/src/device");

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
  if (!options || options.sensors !== false) {
    win.DeviceMotionEvent = function () {};
    win.DeviceOrientationEvent = function () {};
    if (options && options.ios) {
      win.DeviceMotionEvent.requestPermission = async () => options.answer || "granted";
      win.DeviceOrientationEvent.requestPermission = async () => options.answer || "granted";
    }
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
