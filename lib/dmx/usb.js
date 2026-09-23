"use strict";

const { SLOTS } = require("./spec");

/**
 * DMX over a USB interface, on a serial port.
 *
 * Two kinds of interface, told apart by who keeps the DMX timing:
 *
 *   usbpro   Enttec DMX USB Pro and its relatives (Pro Mk2, DMXKing ultraDMX,
 *            many clones). The interface has a microcontroller that makes the
 *            DMX signal itself; OSCAR hands it a framed packet whenever the
 *            frame changes, and on the keepalive, and it repeats the last
 *            frame on its own. Reliable on every operating system.
 *
 *   opendmx  Enttec Open DMX USB and its clones: a bare FTDI chip. The
 *            computer has to make the signal -- a break, then the frame --
 *            about forty times a second, for as long as the universe is
 *            driven. It works, and it is cheap; under load the timing
 *            suffers, which a fixture shows as a flicker. Said in the panel.
 *
 * Both sit on the serial driver OSCAR already ships for the Arduino feature.
 * A port is opened when a frame first goes to it and kept open; one that
 * cannot be opened is reported once and tried again every OPEN_RETRY_MS, so
 * an interface plugged in after the show started is picked up. Everything
 * about the serial port itself comes in through `deps`, so this can be
 * tested without one.
 */

const OPEN_RETRY_MS = 2000;
/** Open DMX: a frame every 25 ms is the forty a second a DMX line carries. */
const OPEN_DMX_FRAME_MS = 25;
/** FTDI's USB vendor id: every interface of both kinds is an FTDI chip. */
const FTDI_VENDOR = "0403";
const KINDS = ["usbpro", "opendmx"];

/** The Enttec Pro protocol: 0x7E, label 6 (send DMX), length, start code 0, the frame, 0xE7. */
function proPacket(frame) {
  const length = SLOTS + 1;
  const out = Buffer.alloc(length + 5);
  out[0] = 0x7e;
  out[1] = 6;
  out[2] = length & 0xff;
  out[3] = (length >> 8) & 0xff;
  out[4] = 0;
  Buffer.from(frame).copy(out, 5, 0, SLOTS);
  out[length + 4] = 0xe7;
  return out;
}

/** Open DMX: the frame goes out raw after a break, start code first. */
function openDmxPacket(frame) {
  const out = Buffer.alloc(SLOTS + 1);
  Buffer.from(frame).copy(out, 1, 0, SLOTS);
  return out;
}

/**
 * Which port a widget means. By its path (COM3, /dev/ttyUSB0), then by a
 * part of its path or maker, case blind; blank means the first FTDI
 * interface, and failing one of those the first port there is.
 *
 * @param {Array<{path: string, manufacturer?: string, vendorId?: string}>} ports
 * @returns {string|null} the path, or null when nothing fits
 */
function pickPort(ports, wanted) {
  const list = Array.isArray(ports) ? ports.filter((p) => p && typeof p.path === "string") : [];
  const name = String(wanted == null ? "" : wanted).trim().toLowerCase();
  if (name) {
    const exact = list.find((p) => p.path.toLowerCase() === name);
    if (exact) return exact.path;
    const part = list.find((p) => p.path.toLowerCase().indexOf(name) !== -1 || String(p.manufacturer || "").toLowerCase().indexOf(name) !== -1);
    return part ? part.path : null;
  }
  const ftdi = list.find((p) => String(p.vendorId || "").toLowerCase() === FTDI_VENDOR);
  return ftdi ? ftdi.path : list.length ? list[0].path : null;
}

/** The serial port as the interface wants it: 250 kbaud, 8N2 for Open DMX; the Pro reads its own protocol at any rate. */
function portSettings(kind) {
  return { baudRate: kind === "opendmx" ? 250000 : 57600, dataBits: 8, stopBits: 2, parity: "none" };
}

const realClock = {
  setTimeout(fn, ms) {
    const timer = setTimeout(fn, ms);
    if (timer.unref) timer.unref();
    return timer;
  },
  clearTimeout,
};

/** The real serial driver, loaded only when first needed: a build without it says so instead of failing to start. */
function realDeps() {
  let library = null;
  function load() {
    if (library) return library;
    // eslint-disable-next-line global-require
    library = require("serialport");
    return library;
  }
  return {
    list: () => load().SerialPort.list(),
    open: (path, kind) =>
      new Promise((resolve, reject) => {
        const port = new (load().SerialPort)(Object.assign({ path, autoOpen: false }, portSettings(kind)));
        port.open((err) => (err ? reject(err) : resolve(port)));
      }),
  };
}

/**
 * @param {object} [deps]
 *   list()            -> Promise<ports>, as serialport lists them
 *   open(path, kind)  -> Promise<port> with write(buf, cb), set({brk}, cb), close(cb), on("error")
 *   clock             { setTimeout, clearTimeout }, for tests
 *   onError(err, path)  reported once per port until it works again
 *   onStatus(text)      "USB DMX: sending to COM3 (Enttec Pro)"
 */
