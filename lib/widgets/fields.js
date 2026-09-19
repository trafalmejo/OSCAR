"use strict";

/**
 * The vocabulary a widget uses to describe its settings panel.
 *
 * A widget lists fields; something else turns them into whatever the editor of
 * the day uses for its inspector. Nothing here knows what that editor is, so a
 * widget definition outlives the choice of one.
 *
 * Field shape:
 *   { key, label, type, options?, min?, max?, step?, placeholder?, showIf? }
 *   type: "text" | "number" | "select" | "checkbox"
 *   showIf: { key, in: [...] } -- the field is only shown while the setting
 *           named by `key` holds one of the listed values. Data rather than a
 *           function, so an adapter can see which setting to watch instead of
 *           being handed a closure it cannot look inside.
 */

const { toNumber } = require("../osc-args");
const { isPort } = require("../ports");
const { SERIAL_HOST, isSerialTarget } = require("../serial-target");
const { SLOTS, PROTOCOL_OPTIONS, protocol, readHost } = require("../dmx/spec");
const { toWhole } = require("../dmx/levels");

const TYPES = ["text", "number", "select", "checkbox"];

function field(key, label, type, extra) {
  const spec = Object.assign({ key: key, label: label, type: type }, extra || {});
  if (TYPES.indexOf(spec.type) === -1) {
    throw new Error("unknown field type: " + spec.type);
  }
  const rule = spec.showIf;
  if (rule !== undefined && (!rule || typeof rule.key !== "string" || !Array.isArray(rule.in))) {
    throw new Error(key + ": showIf must be { key, in: [...] }");
  }
  return spec;
}

/**
 * The master switch, and the first field on every widget.
 *
 * It reads as what it is: a widget can be laid out, positioned and styled
 * while silent -- and deaf, so Listen does not move it either -- which is how
 * you build a surface without firing cues at a rig that is mid-show. It sits
 * above even the label, because whether a control is live matters more than
 * what it is called.
 */
function enabled() {
  return field("enabled", "Enabled", "checkbox");
}

/**
 * Where a widget sends. Every widget carries these, in this order, so a button
 * and a pad feel like the same instrument when you click between them.
 *
 * Ip also takes the word `serial`: the board on the USB cable, which has no
 * address (lib/serial-target.js says why it lives here). Port is then unused.
 */
function connection() {
  return [
    field("ip", "Ip", "text", { placeholder: "localhost, an IP, or " + SERIAL_HOST }),
    field("port", "Port", "number", { min: 1, max: 65535 }),
    field("message", "Message", "text", { placeholder: "/address" }),
  ];
}

/**
 * Which way a bar-shaped widget runs. Shared vocabulary rather than one
 * widget's property: the slider and the meter both offer it, a project file
 * stores the id, and neither definition should have to load the other to
 * spell it the same way.
 */
const ORIENTATIONS = [
  { id: "horizontal", name: "Horizontal" },
  { id: "vertical", name: "Vertical" },
];

/**
 * Follow the rig: reflect OSC arriving at the widget's own Message address.
 *
 * Off by default. A surface must not start moving on its own the moment it
 * is opened, and a control built before this existed must behave exactly as
 * it always did. Sits right after Message, which is the address it follows.
 */
function listen() {
  return field("listen", "Listen", "checkbox");
}

/**
 * Where a widget's value goes.
 *
 * OSC reaches software; DMX reaches fixtures. Putting the choice on every
 * widget that can drive DMX, rather than inventing a second family of
 * DMX-only controls, is what lets one fader ride a media server's opacity and
 * a house dimmer together. OSC is the default so every project made before
 * this existed behaves exactly as it did.
 */
const TRANSPORTS = [
  { id: "osc", name: "OSC" },
  { id: "dmx", name: "DMX (Art-Net / sACN)" },
  { id: "both", name: "OSC and DMX" },
];

const DMX_TRANSPORTS = ["dmx", "both"];
const OSC_TRANSPORTS = ["osc", "both"];

function transport() {
  return field("transport", "Output", "select", { options: TRANSPORTS });
}

/** Whether these settings put DMX on the wire. No transport at all means OSC only. */
function sendsDmx(config) {
  return DMX_TRANSPORTS.indexOf(config && config.transport) !== -1;
}

/** Whether these settings put OSC on the wire. */
function sendsOsc(config) {
  const transport = config && config.transport;
  return transport === undefined || transport === null || OSC_TRANSPORTS.indexOf(transport) !== -1;
}

/**
 * The DMX half of a widget's settings, for a widget with dmx: true.
 *
 * Hidden until Output asks for DMX, so the panel on a plain OSC button is the
 * panel OSCAR has always had. Where OSC needs an address and a port, DMX
 * needs a protocol, a node, a universe and a block of channels: the first
 * channel, and how many from there. A widget's values fill the block in
 * order and the last repeats, so a slider over three channels dims an RGB
 * fixture as a whole and a pad over two lands on pan and tilt.
 */
function dmxFields() {
  const only = { showIf: { key: "transport", in: DMX_TRANSPORTS } };
  return [
    field("dmxProtocol", "DMX protocol", "select", Object.assign({ options: PROTOCOL_OPTIONS }, only)),
    field("dmxHost", "DMX node", "text", Object.assign({ placeholder: "broadcast" }, only)),
    field("dmxUniverse", "DMX universe", "number", Object.assign({ min: 0, max: 63999 }, only)),
    field("dmxChannel", "DMX channel", "number", Object.assign({ min: 1, max: SLOTS }, only)),
    field("dmxCount", "DMX channels", "number", Object.assign({ min: 1, max: SLOTS }, only)),
  ];
}

