"use strict";

/**
 * The MCP server's front door: /mcp on OSCAR's own HTTP server.
 *
 * The rails, before any tool runs:
 *
 *   - Loopback only. The route answers 127.0.0.1 and ::1 and nobody else,
 *     whatever the token says: an assistant talks to the OSCAR on its own
 *     machine. Remote comes later, through the account and the relay, never
 *     by opening this port.
 *   - A bearer token, fresh each boot, written where only this user reads
 *     it (~/.oscar/mcp.json, mode 600). A tab in a browser cannot call the
 *     MCP server by guessing, and a token that leaks dies with the process.
 *     Compared in constant time.
 *   - Stateless and JSON: every POST is its own conversation, so there is
 *     no session to hijack and nothing to clean up.
 *   - The switch: features.MCP off means the route does not exist.
 *
 * The tools themselves are lib/mcp/tools.js; what they may do (read,
 * validate, save a draft -- never send) is decided there, not here.
 */

const crypto = require("node:crypto");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { isLoopbackAddress } = require("../net");

/** A fresh token for this boot. */
function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

/** Constant-time equality, so a token cannot be felt out byte by byte. */
function tokenMatches(header, token) {
  const given = String(header || "");
  const wanted = "Bearer " + token;
  const a = Buffer.from(given);
  const b = Buffer.from(wanted);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** One McpServer wearing the tools; a new one per request, stateless. */
function dressServer(tools, version) {
  const server = new McpServer({ name: "oscar", version: version || "0.0.0" });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.schema },
      async (args) => {
        const result = await tool.handler(args || {});
        return { content: [{ type: "text", text: JSON.stringify(result, null, 1) }] };
      }
    );
  }
  return server;
}

/**
 * Mount /mcp. Returns the token, for the caller to write to the handshake
 * file (server.js does, alongside the URL).
 */
function attachMcp(app, { tools, version, token, enabled }) {
  const secret = token || newToken();

  app.post("/mcp", async (req, res) => {
    if (!isLoopbackAddress(req.socket && req.socket.remoteAddress)) {
      return res.status(403).json({ error: "The MCP server only answers this machine." });
    }
    // The pill in the editor's top bar: off closes the door mid-session,
    // token or no token.
    if (enabled && !enabled()) {
      return res.status(403).json({ error: "The MCP server is switched off. The MCP pill in OSCAR's top bar turns it on." });
    }
    if (!tokenMatches(req.headers.authorization, secret)) {
      return res.status(401).json({ error: "The token is in ~/.oscar/mcp.json, written when OSCAR starts." });
    }
    try {
      const server = dressServer(tools, version);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request failed:", err.message);
      if (!res.headersSent) res.status(500).json({ error: "The MCP server stumbled; the details are in OSCAR's terminal." });
    }
  });

  // Stateless: there is no stream to resume and no session to end.
  const gone = (req, res) => res.status(405).set("Allow", "POST").end();
  app.get("/mcp", gone);
  app.delete("/mcp", gone);

  return secret;
}

module.exports = { attachMcp, newToken, tokenMatches, dressServer };
