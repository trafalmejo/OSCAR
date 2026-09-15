"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { createDmxOutput } = require("../lib/dmx/output");
const { buildRequest } = require("../lib/dmx/request");
const { ARTNET_PORT, SACN_PORT } = require("../lib/dmx/spec");

/**
 * The DMX output is a stream, so most of what it does happens on a timer. Tests
 * drive a clock of their own rather than waiting on the real one: a test that
 * sleeps for the keepalive is both slow and the first thing to fail on a busy
 * machine, and what is being checked here -- that the gap between packets never
 * grows past the receiver's timeout -- deserves an exact answer.
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

    /** Run every timer due within `ms`, in order, letting promises settle. */
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
  const sent = [];
  const output = createDmxOutput(
    (packet, port, host) => {
      sent.push({ packet, port, host, at: clock.now() });
      return Promise.resolve();
    },
    Object.assign({ clock: undefined, cid: Buffer.alloc(16, 9) }, options)
  );
  const clock = options.clock;
  return { sent, output, clock };
}

function request(overrides) {
  const built = buildRequest(
    Object.assign(
      { protocol: "artnet", host: "10.0.0.5", universe: 1, channel: 1, levels: [255], source: "a" },
      overrides
    )
  );
  assert.ok(built, "the test fixture itself has to be a valid request");
  return built;
}

/** Read a channel out of a packet, whichever protocol wrote it. */
function channel(entry, number) {
  const at = entry.port === SACN_PORT ? 126 : 18;
  return entry.packet[at + number - 1];
}

function withClock(options) {
  const clock = fakeClock();
  return harness(Object.assign({ clock: clock }, options));
}

// --- putting a frame on the wire --------------------------------------------

test("a first update goes out at once, not on the next refresh", () => {
  const { sent, output } = withClock({});

  return output.set("a", request({ channel: 3, levels: [200] })).then(() => {
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].host, "10.0.0.5");
    assert.strictEqual(sent[0].port, ARTNET_PORT);
    assert.strictEqual(channel(sent[0], 3), 200);
    assert.strictEqual(channel(sent[0], 2), 0, "channels nobody claimed stay at zero");
    assert.strictEqual(sent[0].packet.length, 18 + 512, "always a whole universe");
  });
});

test("a blank node sends where each protocol expects to be heard", async () => {
  const art = withClock({});
  await art.output.set("a", request({ host: "" }));
  assert.strictEqual(art.sent[0].host, "255.255.255.255");
  assert.strictEqual(art.sent[0].port, ARTNET_PORT);

  const sacn = withClock({});
  await sacn.output.set("a", request({ protocol: "sacn", host: "", universe: 300 }));
  assert.strictEqual(sacn.sent[0].host, "239.255.1.44", "the universe's multicast group");
  assert.strictEqual(sacn.sent[0].port, SACN_PORT);
});

// --- merging ----------------------------------------------------------------

test("two widgets on one universe share a frame instead of overwriting each other", async () => {
  const { sent, output } = withClock({ minIntervalMs: 0 });

  await output.set("a", request({ source: "a", channel: 1, levels: [100] }));
  await output.set("b", request({ source: "b", channel: 5, levels: [50] }));

  const last = sent[sent.length - 1];
  assert.strictEqual(channel(last, 1), 100, "the first widget is still there");
  assert.strictEqual(channel(last, 5), 50);
});

test("widgets that overlap merge highest-takes-precedence, as a desk would", async () => {
  const { sent, output } = withClock({ minIntervalMs: 0 });

  await output.set("a", request({ source: "a", channel: 1, levels: [200, 200, 200] }));
  await output.set("b", request({ source: "b", channel: 2, levels: [60] }));

  let last = sent[sent.length - 1];
  assert.deepStrictEqual(
    [channel(last, 1), channel(last, 2), channel(last, 3)],
    [200, 200, 200],
    "the lower of two claims does not pull the channel down"
  );

  await output.set("b", request({ source: "b", channel: 2, levels: [255] }));
  last = sent[sent.length - 1];
  assert.strictEqual(channel(last, 2), 255, "the higher claim wins");
});