/**
 * The defaults that go with transport() and dmxFields().
 *
 * Universe 1 rather than 0: it is the one first universe both protocols
 * accept, so switching protocol never silently stops the output. `values` is
 * how many channels the widget naturally drives -- one for a fader, two for
 * a pad, three for a colour -- and is the smallest block it can be given.
 */
function dmxDefaults(values) {
  return {
    transport: "osc",
    dmxProtocol: "artnet",
    dmxHost: "",
    dmxUniverse: 1,
    dmxChannel: 1,
    dmxCount: values || 1,
  };
}

function universeRange(config) {
  return protocol(config && config.dmxProtocol) || protocol("artnet");
}

function checkDmxUniverse(value, config) {
  const spec = universeRange(config);
  if (toWhole(value, spec.minUniverse, spec.maxUniverse) !== null) return null;
  return "A " + spec.name + " universe is a whole number between " + spec.minUniverse + " and " + spec.maxUniverse;
}

// Switching protocol under a universe the new one cannot address would leave
// the widget silently unsendable; the universe check does not re-run on its own.
function checkDmxProtocol(value, config) {
  const spec = protocol(value);
  if (!spec) return "Unknown DMX protocol: " + value;
  const universe = toWhole(config && config.dmxUniverse, spec.minUniverse, spec.maxUniverse);
  if (universe !== null) return null;
  return spec.name + " cannot address universe " + (config && config.dmxUniverse) + "; change the universe first";
}

function checkDmxChannel(value, config) {
  const channel = toWhole(value, 1, SLOTS);
  if (channel === null) return "A DMX channel is a whole number between 1 and " + SLOTS;
  const count = toWhole(config && config.dmxCount, 1, SLOTS);
  if (count !== null && channel + count - 1 > SLOTS) {
    return "Channel " + channel + " plus " + count + " channels runs past the end of the universe";
  }
  return null;
}

/**
 * @param {number} values the widget's own value count; a narrower block would
 *                        drop a coordinate, and half a position is no position
 */
function checkDmxCount(values) {
  const least = values || 1;
  return function (value, config) {
    const count = toWhole(value, least, SLOTS);
    if (count === null) return "This widget needs between " + least + " and " + SLOTS + " DMX channels";
    const channel = toWhole(config && config.dmxChannel, 1, SLOTS);
    // Sending the part that fits would leave half a fixture answering, which
    // reads as a broken light rather than a wrong setting.
    if (channel !== null && channel + count - 1 > SLOTS) {
      return "Channel " + channel + " plus " + count + " channels runs past the end of the universe";
    }
    return null;
  };
}

const IPV4 =
  /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/;

// The wire refuses a node the server could not send to, but its only word of
// that is a line in a console the packaged app never shows; the widget looks
// alive and drives nothing. So the panel refuses it first. A value made of
// digits and dots is an IPv4 literal that has to be one: "192.168.1.300" is
// not a hostname either.
function checkDmxHost(value) {
  const host = readHost(value == null ? "" : String(value));
  if (host !== null && (!/^[0-9.]+$/.test(host) || IPV4.test(host))) return null;
  return "A DMX node is an IP address or a host name, or blank to reach every node: " + value;
}

/** The validators that go with dmxFields(); `values` as for dmxDefaults(). */
function dmxChecks(values) {
  return {
    dmxProtocol: checkDmxProtocol,
    dmxHost: checkDmxHost,
    dmxUniverse: checkDmxUniverse,
    dmxChannel: checkDmxChannel,
    dmxCount: checkDmxCount(values),
  };
}

/**
 * Validators return a complaint, or null when the value is fine.
 *
 * They run when someone edits a field, so a value that cannot be sent is
 * caught while there is still a human looking at it. The send path refuses bad
 * values too -- these two guards cover different moments, not the same one
 * twice: a project file can be edited by hand, and a field can be left mid-edit.
 */
function checkIp(value, config) {
  if (isSerialTarget(value)) return null;
  if (value !== "localhost" && !IPV4.test(String(value))) {
    return "That isn't an IP address, localhost, or " + SERIAL_HOST + ": " + value;
  }
  // A widget on the cable may have had its Port cleared, which is fine there
  // and unsendable here. The port check does not re-run on its own, and the
  // server's refusal is a console line the packaged app never shows.
  if (config && "port" in config && !isPort(config.port)) {
    return "Give this widget a Port before pointing it at the network";
  }
  return null;
}

// The cable has no ports, so a widget aimed at it is not nagged about a
// number nothing will read. Everything else still needs a real one.
function checkPort(value, config) {
  if (isPort(value)) return null;
  if (config && isSerialTarget(config.ip)) return null;
  return "The port has to be a whole number between 1 and 65535";
}

function checkMessage(value) {
  const address = String(value == null ? "" : value);
  if (address.length > 1 && address.charAt(0) === "/") return null;
  return "An OSC message is a path, like /master/level";
}

// The same parser the wire uses, so a value the panel accepts is one the
// send path will not drop -- and a stray space is refused in both places.
function checkNumber(label) {
  return function (value) {
    if (toNumber(value) !== null) return null;
    return label + " has to be a number";
  };
}

/** The validators that go with connection(). */
function connectionChecks() {
  return { ip: checkIp, port: checkPort, message: checkMessage };
}

module.exports = {
  field: field,
  enabled: enabled,
  listen: listen,
  connection: connection,
  connectionChecks: connectionChecks,
  transport: transport,
  TRANSPORTS: TRANSPORTS,
  ORIENTATIONS: ORIENTATIONS,
  sendsDmx: sendsDmx,
  sendsOsc: sendsOsc,
  dmxFields: dmxFields,
  dmxDefaults: dmxDefaults,
  dmxChecks: dmxChecks,
  checkIp: checkIp,
  checkPort: checkPort,
  checkMessage: checkMessage,
  checkNumber: checkNumber,
  IPV4: IPV4,
};
