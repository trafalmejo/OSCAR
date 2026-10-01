"use strict";

const express = require("express");

const { openProject, stripEditorState, isProjectId, projectIdOf, isGrapesProject } = require("../lib/project-format");
const { isLoopbackAddress } = require("../lib/net");
const { buildExport } = require("../lib/export");
const { markServed, rebake } = require("../lib/published");
const { readConnection } = require("../lib/export/connection");
const { surfaceStamp } = require("../lib/export/stamp");
const { allWidgetsIn } = require("../lib/surfaces");

// Where an export finds its runtime, and the only folder it may inline from.
const PUBLIC_DIR = require("path").join(__dirname, "..", "public");
const { listTemplates } = require("../lib/templates");
const { none: noExtensions } = require("../lib/extensions");
const { embedJson } = require("../lib/export/document");

// What a phone is shown at the address of a surface that is switched off.
// Plain and whole: nothing of the surface, no script, nothing to connect.
const OFF_PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  "<title>Switched off</title><style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;" +
  "background:#111;color:#ddd;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}</style></head>" +
  "<body><p>This interface is switched off.<br>Ask whoever runs it to switch it on, then reload.</p></body></html>";

// Keys grapesjs sends alongside the project payload that are OSCAR's own
// bookkeeping rather than editor content.
const META_KEYS = new Set(["name", "overwrite", "visibility", "grapesjs"]);

/**
 * @param {object} deps
 * @param {import('../lib/projects').ProjectStore} deps.store
 * @param {() => string} deps.serverIP
 * @param {import('../lib/published').PublishedStore} [deps.published] - surfaces OSCAR serves itself
 * @param {string} [deps.templatesDir] - where the templates in the Load list live
 * @param {{ check: () => Promise<object> }} [deps.updates] - update checker
 * @param {object} [deps.serial] - serialControl() from lib/serial.js
 * @param {{ runtime?: string, socketio?: string, widgetCss?: string|string[] }} [deps.exportFiles] -
 *        where POST /export reads its pieces from, for a test that has no build output
 */
