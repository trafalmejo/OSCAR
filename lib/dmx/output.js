"use strict";

const crypto = require("node:crypto");

const { SLOTS, protocol, defaultHost } = require("./spec");
const { encodeArtDmx, encodeSacn } = require("./packet");

/**
 * A DMX output: several widgets, merged into a frame per universe, repeated
 * for as long as anyone is driving it.
 *
 * WHY THIS IS NOT FIRE-AND-FORGET, AS OSC IS
 *
 * OSC is a message: it happens once and the receiver remembers it. DMX is a
 * stream, and both protocols here say so out loud. E1.31 6.7.1 tells a receiver
 * to consider a source lost after 2.5 s without a packet, and Art-Net's
 * specification has nodes time out after about 4 s; what happens then is the
 * node's choice, and plenty of them fade to black. On top of that the transport
 * is UDP, so the single packet carrying "the fader is at 80%" may simply not
 * arrive, and with nothing following it the rig sits at the old level forever.
 *
 * So a send here does not put a packet on the wire and forget. It updates a
 * frame that OSCAR keeps transmitting, at least once every REFRESH_MS, which is
 * comfortably inside both timeouts. The cost is a little idle traffic on one
 * universe per target actually in use; the alternative is a light that goes out
 * because nobody touched a slider for three seconds.
 *
 * MERGING
 *
 * Several widgets can drive one universe. Each is a source owning a block of
 * channels, and blocks that overlap merge highest-takes-precedence, which is
 * what every lighting desk does and what an operator expects when two faders
 * reach the same dimmer.
 */

/** Under both the 2.5 s (E1.31) and ~4 s (Art-Net) timeouts, with room to spare. */
const REFRESH_MS = 800;
/**
 * A DMX line refreshes about 44 times a second, so sending faster than this
 * only floods the network; a dragged slider would otherwise send per frame.
 */
const MIN_INTERVAL_MS = 25;
/** E1.31 6.2.6: three terminated packets, so one lost packet is not the end of it. */
const TERMINATE_COUNT = 3;

const defaultClock = {
  now: Date.now,
  setTimeout: function (fn, ms) {
    const timer = setTimeout(fn, ms);
    // A DMX stream must never be the reason the process stays alive.
    if (timer.unref) timer.unref();
    return timer;
  },
  clearTimeout: clearTimeout,
};

/**
 * @param {function} send  (packet, port, host) => Promise, the only way out
 * @param {object} [options] refreshMs, minIntervalMs, sourceName, cid, onError, clock
 */
