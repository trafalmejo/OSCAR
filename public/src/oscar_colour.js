/**
 * OSC colour picker, wired to GrapesJS.
 *
 * The widget itself lives in lib/widgets/colour.js and knows nothing about the
 * editor; this is only the wiring.
 */
var { register } = require("./adapters/grapesjs");
var { colour } = require("../../lib/widgets/colour");

module.exports = register(colour);
