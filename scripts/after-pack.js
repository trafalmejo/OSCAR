"use strict";

/**
 * electron-builder afterPack: fail a package whose native drivers are for another CPU.
 *
 * MIDI (@julusian/midi) and serial (@serialport/bindings-cpp) ship prebuilt
 * binaries for every platform under prebuilds/, but their loaders try
 * build/Release first and stop at the first file that exists. `npm ci` compiles
 * build/Release for the machine doing the build, and electron-builder packed it
 * into every architecture it made from there: the arm64 Linux package built on
 * an x64 runner carried an x64 midi.node, and a Raspberry Pi 5 could not use
 * MIDI or serial.
 *
 * The cure is in package.json: "files" leaves those build/ folders out, so every
 * package loads its prebuild. It cannot be done here: by afterPack the asar's
 * index is written, and still lists a file deleted from app.asar.unpacked, so
 * the loader finds it "there" and fails to open it. (Tried 2026-09-27; the Pi
 * said "cannot open shared object file".) This hook only checks, so the build
 * fails instead of shipping an OSCAR whose MIDI silently is not there.
 */

const fs = require("fs");
const path = require("path");

// electron-builder's Arch enum, as handed to afterPack.
const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };

// The drivers OSCAR needs, and the one platform where one is known to be missing:
// serialport publishes no Windows on ARM binary (the README says so).
const REQUIRED = ["@julusian/midi", "@serialport/bindings-cpp"];
const KNOWN_MISSING = { "win32-arm64": ["@serialport/bindings-cpp"] };

/** The CPU a compiled .node file is for, or null when it can't tell (or it is universal). */
function binaryArch(buffer) {
  if (buffer.length < 64) return null;
  // ELF (Linux): e_machine at 18, in the file's own byte order.
  if (buffer.readUInt32BE(0) === 0x7f454c46) {
    const machine = buffer[5] === 2 ? buffer.readUInt16BE(18) : buffer.readUInt16LE(18);
    return { 0x03: "ia32", 0x3e: "x64", 0x28: "armv7l", 0xb7: "arm64" }[machine] || null;
  }
  // Mach-O (macOS), 64-bit little-endian. A fat binary covers both and is left alone.
  if (buffer.readUInt32LE(0) === 0xfeedfacf) {
    return { 0x01000007: "x64", 0x0100000c: "arm64" }[buffer.readUInt32LE(4)] || null;
  }
  // PE (Windows): the machine field follows the "PE\0\0" the header points at.
  if (buffer.toString("latin1", 0, 2) === "MZ") {
    const pe = buffer.readUInt32LE(0x3c);
    if (pe + 6 > buffer.length || buffer.readUInt32LE(pe) !== 0x00004550) return null;
    return { 0x014c: "ia32", 0x8664: "x64", 0xaa64: "arm64" }[buffer.readUInt16LE(pe + 4)] || null;
  }
  return null;
}

function readHead(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

/** Every package directory under node_modules that has a build/ folder of its own. */
function packagesWithBuilds(nodeModules) {
  const found = [];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkg = path.join(dir, entry.name);
      if (entry.name.startsWith("@")) {
        visit(pkg);
        continue;
      }
      if (fs.existsSync(path.join(pkg, "build"))) found.push(pkg);
      visit(path.join(pkg, "node_modules"));
    }
  };
  visit(nodeModules);
  return found;
}

function nodeFilesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return nodeFilesIn(full);
      return entry.name.endsWith(".node") ? [full] : [];
    });
}

/**
 * Whether prebuilds/ has a folder for this platform and CPU. Names vary by
 * package: "linux-arm64", "midi-linux-arm64", "midi-linux-x64-musl", and
 * "darwin-x64+arm64", which counts for both.
 */
function hasPrebuild(pkg, platform, arch) {
  const dir = path.join(pkg, "prebuilds");
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((name) => {
    const parts = name.split("-");
    const at = parts.indexOf(platform);
    return at !== -1 && (parts[at + 1] || "").split("+").includes(arch);
  });
}

/**
 * What is wrong with the drivers under one unpacked node_modules, as sentences.
 * Empty when every build/ binary is for this CPU and every required driver has
 * something to load.
 */
function checkBinaries(nodeModules, platform, arch) {
  const problems = [];
  for (const pkg of packagesWithBuilds(nodeModules)) {
    for (const file of nodeFilesIn(path.join(pkg, "build"))) {
      const found = binaryArch(readHead(file));
      if (found && found !== arch) {
        problems.push(
          path.relative(nodeModules, file) + " is " + found + " in the " + platform + "-" + arch +
            " package: leave the folder out in package.json's build.files"
        );
      }
    }
  }
  const excused = KNOWN_MISSING[platform + "-" + arch] || [];
  for (const name of REQUIRED) {
    if (excused.includes(name)) continue;
    const pkg = path.join(nodeModules, name);
    if (nodeFilesIn(path.join(pkg, "build")).length || hasPrebuild(pkg, platform, arch)) continue;
    problems.push(name + " has no " + platform + "-" + arch + " binary at all");
  }
  return problems;
}

function unpackedDir(context) {
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, context.packager.appInfo.productFilename + ".app", "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  return path.join(resources, "app.asar.unpacked", "node_modules");
}

async function afterPack(context) {
  const arch = ARCH_NAMES[context.arch];
  if (!arch || arch === "universal") return;
  const problems = checkBinaries(unpackedDir(context), context.electronPlatformName, arch);
  if (problems.length) throw new Error("Native drivers in the wrong shape:\n  " + problems.join("\n  "));
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.binaryArch = binaryArch;
module.exports.checkBinaries = checkBinaries;
