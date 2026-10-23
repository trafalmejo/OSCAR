# OSCAR for AI assistants: the skill, the plugins, and where they are listed

This folder is how OSCAR reaches people through their AI assistant, and this file is the record of it: what was built, why it is shaped this way, how it stays correct, and what is still to do. Written 2026-10-23 on branch `phone-ready`; nothing here is live until it is on `master`, because every directory and install command reads the default branch. When something here stops being true, fix it in the same commit.

The user-facing text lives in [`oscar/README.md`](oscar/README.md) and the main README's section "OSCAR for AI assistants (MCP)". The site's how-it-works page carries the install links.

## Why

OSCAR 2.1 already speaks MCP: a running OSCAR is a server, `createwithoscar` on npm is the helper an assistant starts, `OSCAR.mcpb` is the one-click bundle for Claude Desktop, and the helper is listed on the official MCP registry as `io.github.trafalmejo/oscar`. That covers the protocol. It did not cover the places people now install things from, and it only works once OSCAR is installed and running.

A **skill** fixes both. It is a folder with a `SKILL.md` (the Agent Skills open standard, agentskills.io) that teaches an assistant how to design a phone or tablet surface, what Resolume, TouchDesigner, QLab, DAWs and DMX expect on the wire, and every widget OSCAR has. Skills are found by task, not by product name: someone who asks their assistant for a Resolume controller on a phone can reach OSCAR through the skill before they have heard of it. A skill needs no Node, no server and no running OSCAR, which matters for VJs and technicians who do not open terminals.

A **plugin** is the packaging that installs the skill and the MCP server together. Claude Code, Codex and Gemini CLI each have one, and their formats are close enough that one folder serves all three.

## What is in the repository

| Path | What it is |
| --- | --- |
| `skills/oscar/SKILL.md` | The skill: when to use the MCP tools and when to write plain HTML, the design rules, the troubleshooting order, product facts to get right |
| `skills/oscar/references/widgets.md` | Every widget, tag, attribute, setting and default. **Generated** from `lib/widgets/registry.js` through `describe_widgets` by `npm run build:skill`. Never edit by hand |
| `skills/oscar/references/targets.md` | Addresses, ports and setup per target, taken from the site guides and the shipped templates |
| `skills/oscar/references/example.html` | A small Resolume draft that passes `validate_draft`, to copy the shape of |
| `skills/oscar/README.md` | The plugin folder's README, which the directories read. Forty words or more, plain, discloses exactly what the helper does |
| `skills/oscar/.claude-plugin/plugin.json`, `icon.png` | The Claude Code plugin manifest and the 512 px app icon (a copy of `build/icon.png`) |
| `skills/oscar/.codex-plugin/plugin.json` | The Codex plugin manifest, pointing at the same files |
| `skills/oscar/.mcp.json` | The MCP server both plugins start: `npx -y createwithoscar@<version>` |
| `.claude-plugin/marketplace.json` (repo root) | The marketplace, one plugin, source `./skills/oscar`. Claude Code and Codex both read it |
| `gemini-extension.json` (repo root) | The Gemini CLI extension manifest. The extension root is the repo root, and Gemini finds `skills/oscar/` on its own |
| `scripts/build-skill-widgets.js` | Writes `widgets.md`; `--check` fails when it is stale |
| `test/skill.test.js` | Keeps all of it true to the app (below) |

The three install routes, all after the merge:

```
npx skills add trafalmejo/OSCAR                         # the skill alone, any assistant (-a codex, -a cursor, ...)
claude plugin marketplace add trafalmejo/OSCAR          # Claude Code: skill + MCP server
claude plugin install oscar@createwithoscar             #   the skill answers to /oscar:oscar
codex plugin marketplace add trafalmejo/OSCAR           # Codex: then install from the ChatGPT desktop app's plugin directory
gemini extensions install https://github.com/trafalmejo/OSCAR
```

Without a plugin, Codex takes the skill with `npx skills add trafalmejo/OSCAR -a codex` and the server with `codex mcp add oscar -- npx -y createwithoscar`. Cursor and VS Code take the server from the one-click links on the how-it-works page.

## Why it is shaped this way

