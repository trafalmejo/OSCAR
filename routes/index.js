"use strict";

const express = require("express");

const { openProject, stripEditorState } = require("../lib/project-format");
const { isLoopbackAddress } = require("../lib/net");
const { buildExport } = require("../lib/export");

// Where an export finds its runtime, and the only folder it may inline from.
const PUBLIC_DIR = require("path").join(__dirname, "..", "public");

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
