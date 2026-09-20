"use strict";

/**
 * Acting on a published surface from the server, with no browser showing it.
 *
 * Everything a widget sends is normally decided in the browser: a finger
 * lands, the widget works out the message, and the server only puts it on
 * the wire. That leaves two things OSCAR could not do. It could not act when
 * nobody is there -- a schedule that turns the lights on at nine -- and it
 * could not take an instruction from somewhere it should not trust, because
 * the instruction carried its own destination: whoever could send "osc"
 * could aim it at any address on the venue's network.
 *
 * This is the other way in. The caller says only *which widget* of *which
 * published surface* and *what state*; where that goes, how it is encoded and
 * what range it is held to all come from the surface as it was published,
 * through the widget's own drive() (lib/widgets/index.js). Nothing the
 * caller sends can widen it.
 *
 * What is driven is also recorded as the surface's shared state, so every
 * tablet showing it follows, as it would follow a hand on another tablet.
 */

const { NAME_ATTR, readWidget } = require("./export/config");

const OPENING_TAG = /<([a-zA-Z][^\s\/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTRIBUTE = /([^\s=\/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function unescapeHtml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attributesOf(text) {
  const attributes = {};
  text.replace(ATTRIBUTE, function (match, name, double, single, bare) {
    const raw = double !== undefined ? double : single !== undefined ? single : bare;
    attributes[name.toLowerCase()] = raw === undefined ? "" : unescapeHtml(raw);
    return match;
  });
  return attributes;
}

/** What a person would call this widget: its label if it has one, else what it sends to. */
function nameOf(definition, config, id) {
  const label = typeof config.label === "string" ? config.label.trim() : "";
  if (label) return label;
  const address = typeof config.message === "string" ? config.message.trim() : "";
  return definition.block.label + (address ? " " + address : " " + id);
}

/**
 * The widgets of a published page that can be driven: those that have an id
 * (it is how a surface knows a widget across devices), whose settings read
 * back whole, and whose definition has a drive().
 *
 * @param {string} html a page as lib/export built it
 * @returns {{ id, widget, name, input, definition, config }[]}
 */
function widgetsIn(html) {
  const found = [];
  const seen = new Set();
  String(html || "").replace(OPENING_TAG, function (tag, tagName, text) {
    if (text.indexOf(NAME_ATTR) === -1) return tag;
    const attributes = attributesOf(text);
    const id = attributes.id;
    if (!id || seen.has(id)) return tag;
    const read = readWidget({
      getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null),
    });
    const definition = read && !read.problem ? read.definition : null;
    if (!definition || typeof definition.drive !== "function" || typeof definition.driveInput !== "function") return tag;
    seen.add(id);
    found.push({
      id,
      widget: read.definition.name,
      name: nameOf(read.definition, read.config, id),
      input: definition.driveInput(read.config),
      definition: read.definition,
      config: read.config,
    });
    return tag;
  });
  return found;
}

/**
 * @param {object} deps
 * @param {import('./published').PublishedStore} deps.published
 * @param {(ip, port, address, args) => void} deps.sendOSC
 * @param {(request: object) => void} deps.sendDMX
 * @param {{ store: { apply(id, patch): object|null } }} [deps.shared] the surface's shared state
 * @param {{ emit(event: string, payload: object): void }} [deps.io] to tell the devices
 */
function createSurfaces(deps) {
  const cache = new Map(); // id -> { stamp, widgets }

  async function widgetsOf(surfaceId) {
    const listed = (await deps.published.list()).find((entry) => entry.id === surfaceId);
    if (!listed) return null;
    // Read again only when the surface has been published again.
    const stamp = String(listed.date) + "/" + listed.size;
    const held = cache.get(surfaceId);
    if (held && held.stamp === stamp) return held.widgets;
    const page = await deps.published.read(surfaceId);
    if (page === null) return null;
    const widgets = widgetsIn(page);
    cache.set(surfaceId, { stamp, widgets });
    return widgets;
  }

  /** What a caller may know about a widget: never where it sends. */
  const described = (w) => ({ id: w.id, widget: w.widget, name: w.name, input: w.input });

  return {
    /** The published surfaces: [{ id, path, size, date }]. */
    list: () => deps.published.list(),

    /** A surface's drivable widgets, or null if there is no such surface. */
    async widgets(surfaceId) {
      const widgets = await widgetsOf(surfaceId);
      return widgets ? widgets.map(described) : null;
    },

    /**
     * Put one widget in one state.
     *
     * @returns {Promise<{ ok: true, state: object, sent: boolean } | { ok: false, reason: string }>}
     *          `sent` is false for a widget that is switched off: the state is
     *          still shown, as it is when a finger lands on a disabled widget.
     */
    async drive(surfaceId, widgetId, state) {
      const widgets = await widgetsOf(surfaceId);
      if (!widgets) return { ok: false, reason: "There is no published surface called " + JSON.stringify(surfaceId) + "." };
      const target = widgets.find((w) => w.id === widgetId);
      if (!target) return { ok: false, reason: "That surface has no control " + JSON.stringify(widgetId) + " that can be driven." };

      const driven = target.definition.drive(target.config, state);
      if (!driven) return { ok: false, reason: target.name + " cannot be set to that." };

      const message = driven.message;
      if (message && message.address) deps.sendOSC(message.ip, message.port, message.address, message.args);
      if (message && message.dmx) deps.sendDMX(Object.assign({ source: target.id }, message.dmx));

      // Every device showing the surface follows, the way it follows a hand
      // on another device. Told only if something actually changed.
      if (deps.shared && deps.shared.store) {
        const record = deps.shared.store.apply(target.id, driven.state);
        if (record && deps.io) deps.io.emit("state:changed", { id: target.id, state: record });
      }
      return { ok: true, state: driven.state, sent: !!message };
    },
  };
}

module.exports = { widgetsIn, createSurfaces };