module.exports = function createRouter({
  store,
  serverIP,
  socketPort,
  oscInPort,
  midiPorts,
  updates,
  diagnostics,
  onPreviewPush,
  lock,
  serial,
  exportFiles,
  published,
  onPublishedChanged,
  devicesOn,
  liveLog,
  takeBootFile,
  telemetryState,
  templatesDir,
  draftsDir,
  mcp,
  extensions,
}) {
  const router = express.Router();

  // What an extension adds to a page (lib/extensions.js): the feature
  // switches as they stand, and for the editor, the files to load after
  // OSCAR's own. With no extensions this is the defaults and two empty lists.
  function pageData(withAssets) {
    const found = extensions || noExtensions();
    const assets = withAssets ? found.editorAssets() : { scripts: [], styles: [] };
    return { oscarFeatures: embedJson(found.features()), extensionScripts: assets.scripts, extensionStyles: assets.styles };
  }

  // ---- locked mode --------------------------------------------------------
  // When OSCAR is locked, the control surface stays open to the network and
  // the editor answers only the machine OSCAR runs on. Physical access to that
  // machine is the credential: no passwords to leak over a venue's plain-HTTP
  // network, and nothing to forget before doors open.
  //
  // This stops editing, not sending: the OSC bridge has to stay reachable or
  // no tablet could drive anything.
  const isLocked = () => !!(lock && lock.isLocked());
  const isLocal = (req) => isLoopbackAddress(req.socket && req.socket.remoteAddress);

  function editorOnly(req, res, next) {
    if (!isLocked() || isLocal(req)) return next();
    res.status(403).json({
      error: "OSCAR is locked. It can only be edited on the computer running it.",
    });
  }

  // The live preview payload is deliberately in-memory: it is a scratch copy
  // of the canvas handed from the editor tab to the preview tab.
  let preview = null;

  router.get("/", (req, res) => {
    // Send a locked-out visitor to the control surface rather than an error.
    if (isLocked() && !isLocal(req)) return res.redirect("/preview");
    res.render("index", pageData(true));
  });

  // Is OSCAR locked, and may this device change that?
  router.get("/lock", (req, res) =>
    res.json({ locked: isLocked(), canToggle: isLocal(req) })
  );

  router.post("/lock", (req, res) => {
    if (!isLocal(req)) {
      return res.status(403).json({
        error: "Only the computer running OSCAR can lock or unlock it.",
      });
    }
    if (!lock) return res.json({ locked: false });
    lock.setLocked(!!(req.body && req.body.locked));
    res.json({ locked: isLocked() });
  });
  router.get("/preview", (req, res) => res.render("preview", pageData(false)));

  // Where the browser should reach OSCAR. The OSC bridge does not always
  // listen on 8081 -- OSCAR_SOCKET_PORT moves it, and a second instance on the
  // same machine has to -- so the port is reported rather than assumed.
  router.get("/connection", (req, res) =>
    res.json({
      address: serverIP(),
      socketPort: socketPort ? socketPort() : 8081,
      // The one port OSCAR hears OSC on, so the editor can say it.
      oscInPort: oscInPort ? oscInPort() : null,
    })
  );

  // Kept for anything written against older OSCARs.
  router.get("/ipserver", (req, res) => res.send(serverIP()));

  // Version details for the "Report a problem" button. Nothing identifying:
  // just what a bug report always has to ask for anyway.
  //
  // Open to every device, locked or not, because /preview may want to report
  // a problem too. That is why the serial port's name and its last error --
  // which quotes the name -- are held back from anyone editorOnly would turn
  // away: they are told whether there is a board, not where it is.
  router.get("/diagnostics", (req, res) => {
    const report = diagnostics ? diagnostics() : {};
    if (report.serial && typeof report.serial === "object" && isLocked() && !isLocal(req)) {
      report.serial = Object.assign({}, report.serial, { path: null, error: null });
    }
    // MIDI ports are named after the hardware plugged in. The same people are
    // told how many there are, not what they are.
    if (report.midi && typeof report.midi === "object" && isLocked() && !isLocal(req)) {
      const count = (list) => (Array.isArray(list) ? list.map(() => null) : []);
      report.midi = Object.assign({}, report.midi, {
        outputs: count(report.midi.outputs),
        inputs: count(report.midi.inputs),
        open: count(report.midi.open),
        // Quotes the port it could not find.
        error: report.midi.error ? "hidden" : null,
      });
    }
    res.json(report);
  });

  // Is a newer OSCAR out? Answers { available: false } when the check is
  // switched off, offline, or already up to date -- the editor treats every
  // one of those the same way, by saying nothing.
  router.get("/update", async (req, res) => {
    if (!updates) return res.json({ available: false });
    try {
      res.json(await updates.check());
    } catch (err) {
      console.error("Update check failed:", err.message);
      res.json({ available: false });
    }
  });

  // ---- MIDI ---------------------------------------------------------------
  // The ports this computer has, for the Port setting to suggest from. Behind
  // editorOnly: it is only of use while editing, and the names are hardware.
  router.get("/midi/ports", editorOnly, (req, res) => {
    res.json(midiPorts ? midiPorts() : { supported: false, reason: null, outputs: [], inputs: [] });
  });

  // ---- The serial cable -------------------------------------------------
  // Behind editorOnly, unlike the OSC bridge: choosing which port the board
  // is on is editing the installation, not driving it. A tablet on a locked
  // OSCAR can still send to the board -- that goes over the socket -- but it
  // cannot point the cable somewhere else or let go of it mid-show.
  const NO_SERIAL = {
    supported: false,
    reason: "No serial support in this build of OSCAR.",
    state: "idle",
    path: null,
    error: null,
  };

  async function serialReport() {
    if (!serial) return Object.assign({ ports: [] }, NO_SERIAL);
    // Listed before the status is read, so a failure to list shows up in it.
    const ports = await serial.list();
    return Object.assign({}, serial.status(), { ports: ports });
  }

  router.get("/serial", editorOnly, async (req, res) => {
    try {
      res.json(await serialReport());
    } catch (err) {
      console.error("Could not read the serial ports:", err.message);
      res.status(500).json({ error: "Could not read the serial ports" });
    }
  });

  // { action: "connect", path, bitrate? } or { action: "disconnect" }.
  router.post("/serial", editorOnly, async (req, res) => {
    const body = req.body || {};
    try {
      if (body.action !== "connect" && body.action !== "disconnect") {
        return res.status(400).json({ error: "Say whether to connect or disconnect." });
      }
      if (!serial) return res.status(400).json(Object.assign({ ports: [] }, NO_SERIAL, { error: NO_SERIAL.reason }));

      let complaint = null;
      if (body.action === "connect") complaint = serial.connect(body.path, body.bitrate);
      else serial.disconnect();

      const report = await serialReport();
      if (complaint) return res.status(400).json(Object.assign(report, { error: complaint }));
      res.json(report);
    } catch (err) {
      console.error("Could not change the serial port:", err.message);
      res.status(500).json({ error: "Could not change the serial port" });
    }
  });

  // ---- Preview hand-off -------------------------------------------------
  router.post("/save/preview", editorOnly, (req, res) => {
    preview = req.body && req.body.project ? req.body.project : req.body;
    // Tell any open preview pages to pick it up. Without this a tablet keeps
    // showing the previous push until someone reloads it by hand.
    if (onPreviewPush) onPreviewPush();
    res.json({ msg: "Preview updated" });
  });

  router.get("/show/preview", (req, res) => res.json(preview || {}));

  // ---- Export ------------------------------------------------------------
  // The editor sends the first page's markup, each widget's settings written
  // into it, and the stylesheet; lib/export wraps them around the standalone
  // runtime and answers with one file that works on its own. Editor-only: a
  // locked OSCAR hands its layout to nobody but the machine it runs on.
  router.post("/export", editorOnly, (req, res) => {
    let result;
    try {
      result = buildExport(req.body, {
        publicDir: PUBLIC_DIR,
        files: exportFiles,
        oscarVersion: diagnostics ? diagnostics().oscar : undefined,
      });
    } catch (err) {
      console.error("Could not build the export:", err.message);
      return res.status(500).json({ error: "Your interface could not be exported." });
    }
    if (result.error) return res.status(result.status).json({ error: result.error });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="' + result.filename + '"');
    // For the dialog: which files were too large to embed. Encoded, because
    // a header carries ASCII and a filename need not be.
    res.setHeader("X-Oscar-Linked-Assets", encodeURIComponent(JSON.stringify(result.linked.slice(0, 20))));
    res.send(result.page);
  });

  // ---- Published surfaces -------------------------------------------------
  // The same file an export downloads, kept where OSCAR can serve it. A phone
  // cannot open a downloaded page (lib/published.js says why); it can open an
  // address. Publishing and unpublishing are editing. Opening one is driving
  // the show, so it stays reachable while OSCAR is locked, as /preview does.
  function buildPage(req, body) {
    return buildExport(body || req.body, {
      publicDir: PUBLIC_DIR,
      files: exportFiles,
      oscarVersion: diagnostics ? diagnostics().oscar : undefined,
    });
  }

  router.post("/publish", editorOnly, async (req, res) => {
    if (!published) return res.status(503).json({ error: "This OSCAR cannot publish surfaces." });
    // Nobody is asked where OSCAR is when publishing: the page is served by
    // OSCAR and finds it by the address it was opened at. What is baked into
    // the stored file is OSCAR's own address, which is the honest answer if
    // the file is ever copied off and opened somewhere else. A caller that
    // does name one is ignored for the same reason a typo there must not
    // matter. Only an OSCAR that cannot say where it is falls back on it.
    const own = { host: serverIP ? serverIP() : "", port: socketPort ? socketPort() : "" };
    const body = Object.assign({}, req.body, own.host && own.port ? { connection: own } : null);

    let result;
    try {
      result = buildPage(req, body);
    } catch (err) {
      console.error("Could not build the surface to publish:", err.message);
      return res.status(500).json({ error: "Your interface could not be published." });
    }
    if (result.error) return res.status(result.status).json({ error: result.error });

    const name = (req.body && (req.body.fileName || req.body.title)) || "";
    const address = published.idFor(name);
    if (!address) {
      return res.status(400).json({ error: '"' + name + '" is a name OSCAR uses itself. Pick another.' });
    }

    // Which project this is, and the project itself: kept beside the page,
    // so the surface can be found, edited and published again as that
    // project (lib/published.js). A project that cannot be opened again is
    // not worth keeping as the copy to edit from.
    const said = req.body && req.body.project;
    const project = said && typeof said === "object" && isProjectId(said.id) ? { id: said.id, name: typeof said.name === "string" && said.name.trim() ? said.name.trim().slice(0, 200) : address } : null;
    const source = project && req.body.source && openProject(req.body.source).status === "ok" ? req.body.source : null;

    try {
      // An address that is in use is replaced without a word only by the
      // project that is there. Anything else -- another project, or a page
      // published before OSCAR kept track -- is somebody's running show:
      // the editor asks first, and says `replace` when the answer was yes.
      if (req.body.replace !== true && (await published.exists(address))) {
        const standing = await published.record(address);
        const theirs = standing && standing.project ? standing.project : null;
        if (!project || !theirs || theirs.id !== project.id) {
          return res.json({
            confirm: "There is already an interface at /show/" + address + (theirs && theirs.name ? ', published from "' + theirs.name + '"' : "") + ". Replace it?",
            address,
          });
        }
      }
      // The stamp of what the editor sent, not of the page built from it:
      // building embeds what the page needs (a media browser's pictures go
      // into its settings), so the built page never matches the canvas again
      // and the interface would read as outdated for ever.
      const stamp = surfaceStamp(req.body.html);
      const saved = await published.save(address, result.page, project ? { project, source, stamp } : null);
      res.json({ id: saved.id, path: "/show/" + saved.id, replaced: saved.replaced, linked: result.linked.slice(0, 20) });
    } catch (err) {
      console.error("Could not publish:", err.message);
      res.status(500).json({ error: "The surface could not be saved." });
    }
  });

  // Each row carries the stamp of its widgets (lib/export/stamp.js), so the
  // editor can say when a published copy is older than the canvas. Computed
  // once per published version: the cache key is the file's date and size.
  const stamps = new Map(); // id -> { key, stamp, widgets }
  async function readingOf(page) {
    const key = String(page.date) + "/" + page.size;
    const held = stamps.get(page.id);
    if (held && held.key === key) return held;
    const html = await published.read(page.id);
    const reading = {
      key,
      stamp: html === null ? "" : surfaceStamp(html),
      // Which widget ids are live on this page: what the canvas yields for.
      widgets: html === null ? [] : allWidgetsIn(html).map((entry) => entry.id),
    };
    stamps.set(page.id, reading);
    return reading;
  }

  router.get("/published", editorOnly, async (req, res) => {
    try {
      const pages = published ? await published.list() : [];
      const rows = [];
      for (const page of pages) {
        const reading = await readingOf(page);
        // The stamp written down at publish, when there is one; a page from
        // before that is read for it, as it always was.
        rows.push(
          Object.assign({ path: "/show/" + page.id, widgets: reading.widgets }, page, {
            stamp: page.stamp || reading.stamp,
            // How many devices on this network have it open right now.
            devices: devicesOn ? devicesOn(page.id) : 0,
          })
        );
      }
      res.json(rows);
    } catch (err) {
      console.error("Could not list published surfaces:", err.message);
      res.status(500).json({ error: "Could not read the published surfaces" });
    }
  });

  // A published surface as a file to take elsewhere. A file cannot ask where
  // OSCAR is, so the address is given here and baked in place of OSCAR's own.
  router.get("/published/:id/file", editorOnly, async (req, res) => {
    if (!published) return res.status(503).json({ error: "This OSCAR cannot publish surfaces." });
    const connection = readConnection({ host: req.query.host, port: req.query.port });
    if (connection.error) return res.status(400).json({ error: connection.error });
    const page = await published.read(req.params.id);
    if (page === null) return res.status(404).json({ error: "There is no surface published under that name." });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="' + req.params.id + '.html"');
    res.send(rebake(page, connection));
  });

  // The project a surface was published from, as it was then: what Edit in
  // the Publish window opens. A page with no copy beside it has none.
  router.get("/published/:id/project", editorOnly, async (req, res) => {
    const record = published ? await published.record(req.params.id) : null;
    const source = record ? await published.project(req.params.id) : null;
    if (!record || !record.project || !source) return res.status(404).json({ error: "No project was kept with that interface, so it cannot be edited here." });
    const opened = openProject(source);
    if (opened.status === "too-new") {
      return res.status(409).json({ error: "That interface was published by a newer version of OSCAR" + (opened.savedBy ? " (" + opened.savedBy + ")" : "") + ". Update OSCAR to edit it." });
    }
    if (opened.status !== "ok") return res.status(404).json({ error: "The project kept with that interface cannot be read." });
    res.json({ id: record.project.id, name: record.project.name, data: opened.data });
  });

  // The project the person double-clicked to start OSCAR, once: the first
  // editor page to ask gets it and it is gone, so a refresh opens nothing.
  router.get("/boot-file", editorOnly, (req, res) => {
    const file = takeBootFile ? takeBootFile() : null;
    res.json(file || {});
  });

  // The About window's telemetry switch: anonymous counts on or off.
  // "wired" is whether this build can speak at all (a key baked in and no
  // OSCAR_NO_TELEMETRY): unwired, the About window hides the row.
  router.get("/telemetry-state", editorOnly, (req, res) => {
    res.json({
      on: !!(telemetryState && telemetryState.isOn()),
      wired: !!(telemetryState && telemetryState.wired()),
    });
  });

  router.post("/telemetry-state", editorOnly, (req, res) => {
    if (!telemetryState) return res.status(404).json({ error: "No telemetry in this OSCAR." });
    const on = !!(req.body && req.body.on);
    telemetryState.setOn(on);
    res.json({ on });
  });

  // The MCP pill's switch: whether assistants may talk to this OSCAR.
  // Editing-grade, so editorOnly like everything else that changes state.
  router.get("/mcp-state", editorOnly, (req, res) => {
    res.json({ available: !!mcp, on: !!(mcp && mcp.isOn()) });
  });

  router.post("/mcp-state", editorOnly, (req, res) => {
    if (!mcp) return res.status(404).json({ error: "MCP is not in this OSCAR." });
    const on = !!(req.body && req.body.on);
    mcp.setOn(on);
    res.json({ on });
  });

  // What the server has lately done for the published surfaces: the backlog
  // behind the LIVE pill's network log. Live rows arrive by socket
  // ("live:log"); this is what a window that has just opened starts from.
  router.get("/live/log", editorOnly, (req, res) => {
    res.json(liveLog ? liveLog() : []);
  });

  router.delete("/published/:id", editorOnly, async (req, res) => {
    const removed = published ? await published.remove(req.params.id) : false;
    if (!removed) return res.status(404).json({ error: "That surface is no longer published" });
    if (onPublishedChanged) onPublishedChanged();
    res.json({ msg: "Unpublished" });
  });

  // Who can open a published surface: "off", no device at all, or "network",
  // any device on the local network. Changing it is editing.
  router.post("/published/:id/access", editorOnly, async (req, res) => {
    const access = req.body && req.body.access;
    if (access !== "off" && access !== "network") return res.status(400).json({ error: "An interface is either off or open to this network." });
    const done = published ? await published.setAccess(req.params.id, access) : false;
    if (!done) return res.status(404).json({ error: "That interface is no longer published" });
    if (onPublishedChanged) onPublishedChanged();
    res.json({ id: req.params.id, access });
  });

  // After /show/preview above, which is the editor's hand-off and not a page.
  router.get("/show/:id", async (req, res) => {
    const page = published ? await published.read(req.params.id) : null;
    if (page === null) return res.status(404).type("text/plain").send("There is no surface published here.");
    // Switched off: the address answers, and says so, to every device -- this
    // computer included. Off means nobody; the editor is where it is tested.
    const record = await published.record(req.params.id);
    if (record && record.access === "off") {
      res.setHeader("Cache-Control", "no-store");
      return res.status(403).type("html").send(OFF_PAGE);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Publishing again has to show at once on a tablet that reloads.
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(markServed(page, socketPort ? socketPort() : undefined));
  });

  // An assistant's draft, served to the editor the way a template is. The
  // file name pattern shuts out anything but the flat .html files the MCP
  // server writes -- no separators, no dots, no way to walk out of the folder.
  router.get("/drafts/:file", editorOnly, (req, res) => {
    const file = String(req.params.file || "");
    if (!draftsDir || !/^[a-z0-9][a-z0-9-]*\.html$/.test(file)) return res.status(404).type("text/plain").send("No such draft.");
    res.sendFile(require("path").join(draftsDir, file), (err) => {
      if (err && !res.headersSent) res.status(404).type("text/plain").send("No such draft.");
    });
  });

  // A draft is user data, not a shipped template: deletable, from the Load
  // list's own delete button. The same flat-name guard as serving it.
  router.delete("/drafts/:file", editorOnly, (req, res) => {
    const file = String(req.params.file || "");
    if (!draftsDir || !/^[a-z0-9][a-z0-9-]*\.html$/.test(file)) return res.status(404).json({ error: "No such draft." });
    require("fs").unlink(require("path").join(draftsDir, file), (err) => {
      if (err) return res.status(404).json({ error: "No such draft." });
      res.json({ msg: "Draft deleted" });
    });
  });

  // ---- Local project library --------------------------------------------
  router.get("/projects", editorOnly, async (req, res) => {
    try {
      // Templates come first and are always there; see lib/templates.js.
      let templates = templatesDir ? await listTemplates(templatesDir) : [];
      for (const source of extensions ? extensions.templateSources() : []) {
        templates = templates.concat(await listTemplates(source.dir, source));
      }
      // An assistant's drafts (lib/mcp/tools.js create_surface): reviewed by
      // loading them here, exactly as a template is.
      if (draftsDir) templates = templates.concat(await listTemplates(draftsDir, { name: "assistant", urlPrefix: "drafts/" }));
      res.json(templates.concat(await store.list()));
    } catch (err) {
      console.error("Could not list projects:", err.message);
      res.status(500).json({ error: "Could not read your projects folder" });
    }
  });

  // ---- projects that live in OSCAR, by who they are ----------------------
  // The routes below this block name a project by the file it is in (a slug
  // of its name) and stay for the assistant tools and for scripts. These
  // name it by its id, so a title can change, and carry a revision, so a
  // save made from an older copy is refused rather than written over what
  // someone else saved since (lib/projects.js).

  /** What a caller sent as a project's content, tidied, or null when it is not one. */
  function projectData(body) {
    const data = body && body.data;
    return isGrapesProject(data) ? stripEditorState(data) : null;
  }

  router.post("/projects", editorOnly, async (req, res) => {
    const body = req.body || {};
    const data = projectData(body);
    if (!data) return res.status(400).json({ error: "That is not an OSCAR project." });
    try {
      // A file brought in says who it is. If that project is already here,
      // the person is asked: replace it, or keep both.
      if (isProjectId(body.id)) {
        const standing = await store.readById(body.id);
        if (standing && body.ifExists === "replace") {
          const written = await store.write(body.id, { name: body.name, data, grapesjs: body.grapesjs });
          return res.json(Object.assign({ replaced: true }, written));
        }
        if (standing && body.ifExists !== "copy") {
          return res.status(409).json({ exists: true, id: standing.id, name: standing.name, error: '"' + standing.name + '" is already in OSCAR.' });
        }
        if (standing) return res.json(await store.create(body.name, data, { grapesjs: body.grapesjs }));
      }
      res.json(await store.create(body.name, data, { grapesjs: body.grapesjs, id: body.id }));
    } catch (err) {
      console.error("Could not create the project:", err.message);
      res.status(500).json({ error: "The project could not be created." });
    }
  });

  router.get("/projects/:id", editorOnly, async (req, res) => {
    try {
      const found = await store.readById(req.params.id);
      if (!found) return res.status(404).json({ error: "That project is not in OSCAR." });
      const opened = openProject(found.record);
      if (opened.status === "too-new") {
        return res.status(409).json({ error: "This project was saved with a newer version of OSCAR" + (opened.savedBy ? " (" + opened.savedBy + ")" : "") + ". Update OSCAR to open it." });
      }
      if (opened.status !== "ok") return res.status(422).json({ error: "This file isn't an OSCAR project, or it is damaged." });
      res.json({ id: found.id, name: found.name, rev: found.rev, updatedAt: found.updatedAt, data: opened.data });
    } catch (err) {
      console.error("Could not read the project:", err.message);
      res.status(500).json({ error: "The project could not be read." });
    }
  });

  router.put("/projects/:id", editorOnly, async (req, res) => {
    const body = req.body || {};
    const changes = { grapesjs: body.grapesjs };
    if (body.data !== undefined) {
      changes.data = projectData(body);
      if (!changes.data) return res.status(400).json({ error: "That is not an OSCAR project." });
    }
    if (typeof body.name === "string" && body.name.trim()) changes.name = body.name;
    if (changes.data === undefined && changes.name === undefined) return res.status(400).json({ error: "There is nothing to save." });
    if (Number.isInteger(body.baseRev)) changes.baseRev = body.baseRev;
    try {
      const written = await store.write(req.params.id, changes);
      if (!written) return res.status(404).json({ error: "That project is not in OSCAR." });
      if (written.conflict) {
        return res.status(409).json({ conflict: true, rev: written.rev, name: written.name, error: '"' + written.name + '" was changed somewhere else since this window opened it.' });
      }
      res.json(written);
    } catch (err) {
      console.error("Could not save the project:", err.message);
      res.status(500).json({ error: "The project could not be saved." });
    }
  });

  router.post("/projects/:id/copy", editorOnly, async (req, res) => {
    try {
      const made = await store.duplicate(req.params.id);
      if (!made) return res.status(404).json({ error: "That project is not in OSCAR." });
      res.json(made);
    } catch (err) {
      console.error("Could not copy the project:", err.message);
      res.status(500).json({ error: "The project could not be copied." });
    }
  });

  router.delete("/projects/:id", editorOnly, async (req, res) => {
    try {
      const removed = await store.removeById(req.params.id);
      if (!removed) return res.status(404).json({ error: "That project is not in OSCAR." });
      res.json({ msg: "Deleted" });
    } catch (err) {
      console.error("Could not delete the project:", err.message);
      res.status(500).json({ error: "The project could not be deleted." });
    }
  });

  router.post("/save", editorOnly, async (req, res) => {
    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!name) {
      return res.json({ error: "Pick a name for your project before saving" });
    }

    // Everything that isn't OSCAR metadata is grapesjs project content.
    const data = {};
    for (const key of Object.keys(body)) {
      if (!META_KEYS.has(key)) data[key] = body[key];
    }

    if (!Object.keys(data).length) {
      return res.json({ error: "There is nothing to save yet" });
    }

    try {
      const { slugify } = require("../lib/projects");
      const id = slugify(name);
      const overwrite = body.overwrite === true || body.overwrite === "true";

      if (!overwrite && (await store.exists(id))) {
        const existing = await store.read(id);
        const label = (existing && existing.name) || name;
        return res.json({
          confirm: '"' + label + '" already exists. Overwrite it?',
        });
      }

      // Editor state has no business in a project, in either direction.
      await store.save(name, stripEditorState(data), { grapesjs: body.grapesjs });
      res.json({ msg: 'Saved "' + name + '"', id });
    } catch (err) {
      console.error("Could not save project:", err.message);
      res.json({ error: "Could not be saved" });
    }
  });

  router.get("/load/:id", editorOnly, async (req, res) => {
    try {
      const record = await store.read(req.params.id);
      if (!record) return res.json({});

      const opened = openProject(record);

      if (opened.status === "too-new") {
        // Opening it anyway would drop whatever this version doesn't know
        // about, and the next save would write that loss back over the file.
        return res.json({
          error:
            "This project was saved with a newer version of OSCAR" +
            (opened.savedBy ? " (" + opened.savedBy + ")" : "") +
            ". Update OSCAR to open it.",
        });
      }

      if (opened.status !== "ok") {
        return res.json({
          error: "This file isn't an OSCAR project, or it is damaged.",
        });
      }

      // With ?envelope=1, who the project is as well as what is in it: the
      // editor remembers that, so what it publishes is known as this project.
      if (req.query.envelope === "1") {
        return res.json({ id: projectIdOf(record, req.params.id), name: record.name || req.params.id, data: opened.data });
      }
      res.json(opened.data);
    } catch (err) {
      console.error("Could not load project:", err.message);
      res.json({ error: "Could not be loaded" });
    }
  });

  router.delete("/remove/:id", editorOnly, async (req, res) => {
    try {
      const removed = await store.remove(req.params.id);
      if (!removed) return res.json({ error: "That project no longer exists" });
      res.json({ msg: "Deleted successfully" });
    } catch (err) {
      console.error("Could not delete project:", err.message);
      res.json({ error: "Could not be deleted" });
    }
  });

  return router;
};
