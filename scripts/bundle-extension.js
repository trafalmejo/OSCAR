"use strict";

/**
 * Copy an extension into extensions/, so the next installer built carries it.
 *
 *   node scripts/bundle-extension.js ../some-extension
 *   node scripts/bundle-extension.js --clear
 *
 * Only what the extension says it publishes is copied: the `files` list in
 * its package.json, and the package.json itself. Its tests, its tools and
 * anything else in its repository stay where they are. extensions/ is
 * ignored by git: an extension lives in a repository of its own.
 *
 * OSCAR looks in that folder on every start (lib/extensions.js), so this is
 * also a way to run with an extension without setting OSCAR_EXTENSIONS.
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const target = path.join(root, "extensions");

function copy(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      if (name === "node_modules" || name === ".git") continue;
      copy(path.join(from, name), path.join(to, name));
    }
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

const arg = process.argv[2];
if (!arg) {
  console.error("Which extension? Give its folder, or --clear to empty extensions/.");
  process.exit(1);
}

if (arg === "--clear") {
  fs.rmSync(target, { recursive: true, force: true });
  console.log("extensions/ is empty: the next installer is plain OSCAR.");
  process.exit(0);
}

const source = path.resolve(arg);
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
} catch (err) {
  console.error("No readable package.json in " + source);
  process.exit(1);
}
if (manifest.dependencies && Object.keys(manifest.dependencies).length) {
  console.error(manifest.name + " has dependencies of its own, which this does not install. Bundle it some other way.");
  process.exit(1);
}

// "@scope/name" becomes "name": a folder, not an address.
const folder = path.join(target, String(manifest.name || path.basename(source)).replace(/^@[^/]+\//, ""));
fs.rmSync(folder, { recursive: true, force: true });
const files = Array.isArray(manifest.files) && manifest.files.length ? manifest.files : [manifest.main || "index.js"];
let copied = 0;
for (const entry of files.concat(["package.json"])) {
  const from = path.join(source, entry);
  if (!fs.existsSync(from)) continue;
  copy(from, path.join(folder, entry));
  copied++;
}
console.log(manifest.name + " " + manifest.version + " -> " + path.relative(root, folder) + " (" + copied + " entries)");
