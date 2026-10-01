#!/usr/bin/env node
"use strict";

/**
 * The helper an assistant starts to reach OSCAR, run from a source checkout:
 *
 *   claude mcp add oscar -- node <path-to-oscar>/scripts/oscar-mcp.js
 *
 * It is the same program that is published to npm as `createwithoscar`
 * (createwithoscar/index.js), which is how everyone else connects:
 *
 *   claude mcp add oscar -- npx -y createwithoscar
 */

require("../createwithoscar/index.js");
