"use strict";

/**
 * The MCP tools: OSCAR for AI assistants, levels one and two.
 *
 * Level one reads and diagnoses -- projects, published interfaces, ports,
 * the recent network activity -- and changes nothing. Level two builds: an
 * interface written as HTML is judged by the widgets' own validators
 * (validate.js) and saved as a draft the person reviews from File > Open.
 * Nothing here touches the wire: no tool sends OSC, MIDI or DMX, and a
 * draft does nothing until a person opens it, looks at it, and publishes it
 * themselves. Operating a show is deliberately absent; it is a later,
 * separate decision.
 *
 * The words are the app's own, because an assistant repeats them to the
 * person: a project is what is edited, a published interface is the live
 * copy phones open, a draft is what an assistant wrote. (The code's older
 * word for an interface, "surface", stays in the code.)
 *
 * Everything is dependency-injected and returns plain values, so the tests
 * hold the tools without the protocol (test/mcp.test.js); lib/mcp/http.js
 * dresses them in MCP, and createwithoscar/ carries a copy of their
 * descriptions for when OSCAR is not running (npm run build:mcp).
 */

const { z } = require("zod");
const { WIDGETS } = require("../widgets");
const { allWidgetsIn } = require("../surfaces");
const { validateSurface, stampFlow } = require("./validate");
const { widgetsInProject } = require("./project");
const { installationMap } = require("./installation");
const { slugify } = require("../projects");

/**
 * What an assistant is told once, as it connects: what OSCAR is, the words
 * to use with the person, and the order the tools are meant to be used in.
 */
const INSTRUCTIONS =
  "OSCAR is an editor and a server for control interfaces: pages of buttons, sliders and other widgets that phones " +
  "and tablets open in a browser, and that send OSC, MIDI and DMX to show software, instruments and lights. " +
  "Use the app's words with the person: a project is what they edit in OSCAR (File > Open lists them); a published " +
  "interface is the live copy of a project that phones open; a draft is an interface you wrote for them to review. " +
  "Start with status. To find why something does not respond: installation_map for everything the published " +
  "interfaces send to and listen for and what this computer has plugged in, read_published for one interface's " +
  "controls (or read_project for a project that is not published), then recent_activity for what was actually sent " +
  "and received. To build: installation_map to see the gear that is here, describe_widgets, then " +
  "validate_draft until it is clean, then create_draft, and tell the person to open the draft from File > Open, " +
  "where it carries a Draft badge, check it, and publish it themselves. No tool here sends anything to the rig, " +
  "publishes, or changes a project: if asked to operate the show, say that OSCAR does not let an assistant do that.";

/** What describe_widgets says about writing an interface, once, at the top. */
const HOWTO =
  "An interface is one HTML document: <!doctype html>, a <title> (its name in File > Open), styles in <style>, " +
  "and the widgets in <body>. A widget is its tag with class and attributes as listed here, a unique id, and " +
  'settings as data-gjs-* attributes: setting minX is written data-gjs-min-x="0". Anything not set uses the default. ' +
  "Widgets are positioned and sized with ordinary CSS. Give every element data-gjs-dmode=\"flow\" -- the editor " +
  "drags in absolute mode, and a part without it is pulled out of the layout when touched (create_draft adds it " +
  "where missing). Validate with validate_draft until ok, then create_draft " +
  "saves it as a draft; a person reviews it in the editor and decides whether it ever goes near the rig.";

/**
 * What a tool may do, said the way MCP says it, so an assistant's app knows
 * which calls only look. OSCAR is the only thing any of them talks to.
 */