function createDmxOutput(send, options) {
  options = options || {};

  const refreshMs = options.refreshMs || REFRESH_MS;
  const minIntervalMs =
    options.minIntervalMs === undefined ? MIN_INTERVAL_MS : options.minIntervalMs;
  const sourceName = options.sourceName || "OSCAR";
  // One CID for the life of the process: receivers merge by CID, so a new one
  // per packet would look like an endless crowd of sources arriving and leaving.
  const cid = options.cid || crypto.randomBytes(16);
  const onError = options.onError || function () {};
  const clock = options.clock || defaultClock;

  /** sourceId -> { key, channel, levels } */
  const sources = new Map();
  /** target key -> the stream feeding it */
  const streams = new Map();

  // Requests arrive back to back from a dragged slider, and a request can move
  // a source from one universe to another. Serialising means a move never
  // interleaves with the update that follows it.
  let chain = Promise.resolve();
  function enqueue(fn) {
    const run = chain.then(fn);
    chain = run.catch(function () {});
    return run;
  }

  function keyOf(request) {
    return request.protocol + "|" + request.host + "|" + request.universe;
  }

  function openStream(request, key) {
    const spec = protocol(request.protocol);
    const stream = {
      key: key,
      protocol: request.protocol,
      host: request.host || defaultHost(request.protocol, request.universe),
      port: spec.port,
      universe: request.universe,
      frame: Buffer.alloc(SLOTS),
      seq: 0,
      lastSent: -Infinity,
      pending: null,
      keepalive: null,
    };
    streams.set(key, stream);
    return stream;
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
      if (streams.get(stream.key) !== stream) return;
      transmit(stream).catch(onError);
    }, refreshMs);
  }

  function transmit(stream, packetOptions) {
    // Armed before the send, not after: a node that is unreachable for a few
    // seconds should start receiving again when it comes back, rather than
    // having quietly killed the stream on its way out.
    if (streams.get(stream.key) === stream) arm(stream);
    stream.lastSent = clock.now();

    let packet;
    if (stream.protocol === "sacn") {
      // E1.31 sequence numbers wrap through zero.
      stream.seq = (stream.seq + 1) & 0xff;
      packet = encodeSacn({
        cid: cid,
        sourceName: sourceName,
        universe: stream.universe,
        sequence: stream.seq,
        data: stream.frame,
        terminated: !!(packetOptions && packetOptions.terminated),
      });
    } else {
      // Art-Net reserves 0 to mean "ignore ordering", so this counts 1..255.
      stream.seq = (stream.seq % 255) + 1;
      packet = encodeArtDmx(stream.universe, stream.seq, stream.frame);
    }

    return Promise.resolve(send(packet, stream.port, stream.host));
  }

  /**
   * Send now, or once the rate window closes. The deferred send picks up
   * whatever the frame holds by then, so a drag collapses into the latest
   * position rather than a backlog of stale ones.
   */
  function flush(stream) {
    const wait = stream.lastSent + minIntervalMs - clock.now();
    if (wait <= 0) return transmit(stream);

    if (!stream.pending) {
      stream.pending = clock.setTimeout(function () {
        stream.pending = null;
        if (streams.get(stream.key) !== stream) return;
        transmit(stream).catch(onError);
      }, wait);
    }
    return Promise.resolve();
  }

  /** Forget a stream silently -- used when we could not reach it at all. */
  function dropStream(stream) {
    if (stream.keepalive) clock.clearTimeout(stream.keepalive);
    if (stream.pending) clock.clearTimeout(stream.pending);
    stream.keepalive = null;
    stream.pending = null;
    if (streams.get(stream.key) === stream) streams.delete(stream.key);
  }

  /**
   * Hand the universe back rather than walking away from it.
   *
   * A zero frame here is an instruction, not a dropped value: someone asked for
   * these channels to be given up. Leaving the stream running would pin them at
   * their last level against anything else driving the same rig.
   */
  function releaseStream(stream) {
    dropStream(stream);
    stream.frame.fill(0);

    let done = transmit(stream);
    if (stream.protocol === "sacn") {
      for (let i = 0; i < TERMINATE_COUNT; i++) {
        done = done.then(function () {
          return transmit(stream, { terminated: true });
        });
      }
    }
    return done;
  }

  function detach(sourceId) {
    const source = sources.get(sourceId);
    if (!source) return Promise.resolve(false);
    sources.delete(sourceId);

    const stream = streams.get(source.key);
    if (!stream) return Promise.resolve(true);

    const stillDriven = [...sources.values()].some(function (other) {
      return other.key === stream.key;
    });
    if (!stillDriven) return releaseStream(stream).then(function () { return true; });

    compose(stream);
    return flush(stream).then(function () { return true; });
  }

  /**
   * Point one source at a block of channels and put its levels there.
   *
   * @param {string} sourceId which widget this is; the same id replaces its own
   *                          previous claim rather than adding a second one
   * @param {object} request  already through buildRequest
   */
  function set(sourceId, request) {
    const key = keyOf(request);

    return enqueue(function () {
      const previous = sources.get(sourceId);
      const moved = previous && previous.key !== key;

      return (moved ? detach(sourceId) : Promise.resolve()).then(function () {
        sources.set(sourceId, {
          key: key,
          channel: request.channel,
          levels: request.levels.slice(),
        });

        const fresh = !streams.has(key);
        const stream = streams.get(key) || openStream(request, key);
        compose(stream);

        return flush(stream).then(
          function () {
            return {
              source: sourceId,
              protocol: stream.protocol,
              host: stream.host,
              port: stream.port,
              universe: stream.universe,
              channel: request.channel,
              levels: request.levels,
            };
          },
          function (err) {
            // Unreachable target: undo, so a dead stream is not left repeating
            // into nowhere once a second for the rest of the show.
            sources.delete(sourceId);
            if (fresh) dropStream(stream);
            throw err;
          }
        );
      });
    });
  }

  /** Release one source, or every source when called with nothing. */
  function stop(sourceId) {
    return enqueue(function () {
      if (sourceId !== undefined) return detach(sourceId);

      const had = streams.size > 0;
      sources.clear();
      let done = Promise.resolve();
      for (const stream of [...streams.values()]) {
        done = done.then(function () {
          return releaseStream(stream);
        });
      }
      return done.then(function () {
        return had;
      });
    });
  }

  /**
   * Stop transmitting without telling anyone, leaving receivers on their last
   * look. For shutting down an installation that should stay lit.
   */
  function close() {
    for (const stream of [...streams.values()]) dropStream(stream);
    sources.clear();
  }

  return {
    set: set,
    stop: stop,
    close: close,
    active: function () {
      return streams.size > 0;
    },
    universes: function () {
      return [...streams.keys()];
    },
  };
}

module.exports = { createDmxOutput, REFRESH_MS, MIN_INTERVAL_MS, TERMINATE_COUNT };
