"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  SerialLink,
  serialControl,
  defaultTransport,
  describePort,
  readBitrate,
  isSerialTarget,
  SERIAL_HOST,
  DEFAULT_BITRATE,
} = require("../lib/serial");

/** A serial port that never touches hardware, shaped like osc.SerialPort. */
function fakePort(options) {
  return {
    options,
    handlers: {},
    sent: [],
    opened: 0,
    closed: 0,
    on(event, fn) {
      (this.handlers[event] = this.handlers[event] || []).push(fn);
    },
    fire(event, arg) {
      (this.handlers[event] || []).slice().forEach((fn) => fn(arg));
    },
    open() {
      this.opened++;
    },
    // The real one reports "Port is not open" as an error event when closed
    // before it opened, and never emits close for a port that never opened.
    close() {
      this.closed++;
    },
    send(message) {
      this.sent.push(message);
    },
  };
}

/** A transport plus hand-cranked timers, so no test waits on a clock. */
function rig(overrides) {
  const ports = [];
  const timers = [];
  const changes = [];
  const transport = Object.assign(
    {
      supported: true,
      open(options) {
        const port = fakePort(options);
        ports.push(port);
        return port;
      },
      list: async () => [{ path: "COM3", label: "COM3 -- Arduino" }],
    },
    overrides
  );
  const link = new SerialLink({
    transport,
    retryMs: 50,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timer.cleared = true;
    },
    onChange: (status) => changes.push(status.state),
  });
  const last = () => ports[ports.length - 1];
  /** Run whatever retry is pending, as the clock would. */
  const tick = () => {
    const due = timers.filter((t) => !t.cleared && !t.ran);
    due.forEach((t) => {
      t.ran = true;
      t.fn();
    });
    return due.length;
  };
  return { link, ports, timers, changes, last, tick };
}

const message = { address: "/led", args: [{ type: "f", value: 0.5 }] };

// --- naming the cable -------------------------------------------------------

test("the cable is named by one word, however it is typed", () => {
  for (const value of ["serial", "SERIAL", "  Serial  "]) assert.strictEqual(isSerialTarget(value), true, value);
  for (const value of ["localhost", "192.168.1.5", "", null, undefined, "serial2", 0, {}]) {
    assert.strictEqual(isSerialTarget(value), false, String(value));
  }
  assert.strictEqual(SERIAL_HOST, "serial");
});

// --- the baud rate ----------------------------------------------------------

test("a baud rate is a whole number in range, the default when unset, and never a guess", () => {
  assert.strictEqual(readBitrate(undefined), DEFAULT_BITRATE);
  assert.strictEqual(readBitrate(""), DEFAULT_BITRATE);
  assert.strictEqual(readBitrate(9600), 9600);
  assert.strictEqual(readBitrate("57600"), 57600);
  for (const bad of ["fast", "  ", 0, -9600, 9600.5, 1e9, NaN, {}, true]) {
    assert.strictEqual(readBitrate(bad), null, String(bad));
  }
});

// --- opening ----------------------------------------------------------------

test("choosing a port opens it with typed arguments at the chosen rate", () => {
  const { link, last, changes } = rig();
  assert.strictEqual(link.connect(" COM3 ", 9600), null);
  assert.deepStrictEqual(last().options, { devicePath: "COM3", bitrate: 9600, metadata: true });
  assert.strictEqual(last().opened, 1);
  assert.strictEqual(link.status().state, "opening");

  last().fire("ready");
  assert.strictEqual(link.status().state, "open");
  assert.strictEqual(link.status().error, null);
  assert.deepStrictEqual(changes, ["opening", "open"]);
});

test("a request that is itself wrong is refused and changes nothing", () => {
  const { link, ports } = rig();
  assert.match(link.connect("", 9600), /Pick a serial port/);
  assert.match(link.connect(null), /Pick a serial port/);
  assert.match(link.connect("COM3", "fast"), /baud rate/);
  assert.strictEqual(ports.length, 0);
  assert.strictEqual(link.status().state, "idle");
});

test("a bad request does not disturb a port that is already open", () => {
  const { link, ports, last } = rig();
  link.connect("COM3");
  last().fire("ready");
  assert.match(link.connect("COM4", "fast"), /baud rate/);
  assert.strictEqual(ports.length, 1);
  assert.strictEqual(link.status().state, "open");
  assert.strictEqual(link.status().path, "COM3");
});

// --- a port that will not open ----------------------------------------------

