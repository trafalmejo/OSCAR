"use strict";

/**
 * Reading the widgets out of a project as OSCAR keeps it: the editor's own
 * component tree, not HTML. A published interface is read from its page
 * (lib/surfaces.js allWidgetsIn); a project that was never published has no
 * page, and an assistant asked "what is wrong with my project" needs it all
 * the same.
 *
 * A widget in the tree is a component whose type is the widget's name, with
 * its settings as plain properties beside it and its id among its attributes.
 * A setting that was never touched is absent, and reads as the default.
 */

const { byName } = require("../widgets");

/** The settings a widget has: its defaults', and its panel's. */
function keysOf(definition) {
  const keys = new Set(Object.keys(definition.defaults || {}));
  for (const field of definition.fields || []) keys.add(field.key);
  return [...keys];
}

/**
 * @param {object} data a project's data, as the editor saves it
 * @returns {{ id, widget, page, config }[]} in document order
 */
function widgetsInProject(data) {
  const found = [];
  const pages = data && Array.isArray(data.pages) ? data.pages : [];

  pages.forEach((page, index) => {
    const pageName = (page && typeof page.name === "string" && page.name) || "Page " + (index + 1);
    const walk = (component) => {
      if (!component || typeof component !== "object") return;
      const definition = typeof component.type === "string" ? byName[component.type] : null;
      if (definition) {
        const config = {};
        for (const key of keysOf(definition)) {
          config[key] = Object.prototype.hasOwnProperty.call(component, key) ? component[key] : (definition.defaults || {})[key];
        }
        found.push({
          id: (component.attributes && component.attributes.id) || null,
          widget: definition.name,
          page: pageName,
          config,
        });
      }
      if (Array.isArray(component.components)) component.components.forEach(walk);
    };
    for (const frame of (page && page.frames) || []) walk(frame && frame.component);
    // Some projects carry the component directly on the page.
    if (page && page.component) walk(page.component);
  });

  return found;
}

module.exports = { widgetsInProject };
