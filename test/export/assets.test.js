"use strict";

/**
 * Inlining assets. The references come out of an HTTP request, so most of
 * this is about what must NOT be read.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveAsset, createAssetReader, MAX_ASSET_BYTES } = require("../../lib/export/assets");

/** A public folder with a secret sitting next to it, as oscar-settings.json does. */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-export-"));
  const root = path.join(dir, "public");
  fs.mkdirSync(path.join(root, "images"), { recursive: true });
  fs.writeFileSync(path.join(root, "images", "dot.png"), Buffer.from([1, 2, 3, 4]));
  fs.writeFileSync(path.join(root, "images", "my file.png"), Buffer.from([5]));
  fs.writeFileSync(path.join(root, "index.ejs"), "<% secret %>");
  fs.writeFileSync(path.join(dir, "secret.png"), "outside");
  return { dir, root };
}

test("a small image becomes a data: URI", () => {
  const { root } = sandbox();
  const read = createAssetReader(root);
  const expected = "data:image/png;base64," + Buffer.from([1, 2, 3, 4]).toString("base64");
  assert.strictEqual(read("images/dot.png"), expected);
  assert.strictEqual(read("/images/dot.png"), expected, "root-relative, as the asset manager writes it");
  assert.strictEqual(read("./images/dot.png?v=3#x"), expected, "a query is addressing, not a filename");
  assert.strictEqual(read("images/my%20file.png"), "data:image/png;base64," + Buffer.from([5]).toString("base64"));
  assert.deepStrictEqual(read.linked, []);
});

test("nothing outside the folder is ever read", () => {
  const { dir, root } = sandbox();
  const read = createAssetReader(root);
  const attempts = [
    "../secret.png",
    "images/../../secret.png",
    "..\\secret.png",
    "images\\..\\..\\secret.png",
    "%2e%2e/secret.png",
    "%2e%2e%2fsecret.png",
    "/../secret.png",
    "////../secret.png",
    path.join(dir, "secret.png"),
    "file:///" + path.join(dir, "secret.png").replace(/\\/g, "/"),
    "images/dot.png\0.png",
  ];
  for (const attempt of attempts) {
    assert.strictEqual(read(attempt), null, attempt);
    const resolved = resolveAsset(root, attempt);
    assert.ok(resolved === null || resolved.startsWith(path.resolve(root) + path.sep), attempt);
  }
});

test("what is already self-contained, or remote, is left as it is", () => {
  const { root } = sandbox();
  for (const ref of ["http://x/a.png", "https://x/a.png", "//x/a.png", "data:image/png;base64,AA==", "#grad", "", "  ", null]) {
    assert.strictEqual(resolveAsset(root, ref), null, String(ref));
  }
});

test("only media is inlined: OSCAR's own templates and scripts are not", () => {
  const { root } = sandbox();
  const read = createAssetReader(root);
  assert.strictEqual(read("index.ejs"), null);
  assert.strictEqual(read("images"), null, "a folder is not a file");
  assert.strictEqual(read("images/missing.png"), null);
});

test("a file too large to embed stays a link, and is named", () => {
  const { root } = sandbox();
  const read = createAssetReader(root, { maxBytes: 3 });
  assert.strictEqual(read("images/dot.png"), null);
  assert.strictEqual(read("images/dot.png"), null);
  assert.deepStrictEqual(read.linked, ["images/dot.png"], "named once however often it is referred to");
  assert.strictEqual(MAX_ASSET_BYTES, 2 * 1024 * 1024);
});
