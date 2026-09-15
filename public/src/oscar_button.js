/**
 * OSC button, wired to GrapesJS.
 *
 * The button itself lives in lib/widgets/button.js and knows nothing about the
 * editor; this is only the wiring.
 */
var { register } = require("./adapters/grapesjs");
var { button } = require("../../lib/widgets/button");

module.exports = register(button);
