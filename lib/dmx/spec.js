"use strict";

/**
 * The fixed numbers the two DMX-over-Ethernet protocols are built on.
 *
 * Kept apart from the encoders so the widgets -- which run in a browser --
 * can validate a universe or a channel without pulling in Buffer or a socket.
 */

/** A DMX universe is 512 slots of one byte each. */
const SLOTS = 512;
const MAX_LEVEL = 255;

const ARTNET_PORT = 6454;
const SACN_PORT = 5568;

/**
 * Art-Net addresses a universe with a 15-bit Port-Address (Net, Sub-Net and
 * Universe packed together), so 0 is an ordinary first universe. E1.31
 * reserves 0 and 64000 upward, leaving 1-63999 for data.
 *
 * A USB interface is one universe on one serial port (lib/dmx/usb.js): no
 * port number, and its "host" is the serial port's name, or blank for the
 * first interface found. `usb` marks the two.
 */
const PROTOCOLS = [
  { id: "artnet", name: "Art-Net", port: ARTNET_PORT, minUniverse: 0, maxUniverse: 32767 },
  { id: "sacn", name: "sACN (E1.31)", port: SACN_PORT, minUniverse: 1, maxUniverse: 63999 },
  { id: "usbpro", name: "USB: Enttec Pro, DMXKing", port: null, minUniverse: 1, maxUniverse: 1, usb: true },
  { id: "opendmx", name: "USB: Open DMX (timing by this computer)", port: null, minUniverse: 1, maxUniverse: 1, usb: true },
];

/** Whether a protocol goes out on a serial port rather than the network. */
function isUsb(id) {
  const spec = protocol(id);
  return !!(spec && spec.usb);
}

/** The same list as a settings panel wants it. */
const PROTOCOL_OPTIONS = PROTOCOLS.map((spec) => ({ id: spec.id, name: spec.name }));

function protocol(id) {
  return PROTOCOLS.find((spec) => spec.id === id) || null;
}

/** E1.31 gives every universe its own multicast group: 239.255.<hi>.<lo>. */
function sacnMulticast(universe) {
  return "239.255." + ((universe >> 8) & 0xff) + "." + (universe & 0xff);
}

/**
 * Where a frame goes when no node was named.
 *
 * Each protocol was designed around an "I do not know the node's address"
 * answer: Art-Net broadcasts, sACN multicasts. Naming the node is still
 * better on a busy network, which is why the field exists.
 */
function defaultHost(id, universe) {
  if (isUsb(id)) return "";
  return id === "sacn" ? sacnMulticast(universe) : "255.255.255.255";
}

/**
 * A serial port's name, as the operating systems write them: COM3,
 * /dev/ttyUSB0, /dev/cu.usbserial-A1B2. Or a part of one, or the maker's
 * name; lib/dmx/usb.js matches loosely. Blank means the first interface.
 */
const PORT_NAME = /^[A-Za-z0-9./_:-]{1,64}$/;

/** A port name, "" for the first interface, or null for something refused. */
function readPortName(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name) return "";
  return PORT_NAME.test(name) ? name : null;
}

/** The node or port a widget's DMX settings name, read by the protocol's rule. */
function readTarget(id, raw) {
  return isUsb(id) ? readPortName(raw) : readHost(raw);
}

/**
 * Hostnames and IPv4 literals only: this is where a UDP packet goes, and
 * anything stranger than these characters was not built by OSCAR. Shared by
 * the settings panel and the server's gate so the two cannot drift.
 */
const HOST = /^[A-Za-z0-9.-]{1,255}$/;

/** A host, "" for the protocol's default, or null for something refused. */
function readHost(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") return null;
  const host = raw.trim();
  if (!host) return "";
  return HOST.test(host) ? host : null;
}

module.exports = {
  SLOTS,
  MAX_LEVEL,
  ARTNET_PORT,
  SACN_PORT,
  PROTOCOLS,
  PROTOCOL_OPTIONS,
  protocol,
  isUsb,
  sacnMulticast,
  defaultHost,
  HOST,
  readHost,
  PORT_NAME,
  readPortName,
  readTarget,
};
