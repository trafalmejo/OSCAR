"use strict";

// createwithoscar/: the helper an assistant starts to reach OSCAR, published
// to npm. Held here the way an assistant holds it: a real MCP client on its
// stdin and stdout, a real /mcp behind it, and then with nobody behind it.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const { buildTools, INSTRUCTIONS } = require("../lib/mcp/tools");
const { attachMcp } = require("../lib/mcp/http");
const { PublishedStore } = require("../lib/published");
const { describe, OUT, MANIFEST } = require("../scripts/build-mcp-package");

const HELPER = path.join(__dirname, "..", "createwithoscar", "index.js");
const packed = require("../createwithoscar/package.json");

/** An OSCAR's /mcp on a port of its own, and the handshake file that names it. */
async function oscar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-helper-"));
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  const token = attachMcp(app, {
    version: "9.9.9",
    instructions: INSTRUCTIONS,
    tools: buildTools({
      version: "9.9.9",
      features: { MCP: true },
      httpPort: () => 0,
      oscInPort: () => 8880,
      socketPort: () => 8081,
      store: { list: async () => [], readById: async () => null },
      published: new PublishedStore(path.join(dir, "published")),
      midi: null,
      liveLog: () => [],
      lock: null,
      draftsDir: path.join(dir, "assistant"),
    }),
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const handshake = path.join(dir, "mcp.json");
  const write = (tok) => fs.writeFileSync(handshake, JSON.stringify({ url: "http://127.0.0.1:" + server.address().port + "/mcp", token: tok }));
  write(token);
  return {
    handshake,
    token,
    write,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

/** An assistant, as far as the helper can tell. */
async function assistant(handshake) {
  const client = new Client({ name: "test-assistant", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [HELPER],
      env: Object.assign({}, process.env, { OSCAR_MCP_FILE: handshake }),
      stderr: "ignore",
    })
  );
  return client;
}

const text = (result) => result.content[0].text;

test("with OSCAR running, the helper is OSCAR: its tools, their answers, its instructions", async () => {
  const running = await oscar();
  const client = await assistant(running.handshake);
  try {
    assert.deepStrictEqual(client.getServerVersion(), { name: "oscar", title: "OSCAR", version: packed.version });
    assert.strictEqual(client.getInstructions(), INSTRUCTIONS, "told what OSCAR is as it connects");

    const listed = await client.listTools();
    assert.deepStrictEqual(
      listed.tools.map((t) => t.name),
      ["status", "list_projects", "read_project", "list_published", "read_published", "midi_ports", "recent_activity", "describe_widgets", "validate_draft", "create_draft"]
    );
    assert.strictEqual(listed.tools[0].annotations.readOnlyHint, true, "the annotations come through");

    const status = JSON.parse(text(await client.callTool({ name: "status", arguments: {} })));
    assert.strictEqual(status.version, "9.9.9", "the answer is this OSCAR's, not a copy's");

    const html = '<!doctype html><title>Desk</title><body><button id="go" class="oscar-button" data-oscar="oscar-button" data-gjs-dmode="flow" data-gjs-message="/go">GO</button></body>';
    const saved = JSON.parse(text(await client.callTool({ name: "create_draft", arguments: { name: "Desk", html } })));
    assert.strictEqual(saved.saved, true, "arguments reach the tool: " + JSON.stringify(saved));

    const missing = await client.callTool({ name: "no_such_tool", arguments: {} });
    assert.strictEqual(missing.isError, true, "OSCAR's own refusal is passed on as it is");
    assert.match(text(missing), /not found/);
  } finally {
    await client.close();
    await running.stop();
  }
});

test("with OSCAR stopped, an assistant still sees the tools, and a call says to start OSCAR", async () => {
  const running = await oscar();
  const client = await assistant(running.handshake);
  try {
    // Stopped without tidying up: the handshake file is still there, with nobody behind it.
    await running.stop();
    const stale = await client.listTools();
    assert.strictEqual(stale.tools.length, 10, "the copy the helper carries");
    const refused = await client.callTool({ name: "status", arguments: {} });
    assert.strictEqual(refused.isError, true);
    assert.match(text(refused), /OSCAR is not running on this computer, or its MCP switch is off\. Start OSCAR/, "in words to pass on, not 'fetch failed'");

    // Quit properly, or the MCP pill switched off: no handshake file at all.
    fs.unlinkSync(running.handshake);
    assert.strictEqual((await client.listTools()).tools.length, 10);
    assert.match(text(await client.callTool({ name: "status", arguments: {} })), /Start OSCAR and check that the MCP pill/);

    // A file that is not what OSCAR writes.
    fs.writeFileSync(running.handshake, "{}");
    assert.match(text(await client.callTool({ name: "status", arguments: {} })), /missing its address or its token/);
  } finally {
    await client.close();
  }
});

test("a token OSCAR does not know is a restart, said so; OSCAR's own refusals keep their words", async () => {
  const running = await oscar();
  const client = await assistant(running.handshake);
  try {
    running.write("not-the-token");
    const refused = await client.callTool({ name: "status", arguments: {} });
    assert.strictEqual(refused.isError, true);
    assert.match(text(refused), /did not accept this helper/);
    assert.strictEqual((await client.listTools()).tools.length, 10, "and the tools are still listed");

    running.write(running.token);
    assert.ok(!(await client.callTool({ name: "status", arguments: {} })).isError, "the file is read afresh each time: no restart of the assistant");
  } finally {
    await client.close();
    await running.stop();
  }
});

test("the copy of the tools the helper carries is OSCAR's own, word for word", async () => {
  const fresh = await describe();
  const onDisk = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  assert.strictEqual(onDisk(OUT), fresh.tools, "createwithoscar/tools.json is out of date: run `npm run build:mcp`");
  const carried = JSON.parse(fresh.tools);
  assert.strictEqual(carried.instructions, INSTRUCTIONS);
  assert.ok(carried.tools.every((t) => t.description && t.inputSchema && t.annotations), "each with what an assistant needs to choose it");

  // The one-click bundle for Claude Desktop says the same of itself.
  assert.strictEqual(onDisk(MANIFEST), fresh.manifest, "createwithoscar/manifest.json is out of date: run `npm run build:mcp`");
  const manifest = JSON.parse(fresh.manifest);
  assert.strictEqual(manifest.version, packed.version, "one version for the npm package and the bundle");
  assert.deepStrictEqual(manifest.tools.map((t) => t.name), carried.tools.map((t) => t.name));
  assert.deepStrictEqual(manifest.server, { type: "node", entry_point: "index.js", mcp_config: { command: "node", args: ["${__dirname}/index.js"] } });
  assert.match(manifest.long_description, /never sends anything to your rig/);
});

test("the package is what npm is told it is: one command, two files, nothing to install", () => {
  assert.strictEqual(packed.name, "createwithoscar");
  assert.deepStrictEqual(packed.bin, { createwithoscar: "index.js" });
  assert.deepStrictEqual(packed.files, ["index.js", "tools.json"]);
  assert.ok(!packed.dependencies, "no dependencies: npx fetches one small package, and it can be read in a sitting");
  assert.strictEqual(packed.engines.node, ">=18", "fetch is built in from there on");

  const source = fs.readFileSync(HELPER, "utf8");
  assert.ok(!source.includes(String.fromCharCode(13)), "Unix line endings: a Windows one after the first line breaks the command elsewhere (.gitattributes keeps them)");
  assert.match(source, /^#!\/usr\/bin\/env node\n/, "runnable as a command");
  const required = [...source.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(required.filter((name) => !name.startsWith("node:") && !name.startsWith("./")), [], "only Node's own modules and its two files");

  // The same program serves a source checkout, where the README's older line points.
  const shim = fs.readFileSync(path.join(__dirname, "..", "scripts", "oscar-mcp.js"), "utf8");
  assert.match(shim, /require\("\.\.\/createwithoscar\/index\.js"\);/);
  // And it is not in the installers: an installed OSCAR is reached through npm.
  const build = require("../package.json").build;
  assert.ok(!build.files.some((entry) => /createwithoscar|scripts/.test(entry)));
});
