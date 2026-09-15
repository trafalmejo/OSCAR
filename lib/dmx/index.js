"use strict";

/**
 * DMX over Ethernet, for the server.
 *
 * The browser half of OSCAR requires lib/dmx/spec and lib/dmx/levels directly:
 * this file pulls in the encoders and the streaming output, which need Buffer,
 * crypto and timers and have no business in a bundle.
 */

const spec = require("./spec");
const levels = require("./levels");
const packet = require("./packet");
const request = require("./request");
const output = require("./output");

module.exports = Object.assign({}, spec, levels, packet, request, output);
