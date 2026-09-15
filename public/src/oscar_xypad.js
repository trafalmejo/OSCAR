/**
 * OSC XY pad, wired to GrapesJS.
 *
 * The pad itself lives in lib/widgets/xypad.js and knows nothing about the
 * editor; this is only the wiring.
 */
var { register } = require("./adapters/grapesjs");
var { xypad } = require("../../lib/widgets/xypad");

module.exports = register(xypad);
