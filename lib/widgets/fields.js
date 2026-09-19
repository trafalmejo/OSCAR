"use strict";

/**
 * The vocabulary a widget uses to describe its settings panel.
 *
 * A widget lists fields; something else turns them into whatever the editor of
 * the day uses for its inspector. Nothing here knows what that editor is, so a
 * widget definition outlives the choice of one.
 *
 * Field shape:
 *   { key, label, type, options?, min?, max?, step?, placeholder?, showIf?, section?, hint? }
 *   type: "text" | "number" | "select" | "checkbox"
 *   showIf: { key, in: [...] } -- the field is only shown while the setting
 *           named by `key` holds one of the listed values. Data rather than a
 *           function, so an adapter can see which setting to watch instead of
 *           being handed a closure it cannot look inside.
 *   hint: a sentence for whoever hovers over the setting, for the few whose
 *           label cannot say enough in the width a panel gives it.
 *   section: "osc" | "dmx" -- the protocol the setting belongs to. The panel
 *           draws one collapsible section per protocol; a field with none sits
 *           above them, with the settings that are about the widget itself.
 */

const { toNumber } = require("../osc-args");
const { isPort } = require("../ports");
const { SERIAL_HOST, isSerialTarget } = require("../serial-target");
const { SLOTS, PROTOCOL_OPTIONS, protocol, readHost } = require("../dmx/spec");
const { toWhole } = require("../dmx/levels");

const TYPES = ["text", "number", "select", "checkbox"];

/**
 * The protocols a widget can speak, in the order the panel shows them. One
 * section each, and each section that can be switched off carries its own
 * checkbox -- so which protocols a widget uses is read off the panel at a
 * glance, and adding a protocol later is adding a section, not another
 * entry in a list of combinations.
 */
const SECTIONS = [
  { id: "osc", label: "OSC" },
  { id: "dmx", label: "DMX" },
];

