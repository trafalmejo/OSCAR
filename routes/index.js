"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");

const { openProject, stripEditorState, namePages } = require("../lib/project-format");
const { isLoopbackAddress } = require("../lib/net");
const { buildDocument } = require("../lib/export/document");
const { createAssetReader } = require("../lib/export/assets");
const { slugify } = require("../lib/projects");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

// The pieces an exported file is built from. The runtime is OSCAR's own build
// output; the socket.io client is the same copy the editor loads, so the two
// ends of the bridge can never be different versions.
const RUNTIME_FILE = path.join(PUBLIC_DIR, "src", "runtime.bundle.js");
const SOCKET_CLIENT_FILE = path.join(
  PUBLIC_DIR,
  "node_modules",
  "socket.io-client",
  "dist",
  "socket.io.min.js"
);
const WIDGET_CSS_FILE = path.join(PUBLIC_DIR, "assets", "css", "toggle.css");

// Keys grapesjs sends alongside the project payload that are OSCAR's own
// bookkeeping rather than editor content.
const META_KEYS = new Set(["name", "overwrite", "visibility", "grapesjs"]);

/**
 * @param {object} deps
 * @param {import('../lib/projects').ProjectStore} deps.store
 * @param {() => string} deps.serverIP
 * @param {{ check: () => Promise<object> }} [deps.updates] - update checker
 */
module.exports = function createRouter({
  store,
  serverIP,
  socketPort,
  updates,
  diagnostics,
  onPreviewPush,
  lock,
  serial,
  onSerialChange,
}) {
  const router = express.Router();

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
    res.render("index");
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
  router.get("/preview", (req, res) => res.render("preview"));

  // Where the browser should reach OSCAR. The OSC bridge does not always
  // listen on 8081 -- OSCAR_SOCKET_PORT moves it, and a second instance on the
  // same machine has to -- so the port is reported rather than assumed.
  router.get("/connection", (req, res) =>
    res.json({ address: serverIP(), socketPort: socketPort ? socketPort() : 8081 })
  );

  // Kept for anything written against older OSCARs.
  router.get("/ipserver", (req, res) => res.send(serverIP()));

  // Version details for the "Report a problem" button. Nothing identifying:
  // just what a bug report always has to ask for anyway.
  router.get("/diagnostics", (req, res) => res.json(diagnostics ? diagnostics() : {}));

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

  // ---- Serial -------------------------------------------------------------
  // Choosing which board OSCAR talks to is editing, not driving: a tablet on
  // the network must not be able to move the cable out from under a show.
  const NO_SERIAL = {
    supported: false,
    reason: "This build of OSCAR has no serial support.",
    state: "closed",
    ports: [],
  };

  router.get("/serial", editorOnly, async (req, res) => {
    if (!serial) return res.json(NO_SERIAL);
    res.json(Object.assign(serial.status(), { ports: await serial.list() }));
  });

  router.post("/serial", editorOnly, async (req, res) => {
    if (!serial) return res.json(NO_SERIAL);

    const body = req.body || {};
    const status = body.connect
      ? serial.connect(body.path, body.bitrate)
      : serial.disconnect();

    if (onSerialChange) onSerialChange(status);
    res.json(Object.assign(status, { ports: await serial.list() }));
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

  // ---- Export -------------------------------------------------------------
  // The editor sends the markup (with each widget's settings written into it)
  // and the stylesheet; this side adds the runtime, the socket.io client and
  // the widget styling, and hands back one file that works on its own.
  //
  // Wrapped here rather than in the browser because this is the side that can
  // read those files off disk, and inline the images a project refers to.
  router.post("/export", editorOnly, (req, res) => {
    const body = req.body || {};

    if (typeof body.html !== "string" || !body.html.trim()) {
      return res.status(400).json({ error: "There is nothing on the canvas to export yet." });
    }

    const host = String((body.connection && body.connection.host) || "").trim();
    const port = Number(body.connection && body.connection.port);

    if (!host) {
      return res.status(400).json({ error: "Say where OSCAR can be reached." });
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return res
        .status(400)
        .json({ error: "The bridge port has to be a whole number between 1 and 65535." });
    }

    let runtime;
    let socketio;
    try {
      runtime = fs.readFileSync(RUNTIME_FILE, "utf8");
      socketio = fs.readFileSync(SOCKET_CLIENT_FILE, "utf8");
    } catch (err) {
      // Shipping a half-built file would produce exactly the silent, dead page
      // this feature exists to stop, so say so instead.
      console.error("Could not read the export runtime:", err.message);
      return res.status(500).json({
        error:
          "This OSCAR install is missing its export runtime. Run `npm run build` " +
          "and `npm install`, then try again.",
      });
    }

    let widgetCss = "";
    try {
      widgetCss = fs.readFileSync(WIDGET_CSS_FILE, "utf8");
    } catch (err) {
      // Unstyled controls still send. Worth continuing for.
      console.error("Could not read the widget stylesheet:", err.message);
    }

    try {
      const page = buildDocument({
        title: typeof body.title === "string" ? body.title : "OSCAR interface",
        html: body.html,
        css: typeof body.css === "string" ? body.css : "",
        connection: { host, port },
        runtime,
        socketio,
        styles: [widgetCss],
        oscarVersion: diagnostics ? diagnostics().oscar : null,
        readAsset: createAssetReader(PUBLIC_DIR),
      });

      // The name goes into a header, so it is rebuilt from scratch rather than
      // quoted: a quote or a newline in it would be a header injection.
      const filename = slugify(body.fileName || body.title) + ".html";

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '"');
      res.send(page);
    } catch (err) {
      console.error("Could not build the export:", err.message);
      res.status(500).json({ error: "Your interface could not be exported." });
    }
  });

  // ---- Local project library --------------------------------------------
  router.get("/projects", editorOnly, async (req, res) => {
    try {
      res.json(await store.list());
    } catch (err) {
      console.error("Could not list projects:", err.message);
      res.status(500).json({ error: "Could not read your projects folder" });
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
      const id = slugify(name);
      const overwrite = body.overwrite === true || body.overwrite === "true";

      if (!overwrite && (await store.exists(id))) {
        const existing = await store.read(id);
        const label = (existing && existing.name) || name;
        return res.json({
          confirm: '"' + label + '" already exists. Overwrite it?',
        });
      }

      // Editor state has no business in a project, in either direction; a page
      // with no name is written out with one so the file is readable on its own
      // rather than only after an open.
      await store.save(name, namePages(stripEditorState(data)), { grapesjs: body.grapesjs });
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
