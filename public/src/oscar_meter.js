/**
 * OSC meter, wired to GrapesJS.
 *
 * The meter itself lives in lib/widgets/meter.js and knows nothing about the
 * editor; this is only the wiring.
 */
var { register } = require("./adapters/grapesjs");
var { meter } = require("../../lib/widgets/meter");

module.exports = register(meter);