function field(key, label, type, extra) {
  const spec = Object.assign({ key: key, label: label, type: type }, extra || {});
  if (TYPES.indexOf(spec.type) === -1) {
    throw new Error("unknown field type: " + spec.type);
  }
  const rule = spec.showIf;
  if (rule !== undefined && (!rule || typeof rule.key !== "string" || !Array.isArray(rule.in))) {
    throw new Error(key + ": showIf must be { key, in: [...] }");
  }
  if (spec.section !== undefined && !SECTIONS.some((section) => section.id === spec.section)) {
    throw new Error(key + ": unknown section " + JSON.stringify(spec.section));
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
  // "Enabled" alone read as a third copy of the Enable box each protocol
  // section has. This one is over both of them, and over Listen as well.
  return field("enabled", "Master comms", "checkbox", { hint: MASTER_HINT });
}

const MASTER_HINT =
  "Master switch for this widget's communication. Off: it sends nothing on any protocol and " +
  "ignores incoming messages, whatever the sections below say, and a DMX fixture holds its last level. " +
  "Use it to lay out and try a control without firing cues at the rig.";

/**
 * Whether each protocol section of a widget is live, for the light the panel
 * draws on the section's title so it can be read while collapsed.
 *
 * Live means a value would really go out (or, for a widget that only follows
 * the rig, really be heard): the section's own Enable AND the master switch.
 * A green light over a widget the master has silenced would be a lie, and it
 * is the collapsed section that gets trusted at a glance. A section the
 * widget does not have is absent from the answer.
 */
function sectionStatus(fields, config) {
  const has = (id) => (fields || []).some((spec) => spec.section === id);
  const master = !!(config && config.enabled);
  const status = {};
  if (has("osc")) status.osc = master && sendsOsc(config);
  if (has("dmx")) status.dmx = master && sendsDmx(config);
  return status;
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
    field("ip", "Ip", "text", { section: "osc", placeholder: "localhost, an IP, or " + SERIAL_HOST }),
    field("port", "Port", "number", { section: "osc", min: 1, max: 65535 }),
    field("message", "Message", "text", { section: "osc", placeholder: "/address" }),
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
  return field("listen", "Listen", "checkbox", { section: "osc" });
}

/**
 * Where a widget's value goes.
 *
 * OSC reaches software; DMX reaches fixtures. Each is switched on by the
 * checkbox at the top of its own section, so one fader can ride a media
 * server's opacity and a house dimmer together, and "which protocols does
 * this use" is answered by looking at the panel. OSC is on and DMX off by
 * default, so every project made before DMX existed behaves as it did. Both
 * off is allowed and silent.
 *
 * Only a widget that can drive DMX carries the OSC checkbox. On one that
 * speaks OSC alone it would be a second Enabled.
 *
 * Both are labelled Enable: the section's title already says which protocol,
 * and a label that repeats it wraps onto a second line in the narrow panel.
 * For the same reason the DMX fields are Protocol, Node and so on, not "DMX
 * protocol"; the complaints a check raises still name DMX in full, because a
 * message is read away from the section it is about.
 */
function oscToggle() {
  return field("oscEnabled", "Enable", "checkbox", { section: "osc" });
}

function dmxToggle() {
  return field("dmxEnabled", "Enable", "checkbox", { section: "dmx" });
}

/** A checkbox as it may be stored: the boolean, or its text in a file edited by hand. */
function isOn(value) {
  return value === true || value === "true";
}

/**
 * Projects saved while the choice was one Output setting (osc, dmx or both)
 * still say it that way. Where that word is present it is what the person
 * chose, so it is read in preference to the checkboxes, which on such a
 * widget only hold their defaults. upgradeRouting() turns it into the
 * checkboxes; the editor does so as it opens each widget.
 */
const LEGACY_DMX = ["dmx", "both"];
const LEGACY_OSC = ["osc", "both"];

function legacyTransport(config) {
  const transport = config && config.transport;
  return typeof transport === "string" && transport ? transport : null;
}

/** Whether these settings put DMX on the wire. */
function sendsDmx(config) {
  const legacy = legacyTransport(config);
  if (legacy) return LEGACY_DMX.indexOf(legacy) !== -1;
  return isOn(config && config.dmxEnabled);
}

/** Whether these settings put OSC on the wire. No word either way means it does. */
function sendsOsc(config) {
  const legacy = legacyTransport(config);
  if (legacy) return LEGACY_OSC.indexOf(legacy) !== -1;
  const flag = config && config.oscEnabled;
  return flag === undefined || flag === null ? true : isOn(flag);
}

/**
 * The two checkboxes an old Output setting stands for, or null when the
 * settings carry no such word and there is nothing to upgrade.
 */
function upgradeRouting(config) {
  const legacy = legacyTransport(config);
  if (!legacy) return null;
  return { oscEnabled: LEGACY_OSC.indexOf(legacy) !== -1, dmxEnabled: LEGACY_DMX.indexOf(legacy) !== -1 };
}

/**
 * The DMX half of a widget's settings, for a widget with dmx: true.
 *
 * Its own section, led by the checkbox that switches it on. Nothing in it is
 * hidden while it is off: a channel can be set up before the fixture is live.
 * Where OSC needs an address and a port, DMX
 * needs a protocol, a node, a universe and a block of channels: the first
 * channel, and how many from there. A widget's values fill the block in
 * order and the last repeats, so a slider over three channels dims an RGB
 * fixture as a whole and a pad over two lands on pan and tilt.
 */
function dmxFields() {
  const only = { section: "dmx" };
  return [
    dmxToggle(),
    field("dmxProtocol", "Protocol", "select", Object.assign({ options: PROTOCOL_OPTIONS }, only)),
    field("dmxHost", "Node", "text", Object.assign({ placeholder: "broadcast" }, only)),
    field("dmxUniverse", "Universe", "number", Object.assign({ min: 0, max: 63999 }, only)),
    field("dmxChannel", "Channel", "number", Object.assign({ min: 1, max: SLOTS }, only)),
    field("dmxCount", "Channels", "number", Object.assign({ min: 1, max: SLOTS }, only)),
  ];
}

/**
 * The defaults that go with oscToggle() and dmxFields().
 *
 * Universe 1 rather than 0: it is the one first universe both protocols
 * accept, so switching protocol never silently stops the output. `values` is
 * how many channels the widget naturally drives -- one for a fader, two for
 * a pad, three for a colour -- and is the smallest block it can be given.
 */
function dmxDefaults(values) {
  return {
    oscEnabled: true,
    dmxEnabled: false,
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

// The cable has no ports, so a widget aimed at it may leave Port empty.
// Empty only: anything else typed there is stored in the project, and comes
// back as a port the server refuses the day Ip is pointed at the network.
function checkPort(value, config) {
  if (isPort(value)) return null;
  if (config && isSerialTarget(config.ip)) {
    const blank = value === undefined || value === null || (typeof value === "string" && value.trim() === "");
    return blank ? null : "Leave the Port empty for serial, or give a whole number between 1 and 65535";
  }
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
  SECTIONS: SECTIONS,
  sectionStatus: sectionStatus,
  oscToggle: oscToggle,
  dmxToggle: dmxToggle,
  upgradeRouting: upgradeRouting,
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
