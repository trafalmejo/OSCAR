"use strict";

/**
 * Where the editor's toolbar buttons sit, as plain data.
 *
 * GrapesJS appends every button to the end of its panel and offers no way to
 * say where one goes, so OSCAR's buttons land in the order its scripts happen
 * to add them. The order that makes sense to a person is stated here instead,
 * and applied once every button exists.
 *
 * Each entry reads "put this button straight after that one".
 */
const PLACEMENTS = [
  // Locking is what you do once a surface is pushed and the doors are about
  // to open, so it belongs beside the button that pushes it.
  { id: "toggle-lock", after: "preview" },
  // Pages and the widget style are both about the surface as a whole, not
  // about getting a project in or out.
  { id: "open-pages", after: "open-styles" },
  // A project's way in and out, in the order they are reached for: Load,
  // Save, then Import (code in, arrow down) and Publish (the surface out,
  // arrow up), side by side.
  { id: "open-save", after: "open-load" },
  { id: "gjs-open-import-webpage", after: "open-save" },
  { id: "oscar-export", after: "gjs-open-import-webpage" },
];

/**
 * `ids` with `id` moved to sit straight after `after`. A button that is not
 * there -- a panel that failed to load, a renamed command -- leaves the order
 * as it was rather than throwing: a toolbar in the old order still works.
 */
function moveAfter(ids, id, after) {
  const order = Array.isArray(ids) ? ids.slice() : [];
  if (id === after || order.indexOf(id) === -1 || order.indexOf(after) === -1) return order;
  order.splice(order.indexOf(id), 1);
  order.splice(order.indexOf(after) + 1, 0, id);
  return order;
}

/** The order after every placement has been applied, first to last. */
function arrange(ids, placements) {
  return (placements || PLACEMENTS).reduce((order, p) => moveAfter(order, p.id, p.after), Array.isArray(ids) ? ids.slice() : []);
}

module.exports = { PLACEMENTS, moveAfter, arrange };
