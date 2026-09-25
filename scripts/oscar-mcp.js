#!/usr/bin/env node
"use strict";

/**
 * The stdio shim: an MCP server on stdin/stdout that hands everything to the
 * running OSCAR's /mcp endpoint. For assistants that are configured with a
 * command rather than a URL (Claude Desktop, and Claude Code's default):
 *
 *   claude mcp add oscar -- node <path-to-oscar>/scripts/oscar-mcp.js
 *
 * It finds OSCAR through the handshake file OSCAR writes on every boot
 * (~/.oscar/mcp.json: the URL and this boot's token), read fresh on each
 * connection so an OSCAR restart never strands the assistant. No OSCAR
 * running means an honest error, not a hang.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { ListToolsRequestSchema, CallToolRequestSchema } = require("@modelcontextprotocol/sdk/types.js");

const HANDSHAKE = process.env.OSCAR_MCP_FILE || path.join(os.homedir(), ".oscar", "mcp.json");

function handshake() {
  let raw;
  try {
    raw = fs.readFileSync(HANDSHAKE, "utf8");
  } catch {
    throw new Error("OSCAR does not seem to be running: there is no handshake file at " + HANDSHAKE + ". Start OSCAR first.");
  }
  const read = JSON.parse(raw);
  if (!read.url || !read.token) throw new Error("The handshake file at " + HANDSHAKE + " is missing its url or token.");
  return read;
}

/** A fresh client per request: stateless, like the endpoint itself. */
async function withOscar(fn) {
  const found = handshake();
  const client = new Client({ name: "oscar-mcp-shim", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(found.url), {
    requestInit: { headers: { Authorization: "Bearer " + found.token } },
  });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function main() {
  const server = new Server({ name: "oscar", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => withOscar((client) => client.listTools()));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    withOscar((client) => client.callTool({ name: request.params.name, arguments: request.params.arguments || {} }))
  );

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
