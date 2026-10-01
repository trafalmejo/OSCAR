"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const { ProjectStore } = require("../lib/projects");
const { CURRENT_FORMAT, formatFor } = require("../lib/project-format");
const createRouter = require("../routes/index");

// Spin the real router up on an ephemeral port so the tests exercise the same
// request path the editor uses.
async function withServer(run, deps = {}) {
  const { storeOptions, ...routerDeps } = deps;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-routes-"));
  const store = new ProjectStore(dir, storeOptions);

  const app = express();
  app.set("views", path.join(__dirname, "..", "public"));
  app.set("view engine", "ejs");
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ limit: "25mb", extended: true }));
  app.use("/", createRouter(Object.assign({ store, serverIP: () => "192.168.0.5" }, routerDeps)));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = "http://127.0.0.1:" + server.address().port;

  try {
    await run(base, store, dir);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const postJSON = (base, url, body) =>
  fetch(base + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("GET /ipserver reports the LAN address", async () => {
  await withServer(async (base) => {
    const res = await fetch(base + "/ipserver");
    assert.strictEqual(await res.text(), "192.168.0.5");
  });
});

test("GET /projects starts empty and reflects saves", async () => {
  await withServer(async (base) => {
    assert.deepStrictEqual(await (await fetch(base + "/projects")).json(), []);

    await postJSON(base, "/save", { name: "Show A", "gjs-components": "[]" });

    const list = await (await fetch(base + "/projects")).json();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].name, "Show A");
    assert.strictEqual(list[0]._id, "show-a");
  });
});

test("GET /projects lists the templates first, and they survive having no projects", async () => {
  const templatesDir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-route-templates-"));
  fs.writeFileSync(path.join(templatesDir, "starter.html"), "<!doctype html><title>Starter</title>");

  await withServer(
    async (base) => {
      let list = await (await fetch(base + "/projects")).json();
      assert.deepStrictEqual(list.map((r) => [r._id, r.template]), [["starter", true]]);

      await postJSON(base, "/save", { name: "Show A", "gjs-components": "[]" });
      list = await (await fetch(base + "/projects")).json();
      assert.deepStrictEqual(list.map((r) => r.name), ["Starter", "Show A"]);
      assert.strictEqual(list[1].template, undefined, "a saved project is not a template");
    },
    { templatesDir }
  );
});

test("POST /save refuses an unnamed project", async () => {
  await withServer(async (base) => {
    const body = await (await postJSON(base, "/save", { "gjs-components": "[]" })).json();
    assert.match(body.error, /name/i);
  });
});

test("POST /save refuses an empty project", async () => {
  await withServer(async (base) => {
    const body = await (await postJSON(base, "/save", { name: "Empty" })).json();
    assert.match(body.error, /nothing to save/i);
  });
});

test("POST /save asks before overwriting, then overwrites on confirm", async () => {
  await withServer(async (base, store) => {
    const first = await (
      await postJSON(base, "/save", { name: "Show", "gjs-components": "v1" })
    ).json();
    assert.match(first.msg, /Saved/);

    const second = await (
      await postJSON(base, "/save", { name: "Show", "gjs-components": "v2" })
    ).json();
    assert.ok(second.confirm, "a second save without overwrite asks first");
    assert.strictEqual((await store.read("show")).data["gjs-components"], "v1");

    const third = await (
      await postJSON(base, "/save", {
        name: "Show",
        overwrite: true,
        "gjs-components": "v2",
      })
    ).json();
    assert.match(third.msg, /Saved/);
    assert.strictEqual((await store.read("show")).data["gjs-components"], "v2");
  });
});

test("save strips OSCAR metadata out of the stored project", async () => {
  await withServer(async (base, store) => {
    await postJSON(base, "/save", {
      name: "Meta",
      overwrite: false,
      visibility: "private",
      "gjs-components": "[]",
    });

    const data = (await store.read("meta")).data;
    assert.deepStrictEqual(Object.keys(data), ["gjs-components"]);
  });
});

