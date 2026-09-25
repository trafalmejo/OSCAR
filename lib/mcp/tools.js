"use strict";

/**
 * The MCP tools: OSCAR for AI assistants, levels one and two.
 *
 * Level one reads and diagnoses -- projects, published surfaces, ports, the
 * recent network activity -- and changes nothing. Level two builds: a
 * surface written as HTML is judged by the widgets' own validators
 * (validate.js) and saved as a draft the person reviews in the editor's
 * Load list. Nothing here touches the wire: no tool sends OSC, MIDI or DMX,
 * and a draft does nothing until a person opens it, looks at it, and
 * publishes it themselves. Operating a show is deliberately absent; it is a
 * later, separate decision.
 *
 * Everything is dependency-injected and returns plain values, so the tests
 * hold the tools without the protocol (test/mcp.test.js); lib/mcp/http.js
 * dresses them in MCP.
 */

const { z } = require("zod");
const { WIDGETS } = require("../widgets");
const { allWidgetsIn } = require("../surfaces");
const { validateSurface } = require("./validate");
const { slugify } = require("../projects");

/** What describe_widgets says about writing a surface, once, at the top. */
const HOWTO =
  "A surface is one HTML document: <!doctype html>, a <title> (its name in the Load list), styles in <style>, " +
  "and the widgets in <body>. A widget is its tag with class and attributes as listed here, a unique id, and " +
  'settings as data-gjs-* attributes: setting minX is written data-gjs-min-x="0". Anything not set uses the default. ' +
  "Widgets are positioned and sized with ordinary CSS. Validate with validate_surface until ok, then create_surface " +
  "saves it as a draft; a person reviews it in the editor and decides whether it ever goes near the rig.";

/**
 * @param {object} deps
 *   version           OSCAR's version string
 *   features          the feature switches (lib/features.js)
 *   httpPort, oscInPort, socketPort   numbers (or functions returning them)
 *   store             ProjectStore (lib/projects.js)
 *   published         PublishedStore (lib/published.js)
 *   midi              the MIDI surface (ports(), status())
 *   liveLog           () => recent activity rows, as the network log holds them
 *   lock              { isLocked() } or null
 *   draftsDir         where create_surface writes, served in the Load list
 *   fs                node:fs (injectable for tests)
 *   path              node:path
 */
