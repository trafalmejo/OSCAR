"use strict";

/**
 * Start OSCAR on explicit ports:  npm run serve:at -- <http> [socket] [osc-in]
 *
 * Exists because `VAR=value node server.js` does not work in PowerShell or
 * cmd, and because several copies of OSCAR on one machine must not share any
 * port at all -- including the two source ports OSC is sent from, which the
 * defaults would otherwise put on 5001/5002 for every copy.
 *
 * Every port not given is derived from the HTTP port, so one number is enough
 * to keep a copy out of everyone else's way:
 *   socket = http + 1, osc-in = http + 2, lan = http + 3, local = http + 4
 * A variable already set in the environment is left alone. The browser is not
 * opened; this is a tool for running alongside other things, not for a show.
 */

const path = require("path");
const { VARIABLES, isPort } = require("../lib/ports");

const args = process.argv.slice(2);
const http = Number(args[0]);

if (!isPort(http)) {
  console.error("usage: npm run serve:at -- <http-port> [socket-port] [osc-in-port]");
  process.exit(2);
}

const chosen = {
  http: http,
  socket: Number(args[1]) || http + 1,
  oscIn: Number(args[2]) || http + 2,
  lan: http + 3,
  local: http + 4,
};

for (const name of Object.keys(chosen)) {
  const variable = VARIABLES[name];
  if (process.env[variable] !== undefined && process.env[variable] !== "") continue;
  if (!isPort(chosen[name])) {
    console.error(variable + " would be " + chosen[name] + ", which is not a port");
    process.exit(2);
  }
  process.env[variable] = String(chosen[name]);
}

if (process.env.OSCAR_NO_OPEN === undefined) process.env.OSCAR_NO_OPEN = "1";

require(path.join(__dirname, "..", "server.js"));