test("a widget replaces its own previous claim rather than adding a second one", async () => {
  const { sent, output } = withClock({ minIntervalMs: 0 });

  await output.set("a", request({ channel: 1, levels: [255] }));
  await output.set("a", request({ channel: 1, levels: [10] }));

  // Without this, HTP merging would pin the channel at 255 forever and the
  // fader would only ever go up.
  assert.strictEqual(channel(sent[sent.length - 1], 1), 10);
});

test("universes are separate frames, sent separately", async () => {
  const { sent, output } = withClock({ minIntervalMs: 0 });

  await output.set("a", request({ source: "a", universe: 1, channel: 1, levels: [11] }));
  await output.set("b", request({ source: "b", universe: 2, channel: 1, levels: [22] }));

  assert.strictEqual(output.universes().length, 2);
  const last = sent[sent.length - 1];
  assert.strictEqual(channel(last, 1), 22, "the second universe carries only its own widget");
});

test("moving a widget to another universe hands the old one back", async () => {
  const { sent, output } = withClock({ minIntervalMs: 0 });

  await output.set("a", request({ universe: 1, channel: 1, levels: [255] }));
  sent.length = 0;
  await output.set("a", request({ universe: 2, channel: 1, levels: [255] }));

  // Universe 1 has nobody left driving it, so it must not be abandoned holding
  // a channel at full.
  assert.deepStrictEqual(output.universes(), ["artnet|10.0.0.5|2"]);
  assert.strictEqual(channel(sent[0], 1), 0, "universe 1 was zeroed on the way out");
});

// --- the stream -------------------------------------------------------------

test("the stream keeps going when nobody touches anything", async () => {
  const { sent, output, clock } = withClock({ refreshMs: 800 });

  await output.set("a", request({ levels: [128] }));
  assert.strictEqual(sent.length, 1);

  await clock.advance(5000);

  assert.ok(sent.length >= 6, "six seconds of silence still sends, got " + sent.length);
  for (const entry of sent) {
    assert.strictEqual(channel(entry, 1), 128, "and it keeps sending the same look");
  }
});

test("no gap between packets ever reaches a receiver's timeout", async () => {
  // E1.31 6.7.1 has a receiver give up on a source after 2.5 s, and Art-Net
  // nodes time out at around 4 s. Whatever else this code does, the gap is the
  // number that decides whether the lights stay on.
  const { sent, output, clock } = withClock({ refreshMs: 800 });

  await output.set("a", request());
  await clock.advance(10000);

  let previous = sent[0].at;
  for (const entry of sent.slice(1)) {
    assert.ok(entry.at - previous <= 800, "gap of " + (entry.at - previous) + "ms");
    previous = entry.at;
  }
  assert.ok(10000 - previous <= 800, "and one is due now");
});

test("a burst of updates is thinned out, but the last position always arrives", async () => {
  const { sent, output, clock } = withClock({ minIntervalMs: 25, refreshMs: 800 });

  // A dragged slider, faster than any DMX line can refresh.
  for (let i = 1; i <= 20; i++) await output.set("a", request({ levels: [i] }));

  assert.ok(sent.length < 20, "not one packet per input event, got " + sent.length);

  await clock.advance(50);
  assert.strictEqual(
    channel(sent[sent.length - 1], 1),
    20,
    "where the operator let go is what the rig ends up holding"
  );
});

test("the refresh stops once the last widget lets go", async () => {
  const { sent, output, clock } = withClock({});

  await output.set("a", request());
  await output.stop("a");
  assert.strictEqual(output.active(), false);

  const after = sent.length;
  await clock.advance(10000);
  assert.strictEqual(sent.length, after, "nothing is still ticking away in the background");
  assert.strictEqual(clock.pending(), 0, "and no timer is left behind");
});

// --- sequence numbers -------------------------------------------------------

test("Art-Net sequence numbers count 1-255 and never sit at 0", async () => {
  const { sent, output } = withClock({ minIntervalMs: 0 });

  for (let i = 0; i < 300; i++) await output.set("a", request({ levels: [i % 256] }));

  const seqs = sent.map((entry) => entry.packet[12]);
  // 0 tells an Art-Net node to stop checking the order of what it receives, so
  // a counter that wraps through it quietly disables reordering once a minute.
  assert.ok(!seqs.includes(0), "0 means 'ignore ordering' and is not a sequence number");
  assert.deepStrictEqual(seqs.slice(0, 3), [1, 2, 3]);
  assert.deepStrictEqual(seqs.slice(254, 257), [255, 1, 2], "wraps back to 1");
});

