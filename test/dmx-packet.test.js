"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { encodeArtDmx, encodeSacn } = require("../lib/dmx/packet");
const { SLOTS } = require("../lib/dmx/spec");

/**
 * These check bytes, not behaviour, and they are the most valuable tests in
 * OSCAR's DMX support. A wrong byte in either header does not throw, does not
 * log and does not fail a send -- the packet goes out, the node discards it,
 * and the fixture simply never moves. There is nothing for a user to see and
 * nothing for them to try. So every field of both headers is pinned here
 * against the specification.
 */

const CID = Buffer.from("0123456789abcdef0123456789abcdef", "hex");

function frame(fill) {
  const data = Buffer.alloc(SLOTS);
  if (fill !== undefined) data.fill(fill);
  return data;
}

// --- Art-Net ArtDmx ---------------------------------------------------------

test("ArtDmx carries the header Art-Net 4 specifies", () => {
  const packet = encodeArtDmx(0x1234, 7, frame(0));

  assert.strictEqual(packet.length, 18 + SLOTS, "18-byte header then the slots");
  assert.strictEqual(packet.subarray(0, 8).toString("ascii"), "Art-Net\0");
  // OpDmx is 0x5000, and Art-Net writes its OpCodes low byte first -- the one
  // little-endian field in an otherwise big-endian protocol.
  assert.deepStrictEqual([...packet.subarray(8, 10)], [0x00, 0x50]);
  assert.deepStrictEqual([...packet.subarray(10, 12)], [0x00, 14], "protocol revision 14, big-endian");
  assert.strictEqual(packet[12], 7, "sequence");
  assert.strictEqual(packet[13], 0, "physical port is informational");
  assert.deepStrictEqual([...packet.subarray(16, 18)], [0x02, 0x00], "512 slots, big-endian");
});

test("a 15-bit universe splits into SubUni and Net the way Art-Net addresses it", () => {
  // 0x1234: low byte is the sub-net and universe nibbles, high byte is the Net.
  const packet = encodeArtDmx(0x1234, 1, frame(0));
  assert.strictEqual(packet[14], 0x34, "SubUni");
  assert.strictEqual(packet[15], 0x12, "Net");

  // Universe 0 is a real Art-Net universe, not "unset".
  assert.deepStrictEqual([...encodeArtDmx(0, 1, frame(0)).subarray(14, 16)], [0, 0]);

  // The Net field is 7 bits; the 16th bit of a Port-Address does not exist.
  assert.strictEqual(encodeArtDmx(0xffff, 1, frame(0))[15], 0x7f);
});

test("the slots land immediately after the header, untouched", () => {
  const data = frame(0);
  data[0] = 255; // channel 1
  data[511] = 128; // channel 512
  const packet = encodeArtDmx(1, 1, data);

  assert.strictEqual(packet[18], 255, "channel 1 is the first byte of the payload");
  assert.strictEqual(packet[18 + 511], 128, "channel 512 is the last");
});

test("ArtDmx refuses a slot count no node would accept", () => {
  // The spec allows 2-512 slots and requires an even count. An odd-length frame
  // is dropped by nodes without a word, so it is caught here instead.
  assert.throws(() => encodeArtDmx(1, 1, Buffer.alloc(0)));
  assert.throws(() => encodeArtDmx(1, 1, Buffer.alloc(9)));
  assert.throws(() => encodeArtDmx(1, 1, Buffer.alloc(SLOTS + 2)));
});

// --- sACN / ANSI E1.31 ------------------------------------------------------

test("an E1.31 data packet carries the root layer the standard specifies", () => {
  const packet = encodeSacn({ cid: CID, sourceName: "OSCAR", universe: 1, sequence: 5, data: frame(0) });
  const length = 126 + SLOTS;

  assert.strictEqual(packet.length, length, "126-byte header then the slots");
  assert.deepStrictEqual([...packet.subarray(0, 2)], [0x00, 0x10], "preamble size");
  assert.deepStrictEqual([...packet.subarray(2, 4)], [0x00, 0x00], "post-amble size");
  assert.strictEqual(packet.subarray(4, 16).toString("ascii"), "ASC-E1.17\0\0\0");
  assert.strictEqual(packet.readUInt16BE(16), 0x7000 | (length - 16), "root flags and PDU length");
  assert.strictEqual(packet.readUInt32BE(18), 0x00000004, "VECTOR_ROOT_E131_DATA");
  assert.deepStrictEqual(packet.subarray(22, 38), CID, "the sender's CID");
});