test("a port that will not open is retried, because osc.js never closes what never opened", () => {
  const { link, ports, last, tick } = rig();
  link.connect("COM3");
  last().fire("error", new Error("Opening COM3: File not found"));

  assert.strictEqual(link.status().state, "waiting");
  assert.match(link.status().error, /File not found/);
  assert.strictEqual(ports[0].closed, 1, "the failed port is let go of");

  assert.strictEqual(tick(), 1);
  assert.strictEqual(ports.length, 2, "a fresh port, not the failed one reopened");
  assert.strictEqual(link.status().state, "opening");

  last().fire("ready");
  assert.strictEqual(link.status().state, "open");
  assert.strictEqual(link.status().error, null);
});

test("a transport that throws on open is a port that would not open", () => {
  let calls = 0;
  const { link, tick } = rig({
    open() {
      calls++;
      throw new Error("no such driver");
    },
  });
  assert.strictEqual(link.connect("COM3"), null);
  assert.strictEqual(link.status().state, "waiting");
  assert.match(link.status().error, /no such driver/);
  tick();
  assert.strictEqual(calls, 2);
});

test("it keeps trying for as long as the port stays chosen", () => {
  const { link, ports, last, tick } = rig();
  link.connect("COM3");
  for (let i = 0; i < 5; i++) {
    last().fire("error", new Error("busy"));
    tick();
  }
  assert.strictEqual(ports.length, 6);
});

// --- a cable that is pulled -------------------------------------------------

test("a pulled cable is reopened when it comes back", () => {
  const { link, ports, last, tick, changes } = rig();
  link.connect("COM3");
  last().fire("ready");
  last().fire("close");

  assert.strictEqual(link.status().state, "waiting");
  assert.match(link.status().error, /cable/);
  assert.strictEqual(link.send(message), false);

  tick();
  last().fire("ready");
  assert.strictEqual(ports.length, 2);
  assert.strictEqual(link.send(message), true);
  assert.deepStrictEqual(changes, ["opening", "open", "waiting", "opening", "open"]);
});

test("what a port says after it was given up on is ignored", () => {
  const { link, ports, last, tick } = rig();
  link.connect("COM3");
  const first = last();
  first.fire("error", new Error("busy"));
  tick();
  last().fire("ready");

  // The real port answers close() on a port that never opened with one more
  // error, and may still close late. Neither is about the port now in use.
  first.fire("error", new Error("Port is not open"));
  first.fire("close");
  first.fire("ready");
  assert.strictEqual(link.status().state, "open");
  assert.strictEqual(link.status().error, null);
  assert.strictEqual(ports.length, 2);
});

test("an error while open is noted, reported, and does not drop the port", () => {
  const errors = [];
  const { link, last, timers } = rig();
  link.onError = (err) => errors.push(err.message);
  link.connect("COM3");
  last().fire("ready");
  // A sketch printing debug text down the same line: not OSC, not fatal.
  last().fire("error", new Error("invalid OSC packet"));
  assert.strictEqual(link.status().state, "open");
  assert.match(link.status().error, /invalid OSC/);
  assert.deepStrictEqual(errors, ["invalid OSC packet"]);
  assert.strictEqual(timers.length, 0);
});

// --- sending ----------------------------------------------------------------

test("messages go down an open port and are counted", () => {
  const { link, last } = rig();
  link.connect("COM3");
  last().fire("ready");
  assert.strictEqual(link.send(message), true);
  assert.deepStrictEqual(last().sent, [message]);
  assert.strictEqual(link.status().sent, 1);
  assert.strictEqual(link.status().dropped, 0);
});

test("a value that is not a number never reaches the cable as 0", () => {
  // osc.js writes null and "" as 00 00 00 00, which a rig reads as off. The
  // server checks before calling send(); the link must not depend on that.
  const { link, last } = rig();
  link.connect("COM3");
  last().fire("ready");
  const bad = [
    { address: "/x", args: [{ type: "f", value: null }] },
    { address: "/x", args: [{ type: "i", value: "" }] },
    { address: "/x", args: [{ type: "f", value: "  " }] },
    { address: "/x", args: [{ type: "f", value: NaN }] },
    { address: "/x", args: [{ type: "f", value: 1 }, { type: "f", value: undefined }] },
    { address: "x", args: [{ type: "f", value: 1 }] },
    { address: "/x", args: [{ type: "b", value: 1 }] },
    { address: "/x" },
    "/x",
  ];
  for (const message of bad) assert.strictEqual(link.send(message), false, JSON.stringify(message));
  assert.deepStrictEqual(last().sent, []);
  assert.strictEqual(link.status().dropped, bad.length);

  // What is sendable still goes, a real zero and a bare address included.
  assert.strictEqual(link.send({ address: "/x", args: [{ type: "f", value: 0 }] }), true);
  assert.strictEqual(link.send({ address: "/play", args: [] }), true);
  assert.deepStrictEqual(last().sent, [
    { address: "/x", args: [{ type: "f", value: 0 }] },
    { address: "/play", args: [] },
  ]);
});

