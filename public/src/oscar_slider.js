/**
 * OSC slider, wired to GrapesJS.
 *
 * The slider itself lives in lib/widgets/slider.js and knows nothing about the
 * editor; this is only the wiring.
 */
var { register } = require("./adapters/grapesjs");
var { slider } = require("../../lib/widgets/slider");

module.exports = register(slider);
