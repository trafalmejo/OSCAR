"use strict";

/**
 * The receiving half of OSCAR: reading a message off the wire so it can be
 * handed to the browsers.
 *
 * A browser cannot hold a UDP socket, so the server listens on its behalf and
 * relays what arrives over socket.io as one `osc:in` event per message,
 * carrying { address, args } with the arguments as plain values. Deciding
 * which widget a message is for happens in the browser (lib/widgets/incoming.js),
 * because only the browser knows what is on the surface.
 *
 * Nothing about the sender is kept. Which machine moved a fader is not a thing
 * any widget may act on, and passing it along would invite exactly that.
 */

const { isAddress, MAX_ARGS } = require("./osc-message");

/**
 * One received argument as a plain value, or null for one OSCAR has no use for.
 *
 * With metadata on, osc.js hands over { type, value } -- except for T, F, N
 * and I, where the type tag is the whole argument and `value` is absent. A
 * null here is what a widget's toNumber() refuses, so a blob or a time tag can
 * never be mistaken for a level.
 */
function plainValue(arg) {
  if (arg === null || arg === undefined) return null;
  if (typeof arg !== "object") return finite(arg);

  switch (arg.type) {
    case "T":
      return true;
    case "F":
      return false;
    case "I":
      // An impulse is a bang with nothing attached; a button reads it as ON.
      return true;
    case "i":
    case "f":
    case "d":
      return finite(arg.value);
    case "h":
      // osc.js decodes an int64 as a Long when that library is present, or as
      // a plain number otherwise; either way the widgets want a number.
      return finite(arg.value && typeof arg.value.toNumber === "function" ? arg.value.toNumber() : arg.value);
    case "s":
    case "S":
    case "c":
      return typeof arg.value === "string" ? arg.value : null;
    default:
      return null;
  }
}

function finite(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  return null;
}

/**
 * Turn a received packet into { address, args }, or null if it is not a
 * message OSCAR can act on. Dropped here, once, rather than shipped to every
 * browser for each of them to reject separately.
 */
function parse(packet) {
  if (!packet || typeof packet !== "object") return null;
  if (!isAddress(packet.address)) return null;

  const raw = packet.args;
  const list = raw === null || raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  if (list.length > MAX_ARGS) return null;

  return { address: packet.address, args: list.map(plainValue) };
}

/**
 * Report every message an open osc.js port hears, as parse() reads it.
 *
 * Used by the dedicated listener below and by the sockets OSCAR sends from:
 * software that answers to the port a request came from sends its reply
 * there, and a reply nobody is listening for looks exactly like a rig that
 * never answered. Returns a function that stops listening.
 */
function listenOn(udp, onMessage) {
  function onPacket(packet) {
    const message = parse(packet);
    if (message) onMessage(message);
  }
  udp.on("message", onPacket);
  return function () {
    udp.removeListener("message", onPacket);
  };
}

/**
 * Wrap a reporter so it runs at most once per `quietMs`, and is told how many
 * calls it missed in between.
 *
 * A device blasting something that is not OSC at a port produces one error
 * per packet, at packet rate; one line every few seconds carrying a count
 * says the same thing without burying everything else in the log.
 */
function atMostOncePer(quietMs, fn, now) {
  const clock = now || Date.now;
  let until = 0;
  let missed = 0;
  return function (value) {
    const t = clock();
    if (t < until) {
      missed++;
      return;
    }
    fn(value, missed);
    missed = 0;
    until = t + quietMs;
  };
}

/**
 * Open a UDP socket that reports every OSC message it hears.
 *
 * `UDPPort` is osc.js's, passed in so this module stays free of the transport
 * and a test can hand it a stand-in. Options:
 *   onMessage(message)        a message parse() could read
 *   onReady(udp)              the socket is bound
 *   onError(err)              the socket could not be bound -- the port is
 *                             busy, forbidden, or on an address this machine
 *                             does not have. It has been closed, and nothing
 *                             else happens: the editor, the tablets and
 *                             sending all work without listening, and a show
 *                             that will not start is a worse failure than one
 *                             that cannot receive.
 *   onBadPacket(err, missed)  something arrived that is not OSC, or the socket
 *                             complained after it was up. Reported at most
 *                             once per `quietMs` (default 5000), with how many
 *                             were skipped since the last report.
 *   now()                     the clock the throttle reads; tests pass one
 *
 * osc.js emits both a failed bind and an undecodable packet as "error", and
 * only the timing tells them apart: before "ready" the socket is not up, so an
 * error is the bind failing; afterwards it is about what arrived.
 *
 * Returns { port, close }. `close` is safe to call whatever state the socket
 * ended up in.
 */
function receiver(options) {
  const udp = new options.UDPPort({
    localAddress: options.localAddress || "0.0.0.0",
    localPort: options.port,
    metadata: true,
  });
  let ready = false;
  const badPacket = atMostOncePer(options.quietMs || 5000, options.onBadPacket || function () {}, options.now);

  function close() {
    try {
      udp.close();
    } catch (err) {
      /* never bound, or already closed */
    }
  }

  // An EventEmitter with no error listener throws, which would turn a busy
  // port into a crash: the listener is not optional.
  udp.on("error", function (err) {
    if (ready) {
      badPacket(err);
      return;
    }
    // A socket that could not bind is let go of, so nothing dangles.
    close();
    if (options.onError) options.onError(err);
  });
  udp.on("ready", function () {
    ready = true;
    if (options.onReady) options.onReady(udp);
  });
  listenOn(udp, options.onMessage);

  udp.open();

  return { port: udp, close: close };
}

module.exports = { parse, plainValue, receiver, listenOn, atMostOncePer };
