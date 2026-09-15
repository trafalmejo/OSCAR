/**
 * OSC dropdown, wired to GrapesJS.
 *
 * The widget itself lives in lib/widgets/select-input.js and knows nothing
 * about the editor; this is only the wiring.
 */
var { register } = require("./adapters/grapesjs");
var { selectInput } = require("../../lib/widgets/select-input");

module.exports = register(selectInput);
