#!/usr/bin/env node
"use strict";

/**
 * Writes the two files in createwithoscar/ that are made from OSCAR's own
 * MCP tools (lib/mcp/tools.js), so they cannot drift from them:
 *
 *   tools.json     the copy of the tools the helper carries for when OSCAR
 *                  is not running (createwithoscar/index.js)
 *   manifest.json  what the one-click bundle for Claude Desktop says about
 *                  itself (scripts/pack-mcpb.js packs it)
 *
 *   npm run build:mcp            write them
 *   npm run build:mcp -- --check fail if either is out of date
 *
 * The list is asked of a real MCP server wearing the real tools, so what the
 * helper shows an assistant without OSCAR is word for word what OSCAR shows
 * it when running: names, descriptions, input schemas, annotations. Run it
 * after changing lib/mcp/tools.js or the helper's version;
 * test/mcp-helper.test.js fails until it is.
 */

const fs = require("node:fs");
const path = require("node:path");

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { buildTools, INSTRUCTIONS } = require("../lib/mcp/tools");
const { dressServer } = require("../lib/mcp/http");

const DIR = path.join(__dirname, "..", "createwithoscar");
const OUT = path.join(DIR, "tools.json");
const MANIFEST = path.join(DIR, "manifest.json");

/** The tools as an assistant is shown them. */
async function listTools() {
  // Listing runs no handler, so the tools need nothing to stand on.
  const server = dressServer(buildTools({}), "0.0.0", null, INSTRUCTIONS);
  const client = new Client({ name: "build-mcp-package", version: "0.0.0" });
  const [toClient, toServer] = InMemoryTransport.createLinkedPair();
  await server.connect(toServer);
  await client.connect(toClient);
  const listed = await client.listTools();
  await client.close();
  await server.close();
  return listed.tools;
}

/** The bundle's manifest: who it is, how it starts, what it offers. */
function manifestFor(tools, packed) {
  return {
    manifest_version: "0.2",
    name: "oscar",
    display_name: "OSCAR",
    version: packed.version,
    description: "Connect Claude to OSCAR: see why a control is not responding, and have an interface drafted for you to review.",
    long_description:
      "OSCAR is a free, open-source editor and server for control interfaces: pages of buttons, sliders and other " +
      "controls that phones and tablets open, and that send OSC, MIDI and DMX to show software, instruments and lights.\n\n" +
      "With this extension Claude can read the OSCAR running on this computer (its projects, what is published, each " +
      "widget's settings, the MIDI ports, the recent network activity) and write an interface as a draft, which " +
      "appears in OSCAR under File > Open for you to check.\n\n" +
      "It never sends anything to your rig, publishes, or changes a project. OSCAR must be running, with the MCP " +
      "pill in its top bar green.",
    author: { name: "OSCAR", email: "hello@createwithoscar.site", url: "https://www.createwithoscar.site" },
    homepage: packed.homepage,
    documentation: "https://www.createwithoscar.site/how-it-works",
    support: packed.bugs.url,
    repository: { type: "git", url: "https://github.com/trafalmejo/OSCAR" },
    license: packed.license,
    privacy_policies: ["https://www.createwithoscar.site/privacy"],
    icon: "icon.png",
    keywords: packed.keywords,
    server: {
      type: "node",
      entry_point: "index.js",
      mcp_config: { command: "node", args: ["${__dirname}/index.js"] },
    },
    tools: tools.map((tool) => ({ name: tool.name, description: tool.title })),
    compatibility: { platforms: ["darwin", "win32", "linux"], runtimes: { node: packed.engines.node } },
  };
}

/** Both files' text, as they should stand. */
async function describe() {
  const tools = await listTools();
  const packed = JSON.parse(fs.readFileSync(path.join(DIR, "package.json"), "utf8"));
  return {
    tools: JSON.stringify({ instructions: INSTRUCTIONS, tools }, null, 1) + "\n",
    manifest: JSON.stringify(manifestFor(tools, packed), null, 2) + "\n",
  };
}

async function main() {
  const text = await describe();
  const files = [
    [OUT, text.tools],
    [MANIFEST, text.manifest],
  ];
  if (process.argv.includes("--check")) {
    let stale = false;
    for (const [file, wanted] of files) {
      const have = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "";
      if (have !== wanted) {
        console.error(path.relative(process.cwd(), file) + " is out of date: run `npm run build:mcp`.");
        stale = true;
      }
    }
    if (stale) process.exit(1);
    return;
  }
  for (const [file, wanted] of files) {
    fs.writeFileSync(file, wanted, "utf8");
    console.log("wrote " + path.relative(process.cwd(), file));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { describe, OUT, MANIFEST };
