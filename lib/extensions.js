"use strict";

/**
 * Extensions: code that adds to OSCAR without being part of it.
 *
 * OSCAR is complete without any. An extension is a Node module that OSCAR
 * loads at startup if it is there, and it can do four things, each optional:
 *
 *   module.exports = {
 *     name: "example",          // lower-case; also its address: /x/example/
 *     version: "1.0.0",
 *     oscarApi: 1,              // the API below, which it was written against
 *
 *     // 1. Switch on a feature OSCAR has but does not offer (lib/features.js).
 *     features: { PAGES: true },
 *
 *     // 2. Add templates to the Load list: a folder of .html files, read the
 *     //    way public/templates is. A function, if the folder is only known
 *     //    once OSCAR is running.
 *     templatesDir: "/path/to/templates",
 *
 *     // 3. Add to the editor page. publicDir is served at /x/example/, and
 *     //    the scripts and styles named here (relative to it) are loaded by
 *     //    the editor after its own, where window.OSCAR is waiting for them
 *     //    (see public/src/oscar_editor.js): window.OSCAR.ready(oscar) hands
 *     //    { api, editor, features, addToolbarButton, openModal,
 *     //      publishDialog.addSection }.
 *     publicDir: "/path/to/public",
 *     editor: { scripts: ["editor.js"], styles: ["editor.css"] },
 *
 *     // 4. Run on the server: add routes, start timers, talk to the rig.
 *     //    `host` is described at start() below.
 *     server(host) {},
 *   };
 *
 * The dependency runs one way. An extension may require anything of OSCAR's;
 * nothing in OSCAR requires an extension, names one, or behaves differently
 * because one might exist. That is what lets an extension live in another
 * repository under another licence.
 *
 * An extension that is broken must not take OSCAR down with it: one that
 * cannot be loaded, was written for another API, or throws while starting is
 * reported and left out, and everything else carries on.
 *
 * This file touches no network, and no disk beyond require() and looking in
 * one folder for what was put there (bundled()); server.js hands it the app.
 * That keeps it testable with plain objects.
 */

const fs = require("fs");
const path = require("path");

const features = require("./features");

/** Raised when something an extension could be relying on changes shape. */
const API = 1;

/** Looked for on every start, and no complaint if it is not installed. */
const OPTIONAL = ["@oscar/pro"];

const NAME = /^[a-z][a-z0-9-]*$/;
/** A file inside publicDir: no scheme, no climbing out, nothing odd. */
const ASSET = /^(?!\/)(?!.*\.\.)[\w\-./]+$/;

/**
 * The extensions that were put in a folder beside OSCAR: each sub-folder with
 * a package.json is one. It is how an extension gets into an installer
 * without OSCAR depending on it: whoever builds the installer copies it in,
 * and a build with an empty folder, or none, is plain OSCAR.
 *
 * Optional, all of them: a folder that turns out not to be an extension is
 * reported like any other that would not load, and OSCAR starts.
 *
 * @param {string} dir the folder, usually `extensions` beside server.js
 * @returns {{ id: string, optional: boolean }[]} absolute paths, by name
 */
function bundled(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return [];
  }
  return names
    .sort()
    .map((name) => path.join(dir, name))
    .filter((folder) => {
      try {
        return fs.statSync(path.join(folder, "package.json")).isFile();
      } catch (err) {
        return false;
      }
    })
    .map((folder) => ({ id: folder, optional: true }));
}

/**
 * Which modules to try, from the environment.
 *
 * OSCAR_EXTENSIONS is a comma-separated list of module names or paths, for
 * developing an extension or installing one by hand. Those are asked for, so
 * one that is missing is an error worth printing; the optional ones are not.
 *
 * `dir`, if given, is the folder bundled() looks in. One that is also asked
 * for by path is loaded once.
 *
 * @returns {{ id: string, optional: boolean }[]}
 */