function createUsbDmx(deps) {
  deps = Object.assign({}, deps);
  const io = deps.list && deps.open ? deps : realDeps();
  const clock = deps.clock || realClock;
  const onError = deps.onError || function () {};
  const onStatus = deps.onStatus || function () {};

  /** path -> { kind, port, frame, loop, failedAt, said } */
  const lines = new Map();

  function fail(line, path, err) {
    line.failedAt = Date.now();
    if (!line.said) {
      line.said = true;
      onError(err, path);
    }
  }

  function write(port, buffer) {
    return new Promise((resolve, reject) => port.write(buffer, (err) => (err ? reject(err) : resolve())));
  }

  function setBreak(port, on) {
    return new Promise((resolve, reject) => port.set({ brk: on }, (err) => (err ? reject(err) : resolve())));
  }

  /** Wait for what was written to have left: the next break must not cut the frame short. */
  function drain(port) {
    if (typeof port.drain !== "function") return Promise.resolve();
    return new Promise((resolve, reject) => port.drain((err) => (err ? reject(err) : resolve())));
  }

  function wait(ms) {
    return new Promise((resolve) => clock.setTimeout(resolve, ms));
  }

  /** The port for a line, opened if it is not; null while it cannot be. */
  async function portOf(line, path) {
    if (line.port) return line.port;
    if (line.opening) return line.opening;
    if (line.failedAt && Date.now() - line.failedAt < OPEN_RETRY_MS) return null;
    line.opening = io
      .open(path, line.kind)
      .then((port) => {
        line.port = port;
        line.opening = null;
        line.failedAt = 0;
        line.said = false;
        if (typeof port.on === "function") {
          port.on("error", (err) => {
            fail(line, path, err);
            line.port = null;
          });
          port.on("close", () => {
            line.port = null;
          });
        }
        onStatus("USB DMX: sending to " + path + " (" + (line.kind === "opendmx" ? "Open DMX" : "Enttec Pro") + ")");
        return port;
      })
      .catch((err) => {
        line.opening = null;
        fail(line, path, err);
        return null;
      });
    return line.opening;
  }

  /** One Open DMX frame: a break, a moment, then the start code and the levels. */
  async function openDmxFrame(line, path) {
    const port = await portOf(line, path);
    if (!port) return;
    try {
      await setBreak(port, true);
      await wait(1);
      await setBreak(port, false);
      await write(port, openDmxPacket(line.frame));
      // 513 bytes at 250 kbaud is 23 ms, and the USB chip adds its own; a
      // break sent before the frame is out would cut it and the fixture would
      // read the tail as the next frame's head.
      await drain(port);
    } catch (err) {
      fail(line, path, err);
    }
  }

  /**
   * Keep an Open DMX line refreshed while it is driven: a frame every
   * OPEN_DMX_FRAME_MS where the line keeps up, and as fast as it can where
   * a frame takes longer than that to leave.
   */
  function runLoop(line, path) {
    if (line.loop) return;
    const tick = () => {
      if (!lines.has(path) || line.stopped) {
        line.loop = null;
        return;
      }
      const started = Date.now();
      openDmxFrame(line, path).then(() => {
        if (!lines.has(path) || line.stopped) {
          line.loop = null;
          return;
        }
        line.loop = clock.setTimeout(tick, Math.max(1, OPEN_DMX_FRAME_MS - (Date.now() - started)));
      });
    };
    line.loop = clock.setTimeout(tick, 0);
  }

  return {
    /**
     * Put a frame on an interface. Never rejects: what cannot be sent is
     * reported and the next frame is tried again.
     *
     * @param {"usbpro"|"opendmx"} kind
     * @param {string} wanted  the port as the widget named it, or "" for the first interface
     * @param {Buffer} frame   512 levels
     */
    async send(kind, wanted, frame) {
      if (KINDS.indexOf(kind) === -1) return;
      let ports;
      try {
        ports = await io.list();
      } catch (err) {
        onError(err, wanted || "");
        return;
      }
      const path = pickPort(ports, wanted);
      if (!path) {
        const key = "?" + wanted;
        const line = lines.get(key) || { kind, said: false };
        lines.set(key, line);
        fail(line, wanted, new Error(wanted ? "no serial port called " + wanted : "no USB DMX interface is plugged in"));
        return;
      }
      lines.delete("?" + wanted);
      let line = lines.get(path);
      if (!line) {
        line = { kind, port: null, opening: null, frame: Buffer.alloc(SLOTS), loop: null, failedAt: 0, said: false, stopped: false };
        lines.set(path, line);
      }
      line.kind = kind;
      line.stopped = false;
      Buffer.from(frame).copy(line.frame, 0, 0, SLOTS);
      if (kind === "opendmx") return runLoop(line, path);
      const port = await portOf(line, path);
      if (!port) return;
      try {
        await write(port, proPacket(line.frame));
      } catch (err) {
        fail(line, path, err);
      }
    },

    /** The universe on this interface was released: its zero frame has gone; let go of the port. */
    async release(kind, wanted) {
      let ports;
      try {
        ports = await io.list();
      } catch (err) {
        return;
      }
      const path = pickPort(ports, wanted);
      const line = path && lines.get(path);
      if (!line) return;
      // Open DMX: a few zero frames, so a fixture that reads them sees the dark before the signal stops.
      if (line.kind === "opendmx") await wait(OPEN_DMX_FRAME_MS * 4);
      line.stopped = true;
      if (line.loop) clock.clearTimeout(line.loop);
      line.loop = null;
      lines.delete(path);
      if (line.port && typeof line.port.close === "function") {
        const port = line.port;
        line.port = null;
        await new Promise((resolve) => port.close(() => resolve()));
      }
    },

    /** Close every port. What quitting does. */
    async close() {
      for (const [path, line] of [...lines]) {
        line.stopped = true;
        if (line.loop) clock.clearTimeout(line.loop);
        lines.delete(path);
        if (line.port && typeof line.port.close === "function") {
          const port = line.port;
          line.port = null;
          await new Promise((resolve) => port.close(() => resolve()));
        }
      }
    },

    /** For the log: the ports being driven. */
    active() {
      return [...lines.entries()].filter(([path, line]) => path[0] !== "?" && line.port).map(([path, line]) => ({ path, kind: line.kind }));
    },
  };
}

module.exports = { createUsbDmx, pickPort, proPacket, openDmxPacket, portSettings, KINDS, OPEN_RETRY_MS, OPEN_DMX_FRAME_MS, FTDI_VENDOR };
