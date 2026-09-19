"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { meter, PEAK_CLASS } = require("../../lib/widgets/meter");
const { mount } = require("../helpers/widgets");

/**
 * Run fn with time under the test's control.
 *
 * `clock.at += n` moves Date.now() alone, which is a machine that was busy:
 * time passed and no timer has run yet. `clock.advance(n)` moves it and runs
 * the timers that came due on the way, in order. Timers are faked by hand
 * rather than with node:test's mock.timers so the suite runs on Node 18,
 * and so no real timer is ever left behind to outlive a test.
 */
function withClock(fn) {
  const real = { now: Date.now, set: global.setTimeout, clear: global.clearTimeout };
  let timers = [];
  let ids = 0;
  const clock = {
    at: 1000000,
    /** How many timers are waiting: what a detach has to bring to zero. */
    pending: () => timers.length,
    advance(ms) {
      const end = clock.at + ms;
      for (;;) {
        const due = timers.filter((t) => t.due <= end).sort((a, b) => a.due - b.due)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        clock.at = Math.max(clock.at, due.due);
        due.fn();
      }
      clock.at = end;
    },
  };
  Date.now = () => clock.at;
  global.setTimeout = (fn, ms) => {
    const timer = { id: ++ids, fn, due: clock.at + (ms || 0), unref() {} };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    timers = timers.filter((t) => t !== timer);
  };
  try {
    return fn(clock);
  } finally {
    Date.now = real.now;
    global.setTimeout = real.set;
    global.clearTimeout = real.clear;
  }
}

function level(el) {
  return el.style.properties["--oscar-level"];
}

function peakAt(el) {
  return el.style.properties["--oscar-peak"];
}

// --- shape ------------------------------------------------------------------

test("the meter is display-only: it follows, never sends, and has no address to send to", () => {
  assert.strictEqual(meter.sends, false);
  assert.strictEqual(meter.receives, true);
  assert.strictEqual(meter.dmx, false);
  const keys = meter.fields.map((f) => f.key);
  for (const key of ["ip", "port", "argType", "oscEnabled", "dmxEnabled"]) {
    assert.ok(!keys.includes(key), "a meter has no " + key);
  }
  assert.strictEqual(keys.filter((k) => k === "listen" || k === "oscEnabled" || k === "ip" || k === "message")[0], "listen", "Data in comes before anything else about OSC");
  assert.deepStrictEqual(meter.fields.filter((f) => f.section === "osc").map((f) => f.key), ["listen", "message"], "Data in and the address: no Data out, nowhere to send");
  assert.strictEqual(meter.defaults.listen, true, "and is on from the start: following is all it does");
  assert.ok(meter.checks.message("meter1"), "Message is still checked as an OSC path");
  assert.strictEqual(meter.checks.message("/meter1"), null);
});

test("the meter hangs no listeners on its element", () => {
  const { el } = mount(meter);
  for (const type of ["pointerdown", "pointerup", "pointermove", "click", "input"]) {
    assert.strictEqual(el.listenerCount(type), 0, type);
  }
});

// --- painting ---------------------------------------------------------------

test("the meter paints its stored value as a fraction of its range", () => {
  const { el } = mount(meter, { min: 0, max: 100, value: 40 });
  assert.strictEqual(level(el), "40.00%");
  assert.strictEqual(el.getAttribute("orient"), "horizontal");
});

test("a range labelled in other units still means full at the top", () => {
  const { el } = mount(meter, { min: 20, max: 2000, value: 2000 });
  assert.strictEqual(level(el), "100.00%");
});

test("editing the range, the value or the orientation repaints", () => {
  const { el, ctx } = mount(meter, { min: 0, max: 100, value: 50 });
  ctx.edit("max", 200);
  assert.strictEqual(level(el), "25.00%");
  ctx.edit("value", 100);
  assert.strictEqual(level(el), "50.00%");
  ctx.edit("orientation", "vertical");
  assert.strictEqual(el.getAttribute("orient"), "vertical");
});

test("a stored value that cannot be placed leaves the bar where it was, not empty", () => {
  // A blank Value, or a range of zero width, has no position; painting 0%
  // there would read as silence.
  const { el, ctx } = mount(meter, { min: 0, max: 100, value: 60 });
  ctx.edit("min", 100);
  assert.strictEqual(level(el), "60.00%", "a zero-width range changes nothing");
  ctx.edit("min", 0);
  ctx.edit("value", "");
  assert.strictEqual(level(el), "60.00%", "and neither does a blank value");
});

test("a meter with no readable value at mount paints no level rather than zero", () => {
  const { el } = mount(meter, { value: "" });
  assert.strictEqual(level(el), undefined, "the stylesheet's own default stands");
});

