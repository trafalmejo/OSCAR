"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const afterPack = require("../scripts/after-pack");
const { binaryArch, checkBinaries } = afterPack;

function elf(machine) {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0x7f454c46, 0);
  b[5] = 1; // little-endian
  b.writeUInt16LE(machine, 18);
  return b;
}

function macho(cputype) {
  const b = Buffer.alloc(64);
  b.writeUInt32LE(0xfeedfacf, 0);
  b.writeUInt32LE(cputype, 4);
  return b;
}

function pe(machine) {
  const b = Buffer.alloc(256);
  b.write("MZ", 0, "latin1");
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32LE(0x00004550, 0x80);
  b.writeUInt16LE(machine, 0x84);
  return b;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fakeNodeModules(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-afterpack-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("reads the CPU of Linux, macOS and Windows binaries", () => {
  assert.strictEqual(binaryArch(elf(0x3e)), "x64");
  assert.strictEqual(binaryArch(elf(0xb7)), "arm64");
  assert.strictEqual(binaryArch(elf(0x28)), "armv7l");
  assert.strictEqual(binaryArch(macho(0x01000007)), "x64");
  assert.strictEqual(binaryArch(macho(0x0100000c)), "arm64");
  assert.strictEqual(binaryArch(pe(0x8664)), "x64");
  assert.strictEqual(binaryArch(pe(0xaa64)), "arm64");
  assert.strictEqual(binaryArch(Buffer.from("not a binary at all, just some text padding it out to 64 bytes")), null);
});


// Both drivers OSCAR needs, each with only its prebuild for this platform and CPU.
function prebuiltOnly(nm, platform, arch, machine) {
  write(path.join(nm, "@julusian", "midi", "prebuilds", "midi-" + platform + "-" + arch, "node-napi-v7.node"), machine);
  write(path.join(nm, "@serialport", "bindings-cpp", "prebuilds", platform + "-" + arch, "node.napi.node"), machine);
}

test("package.json leaves the drivers' build/ folders out, so every package loads its prebuild", () => {
  const files = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).build.files;
  assert.ok(files.includes("!node_modules/@julusian/midi/build/**/*"));
  assert.ok(files.includes("!node_modules/@serialport/bindings-cpp/build/**/*"));
});

test("prebuilds alone pass", (t) => {
  const nm = fakeNodeModules(t);
  prebuiltOnly(nm, "linux", "arm64", elf(0xb7));
  assert.deepStrictEqual(checkBinaries(nm, "linux", "arm64"), []);
});

// What CI shipped on 2026-09-25: the arm64 Linux package with an x64 midi.node in build/Release.
test("an x64 build/ binary in an arm64 package is named, even with the right prebuild beside it", (t) => {
  const nm = fakeNodeModules(t);
  prebuiltOnly(nm, "linux", "arm64", elf(0xb7));
  write(path.join(nm, "@julusian", "midi", "build", "Release", "midi.node"), elf(0x3e));

  const problems = checkBinaries(nm, "linux", "arm64");
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /midi\.node is x64 in the linux-arm64 package/);
});

test("a build/ binary for the package's own CPU passes", (t) => {
  const nm = fakeNodeModules(t);
  prebuiltOnly(nm, "linux", "x64", elf(0x3e));
  write(path.join(nm, "@serialport", "bindings-cpp", "build", "Release", "bindings.node"), elf(0x3e));
  assert.deepStrictEqual(checkBinaries(nm, "linux", "x64"), []);
});

test("a combined darwin-x64+arm64 prebuild counts for both Macs", (t) => {
  const nm = fakeNodeModules(t);
  write(path.join(nm, "@julusian", "midi", "prebuilds", "midi-darwin-x64", "node-napi-v7.node"), macho(0x01000007));
  write(path.join(nm, "@serialport", "bindings-cpp", "prebuilds", "darwin-x64+arm64", "node.napi.node"), Buffer.alloc(64));
  assert.deepStrictEqual(checkBinaries(nm, "darwin", "x64"), []);
});

test("a driver with nothing for this CPU is named", (t) => {
  const nm = fakeNodeModules(t);
  prebuiltOnly(nm, "linux", "x64", elf(0x3e));
  const problems = checkBinaries(nm, "linux", "arm64");
  assert.deepStrictEqual(problems, [
    "@julusian/midi has no linux-arm64 binary at all",
    "@serialport/bindings-cpp has no linux-arm64 binary at all",
  ]);
});

test("serial on Windows on ARM is the one known gap, and is let through", (t) => {
  const nm = fakeNodeModules(t);
  write(path.join(nm, "@julusian", "midi", "prebuilds", "midi-win32-arm64", "node-napi-v7.node"), pe(0xaa64));
  assert.deepStrictEqual(checkBinaries(nm, "win32", "arm64"), []);
});

test("afterPack fails a Linux package with a wrong-CPU driver in it", async (t) => {
  const out = fakeNodeModules(t);
  const nm = path.join(out, "resources", "app.asar.unpacked", "node_modules");
  prebuiltOnly(nm, "linux", "arm64", elf(0xb7));
  const context = { appOutDir: out, arch: 3, electronPlatformName: "linux", packager: { appInfo: { productFilename: "OSCAR" } } };

  await afterPack(context);
  write(path.join(nm, "@julusian", "midi", "build", "Release", "midi.node"), elf(0x3e));
  await assert.rejects(afterPack(context), /midi\.node is x64 in the linux-arm64 package/);
});
