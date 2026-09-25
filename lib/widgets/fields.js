"use strict";

/**
 * The vocabulary a widget uses to describe its settings panel.
 *
 * A widget lists fields; something else turns them into whatever the editor of
 * the day uses for its inspector. Nothing here knows what that editor is, so a
 * widget definition outlives the choice of one.
 *
 * Field shape:
 *   { key, label, type, options?, min?, max?, step?, showIf?, dir?, section?, hint? }
 *   type: "text" | "number" | "select" | "checkbox"
 *   showIf: { key, in: [...] } -- the field is only shown while the setting
 *           named by `key` holds one of the listed values. Data rather than a
 *           function, so an adapter can see which setting to watch instead of
 *           being handed a closure it cannot look inside.
 *   dir: "in" | "out" | "both" -- which of its section's directions the field
 *           belongs to. A section opens on its Data in and Data out
 *           checkboxes alone; a field tagged with a direction appears only
 *           while that direction is on (either, for "both"), so an Out port
 *           is not on screen when nothing goes out. Requires `section`.
 *   hint: a sentence for whoever hovers over the setting, for the few whose
 *           label cannot say enough in the width a panel gives it.
 *   section: "osc" | "dmx" -- the protocol the setting belongs to. The panel
 *           draws one collapsible section per protocol; a field with none sits
 *           above them, with the settings that are about the widget itself.
 */