test("the definition carries no copy of what the settings decide", () => {
  // A default orient in the attributes is exactly what the host would
  // re-apply over the real one on every class or style edit.
  assert.ok(!("orient" in meter.attributes));
  assert.strictEqual(meter.attributes.class, "oscar-meter", "the class is what identifies a saved meter");
});

// --- following the rig ------------------------------------------------------

test("a reading moves the bar and the stored value, and sends nothing back", () => {
  const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0 });
  ctx.receive("/meter1", [75]);
  assert.strictEqual(level(el), "75.00%");
  assert.strictEqual(ctx.config.value, 75, "stored, so a re-render repaints where the level was");
  assert.deepStrictEqual(ctx.sent, []);
});

test("a reading past either end pins the bar there, and is stored as it arrived", () => {
  const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0 });
  ctx.receive("/meter1", [150]);
  assert.strictEqual(level(el), "100.00%");
  assert.strictEqual(ctx.config.value, 150, "the reading is what the rig said, not what the bar can show");
  ctx.receive("/meter1", [-5]);
  assert.strictEqual(level(el), "0.00%");
});

test("a value the meter cannot read holds the last reading, never drops to zero", () => {
  // An empty bar reports silence on a channel that may be at full: the
  // dangerous direction for a display to fail in.
  const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0 });
  ctx.receive("/meter1", [90]);
  for (const args of [[], [null], ["abc"], [""], [" "], [true], [false], [NaN], [{}], [[]]]) {
    ctx.receive("/meter1", args);
    assert.strictEqual(level(el), "90.00%", JSON.stringify(args));
    assert.strictEqual(ctx.config.value, 90, JSON.stringify(args));
  }
  ctx.receive("/meter1", ["55"]);
  assert.strictEqual(level(el), "55.00%", "a number spelled as text is a number");
});

test("a reading of zero is a real reading", () => {
  const { el, ctx } = mount(meter, { min: 0, max: 100, value: 80 });
  ctx.receive("/meter1", [0]);
  assert.strictEqual(level(el), "0.00%");
  assert.strictEqual(ctx.config.value, 0);
});

test("a disabled meter freezes where it is instead of emptying", () => {
  const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0 });
  ctx.receive("/meter1", [70]);
  ctx.edit("enabled", false);
  ctx.receive("/meter1", [10]);
  assert.strictEqual(level(el), "70.00%");
  assert.strictEqual(ctx.config.value, 70);
  ctx.edit("enabled", true);
  ctx.receive("/meter1", [10]);
  assert.strictEqual(level(el), "10.00%", "and follows again once switched on");
});

test("a meter with Listen off ignores the network", () => {
  const { el, ctx } = mount(meter, { listen: false, min: 0, max: 100, value: 30 });
  ctx.receive("/meter1", [90]);
  assert.strictEqual(level(el), "30.00%");
  assert.strictEqual(ctx.config.value, 30);
});

test("a meter answers to its own address, literally, and to patterns that reach it", () => {
  const { el, ctx } = mount(meter, { message: "/level/1", min: 0, max: 100, value: 0 });
  ctx.receive("/level/2", [50]);
  assert.strictEqual(level(el), "0.00%");
  ctx.receive("/level/*", [30]);
  assert.strictEqual(level(el), "30.00%");
  ctx.receive("/level/1", [60]);
  assert.strictEqual(level(el), "60.00%");
});

test("a reading with a zero-width range is stored but paints nothing", () => {
  const { el, ctx } = mount(meter, { min: 5, max: 5, value: 5 });
  ctx.receive("/meter1", [7]);
  assert.strictEqual(ctx.config.value, 7);
  assert.strictEqual(level(el), undefined);
});

// --- peak hold --------------------------------------------------------------

test("with Peak hold at 0 no marker is drawn", () => {
  const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0, peakHold: 0 });
  ctx.receive("/meter1", [80]);
  assert.strictEqual(ctx.classes[PEAK_CLASS], false);
  assert.strictEqual(peakAt(el), undefined);
});

test("the peak marker rises at once and holds while the level falls", () => {
  withClock((clock) => {
    const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0, peakHold: 2 });
    assert.strictEqual(ctx.classes[PEAK_CLASS], false, "no marker before the first reading");

    ctx.receive("/meter1", [80]);
    assert.strictEqual(peakAt(el), "80.00%");
    assert.strictEqual(ctx.classes[PEAK_CLASS], true);

    clock.at += 500;
    ctx.receive("/meter1", [20]);
    assert.strictEqual(level(el), "20.00%", "the bar fell");
    assert.strictEqual(peakAt(el), "80.00%", "the marker did not");

    clock.at += 500;
    ctx.receive("/meter1", [90]);
    assert.strictEqual(peakAt(el), "90.00%", "a higher reading moves it up at once");
  });
});

