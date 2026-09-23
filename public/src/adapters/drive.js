"use strict";

/**
 * One control driving another on the same page: ctx.drive(id, state).
 *
 * A program key that puts the faders where a look wants them has to move
 * controls it did not attach. The host keeps a register of the live
 * controls, and drives one the way a hand would: the definition says what
 * the state does to it (definition.drive, the same word the server uses to
 * drive a published surface), the control is shown that state through the
 * listeners it registered with onShared, its message goes out through its
 * own send, and its state is shared so the other devices see it move.
 *
 * Shared between the exported page (adapters/standalone.js) and the editor's
 * canvas (adapters/grapesjs.js), which keep different kinds of register and
 * hand in what they have.
 */

/**
 * Put a control in the register, and give its ctx the two things this
 * needs: onShared that also keeps the listeners here, and drive.
 *
 * @param {object} register  id -> entry, the page's
 * @param {string|null} id   the control's id; one with none cannot be driven, but can drive
 * @param {object} ctx       the control's context, before attach
 * @param {object} definition
 * @param {Function} config  () => the control's settings as they stand
 */
function registerDrivable(register, id, ctx, definition, config) {
  var entry = { definition: definition, config: config, ctx: ctx, listeners: [] };
  var original = ctx.onShared;
  ctx.onShared = function (fn) {
    entry.listeners.push(fn);
    var stop = typeof original === "function" ? original(fn) : null;
    return function () {
      entry.listeners = entry.listeners.filter(function (other) {
        return other !== fn;
      });
      if (typeof stop === "function") stop();
    };
  };
  if (id) register[id] = entry;
  ctx.drive = function (targetId, state) {
    return driveOne(register, targetId, state);
  };
  return entry;
}

/** Drive one control of the register. Returns whether it was there and could take the state. */
function driveOne(register, id, state) {
  var target = register[id];
  if (!target || !target.definition || typeof target.definition.drive !== "function") return false;
  var out = null;
  try {
    out = target.definition.drive(target.config(), state);
  } catch (err) {
    return false;
  }
  if (!out) return false;
  target.listeners.forEach(function (fn) {
    try {
      fn(out.state);
    } catch (err) {
      /* one listener failing does not stop the rest */
    }
  });
  if (out.message && typeof target.ctx.send === "function") target.ctx.send(out.message);
  if (typeof target.ctx.share === "function") target.ctx.share(out.state);
  return true;
}

module.exports = { registerDrivable: registerDrivable, driveOne: driveOne };
