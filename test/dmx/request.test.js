"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { buildRequest, readSource, readHost } = require("../../lib/dmx/request");

function request(overrides) {
  return Object.assign(
    { protocol: "artnet", host: "10.0.0.5", universe: 1, channel: 1, levels: [255], source: "i3k4" },
    overrides
  );
}

test("a well-formed request comes back checked, with its own copy of the levels", () => {
  const levels = [0, 128, 255];
  const built = buildRequest(request({ levels, channel: 10 }));
  assert.deepStrictEqual(built, {
    protocol: "artnet",
    host: "10.0.0.5",
    universe: 1,
    channel: 10,
    levels: [0, 128, 255],
    source: "i3k4",
  });
  assert.notStrictEqual(built.levels, levels);
});

test("numbers spelled as text are accepted, as they are for OSC", () => {
  const built = buildRequest(request({ universe: "2", channel: "5", levels: ["100"] }));
  assert.deepStrictEqual([built.universe, built.channel, built.levels], [2, 5, [100]]);
});

test("a blank node means the protocol's default; anything else must look like an address", () => {
  assert.strictEqual(buildRequest(request({ host: "" })).host, "");
  assert.strictEqual(buildRequest(request({ host: undefined })).host, "");
  assert.strictEqual(buildRequest(request({ host: " node-1.local " })).host, "node-1.local");
  assert.strictEqual(buildRequest(request({ host: "10.0.0.5:6454" })), null);
  assert.strictEqual(buildRequest(request({ host: "a b" })), null);
  assert.strictEqual(buildRequest(request({ host: 7 })), null);
  assert.strictEqual(readHost(null), "");
});

test("the universe is checked against the protocol it is sent with", () => {
  assert.ok(buildRequest(request({ protocol: "artnet", universe: 0 })));
  assert.strictEqual(buildRequest(request({ protocol: "sacn", universe: 0 })), null, "sACN reserves 0");
  assert.ok(buildRequest(request({ protocol: "sacn", universe: 63999 })));
  assert.strictEqual(buildRequest(request({ protocol: "sacn", universe: 64000 })), null);
  assert.ok(buildRequest(request({ protocol: "artnet", universe: 32767 })));
  assert.strictEqual(buildRequest(request({ protocol: "artnet", universe: 32768 })), null);
  assert.strictEqual(buildRequest(request({ protocol: "midi" })), null);
  assert.strictEqual(buildRequest(request({ protocol: undefined })), null, "no protocol is not Art-Net by default");
});

test("a block that runs past channel 512 is refused, not truncated", () => {
  assert.ok(buildRequest(request({ channel: 512, levels: [1] })));
  assert.ok(buildRequest(request({ channel: 510, levels: [1, 2, 3] })));
  assert.strictEqual(buildRequest(request({ channel: 511, levels: [1, 2, 3] })), null);
  assert.strictEqual(buildRequest(request({ channel: 513, levels: [1] })), null);
  assert.strictEqual(buildRequest(request({ channel: 0, levels: [1] })), null);
});

test("a level that is not a whole number 0-255 refuses the whole request", () => {
  for (const bad of [[256], [-1], [1.5], [null], [""], ["abc"], [true], [128, undefined], [], "255"]) {
    assert.strictEqual(buildRequest(request({ levels: bad })), null, JSON.stringify(bad));
  }
});

test("a request needs a source it can later be released by", () => {
  assert.strictEqual(buildRequest(request({ source: undefined })), null);
  assert.strictEqual(buildRequest(request({ source: "" })), null);
  assert.strictEqual(buildRequest(request({ source: "has space" })), null);
  assert.strictEqual(buildRequest(request({ source: "x".repeat(65) })), null);
  assert.strictEqual(readSource("comp-1.a:b_c"), "comp-1.a:b_c");
  assert.strictEqual(readSource(42), null);
});

test("anything that is not a request object is refused", () => {
  for (const bad of [null, undefined, "artnet", 7, [], [request()]]) {
    assert.strictEqual(buildRequest(bad), null, JSON.stringify(bad));
  }
});
