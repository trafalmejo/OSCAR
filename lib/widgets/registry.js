"use strict";

/**
 * Every widget OSCAR ships, in the order the block palette shows them.
 *
 * Adding a widget is one new file in this folder plus one line here. Nothing
 * else needs editing: lib/widgets/index.js reads this list, and the editor and
 * the preview register whatever it holds through the adapter.
 *
 * Keep one require per line so parallel additions merge without conflict.
 */
module.exports = [
  require("./button").button,
  require("./slider").slider,
  require("./xypad").xypad,
  require("./text-input").textInput,
  require("./number-input").numberInput,
  require("./dropdown").dropdown,
];
