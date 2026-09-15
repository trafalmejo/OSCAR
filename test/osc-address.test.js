"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { matchesAddress, isPattern, compile } = require("../lib/osc-address");

test("an address with no wildcards has to match exactly", () => {
  assert.ok(matchesAddress("/master/level", "/master/level"));
  assert.ok(!matchesAddress("/master/level", "/master/level2"));
  assert.ok(!matchesAddress("/master/leve", "/master/level"));
  assert.ok(!matchesAddress("/master", "/master/level"));
  assert.ok(!matchesAddress("/Master", "/master"), "case matters");
});

test("? stands for exactly one character", () => {
  assert.ok(matchesAddress("/layer?/clip", "/layer3/clip"));
  assert.ok(!matchesAddress("/layer?/clip", "/layer33/clip"));
  assert.ok(!matchesAddress("/layer?/clip", "/layer/clip"));
});

test("* stands for any run of characters, including none", () => {
  assert.ok(matchesAddress("/layer*/clip", "/layer3/clip"));
  assert.ok(matchesAddress("/layer*/clip", "/layer/clip"));
  assert.ok(matchesAddress("/layer*/clip", "/layer123/clip"));
  assert.ok(matchesAddress("/*", "/anything"));
  assert.ok(matchesAddress("/a*b*c", "/aXXbYYc"));
  assert.ok(!matchesAddress("/a*b*c", "/aXXbYY"));
  assert.ok(matchesAddress("/a**b", "/aXb"), "doubled stars are one star");
});

test("[] is a set of characters, with ranges and negation", () => {
  assert.ok(matchesAddress("/ch[1-3]", "/ch2"));
  assert.ok(!matchesAddress("/ch[1-3]", "/ch4"));
  assert.ok(matchesAddress("/ch[!1-3]", "/ch4"));
  assert.ok(!matchesAddress("/ch[!1-3]", "/ch2"));
  assert.ok(matchesAddress("/ch[abc]", "/chb"));
  assert.ok(matchesAddress("/ch[a-cx-z]", "/chy"));
  assert.ok(!matchesAddress("/ch[1-3]", "/ch"), "a set takes exactly one character");
  assert.ok(!matchesAddress("/ch[1-3]", "/ch22"));
  assert.ok(matchesAddress("/ch[-1]", "/ch-"), "a leading dash is itself");
  assert.ok(matchesAddress("/ch[1-]", "/ch-"), "a trailing dash is itself");
});

test("{} is a choice between alternatives", () => {
  assert.ok(matchesAddress("/{play,stop}", "/stop"));
  assert.ok(matchesAddress("/{play,stop}", "/play"));
  assert.ok(!matchesAddress("/{play,stop}", "/pause"));
  assert.ok(matchesAddress("/clip{1,12}/go", "/clip12/go"), "the longer alternative is tried too");
  assert.ok(matchesAddress("/x{,y}", "/x"), "an empty alternative is allowed");
});

test("no wildcard crosses a /", () => {
  // /eos/* addresses the children of /eos, not everything underneath it.
  assert.ok(!matchesAddress("/eos/*", "/eos/chan/1"));
  assert.ok(matchesAddress("/eos/*", "/eos/chan"));
  assert.ok(!matchesAddress("/eos?chan", "/eos/chan"));
  assert.ok(!matchesAddress("/a[/]b", "/a/b"), "a / in a set is malformed, not a match");
  assert.ok(!matchesAddress("/{a/b,c}", "/a/b"), "a / in an alternative is malformed");
  assert.ok(matchesAddress("/*/*", "/a/b"), "one star per part still reaches");
});

test("the incoming side is the pattern; a widget's own address is literal", () => {
  // Someone who types /pad[1] in the settings panel means that address.
  assert.ok(!matchesAddress("/pad1", "/pad[1]"));
  assert.ok(matchesAddress("/pad[1]", "/pad1"));
  assert.ok(!matchesAddress("/pad[1]", "/pad[1]"), "a bracketed widget address is only reached by a wider pattern");
  assert.ok(matchesAddress("/pad*", "/pad[1]"));
  assert.ok(matchesAddress("/pad*", "/pad*"), "a literal star is reached by a star");
});

test("a malformed pattern matches nothing and never throws", () => {
  const malformed = ["/ch[1-3", "/ch1-3]", "/{play,stop", "/play,stop}", "/ch[]", "/ch[!]", "/ch[3-1]", "/{a{b}}", "/[a*b]"];
  for (const pattern of malformed) {
    assert.doesNotThrow(() => matchesAddress(pattern, "/ch2"), pattern);
    assert.strictEqual(matchesAddress(pattern, "/ch2"), false, pattern);
    assert.strictEqual(matchesAddress(pattern, pattern), false, pattern + " does not even match itself");
    assert.strictEqual(compile(pattern), null, pattern + " compiles to nothing");
  }
});

test("anything that is not an address matches nothing", () => {
  assert.ok(!matchesAddress(null, "/x"));
  assert.ok(!matchesAddress("/x", undefined));
  assert.ok(!matchesAddress(7, "/x"));
  assert.ok(!matchesAddress("x", "x"), "an address starts with /");
  assert.ok(!matchesAddress("", ""));
  assert.ok(!matchesAddress("*", "/x"));
});

test("regex metacharacters in an address are matched, not interpreted", () => {
  assert.ok(matchesAddress("/a.b", "/a.b"));
  assert.ok(!matchesAddress("/a.b", "/axb"));
  assert.ok(matchesAddress("/a+b", "/a+b"));
  assert.ok(matchesAddress("/a(b)|c^$", "/a(b)|c^$"));
  assert.ok(matchesAddress("/a\\b", "/a\\b"));
});

test("a pathological pattern is answered promptly", () => {
  // Backtracking over stars must stay bounded: a rig sending this sixty
  // times a second must not stall the page.
  const pattern = "/" + "*a".repeat(20) + "b";
  const address = "/" + "a".repeat(60);
  const started = Date.now();
  assert.strictEqual(matchesAddress(pattern, address), false);
  assert.ok(Date.now() - started < 500, "took " + (Date.now() - started) + "ms");
});

test("isPattern tells a literal from a pattern", () => {
  assert.strictEqual(isPattern("/master/level"), false);
  assert.strictEqual(isPattern("/master/*"), true);
  assert.strictEqual(isPattern("/ch[1]"), true);
  assert.strictEqual(isPattern("/{a,b}"), true);
  assert.strictEqual(isPattern(null), false);
});