test("a GrapesJS 0.21+ project round-trips through save and load unchanged", async () => {
  await withServer(async (base) => {
    // The shape editor.getProjectData() produces. The editor sends it flat,
    // alongside OSCAR's own name/overwrite fields, and hands whatever /load
    // returns straight to editor.loadProjectData().
    const project = {
      dataSources: [],
      assets: [],
      styles: [{ selectors: ["#i1"], style: { color: "red" } }],
      pages: [
        {
          name: "Main",
          frames: [
            {
              component: {
                type: "wrapper",
                components: [
                  { type: "oscar-button", message: "/push1", port: 7000 },
                  { type: "oscar-slider", message: "/slider1", invert: true },
                ],
              },
            },
          ],
          id: "page-1",
        },
      ],
      symbols: [],
    };

    const saved = await (
      await postJSON(base, "/save", Object.assign({ name: "Round Trip", overwrite: false }, project))
    ).json();
    assert.match(saved.msg, /Saved/);

    const loaded = await (await fetch(base + "/load/round-trip")).json();
    assert.deepStrictEqual(loaded, project, "loaded project is exactly what was saved, minus OSCAR's fields");
  });
});

test("GET /load names a page GrapesJS saved without a name", async () => {
  await withServer(async (base) => {
    // What the editor really sends for page one: GrapesJS drops an empty name.
    const project = { pages: [{ frames: [{ component: { type: "wrapper" } }] }, { name: "Movers" }] };
    await postJSON(base, "/save", Object.assign({ name: "Unnamed page" }, project));

    const found = await (await fetch(base + "/load/unnamed-page")).json();
    assert.deepStrictEqual(
      found.pages.map((page) => page.name),
      ["Page 1", "Movers"]
    );
  });
});

test("GET /load returns the project, and {} when missing", async () => {
  await withServer(async (base) => {
    const project = { pages: [{ name: "Main", frames: [{ component: { type: "wrapper" } }] }], styles: [] };
    await postJSON(base, "/save", Object.assign({ name: "Loadable" }, project));

    const found = await (await fetch(base + "/load/loadable")).json();
    assert.deepStrictEqual(found, project);

    const missing = await (await fetch(base + "/load/nope")).json();
    assert.deepStrictEqual(missing, {});
  });
});

test("GET /load refuses a project saved by a newer OSCAR", async () => {
  await withServer(async (base, store, dir) => {
    // Hand-write a file claiming a future format, the way a newer OSCAR would.
    fs.writeFileSync(
      path.join(dir, "from-the-future.json"),
      JSON.stringify({
        format: 99,
        oscar: "9.9.9",
        name: "From The Future",
        data: { pages: [{ frames: [{ component: { type: "wrapper" } }] }] },
      })
    );

    const body = await (await fetch(base + "/load/from-the-future")).json();
    assert.match(body.error, /newer version of OSCAR/i);
    assert.match(body.error, /9\.9\.9/, "the message names the version that wrote it");
    assert.strictEqual(body.pages, undefined, "no data is handed back to be mangled");
  });
});

