"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { createUsbDmx, pickPort, proPacket, openDmxPacket, portSettings, OPEN_RETRY_MS, OPEN_DMX_FRAME_MS } = require("../../lib/dmx/usb");
const { createDmxOutput } = require("../../lib/dmx/output");
const { buildRequest } = require("../../lib/dmx/request");
const { PROTOCOLS, isUsb, defaultHost, readTarget } = require("../../lib/dmx/spec");
const { dmxChecks } = require("../../lib/widgets/fields");
const { SLOTS } = require("../../lib/dmx/spec");

const settle = () => new Promise((resolve) => setImmediate(resolve));

function fakeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++nextId;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        let due = null;
        for (const [id, timer] of timers) if (!due || timer.at < due[1].at) due = [id, timer];
        if (!due || due[1].at > until) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
        for (let i = 0; i < 4; i++) await settle();
      }
      now = until;
      for (let i = 0; i < 4; i++) await settle();
    },
    pending: () => timers.size,
  };
}

/** A serial port that remembers what was done to it. */
function fakePort(path) {
  const port = {
    path,
    written: [],
    breaks: [],
    closed: false,
    handlers: {},
    write(buf, cb) {
      port.written.push(Buffer.from(buf));
      cb(null);
    },
    set(opts, cb) {
      port.breaks.push(!!opts.brk);
      cb(null);
    },
    close(cb) {
      port.closed = true;
      cb(null);
    },
    on(event, fn) {
      port.handlers[event] = fn;
    },
  };
  return port;
}

function rig(options) {
  options = options || {};
  const ports = options.ports || [{ path: "COM3", manufacturer: "FTDI", vendorId: "0403" }];
  const opened = [];
  const errors = [];
  const status = [];
  const clock = fakeClock();
  const usb = createUsbDmx({
    list: async () => ports,
    open: async (path, kind) => {
      if (options.refuse && options.refuse(path)) throw new Error("Access denied");
      const port = fakePort(path);
      port.kind = kind;
      opened.push(port);
      return port;
    },
    clock,
    onError: (err, path) => errors.push([path, err.message]),
    onStatus: (text) => status.push(text),
  });
  return { usb, opened, errors, status, clock, ports };
}

const frame = (level) => Buffer.alloc(SLOTS, level);

// ---- the packets ------------------------------------------------------------

test("the Pro packet is the Enttec framing: 7E, label 6, 513 little-endian, start code 0, the levels, E7", () => {
  const packet = proPacket(frame(0x80));
  assert.strictEqual(packet.length, 518);
  assert.deepStrictEqual([...packet.slice(0, 5)], [0x7e, 6, 0x01, 0x02, 0]);
  assert.strictEqual(packet[5], 0x80);
  assert.strictEqual(packet[516], 0x80);
  assert.strictEqual(packet[517], 0xe7);
  const open = openDmxPacket(frame(7));
  assert.strictEqual(open.length, 513);
  assert.strictEqual(open[0], 0, "the start code");
  assert.strictEqual(open[512], 7);
  assert.deepStrictEqual(portSettings("opendmx"), { baudRate: 250000, dataBits: 8, stopBits: 2, parity: "none" }, "DMX's own line settings");
  assert.strictEqual(portSettings("usbpro").stopBits, 2);
});

test("which port: by name, by a part of it or its maker, or the first FTDI interface, or the first port at all", () => {
  const ports = [
    { path: "COM1", manufacturer: "Microsoft" },
    { path: "COM3", manufacturer: "FTDI", vendorId: "0403" },
    { path: "/dev/ttyUSB1", manufacturer: "DMXking", vendorId: "0403" },
  ];
  assert.strictEqual(pickPort(ports, "COM3"), "COM3");
  assert.strictEqual(pickPort(ports, "com3"), "COM3");
  assert.strictEqual(pickPort(ports, "ttyUSB"), "/dev/ttyUSB1");
  assert.strictEqual(pickPort(ports, "dmxking"), "/dev/ttyUSB1");
  assert.strictEqual(pickPort(ports, ""), "COM3", "the first FTDI, not the first port");
  assert.strictEqual(pickPort([{ path: "COM9" }], ""), "COM9", "no FTDI: the first there is");
  assert.strictEqual(pickPort(ports, "COM7"), null);
  assert.strictEqual(pickPort([], ""), null);
});