function extensionIds(env, dir) {
  // OSCAR_NO_EXTENSIONS=1 runs OSCAR bare, which is the first thing to try
  // when something misbehaves and an extension might be why.
  if (env && env.OSCAR_NO_EXTENSIONS === "1") return [];
  const asked = String((env && env.OSCAR_EXTENSIONS) || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const ids = asked.map((id) => ({ id, optional: false }));
  for (const id of OPTIONAL) if (!asked.includes(id)) ids.push({ id, optional: true });
  if (dir) {
    const known = new Set(ids.map((entry) => path.resolve(entry.id)));
    for (const entry of bundled(dir)) if (!known.has(path.resolve(entry.id))) ids.push(entry);
  }
  return ids;
}

/** Why this module cannot be used as an extension, or null when it can. */
function complaintAbout(extension, taken) {
  if (!extension || typeof extension !== "object") return "it does not export an object";
  if (typeof extension.name !== "string" || !NAME.test(extension.name)) {
    return "its name has to be lower-case letters, digits and dashes, got " + JSON.stringify(extension.name);
  }
  if (taken.includes(extension.name)) return "another extension is already called " + extension.name;
  if (extension.oscarApi !== API) {
    return "it was written for extension API " + JSON.stringify(extension.oscarApi) + " and this OSCAR has " + API;
  }
  if (extension.server !== undefined && typeof extension.server !== "function") return "server has to be a function";
  if (extension.publicDir !== undefined && typeof extension.publicDir !== "string") return "publicDir has to be a path";
  const editor = extension.editor;
  if (editor !== undefined) {
    if (!extension.publicDir) return "editor files need a publicDir to be served from";
    for (const kind of ["scripts", "styles"]) {
      const files = editor[kind] === undefined ? [] : editor[kind];
      if (!Array.isArray(files) || !files.every((file) => typeof file === "string" && ASSET.test(file))) {
        return "editor." + kind + " has to be a list of files inside publicDir";
      }
    }
  }
  return null;
}

/**
 * Load what can be loaded.
 *
 * @param {{ id: string, optional: boolean }[]} ids from extensionIds()
 * @param {{ load?: (id: string) => any, log?: { log: Function, error: Function }, cwd?: string }} [options]
 *        `load` stands in for require() in tests
 */
function loadExtensions(ids, options) {
  const opts = options || {};
  const log = opts.log || console;
  const cwd = opts.cwd || process.cwd();
  const load =
    opts.load ||
    function (id) {
      // A path is relative to where OSCAR was started, not to this file.
      return require(/^\.{1,2}[\\/]/.test(id) || path.isAbsolute(id) ? path.resolve(cwd, id) : id);
    };

  const loaded = [];
  for (const entry of ids || []) {
    let extension;
    try {
      extension = load(entry.id);
    } catch (err) {
      const missing = err && err.code === "MODULE_NOT_FOUND" && String(err.message).includes(entry.id);
      if (!(entry.optional && missing)) log.error("Extension " + entry.id + " could not be loaded: " + reason(err));
      continue;
    }
    const complaint = complaintAbout(extension, loaded.map((e) => e.name));
    if (complaint) {
      log.error("Extension " + entry.id + " was left out: " + complaint + ".");
      continue;
    }
    loaded.push(extension);
  }
  return createExtensions(loaded, log);
}

function reason(err) {
  return err && err.message ? err.message : String(err);
}

/** The loaded extensions, as the questions the rest of OSCAR asks of them. */
function createExtensions(loaded, log) {
  let stoppers = [];

  function templatesDirOf(extension) {
    try {
      const dir = typeof extension.templatesDir === "function" ? extension.templatesDir() : extension.templatesDir;
      return typeof dir === "string" && dir ? dir : null;
    } catch (err) {
      log.error("Extension " + extension.name + " could not say where its templates are: " + reason(err));
      return null;
    }
  }

  return {
    /** For the startup banner and for a bug report. */
    list() {
      return loaded.map((e) => ({ name: e.name, version: typeof e.version === "string" ? e.version : null }));
    },

    /**
     * The switches in lib/features.js as the extensions leave them. Only a
     * feature OSCAR has can be switched; an extension's own features are its
     * own business.
     */
    features() {
      const resolved = Object.assign({}, features.DEFAULTS);
      for (const extension of loaded) {
        for (const [name, value] of Object.entries(extension.features || {})) {
          if (name in features.DEFAULTS && typeof value === "boolean") resolved[name] = value;
          else log.error("Extension " + extension.name + " set " + name + ", which is not a feature OSCAR has.");
        }
      }
      return resolved;
    },

    /** Folders of templates, and the address each is served at. Asked for on every listing. */
    templateSources() {
      const sources = [];
      for (const extension of loaded) {
        const dir = templatesDirOf(extension);
        if (dir) sources.push({ name: extension.name, dir, urlPrefix: "x/" + extension.name + "/templates/" });
      }
      return sources;
    },

    /** What the editor page has to load, as addresses. */
    editorAssets() {
      const assets = { scripts: [], styles: [] };
      for (const extension of loaded) {
        for (const kind of ["scripts", "styles"]) {
          for (const file of (extension.editor && extension.editor[kind]) || []) {
            assets[kind].push("x/" + extension.name + "/" + file);
          }
        }
      }
      return assets;
    },

    /**
     * Serve each extension's files under /x/<name>/. Templates are looked up
     * per request, since their folder may not exist until the extension has
     * fetched something into it.
     *
     * @param app an Express app
     * @param {(dir: string) => Function} serveStatic express.static
     */
    mount(app, serveStatic) {
      for (const extension of loaded) {
        const base = "/x/" + extension.name;
        const statics = new Map();
        app.use(base + "/templates", function (req, res, next) {
          const dir = templatesDirOf(extension);
          if (!dir) return next();
          if (!statics.has(dir)) statics.set(dir, serveStatic(dir));
          statics.get(dir)(req, res, next);
        });
        if (extension.publicDir) app.use(base, serveStatic(extension.publicDir));
      }
    },

    /**
     * Run each extension's server(). `host` is what OSCAR offers it:
     *
     *   api, version            the extension API and OSCAR's version
     *   app                     the Express app; routes belong under /x/<name>/
     *   io                      the socket.io server the surfaces are on
     *   settings                get(key) / set(key, value), kept across restarts;
     *                           use keys that start with the extension's name
     *   projectsDir             where projects live; a place for files of its own
     *   lock                    isLocked() / setLocked(value)
     *   surfaces                the published surfaces, and the one safe way to
     *                           act on one: list(), widgets(id), and
     *                           drive(id, widgetId, state); snapshot() and
     *                           onState(fn) to follow it; onPublished(fn) to
     *                           hear of a publish. See lib/surfaces.js
     *   features                the resolved switches
     *   log                     log / error
     *
     * and, added here per extension:
     *
     *   onShutdown(fn)          run fn when OSCAR quits; may return a promise
     */
    start(host) {
      for (const extension of loaded) {
        if (typeof extension.server !== "function") continue;
        const mine = [];
        try {
          extension.server(
            Object.assign({}, host, {
              api: API,
              onShutdown(fn) {
                if (typeof fn === "function") mine.push({ name: extension.name, fn });
              },
            })
          );
          stoppers = stoppers.concat(mine);
        } catch (err) {
          log.error("Extension " + extension.name + " failed to start and was left out: " + reason(err));
        }
      }
    },

    /** Run what the extensions asked to have run at shutdown. Never rejects. */
    stop() {
      const running = stoppers;
      stoppers = [];
      return Promise.all(
        running.map(({ name, fn }) =>
          Promise.resolve()
            .then(fn)
            .catch((err) => log.error("Extension " + name + " failed while shutting down: " + reason(err)))
        )
      ).then(() => undefined);
    },
  };
}

/** No extensions at all: what a test, or a caller that has none, passes along. */
function none() {
  return createExtensions([], console);
}

module.exports = { API, OPTIONAL, extensionIds, bundled, loadExtensions, complaintAbout, none };