test("GET /load refuses a 1.x-era file instead of half-loading it", async () => {
  await withServer(async (base, store, dir) => {
    fs.writeFileSync(
      path.join(dir, "ancient.json"),
      JSON.stringify({ name: "Ancient", data: { "gjs-components": "[]" } })
    );

    const body = await (await fetch(base + "/load/ancient")).json();
    assert.match(body.error, /isn't an OSCAR project|damaged/i);
  });
});

test("saved files carry the format and the versions that wrote them", async () => {
  await withServer(
    async (base, store) => {
      const project = { pages: [{ frames: [{ component: { type: "wrapper" } }] }] };
      await postJSON(
        base,
        "/save",
        Object.assign({ name: "Stamped", grapesjs: "0.23.6" }, project)
      );

      const record = await store.read("stamped");
      assert.strictEqual(record.format, formatFor(project), "one page: the format an older OSCAR still opens");
      assert.strictEqual(record.oscar, "2.0.0");
      assert.strictEqual(record.grapesjs, "0.23.6");
      assert.deepStrictEqual(record.data, project, "the version fields stay out of the project");
    },
    { storeOptions: { oscarVersion: "2.0.0" } }
  );
});

test("traversal ids cannot read or delete files outside the store", async () => {
  await withServer(async (base, store, dir) => {
    const outside = path.join(dir, "..", "oscar-outside.json");
    fs.writeFileSync(outside, JSON.stringify({ name: "x", data: { secret: true } }));

    // Some of these never reach the handler at all -- Express normalises the
    // path and 404s first. Either way the contract is the same: nothing from
    // outside the store may be read, and nothing outside it may be deleted.
    for (const id of ["..%2Foscar-outside", "..\\oscar-outside", "%2E%2E%2Foscar-outside"]) {
      const read = await fetch(base + "/load/" + id);
      assert.doesNotMatch(await read.text(), /secret/, "load " + id + " leaks nothing");

      const del = await fetch(base + "/remove/" + id, { method: "DELETE" });
      const body = await del.text();
      if (del.ok) {
        assert.ok(JSON.parse(body).error, "delete of " + id + " is refused");
      }
    }

    assert.ok(fs.existsSync(outside), "the file outside the store survived");
    fs.unlinkSync(outside);
  });
});

test("DELETE /remove deletes once and then reports it is gone", async () => {
  await withServer(async (base) => {
    await postJSON(base, "/save", { name: "Temp", "gjs-components": "[]" });

    assert.match((await (await fetch(base + "/remove/temp", { method: "DELETE" })).json()).msg, /Deleted/);
    assert.ok((await (await fetch(base + "/remove/temp", { method: "DELETE" })).json()).error);
  });
});

test("pushing a preview notifies open preview pages", async () => {
  let notified = 0;
  await withServer(
    async (base) => {
      await postJSON(base, "/save/preview", { project: { pages: [] } });
      assert.strictEqual(notified, 1, "a push tells the preview pages to pick it up");

      await fetch(base + "/show/preview");
      assert.strictEqual(notified, 1, "merely reading it notifies nobody");
    },
    { onPreviewPush: () => (notified += 1) }
  );
});

test("preview hand-off round-trips through the server", async () => {
  await withServer(async (base) => {
    assert.deepStrictEqual(await (await fetch(base + "/show/preview")).json(), {});

    const project = { "gjs-components": '[{"type":"slider"}]' };
    await postJSON(base, "/save/preview", { project });

    assert.deepStrictEqual(await (await fetch(base + "/show/preview")).json(), project);
  });
});

test("GET /connection tells the browser where the OSC bridge is", async () => {
  await withServer(
    async (base) => {
      const body = await (await fetch(base + "/connection")).json();
      assert.strictEqual(body.address, "192.168.0.5");
      assert.strictEqual(body.socketPort, 18091, "the configured port, not the default");
      assert.strictEqual(body.oscInPort, 18092, "and the port OSCAR hears OSC on, for the editor to say");
    },
    { socketPort: () => 18091, oscInPort: () => 18092 }
  );
});

test("GET /connection falls back to the default bridge port", async () => {
  await withServer(async (base) => {
    const body = await (await fetch(base + "/connection")).json();
    assert.strictEqual(body.socketPort, 8081);
    assert.strictEqual(body.oscInPort, null, "unknown is said as unknown, never guessed");
  });
});

test("GET /diagnostics reports what a bug report needs", async () => {
  await withServer(
    async (base) => {
      const body = await (await fetch(base + "/diagnostics")).json();
      assert.strictEqual(body.oscar, "2.0.0");
      assert.strictEqual(body.platform, "linux");
      assert.strictEqual(body.projectFormat, CURRENT_FORMAT);
    },
    {
      diagnostics: () => ({
        oscar: "2.0.0",
        platform: "linux",
        arch: "x64",
        projectFormat: CURRENT_FORMAT,
      }),
    }
  );
});

test("GET /diagnostics is empty rather than broken when unwired", async () => {
  await withServer(async (base) => {
    assert.deepStrictEqual(await (await fetch(base + "/diagnostics")).json(), {});
  });
});

test("GET /update passes on what the checker found", async () => {
  await withServer(
    async (base) => {
      const body = await (await fetch(base + "/update")).json();
      assert.strictEqual(body.available, true);
      assert.strictEqual(body.version, "2.1.0");
    },
    { updates: { check: async () => ({ available: true, version: "2.1.0", current: "2.0.0" }) } }
  );
});

test("GET /update says nothing when no checker is wired", async () => {
  await withServer(async (base) => {
    assert.deepStrictEqual(await (await fetch(base + "/update")).json(), { available: false });
  });
});

test("a failing update check never breaks the request", async () => {
  await withServer(
    async (base) => {
      const res = await fetch(base + "/update");
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { available: false });
    },
    {
      updates: {
        check: async () => {
          throw new Error("boom");
        },
      },
    }
  );
});