- **The plugin folder is `skills/oscar/`, not the repository root.** Anthropic's directory holds any plugin folder with more than 512 files, a file over 256 KiB, or a lockfile beside `package.json`, all of which the repo root has. A folder whose root is the skill itself is allowed by Claude Code ("a plugin with only a root `SKILL.md` loads as one skill"), so one copy of the files serves the skill, the plugin and the Gemini extension. Gemini wants `skills/` at the extension root, which is why the folder is named `skills/` and sits at the top of the repo.
- **The launcher is pinned.** `npx -y createwithoscar@1.0.2`, not `createwithoscar`: the directory blocks an unpinned `npx`. The Gemini manifest pins the same so they cannot drift. The cost is a release chore, enforced by the test.
- **Versions.** The plugin and extension carry OSCAR's version (`package.json`), because the skill ships with each release; the pin carries the helper's (`createwithoscar/package.json`).
- **Nothing in the plugin runs code of its own.** No scripts, no hooks, no network beyond the helper, which talks to the local OSCAR only. The directories run a safety scan, and skills that fetch things are what it is there to catch.
- **The widget reference is generated.** The same rule as `createwithoscar/tools.json`: a copy of what the app knows must be made from the app, and a test must fail when it is stale.

## What the test holds

`test/skill.test.js`, run by `npm test`:

- `SKILL.md` has the frontmatter the spec requires, `name` equals the folder name, the description is under 1024 characters, and it points at every reference file.
- `references/widgets.md` is word for word what `scripts/build-skill-widgets.js` renders now.
- `references/example.html` passes `validate_draft` with no problems.
- `plugin.json` (both), `marketplace.json` and `gemini-extension.json` agree on the name `oscar`, carry OSCAR's version, and pin `createwithoscar@` at the helper's published version.
- The plugin folder passes the directory's mechanical checks: README of 40 words or more, no lockfile, nothing over 256 KiB except the icon.

`claude plugin validate --strict skills/oscar` passed with nothing to report on 2026-10-23. The skills CLI (`npx skills add <local path>`) found exactly one skill and installed it.

## At each release

1. If a widget or a setting changed: `npm run build:skill` (the test says so).
2. If `createwithoscar/package.json` bumped: change the pin in `skills/oscar/.mcp.json` and `gemini-extension.json` (the test says so).
3. If OSCAR's version bumped: change `version` in `skills/oscar/.claude-plugin/plugin.json`, `skills/oscar/.codex-plugin/plugin.json` and `gemini-extension.json` (the test says so).
4. A plugin listed in Anthropic's directory is re-scanned on every push to `master`; a version that fails the scan cannot go live.

## Where things stand

| Channel | Route | Status (2026-10-23) |
| --- | --- | --- |
| Official MCP registry | `createwithoscar/server.json` + `mcp-publisher` | Listed since 2026-10-04 |
| Skill via `npx skills add` | public repo, `skills/oscar/SKILL.md` on master | Built; live at the merge |
| skills.sh leaderboard | indexes installs from GitHub; no form | Follows the above |
| Claude Code, own marketplace | `.claude-plugin/marketplace.json` | Built; live at the merge |
| Anthropic plugin directory | form at https://claude.ai/directory/manage, paid claude.ai plan | Text below; submit after the merge |
| Anthropic desktop extensions (the `.mcpb`) | separate form, https://clau.de/desktop-extention-submission (their spelling) | Text below; the file is on the site already |
| Codex, by hand | `npx skills add -a codex` and `codex mcp add` | On the how-it-works page |
| Codex plugin, own marketplace | Codex reads `.claude-plugin/marketplace.json`; `.codex-plugin/plugin.json` in the folder | Built, **untested**: whether Codex accepts a plugin whose root is itself the skill (`"skills": "./"`). If not, give the folder a `skills/oscar/` copy kept in step by the test |
| OpenAI universal plugin directory (ChatGPT and Codex) | https://platform.openai.com/plugins: ZIP upload, verified identity, review | Not started. A local MCP server is pushed to a desktop-only path, but **skills-only plugins are accepted**: that is the submission to make |
| Gemini CLI gallery | repo topic `gemini-cli-extension`; crawled daily, no form | Manifest built; add the topic after the merge |
| Antigravity CLI (replaced Gemini CLI for free and Pro users on 2026-06-18) | imports Gemini extensions as plugins (`agy`) | Nothing more to build; try the import once |
| Cursor | "Add to Cursor" deeplink on how-it-works | In the page, link not yet clicked on a machine with Cursor |
| VS Code | `vscode:mcp/install` link on how-it-works; the gallery feeds from the GitHub MCP registry | In the page, same caveat |
| Claude Connectors Directory | Team or Enterprise organisation, remote servers only | Not possible for a local server |
| ChatGPT custom connectors | remote HTTPS only, paid plans | Would need the relay to bridge in, which the rules forbid. Skip |
| Aggregators (Glama, PulseMCP, Smithery, mcp.so, cursor.directory, mcpservers.org) | scrape the registry and GitHub; claim with the GitHub account | After the merge, half an hour |

