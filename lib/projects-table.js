"use strict";

/**
 * The project list in the Save and Load dialogs: the parts that are not DOM.
 *
 * Sorting and formatting live here so they can be tested without a browser.
 * The rows come straight from GET /projects: { _id, name, size, date }.
 */

const KB = 1024;
const MB = 1024 * 1024;

/** A file size a person can read at a glance. Anything unusable shows blank. */
function formatSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < KB) return bytes + " B";
  if (bytes < MB) return Math.round(bytes / KB) + " KB";
  return (bytes / MB).toFixed(1) + " MB";
}

function isMissing(value) {
  return value === null || value === undefined || value === "";
}

/**
 * Rows ordered by one column, without changing the array handed in.
 *
 * Rows missing that value go last whichever way the column is sorted -- a
 * project with no date is not the newest one. Ties keep the order the server
 * sent, so a re-sort never shuffles rows that compare equal.
 */
function sortProjects(rows, key, direction) {
  const sign = direction === "descending" ? -1 : 1;

  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = a.row ? a.row[key] : undefined;
      const bv = b.row ? b.row[key] : undefined;
      const aMissing = isMissing(av);
      const bMissing = isMissing(bv);
      if (aMissing || bMissing) {
        if (aMissing === bMissing) return a.index - b.index;
        return aMissing ? 1 : -1;
      }

      const order =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });

      return order !== 0 ? Math.sign(order) * sign : a.index - b.index;
    })
    .map((entry) => entry.row);
}

/**
 * What clicking a column header does.
 *
 * The same column flips direction. A new column starts where people look
 * first: names A to Z, but sizes and dates largest and newest first.
 */
function nextSort(current, key) {
  if (current && current.key === key) {
    return { key, direction: current.direction === "ascending" ? "descending" : "ascending" };
  }
  return { key, direction: key === "name" ? "ascending" : "descending" };
}

/**
 * The rows as the list shows them: templates first, in the order the server
 * sent them, then the projects sorted by the chosen column.
 *
 * Templates stay on top whatever the sort, so they are always where people
 * last saw them. With `withTemplates` false -- the Save dialog, where picking
 * a template would only mean saving over its name -- they are left out.
 */
function orderProjects(rows, key, direction, withTemplates) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const templates = withTemplates === false ? [] : list.filter((row) => row.template === true);
  return templates.concat(sortProjects(list.filter((row) => row.template !== true), key, direction));
}

/** Newest first: someone opening Load usually wants what they saved last. */
const DEFAULT_SORT = { key: "date", direction: "descending" };

module.exports = { formatSize, sortProjects, orderProjects, nextSort, DEFAULT_SORT };
