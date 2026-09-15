"use strict";

const { outgoing } = require("./outgoing");

/**
 * When a value goes on the wire, and the ctx -> config bridge every widget needs.
 *
 * outgoing.js decides *what* a message contains; this decides *when* one is
 * produced at all. The two are separate because the answer differs per widget:
 * a pad streams while a finger moves, a typed field must not.
 */

/** The settings every widget sends with, read off ctx in one place. */
function config(ctx, overrides) {
  return Object.assign(
    {
      enabled: ctx.get("enabled"),
      ip: ctx.get("ip"),
      port: ctx.get("port"),
      message: ctx.get("message"),
      argType: ctx.get("argType"),
    },
    overrides || {}
  );
}

/** The message a widget's current settings would send for `raw`, or null. */
function message(ctx, raw, overrides) {
  return outgoing(config(ctx, overrides), raw);
}

/**
 * Send a typed field on commit, never on keystroke.
 *
 * Typing "12.5" into a box would otherwise put /level 1, /level 12, /level 12.5
 * on the wire -- three cues where one was meant, and the intermediate 1 is a
 * real value a rig will act on. Worse, a held backspace floods the network.
 *
 * So: Enter commits, and so does leaving the field (the browser's `change`,
 * which fires on blur only when the text actually differs, and also covers a
 * number box's stepper arrows). Enter always fires even when nothing changed,
 * because re-sending the same cue on purpose is a normal thing to want; the
 * `last` guard exists only so that the `change` a browser fires immediately
 * after Enter is not counted a second time.
 *
 * `send` returns the value that was actually committed -- a number box clamps,
 * so what it sent is not always what was typed -- or nothing to accept the
 * value as given.
 */
function commit(el, send) {
  let last = el.value;

  function fire(force) {
    const value = el.value;
    if (!force && value === last) return;
    const committed = send(value);
    last = committed === undefined ? value : committed;
  }

  function onKeyDown(e) {
    if (e.key !== "Enter") return;
    // Inside a form this would submit and reload the surface mid-show.
    if (e.preventDefault) e.preventDefault();
    fire(true);
  }

  function onChange() {
    fire(false);
  }

  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("change", onChange);

  return function detach() {
    el.removeEventListener("keydown", onKeyDown);
    el.removeEventListener("change", onChange);
  };
}

/**
 * One send per animation frame, for a control that streams while it is dragged.
 *
 * `push` schedules, `flush` sends the pending value immediately -- the last
 * value of a drag must be exact, not one frame short of where the hand
 * stopped. Where there are no frames (outside a browser) every push sends,
 * which is what a test wants anyway.
 */
function coalesce(send) {
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
  const cancelRaf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : null;

  let frame = null;
  let pending = null;
  let waiting = false;

  function flush() {
    if (frame && cancelRaf) {
      cancelRaf(frame);
      frame = null;
    }
    if (!waiting) return;
    const value = pending;
    waiting = false;
    pending = null;
    send(value);
  }

  return {
    push: function (value) {
      pending = value;
      waiting = true;
      if (!raf) return flush();
      if (frame) return;
      frame = raf(function () {
        frame = null;
        flush();
      });
    },
    flush: flush,
    stop: function () {
      if (frame && cancelRaf) cancelRaf(frame);
      frame = null;
      waiting = false;
    },
  };
}

module.exports = { config, message, commit, coalesce };
