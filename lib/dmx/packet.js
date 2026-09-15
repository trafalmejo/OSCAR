"use strict";

const { SLOTS } = require("./spec");

/**
 * Art-Net and sACN (ANSI E1.31) packet encoders.
 *
 * Both formats are a fixed header followed by the DMX slots, so they are built
 * with Buffer directly rather than a dependency: the whole of each format that
 * OSCAR needs is on this page, which is also the only way to check it against
 * the specification. A wrong byte here is invisible -- the fixture simply does
 * nothing and nothing anywhere reports an error -- so every field below is
 * covered by test/dmx-packet.test.js.
 */

const ARTNET_ID = "Art-Net\0";
const OP_DMX = 0x5000;
const ART_PROT_VER = 14;

/**
 * ArtDmx (OpCode 0x5000).
 *
 *   0   8 bytes  "Art-Net\0"
 *   8   uint16   OpCode, little-endian -- the one LE field in the protocol
 *  10   uint16   protocol revision, big-endian (14)
 *  12   uint8    sequence, 1-255 (0 disables the receiver's ordering check)
 *  13   uint8    physical input port, informational only
 *  14   uint8    SubUni: the low byte of the 15-bit Port-Address
 *  15   uint8    Net: the high 7 bits of the Port-Address
 *  16   uint16   slot count, big-endian, even, 2-512
 *  18   ...      the slots
 *
 * @param {number} universe 15-bit Port-Address
 * @param {number} sequence 1-255
 * @param {Buffer} data     the DMX slots
 */
function encodeArtDmx(universe, sequence, data) {
  if (!data.length || data.length > SLOTS || data.length % 2 !== 0) {
    // The spec allows 2-512 slots and requires an even count. OSCAR always
    // sends a full universe, so reaching this means a caller built a frame by
    // hand and would otherwise put a packet no node accepts on the wire.
    throw new Error("Art-Net takes an even number of slots, 2-" + SLOTS);
  }

  const buf = Buffer.alloc(18 + data.length);
  buf.write(ARTNET_ID, 0, "ascii");
  buf.writeUInt16LE(OP_DMX, 8);
  buf.writeUInt16BE(ART_PROT_VER, 10);
  buf[12] = sequence & 0xff;
  buf[13] = 0;
  buf[14] = universe & 0xff;
  buf[15] = (universe >> 8) & 0x7f;
  buf.writeUInt16BE(data.length, 16);
  data.copy(buf, 18);
  return buf;
}

const ACN_PACKET_ID = "ASC-E1.17";
const VECTOR_ROOT_E131_DATA = 0x00000004;
const VECTOR_E131_DATA_PACKET = 0x00000002;
const VECTOR_DMP_SET_PROPERTY = 0x02;
/** Flags 0x7 in the top nibble, PDU length in the low 12 bits. */
const PDU_FLAGS = 0x7000;
/** Every layer's length is measured from where that layer starts. */
const ROOT_AT = 0;
const FRAMING_AT = 38;
const DMP_AT = 115;
const DATA_AT = 126;

const SOURCE_NAME_BYTES = 64;
const DEFAULT_PRIORITY = 100;
/** E1.31 6.2.6: a source leaving sets this bit so receivers drop it at once. */
const OPT_STREAM_TERMINATED = 0x40;

/**
 * An E1.31 data packet: root layer, framing layer, DMP layer, slots.
 *
 *   ROOT     0   uint16  preamble size (0x0010)
 *            2   uint16  post-amble size (0x0000)
 *            4   12 B    "ASC-E1.17", null padded
 *           16   uint16  flags + length of everything from byte 16
 *           18   uint32  VECTOR_ROOT_E131_DATA
 *           22   16 B    CID -- this sender's identity, stable for the run
 *   FRAMING 38   uint16  flags + length of everything from byte 38
 *           40   uint32  VECTOR_E131_DATA_PACKET
 *           44   64 B    source name, UTF-8, null terminated
 *          108   uint8   priority, 0-200 (100 is the default)
 *          109   uint16  synchronization universe (0 = unsynchronised)
 *          111   uint8   sequence, wrapping 0-255
 *          112   uint8   options
 *          113   uint16  universe
 *   DMP    115   uint16  flags + length of everything from byte 115
 *          117   uint8   VECTOR_DMP_SET_PROPERTY
 *          118   uint8   address and data type (0xa1)
 *          119   uint16  first property address (0x0000)
 *          121   uint16  address increment (0x0001)
 *          123   uint16  property value count -- slots plus the start code
 *          125   uint8   DMX start code (0x00 for dimmer data)
 *          126   ...     the slots
 */
function encodeSacn(options) {
  const data = options.data;
  const length = DATA_AT + data.length;
  const buf = Buffer.alloc(length);

  buf.writeUInt16BE(0x0010, ROOT_AT);
  buf.writeUInt16BE(0x0000, ROOT_AT + 2);
  buf.write(ACN_PACKET_ID, ROOT_AT + 4, "ascii");
  buf.writeUInt16BE(PDU_FLAGS | (length - 16), 16);
  buf.writeUInt32BE(VECTOR_ROOT_E131_DATA, 18);
  toCid(options.cid).copy(buf, 22);

  buf.writeUInt16BE(PDU_FLAGS | (length - FRAMING_AT), FRAMING_AT);
  buf.writeUInt32BE(VECTOR_E131_DATA_PACKET, FRAMING_AT + 2);
  // One byte short of the field so the name is always null terminated, even
  // when someone's source name fills it.
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
  data.copy(buf, DATA_AT);
  return buf;
}

/**
 * The CID is a UUID identifying this sender. Receivers merge by CID, so two
 * senders sharing one would be taken for the same source and fight.
 */
function toCid(cid) {
  if (!Buffer.isBuffer(cid) || cid.length !== 16) {
    throw new Error("an sACN CID is 16 bytes");
  }
  return cid;
}

module.exports = {
  encodeArtDmx,
  encodeSacn,
  ARTNET_ID,
  OP_DMX,
  ART_PROT_VER,
  ACN_PACKET_ID,
  DATA_AT,
  DEFAULT_PRIORITY,
  OPT_STREAM_TERMINATED,
};
