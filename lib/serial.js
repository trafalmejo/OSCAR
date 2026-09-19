"use strict";

const { toNumber } = require("./osc-args");
const { buildMessage } = require("./osc-message");
const { SERIAL_HOST, isSerialTarget } = require("./serial-target");

/**
 * Sending OSC down a USB cable, for an Arduino or anything like it.
 *
 * This adds no dependency. osc.js -- already here for the UDP bridge -- ships
 * a serial transport that frames OSC packets with SLIP, and `serialport`,
 * which it needs for that, is already installed as an optional dependency of
 * osc.js and already rebuilt per architecture by the release build.
 *
 * It is still optional at runtime. The serialport version osc.js pins ships
 * no Windows-on-ARM binary, and OSCAR ships a Windows-on-ARM build, so a
 * missing native module is an ordinary condition and not a broken install.
 * Everything here answers "no serial support in this build" rather than
 * throwing: a rig that will not start is worse than one without serial.
 *
 * Server side only. Nothing under lib/widgets/ may require this file -- the
 * widgets are browserified and this reaches for a native module. What they
 * need to know about the cable is in lib/serial-target.js.
 *
 * Web Serial (navigator.serial) is deliberately not used. It opens the port
 * on the machine showing the page, which for OSCAR is the tablet in
 * someone's hand rather than the computer the board is plugged into, and
 * Safari and Firefox do not have it at all.
 */

const UNSUPPORTED = "No serial support in this build of OSCAR.";

// How long to wait before trying the configured port again. A cable knocked
// out mid-show should come back on its own, and a board being reflashed
// disappears for a few seconds every upload. Constant rather than backing
// off: the attempt is cheap, and someone plugging the cable back in is
// standing there waiting for it.
const RETRY_MS = 2000;

// What an Arduino sketch most often opens its port at, and fast enough that a
// fader does not queue behind itself. 9600 -- the other common choice -- moves
// about forty short messages a second, fewer than a finger produces.
const DEFAULT_BITRATE = 115200;
const MIN_BITRATE = 300;
const MAX_BITRATE = 4000000;

/**
 * A baud rate, or null. Never a guess: opening at a rate the board is not
 * using "works" and delivers noise.
 */
function readBitrate(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_BITRATE;
  const number = toNumber(value);
  if (number === null || !Number.isInteger(number)) return null;
  if (number < MIN_BITRATE || number > MAX_BITRATE) return null;
  return number;
}

/**
 * The real transport: whatever osc.js managed to load.
 *
 * Every require is inside the try. On a build without the native module
 * osc.js swallows the failure itself and leaves supportsSerial unset, but
 * that is its behaviour today, not a promise.
 */
function defaultTransport() {
  try {
    const osc = require("osc");
    if (!osc.supportsSerial) {
      return { supported: false, reason: UNSUPPORTED + " (The serial driver is not available on this system.)" };
    }
    return {
      supported: true,
      open: (options) => new osc.SerialPort(options),
      list: async () => {
        const { SerialPort } = require("serialport");
        return (await SerialPort.list()).map(describePort);
      },
    };
  } catch (err) {
    return { supported: false, reason: UNSUPPORTED + " (" + String((err && err.message) || err) + ")" };
  }
}

/** One line a person can pick a board out of: "COM3 -- Arduino LLC". */
function describePort(port) {
  const maker = port.friendlyName || port.manufacturer || "";
  // Windows puts the path in the friendly name already: "Arduino Uno (COM3)".
  const label = !maker ? port.path : maker.indexOf(port.path) !== -1 ? maker : port.path + " -- " + maker;
  return { path: port.path, label: label };
}

