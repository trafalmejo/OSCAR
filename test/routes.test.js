"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const { ProjectStore } = require("../lib/projects");
const { CURRENT_FORMAT } = require("../lib/project-format");
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

test("GET /load returns the project, and {} when missing", async () => {
  await withServer(async (base) => {
    const project = { pages: [{ frames: [{ component: { type: "wrapper" } }] }], styles: [] };
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
      assert.strictEqual(record.format, CURRENT_FORMAT);
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
    },
    { socketPort: () => 18091 }
  );
});

test("GET /connection falls back to the default bridge port", async () => {
  await withServer(async (base) => {
    const body = await (await fetch(base + "/connection")).json();
    assert.strictEqual(body.socketPort, 8081);
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