// ---- the driver ---------------------------------------------------------------

test("a Pro interface: opened on the first frame, held, and handed each frame framed", async () => {
  const { usb, opened, status, errors } = rig();
  await usb.send("usbpro", "", frame(10));
  await usb.send("usbpro", "COM3", frame(20));
  assert.strictEqual(opened.length, 1, "opened once, kept open");
  assert.strictEqual(opened[0].kind, "usbpro");
  assert.deepStrictEqual(opened[0].written.map((b) => [b[0], b[5], b[517]]), [[0x7e, 10, 0xe7], [0x7e, 20, 0xe7]]);
  assert.deepStrictEqual(opened[0].breaks, [], "the interface makes its own signal");
  assert.deepStrictEqual(status, ["USB DMX: sending to COM3 (Enttec Pro)"]);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(usb.active(), [{ path: "COM3", kind: "usbpro" }]);
  await usb.release("usbpro", "");
  assert.ok(opened[0].closed, "released: the port is let go of");
  assert.deepStrictEqual(usb.active(), []);
});

test("an Open DMX interface: a break and the frame, forty times a second, for as long as it is driven", async () => {
  const { usb, opened, clock } = rig();
  await usb.send("opendmx", "", frame(99));
  await clock.advance(2); // the first frame: the break, a millisecond, the levels
  assert.strictEqual(opened.length, 1);
  assert.strictEqual(opened[0].kind, "opendmx");
  assert.deepStrictEqual(opened[0].breaks, [true, false], "break on, a moment, break off");
  assert.strictEqual(opened[0].written.length, 1);
  assert.strictEqual(opened[0].written[0][1], 99);
  await clock.advance(OPEN_DMX_FRAME_MS * 4);
  assert.ok(opened[0].written.length >= 4, "repeated without being asked: " + opened[0].written.length);
  // A new level goes out on the next frame; nothing is written per call.
  await usb.send("opendmx", "", frame(5));
  await clock.advance(OPEN_DMX_FRAME_MS);
  assert.strictEqual(opened[0].written[opened[0].written.length - 1][1], 5);
  const before = opened[0].written.length;
  // Releasing waits a few frames on the clock, so the clock is moved while it does.
  const releasing = usb.release("opendmx", "");
  await clock.advance(OPEN_DMX_FRAME_MS * 10);
  await releasing;
  assert.ok(opened[0].closed);
  assert.ok(opened[0].written.length - before <= 6, "a few zero frames, then quiet");
});

test("no interface, or one that cannot be opened: said once, and tried again after a while", async () => {
  const { usb, errors, opened } = rig({ ports: [] });
  await usb.send("usbpro", "", frame(1));
  await usb.send("usbpro", "", frame(2));
  assert.deepStrictEqual(errors, [["", "no USB DMX interface is plugged in"]], "once");
  await usb.send("usbpro", "COM9", frame(2));
  assert.deepStrictEqual(errors[1], ["COM9", "no serial port called COM9"]);
  assert.strictEqual(opened.length, 0);

  let refuse = true;
  const busy = rig({ refuse: () => refuse });
  await busy.usb.send("usbpro", "", frame(1));
  await busy.usb.send("usbpro", "", frame(1));
  assert.deepStrictEqual(busy.errors, [["COM3", "Access denied"]], "one line, however many frames");
  refuse = false;
  await busy.usb.send("usbpro", "", frame(1));
  assert.strictEqual(busy.opened.length, 0, "not tried again at once");
  // Only the wall clock decides the retry; the fake clock does not drive Date.now().
  const realNow = Date.now;
  Date.now = () => realNow() + OPEN_RETRY_MS + 1;
  try {
    await busy.usb.send("usbpro", "", frame(3));
  } finally {
    Date.now = realNow;
  }
  assert.strictEqual(busy.opened.length, 1, "tried again, and it worked");
  assert.strictEqual(busy.opened[0].written[0][5], 3);
});