test("the framing layer names the source, the priority and the universe", () => {
  const packet = encodeSacn({ cid: CID, sourceName: "OSCAR", universe: 258, sequence: 5, data: frame(0) });
  const length = 126 + SLOTS;

  assert.strictEqual(packet.readUInt16BE(38), 0x7000 | (length - 38), "framing flags and length");
  assert.strictEqual(packet.readUInt32BE(40), 0x00000002, "VECTOR_E131_DATA_PACKET");
  assert.strictEqual(packet.subarray(44, 49).toString("utf8"), "OSCAR");
  assert.strictEqual(packet[44 + 63], 0, "the 64-byte name field ends in a null");
  assert.strictEqual(packet[108], 100, "default priority");
  assert.strictEqual(packet.readUInt16BE(109), 0, "no synchronization universe");
  assert.strictEqual(packet[111], 5, "sequence");
  assert.strictEqual(packet[112], 0x00, "options");
  assert.strictEqual(packet.readUInt16BE(113), 258, "universe, big-endian");
});

test("a source name too long for the field is cut short of the null, not through it", () => {
  // A name filling all 64 bytes would leave no terminator, and a receiver
  // reading the field as a string would run into the priority byte.
  const packet = encodeSacn({
    cid: CID,
    sourceName: "x".repeat(200),
    universe: 1,
    sequence: 1,
    data: frame(0),
  });
  assert.strictEqual(packet[44 + 62], 0x78);
  assert.strictEqual(packet[44 + 63], 0, "still null terminated");
  assert.strictEqual(packet[108], 100, "and the priority byte is intact");
});

test("the DMP layer describes 512 slots behind a start code", () => {
  const packet = encodeSacn({ cid: CID, universe: 1, sequence: 1, data: frame(0) });
  const length = 126 + SLOTS;

  assert.strictEqual(packet.readUInt16BE(115), 0x7000 | (length - 115), "DMP flags and length");
  assert.strictEqual(packet[117], 0x02, "VECTOR_DMP_SET_PROPERTY");
  assert.strictEqual(packet[118], 0xa1, "address and data type");
  assert.strictEqual(packet.readUInt16BE(119), 0x0000, "first property address");
  assert.strictEqual(packet.readUInt16BE(121), 0x0001, "address increment");
  assert.strictEqual(packet.readUInt16BE(123), SLOTS + 1, "the slots plus the start code");
  assert.strictEqual(packet[125], 0x00, "DMX start code");
});

test("sACN slots start at byte 126, so channel 1 is where a fixture expects it", () => {
  const data = frame(0);
  data[0] = 200;
  data[511] = 1;
  const packet = encodeSacn({ cid: CID, universe: 1, sequence: 1, data: data });

  assert.strictEqual(packet[126], 200, "channel 1");
  assert.strictEqual(packet[126 + 511], 1, "channel 512");
});

test("a terminating packet sets the Stream_Terminated bit and nothing else", () => {
  const plain = encodeSacn({ cid: CID, universe: 1, sequence: 1, data: frame(0) });
  const bye = encodeSacn({ cid: CID, universe: 1, sequence: 1, data: frame(0), terminated: true });

  assert.strictEqual(bye[112], 0x40, "options bit 6");
  assert.strictEqual(plain[112], 0x00);
  // Everything either side of the options byte is the same packet.
  assert.deepStrictEqual(bye.subarray(0, 112), plain.subarray(0, 112));
  assert.deepStrictEqual(bye.subarray(113), plain.subarray(113));
});

test("priority is settable, because it is how two senders are ranked", () => {
  const packet = encodeSacn({ cid: CID, universe: 1, sequence: 1, data: frame(0), priority: 200 });
  assert.strictEqual(packet[108], 200);
});

test("a CID that is not 16 bytes is refused rather than padded", () => {
  // Receivers merge by CID. Silently padding a short one would make two OSCARs
  // look like a single source, and they would overwrite each other.
  assert.throws(() => encodeSacn({ cid: Buffer.alloc(8), universe: 1, sequence: 1, data: frame(0) }));
  assert.throws(() => encodeSacn({ cid: "not a buffer", universe: 1, sequence: 1, data: frame(0) }));
});
