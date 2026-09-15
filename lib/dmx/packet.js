"use strict";

const { SLOTS } = require("./spec");

/**
 * Art-Net and sACN (ANSI E1.31) packet encoders.
 *
 * Both formats are a fixed header followed by the slots, so they are plain
 * Buffer work rather than a dependency: the whole of each format OSCAR needs
 * fits on this page, which is also the only way to check it against the
 * specification. A wrong byte here is invisible -- nothing reports an error,
 * the fixture just never moves -- so test/dmx/packet.test.js pins every
 * header byte.
 */

const ARTNET_ID = "Art-Net\0";
const OP_DMX = 0x5000;
const ART_PROT_VER = 14;
const ARTNET_HEADER = 18;

/**
 * ArtDmx.
 *
 *   0   8 bytes  "Art-Net" and a null
 *   8   uint16   OpCode 0x5000, little-endian -- the one LE field in Art-Net
 *  10   uint16   protocol revision 14, big-endian
 *  12   uint8    sequence 1-255; 0 tells the node not to check ordering
 *  13   uint8    physical input port, informational
 *  14   uint8    SubUni: the low byte of the 15-bit Port-Address
 *  15   uint8    Net: the high 7 bits of the Port-Address
 *  16   uint16   slot count, big-endian, even, 2-512
 *  18   ...      the slots
 */
function encodeArtDmx(universe, sequence, data) {
  // The spec allows 2-512 slots and an even count. OSCAR always sends a whole
  // universe; reaching this means a frame was built by hand.
  if (!Buffer.isBuffer(data) || !data.length || data.length > SLOTS || data.length % 2 !== 0) {
    throw new Error("Art-Net takes an even number of slots, 2-" + SLOTS);
  }
  const buf = Buffer.alloc(ARTNET_HEADER + data.length);
  buf.write(ARTNET_ID, 0, "ascii");
  buf.writeUInt16LE(OP_DMX, 8);
  buf.writeUInt16BE(ART_PROT_VER, 10);
  buf[12] = sequence & 0xff;
  buf[13] = 0;
  buf[14] = universe & 0xff;
  buf[15] = (universe >> 8) & 0x7f;
  buf.writeUInt16BE(data.length, 16);
  data.copy(buf, ARTNET_HEADER);
  return buf;
}

const ACN_PACKET_ID = "ASC-E1.17";
const VECTOR_ROOT_E131_DATA = 0x00000004;
const VECTOR_E131_DATA_PACKET = 0x00000002;
const VECTOR_DMP_SET_PROPERTY = 0x02;
/** Flags 0x7 in the top nibble, the PDU length in the low 12 bits. */
const PDU_FLAGS = 0x7000;
/** Each layer's length counts from where that layer starts. */
const ROOT_LENGTH_AT = 16;
const FRAMING_AT = 38;
const DMP_AT = 115;
const SACN_HEADER = 126;
const SOURCE_NAME_BYTES = 64;
const DEFAULT_PRIORITY = 100;
/** E1.31 6.2.6: a source that is leaving sets this so receivers drop it at once. */
const OPT_STREAM_TERMINATED = 0x40;

/**
 * An E1.31 data packet: root layer, framing layer, DMP layer, slots.
 *
 *   ROOT      0  uint16  preamble size 0x0010
 *             2  uint16  post-amble size 0x0000
 *             4  12 B    "ASC-E1.17", null padded
 *            16  uint16  flags | length of everything from byte 16
 *            18  uint32  VECTOR_ROOT_E131_DATA
 *            22  16 B    CID, this sender's identity for the whole run
 *   FRAMING  38  uint16  flags | length of everything from byte 38
 *            40  uint32  VECTOR_E131_DATA_PACKET
 *            44  64 B    source name, UTF-8, null terminated
 *           108  uint8   priority 0-200, 100 by default
 *           109  uint16  synchronization address, 0 = unsynchronised
 *           111  uint8   sequence, wrapping 0-255
 *           112  uint8   options
 *           113  uint16  universe
 *   DMP     115  uint16  flags | length of everything from byte 115
 *           117  uint8   VECTOR_DMP_SET_PROPERTY
 *           118  uint8   address and data type 0xa1
 *           119  uint16  first property address 0
 *           121  uint16  address increment 1
 *           123  uint16  property value count: the slots plus the start code
 *           125  uint8   DMX start code 0x00 (dimmer data)
 *           126  ...     the slots
 *
 * @param {object} options { cid, universe, sequence, data, sourceName?, priority?, terminated? }
 */
function encodeSacn(options) {
  const data = options.data;
  if (!Buffer.isBuffer(data) || !data.length || data.length > SLOTS) {
    throw new Error("sACN takes 1-" + SLOTS + " slots");
  }
  // Receivers merge by CID, so two senders sharing one would be taken for the
  // same source and fight over the universe.
  if (!Buffer.isBuffer(options.cid) || options.cid.length !== 16) {
    throw new Error("an sACN CID is 16 bytes");
  }

  const length = SACN_HEADER + data.length;
  const buf = Buffer.alloc(length);

  buf.writeUInt16BE(0x0010, 0);
  buf.writeUInt16BE(0x0000, 2);
  buf.write(ACN_PACKET_ID, 4, "ascii");
  buf.writeUInt16BE(PDU_FLAGS | (length - ROOT_LENGTH_AT), ROOT_LENGTH_AT);
  buf.writeUInt32BE(VECTOR_ROOT_E131_DATA, 18);
  options.cid.copy(buf, 22);

  buf.writeUInt16BE(PDU_FLAGS | (length - FRAMING_AT), FRAMING_AT);
  buf.writeUInt32BE(VECTOR_E131_DATA_PACKET, 40);
  // One byte short of the field, so the name is null terminated even when it
  // fills it.
  buf.write(String(options.sourceName || "OSCAR"), 44, SOURCE_NAME_BYTES - 1, "utf8");
  buf[108] = options.priority === undefined ? DEFAULT_PRIORITY : options.priority;
  buf.writeUInt16BE(0, 109);
  buf[111] = options.sequence & 0xff;
  buf[112] = options.terminated ? OPT_STREAM_TERMINATED : 0x00;
  buf.writeUInt16BE(options.universe, 113);

  buf.writeUInt16BE(PDU_FLAGS | (length - DMP_AT), DMP_AT);
  buf[117] = VECTOR_DMP_SET_PROPERTY;
  buf[118] = 0xa1;
  buf.writeUInt16BE(0x0000, 119);
  buf.writeUInt16BE(0x0001, 121);
  buf.writeUInt16BE(data.length + 1, 123);
  buf[125] = 0x00;
  data.copy(buf, SACN_HEADER);
  return buf;
}

module.exports = {
  encodeArtDmx,
  encodeSacn,
  ARTNET_HEADER,
  SACN_HEADER,
  DEFAULT_PRIORITY,
  OPT_STREAM_TERMINATED,
};
