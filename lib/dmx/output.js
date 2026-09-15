"use strict";

const crypto = require("node:crypto");

const { SLOTS, protocol, defaultHost } = require("./spec");
const { encodeArtDmx, encodeSacn } = require("./packet");

/**
 * A DMX output: every widget's claim on a universe merged into one frame,
 * repeated for as long as anyone is driving it.
 *
 * WHY THIS IS NOT FIRE-AND-FORGET, AS OSC IS
 *
 * OSC is a message: it happens once and the receiver remembers it. DMX is a
 * stream, and both protocols say so. E1.31 (6.7.1) has a receiver treat a
 * source as lost after 2.5 s without a packet, and Art-Net nodes time out at
 * around 4 s; what happens then is the node's choice, and plenty fade to
 * black. Underneath, UDP drops packets, so the one carrying "the fader is at
 * 80%" may never arrive and nothing follows it to say otherwise.
 *
 * So a set() here updates a frame that keeps going out, at least once every
 * REFRESH_MS, well inside both timeouts. The keepalive is armed BEFORE each
 * packet is handed to the socket, not after it succeeds: a node that is
 * unreachable for a few seconds -- a switch rebooting, a cable out -- must
 * start receiving again when it comes back, rather than the stream having
 * quietly died on the first failed send.
 *
 * MERGING
 *
 * Several widgets can drive one universe. Each is a source owning a block of
 * channels, and overlapping blocks merge highest-takes-precedence, which is
 * what every desk does and what an operator expects when two faders reach the
 * same dimmer.
 *
 * LETTING GO
 *
 * A source is released when its widget is deleted or OSCAR quits, and then
 * its channels go to zero on purpose: a rig holding a look nothing on the
 * surface can change any more is worse than a dark one. Nothing else releases.
 * In particular a browser disconnecting does not, because a phone locking its
 * screen mid-show must not black the stage out.
 */

/** Under both the 2.5 s (E1.31) and ~4 s (Art-Net) timeouts, with room for a lost packet. */
const REFRESH_MS = 800;
/** A DMX line refreshes ~44 times a second; faster than this only floods the network. */
const MIN_INTERVAL_MS = 25;
/** E1.31 6.2.6 asks for three terminated packets, so one lost packet is not the end of it. */
const TERMINATE_COUNT = 3;

const realClock = {
  now: Date.now,
  setTimeout: function (fn, ms) {
    const timer = setTimeout(fn, ms);
    // A stream must never be the reason the process stays alive.
    if (timer.unref) timer.unref();
    return timer;
  },
  clearTimeout: clearTimeout,
};

/**
 * @param {function} send  (packet, port, host) => Promise | undefined; the only way out
 * @param {object} [options]
 *   refreshMs, minIntervalMs   timings, for tests
 *   sourceName, cid            what sACN receivers see this sender as
 *   onError(err)               a send failed; the stream carries on
 *   onStream(event, stream)    "open" or "release", with { protocol, host, port, universe }
 *   clock                      { now, setTimeout, clearTimeout }, for tests
 */
