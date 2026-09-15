"use strict";

const test = require("node:test");
const assert = require("node:assert");
const dgram = require("node:dgram");
const osc = require("osc");

const { parse, plainValue, receiver } = require("../lib/osc-in");
const { MAX_ARGS } = require("../lib/osc-message");

// --- reading a packet -------------------------------------------------------

test("a received message becomes an address and plain values", () => {
  const message = parse({
    address: "/master/level",
    args: [{ type: "f", value: 0.5 }, { type: "i", value: 3 }, { type: "s", value: "go" }],
  });
  assert.deepStrictEqual(message, { address: "/master/level", args: [0.5, 3, "go"] });
});

test("T, F, N and I arrive as their type tag, not as a value", () => {
  // osc.js sets no `value` for these -- the tag is the whole argument, and
  // reading .value would hand every widget undefined.
  const message = parse({ address: "/on", args: [{ type: "T" }, { type: "F" }, { type: "N" }, { type: "I" }] });
  assert.deepStrictEqual(message.args, [true, false, null, true]);
});

test("a value OSCAR cannot read arrives as null, which no widget reads as zero", () => {
  assert.strictEqual(plainValue({ type: "b", value: new Uint8Array([1, 2]) }), null, "a blob");
  assert.strictEqual(plainValue({ type: "t", value: { raw: [0, 0], native: 0 } }), null, "a time tag");
  assert.strictEqual(plainValue({ type: "f", value: NaN }), null);
  assert.strictEqual(plainValue({ type: "f", value: Infinity }), null);
  assert.strictEqual(plainValue({ type: "f" }), null, "a typed argument with no value");
  assert.strictEqual(plainValue({ type: "s", value: 4 }), null, "a string that is not one");
  assert.strictEqual(plainValue(undefined), null);
  assert.strictEqual(plainValue({}), null);
});

test("an int64 comes through as a number whichever way osc.js decoded it", () => {
  assert.strictEqual(plainValue({ type: "h", value: 42 }), 42);
  assert.strictEqual(plainValue({ type: "h", value: { toNumber: () => 42 } }), 42);
  assert.strictEqual(plainValue({ type: "d", value: 1.5 }), 1.5);
});

test("a bare address is a message, with nothing attached", () => {
  assert.deepStrictEqual(parse({ address: "/play" }), { address: "/play", args: [] });
  assert.deepStrictEqual(parse({ address: "/play", args: [] }).args, []);
  assert.deepStrictEqual(parse({ address: "/play", args: { type: "i", value: 1 } }).args, [1], "one bare argument");
});

test("anything that is not an OSC message is refused", () => {
  assert.strictEqual(parse(null), null);
  assert.strictEqual(parse({}), null);
  assert.strictEqual(parse({ address: "" }), null);
  assert.strictEqual(parse({ address: "/" }), null, "a lone slash is not a path");
  assert.strictEqual(parse({ address: "master/level" }), null, "an address starts with /");
  assert.strictEqual(parse({ address: 7 }), null);
});

test("an absurd number of arguments is dropped rather than relayed", () => {
  const args = new Array(MAX_ARGS + 1).fill({ type: "f", value: 1 });
  assert.strictEqual(parse({ address: "/flood", args }), null);
  assert.ok(parse({ address: "/ok", args: args.slice(1) }));
});

test("the sender is not kept -- which machine moved a fader is not a widget's business", () => {
  const message = parse({ address: "/x", args: [{ type: "f", value: 1 }], sender: "10.0.0.9" });
  assert.deepStrictEqual(Object.keys(message).sort(), ["address", "args"]);
});

// --- the socket -------------------------------------------------------------

function open(options) {
  return new Promise((resolve, reject) => {
    const handle = receiver(
      Object.assign(
        {
          UDPPort: osc.UDPPort,
          localAddress: "127.0.0.1",
          onReady: (udp) => resolve({ handle, port: udp.socket.address().port }),
          onError: (err) => reject(err),
        },
        options
      )
    );
  });
}

function sendPacket(port, packet) {
  const socket = dgram.createSocket("udp4");
  const buffer = Buffer.from(osc.writePacket(packet, { metadata: true }));
  return new Promise((resolve, reject) => {
    socket.send(buffer, port, "127.0.0.1", (err) => {
      socket.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

test("a message on the wire reaches onMessage as plain values", async () => {
  const heard = [];
  let wake;
  const arrived = new Promise((resolve) => (wake = resolve));
  const { handle, port } = await open({
    port: 0,
    onMessage: (message) => {
      heard.push(message);
      wake();
    },
  });
  try {
    await sendPacket(port, { address: "/slider1", args: [{ type: "f", value: 0.25 }] });
    await arrived;
    assert.deepStrictEqual(heard, [{ address: "/slider1", args: [0.25] }]);
  } finally {
    handle.close();
  }
});

test("a bundle is unpacked into its messages", async () => {
  const heard = [];
  let wake;
  const arrived = new Promise((resolve) => (wake = resolve));
  const { handle, port } = await open({
    port: 0,
    onMessage: (message) => {
      heard.push(message.address);
      if (heard.length === 2) wake();
    },
  });
  try {
    await sendPacket(port, {
      timeTag: osc.timeTag(0),
      packets: [
        { address: "/a", args: [{ type: "i", value: 1 }] },
        { address: "/b", args: [{ type: "i", value: 2 }] },
      ],
    });
    await arrived;
    assert.deepStrictEqual(heard, ["/a", "/b"]);
  } finally {
    handle.close();
  }
});

test("a busy port is reported and does not throw", async () => {
  // Something else -- another OSCAR, TouchOSC's own bridge -- already holds
  // the port. The server must keep running and keep sending.
  const taken = dgram.createSocket("udp4");
  await new Promise((resolve) => taken.bind(0, "127.0.0.1", resolve));
  const port = taken.address().port;

  let handle;
  try {
    const err = await new Promise((resolve, reject) => {
      handle = receiver({
        UDPPort: osc.UDPPort,
        localAddress: "127.0.0.1",
        port,
        onMessage: () => reject(new Error("nothing should arrive")),
        onReady: () => reject(new Error("the port was busy; it must not bind")),
        onError: resolve,
      });
    });
    assert.strictEqual(err.code, "EADDRINUSE");
    assert.doesNotThrow(() => handle.close(), "closing after a failed bind is safe");
    assert.doesNotThrow(() => handle.close(), "and so is closing twice");
  } finally {
    taken.close();
  }
});
