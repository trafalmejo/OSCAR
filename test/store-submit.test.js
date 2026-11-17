"use strict";

/**
 * The release to the Microsoft Store by its API (scripts/store-submit.js):
 * what is made of the published submission, and the ZIP the packages
 * travel in. Nothing is sent.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { packagesFor, withNotes, readNotes, versionOf, writeZip, crc32, NOTES_MAX, NOTES_FILE } = require("../scripts/store-submit");

test("the packages the Store has go, and this release's come", () => {
  const had = [
    { id: "1", fileName: "OSCAR-2.2.0-win-x64.appx", fileStatus: "Uploaded", version: "2.2.0.0" },
    { id: "2", fileName: "OSCAR-2.1.2-win-x64.appx", fileStatus: "PendingDelete" },
  ];
  const now = packagesFor(had, ["OSCAR-2.2.1-win-x64.appx", "OSCAR-2.2.1-win-arm64.appx"]);
  assert.deepStrictEqual(now.map((p) => p.fileName + " " + p.fileStatus), [
    "OSCAR-2.2.0-win-x64.appx PendingDelete",
    "OSCAR-2.1.2-win-x64.appx PendingDelete",
    "OSCAR-2.2.1-win-x64.appx PendingUpload",
    "OSCAR-2.2.1-win-arm64.appx PendingUpload",
  ]);
  assert.strictEqual(now[0].id, "1", "what the Store said of a package is sent back as it was");
  assert.strictEqual(had[0].fileStatus, "Uploaded", "the answer itself is not changed");
  assert.deepStrictEqual(now[2], { fileName: "OSCAR-2.2.1-win-x64.appx", fileStatus: "PendingUpload", minimumDirectXVersion: "None", minimumSystemRam: "None" });
});

test("the notes go on every language of the listing, and nothing else of it changes", () => {
  const listings = { "en-us": { baseListing: { title: "OSCAR", releaseNotes: "old", features: ["a"] }, platformOverrides: {} } };
  const out = withNotes(listings, "new");
  assert.deepStrictEqual(out, { "en-us": { baseListing: { title: "OSCAR", releaseNotes: "new", features: ["a"] }, platformOverrides: {} } });
  assert.strictEqual(listings["en-us"].baseListing.releaseNotes, "old");
});

test("this release's notes are written, and fit", () => {
  const notes = readNotes(fs.readFileSync(NOTES_FILE, "utf8"));
  assert.ok(notes.length > 20 && notes.length <= NOTES_MAX);
  assert.throws(() => readNotes("  \n"), /empty/);
  assert.throws(() => readNotes("x".repeat(NOTES_MAX + 1)), /the Store takes/);
});

test("a package's file name says its version, so last time's files are not sent again", () => {
  assert.strictEqual(versionOf("OSCAR-2.2.1-win-arm64.appx"), "2.2.1");
  assert.strictEqual(versionOf("something.appx"), null);
});

test("the ZIP holds the files at its root, whole, as any unzipper reads them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-zip-test-"));
  try {
    const one = path.join(dir, "one.appx");
    const two = path.join(dir, "two.appx");
    const big = Buffer.alloc(3 * 1024 * 1024 + 17); // more than one read
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff;
    fs.writeFileSync(one, big);
    fs.writeFileSync(two, "second package");
    const zip = path.join(dir, "packages.zip");
    const size = writeZip(zip, [one, two]);
    const bytes = fs.readFileSync(zip);
    assert.strictEqual(bytes.length, size);

    // Read it back the way an unzipper does: from the end, through the directory.
    const end = bytes.length - 22;
    assert.strictEqual(bytes.readUInt32LE(end), 0x06054b50);
    assert.strictEqual(bytes.readUInt16LE(end + 10), 2);
    let at = bytes.readUInt32LE(end + 16);
    const found = {};
    for (let i = 0; i < 2; i++) {
      assert.strictEqual(bytes.readUInt32LE(at), 0x02014b50);
      const crc = bytes.readUInt32LE(at + 16);
      const length = bytes.readUInt32LE(at + 24);
      const nameLength = bytes.readUInt16LE(at + 28);
      const local = bytes.readUInt32LE(at + 42);
      const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
      assert.strictEqual(bytes.readUInt32LE(local), 0x04034b50);
      assert.strictEqual(bytes.readUInt16LE(local + 8), 0, "stored");
      const data = bytes.subarray(local + 30 + nameLength, local + 30 + nameLength + length);
      assert.strictEqual(crc32(data), crc);
      found[name] = data;
      at += 46 + nameLength;
    }
    assert.deepStrictEqual(Object.keys(found), ["one.appx", "two.appx"], "no folders: the submission names the files alone");
    assert.ok(found["one.appx"].equals(big));
    assert.strictEqual(found["two.appx"].toString(), "second package");
    if (typeof zlib.crc32 === "function") assert.strictEqual(crc32(big), zlib.crc32(big), "the checksum is the standard one");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