// ---- through the output ----------------------------------------------------------

test("a USB protocol is a universe like the others: merged, refreshed, released to zero, and sent as the bare frame with where it is for", async () => {
  const sent = [];
  const clock = fakeClock();
  const out = createDmxOutput((packet, port, host, target) => sent.push({ packet, port, host, target }), { clock, minIntervalMs: 0 });
  const request = buildRequest({ protocol: "usbpro", host: "COM3", universe: 1, channel: 1, levels: [200], source: "fader" });
  assert.ok(request, "a port name is a fine host on USB");
  await out.set("fader", request);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].port, null, "no port number on a serial port");
  assert.strictEqual(sent[0].host, "COM3");
  assert.deepStrictEqual(sent[0].target, { protocol: "usbpro", host: "COM3", port: null, universe: 1 });
  assert.strictEqual(sent[0].packet.length, SLOTS, "the bare frame; the driver frames it");
  assert.strictEqual(sent[0].packet[0], 200);
  await out.stop("fader");
  assert.strictEqual(sent[sent.length - 1].packet[0], 0, "released to zero");
  assert.deepStrictEqual(out.universes(), []);

  assert.strictEqual(buildRequest({ protocol: "usbpro", host: "", universe: 1, channel: 1, levels: [1], source: "s" }).host, "", "blank: the first interface");
  assert.strictEqual(buildRequest({ protocol: "usbpro", host: "/dev/ttyUSB0", universe: 1, channel: 1, levels: [1], source: "s" }).host, "/dev/ttyUSB0");
  assert.strictEqual(buildRequest({ protocol: "usbpro", host: "COM3", universe: 2, channel: 1, levels: [1], source: "s" }), null, "an interface is one universe");
  assert.strictEqual(buildRequest({ protocol: "artnet", host: "/dev/ttyUSB0", universe: 1, channel: 1, levels: [1], source: "s" }), null, "a port name is not a node");
});

test("the spec and the panel know the two USB protocols", () => {
  assert.deepStrictEqual(PROTOCOLS.map((p) => p.id), ["artnet", "sacn", "usbpro", "opendmx"]);
  assert.ok(isUsb("usbpro") && isUsb("opendmx") && !isUsb("artnet") && !isUsb("nope"));
  assert.strictEqual(defaultHost("usbpro", 1), "");
  assert.strictEqual(readTarget("opendmx", " com3 "), "com3");
  assert.strictEqual(readTarget("opendmx", "COM 3"), null, "a space is not in a port's name");
  assert.strictEqual(readTarget("artnet", "COM3"), "COM3", "which is a fine hostname elsewhere");
  const checks = dmxChecks(1);
  assert.strictEqual(checks.dmxHost("COM3", { dmxProtocol: "usbpro" }), null);
  assert.strictEqual(checks.dmxHost("/dev/ttyUSB0", { dmxProtocol: "opendmx" }), null);
  assert.strictEqual(checks.dmxHost("", { dmxProtocol: "usbpro" }), null);
  assert.match(checks.dmxHost("/dev/ttyUSB0", { dmxProtocol: "artnet" }), /IP address or a host name/);
  assert.match(checks.dmxHost("COM 3", { dmxProtocol: "usbpro" }), /serial port's name/);
  assert.strictEqual(checks.dmxUniverse(1, { dmxProtocol: "usbpro" }), null);
  assert.notStrictEqual(checks.dmxUniverse(2, { dmxProtocol: "usbpro" }), null);
});
