#!/usr/bin/env node
"use strict";

/**
 * Packs the one-click bundle for Claude Desktop: release-builds/OSCAR.mcpb.
 *
 *   npm run pack:mcpb
 *
 * A .mcpb is the helper (createwithoscar/) with a manifest and an icon,
 * zipped: Claude Desktop installs it on a double-click and runs it with its
 * own Node, so a person needs neither a terminal nor Node. It is the same
 * program npm carries; only the wrapping differs.
 *
 * The packing is Anthropic's own tool, fetched by npx when this runs, so it
 * needs the network. Nothing else in OSCAR depends on it.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, execSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const from = path.join(root, "createwithoscar");
const stage = path.join(root, "release-builds", "oscar-mcpb");
const out = path.join(root, "release-builds", "OSCAR.mcpb");

// The files that go in, and nothing that happens to lie beside them.
const FILES = [
  [path.join(from, "index.js"), "index.js"],
  [path.join(from, "tools.json"), "tools.json"],
  [path.join(from, "package.json"), "package.json"],
  [path.join(from, "manifest.json"), "manifest.json"],
  [path.join(root, "build", "icon.png"), "icon.png"],
  [path.join(root, "LICENSE"), "LICENSE"],
];

// The manifest and the tools' copy must be current before they are packed.
execFileSync(process.execPath, [path.join(__dirname, "build-mcp-package.js"), "--check"], { stdio: "inherit" });

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const [source, name] of FILES) {
  if (!fs.existsSync(source)) continue;
  fs.copyFileSync(source, path.join(stage, name));
}

// One command line for the shell: npx is a .cmd on Windows, which only a
// shell starts. The two paths are OSCAR's own, quoted for their spaces.
execSync('npx -y @anthropic-ai/mcpb@2 pack "' + stage + '" "' + out + '"', { stdio: "inherit" });
fs.rmSync(stage, { recursive: true, force: true });
console.log("packed " + path.relative(process.cwd(), out));
