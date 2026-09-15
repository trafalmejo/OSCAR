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
 * The contract an adapter must provide as `ctx`:
 *   get(key)                 read a setting
 *   set(key, value)          store a value the widget computed; must not
 *                            re-validate or re-render, or a drag fights itself
 *   send(message | null)     put a message on the wire; null means stay silent
 *   setClass(name, on)       reflect state visually
 *   onChange(keys, fn)       run fn when any of those settings is edited;
 *                            returns an unsubscribe function
 *
 * Widgets that display rather than control go the other way: they publish a
 * plain function on their element for whatever is receiving OSC to call. The
 * meter's is el.oscarSetLevel(value) -- see lib/widgets/meter.js.
 */

const { button } = require("./button");
const { slider } = require("./slider");
const { xypad } = require("./xypad");
const { meter } = require("./meter");
const { media } = require("./media");
const { outgoing } = require("./outgoing");

const WIDGETS = [button, slider, xypad, meter, media];

module.exports = { WIDGETS, button, slider, xypad, meter, media, outgoing };
