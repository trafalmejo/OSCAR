"use strict";

/**
 * What a published interface is set up to talk to, recognised from a fixed
 * list and named by the list, never by the settings. The anonymous counts
 * (lib/telemetry.js, target_seen) say "resolume" or "launchpad", and never
 * the port, the address or the port name that said so; anything the list
 * does not know is "other". So the question "which software and gear do
 * people use OSCAR with" gets an answer without a single thing a person
 * typed leaving their computer.
 *
 * It is recognition, not knowledge: a default port someone changed, or a
 * controller whose name the list has not met, is counted as other.
 *
 * The list IS the contract: every name that can be sent is written here.
 */

/** OSC software, by the words its addresses start with (first), and by its default ports (second). */
const OSC_PATHS = [
  ["resolume", /^\/(composition|layer\d*)\b/],
  ["qlab", /^\/(cue|go|workspace|cue_id|select|panic|stop)\b/],
  ["ableton", /^\/live\b/],
  ["touchdesigner", /^\/td\b/],
  ["millumin", /^\/millumin\b/],
  ["isadora", /^\/isadora\b/],
  ["madmapper", /^\/(surfaces|medias|scenes|masters)\b/],
  ["x32", /^\/(xremote|ch\/\d{2}|bus\/\d{2}|dca\/\d|main\/st)\b/],
  ["reaper", /^\/(action|reaper)\b/],
];

const OSC_PORTS = {
  7000: "resolume",
  7001: "resolume",
  53000: "qlab",
  53001: "qlab",
  11000: "ableton",
  11001: "ableton",
  10000: "touchdesigner",
  8010: "madmapper",
  5000: "millumin",
  1234: "isadora",
  10023: "x32",
  57120: "supercollider",
  12345: "openframeworks",
  12000: "processing",
};

/** MIDI gear and software, by the words in a port's name. */
const MIDI_NAMES = [
  ["loopmidi", /loopmidi/i],
  ["iac", /iac driver/i],
  ["windows-synth", /microsoft gs wavetable/i],
  ["network-midi", /rtpmidi|network session|network midi/i],
  ["touchosc", /touchosc/i],
  ["push", /ableton push|\bpush\b/i],
  ["launchpad", /launchpad/i],
  ["novation", /novation|launchkey|launch control/i],
  ["akai", /akai|lpd8|mpd\d|mpk|apc\s?(mini|40|key)|fire\b/i],
  ["behringer", /behringer|x-touch|x touch|bcf2000|bcr2000/i],
  ["korg", /korg|nanokontrol|nanopad|nanokey/i],
  ["arturia", /arturia|keylab|minilab|beatstep|keystep/i],
  ["native-instruments", /native instruments|komplete|maschine|traktor/i],
  ["presonus", /presonus|faderport|atom\b/i],
  ["pioneer", /pioneer|ddj/i],
  ["roland", /roland/i],
  ["yamaha", /yamaha/i],
  ["m-audio", /m-audio|oxygen|keystation/i],
  ["elgato", /stream deck/i],
];

/** DMX, by how it leaves: the network protocols, and the two USB families. */
const DMX = {
  artnet: "artnet",
  sacn: "sacn",
  usbpro: "usb-pro",
  opendmx: "open-dmx",
};

/** Every name this file can say, for the test that holds it to the list. */
const NAMES = [...new Set(
  OSC_PATHS.map((p) => p[0])
    .concat(Object.values(OSC_PORTS))
    .concat(MIDI_NAMES.map((p) => p[0]))
    .concat(Object.values(DMX))
    .concat(["other"])
)].sort();

function oscTarget(address, port) {
  const path = String(address || "").trim();
  for (const [name, pattern] of OSC_PATHS) if (pattern.test(path)) return name;
  const n = Number(port);
  if (Number.isInteger(n) && OSC_PORTS[n]) return OSC_PORTS[n];
  return "other";
}

function midiTarget(portName) {
  const name = String(portName || "").trim();
  // "" is "the first port there is", and "All MIDI inputs" every one: no device is named.
  if (!name || /^all midi inputs$/i.test(name)) return null;
  for (const [family, pattern] of MIDI_NAMES) if (pattern.test(name)) return family;
  return "other";
}

/**
 * The distinct targets of a published interface's widgets, as
 * [{ kind: "osc"|"midi"|"dmx", target }], recognised or "other".
 *
 * @param {{ config: object }[]} widgets  as lib/surfaces.js allWidgetsIn gives them
 */
function targetsOf(widgets) {
  const seen = new Map();
  const add = (kind, target) => {
    if (!target) return;
    seen.set(kind + ":" + target, { kind, target });
  };
  for (const widget of widgets || []) {
    const c = (widget && widget.config) || {};
    const address = typeof c.message === "string" ? c.message : "";
    // OSC out, over the network: who is at the port; OSC in: whose words are followed.
    if (c.oscEnabled !== false && address && (c.oscVia || "network") === "network") add("osc", oscTarget(address, c.port));
    if (c.listen && address) add("osc", oscTarget(address, null));
    if (c.midiEnabled) add("midi", midiTarget(c.midiPort));
    if (c.midiListen) add("midi", midiTarget(c.midiInPort));
    if (c.dmxEnabled) add("dmx", DMX[c.dmxProtocol] || "other");
  }
  return [...seen.values()];
}

module.exports = { targetsOf, oscTarget, midiTarget, NAMES };
