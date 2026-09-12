"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const TEMPLATES = path.join(ROOT, ".github", "ISSUE_TEMPLATE");
const EDITOR = path.join(ROOT, "public", "src", "oscar_editor.js");

const editorSource = () => fs.readFileSync(EDITOR, "utf8");

/** Templates the editor opens, named either inline or passed to openIssue(). */
function templatesUsedByEditor() {
  return [...new Set([...editorSource().matchAll(/([\w-]+\.yml)/g)].map((m) => m[1]))];
}

/** Fields the editor prefills, e.g. &environment=... */
function prefilledFields() {
  return [...editorSource().matchAll(/"&(\w[\w-]*)="/g)].map((m) => m[1]);
}

/** Field ids declared in an issue form. */
function idsIn(file) {
  const yml = fs.readFileSync(file, "utf8");
  return [...yml.matchAll(/^\s*id:\s*([\w-]+)\s*$/gm)].map((m) => m[1]);
}

test("the editor opens issue templates that exist", () => {
  const used = templatesUsedByEditor();
  assert.ok(used.length >= 2, "the editor links to the bug and feature forms");

  for (const template of used) {
    assert.ok(
      fs.existsSync(path.join(TEMPLATES, template)),
      template + " is opened by the editor but not in .github/ISSUE_TEMPLATE"
    );
  }
});

// A renamed field id doesn't error anywhere: GitHub just ignores the parameter
// and the report arrives without the version details.
test("every field the editor prefills exists in an issue form", () => {
  const declared = new Set(
    fs
      .readdirSync(TEMPLATES)
      .filter((f) => f.endsWith(".yml") && f !== "config.yml")
      .flatMap((f) => idsIn(path.join(TEMPLATES, f)))
  );

  const missing = prefilledFields().filter((field) => !declared.has(field));
  assert.deepStrictEqual(missing, [], "prefilled fields no issue form declares");
});

test("issue forms carry the fields that make a report usable", () => {
  const bug = idsIn(path.join(TEMPLATES, "bug.yml"));
  for (const field of ["what-happened", "environment"]) {
    assert.ok(bug.includes(field), "bug.yml is missing " + field);
  }

  const feature = idsIn(path.join(TEMPLATES, "feature.yml"));
  assert.ok(feature.includes("what"), "feature.yml is missing what");
});

test("routes that need no GitHub account are offered alongside", () => {
  const config = fs.readFileSync(path.join(TEMPLATES, "config.yml"), "utf8");
  assert.match(config, /contact_links:/);
  assert.match(config, /mailto:hello@createwithoscar\.com/, "an email route for people without accounts");
});
