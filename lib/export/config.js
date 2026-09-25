"use strict";

/**
 * A widget's settings, written onto exported markup and read back off it.
 *
 * Inside the editor every setting is a component property and deliberately
 * not an HTML attribute (public/src/adapters/grapesjs.js says why: an
 * attribute is a second copy of the truth, saved into every project file and
 * stale from the next edit on). That leaves exported markup saying
 * `<input type="range">` and nothing about where it sends, which is one of
 * the reasons an exported page never worked. So the settings are written onto
 * the elements here, at export time and only then, and read back by the
 * standalone runtime (public/src/adapters/standalone.js).
 *
 * Which keys travel is decided by each definition's own `defaults`, and which
 * widgets exist by WIDGETS, so a widget added to the registry is carried
 * without anyone remembering to list it here.
 *
 * Nothing here touches a DOM: readWidget asks its argument for getAttribute,
 * which a real element and a test double both answer.
 */

const { byName } = require("../widgets");

/** Marks an element as an OSCAR widget, and says which one. */
const NAME_ATTR = "data-oscar";

/**
 * Carries the settings, as one JSON value rather than an attribute per key.
 *
 * Attributes are strings and these values are not: `invert` is a boolean,
 * `port` a number. Spread over data-oscar-invert="false" the runtime would be
 * handed the string "false", which is truthy, and a fader would quietly run
 * backwards. JSON keeps the types.
 */
const CONFIG_ATTR = "data-oscar-config";

const WIDGET_SELECTOR = "[" + NAME_ATTR + "]";

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** The widget registered under this name, or null. Never a prototype member. */
function definitionFor(name) {
  return typeof name === "string" && has(byName, name) ? byName[name] : null;
}

/**
 * The attributes that carry one widget's configuration, or null when `name`
 * is not a widget.
 *
 * Only the keys the widget declares are written; everything else on a
 * component is editor bookkeeping and has no business on a control surface.
 * A setting the editor holds as undefined travels as null, so the key is
 * still there: readWidget treats a missing key as damage.
 *
 * @param {string} name a widget name, e.g. "oscar-slider"
 * @param {(key: string) => any} read reads one setting off the host
 */
function exportAttributes(name, read) {
  const definition = definitionFor(name);
  if (!definition) return null;

  const settings = {};
  for (const key of Object.keys(definition.defaults)) {
    const value = read(key);
    settings[key] = value === undefined ? null : value;
  }

  const attributes = {};
  attributes[NAME_ATTR] = name;
  attributes[CONFIG_ATTR] = JSON.stringify(settings);
  return attributes;
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

/**
 * A widget's settings with the files they name embedded, as the attribute's
 * new value, or null when there is nothing to change. Which settings name
 * files is the widget's business: it says so with `embed`.
 */
function embedAssets(name, raw, readAsset) {
  const definition = definitionFor(name);
  if (!definition || typeof definition.embed !== "function") return null;
  const config = parseConfig(raw);
  if (!config) return null;
  const changed = definition.embed(config, readAsset);
  return changed ? JSON.stringify(Object.assign({}, config, changed)) : null;
}

/**
 * The one setting a widget keeps writing itself: where its thumb is, what is
 * selected. The editor judges it when someone types it and not again when
 * the range around it is edited, so a project can honestly hold a Value its
 * present Min and Max would refuse, and the widgets clamp it as they start.
 * Refusing it here would switch off controls that work. It is also not a
 * setting that decides where anything goes: it is sent only after a gesture
 * has replaced it.
 */
const STATE_KEYS = ["value"];

/**
 * Why these settings cannot be run, or null when they can.
 *
 * All the keys being there says the blob was not truncated; it does not say
 * somebody's hand-edit left them usable, and the header of every exported
 * file invites hand-edits. "enabled": "false" is a string, which is truthy,
 * so the control the editor of the file meant to silence stays live; a Min
 * of null reaches Number() inside a widget and becomes a range starting at
 * 0. The definition already knows what a usable value is -- `checks` is what
 * the settings panel refuses edits with -- so the same judgement is asked
 * for here, and nothing about any one widget is written down in this file.
 * An export made by the editor always passes: the panel let none of it in
 * otherwise.
 */
function complaintAbout(definition, config) {
  for (const spec of definition.fields || []) {
    if (spec.type === "checkbox" && typeof config[spec.key] !== "boolean") {
      return JSON.stringify(spec.key) + " has to be true or false, not " + JSON.stringify(config[spec.key]);
    }
  }
  const checks = definition.checks || {};
  for (const key of Object.keys(checks)) {
    if (STATE_KEYS.indexOf(key) !== -1 || !has(config, key)) continue;
    let complaint;
    try {
      complaint = checks[key](config[key], config);
    } catch (err) {
      // A validator written for what a settings panel can produce, handed an
      // object or an array. That it cannot even be judged is the answer.
      complaint = "it cannot be read";
    }
    if (complaint) return JSON.stringify(key) + " is not usable: " + complaint;
  }
  return null;
}

/**
 * Read a widget back off an element.
 *
 * Returns { definition, config }, or { problem } saying why this element
 * cannot be run, or null when the element does not claim to be a widget.
 *
 * There is no path from here to a widget running on its defaults. The
 * defaults are a live control aimed at localhost:7000 /slider1 with a range
 * of 0-100: a widget revived on them after its settings were damaged fires
 * at whatever happens to be listening there, at levels nobody chose. A
 * control that does nothing gets noticed and fixed; one that drives the
 * wrong rig gets noticed by the audience. So every key the definition
 * declares has to be present -- an export always writes all of them, and the
 * file carries its own runtime, so a missing key is never a version skew,
 * only damage. Present is not enough either: see complaintAbout.
 */
/**
 * Keys added to the widgets after surfaces were already published. The
 * server reads published pages for as long as they are published, so for
 * these -- and only these -- a missing key is version skew, not damage, and
 * falls back to the value that means "as it always was": never to a live
 * default. Everything older stays required, as the note on readWidget says.
 */
const LATER_KEYS = {
  // "network" is only the words for what such a page already did: an old page
  // on the cable spells it ip: "serial", which viaSerial() still honours.
  oscVia: "network",
  oscSendWhen: "user",
  oscLoopGuard: true,
  midiSendWhen: "user",
  midiLoopGuard: true,
  dmxSendWhen: "user",
};

function readWidget(el) {
  if (!el || typeof el.getAttribute !== "function") return null;
  const name = el.getAttribute(NAME_ATTR);
  if (name === null || name === undefined) return null;

  const definition = definitionFor(name);
  if (!definition) return { problem: "unknown widget " + JSON.stringify(name) };

  const settings = parseConfig(el.getAttribute(CONFIG_ATTR));
  if (!settings) return { problem: CONFIG_ATTR + " is missing or is not a JSON object" };

  const config = {};
  for (const key of Object.keys(definition.defaults)) {
    if (!has(settings, key)) {
      if (!has(LATER_KEYS, key)) return { problem: CONFIG_ATTR + " has no " + JSON.stringify(key) };
      config[key] = LATER_KEYS[key];
      continue;
    }
    config[key] = settings[key];
  }
  const complaint = complaintAbout(definition, config);
  if (complaint) return { problem: CONFIG_ATTR + ": " + complaint };
  return { definition: definition, config: config };
}

module.exports = {
  NAME_ATTR,
  CONFIG_ATTR,
  WIDGET_SELECTOR,
  definitionFor,
  exportAttributes,
  parseConfig,
  embedAssets,
  readWidget,
};
