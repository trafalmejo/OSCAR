"use strict";

/**
 * A widget's settings, written onto exported markup and read back off it.
 *
 * Inside the editor every setting is a component property and deliberately not
 * an HTML attribute -- public/src/adapters/grapesjs.js explains why: an
 * attribute is a second copy of the truth that goes stale the moment someone
 * edits the panel, and it would be saved into every project file.
 *
 * That leaves exported markup saying `<input type="range">` and nothing about
 * where it should send, which is why an exported page never worked. So the
 * settings are attached to the elements here, at export time and only there,
 * and read back by the standalone runtime. Nothing written by this module is
 * ever stored in a project.
 *
 * Nothing here touches a DOM: `readWidget` asks its argument for
 * `getAttribute`, which a real element, a parsed document and a test double all
 * answer.
 */

const { WIDGETS } = require("../widgets");

/** Marks an element as an OSCAR widget, and says which one. */
const NAME_ATTR = "data-oscar";

/**
 * Carries the settings, as JSON rather than one attribute per key.
 *
 * Attributes are strings, and these values are not: `invert` is a boolean and
 * `port` is a number. Spreading them over `data-oscar-invert="false"` would
 * hand the runtime the string "false", which is truthy, and a slider would
 * silently run backwards. JSON survives the round trip with its types intact.
 */
const CONFIG_ATTR = "data-oscar-config";

/** Finds every exported widget on a page. */
const WIDGET_SELECTOR = "[" + NAME_ATTR + "]";

const BY_NAME = Object.create(null);
for (const widget of WIDGETS) BY_NAME[widget.name] = widget;

/** The widget definition registered under this name, or null. */
function definitionFor(name) {
  return BY_NAME[name] || null;
}

/**
 * The attributes that carry one widget's configuration.
 *
 * Only the keys the widget itself declares are written: everything else on a
 * component is editor bookkeeping (position, layers, selection) and has no
 * business travelling with a control surface.
 *
 * @param {string} name - a widget name, e.g. "oscar-slider"
 * @param {object} config - that widget's current settings
 * @returns {object|null} attributes to set, or null if this is not a widget
 */
function exportAttributes(name, config) {
  const definition = definitionFor(name);
  if (!definition) return null;

  const settings = {};
  for (const key of Object.keys(definition.defaults)) {
    const value = config ? config[key] : undefined;
    // An absent key is left out rather than written as null. readWidget fills
    // gaps from the widget's own defaults, and null is a value, not a gap.
    if (value !== undefined) settings[key] = value;
  }

  const attributes = {};
  attributes[NAME_ATTR] = name;
  attributes[CONFIG_ATTR] = JSON.stringify(settings);
  return attributes;
}

/**
 * Read a widget back off an element, or null if this element is not one.
 *
 * @param {{ getAttribute: (name: string) => string|null }} el
 * @returns {{ name: string, definition: object, config: object }|null}
 */
function readWidget(el) {
  if (!el || typeof el.getAttribute !== "function") return null;

  const name = el.getAttribute(NAME_ATTR);
  const definition = definitionFor(name);
  if (!definition) return null;

  const settings = parseConfig(el.getAttribute(CONFIG_ATTR));
  // Unreadable configuration is not quietly replaced by the defaults. The
  // defaults point at localhost:7000 /slider1, so a damaged widget would come
  // back to life aimed at whatever happens to be listening there -- a control
  // that does nothing is far easier to diagnose than one that fires at the
  // wrong rig.
  if (!settings) return null;

  return {
    name: name,
    definition: definition,
    // Merged over the defaults so a hand-written element only has to state
    // what it wants to change.
    config: Object.assign({}, definition.defaults, settings),
  };
}

/** The settings object an attribute holds, or null if it holds nothing usable. */
function parseConfig(raw) {
  if (typeof raw !== "string") return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return null;
  }

  // An array or a bare number parses fine and is still not a settings object.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed;
}

module.exports = {
  NAME_ATTR,
  CONFIG_ATTR,
  WIDGET_SELECTOR,
  definitionFor,
  exportAttributes,
  readWidget,
  parseConfig,
};
