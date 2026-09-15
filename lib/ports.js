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
  /**
   * Source port Art-Net and sACN are sent from. 0 means any free port: the
   * nodes listen on 6454 and 5568 whatever OSCAR sends from, and binding 6454
   * here would collide with node software on this same machine -- Resolume,
   * QLC+, MadMapper all receive Art-Net on it. Set OSCAR_DMX_PORT=6454 for a
   * node that only answers to that source port.
   */
  dmx: 0,
};

const VARIABLES = {
  http: "OSCAR_HTTP_PORT",
  socket: "OSCAR_SOCKET_PORT",
  lan: "OSCAR_LAN_PORT",
  local: "OSCAR_LOCAL_PORT",
  oscIn: "OSCAR_OSC_IN_PORT",
  dmx: "OSCAR_DMX_PORT",
};

/**
 * The one definition of a port, for a number or the text of one. Used by the
 * send path (lib/osc-message.js), the settings panel (lib/widgets/fields.js)
 * and the listeners here, so none of them can drift on what is refused.
 */
function isPort(value) {
  if (typeof value !== "number" && typeof value !== "string") return false;
  if (typeof value === "string" && value.trim() === "") return false;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 65535;
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
  // A port whose default is "any" may be asked for explicitly, so a profile
  // that pins it can be overridden from a command line the same way.
  if (DEFAULTS[name] === 0 && String(raw).trim() === "0") return 0;
  throw new Error(VARIABLES[name] + " must be a port number between 1 and 65535, not " + JSON.stringify(raw));
}

/** @returns {{http:number, socket:number, lan:number, local:number, oscIn:number, dmx:number}} */
function portsFromEnv(env) {
  const source = env || process.env;
  const ports = {};
  for (const name of Object.keys(DEFAULTS)) ports[name] = readPort(name, source);
  return ports;
}

/** The ports `serve:at` takes on its command line, in order. */
const ARGUMENTS = ["http", "socket", "oscIn"];

/** How far from the HTTP port each derived port sits. */
const OFFSETS = { socket: 1, oscIn: 2, lan: 3, local: 4 };

/**
 * Plan the ports for a copy started as `serve:at <http> [socket] [osc-in]`.
 *
 * A port typed on the command line always wins: it is the one thing the
 * operator asked for, and an OSCAR_HTTP_PORT left in a shell profile must not
 * quietly put a development copy on the show's port. Every port not typed is
 * derived from the HTTP port unless the environment already sets it, so one
 * number keeps a copy clear of everything else, including the two source
 * ports OSC is sent from.
 *
 * Returns { variables, notes, ports }: the environment to start with, what to
 * tell the operator (a variable an argument overrode), and the full result.
 * Throws, naming the port, on anything that cannot be resolved -- a malformed
 * argument, a malformed variable, or two ports landing on the same number.
 */
function planPorts(args, env) {
  const given = {};
  ARGUMENTS.forEach((name, i) => {
    const raw = args[i];
    if (raw === undefined) return;
    if (!isPort(raw)) {
      throw new Error("the " + VARIABLES[name] + " argument must be a port number between 1 and 65535, not " + JSON.stringify(raw));
    }
    given[name] = Number(raw);
  });
  if (given.http === undefined) throw new Error("an HTTP port is required");

  const variables = {};
  const notes = [];
  for (const name of ["http"].concat(Object.keys(OFFSETS))) {
    const variable = VARIABLES[name];
    const fromEnv = env[variable];
    const inEnv = fromEnv !== undefined && fromEnv !== "";

    if (given[name] !== undefined) {
      if (inEnv && Number(fromEnv) !== given[name]) {
        notes.push(variable + "=" + fromEnv + " is set in the environment; using " + given[name] + " from the command line");
      }
      variables[variable] = String(given[name]);
      continue;
    }
    if (inEnv) continue;

    const derived = given.http + OFFSETS[name];
    if (!isPort(derived)) throw new Error(variable + " would be " + derived + ", which is not a port");
    variables[variable] = String(derived);
  }

  // Resolving through portsFromEnv refuses a malformed variable the same way
  // a plain start would, and yields every port so collisions can be caught
  // before something binds -- an OSC-in port typed as http + 3 is also the
  // LAN source port, and UDP does not share.
  const ports = portsFromEnv(Object.assign({}, env, variables));
  const taken = {};
  for (const name of Object.keys(ports)) {
    // "Any free port" collides with nothing by definition.
    if (ports[name] === 0) continue;
    const other = taken[ports[name]];
    if (other) throw new Error(VARIABLES[other] + " and " + VARIABLES[name] + " would both be " + ports[name]);
    taken[ports[name]] = name;
  }

  return { variables, notes, ports };
}

module.exports = { portsFromEnv, planPorts, DEFAULTS, VARIABLES, isPort };
