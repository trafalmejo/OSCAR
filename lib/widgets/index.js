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
 *   ownsChildren  true for a widget that builds the elements inside itself
 *                 from its settings on every attach -- the tiles of a grid,
 *                 the rows of a list (optional). Those elements are the
 *                 widget's business and nobody else's: a host must not store
 *                 them in the project, read them back out of parsed markup,
 *                 or offer them to the designer as things to select, move or
 *                 delete. The settings stay the one source of truth. Cannot
 *                 be combined with `text`, which is the host filling the
 *                 element instead.
 *   embed(config, read) -> changed settings | null   (optional) for a widget
 *                 whose settings name image files: called at export, where
 *                 read(path) gives a data: URI for a file that can travel
 *                 inside the page, or null
 *   drive(config, state) -> { state, message } | null   (optional) what putting
 *                 the widget in `state` sends, worked out with no element
 *                 and no gesture, for a host that acts on a surface without
 *                 showing it: a schedule, or a message from somewhere that
 *                 may only say "this widget, this value". `state` has the
 *                 shape the widget shares ({ on }, { value }); what comes
 *                 back is that state as the widget would keep it (clamped,
 *                 on its step) and the message from outgoing(), which may be
 *                 null for a widget that is switched off. A widget that
 *                 sends several at once (an XY pad with its axes apart)
 *                 gives `messages`, an array, in the order they leave. Null altogether
 *                 means the widget cannot take that state. Pure: it sends
 *                 nothing and stores nothing.
 *   driveInput(config) -> { kind, ... }   goes with drive(): how its state is
 *                 asked for, so a panel can offer the right control without
 *                 knowing the widget. { kind: "on" }, { kind: "value", min,
 *                 max, step }, { kind: "choice", options: [{ label, value }] },
 *                 { kind: "position", minX, maxX, minY, maxY },
 *                 { kind: "colour" } or { kind: "text", maxLength }.
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
 *   dmx       its values are numbers that a DMX channel could carry, so it
 *             offers DMX as well as OSC. Each protocol is a section of the
 *             panel led by its own checkbox: oscToggle() from fields.js
 *             (OSC's Enable, on by default so every older project behaves as it
 *             did) ahead of connection(), and the DMX fields (dmxFields(),
 *             which opens with DMX's Enable, off by default; defaults from
 *             dmxDefaults(n) and checks from dmxChecks(n), n being how many
 *             channels the widget naturally drives). A widget with dmx: false
 *             carries neither checkbox: OSC's Enable on a widget that only speaks
 *             OSC would be a second Enabled. The same widgets speak MIDI, the
 *             same way, from lib/widgets/midi-fields.js: midiFields(),
 *             midiDefaults(kind) and midiChecks(n), scaled from the same 0..1
 *             by lib/midi/spec.js. The widget scales its gesture to 0..1 with unitOf()
 *             from lib/dmx/levels.js and passes that as outgoing()'s third
 *             argument; outgoing() builds the DMX half. A widget that sends
 *             text, or sends nothing, sets false. Implies sends.
 *
 * The contract an adapter must provide as `ctx`:
 *   get(key)                 read a setting
 *   set(key, value)          store a value the widget computed; must not
 *                            re-validate or re-render, or a drag fights itself
 *   send(message | null)     put a message on the wire; null means stay silent.
 *                            The message is what outgoing() returned: an OSC
 *                            half { ip, port, address, args }, a DMX half
 *                            { dmx: { protocol, host, universe, channel,
 *                            levels } }, or both on one object; the host
 *                            sends whichever halves are present and stamps
 *                            the DMX half with the widget's identity. A widget
 *                            never releases DMX channels itself: the host
 *                            does that when the widget is deleted or its
 *                            DMX's Enable is unticked, and the server when OSCAR quits.
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
 *   share(state, how?)       tell every other device showing this surface
 *                            what this widget now shows: a small object of
 *                            numbers, booleans or short strings ({ on },
 *                            { value }, { x, y }). Called from the paths a
 *                            hand takes, next to send(), and once from the
 *                            OSC receive path with how = { heard: true }:
 *                            the record on the server then has what the rig
 *                            said, for a device joining later, and nobody
 *                            is told, because every device was sent the
 *                            same message. how = { release: state } says
 *                            what to show if this device goes away, for
 *                            state that lasts only while a finger is down.
 *                            Refused while a shared state is being
 *                            delivered (see onShared).
 *                            Optional in a host: absent where there is one
 *                            device and nothing to agree with, and in the
 *                            editor, which is not a device on the surface;
 *                            so widgets go through share() in shared.js,
 *                            which checks.
 *   onShared(fn)             run fn(state) when another device changes what
 *                            this widget shows, and, on a host that keeps
 *                            one, with the state already known when the
 *                            widget subscribes, so a device joining late
 *                            starts where the others are. `state` is the
 *                            widget's whole record, merged from everything
 *                            shared for it, so a key may be missing; read
 *                            each value as carefully as one from the rig.
 *                            Returns an unsubscribe function. Optional in a
 *                            host, so widgets go through onShared() in
 *                            shared.js. While fn runs the host refuses both
 *                            send() and share(): the device that acted
 *                            already sent, and a device that re-shared what
 *                            it was handed would hand it straight back.
 *
 * Sharing is not gated on Listen or on anything else: two tablets agreeing
 * on what a control shows is not something anyone should have to switch on.
 * The state is keyed by the widget's id in the project, so the same widget
 * finds itself on every device the layout was pushed to; a widget with no
 * hand on it takes what arrives the way it takes what the rig sends, and a
 * hand on it outranks the other devices as it outranks the rig -- but what
 * arrived under the hand is caught up with once it lifts, if the hand itself
 * said nothing later, because the other devices are only told once.
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
  // Read as a plain truthy value it would let "yes" through in one host and
  // not in another; and a widget cannot both fill its element itself and
  // have the host fill it with a label.
  if (definition.ownsChildren !== undefined) {
    if (typeof definition.ownsChildren !== "boolean") problems.push("ownsChildren (must be true or false)");
    else if (definition.ownsChildren && definition.text !== undefined) problems.push("ownsChildren together with text");
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
