"use strict";

/**
 * OSCAR's widgets, described independently of any editor.
 *
 * A widget says what it is (tag, attributes, block icon), what can be
 * configured on it (fields and their validators), and how it behaves when a
 * finger lands on it (attach, in plain DOM). Nothing here imports GrapesJS or
 * touches the editor, so replacing the editor means writing one adapter --
 * public/src/adapters/grapesjs.js is the current one -- and not rewriting a
 * single widget.
 *
 * Adding a widget: one file in this folder exporting the definition, and one
 * line in registry.js. The editor and the preview register everything in
 * WIDGETS; there is nothing to wire by hand.
 *
 * A definition:
 *   name          "oscar-<something>", unique; also the component type
 *   tag           the element it renders as
 *   attributes    attributes on that element (optional); with a shared tag,
 *                 `type` or `class` here is what tells the widget from a
 *                 plain element when a project is parsed
 *   text          the setting rendered as the element's text content (optional)
 *   block         { label, category, icon } for the palette
 *   defaults      every setting and its starting value
 *   fields        the settings panel, in order; see fields.js
 *   checks        { key: (value, config) => complaint | null } validators
 *   attach(el, ctx) -> detach()   the behaviour, in plain DOM
 *
 * Capability flags, so tests and later features can tell the widgets apart
 * without guessing from their fields. All three are explicit booleans:
 *   sends     it puts OSC on the wire when used, so it has ip, port, message
 *             and argType settings. A display-only widget sets false.
 *   receives  it reacts to OSC arriving from the network (a meter, or a fader
 *             that follows the rig). It then has a `listen` field (listen()
 *             from fields.js, placed right after Message) and a `message`
 *             field naming the address it follows, and subscribes through
 *             follow() from incoming.js. On a widget that also sends, listen
 *             defaults to false: a surface must not start moving on its own.
 *   dmx       its values are numbers that a DMX channel could carry, so a
 *             DMX output may offer a channel mapping on it. A widget that
 *             sends text, or sends nothing, sets false. Implies sends.
 *
 * The contract an adapter must provide as `ctx`:
 *   get(key)                 read a setting
 *   set(key, value)          store a value the widget computed; must not
 *                            re-validate or re-render, or a drag fights itself
 *   send(message | null)     put a message on the wire; null means stay silent.
 *                            Refused while an incoming message is being
 *                            delivered to this widget (see onOsc).
 *   setClass(name, on)       reflect state visually
 *   onChange(keys, fn)       run fn when any of those settings is edited;
 *                            returns an unsubscribe function
 *   onRewrite(fn)            run fn after the host has rewritten the element's
 *                            attributes and classes. An editor re-applies its
 *                            own copy of them on every class or style edit,
 *                            wiping whatever attach wrote straight onto the
 *                            element -- an attribute, a class, an inline
 *                            property, a value -- so fn puts it back. Returns
 *                            an unsubscribe function. Optional in a host;
 *                            widgets check for it before calling it.
 *   onOsc(fn)                run fn({ address, args }) for every OSC message
 *                            the host receives, args as plain values (number,
 *                            string, boolean, or null for one OSCAR cannot
 *                            read). Returns an unsubscribe function. Optional
 *                            in a host: absent where nothing can be received,
 *                            so widgets go through follow() in incoming.js,
 *                            which checks for it and also applies Listen and
 *                            the address match. Parse every value with
 *                            toNumber() from osc-args.js -- an unreadable
 *                            value is ignored, never read as 0.
 *
 * Receiving never sends. A value that arrived from the network and went
 * straight back out is an endless loop with any software that echoes its own
 * state, so the receive path is built with no way to close one: follow()
 * hands a widget bare values, and the host refuses send() for as long as it
 * is delivering an incoming message. That refusal covers the delivery itself,
 * so a widget must not schedule a send from its receive path either -- not
 * on a frame, not on a timer; the shared test runs the frames a widget
 * scheduled while receiving and fails if anything went out. A widget applies
 * what it hears to its element and stores it with set(), and that is the
 * whole of its job. A hand on a control outranks the network: while a widget
 * is being dragged or held it ignores what arrives, and a drag that loses
 * the window (blur) counts as released. Enabled off makes a widget deaf as
 * well as silent; follow() checks it. A display-only widget (a meter) sets
 * sends: false, receives: true, and does nothing but follow().
 *
 * A widget must call the unsubscribe functions it was given from detach, or
 * every re-render stacks one more handler on the host.
 */

const registry = require("./registry");
const { outgoing } = require("./outgoing");

const FLAGS = ["sends", "receives", "dmx"];

/**
 * Refuse a definition that would fail later in some quieter way -- a missing
 * flag read as false, a duplicate name silently replacing another widget's
 * component type in the editor.
 */
function validate(definition) {
  const name = definition && definition.name;
  if (typeof name !== "string" || !/^oscar-[a-z0-9-]+$/.test(name)) {
    throw new Error("a widget's name must look like oscar-<something>, got " + JSON.stringify(name));
  }
  const problems = [];
  if (typeof definition.tag !== "string") problems.push("tag");
  const block = definition.block || {};
  for (const key of ["label", "category", "icon"]) {
    if (typeof block[key] !== "string" || !block[key]) problems.push("block." + key);
  }
  const defaults = definition.defaults;
  if (!defaults || typeof defaults !== "object") problems.push("defaults");
  // A text key with no default behind it renders an empty label and nothing
  // says why; catch the typo here, where the widget is named.
  if (definition.text !== undefined) {
    const known = defaults && Object.prototype.hasOwnProperty.call(defaults, definition.text);
    if (typeof definition.text !== "string" || !known) {
      problems.push("text (" + JSON.stringify(definition.text) + " is not a key of defaults)");
    }
  }
  if (!Array.isArray(definition.fields)) problems.push("fields");
  if (typeof definition.attach !== "function") problems.push("attach");
  for (const flag of FLAGS) {
    if (typeof definition[flag] !== "boolean") problems.push(flag + " (must be true or false)");
  }
  if (definition.dmx && !definition.sends) problems.push("dmx without sends");

  // A receiver with no Listen switch would follow the rig from the moment it
  // is dropped; one with no Message has nothing to follow. And a Listen field
  // on a widget that says it does not receive is a switch wired to nothing.
  const keys = Array.isArray(definition.fields) ? definition.fields.map((f) => f && f.key) : [];
  if (definition.receives) {
    if (!keys.includes("listen")) problems.push("receives without a listen field (listen() in fields.js)");
    if (!keys.includes("message")) problems.push("receives without a message field");
    if (definition.sends && defaults && defaults.listen !== false) {
      problems.push("listen must default to false on a widget that sends");
    }
  } else if (keys.includes("listen")) {
    problems.push("a listen field on a widget with receives: false");
  }

  if (problems.length) {
    throw new Error(name + " is not a complete widget definition: " + problems.join(", "));
  }
  return definition;
}

const WIDGETS = registry.map(validate);

const byName = {};
for (const widget of WIDGETS) {
  if (byName[widget.name]) throw new Error("two widgets are called " + widget.name);
  byName[widget.name] = widget;
}

module.exports = { WIDGETS, byName, validate, FLAGS, outgoing };
