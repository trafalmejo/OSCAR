"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { createDmxOutput, REFRESH_MS, MIN_INTERVAL_MS, TERMINATE_COUNT } = require("../../lib/dmx/output");
const { buildRequest } = require("../../lib/dmx/request");
const { ARTNET_PORT, SACN_PORT } = require("../../lib/dmx/spec");
const { ARTNET_HEADER, SACN_HEADER, OPT_STREAM_TERMINATED } = require("../../lib/dmx/packet");

/**
 * The output is a stream, so most of what it does happens on a timer. These
 * tests drive a clock of their own: a test that sleeps for the keepalive is
 * slow and the first to fail on a busy machine, and what is being checked --
 * that the gap between packets never grows past a receiver's timeout -- is
 * worth an exact answer.
 */
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
    /** Run every timer due within `ms`, in order, letting promises settle between. */
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        let due = null;
        for (const [id, timer] of timers) {
          if (!due || timer.at < due[1].at) due = [id, timer];
        }
        if (!due || due[1].at > until) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
        await settle();
      }
      now = until;
    },
    pending: () => timers.size,
  };
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** An output whose packets land in a list instead of on a network. */
function harness(options) {
  const clock = fakeClock();
  const sent = [];
  const events = [];
  const errors = [];
  const output = createDmxOutput(
    (packet, port, host) => {
      sent.push({ packet, port, host, at: clock.now() });
      if (options && options.fail) return Promise.reject(new Error("ENETUNREACH"));
      return Promise.resolve();
    },
    Object.assign(
      {
        clock,
        cid: Buffer.alloc(16, 9),
        onStream: (event, stream) => events.push(event + " " + stream.protocol + " " + stream.universe),
        onError: (err) => errors.push(err.message),
      },
      options
    )
  );
  return { sent, events, errors, output, clock };
}

function request(overrides) {
  const built = buildRequest(
    Object.assign({ protocol: "artnet", host: "10.0.0.5", universe: 1, channel: 1, levels: [255], source: "a" }, overrides)
  );
  assert.ok(built, "the fixture itself must be a valid request");
  return built;
}

/** Read one channel out of a packet, whichever protocol wrote it. */
function channel(entry, number) {
  const at = entry.port === SACN_PORT ? SACN_HEADER : ARTNET_HEADER;
  return entry.packet[at + number - 1];
}

// --- putting a frame on the wire --------------------------------------------

test("a first update goes out at once, as a whole universe", async () => {
  const { sent, output, events } = harness();
  await output.set("a", request({ channel: 3, levels: [200] }));
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].host, "10.0.0.5");
  assert.strictEqual(sent[0].port, ARTNET_PORT);
  assert.strictEqual(sent[0].packet.length, ARTNET_HEADER + 512);
  assert.strictEqual(channel(sent[0], 3), 200);
  assert.strictEqual(channel(sent[0], 2), 0, "channels nobody claimed stay at zero");
  assert.deepStrictEqual(events, ["open artnet 1"]);
});

test("a blank node sends where each protocol expects to be heard", async () => {
  const art = harness();
  await art.output.set("a", request({ host: "" }));
  assert.strictEqual(art.sent[0].host, "255.255.255.255");
  assert.strictEqual(art.sent[0].port, ARTNET_PORT);

  const sacn = harness();
  await sacn.output.set("a", request({ protocol: "sacn", host: "", universe: 300 }));
  assert.strictEqual(sacn.sent[0].host, "239.255.1.44", "the universe's multicast group");
  assert.strictEqual(sacn.sent[0].port, SACN_PORT);
  assert.strictEqual(sacn.sent[0].packet.readUInt16BE(113), 300);
});

test("the sequence counts 1-255 for Art-Net and wraps through 0 for sACN", async () => {
  const art = harness({ minIntervalMs: 0 });
  for (let i = 0; i < 256; i++) await art.output.set("a", request());
  const artSeq = art.sent.map((e) => e.packet[12]);
  assert.strictEqual(artSeq[0], 1);
  assert.strictEqual(artSeq[254], 255);
  assert.strictEqual(artSeq[255], 1, "never 0, which would switch ordering checks off");

  const sacn = harness({ minIntervalMs: 0 });
  for (let i = 0; i < 257; i++) await sacn.output.set("a", request({ protocol: "sacn" }));
  const sacnSeq = sacn.sent.map((e) => e.packet[111]);
  assert.strictEqual(sacnSeq[254], 255);
  assert.strictEqual(sacnSeq[255], 0);
  assert.strictEqual(sacnSeq[256], 1);
});