## Still to do, in order

- [ ] Merge to `master` and release (the usual procedure in the main README).
- [ ] `gh repo edit trafalmejo/OSCAR --add-topic gemini-cli-extension`, then look for "oscar" at https://geminicli.com/extensions/browse a day later.
- [ ] Rebuild and deploy the site (`node site/build.js && cd site && npx wrangler deploy` in `oscar-site`), which carries the install links and `llms.txt`.
- [ ] Try the installs on this machine: `/plugin marketplace add trafalmejo/OSCAR` and `/plugin install oscar@createwithoscar` in Claude Code; `codex plugin marketplace add trafalmejo/OSCAR` and install from the ChatGPT desktop app; `agy` import of the Gemini extension; `npx skills add trafalmejo/OSCAR`. Fix the Codex layout if it refuses (see the table).
- [ ] Click the Cursor and VS Code links once on a machine with those apps.
- [ ] Submit to Anthropic's plugin directory (text below). Needs a paid claude.ai plan on the submitting account.
- [ ] Submit `OSCAR.mcpb` through the desktop extensions form (text below).
- [ ] Claim the aggregator pages (list below).
- [ ] Reply in the Resolume threads (the line below), per `docs/forum-outreach.md`.
- [ ] Later: a skills-only submission to OpenAI's universal directory, with the same screenshots and the long description.
- [ ] Later: an `onboardingSkill` or a `/oscar:connect` skill that prints the install steps for the person's own app, once there is feedback on which apps people arrive from.

## Texts for the forms

**Anthropic plugin directory** (https://claude.ai/directory/manage, "Submit new", "Plugin bundle", repository `https://github.com/trafalmejo/OSCAR`, plugin folder `skills/oscar`, category productivity or creative):

Short description:

> Design phone and tablet control interfaces for Resolume, TouchDesigner, QLab, DAWs and DMX lights, and read a running OSCAR. Never sends to a rig.

Long description:

> OSCAR is a free, open-source editor and server for control interfaces: pages of buttons, sliders, pads and faders that phones and tablets open in a browser and that send OSC, MIDI and DMX to show software, instruments and lights. This plugin gives Claude two things. A skill: how to design a good touch surface, what Resolume, TouchDesigner, QLab, DAWs and DMX fixtures expect on the wire, and every OSCAR widget with its settings, so Claude can write a complete interface as one HTML file with or without OSCAR running. And OSCAR's MCP server (the `createwithoscar` helper, no dependencies): with OSCAR running on the same computer, Claude reads the projects, published interfaces, every control's settings, the MIDI ports and the network log to explain why something does not respond, validates a draft against OSCAR's own validators, and saves it as a draft the person opens, checks and publishes themselves. No tool sends anything to software or gear, publishes, or changes a project. The helper talks to the local OSCAR only, over a per-start token; there is no account, no key and no telemetry in it.

Data: reads the local OSCAR only; nothing leaves the computer. Privacy policy https://www.createwithoscar.com/privacy. Support https://github.com/trafalmejo/OSCAR/issues. Documentation https://www.createwithoscar.com/how-it-works#ai.

Screenshots to make from the release build: the MCP pill and its window; a draft under File > Open project or template with the Draft badge; the Resolume Pocket Desk draft open on a phone; Claude answering "why is my slider not moving the light" with the installation map.

**Desktop extensions form**: name OSCAR; file https://www.createwithoscar.com/assets/OSCAR.mcpb (1.0.2); platforms tested Windows 11 and macOS; what it does, the long description above without the skill sentences; requirements OSCAR 2.1 or later running on the same computer, nothing else to install; permissions none, loopback only.

**OpenAI universal directory**, when its turn comes: the same long description; `interface.displayName` and `shortDescription` are capped at 30 characters (`.codex-plugin/plugin.json` already fits); a square logo of 48 px or more (the icon is 512); submit the skill without the MCP server.

**The forum line** (Resolume threads rt/34484 and rt/34538, one paragraph, the room is split on AI): "If you use Claude Code, Codex or Gemini CLI, `npx skills add trafalmejo/OSCAR` teaches it the Resolume addresses and OSCAR's controls; connect OSCAR and it can also read why something does not respond."

**Aggregators to claim**: https://glama.ai/mcp/servers, https://www.pulsemcp.com/servers, https://smithery.ai, https://mcp.so, https://cursor.directory/mcp, https://mcpservers.org. Search each for "createwithoscar"; most will have scraped the registry. Replace the description with the short one above and add a screenshot from `oscar-site/site/assets/img/`.