function createDmxOutput(send, options) {
  options = options || {};
  const refreshMs = options.refreshMs || REFRESH_MS;
  const minIntervalMs = options.minIntervalMs === undefined ? MIN_INTERVAL_MS : options.minIntervalMs;
  const sourceName = options.sourceName || "OSCAR";
  // One CID for the life of the process. Receivers merge by CID, so a new one
  // per packet would look like an endless crowd of sources arriving.
  const cid = options.cid || crypto.randomBytes(16);
  const onError = options.onError || function () {};
  const onStream = options.onStream || function () {};
  const clock = options.clock || realClock;

  /** source id -> { key, channel, levels } */
  const sources = new Map();
  /** target key -> the stream feeding it */
  const streams = new Map();

  function keyOf(request) {
    return request.protocol + "|" + request.host + "|" + request.universe;
  }

  function describe(stream) {
    return { protocol: stream.protocol, host: stream.host, port: stream.port, universe: stream.universe };
  }

  function open(request, key) {
    const stream = {
      key: key,
      protocol: request.protocol,
      host: request.host || defaultHost(request.protocol, request.universe),
      port: protocol(request.protocol).port,
      universe: request.universe,
      frame: Buffer.alloc(SLOTS),
      seq: 0,
      lastSent: -Infinity,
      pending: null,
      keepalive: null,
    };
    streams.set(key, stream);
    onStream("open", describe(stream));
    return stream;
  }

  function live(stream) {
    return streams.get(stream.key) === stream;
  }

  /** Rebuild a universe's frame from every source pointing at it. */
  function compose(stream) {
    stream.frame.fill(0);
    for (const source of sources.values()) {
      if (source.key !== stream.key) continue;
      for (let i = 0; i < source.levels.length; i++) {
        const slot = source.channel - 1 + i;
        if (source.levels[i] > stream.frame[slot]) stream.frame[slot] = source.levels[i];
      }
    }
  }

  function arm(stream) {
    if (stream.keepalive) clock.clearTimeout(stream.keepalive);
    stream.keepalive = clock.setTimeout(function () {
      stream.keepalive = null;
      // A stream released while this was waiting must not come back to life.
      if (live(stream)) transmit(stream);
    }, refreshMs);
  }

  function encode(stream, terminated) {
    if (stream.protocol === "sacn") {
      // E1.31 sequence numbers wrap through zero.
      stream.seq = (stream.seq + 1) & 0xff;
      return encodeSacn({
        cid: cid,
        sourceName: sourceName,
        universe: stream.universe,
        sequence: stream.seq,
        data: stream.frame,
        terminated: terminated,
      });
    }
    // Art-Net reserves 0 for "do not check ordering", so this counts 1..255.
    stream.seq = (stream.seq % 255) + 1;
    return encodeArtDmx(stream.universe, stream.seq, stream.frame);
  }

  /** Put the frame on the wire now. Never rejects: a failure is reported and the stream goes on. */
  function transmit(stream, terminated) {
    if (live(stream)) arm(stream);
    stream.lastSent = clock.now();
    try {
      return Promise.resolve(send(encode(stream, !!terminated), stream.port, stream.host)).catch(onError);
    } catch (err) {
      onError(err);
      return Promise.resolve();
    }
  }

  /**
   * Send now, or once the rate window closes. A deferred send picks up
   * whatever the frame holds by then, so a drag collapses into the latest
   * position rather than a backlog of stale ones.
   */
  function flush(stream) {
    const wait = stream.lastSent + minIntervalMs - clock.now();
    if (wait <= 0) return transmit(stream);
    if (!stream.pending) {
      stream.pending = clock.setTimeout(function () {
        stream.pending = null;
        if (live(stream)) transmit(stream);
      }, wait);
    }
    return Promise.resolve();
  }

  /** Forget a stream without a word to the receivers. */
  function drop(stream) {
    if (stream.keepalive) clock.clearTimeout(stream.keepalive);
    if (stream.pending) clock.clearTimeout(stream.pending);
    stream.keepalive = null;
    stream.pending = null;
    if (live(stream)) streams.delete(stream.key);
  }

  /**
   * Hand a universe back rather than walk away from it.
   *
   * The zero frame is an instruction, not a dropped value: these channels were
   * given up, and leaving them at their last level would pin them against
   * anything else driving the rig.
   */
  function release(stream) {
    drop(stream);
    stream.frame.fill(0);
    let done = transmit(stream);
    if (stream.protocol === "sacn") {
      for (let i = 0; i < TERMINATE_COUNT; i++) {
        done = done.then(function () {
          return transmit(stream, true);
        });
      }
    }
    onStream("release", describe(stream));
    return done;
  }

  function detach(sourceId) {
    const source = sources.get(sourceId);
    if (!source) return Promise.resolve(false);
    sources.delete(sourceId);

    const stream = streams.get(source.key);
    if (!stream) return Promise.resolve(true);

    for (const other of sources.values()) {
      if (other.key === stream.key) {
        compose(stream);
        return flush(stream).then(function () {
          return true;
        });
      }
    }
    return release(stream).then(function () {
      return true;
    });
  }

  /**
   * Point one source at a block of channels and put its levels there.
   *
   * The same source id replaces its own previous claim -- on another block,
   * or another universe entirely -- rather than adding a second one.
   *
   * @param {string} sourceId  which widget this is
   * @param {object} request   already through buildRequest()
   * @returns {Promise} settled once the frame has been handed to the socket
   *                    or scheduled; never rejects
   */
  function set(sourceId, request) {
    const key = keyOf(request);
    const previous = sources.get(sourceId);
    const moved = previous && previous.key !== key ? detach(sourceId) : Promise.resolve();

    return moved.then(function () {
      sources.set(sourceId, { key: key, channel: request.channel, levels: request.levels.slice() });
      const stream = streams.get(key) || open(request, key);
      compose(stream);
      return flush(stream);
    });
  }

  /** Release one source. Resolves to whether it was known. */
  function stop(sourceId) {
    return detach(sourceId);
  }

  /** Release every source: what quitting does, unless told to hold. */
  function stopAll() {
    sources.clear();
    const releases = [];
    for (const stream of [...streams.values()]) releases.push(release(stream));
    return Promise.all(releases).then(function () {});
  }

  /**
   * Stop transmitting without a word, leaving receivers on their last look.
   * For a permanent installation that should stay lit through a restart.
   */
  function close() {
    for (const stream of [...streams.values()]) drop(stream);
    sources.clear();
  }

  return {
    set: set,
    stop: stop,
    stopAll: stopAll,
    close: close,
    active: function () {
      return streams.size > 0;
    },
    universes: function () {
      return [...streams.values()].map(describe);
    },
  };
}

module.exports = { createDmxOutput, REFRESH_MS, MIN_INTERVAL_MS, TERMINATE_COUNT };
