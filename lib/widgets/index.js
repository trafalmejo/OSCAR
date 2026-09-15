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
 *   onOsc(fn)                run fn({ address, args }) for OSC arriving from
 *                            the network; returns an unsubscribe function
 *   share(state)             publish this widget's state to the other devices
 *                            showing the same surface
 *   onShared(fn)             run fn(state) when one of them publishes
 *
 * The last three are optional: a host that has no network behind it may leave
 * them off, and every widget checks before reaching for them.
 */

const { button } = require("./button");
const { slider } = require("./slider");
const { xypad } = require("./xypad");
const { outgoing } = require("./outgoing");
const { incoming } = require("./incoming");

const WIDGETS = [button, slider, xypad];

module.exports = { WIDGETS, button, slider, xypad, outgoing, incoming };
