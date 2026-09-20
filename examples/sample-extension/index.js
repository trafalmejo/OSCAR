"use strict";

/**
 * The smallest extension that uses every part of the seam. It is what the
 * tests load, and what EXTENSIONS.md points at as a worked example:
 *
 *   OSCAR_EXTENSIONS=./examples/sample-extension npm run serve
 */

const path = require("path");

module.exports = {
  name: "sample",
  version: "0.1.0",
  oscarApi: 1,

  templatesDir: path.join(__dirname, "templates"),

  publicDir: path.join(__dirname, "public"),
  editor: { scripts: ["editor.js"] },

  server(host) {
    // Routes of its own, under its own address.
    host.app.get("/x/sample/hello", (req, res) => {
      res.json({ hello: "from the sample extension", oscar: host.version, locked: host.lock.isLocked() });
    });
    host.onShutdown(() => host.log.log("  Sample extension: stopped."));
  },
};
