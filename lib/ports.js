"use strict";

/**
 * The ports OSCAR listens on and sends from, read from the environment.
 *
 * One place, so that every port can be moved -- two copies on one machine,
 * or a development server that must not collide with a running show -- and
 * so that a port a later feature needs is added here rather than as one more
 * ad-hoc Number(process.env.X) in server.js.
 */

const DEFAULTS = {
  /** Web interface. */
  http: 8080,
  /** Browser-to-server OSC bridge (socket.io). */
  socket: 8081,
  /** Source port for OSC sent to the network. */
  lan: 5001,
  /** Source port for OSC sent to this machine. */
  local: 5002,
  /** Where OSC coming back from the rig is received. */
  oscIn: 9000,
  /** DMX over the network (Art-Net's fixed port; sACN uses 5568). */
  dmx: 6454,
};

const VARIABLES = {
  http: "OSCAR_HTTP_PORT",
  socket: "OSCAR_SOCKET_PORT",
  lan: "OSCAR_LAN_PORT",
  local: "OSCAR_LOCAL_PORT",
  oscIn: "OSCAR_OSC_IN_PORT",
  dmx: "OSCAR_DMX_PORT",
};

function isPort(value) {
  return Number.isInteger(value) && value > 0 && value <= 65535;
}

/**
 * Read one port. Unset means the default; set but not a port is refused.
 *
 * Silently falling back on a typo ("OSCAR_HTTP_PORT=808O") would start OSCAR
 * on 8080 and collide with whatever the operator was trying to avoid.
 */
function readPort(name, env) {
  const raw = env[VARIABLES[name]];
  if (raw === undefined || raw === "") return DEFAULTS[name];
  const port = Number(raw);
  if (isPort(port)) return port;
  throw new Error(VARIABLES[name] + " must be a port number between 1 and 65535, not " + JSON.stringify(raw));
}

/** @returns {{http:number, socket:number, lan:number, local:number, oscIn:number, dmx:number}} */
function portsFromEnv(env) {
  const source = env || process.env;
  const ports = {};
  for (const name of Object.keys(DEFAULTS)) ports[name] = readPort(name, source);
  return ports;
}

module.exports = { portsFromEnv, DEFAULTS, VARIABLES, isPort };