test("updates inside the rate window collapse into one packet carrying the latest frame", async () => {
  const { sent, output, clock } = harness();
  await output.set("a", request({ levels: [10] }));
  await output.set("a", request({ levels: [20] }));
  await output.set("a", request({ levels: [30] }));
  assert.strictEqual(sent.length, 1, "only the first went out at once");
  await clock.advance(MIN_INTERVAL_MS);
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(channel(sent[1], 1), 30, "and the deferred one carries the last position");
});

// --- keeping the stream alive -----------------------------------------------

test("a frame nobody touches is repeated, and the gap never reaches a receiver's timeout", async () => {
  const { sent, output, clock } = harness();
  await output.set("a", request({ levels: [90] }));
  await clock.advance(10000);
  assert.ok(sent.length >= 12, "repeated: " + sent.length + " packets in 10 s");
  for (let i = 1; i < sent.length; i++) {
    const gap = sent[i].at - sent[i - 1].at;
    assert.ok(gap <= REFRESH_MS, "gap of " + gap + " ms");
    assert.strictEqual(channel(sent[i], 1), 90, "every repeat carries the frame");
  }
  assert.ok(REFRESH_MS < 2500 / 2, "with room for a lost packet under E1.31's 2.5 s");
});

test("a send that fails does not kill the stream: the keepalive is armed before the packet goes", async () => {
  // A switch rebooting, a cable out. When the node is back it must find the
  // stream still running, not have to wait for someone to touch a fader.
  const { sent, errors, output, clock } = harness({ fail: true });
  await output.set("a", request());
  assert.strictEqual(errors.length, 1, "the failure was reported");
  await clock.advance(REFRESH_MS * 3);
  assert.ok(sent.length >= 4, "and the stream kept trying: " + sent.length);
  assert.strictEqual(errors.length, sent.length);
});

test("a send that throws is reported the same way", async () => {
  const errors = [];
  const output = createDmxOutput(
    () => {
      throw new Error("ERR_SOCKET_DGRAM_NOT_RUNNING");
    },
    { clock: fakeClock(), onError: (err) => errors.push(err.message) }
  );
  await output.set("a", request());
  assert.deepStrictEqual(errors, ["ERR_SOCKET_DGRAM_NOT_RUNNING"]);
});

// --- merging ----------------------------------------------------------------

test("two widgets on one universe share a frame, highest takes precedence where they overlap", async () => {
  const { sent, output, clock } = harness();
  await output.set("a", request({ channel: 1, levels: [100, 100, 100] }));
  await clock.advance(MIN_INTERVAL_MS);
  await output.set("b", request({ channel: 3, levels: [50, 200] }));
  const last = sent[sent.length - 1];
  assert.deepStrictEqual([1, 2, 3, 4].map((n) => channel(last, n)), [100, 100, 100, 200]);
});

test("a widget moving its block lets go of the channels it left", async () => {
  const { sent, output, clock } = harness();
  await output.set("a", request({ channel: 1, levels: [255] }));
  await clock.advance(MIN_INTERVAL_MS);
  await output.set("a", request({ channel: 2, levels: [255] }));
  const last = sent[sent.length - 1];
  assert.strictEqual(channel(last, 1), 0);
  assert.strictEqual(channel(last, 2), 255);
});

test("a widget moving to another universe releases the one it left", async () => {
  const { sent, events, output, clock } = harness();
  await output.set("a", request({ universe: 1 }));
  await clock.advance(MIN_INTERVAL_MS);
  await output.set("a", request({ universe: 2 }));
  assert.deepStrictEqual(events, ["open artnet 1", "release artnet 1", "open artnet 2"]);
  const left = sent.filter((e) => e.packet[14] === 1);
  assert.strictEqual(channel(left[left.length - 1], 1), 0, "universe 1 was zeroed on the way out");
  await clock.advance(REFRESH_MS * 2);
  assert.strictEqual(sent.filter((e) => e.packet[14] === 1).length, left.length, "and is not repeated any more");
});

// --- letting go -------------------------------------------------------------