/**
 * One serial connection, held open for as long as a port is chosen.
 *
 *   idle      no port chosen
 *   opening   asked the system for the port, no answer yet
 *   open      messages go down the cable
 *   waiting   the port could not be opened, or went away; trying again soon
 *
 * Choosing a port is a standing instruction, not a single attempt: once
 * chosen, the link keeps trying until it is told to stop. That is what makes
 * a cable pulled mid-show, a board plugged in after OSCAR started, and a
 * sketch upload all recover with nobody touching the editor.
 *
 * Options, all optional:
 *   transport           { supported, reason?, open(options), list() }; the
 *                       real one if omitted. Injected by the tests.
 *   retryMs             wait between attempts
 *   setTimer/clearTimer stand-ins for setTimeout/clearTimeout
 *   onChange(status)    the state moved
 *   onMessage(packet)   the board said something (raw osc.js packet)
 *   onError(err)        the port complained while open; may be at packet rate
 */
class SerialLink {
  constructor(options) {
    const o = options || {};
    this.transport = o.transport || defaultTransport();
    this.retryMs = o.retryMs || RETRY_MS;
    this.setTimer = o.setTimer || setTimeout;
    this.clearTimer = o.clearTimer || clearTimeout;
    this.onChange = o.onChange || function () {};
    this.onMessage = o.onMessage || function () {};
    this.onError = o.onError || function () {};

    this.state = "idle";
    this.path = null;
    this.bitrate = DEFAULT_BITRATE;
    this.port = null;
    this.timer = null;
    this.error = null;
    this.sent = 0;
    this.dropped = 0;
    // Which attempt the current port belongs to. A port that has been given
    // up on still fires events -- a close after a failed open, an error from
    // a write already queued -- and acting on those would tear down the port
    // that replaced it.
    this.attempt = 0;
  }

  get supported() {
    return !!(this.transport && this.transport.supported);
  }

  status() {
    return {
      supported: this.supported,
      reason: this.supported ? null : (this.transport && this.transport.reason) || UNSUPPORTED,
      state: this.state,
      path: this.path,
      bitrate: this.bitrate,
      sent: this.sent,
      dropped: this.dropped,
      error: this.error,
    };
  }

  /** The serial ports on this computer; [] when there is no way to ask. */
  async list() {
    if (!this.supported) return [];
    try {
      const ports = await this.transport.list();
      return Array.isArray(ports) ? ports : [];
    } catch (err) {
      this.error = "Could not list serial ports: " + reason(err);
      return [];
    }
  }

  /**
   * Choose a port, replacing whatever was chosen before.
   *
   * Returns a complaint when the request itself is wrong, else null. Null
   * does not mean the port opened -- that is reported through status() and
   * onChange, because a port that is not there yet is a thing to wait for.
   */
  connect(path, bitrate) {
    if (!this.supported) return this.status().reason;
    if (typeof path !== "string" || !path.trim()) return "Pick a serial port first.";
    const rate = readBitrate(bitrate);
    if (rate === null) {
      return "The baud rate has to be a whole number between " + MIN_BITRATE + " and " + MAX_BITRATE + ".";
    }

    this._letGo();
    this.path = path.trim();
    this.bitrate = rate;
    this.error = null;
    this._open();
    return null;
  }

  /** Stop using the cable, and stop trying to. */
  disconnect() {
    this._letGo();
    this.path = null;
    this.error = null;
    this._move("idle");
  }

  /**
   * Send one OSC message down the cable. False when it could not go, so the
   * caller can say so once rather than per fader movement. Nothing is queued
   * for later: a level that arrives when the cable comes back, seconds after
   * the gesture, is a light changing with nobody touching anything.
   *
   * The message is rebuilt here, not trusted. osc.js writes a null or an empty
   * string as four zero bytes, and a 0 on the cable is a light going off. The
   * server has already been through buildMessage() by the time it calls this,
   * but the last gate before the wire should not depend on every future
   * caller remembering to.
   */
  send(message) {
    const checked = message && typeof message === "object" ? buildMessage(message.address, message.args) : null;
    if (!checked || this.state !== "open" || !this.port) {
      this.dropped++;
      return false;
    }
    try {
      this.port.send(checked);
      this.sent++;
      return true;
    } catch (err) {
      this.dropped++;
      this.error = reason(err);
      return false;
    }
  }

  _move(state) {
    if (this.state === state) return;
    this.state = state;
    this.onChange(this.status());
  }

