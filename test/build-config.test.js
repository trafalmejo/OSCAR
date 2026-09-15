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

// The .deb target refuses to build without a maintainer carrying an email,
// and package.json's author field has no address.
test("linux target declares a maintainer with an email", () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
  ).build;

  // A target is either "deb" or { target: "deb", arch: [...] }. Reading only
  // the string form would make this test quietly pass by skipping the moment
  // an arch list is added, taking the guard with it.
  const targets = ((config.linux || {}).target || []).map((t) =>
    typeof t === "string" ? t : t && t.target
  );
  if (!targets.includes("deb")) return;

  const maintainer = (config.linux || {}).maintainer || "";
  assert.match(maintainer, /<[^@\s]+@[^>\s]+>/, "build.linux.maintainer needs an email");
});

test("Linux ships for ARM as well as x64, so a Raspberry Pi has a build", () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
  ).build;

  for (const target of (config.linux || {}).target || []) {
    assert.ok(typeof target === "object", "declare an arch list per Linux target");
    assert.ok(
      (target.arch || []).includes("arm64"),
      target.target + " should build for arm64"
    );
  }
});