test("sACN sequence numbers wrap through zero, as E1.31 says they do", async () => {
  const { sent, output } = withClock({ minIntervalMs: 0 });

  for (let i = 0; i < 300; i++) {
    await output.set("a", request({ protocol: "sacn", levels: [i % 256] }));
  }

  const seqs = sent.map((entry) => entry.packet[111]);
  assert.deepStrictEqual(seqs.slice(0, 3), [1, 2, 3]);
  assert.deepStrictEqual(seqs.slice(254, 257), [255, 0, 1]);
});

// --- releasing --------------------------------------------------------------

test("releasing a widget zeroes its channels rather than walking away from them", async () => {
  const { sent, output } = withClock({ minIntervalMs: 0 });

  await output.set("a", request({ channel: 7, levels: [255] }));
  sent.length = 0;
  await output.stop("a");

  assert.ok(sent.length >= 1);
  assert.strictEqual(channel(sent[0], 7), 0);
});

test("releasing one of two widgets leaves the other one driving", async () => {
  const { sent, output } = withClock({ minIntervalMs: 0 });

  await output.set("a", request({ source: "a", channel: 1, levels: [100] }));
  await output.set("b", request({ source: "b", channel: 2, levels: [200] }));
  sent.length = 0;
  await output.stop("a");

  const last = sent[sent.length - 1];
  assert.strictEqual(channel(last, 1), 0, "the one that left gave its channel up");
  assert.strictEqual(channel(last, 2), 200, "the one that stayed is untouched");
  assert.strictEqual(output.active(), true, "and the universe is still being fed");
});

test("an sACN source says goodbye three times, because one packet can be lost", async () => {
  const { sent, output } = withClock({ minIntervalMs: 0 });

  await output.set("a", request({ protocol: "sacn" }));
  sent.length = 0;
  await output.stop("a");

  const terminated = sent.filter((entry) => entry.packet[112] === 0x40);
  assert.strictEqual(terminated.length, 3, "E1.31 6.2.6");
  assert.strictEqual(sent[0].packet[112], 0x00, "the zero frame goes first");
});

test("stop with no source releases everything", async () => {
  const { output } = withClock({ minIntervalMs: 0 });

  await output.set("a", request({ source: "a", universe: 1 }));
  await output.set("b", request({ source: "b", universe: 2 }));
  assert.strictEqual(await output.stop(), true);
  assert.strictEqual(output.active(), false);
  assert.strictEqual(await output.stop(), false, "and there is nothing left to release");
});

test("close leaves receivers on their last look and stops transmitting", async () => {
  const { sent, output, clock } = withClock({});

  await output.set("a", request({ levels: [255] }));
  const after = sent.length;
  output.close();

  await clock.advance(10000);
  assert.strictEqual(sent.length, after, "nothing further goes out");
  assert.strictEqual(clock.pending(), 0);
});

// --- failure ----------------------------------------------------------------

test("a target that cannot be reached does not become a stream repeating into nowhere", async () => {
  const clock = fakeClock();
  const errors = [];
  const output = createDmxOutput(() => Promise.reject(new Error("EHOSTUNREACH")), {
    clock: clock,
    cid: Buffer.alloc(16, 1),
    onError: (err) => errors.push(err),
  });

  await assert.rejects(() => output.set("a", request()));
  assert.strictEqual(output.active(), false, "the dead stream was rolled back");
  assert.strictEqual(clock.pending(), 0, "and it is not still retrying once a second");
});

test("a node that goes quiet for a while starts receiving again when it comes back", async () => {
  const clock = fakeClock();
  let reachable = true;
  const sent = [];
  const output = createDmxOutput(
    (packet) => {
      if (!reachable) return Promise.reject(new Error("ENETUNREACH"));
      sent.push(packet);
      return Promise.resolve();
    },
    { clock: clock, cid: Buffer.alloc(16, 1), refreshMs: 800, onError: () => {} }
  );

  await output.set("a", request());
  reachable = false;
  await clock.advance(3000);
  const duringOutage = sent.length;

  // The keepalive is armed before each send, so a run of failures cannot
  // quietly kill the stream the way a failure-triggered teardown would.
  reachable = true;
  await clock.advance(3000);
  assert.ok(sent.length > duringOutage, "the stream resumed on its own");
});
