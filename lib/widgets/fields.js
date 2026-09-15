"use strict";

const { SLOTS, PROTOCOL_OPTIONS, protocol } = require("../dmx/spec");
const { toWhole } = require("../dmx/levels");

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
 *
 * `showIf` is { key, in: [...] }: a rule, not a function, so an adapter can see
 * which setting it has to watch without being handed a closure to guess at.
 */

const TYPES = ["text", "number", "select", "checkbox"];

function field(key, label, type, extra) {
  const spec = Object.assign({ key: key, label: label, type: type }, extra || {});
  if (TYPES.indexOf(spec.type) === -1) {
    throw new Error("unknown field type: " + spec.type);
  }
  return spec;
}

/**
 * The master switch, and the first field on every widget.
 *
 * It reads as what it is: a widget can be laid out, positioned and styled
 * while silent, which is how you build a surface without firing cues at a rig
 * that is mid-show. It sits above even the label, because whether a control is
 * live matters more than what it is called.
 */
function enabled() {
  return field("enabled", "Enabled", "checkbox");
}

/**
 * Where a widget sends. Every widget carries these, in this order, so a button
 * and a pad feel like the same instrument when you click between them.
 */
function connection() {
  return [
    field("ip", "Ip", "text", { placeholder: "localhost" }),
    field("port", "Port", "number", { min: 1, max: 65535 }),
    field("message", "Message", "text", { placeholder: "/address" }),
  ];
}

/**
 * Where a widget's value goes.
 *
 * OSC reaches software; DMX reaches fixtures. A widget that can do both at once
 * is the point of putting this on every widget rather than inventing a second
 * family of DMX-only controls: one fader can ride a media server's opacity and
 * a house dimmer together, and a momentary button behaves like a momentary
 * button whichever it is driving.
 */
const TRANSPORTS = [
  { id: "osc", name: "OSC" },
  { id: "dmx", name: "DMX (Art-Net / sACN)" },
  { id: "both", name: "OSC and DMX" },
];

const DMX_TRANSPORTS = ["dmx", "both"];

function transport() {
  return field("transport", "Output", "select", { options: TRANSPORTS });
}

/** True when this widget's settings say it should be putting DMX on the wire. */
function sendsDmx(config) {
  return DMX_TRANSPORTS.indexOf((config && config.transport) || "osc") !== -1;
}

/**
 * The DMX half of a widget's settings.
 *
 * Hidden until Output asks for DMX, so the panel someone opens on a plain OSC
 * button is the panel OSCAR has always had. Where the OSC half needs an address
 * and a port, DMX needs a protocol, a node, a universe and a block of channels.
 */
function dmxConnection() {
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
 * The defaults that go with dmxConnection().
 *
 * Universe 1 rather than 0 because it is the one universe number both
 * protocols accept, so switching protocol never silently stops the output.
 * `values` is how many channels this widget naturally drives -- one for a
 * fader, two for a pad's pan and tilt.
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

function checkDmxUniverse(value, config) {
  const spec = protocol((config && config.dmxProtocol) || "artnet") || protocol("artnet");
  if (toWhole(value, spec.minUniverse, spec.maxUniverse) !== null) return null;
  return (
    "A " + spec.name + " universe is a whole number between " +
    spec.minUniverse + " and " + spec.maxUniverse
  );
}

function checkDmxChannel(value) {
  if (toWhole(value, 1, SLOTS) !== null) return null;
  return "A DMX channel is a whole number between 1 and " + SLOTS;
}

function checkDmxCount(value, config) {
  const count = toWhole(value, 1, SLOTS);
  if (count === null) return "A widget has to cover at least one DMX channel";

  const channel = toWhole(config && config.dmxChannel, 1, SLOTS);
  // Silently sending the part that fits would leave half a fixture responding,
  // which reads as a broken light rather than a wrong setting.
  if (channel !== null && channel + count - 1 > SLOTS) {
    return "Channel " + channel + " plus " + count + " channels runs past the end of the universe";
  }
  return null;
}

/** The validators that go with dmxConnection(). */
function dmxChecks() {
  return {
    dmxUniverse: checkDmxUniverse,
    dmxChannel: checkDmxChannel,
    dmxCount: checkDmxCount,
  };
}

const IPV4 =
  /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/;

/**
 * Validators return a complaint, or null when the value is fine.
 *
 * They run when someone edits a field, so a value that cannot be sent is
 * caught while there is still a human looking at it. The send path refuses bad
 * values too -- these two guards cover different moments, not the same one
 * twice: a project file can be edited by hand, and a field can be left mid-edit.
 */
function checkIp(value) {
  if (value === "localhost" || IPV4.test(String(value))) return null;
  return "That IP address isn't valid: " + value;
}

function checkPort(value) {
  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port <= 65535) return null;
  return "The port has to be a whole number between 1 and 65535";
}

function checkMessage(value) {
  const address = String(value == null ? "" : value);
  if (address.length > 1 && address.charAt(0) === "/") return null;
  return "An OSC message is a path, like /master/level";
}

function checkNumber(label) {
  return function (value) {
    if (value !== "" && value !== null && Number.isFinite(Number(value))) return null;
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
  connection: connection,
  connectionChecks: connectionChecks,
  transport: transport,
  TRANSPORTS: TRANSPORTS,
  sendsDmx: sendsDmx,
  dmxConnection: dmxConnection,
  dmxDefaults: dmxDefaults,
  dmxChecks: dmxChecks,
  checkIp: checkIp,
  checkPort: checkPort,
  checkMessage: checkMessage,
  checkNumber: checkNumber,
  IPV4: IPV4,
};
