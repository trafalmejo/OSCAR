"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  CURRENT_FORMAT,
  formatFor,
  stripEditorState,
  MIGRATIONS,
  isGrapesProject,
  detectFormat,
  openProject,
  stampProject,
  namePages,
  defaultPageName,
  pageLabel,
} = require("../lib/project-format");

// The page is named, as every page is once it has been through openProject;
// the tests about unnamed pages build their own.
const project = () => ({
  pages: [{ name: "Main", frames: [{ component: { type: "wrapper", components: [] } }] }],
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

  assert.strictEqual(record.format, formatFor(project()));
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

// ---- format 3: pages have names -------------------------------------------

const frames = () => [{ component: { type: "wrapper", components: [] } }];

test("an unnamed page is called by its position, counting from one", () => {
  assert.strictEqual(defaultPageName(0), "Page 1");
  assert.strictEqual(defaultPageName(2), "Page 3");
  assert.strictEqual(pageLabel("", 0), "Page 1");
  assert.strictEqual(pageLabel(undefined, 1), "Page 2");
  assert.strictEqual(pageLabel("   ", 1), "Page 2", "a name of spaces would print a blank tab");
  assert.strictEqual(pageLabel(" Wash ", 4), "Wash");
});

test("format 3 names the pages of an older project and leaves given names alone", () => {
  const record = {
    format: 2,
    name: "Two pages",
    data: { pages: [{ frames: frames() }, { name: "Movers", frames: frames() }, { name: "", frames: frames() }] },
  };

  const opened = openProject(record);
  assert.strictEqual(opened.status, "ok");
  assert.strictEqual(opened.migrated, true);
  assert.deepStrictEqual(
    opened.data.pages.map((page) => page.name),
    ["Page 1", "Movers", "Page 3"]
  );
});

test("a CURRENT-format file with an unnamed page is still named", () => {
  // Not a rare case but the usual one: GrapesJS drops an empty page name when
  // it saves, so page one of a project written by this very version comes
  // back unnamed, carrying a stamp that skips every migration.
  const record = { format: CURRENT_FORMAT, name: "Fresh", data: { pages: [{ frames: frames() }] } };

  const opened = openProject(record);
  assert.strictEqual(opened.status, "ok");
  assert.strictEqual(opened.migrated, false);
  assert.strictEqual(opened.data.pages[0].name, "Page 1");
});

test("naming pages twice changes nothing, and survives data that is not a project", () => {
  const once = namePages({ pages: [{ frames: frames() }, null, { name: "Keys" }] });
  const twice = namePages(JSON.parse(JSON.stringify(once)));
  assert.deepStrictEqual(twice, once);
  assert.strictEqual(once.pages[1], null, "a hole is left alone, not thrown on");

  assert.strictEqual(namePages(null), null);
  assert.deepStrictEqual(namePages({ pages: "nope" }), { pages: "nope" });
});

test("multi-page projects carry a format an older OSCAR refuses", () => {
  // Why the bump is deliberate. An OSCAR that stops at format 2 has no page
  // switcher: it would open a multi-page show, draw page one and offer no way
  // to the rest, which reads as a damaged project. Its openProject sees a
  // format above its own and says to update instead.
  const record = stampProject({ name: "Show", data: { pages: [{ name: "A" }, { name: "B" }] } });
  assert.ok(record.format >= 3);
});

test("a single-page project keeps the format an older OSCAR can open; a second page is what earns format 3", () => {
  const page = () => ({ name: "Page 1", frames: [{ component: { type: "wrapper" } }] });
  const single = stampProject({ name: "One", data: { pages: [page()] } });
  const several = stampProject({ name: "Two", data: { pages: [page(), page()] } });

  // Format 2 is what the build before pages wrote and reads. Nothing in a
  // single-page file is beyond it, so it must not be refused there.
  assert.strictEqual(single.format, 2);
  assert.strictEqual(several.format, 3);
  assert.strictEqual(several.format, CURRENT_FORMAT);

  // Both open here, and a single-page file stamped 2 is current, not migrated.
  const opened = openProject(single);
  assert.strictEqual(opened.status, "ok");
  assert.strictEqual(opened.migrated, false);
  assert.strictEqual(openProject(several).migrated, false);

  // A multi-page file from before format 3 is still brought up to it.
  const legacy = openProject({ format: 2, name: "Old", data: { pages: [page(), page()] } });
  assert.strictEqual(legacy.migrated, true);

  assert.strictEqual(formatFor(null), 2);
  assert.strictEqual(formatFor({ pages: "no" }), 2);
});