function buildTools(deps) {
  const read = (v) => (typeof v === "function" ? v() : v);
  const fs = deps.fs || require("node:fs");
  const path = deps.path || require("node:path");

  return [
    {
      name: "status",
      title: "What this OSCAR is",
      description:
        "OSCAR's version, its ports (HTTP, the fixed OSC listening port, the socket bridge), whether editing is " +
        "locked, the MIDI driver's condition, and how many projects and published surfaces there are. Start here.",
      schema: {},
      async handler() {
        const pages = deps.published ? await deps.published.list() : [];
        const projects = deps.store ? await deps.store.list() : [];
        return {
          version: deps.version,
          ports: { http: read(deps.httpPort), oscIn: read(deps.oscInPort), socket: read(deps.socketPort) },
          locked: !!(deps.lock && deps.lock.isLocked()),
          features: deps.features,
          midi: deps.midi ? deps.midi.status() : { supported: false, reason: "No MIDI in this OSCAR." },
          published: pages.length,
          projects: projects.length,
        };
      },
    },

    {
      name: "list_projects",
      title: "The saved projects",
      description: "Every project in the projects folder, by name. These are editor documents, not live surfaces.",
      schema: {},
      async handler() {
        return { projects: await deps.store.list() };
      },
    },

    {
      name: "list_published",
      title: "The published surfaces",
      description:
        "Every surface OSCAR is serving right now: its name, the path it is served at, and how many widgets it " +
        "holds. Published surfaces are live -- phones and tablets may be on them, and the rig hears them.",
      schema: {},
      async handler() {
        const rows = [];
        for (const page of await deps.published.list()) {
          const html = await deps.published.read(page.id);
          rows.push({ id: page.id, path: "/show/" + page.id, widgets: html === null ? 0 : allWidgetsIn(html).length });
        }
        return { published: rows };
      },
    },

    {
      name: "read_surface",
      title: "A published surface's widgets",
      description:
        "Every widget on one published surface, with its full settings: addresses, ports, channels, MIDI mappings, " +
        "DMX targets. For answering why something does or does not respond.",
      schema: { surface: z.string().describe("The published surface's id, as list_published names it") },
      async handler(args) {
        const html = await deps.published.read(String(args.surface));
        if (html === null) return { error: "There is no published surface called " + JSON.stringify(args.surface) + "." };
        return {
          surface: args.surface,
          widgets: allWidgetsIn(html).map((w) => ({ id: w.id, widget: w.widget, config: w.config })),
        };
      },
    },

    {
      name: "midi_ports",
      title: "The MIDI ports",
      description: "The MIDI inputs and outputs this machine has right now, and the driver's condition.",
      schema: {},
      async handler() {
        return deps.midi ? deps.midi.ports() : { supported: false, reason: "No MIDI in this OSCAR.", outputs: [], inputs: [] };
      },
    },

    {
      name: "recent_activity",
      title: "What the server has lately done",
      description:
        "The network log's recent rows: what OSCAR consumed for published surfaces (OSC addresses, MIDI messages) " +
        "and what it sent on their behalf, each naming its surface, with repeats coalesced into counts. The first " +
        "place to look when something moves that should not, or does not move when it should.",
      schema: { limit: z.number().int().min(1).max(200).optional().describe("How many of the newest rows (default 50)") },
      async handler(args) {
        const rows = deps.liveLog ? deps.liveLog() : [];
        return { activity: rows.slice(-(args.limit || 50)) };
      },
    },

    {
      name: "describe_widgets",
      title: "The widgets and how to write them",
      description:
        "Every widget OSCAR has -- tag, attributes, defaults, and each setting with its type, options and meaning -- " +
        "plus how a surface is written as HTML. Read this before building one.",
      schema: {},
      async handler() {
        return {
          howto: HOWTO,
          widgets: WIDGETS.map((w) => ({
            widget: w.name,
            tag: w.tag,
            attributes: w.attributes || {},
            sends: !!w.sends,
            receives: !!w.receives,
            dmx: !!w.dmx,
            defaults: w.defaults,
            settings: (w.fields || []).map((f) => ({
              key: f.key,
              label: f.label,
              type: f.type,
              section: f.section,
              dir: f.dir,
              options: f.options,
              hint: f.hint,
            })),
          })),
        };
      },
    },

    {
      name: "validate_surface",
      title: "Judge a surface",
      description:
        "Run a surface written as HTML through the widgets' own validators: unknown settings, values their panels " +
        "would refuse, missing or repeated ids. Returns the complaints to correct. Nothing is saved.",
      schema: { html: z.string().max(2 * 1024 * 1024).describe("The whole HTML document") },
      async handler(args) {
        return validateSurface(args.html);
      },
    },

    {
      name: "create_surface",
      title: "Save a surface as a draft",
      description:
        "Validate a surface and, if it is clean, save it as a draft in the editor's Load list (under the name " +
        "Assistant drafts). It is a file for a person to review: nothing is published and nothing is sent. An " +
        "existing draft of the same name is only replaced when overwrite is true.",
      schema: {
        name: z.string().min(1).max(80).describe("The draft's name, shown in the Load list"),
        html: z.string().max(2 * 1024 * 1024).describe("The whole HTML document"),
        overwrite: z.boolean().optional().describe("Replace an existing draft of the same name"),
      },
      async handler(args) {
        const judged = validateSurface(args.html);
        if (!judged.ok) return Object.assign({ saved: false }, judged);

        const id = slugify(String(args.name));
        if (!id) return { saved: false, problems: ["That name leaves nothing once made into a file name."] };
        fs.mkdirSync(deps.draftsDir, { recursive: true });
        const file = path.join(deps.draftsDir, id + ".html");
        if (!args.overwrite && fs.existsSync(file)) {
          return { saved: false, problems: ["A draft called " + JSON.stringify(id) + " already exists. Pass overwrite: true to replace it."] };
        }

        // The Load list shows the <title>; a document without one gets the
        // draft's name, so it never lists as a bare file name.
        let html = String(args.html);
        if (!/<title[^>]*>[^<]*\S[^<]*<\/title>/i.test(html)) {
          const title = "<title>" + String(args.name).replace(/</g, "&lt;") + "</title>";
          html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + title) : title + "\n" + html;
        }
        fs.writeFileSync(file, html, "utf8");
        return {
          saved: true,
          draft: id,
          widgets: judged.widgets,
          warnings: judged.warnings,
          next: "A person opens it in OSCAR's Load window (listed under Assistant drafts), reviews it in the editor, and decides what happens next.",
        };
      },
    },
  ];
}

module.exports = { buildTools, HOWTO };
