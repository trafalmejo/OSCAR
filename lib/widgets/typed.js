"use strict";

const { isSendable, toNumber } = require("../osc-args");
const { unitOf } = require("../dmx/levels");
const { MAX_LEVEL } = require("../dmx/spec");

/**
 * What the typed controls -- the text box, the number box and the dropdown --
 * have in common: when a typed value counts as finished, how a value is judged
 * against the argument type that will carry it, and what a bare number means
 * to a DMX channel.
 *
 * The button and the slider decide *when* to send from a gesture. A typed
 * field has no gesture, only keystrokes, and a keystroke is never a value:
 * typing 12.5 is 1, then 12, then 12.5, and the first two are real cues a rig
 * would act on. So nothing here sends per keystroke. A value is finished when
 * Enter is pressed, or when the field is left (the browser's `change`, which
 * fires on blur only if the text was actually edited). Enter sends even when
 * nothing changed, because re-sending a cue on purpose is a normal thing to
 * do; `change` sends only what differs from what the wire last saw, because
 * the browser fires it right after Enter as well, and that would put the
 * same cue out twice.
 */

/**
 * Wire a field up to send when its value is finished.
 *
 *   const entry = commitOn(el, function (value) { ... });
 *   ... in detach:  entry.detach();
 *
 * `send` is given the field's text. It parses, refuses, sends, and stores;
 * this only decides that the moment has come.
 *
 * Two more rules ride along, both about the difference between typing and
 * everything else:
 *
 *   An `input` event that arrives while the pointer is held on the control is
 *   not typing -- a hand cannot hold a mouse button on a field and type into
 *   it -- it is a click on a number box's stepper arrow, and one step is a
 *   finished value, exactly as one notch on a slider is. It is sent at once.
 *   (Browsers also fire `change` for a step, which is then the same value and
 *   goes nowhere.) "Held" has to end wherever the button comes up: a press
 *   inside the box released outside it -- dragging to select the text -- puts
 *   no pointerup on the box, and a hold that outlives it turns every later
 *   keystroke into a cue. So the release is heard on the window, leaving the
 *   field ends it too, and an `input` that says it is an insertion or a
 *   deletion is typing whatever the pointer is doing.
 *
 *   A field that has been typed into since it last committed is being
 *   edited, and `editing()` says so; a widget that follows the rig leaves such
 *   a field alone, or an echo would overwrite half a number under the
 *   operator's fingers. Committing, or leaving the field, ends the edit.
 *
 * `show(text)` is how the widget itself puts a value in the box -- from the
 * settings or from the network -- so that text counts as already on the wire
 * and not as an edit in progress.
 */
function commitOn(el, send) {
  let last = el.value;
  let dirty = false;
  let held = false;

  function commit(force) {
    const value = el.value;
    dirty = false;
    if (!force && value === last) return;
    last = value;
    send(value);
  }

  function onKeyDown(e) {
    if (e.key !== "Enter") return;
    // The Enter that confirms an IME composition picks a candidate; it is
    // not the end of the value. (229 is how older engines report it.)
    if (e.isComposing || e.keyCode === 229) return;
    // Inside a form, Enter would submit and reload the surface mid-show.
    if (e.preventDefault) e.preventDefault();
    commit(true);
  }

  function onChange() {
    commit(false);
  }

  function onInput(e) {
    if (held && !isTyping(e)) commit(true);
    else dirty = true;
  }

  function onBlur() {
    // `change` has already fired for a real edit; whatever is left in the
    // box was walked away from, and the field is nobody's any more.
    dirty = false;
    held = false;
  }

  function hold() {
    held = true;
  }

  function release() {
    held = false;
  }

  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("change", onChange);
  el.addEventListener("input", onInput);
  el.addEventListener("blur", onBlur);
  el.addEventListener("pointerdown", hold);
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  // The element's own window where there is one: in an editor the canvas is
  // an iframe, and a release inside it never reaches the outer window.
  const root = (el.ownerDocument && el.ownerDocument.defaultView) || (typeof window === "undefined" ? null : window);
  if (root) {
    root.addEventListener("pointerup", release);
    root.addEventListener("pointercancel", release);
    root.addEventListener("blur", release);
  }

  return {
    editing: function () {
      return dirty;
    },
    show: function (text) {
      el.value = text;
      last = text;
      dirty = false;
    },
    detach: function () {
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("change", onChange);
      el.removeEventListener("input", onInput);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("pointerdown", hold);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
      if (root) {
        root.removeEventListener("pointerup", release);
        root.removeEventListener("pointercancel", release);
        root.removeEventListener("blur", release);
      }
    },
  };
}

/**
 * Does this `input` event say it came from the keyboard? A stepper click
 * reports no inputType, or a replacement; typing, pasting, deleting and undo
 * all report an insert*, delete* or history* one.
 */
function isTyping(e) {
  const kind = e && typeof e.inputType === "string" ? e.inputType : "";
  if (kind === "insertReplacementText") return false;
  return /^(insert|delete|history)/.test(kind);
}

/**
 * The complaint for a value the argument type cannot carry, or null.
 *
 * "abc" is perfectly good as a string and unsendable as a float. The same
 * refusal is raised from both ends: editing the value under a type, and
 * switching the type over a value -- the second is checkArgType below --
 * because a panel that only checks one of them lets "GO" sit in a box that
 * has just been switched to float, and the widget goes silently dead.
 */
function refusal(argType, value) {
  if (isSendable(argType, value)) return null;
  return 'The value "' + value + '" cannot be sent as ' + argType;
}

/**
 * A validator for the argType field: the new type has to be able to carry
 * whatever the widget already holds. `valuesOf(config)` lists those values.
 */
function checkArgType(valuesOf) {
  return function (argType, config) {
    for (const value of valuesOf(config || {})) {
      const complaint = refusal(argType, value);
      if (complaint) return complaint + "; change the value first";
    }
    return null;
  };
}

/**
 * What a typed number means to a DMX channel, as 0..1, or null.
 *
 * With Min and Max both set, the level is where the number sits between them,
 * as it is on a slider: a box that takes 0-100 puts 50 at half. With no range
 * to scale by, the number is taken as the level itself, 0-255, which is the
 * unit a lighting operator types in anyway.
 *
 * Out of range is null, not the nearest end. A slider pins because a hand
 * dragged past the end of the track means "all the way"; a typed -1 is a
 * slip of the finger, and pinning it to 0 is a blackout nobody asked for.
 * Unreadable stays null too, and nothing is sent.
 */
function levelOf(value, min, max) {
  const range = dmxRange(min, max);
  const number = toNumber(value);
  if (number === null || number < range.min || number > range.max) return null;
  return unitOf(number, range.min, range.max);
}

/**
 * The numbers a DMX channel can take from a typed control: Min to Max when
 * both are set, otherwise the raw level, 0-255.
 */
function dmxRange(min, max) {
  const lo = toNumber(min);
  const hi = toNumber(max);
  if (lo !== null && hi !== null) return { min: lo, max: hi };
  return { min: 0, max: MAX_LEVEL };
}

module.exports = { commitOn, refusal, checkArgType, levelOf, dmxRange };
