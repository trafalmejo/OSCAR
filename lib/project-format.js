"use strict";

/**
 * OSCAR's own project file format version.
 *
 * Bump this ONLY when a saved project needs converting to stay readable --
 * not once per OSCAR release. Add the matching entry to MIGRATIONS when you
 * do, and a test for it.
 */
const CURRENT_FORMAT = 2;

/**
 * MIGRATIONS[n] converts project data from format n to format n + 1.
 *
 * Format 0 means a file saved before OSCAR stamped its projects (the 2.0
 * releases). Those already hold GrapesJS 0.21+ project data, so there is
 * nothing to change -- they only need recognising.
 */
const MIGRATIONS = {
  0: (data) => data,
  1: (data) => stripEditorState(data),
};

// Editor state that must never live in a project. A 2.1 development build
// locked components while previewing by setting these on the components
// themselves, so saving during a preview wrote them into the file and the
// widgets could no longer be moved afterwards.
const EDITOR_STATE_KEYS = ["draggable", "selectable", "hoverable", "highlightable", "editable"];

function stripFromComponent(component) {
  if (!component || typeof component !== "object") return;

  for (const key of EDITOR_STATE_KEYS) {
    if (component[key] === false) delete component[key];
  }

  const children = component.components;
  if (Array.isArray(children)) children.forEach(stripFromComponent);
}

function stripEditorState(data) {
  if (!data || !Array.isArray(data.pages)) return data;

  for (const page of data.pages) {
    for (const frame of page.frames || []) stripFromComponent(frame.component);
    // Some projects carry the component directly on the page.
    stripFromComponent(page.component);
  }
  return data;
}

/** GrapesJS 0.21+ project data always carries a pages array. */
function isGrapesProject(data) {
  return !!data && typeof data === "object" && Array.isArray(data.pages) && data.pages.length > 0;
}

/** Files written before stamping have no format field; they are format 0. */
function detectFormat(record) {
  const format = record && record.format;
  return Number.isInteger(format) && format >= 0 ? format : 0;
}

/**
 * Decide what to do with a project record that has just been read.
 *
 * Returns one of:
 *   { status: "ok", data, from, migrated }
 *   { status: "too-new", savedBy, format }   - written by a newer OSCAR
 *   { status: "unreadable" }                 - not an OSCAR 2 project at all
 *
 * A file from a *newer* OSCAR is refused rather than opened. Its shape still
 * looks valid, so loading it would quietly drop whatever this version does not
 * understand -- and the next save would write that loss back over the file.
 */
function openProject(record) {
  if (!record || typeof record !== "object") return { status: "unreadable" };

  const from = detectFormat(record);

  if (from > CURRENT_FORMAT) {
    return { status: "too-new", format: from, savedBy: record.oscar || null };
  }

  // The envelope holds the project under `data`; an unstamped file may be the
  // bare project itself.
  let data = record.data !== undefined ? record.data : record;

  for (let version = from; version < CURRENT_FORMAT; version++) {
    const migrate = MIGRATIONS[version];
    if (!migrate) return { status: "unreadable" };
    try {
      data = migrate(data);
    } catch {
      return { status: "unreadable" };
    }
  }

  if (!isGrapesProject(data)) return { status: "unreadable" };

  // Unconditionally, not just as a migration: a file stamped with the current
  // format can still carry editor state if a build wrote it there, and a
  // version gate would wave that straight through. Idempotent and cheap.
  data = stripEditorState(data);

  return { status: "ok", data, from, migrated: from < CURRENT_FORMAT };
}

/**
 * Build the envelope written to disk.
 *
 * `oscar` and `grapesjs` are recorded for diagnosis -- knowing what wrote a
 * file is most of the work when someone reports it won't open. Neither is used
 * to decide anything; only `format` is.
 */
function stampProject({ name, data, oscar, grapesjs, now = () => new Date() }) {
  return {
    format: CURRENT_FORMAT,
    oscar: oscar || null,
    grapesjs: grapesjs || null,
    name,
    updatedAt: now().toISOString(),
    data,
  };
}

module.exports = {
  CURRENT_FORMAT,
  stripEditorState,
  MIGRATIONS,
  isGrapesProject,
  detectFormat,
  openProject,
  stampProject,
};
