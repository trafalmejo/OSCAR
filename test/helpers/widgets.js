"use strict";

/**
 * The few lines every widget test starts with.
 *
 * Each widget has its own file under test/widgets/, so two people adding
 * widgets never edit the same test file; this is what keeps those files short.
 */

const { fakeElement, fakeWindow, fakeContext } = require("./fake-dom");

/**
 * Wire a widget to a fake element with its defaults, overridden by `overrides`.
 *
 * `overrides.rect` is the element's box, for widgets that read pointer
 * positions; everything else is a setting. Returns { el, ctx, detach, rewrite }:
 * `el.fire(type, event)` delivers an event, `ctx.sent` is the wire traffic,
 * `ctx.edit(key, value)` pretends someone changed a setting in the panel,
 * `ctx.receive(address, args)` pretends the rig sent a message (and throws if
 * the widget answers it with a send), `rewrite()` does what an editor does on
 * a class or style edit -- wipes the element and tells the widget -- and
 * `state()` is everything the widget has put on the element, so a test can
 * check it comes back.
 */
function mount(widget, overrides) {
  const options = Object.assign({}, overrides);
  const rect = options.rect;
  delete options.rect;

  const el = fakeElement(rect);
  const ctx = fakeContext(Object.assign({}, widget.defaults, options));
  const detach = widget.attach(el, ctx);
  const rewrite = () => {
    el.wipe();
    ctx.rewrite();
  };
  const state = () => {
    const classes = ctx.classes || {};
    const on = Object.keys(classes).filter((name) => classes[name]).sort();
    return el.snapshot() + JSON.stringify(on);
  };
  return { el, ctx, detach, rewrite, state };
}

/** The values of the last message sent, or undefined when nothing was. */
function lastArgs(ctx) {
  const last = ctx.sent[ctx.sent.length - 1];
  return last && last.args;
}

/**
 * Run `fn(win)` with a fake `window` installed, so a widget mounted inside
 * can be alt-tabbed with `win.fire("blur")`. Restored afterwards, whatever
 * happens, so no other test sees a window.
 */
function withWindow(fn) {
  const win = fakeWindow();
  global.window = win;
  try {
    return fn(win);
  } finally {
    delete global.window;
  }
}

module.exports = { mount, lastArgs, withWindow };
