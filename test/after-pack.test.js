"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const afterPack = require("../scripts/after-pack");
const { binaryArch, pruneForeignBinaries } = afterPack;

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

// What CI shipped on 2026-09-25: the arm64 Linux package with an x64 midi.node in build/Release.
test("an x64 build/ binary is taken out of an arm64 package, so the arm64 prebuild loads", (t) => {
  const nm = fakeNodeModules(t);
  const midi = path.join(nm, "@julusian", "midi");
  write(path.join(midi, "build", "Release", "midi.node"), elf(0x3e));
  write(path.join(midi, "prebuilds", "midi-linux-arm64", "node-napi-v7.node"), elf(0xb7));

  const removed = pruneForeignBinaries(nm, "linux", "arm64");

  assert.deepStrictEqual(removed.map((r) => r.found), ["x64"]);
  assert.ok(!fs.existsSync(path.join(midi, "build", "Release", "midi.node")));
  assert.ok(fs.existsSync(path.join(midi, "prebuilds", "midi-linux-arm64", "node-napi-v7.node")));
});

test("a build/ binary for the package's own CPU stays", (t) => {
  const nm = fakeNodeModules(t);
  const file = path.join(nm, "@serialport", "bindings-cpp", "build", "Release", "bindings.node");
  write(file, elf(0x3e));

  assert.deepStrictEqual(pruneForeignBinaries(nm, "linux", "x64"), []);
  assert.ok(fs.existsSync(file));
});

test("a combined darwin-x64+arm64 prebuild counts for both Macs", (t) => {
  const nm = fakeNodeModules(t);
  const pkg = path.join(nm, "@serialport", "bindings-cpp");
  write(path.join(pkg, "build", "Release", "bindings.node"), macho(0x0100000c));
  write(path.join(pkg, "prebuilds", "darwin-x64+arm64", "@serialport+bindings-cpp.node"), Buffer.alloc(64));

  assert.strictEqual(pruneForeignBinaries(nm, "darwin", "x64").length, 1);
});

test("the build fails when a wrong-CPU binary was the only one there was", (t) => {
  const nm = fakeNodeModules(t);
  const pkg = path.join(nm, "@julusian", "midi");
  write(path.join(pkg, "build", "Release", "midi.node"), elf(0x3e));
  write(path.join(pkg, "prebuilds", "midi-linux-x64", "node-napi-v7.node"), elf(0x3e));

  assert.throws(() => pruneForeignBinaries(nm, "linux", "arm64"), /linux-arm64.*@julusian[\\/]midi/);
});

test("afterPack finds the unpacked modules of a Linux package and prunes them", async (t) => {
  const out = fakeNodeModules(t);
  const file = path.join(out, "resources", "app.asar.unpacked", "node_modules", "@julusian", "midi", "build", "Release", "midi.node");
  write(file, elf(0x3e));
  write(path.join(path.dirname(file), "..", "..", "prebuilds", "midi-linux-arm64", "node-napi-v7.node"), elf(0xb7));

  await afterPack({ appOutDir: out, arch: 3, electronPlatformName: "linux", packager: { appInfo: { productFilename: "OSCAR" } } });

  assert.ok(!fs.existsSync(file));
});