const { toNumber } = require("../osc-args");
const { isPort } = require("../ports");
const { SERIAL_HOST, isSerialTarget } = require("../serial-target");
const { SLOTS, PROTOCOL_OPTIONS, protocol, isUsb, readHost, readPortName } = require("../dmx/spec");
const { toWhole } = require("../dmx/levels");
const { sendsMidi, isListening } = require("../midi/spec");

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
  { id: "midi", label: "MIDI" },
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
  if (spec.dir !== undefined) {
    if (["in", "out", "both"].indexOf(spec.dir) === -1) throw new Error(key + ': dir is "in", "out" or "both"');
    if (spec.section === undefined) throw new Error(key + ": dir needs a section whose checkboxes decide it");
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
 * Which directions of each protocol section are live on a widget, for the
 * lights the panel draws on the section's title so it can be read collapsed.
 *
 *   { osc: { in: true, out: false }, dmx: { out: true }, midi: { in: false, out: false } }
 *
 * A direction the widget does not have is absent: a meter has no `out`, DMX
 * never has an `in`, and a section the widget lacks is not there at all.
 * Live means it would really happen: the direction's own checkbox AND the
 * master switch. A green light over a widget the master has silenced would
 * be a lie, and it is the collapsed section that gets trusted at a glance.
 */
function sectionStatus(fields, config) {
  const has = (key) => (fields || []).some((spec) => spec.key === key);
  const master = !!(config && config.enabled);
  const status = {};

  const osc = {};
  if (has("listen")) osc.in = master && isOn(config && config.listen);
  // Ip is what makes a widget a sender; one without it only follows.
  if (has("ip")) osc.out = master && sendsOsc(config);
  if (Object.keys(osc).length) status.osc = osc;

  if (has("dmxEnabled")) status.dmx = { out: master && sendsDmx(config) };
  // Each direction the widget has: a meter listens to MIDI and cannot send it.
  const midi = {};
  if (has("midiListen")) midi.in = master && isListening(config);
  if (has("midiEnabled")) midi.out = master && sendsMidi(config);
  if (Object.keys(midi).length) status.midi = midi;
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
    field("ip", "Ip", "text", { section: "osc", dir: "out", placeholder: "localhost, an IP, or " + SERIAL_HOST }),
    field("port", "Port out", "number", { section: "osc", dir: "out", min: 1, max: 65535 }),
    // The address sent to and the address followed: either direction needs it.
    field("message", "Message", "text", { section: "osc", dir: "both", placeholder: "/address" }),
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
 * Data in: follow the rig, by reflecting OSC that arrives at the widget's own
 * Message address. (The setting is stored as `listen`, its first name.)
 *
 * Off by default on a widget that also sends. A surface must not start moving
 * on its own the moment it is opened, and a control built before this existed
 * must behave exactly as it always did.
 */
function listen() {
  return field("listen", "Data in", "checkbox", { section: "osc", hint: DATA_IN_HINT });
}

const DATA_IN_HINT =
  "Follow the rig: an OSC message arriving at this widget's Message address moves it. " +
  "What comes in is not sent back out unless a Send when below says so.";

const DATA_OUT_HINT = "Send this widget's value over this protocol when it is used.";

/**
 * When a protocol's Data out fires: the bridge, per widget and per protocol.
 *
 * "Changed by the user" is what every widget always did: a hand, on any
 * device. "or by data in" also sends on what Data in (OSC or MIDI) put the
 * widget in, which makes OSCAR a bridge: a knob drives Resolume, a sensor's
 * OSC drives a fixture. The bridged send happens once, from the OSCAR that
 * serves the surface -- on published surfaces, and on a downloaded file,
 * which serves itself. The editor's canvas and the preview only follow, so
 * a rig is never driven twice by a surface that is open in the editor while
 * it is published.
 */
const SEND_WHEN_OPTIONS = [
  { id: "user", name: "Changed by the user" },
  { id: "data", name: "Changed by the user or by data in" },
];

const SEND_WHEN_HINT =
  "When this sends. 'Changed by the user': a hand on this surface, on any device. 'or by data in': " +
  "what arrives over Data in (OSC or MIDI) is also sent on -- the bridge. Bridged sends happen once, " +
  "from the OSCAR that serves the surface: published surfaces and downloaded files; the editor's " +
  "canvas only follows.";

const LOOP_GUARD_HINT =
  "Bridge only a change that changed the value, so software that echoes what it receives cannot start " +
  "a loop. Untick for triggers where a repeat is the event -- and never point such a widget back at " +
  "its own source.";

/** A value the combo can hold, or a complaint. */
function checkSendWhen(value) {
  if (SEND_WHEN_OPTIONS.some((option) => option.id === value)) return null;
  return "Send when is one of: " + SEND_WHEN_OPTIONS.map((option) => JSON.stringify(option.id)).join(", ");
}

function sendWhenField(key, section) {
  return field(key, "Send when", "select", { section: section, dir: "out", options: SEND_WHEN_OPTIONS, hint: SEND_WHEN_HINT });
}

/** Only on screen while its Send when bridges: the guard guards nothing else. */
function loopGuardField(key, section, whenKey) {
  return field(key, "Loop guard", "checkbox", { section: section, dir: "out", showIf: { key: whenKey, in: ["data"] }, hint: LOOP_GUARD_HINT });
}

/**
 * The OSC section of a panel, in the one order every widget shares.
 *
 * OSC runs both ways, so the section opens with a checkbox per direction --
 * Data in where the widget can follow the rig, Data out where it sends --
 * and then says where: Ip and Port for a widget that sends, Message for both,
 * since it is the address sent to and the address followed.
 *
 * Built here rather than listed by each widget so the directions lead every
 * OSC section the same way, and a widget cannot offer a direction it has not
 * got: `sends` and `receives` are the definition's own flags.
 *
 * The stored keys are `listen` (in) and `oscEnabled` (out). They keep those
 * names because projects already hold them; the panel calls them what they do.
 */
function oscFields(options) {
  const sends = !options || options.sends !== false;
  const receives = !options || options.receives !== false;
  const fields = [];
  if (receives) fields.push(listen());
  if (sends) fields.push(oscToggle(), sendWhenField("oscSendWhen", "osc"), loopGuardField("oscLoopGuard", "osc", "oscSendWhen"));
  if (sends) return fields.concat(connection());
  return fields.concat([field("message", "Message", "text", { section: "osc", dir: "in", placeholder: "/address" })]);
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
 * Every widget that sends carries OSC's Data out, not only those that can
 * also drive DMX: the master switch stops both directions, so this is the
 * only way to keep a control following the rig while it sends nothing.
 *
 * The labels say the direction and leave the protocol to the section's
 * title; a label that repeats it wraps onto a second line in the narrow
 * panel. For the same reason the DMX fields are Protocol, Node and so on, not
 * "DMX protocol"; the complaints a check raises still name DMX in full,
 * because a message is read away from the section it is about.
 */
function oscToggle() {
  return field("oscEnabled", "Data out", "checkbox", { section: "osc", hint: DATA_OUT_HINT });
}

/**
 * Where a direction of the OSC section points, for whoever hovers over its
 * checkbox or its light: the one port OSCAR listens on for Data in, which is
 * the server's and not the widget's, and the widget's own IP and Port for
 * Data out. Empty for anything else, and for what is not known.
 *
 * @param {string} key      `listen` or `oscEnabled`
 * @param {object} config   the widget's settings
 * @param {object} [server] `{ listeningPort }`, as GET /connection said
 */
function oscEndpoint(key, config, server) {
  if (key === "listen") {
    const port = server && server.listeningPort;
    return port ? "OSCAR listens on port " + port + "." : "";
  }
  if (key === "oscEnabled") {
    const port = config && config.port;
    if (port === undefined || port === null || port === "") return "";
    const ip = config.ip ? config.ip + ", " : "";
    return "Sends to " + ip + "port " + port + ".";
  }
  return "";
}

// DMX only runs one way, from the desk to the fixture, so its section has the
// one direction. Named as OSC's is, so the two sections read alike.
function dmxToggle() {
  return field("dmxEnabled", "Data out", "checkbox", { section: "dmx", hint: DATA_OUT_HINT });
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
 * Its own section, led by the checkbox that switches it on, which is also
 * what reveals the rest: a section shows its two directions and nothing
 * more until one is on. Where OSC needs an address and a port, DMX
 * needs a protocol, a node, a universe and a block of channels: the first
 * channel, and how many from there. A widget's values fill the block in
 * order and the last repeats, so a slider over three channels dims an RGB
 * fixture as a whole and a pad over two lands on pan and tilt.
 */
function dmxFields() {
  const only = { section: "dmx", dir: "out" };
  return [
    dmxToggle(),
    // No guard: nothing comes in over DMX, and a repeated level changes no frame.
    sendWhenField("dmxSendWhen", "dmx"),
    field("dmxProtocol", "Protocol", "select", Object.assign({ options: PROTOCOL_OPTIONS }, only)),
    field("dmxHost", "Node or port", "text", Object.assign({ placeholder: "broadcast, or the first USB interface", hint: "On Art-Net and sACN: the node's address, or blank to reach every node. On USB: the serial port (COM3, /dev/ttyUSB0), a part of its name, or blank for the first interface found." }, only)),
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
    oscSendWhen: "user",
    oscLoopGuard: true,
    dmxEnabled: false,
    dmxSendWhen: "user",
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
function checkDmxHost(value, config) {
  const text = value == null ? "" : String(value);
  if (isUsb(config && config.dmxProtocol)) {
    if (readPortName(text) !== null) return null;
    return "On USB this is the serial port's name (COM3, /dev/ttyUSB0), or blank for the first interface: " + value;
  }
  const host = readHost(text);
  if (host !== null && (!/^[0-9.]+$/.test(host) || IPV4.test(host))) return null;
  return "A DMX node is an IP address or a host name, or blank to reach every node: " + value;
}

/** The validators that go with dmxFields(); `values` as for dmxDefaults(). */
function dmxChecks(values) {
  return {
    dmxSendWhen: checkSendWhen,
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
  return { ip: checkIp, port: checkPort, message: checkMessage, oscSendWhen: checkSendWhen };
}

module.exports = {
  field: field,
  SEND_WHEN_OPTIONS: SEND_WHEN_OPTIONS,
  checkSendWhen: checkSendWhen,
  sendWhenField: sendWhenField,
  loopGuardField: loopGuardField,
  enabled: enabled,
  listen: listen,
  oscFields: oscFields,
  connection: connection,
  connectionChecks: connectionChecks,
  SECTIONS: SECTIONS,
  sectionStatus: sectionStatus,
  oscEndpoint: oscEndpoint,
  oscToggle: oscToggle,
  dmxToggle: dmxToggle,
  upgradeRouting: upgradeRouting,
  ORIENTATIONS: ORIENTATIONS,
  sendsDmx: sendsDmx,
  sendsOsc: sendsOsc,
  sendsMidi: sendsMidi,
  dmxFields: dmxFields,
  dmxDefaults: dmxDefaults,
  dmxChecks: dmxChecks,
  checkIp: checkIp,
  checkPort: checkPort,
  checkMessage: checkMessage,
  checkNumber: checkNumber,
  IPV4: IPV4,
};