test("a reading that arrives after the hold has passed takes the marker with it", () => {
  withClock((clock) => {
    const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0, peakHold: 1 });
    ctx.receive("/meter1", [80]);
    // Time passed but no timer has had its turn: the reading decides alone.
    clock.at += 1500;
    ctx.receive("/meter1", [30]);
    assert.strictEqual(peakAt(el), "30.00%", "the first reading after the hold takes the marker with it");

    clock.at += 200;
    ctx.receive("/meter1", [10]);
    assert.strictEqual(peakAt(el), "30.00%", "and a fresh hold starts from there");
  });
});

// Resolume and TouchDesigner send a value when it changes and then go quiet.
// A marker that waited for the next reading would sit on a peak from minutes
// ago, and "Peak hold (s)" would not mean what its number says.
test("the marker falls on its own when the hold runs out, with no new reading", () => {
  withClock((clock) => {
    const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0, peakHold: 2 });
    ctx.receive("/meter1", [90]);
    clock.advance(500);
    ctx.receive("/meter1", [20]);
    assert.strictEqual(peakAt(el), "90.00%");

    clock.advance(1400);
    assert.strictEqual(peakAt(el), "90.00%", "still inside the hold, which runs from the peak and not from the fall");

    clock.advance(200);
    assert.strictEqual(peakAt(el), "20.00%", "the source went quiet and the marker came down anyway");
    assert.strictEqual(level(el), "20.00%", "onto the bar, which has not moved");
    assert.strictEqual(ctx.get("value"), 20, "and the stored reading is untouched: the fall is not a reading");
    assert.strictEqual(clock.pending(), 0, "a marker sitting on the bar has nothing left to wait for");

    clock.advance(100);
    ctx.receive("/meter1", [10]);
    assert.strictEqual(peakAt(el), "20.00%", "a fresh hold starts where it landed");
    clock.advance(2000);
    assert.strictEqual(peakAt(el), "10.00%", "and runs out in its turn");
  });
});

test("the falling marker never sends, and never falls below the last reading", () => {
  withClock((clock) => {
    const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0, peakHold: 1 });
    ctx.receive("/meter1", [80]);
    ctx.receive("/meter1", [35]);
    clock.advance(60000);
    assert.strictEqual(peakAt(el), "35.00%");
    assert.strictEqual(level(el), "35.00%", "a quiet minute is not silence: the bar holds");
    assert.deepStrictEqual(ctx.sent, []);
  });
});

test("a rising reading calls the pending fall off, and a shorter Peak hold re-times it", () => {
  withClock((clock) => {
    const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0, peakHold: 10 });
    ctx.receive("/meter1", [80]);
    ctx.receive("/meter1", [20]);
    assert.strictEqual(clock.pending(), 1);
    ctx.receive("/meter1", [95]);
    assert.strictEqual(clock.pending(), 0, "the marker is on the bar again");

    ctx.receive("/meter1", [20]);
    clock.advance(1000);
    ctx.edit("peakHold", 2);
    assert.strictEqual(clock.pending(), 1, "one fall, not one per edit");
    clock.advance(900);
    assert.strictEqual(peakAt(el), "95.00%");
    clock.advance(200);
    assert.strictEqual(peakAt(el), "20.00%", "the new hold counts from the peak, not from the edit");
  });
});

test("detaching calls the pending fall off, so nothing repaints a dead element", () => {
  withClock((clock) => {
    const { el, ctx, detach } = mount(meter, { min: 0, max: 100, value: 0, peakHold: 1 });
    ctx.receive("/meter1", [80]);
    ctx.receive("/meter1", [20]);
    assert.strictEqual(clock.pending(), 1);
    detach();
    assert.strictEqual(clock.pending(), 0);
    clock.advance(5000);
    assert.strictEqual(peakAt(el), "80.00%");
  });
});

test("a meter left mounted does not keep Node alive for its hold time", () => {
  // Real timers on purpose: what is checked is the handle the widget leaves.
  const real = global.setTimeout;
  const made = [];
  global.setTimeout = function () {
    const timer = real.apply(this, arguments);
    made.push(timer);
    return timer;
  };
  let mounted;
  try {
    mounted = mount(meter, { min: 0, max: 100, value: 0, peakHold: 3600 });
    mounted.ctx.receive("/meter1", [80]);
    mounted.ctx.receive("/meter1", [20]);
  } finally {
    global.setTimeout = real;
  }
  assert.strictEqual(made.length > 0, true, "a fall was armed");
  for (const timer of made) assert.strictEqual(timer.hasRef(), false);
  mounted.detach();
});

test("an unreadable value does not touch the peak either", () => {
  withClock((clock) => {
    const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0, peakHold: 1 });
    ctx.receive("/meter1", [80]);
    clock.at += 5000;
    ctx.receive("/meter1", ["abc"]);
    assert.strictEqual(peakAt(el), "80.00%");
  });
});