test("nothing is sent, or queued for later, while the port is not open", () => {
  const { link, last } = rig();
  assert.strictEqual(link.send(message), false, "idle");
  link.connect("COM3");
  assert.strictEqual(link.send(message), false, "opening");
  assert.strictEqual(link.send(null), false);
  last().fire("ready");
  // A level arriving seconds after the gesture is a light moving on its own.
  assert.deepStrictEqual(last().sent, []);
  assert.strictEqual(link.status().dropped, 3);
});

test("a write that throws is a drop, not a crash", () => {
  const { link, last } = rig();
  link.connect("COM3");
  last().fire("ready");
  last().send = () => {
    throw new Error("EIO");
  };
  assert.strictEqual(link.send(message), false);
  assert.match(link.status().error, /EIO/);
});

test("what the board says is passed on, but only by the port in use", () => {
  const heard = [];
  const { link, last } = rig();
  link.onMessage = (packet) => heard.push(packet.address);
  link.connect("COM3");
  const first = last();
  first.fire("ready");
  first.fire("message", { address: "/pot", args: [] });
  link.connect("COM4");
  first.fire("message", { address: "/stale", args: [] });
  assert.deepStrictEqual(heard, ["/pot"]);
});

// --- letting go -------------------------------------------------------------

test("disconnecting closes the port and cancels any retry", () => {
  const { link, ports, last, tick } = rig();
  link.connect("COM3");
  last().fire("error", new Error("busy"));
  link.disconnect();

  assert.strictEqual(link.status().state, "idle");
  assert.strictEqual(link.status().path, null);
  assert.strictEqual(link.status().error, null);
  assert.strictEqual(tick(), 0, "the retry was cancelled");
  assert.strictEqual(ports.length, 1);
});

test("a close that was asked for is not mistaken for a pulled cable", () => {
  const { link, last, timers } = rig();
  link.connect("COM3");
  const port = last();
  port.fire("ready");
  link.disconnect();
  port.fire("close");
  assert.strictEqual(port.closed, 1);
  assert.strictEqual(link.status().state, "idle");
  assert.strictEqual(timers.length, 0);
});

test("choosing another port lets go of the first", () => {
  const { link, ports } = rig();
  link.connect("COM3");
  ports[0].fire("ready");
  link.connect("COM4", 9600);
  assert.strictEqual(ports[0].closed, 1);
  assert.strictEqual(ports[1].options.devicePath, "COM4");
  ports[0].fire("close");
  ports[1].fire("ready");
  assert.strictEqual(link.status().state, "open");
  assert.strictEqual(link.status().path, "COM4");
});

test("a pending retry never keeps the process alive", () => {
  let unrefed = 0;
  const link = new SerialLink({
    transport: { supported: true, open: () => fakePort(), list: async () => [] },
    setTimer: () => ({ unref: () => unrefed++ }),
    clearTimer: () => {},
  });
  link.connect("COM3");
  link.port.fire("error", new Error("busy"));
  assert.strictEqual(unrefed, 1);
});

// --- a build without serial -------------------------------------------------

test("a build with no serial driver says so everywhere and throws nowhere", async () => {
  const { link, ports } = rig({ supported: false, reason: "No serial support in this build of OSCAR." });
  assert.strictEqual(link.supported, false);
  assert.match(link.connect("COM3"), /No serial support in this build/);
  assert.deepStrictEqual(await link.list(), []);
  assert.strictEqual(link.send(message), false);
  link.disconnect();
  assert.strictEqual(ports.length, 0);
  const status = link.status();
  assert.strictEqual(status.supported, false);
  assert.match(status.reason, /No serial support in this build/);
});

test("the real transport reports support, or the lack of it, without throwing", () => {
  const transport = defaultTransport();
  assert.strictEqual(typeof transport.supported, "boolean");
  if (transport.supported) {
    assert.strictEqual(typeof transport.open, "function");
    assert.strictEqual(typeof transport.list, "function");
  } else {
    assert.match(transport.reason, /No serial support in this build/);
  }
});

