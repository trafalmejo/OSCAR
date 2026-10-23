#!/usr/bin/env node
"use strict";

/**
 * Writes skills/oscar/references/widgets.md, the widget reference the OSCAR
 * skill carries, from the same source describe_widgets reads
 * (lib/mcp/tools.js, and under it lib/widgets/registry.js), so the skill
 * cannot drift from the app.
 *
 *   npm run build:skill            write it
 *   npm run build:skill -- --check fail if it is out of date
 *
 * Run it after adding a widget or a setting; test/skill.test.js fails until
 * it is. The file is a summary an assistant can read without OSCAR running:
 * every tag, attribute, setting and default. The hints are the panels' own.
 */

const fs = require("node:fs");
const path = require("node:path");
const { buildTools } = require("../lib/mcp/tools");

const OUT = path.join(__dirname, "..", "skills", "oscar", "references", "widgets.md");

/** settingKey -> data-gjs-setting-key, as the editor writes them. */
const attr = (key) => "data-gjs-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

const show = (v) => (v === "" ? '""' : typeof v === "string" ? v : JSON.stringify(v));

/** One settings table. `defaults` gives the value column. */
function table(settings, defaults) {
  // The same attribute can carry two panel rows (a text box on the network,
  // a select on USB): one row here, both labels.
  const merged = [];
  for (const s of settings) {
    const twin = merged.find((m) => m.key === s.key);
    if (twin) twin.label += " / " + s.label;
    else merged.push({ ...s });
  }
  const rows = merged.map((s) => {
    const fixed = s.options && s.options.some((o) => o.id !== "");
    let options = "";
    if (s.options && fixed) options = " Options: " + s.options.filter((o) => o.id !== "").map((o) => "`" + o.id + "`").join(", ") + ".";
    else if (s.options) options = " Options: a port by name, from the ones this computer has; blank for the first.";
    const hint = s.hint ? " " + s.hint.replace(/\|/g, "\\|") : "";
    const def = defaults && Object.prototype.hasOwnProperty.call(defaults, s.key) ? "`" + show(defaults[s.key]) + "`" : "";
    return `| \`${attr(s.key)}\` | ${s.label} | ${s.type} | ${def} |${options}${hint} |`;
  });
  return ["| Attribute | Panel label | Type | Default | Meaning |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}

async function render() {
  // Listing runs no handler that needs OSCAR, so the tools need nothing to stand on.
  const tools = buildTools({ fs, path });
  const described = await tools.find((t) => t.name === "describe_widgets").handler({});
  const widgets = described.widgets;

  // The protocol sections are the same on every widget that has them; say
  // them once, with the button's defaults, and per widget only what is its own.
  const button = widgets.find((w) => w.widget === "oscar-button");
  const sections = ["osc", "dmx", "midi"];
  const shared = {};
  for (const sec of sections) shared[sec] = button.settings.filter((s) => s.section === sec);
  const sharedKeys = new Set(Object.values(shared).flat().map((s) => s.key));

  const out = [];
  out.push("# OSCAR widgets, as an interface writes them");
  out.push("");
  out.push("Generated from OSCAR's own widget registry by `scripts/build-skill-widgets.js`. Do not edit by hand. With OSCAR running, the `describe_widgets` tool gives the same list for the version actually installed; this file is for when it is not.");
  out.push("");
  out.push("## The document");
  out.push("");
  out.push(described.howto);
  out.push("");
  out.push("Rules the validator holds you to:");
  out.push("");
  out.push("- A setting is written as a `data-gjs-*` attribute in kebab case: setting `valueOn` is `data-gjs-value-on`. Booleans are the strings `\"true\"` and `\"false\"`.");
  out.push("- Every widget needs a unique `id`. Every element gets `data-gjs-dmode=\"flow\"`.");
  out.push("- A widget is recognised by its tag and the attributes in its row below: any `<button>` is a button, any `<input type=\"range\">` a slider. Keep those attributes exactly.");
  out.push("- `<body data-osc-style=\"own\">` says the page brings its own look. Without it the editor's current widget style dresses the controls.");
  out.push("- `data-gjs-enabled` (Master comms, default `true`) is on every widget: `\"false\"` makes it deaf and silent on every protocol, for laying out while the rig is live.");
  out.push("- A widget's own `data-gjs-*` settings are the ones in its table. The OSC, DMX and MIDI sections below apply to every widget whose row says it sends, receives or does DMX.");
  out.push("");
  out.push("## Widgets");
  out.push("");
  out.push("| Widget | Tag and attributes | Sends | Receives | DMX |");
  out.push("| --- | --- | --- | --- | --- |");
  for (const w of widgets) {
    const attrs = Object.entries(w.attributes).map(([k, v]) => ` ${k}="${v}"`).join("");
    out.push(`| ${w.widget} | \`<${w.tag}${attrs}>\` | ${w.sends ? "yes" : "no"} | ${w.receives ? "yes" : "no"} | ${w.dmx ? "yes" : "no"} |`);
  }
  out.push("");

  for (const w of widgets) {
    const own = w.settings.filter((s) => !s.section && !sharedKeys.has(s.key) && s.key !== "enabled");
    const attrs = Object.entries(w.attributes).map(([k, v]) => ` ${k}="${v}"`).join("");
    out.push(`### ${w.widget}`);
    out.push("");
    out.push(`Tag: \`<${w.tag}${attrs} id="..." data-gjs-dmode="flow" ...>\`${w.text ? `. The ${w.text} is the element's text content.` : ""}`);
    out.push("");
    const protocolDefaults = Object.entries(w.defaults)
      .filter(([k]) => ["message", "port", "argType"].includes(k))
      .map(([k, v]) => `\`${attr(k)}="${show(v).replace(/^"|"$/g, "")}"\``)
      .join(", ");
    if (protocolDefaults) out.push(`Defaults on the wire: ${protocolDefaults}.`);
    out.push("");
    if (own.length) {
      out.push(table(own, w.defaults));
      out.push("");
    }
  }

  const names = { osc: "OSC section", dmx: "DMX section", midi: "MIDI section" };
  const notes = {
    osc: "On every widget that sends or receives. `data-gjs-osc-enabled` is Data out (on by default), `data-gjs-listen` is Data in (off by default). `data-gjs-ip`, `data-gjs-port` and `data-gjs-message` are the destination; the same message address is what Data in follows.",
    dmx: "On every widget whose row says DMX. Off until `data-gjs-dmx-enabled=\"true\"`. A slider sends 0-255 across its own range, a button full and out, a pad X then Y, a colour red, green, blue; `data-gjs-dmx-count` is how many channels from `data-gjs-dmx-channel`.",
    midi: "On every widget that sends or receives. Off until `data-gjs-midi-enabled=\"true\"` (out) or `data-gjs-midi-listen=\"true\"` (in). A slider sends 0-127 across its range; a widget with several values uses the numbers that follow `data-gjs-midi-number`.",
  };
  for (const sec of sections) {
    out.push(`## ${names[sec]}`);
    out.push("");
    out.push(notes[sec]);
    out.push("");
    out.push(table(shared[sec], button.defaults));
    out.push("");
  }
  return out.join("\n");
}

async function main() {
  const text = await render();
  const check = process.argv.includes("--check");
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : null;
  if (check) {
    if (current !== text) {
      console.error("skills/oscar/references/widgets.md is out of date: run `npm run build:skill`");
      process.exit(1);
    }
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log("wrote " + path.relative(process.cwd(), OUT) + " (" + text.length + " bytes)");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { render, OUT };
