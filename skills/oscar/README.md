# OSCAR for AI assistants

[OSCAR](https://www.createwithoscar.com) is a free, open-source editor and server for control interfaces: pages of buttons, sliders, pads and faders that phones and tablets open in a browser, sending OSC, MIDI and DMX to show software (Resolume, TouchDesigner, QLab, Ableton Live) and to lights over Art-Net, sACN or USB DMX.

This folder is three things at once, all from the same files:

- An **Agent Skill** (`SKILL.md` with `references/`): how to design a good phone or tablet surface, what each target expects on the wire, and every widget OSCAR has with its settings. It works in any assistant that reads skills, with or without OSCAR running: `npx skills add trafalmejo/OSCAR`.
- A **Claude Code plugin** (`.claude-plugin/plugin.json` and `.mcp.json`): the skill plus OSCAR's MCP server, started as `npx createwithoscar`. In Claude Code: `/plugin marketplace add trafalmejo/OSCAR`, then `/plugin install oscar@createwithoscar`. The skill answers to `/oscar:oscar`.
- Part of the **Gemini CLI extension** declared by `gemini-extension.json` at the repository root: `gemini extensions install https://github.com/trafalmejo/OSCAR`. Antigravity CLI, which replaces Gemini CLI, imports such extensions as plugins.
- A **Codex plugin** (`.codex-plugin/plugin.json`, the same `.mcp.json`): Codex reads the repository's `.claude-plugin/marketplace.json` too, so `codex plugin marketplace add trafalmejo/OSCAR` lists it in the ChatGPT desktop app's plugin directory. Without the plugin, two commands do the same: `npx skills add trafalmejo/OSCAR -a codex` for the skill and `codex mcp add oscar -- npx -y createwithoscar` for the server.

## What the MCP server does

`createwithoscar` is a small program with no dependencies. It finds the OSCAR running on the same computer through a file OSCAR writes at start (`~/.oscar/mcp.json`: its local address and a token that changes every start) and passes each request to it and nowhere else. The assistant can then read OSCAR's projects, published interfaces, every widget's settings, the MIDI ports and the network log, and save a **draft** interface that appears in OSCAR under File > Open project or template with a Draft badge.

It never sends anything to software, gear or lights, never publishes, and never changes a project. A draft does nothing until a person opens it. Switching the MCP pill off in OSCAR's top bar closes the door. Nothing here talks to any other server; there is no account, no key, and no telemetry in the helper.

## Keeping it fresh

`references/widgets.md` is generated from OSCAR's widget registry by `npm run build:skill`; `test/skill.test.js` fails when it is stale, when the example draft stops validating, or when the pinned helper version in `.mcp.json` and `gemini-extension.json` differs from `createwithoscar/package.json`.

Licence: BSD 3-clause, the same as OSCAR.
