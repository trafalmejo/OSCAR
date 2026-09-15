/**
 * OSC number entry, wired to GrapesJS.
 *
 * The widget itself lives in lib/widgets/number-input.js and knows nothing
 * about the editor; this is only the wiring.
 */
var { register } = require("./adapters/grapesjs");
var { numberInput } = require("../../lib/widgets/number-input");

module.exports = register(numberInput);
