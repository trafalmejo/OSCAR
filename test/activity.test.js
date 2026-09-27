"use strict";

// Whose move a network-log row was. A connection says what it is when it
// connects; lib/activity.js turns that into the row's origin, surface and
// device, and the words for DMX and MIDI.

const test = require("node:test");
const assert = require("node:assert");

const { socketOrigin, deviceOf, ORIGINS } = require("../lib/activity");

test("the editor is the canvas, and carries no device: it is the one at the keyboard", () => {
  assert.deepStrictEqual(socketOrigin("canvas", "::ffff:192.168.1.20"), { origin: "canvas" });
});

test("a page on the network is local, named by its surface and its device", () => {
  assert.deepStrictEqual(socketOrigin("show:stage-left", "::ffff:192.168.1.31"), { origin: "local", surface: "stage-left", device: "192.168.1.31" });
  assert.deepStrictEqual(socketOrigin("preview", "10.0.0.4"), { origin: "local", surface: "preview", device: "10.0.0.4" });
  assert.deepStrictEqual(socketOrigin("file", "10.0.0.5"), { origin: "local", device: "10.0.0.5" }, "an exported file names no surface");
  assert.deepStrictEqual(socketOrigin(undefined, "10.0.0.6"), { origin: "local", device: "10.0.0.6" }, "a page from before the label is still local");
});

test("a label is only a label: nothing a page says makes it anything but local", () => {
  assert.strictEqual(socketOrigin("internet", "10.0.0.7").origin, "local", "internet is set by the relay's path alone");
  assert.strictEqual(socketOrigin("schedule", "10.0.0.7").origin, "local");
  assert.deepStrictEqual(socketOrigin("show:../../etc", "10.0.0.7"), { origin: "local", device: "10.0.0.7" }, "a surface name that is not an id is dropped");
  assert.deepStrictEqual(socketOrigin("show:" + "a".repeat(200), "10.0.0.7"), { origin: "local", device: "10.0.0.7" }, "and so is one too long to be one");
  assert.deepStrictEqual(socketOrigin(["canvas"], "10.0.0.7"), { origin: "local", device: "10.0.0.7" }, "a repeated query parameter is not a string");
});

test("devices read the way people know them", () => {
  assert.strictEqual(deviceOf("::ffff:192.168.1.20"), "192.168.1.20");
  assert.strictEqual(deviceOf("::1"), "::1");
  assert.strictEqual(deviceOf(undefined), undefined);
});

test("the origins the log offers are the five it can tell apart", () => {
  assert.deepStrictEqual(ORIGINS, ["canvas", "local", "internet", "schedule", "bridge"]);
});
