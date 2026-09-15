"use strict";

/**
 * Start OSCAR on explicit ports:  npm run serve:at -- <http> [socket] [osc-in]
 *
 * Exists because `VAR=value node server.js` does not work in PowerShell or
 * cmd, and because several copies of OSCAR on one machine must not share any
 * port at all -- including the two source ports OSC is sent from, which the
 * defaults would otherwise put on 5001/5002 for every copy.
 *
 * The port arithmetic lives in lib/ports.js planPorts(), where it is tested:
 * a port typed here always wins, every port not typed is derived from the
 * HTTP port unless the environment already sets it, and a collision or a
 * malformed value stops the start with the port named. The browser is not
 * opened; this is a tool for running alongside other things, not for a show.
 */

const path = require("path");
const { planPorts } = require("../lib/ports");

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("usage: npm run serve:at -- <http-port> [socket-port] [osc-in-port]");
  process.exit(2);
}

let plan;
try {
  plan = planPorts(args, process.env);
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

for (const note of plan.notes) console.error(note);
Object.assign(process.env, plan.variables);

if (process.env.OSCAR_NO_OPEN === undefined) process.env.OSCAR_NO_OPEN = "1";

require(path.join(__dirname, "..", "server.js"));
