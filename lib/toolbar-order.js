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
  // (The screen sizes are not here: they have a panel of their own, centred
  // over the canvas.)
  // The LIVE and MCP pills lead the right half: the show's state first, then
  // the tools.
  { id: "oscar-live-pill", before: "preview" },
  { id: "oscar-mcp-pill", after: "oscar-live-pill" },
  // Locking is what you do once a surface is pushed and the doors are about
  // to open, so it belongs beside the button that pushes it.
  { id: "toggle-lock", after: "preview" },
  // Pages is about the surface as a whole, beside the lock. (The widget
  // style, which it once sat beside, lives under Edit now.)
  { id: "open-pages", after: "toggle-lock" },
  // A project's way in and out lives under File at the bar's left edge;
  // Publish keeps its own seat, added late enough to land before About.
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

/** As moveAfter, in the other direction: `id` moved to sit straight before `before`. */
function moveBefore(ids, id, before) {
  const order = Array.isArray(ids) ? ids.slice() : [];
  if (id === before || order.indexOf(id) === -1 || order.indexOf(before) === -1) return order;
  order.splice(order.indexOf(id), 1);
  order.splice(order.indexOf(before), 0, id);
  return order;
}

/** The order after every placement has been applied, first to last. */
function arrange(ids, placements) {
  return (placements || PLACEMENTS).reduce(
    (order, p) => (p.before ? moveBefore(order, p.id, p.before) : moveAfter(order, p.id, p.after)),
    Array.isArray(ids) ? ids.slice() : []
  );
}

module.exports = { PLACEMENTS, moveAfter, moveBefore, arrange };
