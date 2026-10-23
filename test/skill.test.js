"use strict";

/**
 * The OSCAR skill (skills/oscar/) is what an assistant reads to design an
 * interface, with or without OSCAR running, and the same folder is the
 * Claude Code plugin and part of the Gemini CLI extension. These tests keep
 * it true to the app: the widget reference is generated from the registry,
 * the example draft passes the real validators, and every manifest pins the
 * helper version that is actually published.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { buildTools } = require("../lib/mcp/tools");
const { render, OUT } = require("../scripts/build-skill-widgets");

const ROOT = path.join(__dirname, "..");
const SKILL = path.join(ROOT, "skills", "oscar");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8").replace(/\r\n/g, "\n");
const json = (...p) => JSON.parse(read(...p));

const helperVersion = json(ROOT, "createwithoscar", "package.json").version;
const oscarVersion = json(ROOT, "package.json").version;

test("SKILL.md has the frontmatter the Agent Skills spec asks for, and its name is its folder's", () => {
  const text = read(SKILL, "SKILL.md");
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "frontmatter between --- lines");
  const name = m[1].match(/^name:\s*(.+)$/m);
  const description = m[1].match(/^description:\s*(.+)$/m);
  assert.strictEqual(name && name[1].trim(), "oscar");
  assert.ok(description, "a description");
  assert.ok(description[1].trim().length > 0 && description[1].trim().length <= 1024, "description within 1024 characters");
  assert.ok(text.length < 60000, "the body stays readable in one go");
  // The rule the whole feature stands on is said in the skill itself.
  assert.match(text, /never sends/i);
  for (const ref of ["references/widgets.md", "references/targets.md", "references/example.html"]) {
    assert.ok(fs.existsSync(path.join(SKILL, ref)), ref + " exists");
    assert.ok(text.includes(ref), "SKILL.md points at " + ref);
  }
});

test("the widget reference is OSCAR's own registry, word for word", async () => {
  assert.strictEqual(read(OUT), await render(), "skills/oscar/references/widgets.md is out of date: run `npm run build:skill`");
});

test("the example draft passes the validators an assistant is held to", async () => {
  const validate = buildTools({ fs, path }).find((t) => t.name === "validate_draft");
  const result = await validate.handler({ html: read(SKILL, "references", "example.html") });
  assert.deepStrictEqual(result.problems, []);
  assert.strictEqual(result.ok, true);
  assert.ok(result.widgets >= 5, "a real interface, not a stub");
});

test("the plugin and the extension pin the helper that is published, and agree on names", () => {
  const plugin = json(SKILL, ".claude-plugin", "plugin.json");
  const mcp = json(SKILL, ".mcp.json");
  const marketplace = json(ROOT, ".claude-plugin", "marketplace.json");
  const gemini = json(ROOT, "gemini-extension.json");

  assert.strictEqual(plugin.name, "oscar");
  assert.strictEqual(plugin.version, oscarVersion, "the plugin ships with each OSCAR release");
  assert.strictEqual(gemini.version, oscarVersion);
  assert.ok(plugin.license, "the directory refuses a plugin without a licence");

  assert.strictEqual(marketplace.plugins.length, 1);
  assert.strictEqual(marketplace.plugins[0].name, plugin.name, "install is <plugin>@<marketplace>");
  assert.strictEqual(marketplace.plugins[0].source, "./skills/oscar");

  // Anthropic's directory blocks an unpinned npx; Gemini is given the same so they cannot drift.
  const pinned = ["-y", "createwithoscar@" + helperVersion];
  assert.deepStrictEqual(mcp.mcpServers.oscar, { command: "npx", args: pinned }, "skills/oscar/.mcp.json pins createwithoscar@" + helperVersion);
  assert.deepStrictEqual(gemini.mcpServers.oscar, { command: "npx", args: pinned }, "gemini-extension.json pins createwithoscar@" + helperVersion);
  assert.strictEqual(gemini.name, "oscar");

  // Codex reads the same folder through its own manifest, pointed at the same files.
  const codex = json(SKILL, ".codex-plugin", "plugin.json");
  assert.strictEqual(codex.name, plugin.name);
  assert.strictEqual(codex.version, oscarVersion);
  assert.strictEqual(codex.mcpServers, "./.mcp.json");
  assert.ok(fs.existsSync(path.join(SKILL, codex.interface.logo)), "the logo the manifest names exists");
  assert.ok(codex.interface.shortDescription.length <= 30 && codex.interface.displayName.length <= 30, "within the directory's limits");
});

test("the plugin folder meets the directory's checks: a README of 40 words or more, nothing large, no lockfile", () => {
  const words = read(SKILL, "README.md").replace(/```[\s\S]*?```/g, "").split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 40, "README.md has " + words + " words");
  assert.ok(!fs.existsSync(path.join(SKILL, "package-lock.json")));
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(png|jpe?g)$/.test(entry.name)) assert.ok(fs.statSync(full).size < 2 * 1024 * 1024, path.relative(ROOT, full) + " icon under 2 MB");
      else assert.ok(fs.statSync(full).size < 256 * 1024, path.relative(ROOT, full) + " under 256 KiB");
    }
  })(SKILL);
});
