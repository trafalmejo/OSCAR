"use strict";

/**
 * POST /export, minus Express: check what the editor sent, read the pieces
 * off disk, hand back one file.
 *
 * Done on the server rather than in the browser because this is the side
 * that can read the runtime, the socket.io client and a project's images off
 * disk without a dozen fetches that each fail in their own way.
 */

const fs = require("fs");
const path = require("path");

const { buildDocument } = require("./document");
const { createAssetReader } = require("./assets");
const { slugify } = require("../projects");
const { readConnection } = require("./connection");

/** The files every export is built from, under OSCAR's public folder. */
function sources(publicDir) {
  return {
    // OSCAR's own build output (npm run build).
    runtime: path.join(publicDir, "src", "runtime.bundle.js"),
    // The same copy the editor loads, so both ends of the bridge always
    // speak the same protocol version.
    socketio: path.join(publicDir, "node_modules", "socket.io-client", "dist", "socket.io.min.js"),
    widgetCss: path.join(publicDir, "assets", "css", "toggle.css"),
  };
}

/**
 * @param {object} body the request: { title, fileName, html, css, connection }
 * @param {{ publicDir: string, oscarVersion?: string, files?: object }} deps
 * @returns {{ status: number, error: string } |
 *           { page: string, filename: string, linked: string[] }}
 */
function buildExport(body, deps) {
  const request = body && typeof body === "object" ? body : {};

  if (typeof request.html !== "string" || !request.html.trim()) {
    return { status: 400, error: "There is nothing on the canvas to export yet." };
  }

  const connection = readConnection(request.connection);
  if (connection.error) return { status: 400, error: connection.error };

  const files = Object.assign(sources(deps.publicDir), deps.files);
  let runtime;
  let socketio;
  try {
    runtime = fs.readFileSync(files.runtime, "utf8");
    socketio = fs.readFileSync(files.socketio, "utf8");
  } catch (err) {
    // A file with a piece missing is exactly the silent, dead page this
    // feature exists to stop, so refuse instead of shipping one.
    return {
      status: 500,
      error:
        "This OSCAR is missing part of its export runtime (" +
        path.basename(err.path || "a file") +
        "). Run `npm run build`, then try again.",
    };
  }

  let widgetCss = "";
  try {
    widgetCss = fs.readFileSync(files.widgetCss, "utf8");
  } catch (err) {
    // Unstyled controls still send; worth carrying on for.
  }

  const readAsset = createAssetReader(deps.publicDir);
  const title = typeof request.title === "string" && request.title.trim() ? request.title.trim() : "OSCAR interface";

  const page = buildDocument({
    title: title,
    html: request.html,
    css: typeof request.css === "string" ? request.css : "",
    connection: connection,
    runtime: runtime,
    socketio: socketio,
    styles: [widgetCss],
    oscarVersion: deps.oscarVersion,
    readAsset: readAsset,
  });

  return {
    page: page,
    // Rebuilt from scratch rather than quoted, because it goes into a header:
    // a quote or a newline in it would be a header injection.
    filename: slugify(request.fileName || title) + ".html",
    linked: readAsset.linked.slice(),
  };
}

module.exports = { buildExport };
