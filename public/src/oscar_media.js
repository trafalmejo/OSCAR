/**
 * OSC media browser, wired to GrapesJS.
 *
 * The widget itself lives in lib/widgets/media.js and knows nothing about the
 * editor; this is only the wiring.
 */
var { register } = require("./adapters/grapesjs");
var { media } = require("../../lib/widgets/media");

module.exports = register(media);
