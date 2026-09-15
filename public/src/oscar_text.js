/**
 * OSC text entry, wired to GrapesJS.
 *
 * The widget itself lives in lib/widgets/text-input.js and knows nothing about
 * the editor; this is only the wiring.
 */
var { register } = require("./adapters/grapesjs");
var { textInput } = require("../../lib/widgets/text-input");

module.exports = register(textInput);
