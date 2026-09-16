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
 *   goes nowhere.)
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
    // Inside a form, Enter would submit and reload the surface mid-show.
    if (e.preventDefault) e.preventDefault();
    commit(true);
  }

  function onChange() {
    commit(false);
  }

  function onInput() {
    if (held) commit(true);
    else dirty = true;
  }

  function onBlur() {
    // `change` has already fired for a real edit; whatever is left in the
    // box was walked away from, and the field is nobody's any more.
    dirty = false;
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
    },
  };
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
 * unit a lighting operator types in anyway. Out of range pins at the end, as
 * a fixture would; unreadable stays null and nothing is sent.
 */
function levelOf(value, min, max) {
  const lo = toNumber(min);
  const hi = toNumber(max);
  if (lo !== null && hi !== null) return unitOf(value, lo, hi);
  return unitOf(value, 0, MAX_LEVEL);
}

module.exports = { commitOn, refusal, checkArgType, levelOf };