test("editor pages render", async () => {
  await withServer(async (base) => {
    for (const route of ["/", "/preview"]) {
      const res = await fetch(base + route);
      assert.strictEqual(res.status, 200, route);
      const html = await res.text();
      assert.match(html, /<title>OSCAR<\/title>/, route + " renders the OSCAR shell");
      assert.doesNotMatch(html, /createwithoscar\.com\/register/, route + " has no dead account links");
    }
  });
});

test("GET /load with ?envelope=1 says who the project is as well as what is in it", async () => {
  await withServer(async (base, store) => {
    const project = { pages: [{ name: "Main", frames: [{ component: { type: "wrapper" } }] }], styles: [] };
    // One saved before projects carried an id, one that carries its own.
    await postJSON(base, "/save", Object.assign({ name: "Old Show" }, project));
    await store.save("Lobby", project, { id: "p-abc123def456" });

    const old = await (await fetch(base + "/load/old-show?envelope=1")).json();
    assert.deepStrictEqual([old.id, old.name], ["library-old-show", "Old Show"], "the same id every time it is read");
    assert.deepStrictEqual(old.data, project);

    const lobby = await (await fetch(base + "/load/lobby?envelope=1")).json();
    assert.deepStrictEqual([lobby.id, lobby.name], ["p-abc123def456", "Lobby"]);

    // Without it, the answer is the bare project, as it always was.
    assert.deepStrictEqual(await (await fetch(base + "/load/lobby")).json(), project);

    const list = await (await fetch(base + "/projects")).json();
    assert.deepStrictEqual(list.filter((row) => !row.template).map((row) => [row._id, row.id]).sort(), [["lobby", "p-abc123def456"], ["old-show", "library-old-show"]]);
  });
});

// ---- projects that live in OSCAR, by who they are ------------------------------------

const BY_ID = { pages: [{ name: "Main", frames: [{ component: { type: "wrapper" } }] }], styles: [] };
const send = (base, method, url, body) => fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

test("a project is created, opened, saved as it is edited, renamed, copied and deleted, by its id", async () => {
  await withServer(async (base) => {
    const made = await (await send(base, "POST", "/projects", { name: "Lobby", data: BY_ID, grapesjs: "0.22" })).json();
    assert.match(made.id, /^p-[a-z0-9]{12}$/);
    assert.strictEqual(made.rev, 1);

    const opened = await (await fetch(base + "/projects/" + made.id)).json();
    assert.deepStrictEqual([opened.id, opened.name, opened.rev], [made.id, "Lobby", 1]);
    assert.deepStrictEqual(opened.data, BY_ID);

    const edited = Object.assign({}, BY_ID, { styles: [{ selectors: ["#a"] }] });
    const saved = await (await send(base, "PUT", "/projects/" + made.id, { data: edited, baseRev: 1 })).json();
    assert.deepStrictEqual(saved, { id: made.id, name: "Lobby", rev: 2 });

    const renamed = await (await send(base, "PUT", "/projects/" + made.id, { name: "Main hall", baseRev: 2 })).json();
    assert.deepStrictEqual(renamed, { id: made.id, name: "Main hall", rev: 3 });
    assert.deepStrictEqual((await (await fetch(base + "/projects/" + made.id)).json()).data, edited, "a rename leaves the content alone");

    const copy = await (await send(base, "POST", "/projects/" + made.id + "/copy")).json();
    assert.strictEqual(copy.name, "Copy of Main hall");

    const list = (await (await fetch(base + "/projects")).json()).filter((row) => !row.template);
    assert.deepStrictEqual(list.map((row) => row.name).sort(), ["Copy of Main hall", "Main hall"]);

    assert.strictEqual((await send(base, "DELETE", "/projects/" + made.id)).status, 200);
    assert.strictEqual((await fetch(base + "/projects/" + made.id)).status, 404);
    assert.strictEqual((await send(base, "DELETE", "/projects/" + made.id)).status, 404);
  });
});

