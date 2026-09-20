"use strict";

const fsp = require("fs/promises");
const path = require("path");

/**
 * Templates: surfaces that ship with OSCAR and are always in the Load list.
 *
 * Each one is a plain HTML file in public/templates, with its CSS in a <style>
 * block -- the same kind of code the editor's Import dialog takes, so a
 * template can be read, edited and shared as a file. Being under public, the
 * editor fetches the file itself; the server only has to say which exist.
 *
 * They live with the app, not in the projects folder, so clearing out projects
 * or reinstalling never removes one, and saving can never overwrite one.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** The text of a template's <title>, which is what the list shows. */
function titleOf(html) {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(String(html));
  return match ? match[1].trim() : "";
}

/**
 * Every template in `dir`, in name order: { _id, name, size, url, template }.
 * A missing folder means no templates, not an error.
 *
 * `source` is for a folder that is not OSCAR's own -- an extension's
 * (lib/extensions.js): { name, urlPrefix } says where its files are served
 * and keeps its ids apart from the shipped ones.
 */
async function listTemplates(dir, source) {
  const urlPrefix = (source && source.urlPrefix) || "templates/";
  const idPrefix = source && source.name ? source.name + ":" : "";
  let entries;
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return [];
  }

  const templates = [];
  for (const entry of entries) {
    if (!entry.endsWith(".html")) continue;
    const id = entry.slice(0, -".html".length);
    if (!ID_PATTERN.test(id)) continue;
    try {
      const file = path.join(dir, entry);
      const [stat, html] = await Promise.all([fsp.stat(file), fsp.readFile(file, "utf8")]);
      templates.push({
        _id: idPrefix + id,
        name: titleOf(html) || id,
        size: stat.size,
        url: urlPrefix + entry,
        template: true,
      });
    } catch {
      // An unreadable file shouldn't take the whole list down with it.
    }
  }
  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { listTemplates, titleOf };
