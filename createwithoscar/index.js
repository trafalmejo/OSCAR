#!/usr/bin/env node
"use strict";

/**
 * createwithoscar: the helper an AI assistant starts to reach OSCAR.
 *
 * An assistant such as Claude is configured with a command, not with an
 * address that changes: it runs this, speaks MCP to it over stdin and stdout,
 * and this passes each request to the OSCAR running on the same computer.
 * It finds that OSCAR through the handshake file OSCAR writes when it starts
 * (~/.oscar/mcp.json: the address and that start's token), read fresh on
 * every request, so restarting OSCAR never strands the assistant.
 *
 *   claude mcp add oscar -- npx -y createwithoscar
 *
 * No dependencies, on purpose: it is fetched by npx on a stranger's machine,
 * so it is one file that can be read in a sitting. The protocol it speaks is
 * small: initialize, ping, tools/list and tools/call, as lines of JSON.
 *
 * When OSCAR is not running the assistant still gets the list of tools (the
 * copy in tools.json, made from OSCAR's own by `npm run build:mcp`), and a
 * call answers in plain words that OSCAR has to be started. An assistant
 * that found nothing at start-up would otherwise show no tools until it was
 * restarted itself.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const BUNDLED = require("./tools.json");
const VERSION = require("./package.json").version;

const HANDSHAKE = process.env.OSCAR_MCP_FILE || path.join(os.homedir(), ".oscar", "mcp.json");
// The versions of MCP this helper can answer in, newest first. It only
// lists and calls tools, which every one of them does the same way.
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const TIMEOUT_MS = 30000;

/** OSCAR cannot be reached, said in words an assistant can pass on. */
class Away extends Error {}

const NOT_RUNNING =
  "OSCAR is not running on this computer, or its MCP switch is off. Start OSCAR and check that the MCP pill in its top bar is green, then ask again.";

function handshake() {
  let raw;
  try {
    raw = fs.readFileSync(HANDSHAKE, "utf8");
  } catch {
    // OSCAR removes the file when it quits and when the MCP pill is switched off.
    throw new Away(NOT_RUNNING);
  }
  let found;
  try {
    found = JSON.parse(raw);
  } catch {
    throw new Away("The file OSCAR writes for assistants (" + HANDSHAKE + ") cannot be read. Restart OSCAR, then ask again.");
  }
  if (!found || !found.url || !found.token) {
    throw new Away("The file OSCAR writes for assistants (" + HANDSHAKE + ") is missing its address or its token. Restart OSCAR, then ask again.");
  }
  return found;
}

/** One request to OSCAR's /mcp, and its JSON-RPC answer. */
async function ask(method, params) {
  const found = handshake();
  let res;
  try {
    res = await fetch(found.url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + found.token,
        "Content-Type": "application/json",
        // OSCAR answers in JSON, but its endpoint insists a client could take a stream too.
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || {} }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err && err.name === "TimeoutError") throw new Away("OSCAR did not answer in time. Check that it is still running, then ask again.");
    // A handshake file with nobody behind it: OSCAR stopped without tidying up.
    throw new Away(NOT_RUNNING);
  }
  if (res.status === 401) {
    throw new Away("OSCAR did not accept this helper. It was probably restarted a moment ago: ask again, and if it repeats, restart OSCAR.");
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    // 403 is OSCAR saying why in its own words: the MCP pill is off.
    throw new Away((body && typeof body.error === "string" && body.error) || "OSCAR refused the request (" + res.status + ").");
  }
  if (!body || (body.result === undefined && !body.error)) throw new Away("OSCAR gave an answer this helper could not read.");
  return body;
}

/** What each request gets back: { result } or { error }. */
async function answer(method, params) {
  if (method === "initialize") {
    const wanted = params && params.protocolVersion;
    return {
      result: {
        protocolVersion: PROTOCOLS.includes(wanted) ? wanted : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "oscar", title: "OSCAR", version: VERSION },
        instructions: BUNDLED.instructions,
      },
    };
  }
  if (method === "ping") return { result: {} };

  if (method === "tools/list") {
    try {
      const body = await ask("tools/list", {});
      if (body.result && Array.isArray(body.result.tools)) return { result: { tools: body.result.tools } };
    } catch (err) {
      if (!(err instanceof Away)) throw err;
    }
    // OSCAR is not there to say: the copy this helper carries.
    return { result: { tools: BUNDLED.tools } };
  }

  if (method === "tools/call") {
    try {
      const body = await ask("tools/call", { name: params && params.name, arguments: (params && params.arguments) || {} });
      return body.error ? { error: body.error } : { result: body.result };
    } catch (err) {
      if (!(err instanceof Away)) throw err;
      // A result the assistant reads and repeats, not a protocol failure it hides.
      return { result: { content: [{ type: "text", text: err.message }], isError: true } };
    }
  }

  return { error: { code: -32601, message: "Method not found: " + method } };
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function handle(message) {
  if (!message || typeof message !== "object" || typeof message.method !== "string") return;
  // A notification (no id) wants no answer: initialized, cancelled.
  const wantsAnswer = message.id !== undefined && message.id !== null;
  if (!wantsAnswer) return;
  try {
    send(Object.assign({ jsonrpc: "2.0", id: message.id }, await answer(message.method, message.params)));
  } catch (err) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: String((err && err.message) || err) } });
  }
}

function main() {
  const arg = process.argv[2];
  if (arg === "--version" || arg === "-v") {
    console.log(VERSION);
    return;
  }
  if (arg === "--help" || arg === "-h" || process.stdin.isTTY) {
    // Started by a person, not by an assistant: say what this is for.
    console.error(
      [
        "createwithoscar " + VERSION + ": connects an AI assistant to OSCAR (https://www.createwithoscar.site).",
        "",
        "It is started by the assistant, not by hand. To connect one:",
        "  Claude Code:     claude mcp add oscar -- npx -y createwithoscar",
        '  Other apps:      a server named "oscar" with command "npx" and arguments ["-y", "createwithoscar"]',
        "",
        "OSCAR must be running on this computer, with the MCP pill in its top bar green.",
      ].join("\n")
    );
    if (arg) return;
  }

  // Requests are answered as they finish, and the process waits for the
  // last of them: an assistant that closes its end is not cut off mid-answer.
  let waiting = 0;
  let closed = false;
  const settle = () => {
    waiting -= 1;
    if (closed && waiting === 0) process.exit(0);
  };

  const lines = readline.createInterface({ input: process.stdin, terminal: false });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    // Older clients may send several messages as one array.
    for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
      waiting += 1;
      handle(message).then(settle, settle);
    }
  });
  lines.on("close", () => {
    closed = true;
    if (waiting === 0) process.exit(0);
  });
}

main();
