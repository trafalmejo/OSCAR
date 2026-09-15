"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  encodeArtDmx,
  encodeSacn,
  ARTNET_HEADER,
  SACN_HEADER,
  DEFAULT_PRIORITY,
  OPT_STREAM_TERMINATED,
} = require("../../lib/dmx/packet");
const { SLOTS } = require("../../lib/dmx/spec");

/**
 * Every header byte is pinned here, one field at a time. A wrong byte
 * produces no error anywhere -- the fixture simply never moves -- so this is
 * the only place a mistake in the encoders can be caught.
 */

function frame(fill) {
  const data = Buffer.alloc(SLOTS);
  if (fill) fill(data);
  return data;
}

// --- Art-Net ----------------------------------------------------------------

test("ArtDmx: every header byte", () => {
  const data = frame((d) => {
    d[0] = 255;
    d[1] = 128;
    d[511] = 7;
  });
  // Universe 0x1234: Net 0x12, SubUni 0x34.
  const packet = encodeArtDmx(0x1234, 200, data);

  assert.strictEqual(packet.length, ARTNET_HEADER + SLOTS);
  assert.deepStrictEqual([...packet.subarray(0, 8)], [0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00], '"Art-Net" and a null');
  assert.deepStrictEqual([...packet.subarray(8, 10)], [0x00, 0x50], "OpDmx 0x5000, little-endian");
  assert.deepStrictEqual([...packet.subarray(10, 12)], [0x00, 0x0e], "protocol revision 14, big-endian");
  assert.strictEqual(packet[12], 200, "sequence");
  assert.strictEqual(packet[13], 0, "physical port");
  assert.strictEqual(packet[14], 0x34, "SubUni: the low byte of the Port-Address");
  assert.strictEqual(packet[15], 0x12, "Net: the high bits");
  assert.deepStrictEqual([...packet.subarray(16, 18)], [0x02, 0x00], "512 slots, big-endian");
  assert.strictEqual(packet[18], 255, "channel 1");
  assert.strictEqual(packet[19], 128, "channel 2");
  assert.strictEqual(packet[18 + 511], 7, "channel 512");
});

test("ArtDmx: the Port-Address is 15 bits and the sequence one byte", () => {
  const packet = encodeArtDmx(0x7fff, 255, frame());
  assert.strictEqual(packet[14], 0xff);
  assert.strictEqual(packet[15], 0x7f);
  assert.strictEqual(packet[12], 255);
  const bit16 = encodeArtDmx(0x8001, 256, frame());
  assert.strictEqual(bit16[15], 0x00, "a 16th bit does not leak into Net");
  assert.strictEqual(bit16[12], 0, "and the sequence wraps rather than overflowing the byte");
});

test("ArtDmx: universe 0 is an ordinary address", () => {
  const packet = encodeArtDmx(0, 1, frame());
  assert.strictEqual(packet[14], 0);
  assert.strictEqual(packet[15], 0);
});

test("ArtDmx: a partial frame keeps its own length, and odd or absurd ones are refused", () => {
  const packet = encodeArtDmx(0, 1, Buffer.alloc(24));
  assert.deepStrictEqual([...packet.subarray(16, 18)], [0x00, 0x18]);
  assert.strictEqual(packet.length, ARTNET_HEADER + 24);
  assert.throws(() => encodeArtDmx(0, 1, Buffer.alloc(3)), /even/);
  assert.throws(() => encodeArtDmx(0, 1, Buffer.alloc(0)), /even/);
  assert.throws(() => encodeArtDmx(0, 1, Buffer.alloc(514)), /even/);
  assert.throws(() => encodeArtDmx(0, 1, [0, 0]), /even/);
});

// --- sACN -------------------------------------------------------------------

const CID = Buffer.from("0123456789abcdef0123456789abcdef", "hex");

function sacn(overrides) {
  return encodeSacn(
    Object.assign({ cid: CID, universe: 1, sequence: 5, data: frame(), sourceName: "OSCAR" }, overrides)
  );
}

test("E1.31: the root layer, byte by byte", () => {
  const packet = sacn({});
  assert.strictEqual(packet.length, SACN_HEADER + SLOTS, "638 bytes for a whole universe");
  assert.deepStrictEqual([...packet.subarray(0, 2)], [0x00, 0x10], "preamble size");
  assert.deepStrictEqual([...packet.subarray(2, 4)], [0x00, 0x00], "post-amble size");
  assert.deepStrictEqual(
    [...packet.subarray(4, 16)],
    [0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00],
    '"ASC-E1.17" null padded to 12 bytes'
  );
  // 638 - 16 = 622 = 0x26e, under flags 0x7.
  assert.deepStrictEqual([...packet.subarray(16, 18)], [0x72, 0x6e], "root flags and length");
  assert.deepStrictEqual([...packet.subarray(18, 22)], [0x00, 0x00, 0x00, 0x04], "VECTOR_ROOT_E131_DATA");
  assert.deepStrictEqual(packet.subarray(22, 38), CID, "the CID");
});