test("listing that fails is an empty list and a reason, not an exception", async () => {
  const { link } = rig({
    list: async () => {
      throw new Error("udev is not running");
    },
  });
  assert.deepStrictEqual(await link.list(), []);
  assert.match(link.status().error, /udev/);
});

test("a port is described so a person can pick their board out", () => {
  assert.deepStrictEqual(describePort({ path: "/dev/ttyACM0", manufacturer: "Arduino LLC" }), {
    path: "/dev/ttyACM0",
    label: "/dev/ttyACM0 -- Arduino LLC",
  });
  // Windows already puts the path in the friendly name.
  assert.strictEqual(describePort({ path: "COM3", friendlyName: "USB-SERIAL CH340 (COM3)" }).label, "USB-SERIAL CH340 (COM3)");
  assert.strictEqual(describePort({ path: "COM7" }).label, "COM7");
});

// --- remembering the port ---------------------------------------------------

function fakeSettings(initial) {
  const values = Object.assign({}, initial);
  const writes = [];
  return {
    values,
    writes,
    get: (key) => values[key],
    set: (key, value) => {
      values[key] = value;
      writes.push([key, value]);
    },
  };
}

test("the chosen port is remembered, and forgotten on disconnect", () => {
  const { link } = rig();
  const settings = fakeSettings();
  const serial = serialControl({ link, settings });

  assert.strictEqual(serial.connect("COM3", "9600"), null);
  assert.deepStrictEqual(settings.values.serial, { path: "COM3", bitrate: 9600 });

  serial.disconnect();
  assert.strictEqual(settings.values.serial, null);
});

test("a refused request is not remembered", () => {
  const { link } = rig();
  const settings = fakeSettings();
  const serial = serialControl({ link, settings });
  assert.match(serial.connect("COM3", "fast"), /baud rate/);
  assert.deepStrictEqual(settings.writes, []);
});

test("a restart goes back to the remembered port", () => {
  const { link, last } = rig();
  const serial = serialControl({ link, settings: fakeSettings({ serial: { path: "/dev/ttyUSB0", bitrate: 57600 } }) });
  assert.strictEqual(serial.restore(), null);
  assert.deepStrictEqual(last().options, { devicePath: "/dev/ttyUSB0", bitrate: 57600, metadata: true });
});

test("nothing remembered, or nonsense remembered, restores nothing", () => {
  for (const saved of [undefined, null, "COM3", {}, { path: "" }, { path: 3 }]) {
    const { link, ports } = rig();
    const serial = serialControl({ link, settings: fakeSettings({ serial: saved }) });
    assert.strictEqual(serial.restore(), null);
    assert.strictEqual(ports.length, 0);
  }
});

test("shutting down lets go of the port without forgetting it", () => {
  const { link, last } = rig();
  const settings = fakeSettings();
  const serial = serialControl({ link, settings });
  serial.connect("COM3");
  const port = last();
  serial.close();
  assert.strictEqual(port.closed, 1);
  assert.deepStrictEqual(settings.values.serial, { path: "COM3", bitrate: DEFAULT_BITRATE });
});

test("a build without serial keeps the remembered port for one that has it", () => {
  const { link } = rig({ supported: false, reason: "No serial support in this build of OSCAR." });
  const settings = fakeSettings({ serial: { path: "COM3", bitrate: 9600 } });
  const serial = serialControl({ link, settings });
  assert.match(serial.restore(), /No serial support in this build/);
  assert.deepStrictEqual(settings.writes, []);
});

// --- keeping the native module out of the browser ---------------------------

function sources(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? entry.name === "node_modules"
          ? []
          : sources(path.join(dir, entry.name))
        : /\.js$/.test(entry.name) && !/^bundle/.test(entry.name)
          ? [path.join(dir, entry.name)]
          : []
    );
}

test("nothing the browser bundles reaches for the serial driver", () => {
  const root = path.join(__dirname, "..");
  const bundled = sources(path.join(root, "lib", "widgets")).concat(sources(path.join(root, "public", "src")));
  assert.ok(bundled.length > 10);
  for (const file of bundled) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /require\(["'][^"']*\/serial["']\)/, file + " requires lib/serial.js");
    assert.doesNotMatch(text, /require\(["'](serialport|osc)["']\)/, file);
  }
  // What they may use instead has to stay free of it too.
  const target = fs.readFileSync(path.join(root, "lib", "serial-target.js"), "utf8");
  assert.doesNotMatch(target, /require\(/);
});
