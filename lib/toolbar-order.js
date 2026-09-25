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
  // The screen sizes cross to the right half of the bar, one pill just left
  // of the tools (the editor moves them into this panel and wraps them;
  // here is only their order: first, ahead of everything).
  { id: "set-device-desktop", before: "sw-visibility" },
  { id: "set-device-tablet", after: "set-device-desktop" },
  { id: "set-device-mobile", after: "set-device-tablet" },
  // The LIVE and MCP pills lead the right half, ahead of the sizes: the
  // show's state first, then the widths, then the tools.
  { id: "oscar-live-pill", before: "set-device-desktop" },
  { id: "oscar-mcp-pill", after: "oscar-live-pill" },
  // Locking is what you do once a surface is pushed and the doors are about
  // to open, so it belongs beside the button that pushes it.
  { id: "toggle-lock", after: "preview" },
  // Pages and the widget style are both about the surface as a whole, not
  // about getting a project in or out.
  { id: "open-pages", after: "open-styles" },
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
