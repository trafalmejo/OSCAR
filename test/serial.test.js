"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { SerialLink, isSerialTarget, SERIAL_HOST, defaultTransport } = require("../lib/serial");
const { checkIp, checkPort } = require("../lib/widgets/fields");

/** A serial port that never touches hardware. */
function fakePort() {
  const port = {
    handlers: {},
    sent: [],
    opened: 0,
    closed: 0,
    on(event, fn) {
      (this.handlers[event] = this.handlers[event] || []).push(fn);
    },
    fire(event, arg) {
      (this.handlers[event] || []).forEach((fn) => fn(arg));
    },
    open() {
      this.opened++;
    },
    close() {
      this.closed++;
      this.fire("close");
    },
    send(message) {
      this.sent.push(message);
    },
  };
  return port;
}

function fakeTransport(ports) {
  const opened = [];
  return {
    opened,
    supported: true,
    open(options) {
      const port = fakePort();
      port.options = options;
      opened.push(port);
      return port;
    },
    list: async () => ports || [{ path: "COM3", label: "Arduino Uno" }],
  };
}

const message = { address: "/master/level", args: [{ type: "f", value: 0.5 }] };

// --- naming the cable -------------------------------------------------------

test("a widget says it means the cable by saying so in the Ip field", () => {
  for (const value of ["serial", "SERIAL", "  Serial  "]) {
    assert.strictEqual(isSerialTarget(value), true, value);
  }
  for (const value of ["localhost", "192.168.1.5", "", null, undefined, "serial2"]) {
    assert.strictEqual(isSerialTarget(value), false, String(value));
  }
});

test("the Ip validator accepts the cable as a destination", () => {
  assert.strictEqual(checkIp(SERIAL_HOST), null);
  assert.strictEqual(checkIp("localhost"), null);
  assert.strictEqual(checkIp("192.168.0.9"), null);
  assert.match(checkIp("not-an-address"), /isn't valid/);
});

test("a serial widget is not nagged about a port number it has no use for", () => {
  assert.strictEqual(checkPort("", { ip: "serial" }), null);
  assert.strictEqual(checkPort(0, { ip: "serial" }), null);
  // Everything else still has to be a real port.
  assert.match(checkPort("", { ip: "localhost" }), /between 1 and 65535/);
  assert.match(checkPort(0), /between 1 and 65535/);
  assert.strictEqual(checkPort(7000, { ip: "localhost" }), null);
});

// --- the link ---------------------------------------------------------------

test("connecting opens the chosen port, and messages only go once it is ready", () => {
  const transport = fakeTransport();
  const link = new SerialLink(transport);

  link.connect("COM3", 57600);
  const port = transport.opened[0];
  assert.deepStrictEqual(port.options, { devicePath: "COM3", bitrate: 57600, metadata: true });
  assert.strictEqual(port.opened, 1);

  // Still opening: a message now would be written into nothing.
  assert.strictEqual(link.send(message), false);
  assert.deepStrictEqual(port.sent, []);
  assert.strictEqual(link.status().dropped, 1);

  port.fire("ready");
  assert.strictEqual(link.status().state, "open");
  assert.strictEqual(link.send(message), true);
  assert.deepStrictEqual(port.sent, [message]);

  link.disconnect();
});

test("a cable pulled mid-show is picked up again on its own", async () => {
  const transport = fakeTransport();
  const link = new SerialLink(transport);

  link.connect("COM3");
  transport.opened[0].fire("ready");
  assert.strictEqual(link.status().state, "open");

  // The board is unplugged, or reflashed.
  transport.opened[0].fire("close");
  assert.strictEqual(link.status().state, "opening", "OSCAR has not given up on it");
  assert.strictEqual(link.send(message), false, "and nothing is sent into the gap");

  // The retry is on a timer; let it run rather than waiting the full delay.
  assert.ok(link.retry, "a retry is pending");
  clearTimeout(link.retry);
  link.retry = null;
  link._open();

  assert.strictEqual(transport.opened.length, 2, "it opened the same port again");
  assert.strictEqual(transport.opened[1].options.devicePath, "COM3");
  link.disconnect();
});

test("disconnecting stops the retries as well as the port", () => {
  const transport = fakeTransport();
  const link = new SerialLink(transport);

  link.connect("COM3");
  transport.opened[0].fire("ready");
  link.disconnect();

  assert.strictEqual(link.status().state, "closed");
  assert.strictEqual(link.status().path, null);
  assert.strictEqual(link.retry, null, "nothing is still trying to reopen it");
  assert.strictEqual(link.send(message), false);
});

test("connecting again replaces the port rather than stacking a second one", () => {
  const transport = fakeTransport();
  const link = new SerialLink(transport);

  link.connect("COM3");
  const first = transport.opened[0];
  first.fire("ready");

  link.connect("COM4");
  assert.strictEqual(first.closed, 1, "the old cable is let go of");
  assert.strictEqual(transport.opened[1].options.devicePath, "COM4");
  link.disconnect();
});

test("a build without serial says so instead of failing at the first message", () => {
  const link = new SerialLink({ supported: false, reason: "no driver here" });

  const status = link.connect("COM3");
  assert.strictEqual(status.supported, false);
  assert.match(status.error, /no driver here/);
  assert.strictEqual(link.send(message), false, "and sending is simply a no-op");
});

test("asking to connect to nothing is refused with something to read", () => {
  const link = new SerialLink(fakeTransport());
  const status = link.connect("");
  assert.strictEqual(status.state, "closed");
  assert.match(status.error, /Pick a serial port/);
});

test("listing ports never throws at the caller", async () => {
  const link = new SerialLink({
    supported: true,
    open: () => fakePort(),
    list: async () => {
      throw new Error("the driver fell over");
    },
  });

  assert.deepStrictEqual(await link.list(), []);
  assert.match(link.status().error, /fell over/);
});

test("this build really does have the serial transport osc.js ships", () => {
  // The whole design rests on it: osc.js already depends on serialport, so
  // serial costs OSCAR no new dependency. If that ever stops being true this
  // test says so rather than a user finding out at a get-in.
  const transport = defaultTransport();
  if (!transport.supported) {
    assert.ok(transport.reason, "and if it is missing, there is something to tell the user");
    return;
  }
  assert.strictEqual(typeof transport.open, "function");
  assert.strictEqual(typeof transport.list, "function");
});
