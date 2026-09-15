"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_PATH = path.join(
  __dirname,
  "..",
  "node_modules",
  "app-builder-lib",
  "scheme.json"
);

// An unrecognised key in the "build" block isn't ignored -- electron-builder
// rejects the whole config, so one bad option fails every platform at once,
// and only at packaging time. Catching it here keeps that out of CI.
test("packaging config matches electron-builder's schema", (t) => {
  if (!fs.existsSync(SCHEMA_PATH)) {
    t.skip("electron-builder not installed");
    return;
  }

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
  ).build;

  const definitions = schema.definitions || {};
  const sections = {
    linux: "LinuxConfiguration",
    win: "WindowsConfiguration",
    mac: "MacConfiguration",
  };

  const invalid = [];

  const topLevel = Object.keys(schema.properties || {});
  for (const key of Object.keys(config)) {
    if (!topLevel.includes(key)) invalid.push(key);
  }

  for (const [key, defName] of Object.entries(sections)) {
    const section = config[key];
    if (!section || typeof section !== "object" || Array.isArray(section)) continue;
    const allowed = Object.keys((definitions[defName] || {}).properties || {});
    if (!allowed.length) continue;
    for (const option of Object.keys(section)) {
      if (!allowed.includes(option)) invalid.push(key + "." + option);
    }
  }

  assert.deepStrictEqual(invalid, [], "unrecognised electron-builder options");
});

function linuxConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).build
    .linux || {};
}

// electron-builder accepts a target as a bare name ("deb") or as an object
// ({ target: "deb", arch: [...] }). Reading only one form would let a check
// below quietly stop applying when the config switches to the other.
function linuxTargets() {
  const targets = linuxConfig().target || [];
  return (Array.isArray(targets) ? targets : [targets]).map((t) =>
    typeof t === "string" ? { target: t, arch: [] } : t
  );
}

// The .deb target refuses to build without a maintainer carrying an email,
// and package.json's author field has no address.
test("linux target declares a maintainer with an email", () => {
  const names = linuxTargets().map((t) => t.target);
  assert.ok(names.includes("deb"), "the deb target is still configured");

  const maintainer = linuxConfig().maintainer || "";
  assert.match(maintainer, /<[^@\s]+@[^>\s]+>/, "build.linux.maintainer needs an email");
});

// A Raspberry Pi is the natural thing to leave running a show. Without an
// explicit arch, electron-builder packages only the host's, so a release cut
// on an x64 runner never produced an ARM Linux build.
test("every linux target is built for arm64 as well as x64", () => {
  const targets = linuxTargets();
  assert.ok(targets.length >= 2, "AppImage and deb");
  for (const target of targets) {
    assert.ok(target.arch.includes("arm64"), target.target + " builds for arm64");
    assert.ok(target.arch.includes("x64"), target.target + " builds for x64");
  }
});
