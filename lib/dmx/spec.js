"use strict";

/**
 * The fixed numbers the two DMX-over-Ethernet specifications agree on.
 *
 * Kept apart from the encoders so the browser half of OSCAR can validate a
 * universe or a channel without pulling in Buffer, dgram or a socket.
 */

/** A DMX universe is 512 slots, and every slot is one byte. */
const SLOTS = 512;
const MAX_LEVEL = 255;

const ARTNET_PORT = 6454;
const SACN_PORT = 5568;

/**
 * Art-Net addresses a universe with a 15-bit Port-Address (Net + Sub-Net +
 * Universe), so 0 is a perfectly ordinary universe. E1.31 reserves 0 and
 * 64000-65535, leaving 1-63999 for data.
 */
const PROTOCOLS = [
  {
    id: "artnet",
    name: "Art-Net",
    port: ARTNET_PORT,
    minUniverse: 0,
    maxUniverse: 32767,
  },
  {
    id: "sacn",
    name: "sACN (E1.31)",
    port: SACN_PORT,
    minUniverse: 1,
    maxUniverse: 63999,
  },
];

/** The same list reduced to what a settings panel needs. */
const PROTOCOL_OPTIONS = PROTOCOLS.map(function (spec) {
  return { id: spec.id, name: spec.name };
});

function protocol(id) {
  for (const spec of PROTOCOLS) {
    if (spec.id === id) return spec;
  }
  return null;
}

/** E1.31 maps each universe onto its own multicast group, 239.255.<hi>.<lo>. */
function sacnMulticast(universe) {
  return "239.255." + ((universe >> 8) & 0xff) + "." + (universe & 0xff);
}

/**
 * Where a request goes when Host was left blank.
 *
 * Both defaults are the "I don't know the node's address" answer each protocol
 * was designed around: Art-Net broadcasts, sACN multicasts. Naming a host is
 * still better on a busy network, which is why the field exists.
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
