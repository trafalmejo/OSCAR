"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { meter, PEAK_CLASS } = require("../../lib/widgets/meter");
const { mount } = require("../helpers/widgets");

/** Run fn with Date.now() under the test's control; `clock.at` sets the time. */
function withClock(fn) {
  const real = Date.now;
  const clock = { at: 1000000 };
  Date.now = () => clock.at;
  try {
    return fn(clock);
  } finally {
    Date.now = real;
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
  for (const key of ["ip", "port", "argType", "transport"]) {
    assert.ok(!keys.includes(key), "a meter has no " + key);
  }
  assert.strictEqual(keys[keys.indexOf("message") + 1], "listen", "Listen sits right after Message");
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

test("the marker falls to the next reading after the hold has passed, with no timer", () => {
  withClock((clock) => {
    const { el, ctx } = mount(meter, { min: 0, max: 100, value: 0, peakHold: 1 });
    ctx.receive("/meter1", [80]);
    clock.at += 1500;
    // Nothing has arrived, so nothing has moved: a meter fed nothing shows
    // what it was last told.
    assert.strictEqual(peakAt(el), "80.00%");

    ctx.receive("/meter1", [30]);
    assert.strictEqual(peakAt(el), "30.00%", "the first reading after the hold takes the marker with it");

    clock.at += 200;
    ctx.receive("/meter1", [10]);
    assert.strictEqual(peakAt(el), "30.00%", "and a fresh hold starts from there");
  });
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
