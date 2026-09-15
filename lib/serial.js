"use strict";

const { SERIAL_HOST, isSerialTarget } = require("./serial-target");

/**
 * Sending OSC down a USB cable, for an Arduino or anything like it.
 *
 * This adds no dependency. osc.js -- already here for the UDP bridge -- ships
 * a serial transport that frames OSC packets with SLIP, which is the form
 * every Arduino OSC library expects; and `serialport`, which it needs to do
 * that, is already installed as an optional dependency of osc.js and is
 * already rebuilt for every architecture by the release build.
 *
 * It is still optional at runtime. A build where the native module did not
 * install (there is no Windows-on-ARM binary in the version osc.js pins, for
 * one) must say so plainly rather than crash: a rig that will not start is
 * worse than one without serial.
 */

// How long to wait before trying a configured port again after it goes away.
// A cable knocked out mid-show should come back on its own; a board being
// reflashed disappears for a few seconds every time.
const RETRY_MS = 3000;

/** The default way in: whatever osc.js managed to load. */
function defaultTransport() {
  let osc = null;
  try {
    osc = require("osc");
  } catch {
    return { supported: false, reason: "OSCAR's OSC library is not available." };
  }

  if (!osc.supportsSerial) {
    return {
      supported: false,
      reason: "This build of OSCAR has no serial support (the serial driver did not install).",
    };
  }

  return {
    supported: true,
    open: (options) => new osc.SerialPort(options),
    list: async () => {
      const { SerialPort } = require("serialport");
      const ports = await SerialPort.list();
      return ports.map((port) => ({
        path: port.path,
        label: [port.manufacturer, port.friendlyName].filter(Boolean).join(" ") || port.path,
      }));
    },
  };
}

/**
 * One serial connection, held open for as long as a port is configured.
 *
 * `transport` is injectable so the behaviour below can be tested without a
 * board plugged in.
 */
class SerialLink {
  constructor(transport) {
    this.transport = transport || defaultTransport();
    this.port = null;
    this.path = null;
    this.bitrate = 115200;
    this.state = "closed"; // closed | opening | open
    this.lastError = null;
    this.sent = 0;
    this.dropped = 0;
    this.retry = null;
  }

  get supported() {
    return !!this.transport.supported;
  }

  /** The serial ports on this computer, or [] when there is no serial support. */
  async list() {
    if (!this.supported) return [];
    try {
      return await this.transport.list();
    } catch (err) {
      this.lastError = err.message;
      return [];
    }
  }

  status() {
    return {
      supported: this.supported,
      reason: this.supported ? null : this.transport.reason || null,
      state: this.state,
      path: this.path,
      bitrate: this.bitrate,
      sent: this.sent,
      dropped: this.dropped,
      error: this.lastError,
    };
  }

  /**
   * Open a port, replacing whatever was open before.
   *
   * Returns the status rather than throwing: every caller is a route handler
   * that has to answer the editor either way.
   */
  connect(path, bitrate) {
    this.disconnect();

    if (!this.supported) {
      this.lastError = this.transport.reason || "Serial is not available in this build.";
      return this.status();
    }

    if (!path || typeof path !== "string") {
      this.lastError = "Pick a serial port first.";
      return this.status();
    }

    this.path = path;
    this.bitrate = Number(bitrate) > 0 ? Number(bitrate) : this.bitrate;
    this.lastError = null;
    this._open();
    return this.status();
  }

  _open() {
    this.state = "opening";

    try {
      // metadata: true matches the rest of OSCAR -- arguments carry their OSC
      // type rather than being guessed at from the JavaScript value.
      this.port = this.transport.open({
        devicePath: this.path,
        bitrate: this.bitrate,
        metadata: true,
      });
    } catch (err) {
      this.state = "closed";
      this.lastError = err.message;
      this._scheduleRetry();
      return;
    }

    this.port.on("ready", () => {
      this.state = "open";
      this.lastError = null;
      console.log("Serial open on " + this.path + " at " + this.bitrate + " baud");
    });

    this.port.on("error", (err) => {
      this.lastError = err.message;
      // Not fatal on its own -- a write to a port that has just gone away
      // reports here, and the close that follows is what actually reopens it.
      console.error("Serial error:", err.message);
    });

    this.port.on("close", () => {
      if (this.state === "closed") return; // asked for, not lost
      this.state = "opening";
      this.port = null;
      this._scheduleRetry();
    });

    try {
      this.port.open();
    } catch (err) {
      this.state = "closed";
      this.lastError = err.message;
      this._scheduleRetry();
    }
  }

  _scheduleRetry() {
    if (this.retry || !this.path) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.path && this.state !== "open") this._open();
    }, RETRY_MS);
    // A pending retry must never be the reason OSCAR refuses to exit.
    if (this.retry.unref) this.retry.unref();
  }

  /** Stop using the serial port, and stop trying to. */
  disconnect() {
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
    }

    const port = this.port;
    this.port = null;
    this.path = null;
    this.state = "closed";

    if (port) {
      try {
        port.close();
      } catch {
        // Already gone; nothing left to close.
      }
    }
    return this.status();
  }

  /**
   * Send one OSC message down the cable.
   *
   * Returns false when it could not go, so the caller can say so once rather
   * than this filling a log with a line per fader movement.
   */
  send(message) {
    if (!message || this.state !== "open" || !this.port) {
      this.dropped++;
      return false;
    }

    try {
      this.port.send(message);
      this.sent++;
      return true;
    } catch (err) {
      this.dropped++;
      this.lastError = err.message;
      return false;
    }
  }
}

module.exports = { SerialLink, SERIAL_HOST, isSerialTarget, defaultTransport, RETRY_MS };
