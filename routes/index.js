"use strict";

const express = require("express");

// Keys grapesjs sends alongside the project payload that are OSCAR's own
// bookkeeping rather than editor content.
const META_KEYS = new Set(["name", "overwrite", "visibility"]);

/**
 * @param {object} deps
 * @param {import('../lib/projects').ProjectStore} deps.store
 * @param {() => string} deps.serverIP
 */
module.exports = function createRouter({ store, serverIP }) {
  const router = express.Router();

  // The live preview payload is deliberately in-memory: it is a scratch copy
  // of the canvas handed from the editor tab to the preview tab.
  let preview = null;

  router.get("/", (req, res) => res.render("index"));
  router.get("/preview", (req, res) => res.render("preview"));

  router.get("/ipserver", (req, res) => res.send(serverIP()));

  // Kept for the editor's startup check. There is no update service any more,
  // so this always reports "nothing to announce".
  router.post("/update", (req, res) => res.json({}));
  router.get("/upgrade", (req, res) => res.json({ success: true }));

  // ---- Preview hand-off -------------------------------------------------
  router.post("/save/preview", (req, res) => {
    preview = req.body && req.body.project ? req.body.project : req.body;
    res.json({ msg: "Preview updated" });
  });

  router.get("/show/preview", (req, res) => res.json(preview || {}));

  // ---- Local project library --------------------------------------------
  router.get("/projects", async (req, res) => {
    try {
      res.json(await store.list());
    } catch (err) {
      console.error("Could not list projects:", err.message);
      res.status(500).json({ error: "Could not read your projects folder" });
    }
  });

  router.post("/save", async (req, res) => {
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

      await store.save(name, data);
      res.json({ msg: 'Saved "' + name + '"', id });
    } catch (err) {
      console.error("Could not save project:", err.message);
      res.json({ error: "Could not be saved" });
    }
  });

  router.get("/load/:id", async (req, res) => {
    try {
      const record = await store.read(req.params.id);
      if (!record) return res.json({});
      res.json(record.data || {});
    } catch (err) {
      console.error("Could not load project:", err.message);
      res.json({ error: "Could not be loaded" });
    }
  });

  router.delete("/remove/:id", async (req, res) => {
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
