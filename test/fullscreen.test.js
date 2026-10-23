"use strict";

/**
 * The full-screen button a phone is offered (public/src/adapters/fullscreen.js).
 */

const test = require("node:test");
const assert = require("node:assert");

const { offerFullscreen, isStandalone, RESTING_MS } = require("../public/src/adapters/fullscreen");
const { fakeElement } = require("./helpers/fake-dom");

/** A document on a phone's browser: full screen allowed, nothing in it yet. */
function phoneDocument(overrides) {
  const listeners = {};
  const asked = [];
  const body = { children: [], appendChild: (el) => body.children.push(el) };
  const doc = Object.assign(
    {
      body,
      fullscreenEnabled: true,
      fullscreenElement: null,
      documentElement: {
        requestFullscreen() {
          asked.push("request");
          return Promise.resolve();
        },
      },
      createElement: () => {
        const el = fakeElement();
        el.parentNode = { removeChild: () => body.children.splice(body.children.indexOf(el), 1) };
        return el;
      },
      addEventListener(type, fn) {
        (listeners[type] = listeners[type] || []).push(fn);
      },
      removeEventListener(type, fn) {
        listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
      },
      fire(type) {
        for (const fn of listeners[type] || []) fn({});
      },
      asked,
    },
    overrides || {}
  );
  return doc;
}

function phoneWindow(queries) {
  return {
    navigator: {},
    matchMedia: (query) => ({ matches: !!(queries || {})[query] }),
  };
}

const TOUCH = { "(pointer: coarse)": true };

test("a phone's browser is offered full screen from a tap, and the button goes while it is in it", () => {
  const timers = [];
  const doc = phoneDocument();
  const offered = offerFullscreen(doc, phoneWindow(TOUCH), { setTimeout: (fn) => timers.push(fn) });
  assert.ok(offered, "offered");
  const button = offered.element;
  assert.strictEqual(doc.body.children[0], button);
  assert.strictEqual(button.getAttribute("data-oscar-fullscreen"), "");
  assert.strictEqual(button.getAttribute("type"), "button", "never a submit");
  assert.match(button.getAttribute("style"), /position:fixed/);
  assert.match(button.getAttribute("style"), /left:8px;bottom:8px/, "a corner, under nothing");

  button.fire("click");
  assert.deepStrictEqual(doc.asked, ["request"]);

  doc.fullscreenElement = doc.documentElement;
  doc.fire("fullscreenchange");
  assert.match(button.getAttribute("style"), /display:none/, "nothing to offer in full screen");
  doc.fullscreenElement = null;
  doc.fire("fullscreenchange");
  assert.doesNotMatch(button.getAttribute("style"), /display:none/, "back when the person leaves it");

  // Left alone it dims, so a control under the corner can still be read; it never goes.
  assert.strictEqual(timers.length, 1);
  timers[0]();
  assert.match(button.getAttribute("style"), /opacity:\.45/);

  offered.remove();
  assert.deepStrictEqual(doc.body.children, []);
});

test("it is not offered where it has nothing to offer", () => {
  const win = phoneWindow(TOUCH);
  // A laptop: a mouse, F11, and a window that is not in the way.
  assert.strictEqual(offerFullscreen(phoneDocument(), phoneWindow({})), null);
  // Opened from the home screen: no browser around the page to hide.
  assert.strictEqual(offerFullscreen(phoneDocument(), phoneWindow(Object.assign({ "(display-mode: standalone)": true }, TOUCH))), null);
  assert.strictEqual(offerFullscreen(phoneDocument(), Object.assign(phoneWindow(TOUCH), { navigator: { standalone: true } })), null, "iOS's word for it");
  // Safari on an iPhone: no page may fill the screen.
  assert.strictEqual(offerFullscreen(phoneDocument({ fullscreenEnabled: false }), win), null);
  assert.strictEqual(offerFullscreen(phoneDocument({ documentElement: {} }), win), null);
  // No window at all, as a test starts the page.
  assert.strictEqual(offerFullscreen(phoneDocument(), undefined), null);
});

test("Safari's older spelling is read too", () => {
  const asked = [];
  const doc = phoneDocument({
    fullscreenEnabled: undefined,
    webkitFullscreenEnabled: true,
    documentElement: { webkitRequestFullscreen: () => asked.push("webkit") },
  });
  const offered = offerFullscreen(doc, phoneWindow(TOUCH), { setTimeout: () => {} });
  assert.ok(offered);
  offered.element.fire("click");
  assert.deepStrictEqual(asked, ["webkit"]);
  doc.webkitFullscreenElement = doc.documentElement;
  doc.fire("webkitfullscreenchange");
  assert.match(offered.element.getAttribute("style"), /display:none/);
});

test("a request the browser refuses leaves the button where it was", () => {
  const doc = phoneDocument({
    documentElement: {
      requestFullscreen() {
        return Promise.reject(new Error("not from a gesture"));
      },
    },
  });
  const offered = offerFullscreen(doc, phoneWindow(TOUCH), { setTimeout: () => {} });
  offered.element.fire("click");
  const throwing = phoneDocument({
    documentElement: {
      requestFullscreen() {
        throw new Error("no");
      },
    },
  });
  offerFullscreen(throwing, phoneWindow(TOUCH), { setTimeout: () => {} }).element.fire("click");
  assert.strictEqual(doc.body.children.length, 1);
});

test("standalone is either of the two ways a phone says it", () => {
  assert.strictEqual(isStandalone({ navigator: { standalone: true } }), true);
  assert.strictEqual(isStandalone(phoneWindow({ "(display-mode: fullscreen)": true })), true);
  assert.strictEqual(isStandalone(phoneWindow({})), false);
  assert.strictEqual(isStandalone(undefined), false);
  assert.ok(RESTING_MS >= 3000, "long enough to be seen first");
});
