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
 */
const PROTOCOLS = [
  { id: "artnet", name: "Art-Net", port: ARTNET_PORT, minUniverse: 0, maxUniverse: 32767 },
  { id: "sacn", name: "sACN (E1.31)", port: SACN_PORT, minUniverse: 1, maxUniverse: 63999 },
];

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
  return id === "sacn" ? sacnMulticast(universe) : "255.255.255.255";
}

module.exports = {
  SLOTS,
  MAX_LEVEL,
  ARTNET_PORT,
  SACN_PORT,
  PROTOCOLS,
  PROTOCOL_OPTIONS,
  protocol,
  sacnMulticast,
  defaultHost,
};