  _open() {
    const attempt = ++this.attempt;
    const mine = () => attempt === this.attempt;
    this._move("opening");

    let port;
    try {
      // metadata: true matches the rest of OSCAR -- arguments carry their OSC
      // type rather than being guessed at from the JavaScript value.
      port = this.transport.open({ devicePath: this.path, bitrate: this.bitrate, metadata: true });
    } catch (err) {
      this._lost(reason(err));
      return;
    }
    this.port = port;

    port.on("ready", () => {
      if (!mine()) return;
      this.error = null;
      this._move("open");
    });

    // osc.js reports a port that would not open, a write that failed and
    // bytes that were not OSC all as "error". Only the first is about the
    // connection, and only timing tells it apart: a failed open is never
    // followed by a close, so without this the link would sit in "opening"
    // for ever. Once open, a genuinely lost port announces itself by closing;
    // an error alone is usually a sketch printing debug text down the line.
    port.on("error", (err) => {
      if (!mine()) return;
      if (this.state === "opening") {
        this._lost(reason(err));
        return;
      }
      this.error = reason(err);
      this.onError(err);
    });

    port.on("close", () => {
      if (!mine()) return;
      this._lost("The serial port closed. Is the cable still plugged in?");
    });

    port.on("message", (packet) => {
      if (mine()) this.onMessage(packet);
    });

    try {
      port.open();
    } catch (err) {
      if (mine()) this._lost(reason(err));
    }
  }

  /** The chosen port is not usable right now: drop it and try again later. */
  _lost(why) {
    this._letGo();
    this.error = why;
    this._move("waiting");
    const timer = this.setTimer(() => {
      if (this.timer !== timer) return;
      this.timer = null;
      if (this.path) this._open();
    }, this.retryMs);
    this.timer = timer;
    // A pending retry must never be the reason OSCAR refuses to exit.
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  /** Release the port and any pending retry, without changing what is chosen. */
  _letGo() {
    // Whatever the old port says from here on is about a port nobody holds.
    this.attempt++;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    const port = this.port;
    this.port = null;
    if (!port) return;
    try {
      port.close();
    } catch (err) {
      /* never opened, or already gone */
    }
  }
}

function reason(err) {
  return String((err && err.message) || err);
}

/**
 * The link plus its memory, which is what the routes and the server talk to.
 *
 * The chosen port is remembered in the settings file for the same reason
 * locked mode is: an installation that reboots overnight has to come back
 * driving its board with nobody there to open the editor. It is remembered
 * even on a build that cannot open it, so moving a project folder to a
 * machine without serial support and back again loses nothing.
 *
 * @param {{ link: SerialLink, settings?: { get: Function, set: Function } }} deps
 */
function serialControl(deps) {
  const link = deps.link;
  const settings = deps.settings || null;

  function remembered() {
    const saved = settings && settings.get("serial");
    if (!saved || typeof saved !== "object" || typeof saved.path !== "string" || !saved.path) return null;
    return { path: saved.path, bitrate: saved.bitrate };
  }

  return {
    status: () => link.status(),
    list: () => link.list(),
    send: (message) => link.send(message),

    /** A complaint, or null once the port is chosen and remembered. */
    connect(path, bitrate) {
      const complaint = link.connect(path, bitrate);
      if (complaint) return complaint;
      if (settings) settings.set("serial", { path: link.path, bitrate: link.bitrate });
      return null;
    },

    disconnect() {
      link.disconnect();
      if (settings && remembered()) settings.set("serial", null);
    },

    /** At startup: go back to the port chosen last time, if there was one. */
    restore() {
      const saved = remembered();
      if (!saved) return null;
      // A complaint here is not written back: the memory is left as it was.
      return link.connect(saved.path, saved.bitrate);
    },

    /** At shutdown: let go of the port without forgetting it. */
    close: () => link.disconnect(),
  };
}

module.exports = {
  SerialLink,
  serialControl,
  defaultTransport,
  describePort,
  readBitrate,
  SERIAL_HOST,
  isSerialTarget,
  RETRY_MS,
  DEFAULT_BITRATE,
  UNSUPPORTED,
};