const READS = { readOnlyHint: true, openWorldHint: false };
// Adds a file to the drafts; replaces one only when asked to, and only a
// draft: never a project, never anything published.
const WRITES_A_DRAFT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

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
 *   draftsDir         where create_draft writes, listed in File > Open
 *   addresses         () => [{ name, address }], this computer's network addresses
 *   oscIn             () => { port, listening, why }, whether OSCAR hears OSC
 *   serialPorts       () => Promise<[{ path, manufacturer, vendorId }]>, the USB serial ports
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
        "locked, the MIDI driver's condition, and how many projects and published interfaces there are. Start here.",
      schema: {},
      annotations: READS,
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
      title: "The projects in OSCAR",
      description:
        "Every project OSCAR holds, with its id and its title, as File > Open lists them. A project is what a person " +
        "edits; it reaches phones only once it is published (list_published).",
      schema: {},
      annotations: READS,
      async handler() {
        return { projects: await deps.store.list() };
      },
    },

    {
      name: "read_project",
      title: "A project's widgets",
      description:
        "Every widget in one project, published or not, with its full settings as the editor holds them: addresses, " +
        "ports, channels, MIDI mappings, DMX targets. Also says where the project is published, if it is. A setting " +
        "nobody touched reads as its default. What phones see is the published copy, which may be older: " +
        "read_published reads that one.",
      schema: { project: z.string().min(1).describe("The project's id, or its title, as list_projects gives them") },
      annotations: READS,
      async handler(args) {
        const wanted = String(args.project).trim();
        const rows = await deps.store.list();
        let row = rows.find((r) => r.id === wanted || r._id === wanted);
        if (!row) {
          const named = rows.filter((r) => String(r.name || "").toLowerCase() === wanted.toLowerCase());
          if (named.length > 1) {
            return {
              error: "More than one project is called " + JSON.stringify(wanted) + ". Ask again with the id of the one you mean.",
              projects: named.map((r) => ({ id: r.id || r._id, name: r.name, date: r.date })),
            };
          }
          row = named[0];
        }
        const found = row ? await deps.store.readById(row.id || row._id) : null;
        if (!found) return { error: "There is no project called " + JSON.stringify(wanted) + ". list_projects names them." };

        const pages = deps.published ? await deps.published.list() : [];
        return {
          project: found.id,
          name: found.name,
          updatedAt: found.updatedAt,
          published: pages
            .filter((page) => page.project === found.id)
            .map((page) => ({ id: page.id, path: "/show/" + page.id, access: page.access || "network" })),
          widgets: widgetsInProject(found.record && found.record.data),
        };
      },
    },

    {
      name: "list_published",
      title: "The published interfaces",
      description:
        "Every published interface: its name, the project it was published from, the path it is served at, who can " +
        "open it (access: \"network\", or \"off\" for one no device can open, whose schedules and bridges still run), " +
        "and how many widgets it holds. Published interfaces are live -- phones and tablets may be on them, and the " +
        "rig hears them.",
      schema: {},
      annotations: READS,
      async handler() {
        const rows = [];
        for (const page of await deps.published.list()) {
          const html = await deps.published.read(page.id);
          rows.push({
            id: page.id,
            name: page.name || page.id,
            project: page.project || null,
            path: "/show/" + page.id,
            access: page.access || "network",
            widgets: html === null ? 0 : allWidgetsIn(html).length,
          });
        }
        return { published: rows };
      },
    },

    {
      name: "read_published",
      title: "A published interface's widgets",
      description:
        "Every widget on one published interface, with its full settings as phones have them: addresses, ports, " +
        "channels, MIDI mappings, DMX targets. For answering why something does or does not respond.",
      schema: { id: z.string().min(1).describe("The published interface's id, as list_published names it") },
      annotations: READS,
      async handler(args) {
        const html = await deps.published.read(String(args.id));
        if (html === null) return { error: "There is no published interface called " + JSON.stringify(args.id) + ". list_published names them." };
        return {
          id: args.id,
          widgets: allWidgetsIn(html).map((w) => ({ id: w.id, widget: w.widget, config: w.config })),
        };
      },
    },

    {
      name: "installation_map",
      title: "The installation, as OSCAR knows it",
      description:
        "One picture of the whole installation: this computer's network addresses and ports, its MIDI ports and USB " +
        "interfaces (a USB DMX interface among them), and everything the published interfaces talk to and listen for " +
        "-- each OSC destination with the addresses sent to it, each MIDI port with its channels and controllers, " +
        "each DMX output with its universe and channels -- with the control and interface behind every one. notices " +
        "lists what does not add up: a MIDI port or USB interface that is not there, OSC followed while OSCAR " +
        "cannot listen, two controls on the same DMX channels. It is worked out from settings and sends nothing onto " +
        "the network: it says where OSCAR sends, not whether anything is there to hear it.",
      schema: {},
      annotations: READS,
      async handler() {
        const surfaces = [];
        for (const page of deps.published ? await deps.published.list() : []) {
          const html = await deps.published.read(page.id);
          surfaces.push({
            id: page.id,
            name: page.name || page.id,
            access: page.access || "network",
            widgets: html === null ? [] : allWidgetsIn(html).map((w) => ({ id: w.id, widget: w.widget, config: w.config })),
          });
        }
        let serialPorts = [];
        try {
          serialPorts = deps.serialPorts ? await deps.serialPorts() : [];
        } catch {
          serialPorts = [];
        }
        return installationMap({
          surfaces,
          addresses: deps.addresses ? read(deps.addresses) : [],
          ports: { http: read(deps.httpPort), socket: read(deps.socketPort) },
          oscIn: deps.oscIn ? read(deps.oscIn) : { port: read(deps.oscInPort), listening: true },
          midi: deps.midi ? deps.midi.ports() : { supported: false, reason: "No MIDI in this OSCAR.", outputs: [], inputs: [] },
          serialPorts,
        });
      },
    },

    {
      name: "midi_ports",
      title: "The MIDI ports",
      description: "The MIDI inputs and outputs this machine has right now, and the driver's condition.",
      schema: {},
      annotations: READS,
      async handler() {
        return deps.midi ? deps.midi.ports() : { supported: false, reason: "No MIDI in this OSCAR.", outputs: [], inputs: [] };
      },
    },

    {
      name: "recent_activity",
      title: "What the server has lately done",
      description:
        "The network log's recent rows: what OSCAR's server actually received and sent, oldest first, repeats " +
        "within a moment gathered into one row with a count n. Each row has what (OSC address, MIDI control, DMX " +
        "universe and channels) and value (what the latest carried). Incoming rows: device (the sender's address, " +
        "or the MIDI port), surfaces (published interfaces that follow it), canvas (the editor's canvas followed it); " +
        "with neither, nothing follows it. Outgoing rows: to (where it went), origin (whose move: canvas, local, " +
        "internet, schedule, bridge), surface (the published interface) and widget. dropped, on either, says why it " +
        "was refused. The first place to look when something moves that should not, or does not move when it should.",
      schema: { limit: z.number().int().min(1).max(200).optional().describe("How many of the newest rows (default 50)") },
      annotations: READS,
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
        "plus how an interface is written as HTML. Read this before building one.",
      schema: {},
      annotations: READS,
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
      name: "validate_draft",
      title: "Judge a draft",
      description:
        "Run an interface written as HTML through the widgets' own validators: unknown settings, values their panels " +
        "would refuse, missing or repeated ids. Returns the complaints to correct. Nothing is saved.",
      schema: { html: z.string().max(2 * 1024 * 1024).describe("The whole HTML document") },
      annotations: READS,
      async handler(args) {
        return validateSurface(args.html);
      },
    },

    {
      name: "create_draft",
      title: "Save a draft for the person to review",
      description:
        "Validate an interface and, if it is clean, save it as a draft: it appears in OSCAR under File > Open, with a " +
        "Draft badge. It is a file for a person to review: nothing is published, nothing is sent, and no project is " +
        "changed. An existing draft of the same name is only replaced when overwrite is true.",
      schema: {
        name: z.string().min(1).max(80).describe("The draft's name, shown in File > Open"),
        html: z.string().max(2 * 1024 * 1024).describe("The whole HTML document"),
        overwrite: z.boolean().optional().describe("Replace an existing draft of the same name"),
      },
      annotations: WRITES_A_DRAFT,
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

        // File > Open shows the <title>; a document without one gets the
        // draft's name, so it never lists as a bare file name.
        let html = String(args.html);
        if (!/<title[^>]*>[^<]*\S[^<]*<\/title>/i.test(html)) {
          const title = "<title>" + String(args.name).replace(/</g, "&lt;") + "</title>";
          html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + title) : title + "\n" + html;
        }
        // Every element dragged in flow, as OSCAR's own templates are: in the
        // editor's absolute mode an unstamped part is pulled out of the
        // layout the moment a handle touches it.
        html = stampFlow(html);
        fs.writeFileSync(file, html, "utf8");
        return {
          saved: true,
          draft: id,
          widgets: judged.widgets,
          warnings: judged.warnings,
          next: "The person opens it in OSCAR from File > Open, where it is listed with a Draft badge, reviews it in the editor, and decides what happens next.",
        };
      },
    },
  ];
}

module.exports = { buildTools, HOWTO, INSTRUCTIONS };
