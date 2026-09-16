"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { buildMessage, isAddress, isPort, MAX_ARGS } = require("../lib/osc-message");

test("a single value builds a one-argument message", () => {
  assert.deepStrictEqual(buildMessage("/push1", 1), {
    address: "/push1",
    args: [{ type: "f", value: 1 }],
  });
});

test("several values ride in one message, as an XY pad or a colour needs", () => {
  assert.deepStrictEqual(buildMessage("/pad", [0.25, 0.75]), {
    address: "/pad",
    args: [
      { type: "f", value: 0.25 },
      { type: "f", value: 0.75 },
    ],
  });

  assert.strictEqual(buildMessage("/colour", [1, 0.5, 0, 1]).args.length, 4);
});

test("types are honoured when given, and inferred when not", () => {
  assert.deepStrictEqual(buildMessage("/cue", [{ type: "i", value: "7" }]).args, [
    { type: "i", value: 7 },
  ]);
  assert.deepStrictEqual(buildMessage("/name", ["blackout"]).args, [
    { type: "s", value: "blackout" },
  ]);
  assert.deepStrictEqual(buildMessage("/on", [true]).args, [{ type: "T", value: true }]);
  assert.deepStrictEqual(buildMessage("/off", [false]).args, [{ type: "F", value: false }]);
});

test("integers are truncated rather than rounded", () => {
  assert.strictEqual(buildMessage("/cue", [{ type: "i", value: 7.9 }]).args[0].value, 7);
});

test("a value that cannot be sent drops the whole message", () => {
  // Better silence than a packet with a garbage value in the middle of a cue.
  assert.strictEqual(buildMessage("/x", [NaN]), null);
  assert.strictEqual(buildMessage("/x", ["not a number"]) === null, false, "strings are fine");
  assert.strictEqual(buildMessage("/x", [{ type: "f", value: "abc" }]), null);
  assert.strictEqual(buildMessage("/x", [1, NaN, 3]), null, "one bad value spoils the message");
  assert.strictEqual(buildMessage("/x", [{ type: "z", value: 1 }]), null, "unknown OSC type");
});

test("a missing value is refused, never read as zero", () => {
  // JSON carries no NaN, so a browser's NaN arrives as null -- and Number(null)
  // is 0. Sending 0 to a lighting rig means "off"; silence is safer.
  for (const missing of [null, undefined, [], {}]) {
    assert.strictEqual(buildMessage("/x", [missing]), null, JSON.stringify(missing));
    assert.strictEqual(buildMessage("/x", [1, missing]), null, "and it spoils the message");
  }

  // Empty where a number belongs is the same trap: Number("") is 0.
  for (const type of ["f", "i"]) {
    assert.strictEqual(buildMessage("/x", [{ type, value: "" }]), null, type);
    assert.strictEqual(buildMessage("/x", [{ type, value: null }]), null, type);
  }

  // An empty string is a real value though, and stays one.
  assert.deepStrictEqual(buildMessage("/x", [""]).args, [{ type: "s", value: "" }]);

  // Zero itself is a perfectly good value and must still go through.
  assert.deepStrictEqual(buildMessage("/x", [0]).args, [{ type: "f", value: 0 }]);
});

test("an address has to be a path", () => {
  for (const bad of ["", "/", "nope", null, undefined, 42, {}]) {
    assert.strictEqual(buildMessage(bad, [1]), null, JSON.stringify(bad));
  }
  assert.ok(buildMessage("/a", [1]));
  assert.ok(buildMessage("/deep/path/here", [1]));
});

test("isAddress and isPort judge what OSCAR can actually send to", () => {
  assert.strictEqual(isAddress("/master"), true);
  assert.strictEqual(isAddress("master"), false);

  for (const port of [1, 7000, 65535, "8000"]) assert.strictEqual(isPort(port), true, String(port));
  for (const port of [0, -1, 65536, 1.5, "", null, "abc"]) {
    assert.strictEqual(isPort(port), false, String(port));
  }
});

test("an empty list on purpose is a bare address, which is a real message", () => {
  // /play, /stop, /next -- plenty of software wants the address alone.
  assert.deepStrictEqual(buildMessage("/play", []), { address: "/play", args: [] });
});

test("arriving empty-handed is still refused, and stays distinct from sending nothing", () => {
  // The dangerous case: a value that went missing must not look like a
  // deliberate bare address, or a dropped number becomes a /stop.
  assert.strictEqual(buildMessage("/x", undefined), null);
  assert.strictEqual(buildMessage("/x", null), null);
  assert.strictEqual(buildMessage("/x", [undefined]), null);
});

test("oversized argument lists are refused", () => {
  assert.ok(buildMessage("/x", new Array(MAX_ARGS).fill(0)));
  assert.strictEqual(buildMessage("/x", new Array(MAX_ARGS + 1).fill(0)), null);
});

test("the server gate refuses whitespace where a number belongs", () => {
  // The browser-side check is not the only line of defence: a hand-edited
  // project or an old page can still post a blank-looking value.
  for (const type of ["f", "i"]) {
    for (const value of ["  ", "\t", " \n "]) {
      assert.strictEqual(buildMessage("/x", [{ type, value }]), null, type + " " + JSON.stringify(value));
    }
  }
  // Text is still text: a string argument that happens to be spaces is sent.
  assert.deepStrictEqual(buildMessage("/x", ["  "]).args, [{ type: "s", value: "  " }]);
});
