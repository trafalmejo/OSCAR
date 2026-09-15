"use strict";

const test = require("node:test");
const assert = require("node:assert");
const dgram = require("node:dgram");

const { openDmxSocket } = require("../../lib/dmx/socket");
const { createDmxOutput } = require("../../lib/dmx/output");
const { buildRequest } = require("../../lib/dmx/request");
const { ARTNET_HEADER } = require("../../lib/dmx/packet");

function listener() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const packets = [];
    socket.on("message", (msg) => packets.push(msg));
    socket.bind(0, "127.0.0.1", () => resolve({ socket, packets, port: socket.address().port }));
  });
}

function open(options) {
  return new Promise((resolve, reject) => {
    const handle = openDmxSocket(
      Object.assign(
        {
          port: 0,
          localAddress: "127.0.0.1",
          onReady: (address) => resolve({ handle, address }),
          onError: reject,
        },
        options
      )
    );
  });
}

const until = (check) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    (function poll() {
      if (check()) return resolve();
      if (Date.now() - started > 2000) return reject(new Error("timed out"));
      setTimeout(poll, 10);
    })();
  });

test("an Art-Net frame built by the output reaches a node through the real socket", async () => {
  const node = await listener();
  const { handle, address } = await open();
  assert.strictEqual(typeof address.port, "number");
  assert.notStrictEqual(address.port, 0, "any free port means a real one once bound");

  // The listener's port stands in for 6454, which may be taken on this machine.
  const stream = createDmxOutput((packet, port, host) => handle.send(packet, node.port, host), {
    onError: (err) => assert.fail(err.message),
  });
  try {
    const request = buildRequest({ protocol: "artnet", host: "127.0.0.1", universe: 0, channel: 1, levels: [255], source: "a" });
    await stream.set("a", request);
    await until(() => node.packets.length >= 1);
    assert.strictEqual(node.packets[0].length, ARTNET_HEADER + 512);
    assert.strictEqual(node.packets[0].toString("ascii", 0, 7), "Art-Net");
    assert.strictEqual(node.packets[0][ARTNET_HEADER], 255);
  } finally {
    stream.close();
    handle.close();
    node.socket.close();
  }
});

test("a port that cannot be bound is reported, and the socket let go of", async () => {
  const taken = await listener();
  try {
    const err = await new Promise((resolve) => {
      openDmxSocket({ port: taken.port, localAddress: "127.0.0.1", onReady: () => resolve(null), onError: resolve });
    });
    assert.ok(err, "an error was reported");
    assert.strictEqual(err.code, "EADDRINUSE");
  } finally {
    taken.socket.close();
  }
});

test("a send after close rejects rather than throwing", async () => {
  const { handle } = await open();
  handle.close();
  await assert.rejects(handle.send(Buffer.alloc(4), 9, "127.0.0.1"));
});