test("a range running downward still marks its loudest point", () => {
  withClock(() => {
    const { el, ctx } = mount(meter, { min: 100, max: 0, value: 100, peakHold: 5 });
    ctx.receive("/meter1", [40]);
    assert.strictEqual(level(el), "60.00%");
    ctx.receive("/meter1", [70]);
    assert.strictEqual(peakAt(el), "60.00%", "70 is quieter on this scale, so the marker holds");
  });
});

test("editing the range under a held peak re-places the marker", () => {
  withClock(() => {
    const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0, peakHold: 5 });
    ctx.receive("/meter1", [50]);
    ctx.edit("max", 200);
    assert.strictEqual(peakAt(el), "25.00%");
  });
});

test("turning Peak hold off drops the marker", () => {
  withClock(() => {
    const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0, peakHold: 5 });
    ctx.receive("/meter1", [50]);
    assert.strictEqual(ctx.classes[PEAK_CLASS], true);
    ctx.edit("peakHold", 0);
    assert.strictEqual(ctx.classes[PEAK_CLASS], false);
    ctx.receive("/meter1", [60]);
    assert.strictEqual(ctx.classes[PEAK_CLASS], false, "and it stays off");
    assert.strictEqual(level(el), "60.00%");
  });
});

test("the panel refuses a peak hold that is not a number of seconds", () => {
  assert.strictEqual(meter.checks.peakHold(0), null);
  assert.strictEqual(meter.checks.peakHold("1.5"), null);
  for (const bad of ["", " ", null, "abc", -1]) {
    assert.ok(meter.checks.peakHold(bad), JSON.stringify(bad));
  }
});

test("the panel refuses a blank range or value, which the wire would otherwise read as zero", () => {
  for (const blank of ["", " ", null]) {
    assert.ok(meter.checks.min(blank), "min " + JSON.stringify(blank));
    assert.ok(meter.checks.max(blank), "max " + JSON.stringify(blank));
    assert.ok(meter.checks.value(blank), "value " + JSON.stringify(blank));
  }
});

// --- shared vocabulary -------------------------------------------------------

test("the meter takes Orientation from the shared fields, not from another widget", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../../lib/widgets/meter.js"), "utf8");
  const required = source.match(/require\("\.\/[^"]+"\)/g) || [];
  assert.deepStrictEqual(required.sort(), ['require("./fields")', 'require("./incoming")']);

  const fields = require("../../lib/widgets/fields");
  const orientation = meter.fields.find((f) => f.key === "orientation");
  assert.strictEqual(orientation.options, fields.ORIENTATIONS);
  assert.strictEqual(require("../../lib/widgets/slider").ORIENTATIONS, fields.ORIENTATIONS, "the old export still works");
});

// --- the host ---------------------------------------------------------------

test("the meter's level, marker and orientation survive the host rewriting its element", () => {
  withClock(() => {
    const { el, ctx, rewrite } = mount(meter, { orientation: "vertical", min: 0, max: 100, value: 0, peakHold: 5 });
    ctx.receive("/meter1", [65]);
    ctx.receive("/meter1", [40]);
    rewrite();
    assert.strictEqual(el.getAttribute("orient"), "vertical");
    assert.strictEqual(level(el), "40.00%");
    assert.strictEqual(peakAt(el), "65.00%");
    assert.strictEqual(ctx.classes[PEAK_CLASS], true);
  });
});

test("detaching stops the meter following the rig", () => {
  const { el, ctx, detach } = mount(meter, { min: 0, max: 100, value: 10 });
  detach();
  ctx.receive("/meter1", [90]);
  assert.strictEqual(level(el), "10.00%");
  assert.strictEqual(ctx.listening(), 0);
});

test("a hold longer than a timer can wait still holds, instead of dropping at once", () => {
  withClock((clock) => {
    // A real setTimeout given more than 2^31-1 ms fires after one millisecond,
    // so the marker of a month-long hold fell immediately. The fake clock has
    // no such limit, so watch what the meter asks for.
    const asked = [];
    const fake = global.setTimeout;
    global.setTimeout = (fn, ms) => {
      asked.push(ms);
      return fake(fn, ms);
    };

    const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0, peakHold: 1e9 });
    ctx.receive("/meter1", [95]);
    ctx.receive("/meter1", [10]);
    assert.ok(asked.length > 0 && asked.every((ms) => ms <= 2147483647), "never asks for a delay that overflows");

    clock.advance(2147483647);
    assert.strictEqual(peakAt(el), "95.00%", "woken by the cap, it goes back to waiting");
    assert.strictEqual(clock.pending(), 1);
  });
});