test("E1.31: the framing layer, byte by byte", () => {
  const data = frame();
  const packet = sacn({ universe: 0x0102, sequence: 0xab, data });
  // 638 - 38 = 600 = 0x258.
  assert.deepStrictEqual([...packet.subarray(38, 40)], [0x72, 0x58], "framing flags and length");
  assert.deepStrictEqual([...packet.subarray(40, 44)], [0x00, 0x00, 0x00, 0x02], "VECTOR_E131_DATA_PACKET");
  assert.strictEqual(packet.subarray(44, 49).toString("utf8"), "OSCAR", "source name");
  assert.deepStrictEqual([...packet.subarray(49, 108)], new Array(59).fill(0), "null padded to 64 bytes");
  assert.strictEqual(packet[108], DEFAULT_PRIORITY, "priority 100");
  assert.strictEqual(DEFAULT_PRIORITY, 100);
  assert.deepStrictEqual([...packet.subarray(109, 111)], [0x00, 0x00], "no synchronization address");
  assert.strictEqual(packet[111], 0xab, "sequence");
  assert.strictEqual(packet[112], 0x00, "options: nothing set on a data packet");
  assert.deepStrictEqual([...packet.subarray(113, 115)], [0x01, 0x02], "universe, big-endian");
});

test("E1.31: the DMP layer and the slots, byte by byte", () => {
  const packet = sacn({
    data: frame((d) => {
      d[0] = 10;
      d[511] = 20;
    }),
  });
  // 638 - 115 = 523 = 0x20b.
  assert.deepStrictEqual([...packet.subarray(115, 117)], [0x72, 0x0b], "DMP flags and length");
  assert.strictEqual(packet[117], 0x02, "VECTOR_DMP_SET_PROPERTY");
  assert.strictEqual(packet[118], 0xa1, "address and data type");
  assert.deepStrictEqual([...packet.subarray(119, 121)], [0x00, 0x00], "first property address");
  assert.deepStrictEqual([...packet.subarray(121, 123)], [0x00, 0x01], "address increment");
  assert.deepStrictEqual([...packet.subarray(123, 125)], [0x02, 0x01], "513 property values: start code plus 512 slots");
  assert.strictEqual(packet[125], 0x00, "DMX start code");
  assert.strictEqual(packet[126], 10, "channel 1");
  assert.strictEqual(packet[126 + 511], 20, "channel 512");
});

test("E1.31: a terminated packet sets only the stream-terminated option", () => {
  const packet = sacn({ terminated: true });
  assert.strictEqual(packet[112], OPT_STREAM_TERMINATED);
  assert.strictEqual(OPT_STREAM_TERMINATED, 0x40);
  assert.strictEqual(sacn({ terminated: false })[112], 0);
});

test("E1.31: priority and the sequence are single bytes, and the name is always terminated", () => {
  assert.strictEqual(sacn({ priority: 200 })[108], 200);
  assert.strictEqual(sacn({ sequence: 256 })[111], 0, "the sequence wraps through zero");
  const long = sacn({ sourceName: "x".repeat(80) });
  assert.strictEqual(long[107], 0, "the 64th byte of the name is a null whatever the name");
  assert.strictEqual(long[106], 0x78, "after 63 bytes of name");
});

test("E1.31: the lengths follow a shorter frame", () => {
  const packet = sacn({ data: Buffer.alloc(24) });
  assert.strictEqual(packet.length, 150);
  assert.strictEqual(packet.readUInt16BE(16) & 0x0fff, 134, "root");
  assert.strictEqual(packet.readUInt16BE(38) & 0x0fff, 112, "framing");
  assert.strictEqual(packet.readUInt16BE(115) & 0x0fff, 35, "DMP");
  assert.strictEqual(packet.readUInt16BE(123), 25, "property values");
});

test("E1.31: a bad CID or an absurd frame is refused, not padded", () => {
  assert.throws(() => sacn({ cid: Buffer.alloc(15) }), /16 bytes/);
  assert.throws(() => sacn({ cid: "0123456789abcdef" }), /16 bytes/);
  assert.throws(() => sacn({ data: Buffer.alloc(0) }), /slots/);
  assert.throws(() => sacn({ data: Buffer.alloc(513) }), /slots/);
});