test("a save from a window that is behind is refused with what the project is at now", async () => {
  await withServer(async (base) => {
    const made = await (await send(base, "POST", "/projects", { name: "Lobby", data: BY_ID })).json();
    await send(base, "PUT", "/projects/" + made.id, { data: BY_ID, baseRev: 1 });
    const res = await send(base, "PUT", "/projects/" + made.id, { data: BY_ID, baseRev: 1 });
    assert.strictEqual(res.status, 409);
    const said = await res.json();
    assert.deepStrictEqual([said.conflict, said.rev], [true, 2]);
    assert.match(said.error, /was changed somewhere else/);
  });
});

test("what is not a project is not saved, and a project that is not here says so", async () => {
  await withServer(async (base) => {
    assert.strictEqual((await send(base, "POST", "/projects", { name: "Nothing", data: { not: "a project" } })).status, 400);
    assert.strictEqual((await send(base, "POST", "/projects", { name: "Nothing" })).status, 400);
    const made = await (await send(base, "POST", "/projects", { name: "Lobby", data: BY_ID })).json();
    assert.strictEqual((await send(base, "PUT", "/projects/" + made.id, { data: [] })).status, 400);
    assert.strictEqual((await send(base, "PUT", "/projects/" + made.id, {})).status, 400, "nothing to save");
    assert.strictEqual((await send(base, "PUT", "/projects/p-nosuchproj00", { data: BY_ID })).status, 404);
    assert.strictEqual((await send(base, "POST", "/projects/p-nosuchproj00/copy")).status, 404);
    assert.strictEqual((await fetch(base + "/projects/..%2Fescape")).status, 404);
  });
});

test("a file brought in that is already a project here is asked about: replace it, or keep both", async () => {
  await withServer(async (base) => {
    const file = { id: "p-fromafile001", name: "From a file", data: BY_ID };
    const first = await (await send(base, "POST", "/projects", file)).json();
    assert.strictEqual(first.id, "p-fromafile001", "not here yet: it keeps who it says it is");

    const again = await send(base, "POST", "/projects", file);
    assert.strictEqual(again.status, 409);
    const asked = await again.json();
    assert.deepStrictEqual([asked.exists, asked.id, asked.name], [true, "p-fromafile001", "From a file"]);

    const newer = Object.assign({}, BY_ID, { styles: [{ selectors: ["#newer"] }] });
    const replaced = await (await send(base, "POST", "/projects", Object.assign({}, file, { data: newer, ifExists: "replace" }))).json();
    assert.deepStrictEqual([replaced.id, replaced.replaced, replaced.rev], ["p-fromafile001", true, 2]);
    assert.deepStrictEqual((await (await fetch(base + "/projects/p-fromafile001")).json()).data, newer);

    const both = await (await send(base, "POST", "/projects", Object.assign({}, file, { ifExists: "copy" }))).json();
    assert.notStrictEqual(both.id, "p-fromafile001", "keeping both: the newcomer is another project");
    assert.strictEqual((await (await fetch(base + "/projects")).json()).filter((row) => !row.template).length, 2);
  });
});

test("a locked OSCAR lets nobody on the network open, change, create or delete a project", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "index.js"), "utf8");
  for (const route of ['router.post("/projects", editorOnly,', 'router.get("/projects/:id", editorOnly,', 'router.put("/projects/:id", editorOnly,', 'router.post("/projects/:id/copy", editorOnly,', 'router.delete("/projects/:id", editorOnly,']) {
    assert.ok(routes.includes(route), route);
  }
});
