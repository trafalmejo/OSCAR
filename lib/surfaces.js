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
const { isListening, midiIndex, inputWanted } = require("./midi/spec");
const { incoming } = require("./widgets/incoming");
const { stateFromMidi, valuesOf } = require("./widgets/midi-in");

// How long the list of widgets that listen to MIDI is trusted for.
const LISTENERS_MS = 2000;

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
 * Every widget of a published page that has an id and whose settings read
 * back whole: [{ id, widget, definition, config }]. Those that can be driven
 * are widgetsIn(); the rest, a meter, can still be shown a value.
 */
function allWidgetsIn(html) {
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
    if (!read || read.problem || !read.definition) return tag;
    seen.add(id);
    found.push({ id, widget: read.definition.name, definition: read.definition, config: read.config });
    return tag;
  });
  return found;
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
 * @param {(request: object) => void} [deps.sendMIDI]
 * @param {{ store: { apply(id, patch): object|null } }} [deps.shared] the surface's shared state
 * @param {{ emit(event: string, payload: object): void }} [deps.io] to tell the devices
 */
function createSurfaces(deps) {
  const cache = new Map(); // id -> { stamp, widgets }
  const now = deps.now || Date.now;
  // Every widget on every surface that listens to MIDI. Worked out from the
  // published pages, which means reading a folder, so it is kept for a moment:
  // a knob being turned asks a hundred times a second.
  let listeners = { at: -Infinity, list: [] };
  // And every widget of every surface, for following the rig; kept the same way.
  let everything = { at: -Infinity, list: [] };
  const pages = new Map(); // id -> { stamp, widgets }, as `cache` is for the drivable ones

  async function allWidgets(fresh) {
    if (!fresh && now() - everything.at < LISTENERS_MS) return everything.list;
    const list = [];
    for (const entry of await deps.published.list()) {
      const stamp = String(entry.date) + "/" + entry.size;
      let held = pages.get(entry.id);
      if (!held || held.stamp !== stamp) {
        const page = await deps.published.read(entry.id);
        held = { stamp, widgets: page === null ? [] : allWidgetsIn(page) };
        pages.set(entry.id, held);
      }
      for (const widget of held.widgets) list.push({ surface: entry.id, widget });
    }
    everything = { at: now(), list };
    return list;
  }

  /**
   * Record what the rig put a widget in, marked as heard. `tell` says it to
   * every page as well, as a hand on a button is said: for OSC, which the
   * published pages leave to OSCAR. MIDI they still read for themselves.
   */
  function record(id, state, tell) {
    if (!deps.shared || !deps.shared.store) return false;
    const whole = deps.shared.store.apply(id, state, { heard: true });
    if (whole === null) return false;
    if (tell && deps.io) deps.io.emit("state:changed", { id, state: whole });
    return true;
  }

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

    /** A published surface's page, exactly as it was published, or null. For handing it to something else to serve. */
    page: (surfaceId) => deps.published.read(surfaceId),

    /** Everything every widget is showing, keyed by id: what a device joining late is handed. */
    snapshot() {
      return deps.shared && deps.shared.store ? deps.shared.store.snapshot() : {};
    },

    /**
     * Be told whenever a widget's state changes, whoever changed it: a hand on
     * a tablet, a schedule, a drive() from here. fn(widgetId, state). Returns
     * an unsubscribe function.
     */
    onState(fn) {
      return deps.shared && deps.shared.store && deps.shared.store.onChange ? deps.shared.store.onChange(fn) : function () {};
    },

    /**
     * Put one widget in one state.
     *
     * @param {{silent?: string[]}} [options] halves to keep quiet, e.g. ["midi"]
     * @returns {Promise<{ ok: true, state: object, sent: boolean } | { ok: false, reason: string }>}
     *          `sent` is false for a widget that is switched off: the state is
     *          still shown, as it is when a finger lands on a disabled widget.
     */
    async drive(surfaceId, widgetId, state, options) {
      const silent = (options && options.silent) || [];
      const widgets = await widgetsOf(surfaceId);
      if (!widgets) return { ok: false, reason: "There is no published surface called " + JSON.stringify(surfaceId) + "." };
      const target = widgets.find((w) => w.id === widgetId);
      if (!target) return { ok: false, reason: "That surface has no control " + JSON.stringify(widgetId) + " that can be driven." };

      const driven = target.definition.drive(target.config, state);
      if (!driven) return { ok: false, reason: target.name + " cannot be set to that." };

      // One message, or for a widget that sends several at once, all of them in order.
      const messages = (driven.messages || [driven.message]).filter(Boolean);
      for (const message of messages) {
        if (message.address) deps.sendOSC(message.ip, message.port, message.address, message.args);
        if (message.dmx) deps.sendDMX(Object.assign({ source: target.id }, message.dmx));
        if (message.midi && deps.sendMIDI && silent.indexOf("midi") === -1) deps.sendMIDI(message.midi);
      }

      // Every device showing the surface follows, the way it follows a hand
      // on another device. Told only if something actually changed.
      if (deps.shared && deps.shared.store) {
        const record = deps.shared.store.apply(target.id, driven.state);
        if (record && deps.io) deps.io.emit("state:changed", { id: target.id, state: record });
      }
      return { ok: true, state: driven.state, sent: messages.length > 0 };
    },

    /**
     * The ids of everything on a surface that shows a state, a meter
     * included, or null if there is no such surface. widgets() is only what
     * can be driven.
     */
    async shown(surfaceId) {
      // Asked once, as a surface goes public, often the moment after it was
      // published: what was read two seconds ago will not do.
      const all = await allWidgets(true);
      if (!(await deps.published.list()).some((entry) => entry.id === surfaceId)) return null;
      return all.filter((entry) => entry.surface === surfaceId).map((entry) => entry.widget.id);
    },

    /** Is anybody watching the states (onState)? Following the rig is only worth the work if so. */
    watched() {
      return !!(deps.shared && deps.shared.store && deps.shared.store.watchers && deps.shared.store.watchers.length);
    },

    /**
     * An OSC message arrived. Each published widget that follows that
     * address, and can say what the message does to it (`hear` in its
     * definition), has the state recorded and said to every device, which
     * is how a hand on a button is kept in step too. The published pages
     * leave such a widget to this (adapters/standalone.js). Nothing is sent
     * to the rig.
     *
     * @returns {Promise<number>} how many widgets it moved
     */
    async hearOsc(message) {
      let moved = 0;
      for (const entry of await allWidgets()) {
        const widget = entry.widget;
        if (typeof widget.definition.hear !== "function") continue;
        // A widget that answers to several addresses (an XY pad, an axis each) says which.
        const listens = typeof widget.definition.hearAddresses === "function" ? Object.assign({}, widget.config, { message: widget.definition.hearAddresses(widget.config) }) : widget.config;
        const match = incoming(listens, message);
        if (!match) continue;
        const state = widget.definition.hear(widget.config, match.values.map((arg) => (arg && typeof arg === "object" && "value" in arg ? arg.value : arg)), match.address);
        if (state && record(widget.id, state, true)) moved++;
      }
      return moved;
    },

    /**
     * The same for MIDI: the state is recorded and nothing is sent. With
     * MIDI_BRIDGE on, hearMidi() below is used instead, which sends as well.
     */
    async followMidi(heard, port, first) {
      let moved = 0;
      const showing = this.snapshot();
      for (const entry of await allWidgets()) {
        const widget = entry.widget;
        const index = midiIndex(widget.config, heard, port, valuesOf(widget.definition, widget.config), first);
        if (index === -1) continue;
        const state = stateFromMidi(widget.definition, widget.config, heard, index, showing[widget.id]);
        if (state && record(widget.id, state)) moved++;
      }
      return moved;
    },

    /** The MIDI inputs the published widgets listen on, drivable or not. */
    async followedMidiPorts() {
      const parts = (await allWidgets())
        .filter((entry) => entry.widget.config && entry.widget.config.enabled && isListening(entry.widget.config))
        .map((entry) => inputWanted(entry.widget.config.midiInPort));
      return Array.from(new Set(parts));
    },

    /**
     * The widgets, on every published surface, with MIDI's Data in on:
     * [{ surface, widget }]. At most LISTENERS_MS old.
     */
    async midiListeners() {
      if (now() - listeners.at < LISTENERS_MS) return listeners.list;
      const list = [];
      for (const entry of await deps.published.list()) {
        for (const widget of (await widgetsOf(entry.id)) || []) {
          if (widget.config && widget.config.enabled && isListening(widget.config)) list.push({ surface: entry.id, widget: widget });
        }
      }
      listeners = { at: now(), list: list };
      return list;
    },

    /** The input ports those widgets name, for the MIDI input to open: parts of names, "*" for every port, "" for the first. */
    async midiPorts() {
      const parts = (await this.midiListeners()).map((entry) => inputWanted(entry.widget.config.midiInPort));
      return Array.from(new Set(parts));
    },

    /**
     * A note, a controller, a program or a bend arrived. Every widget it
     * belongs to is driven, as a hand would drive it, except that none of
     * them answers in MIDI: through a virtual port that would come straight
     * back in, for ever (lib/widgets/midi-in.js).
     *
     * @returns {Promise<number>} how many widgets it moved
     */
    async hearMidi(heard, port, first) {
      let moved = 0;
      const showing = this.snapshot();
      for (const entry of await this.midiListeners()) {
        const widget = entry.widget;
        const index = midiIndex(widget.config, heard, port, valuesOf(widget.definition, widget.config), first);
        if (index === -1) continue;
        const state = stateFromMidi(widget.definition, widget.config, heard, index, showing[widget.id]);
        if (!state) continue;
        const result = await this.drive(entry.surface, widget.id, state, { silent: ["midi"] });
        if (result.ok) moved++;
      }
      return moved;
    },
  };
}

module.exports = { widgetsIn, allWidgetsIn, createSurfaces };