test("releasing the last widget on a universe zeroes it and stops the stream", async () => {
  const { sent, output, clock, events } = harness();
  await output.set("a", request({ levels: [255] }));
  await clock.advance(MIN_INTERVAL_MS);
  assert.strictEqual(await output.stop("a"), true);
  assert.strictEqual(channel(sent[sent.length - 1], 1), 0, "an instruction, not a dropped value");
  assert.strictEqual(output.active(), false);
  const before = sent.length;
  await clock.advance(REFRESH_MS * 3);
  assert.strictEqual(sent.length, before, "nothing more goes out");
  assert.strictEqual(clock.pending(), 0, "and no timer is left behind");
  assert.deepStrictEqual(events, ["open artnet 1", "release artnet 1"]);
  assert.strictEqual(await output.stop("a"), false, "a second release is nothing");
});

test("releasing one widget leaves the other's channels alone", async () => {
  const { sent, output, clock } = harness();
  await output.set("a", request({ channel: 1, levels: [100] }));
  await output.set("b", request({ channel: 2, levels: [200] }));
  await clock.advance(MIN_INTERVAL_MS);
  await output.stop("a");
  await clock.advance(MIN_INTERVAL_MS);
  const last = sent[sent.length - 1];
  assert.strictEqual(channel(last, 1), 0);
  assert.strictEqual(channel(last, 2), 200);
  assert.strictEqual(output.active(), true);
});

test("an sACN release follows the zero frame with three terminated packets", async () => {
  const { sent, output, clock } = harness();
  await output.set("a", request({ protocol: "sacn", levels: [255] }));
  await clock.advance(MIN_INTERVAL_MS);
  await output.stop("a");
  const tail = sent.slice(-(TERMINATE_COUNT + 1));
  assert.strictEqual(TERMINATE_COUNT, 3);
  assert.strictEqual(tail[0].packet[112], 0, "a plain zero frame first");
  assert.strictEqual(channel(tail[0], 1), 0);
  for (const entry of tail.slice(1)) {
    assert.strictEqual(entry.packet[112], OPT_STREAM_TERMINATED);
    assert.strictEqual(channel(entry, 1), 0);
  }
});

test("stopAll releases every universe: what quitting does", async () => {
  const { sent, output, clock } = harness();
  await output.set("a", request({ universe: 1, levels: [255] }));
  await output.set("b", request({ universe: 2, protocol: "sacn", levels: [255] }));
  await clock.advance(MIN_INTERVAL_MS);
  await output.stopAll();
  assert.strictEqual(output.active(), false);
  assert.strictEqual(clock.pending(), 0);
  const zeros = sent.filter((e) => channel(e, 1) === 0);
  assert.ok(zeros.some((e) => e.port === ARTNET_PORT));
  assert.ok(zeros.some((e) => e.port === SACN_PORT));
});

test("close stops transmitting without a word, so a permanent installation keeps its look", async () => {
  const { sent, output, clock } = harness();
  await output.set("a", request({ levels: [255] }));
  const before = sent.length;
  output.close();
  await clock.advance(REFRESH_MS * 3);
  assert.strictEqual(sent.length, before, "no zero frame, no repeats");
  assert.strictEqual(output.active(), false);
  assert.strictEqual(clock.pending(), 0);
});

test("a released stream's timers are dead: a late keepalive cannot revive it", async () => {
  const { sent, output, clock } = harness();
  await output.set("a", request({ levels: [255] }));
  await output.set("a", request({ levels: [128] }));
  // Both a keepalive and a deferred send are now pending.
  await output.stop("a");
  const before = sent.length;
  await clock.advance(REFRESH_MS * 2);
  assert.strictEqual(sent.length, before);
});

test("what is on the air can be listed", async () => {
  const { output } = harness();
  await output.set("a", request({ universe: 4, host: "" }));
  assert.deepStrictEqual(output.universes(), [{ protocol: "artnet", host: "255.255.255.255", port: ARTNET_PORT, universe: 4 }]);
});

test("the real clock unrefs its timers, so a stream cannot keep the process alive", async () => {
  const output = createDmxOutput(() => Promise.resolve(), { onError: () => {} });
  await output.set("a", request());
  // Nothing to assert beyond finishing: a ref'd timer would hang the runner
  // for REFRESH_MS after close(), and a leaked one forever.
  output.close();
});
