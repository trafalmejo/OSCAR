"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  CURRENT_FORMAT,
  stripEditorState,
  MIGRATIONS,
  isGrapesProject,
  detectFormat,
  openProject,
  stampProject,
} = require("../lib/project-format");

const project = () => ({
  pages: [{ frames: [{ component: { type: "wrapper", components: [] } }] }],
  styles: [],
  assets: [],
});

test("a saved file records the format and what wrote it", () => {
  const record = stampProject({
    name: "My Show",
    data: project(),
    oscar: "2.1.0",
    grapesjs: "0.23.6",
  });

  assert.strictEqual(record.format, CURRENT_FORMAT);
  assert.strictEqual(record.oscar, "2.1.0");
  assert.strictEqual(record.grapesjs, "0.23.6");
  assert.strictEqual(record.name, "My Show");
  assert.ok(record.updatedAt, "and when");
  assert.deepStrictEqual(record.data, project());
});

test("a stamped file opens straight away", () => {
  const record = stampProject({ name: "X", data: project(), oscar: "2.1.0" });
  const opened = openProject(record);

  assert.strictEqual(opened.status, "ok");
  assert.strictEqual(opened.migrated, false);
  assert.deepStrictEqual(opened.data, project());
});

test("a file saved before stamping is treated as format 0 and still opens", () => {
  // What OSCAR 2.0 wrote: no format field.
  const legacy = { name: "Old Show", updatedAt: "2026-09-04T00:00:00Z", data: project() };

  assert.strictEqual(detectFormat(legacy), 0);
  const opened = openProject(legacy);
  assert.strictEqual(opened.status, "ok");
  assert.strictEqual(opened.from, 0);
  assert.strictEqual(opened.migrated, CURRENT_FORMAT > 0);
  assert.deepStrictEqual(opened.data, project());
});

test("a file from a NEWER OSCAR is refused, not opened", () => {
  // The dangerous case: the shape still looks fine, so opening it would drop
  // whatever this version doesn't understand and save the loss back.
  const future = {
    format: CURRENT_FORMAT + 1,
    oscar: "9.9.9",
    name: "From the future",
    data: project(),
  };

  const opened = openProject(future);
  assert.strictEqual(opened.status, "too-new");
  assert.strictEqual(opened.savedBy, "9.9.9", "so the message can name the version");
  assert.strictEqual(opened.data, undefined, "no data is handed back to be mangled");
});

test("a 1.x-era file is unreadable rather than half-loaded", () => {
  const ancient = {
    name: "OSCAR 1 project",
    data: { "gjs-components": "[]", "gjs-styles": "[]" },
  };
  assert.strictEqual(openProject(ancient).status, "unreadable");
});

test("junk is unreadable", () => {
  for (const record of [null, undefined, 42, "hello", {}, { data: {} }, { data: { pages: [] } }]) {
    assert.strictEqual(openProject(record).status, "unreadable", JSON.stringify(record));
  }
});

test("isGrapesProject only accepts project data with pages", () => {
  assert.strictEqual(isGrapesProject(project()), true);
  assert.strictEqual(isGrapesProject({ pages: [] }), false);
  assert.strictEqual(isGrapesProject({ "gjs-components": "[]" }), false);
  assert.strictEqual(isGrapesProject(null), false);
});

test("format 2 strips editor state a preview once wrote into projects", () => {
  // What a 2.1 development build saved if you pressed Save while previewing.
  const damaged = {
    pages: [
      {
        frames: [
          {
            component: {
              type: "wrapper",
              components: [
                {
                  type: "oscar-button",
                  draggable: false,
                  selectable: false,
                  hoverable: false,
                  highlightable: false,
                  editable: false,
                  droppable: false,
                  components: [{ type: "text", draggable: false, selectable: false }],
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const fixed = stripEditorState(damaged);
  const button = fixed.pages[0].frames[0].component.components[0];

  for (const key of ["draggable", "selectable", "hoverable", "highlightable", "editable"]) {
    assert.ok(!(key in button), key + " was left on the component");
  }
  assert.strictEqual(button.droppable, false, "droppable is the widget's own setting, not editor state");
  assert.ok(!("draggable" in button.components[0]), "nested components are cleaned too");
});

test("stripping leaves a healthy project untouched", () => {
  const healthy = JSON.parse(JSON.stringify(project()));
  assert.deepStrictEqual(stripEditorState(JSON.parse(JSON.stringify(healthy))), healthy);
});

test("a damaged format 1 file is repaired on open", () => {
  const record = {
    format: 1,
    oscar: "2.0.0",
    name: "Saved while previewing",
    data: {
      pages: [
        {
          frames: [
            {
              component: {
                type: "wrapper",
                components: [{ type: "oscar-slider", draggable: false, selectable: false }],
              },
            },
          ],
        },
      ],
    },
  };

  const opened = openProject(record);
  assert.strictEqual(opened.status, "ok");
  assert.strictEqual(opened.migrated, true);
  const slider = opened.data.pages[0].frames[0].component.components[0];
  assert.ok(!("draggable" in slider), "the widget can be moved again");
});

test("a CURRENT-format file carrying editor state is still repaired", () => {
  // The gap a version-gated migration leaves: damaged data that has since been
  // re-saved, so it claims the current format and skips every migration.
  const record = {
    format: CURRENT_FORMAT,
    oscar: "2.1.0",
    name: "Re-saved while damaged",
    data: {
      pages: [
        {
          frames: [
            {
              component: {
                type: "wrapper",
                components: [{ type: "oscar-button", draggable: false, selectable: false }],
              },
            },
          ],
        },
      ],
    },
  };

  const opened = openProject(record);
  assert.strictEqual(opened.status, "ok");
  assert.strictEqual(opened.migrated, false, "nothing to migrate -- it is current");
  const button = opened.data.pages[0].frames[0].component.components[0];
  assert.ok(!("draggable" in button), "but the editor state is gone anyway");
});

test("every format below the current one has a migration to the next", () => {
  for (let version = 0; version < CURRENT_FORMAT; version++) {
    assert.strictEqual(
      typeof MIGRATIONS[version],
      "function",
      "format " + version + " has no way to reach " + (version + 1)
    );
  }
});

test("a round trip through stamp and open preserves the project exactly", () => {
  const original = project();
  const record = JSON.parse(JSON.stringify(stampProject({ name: "Trip", data: original })));
  const opened = openProject(record);

  assert.strictEqual(opened.status, "ok");
  assert.deepStrictEqual(opened.data, original);
});
