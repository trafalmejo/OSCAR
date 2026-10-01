"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const { PublishedStore, markServed, RESERVED } = require("../lib/published");
const { surfaceAddress } = require("../lib/published-address");
const { ProjectStore } = require("../lib/projects");
const createRouter = require("../routes/index");
const { resolveEndpoint } = require("../public/src/adapters/standalone");

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

// ---- the store -------------------------------------------------------------------

test("a surface is published under a name made safe, and publishing again replaces it", async () => {
  const store = new PublishedStore(tmp("oscar-published-"));
  assert.deepStrictEqual(await store.list(), []);

  const first = await store.save("Main Stage!", "<p>one</p>");
  assert.deepStrictEqual(first, { id: "main-stage", replaced: false });
  assert.strictEqual(await store.read("main-stage"), "<p>one</p>");

  // The address people have bookmarked has to stay good.
  const again = await store.save("main stage", "<p>two</p>");
  assert.deepStrictEqual(again, { id: "main-stage", replaced: true });
  assert.strictEqual(await store.read("main-stage"), "<p>two</p>");
  assert.deepStrictEqual((await store.list()).map((p) => p.id), ["main-stage"]);

  assert.strictEqual(await store.remove("main-stage"), true);
  assert.strictEqual(await store.remove("main-stage"), false);
  assert.strictEqual(await store.read("main-stage"), null);
});

test("publishing leaves no half-written page behind", async () => {
  const dir = tmp("oscar-published-");
  const store = new PublishedStore(dir);
  await store.save("a", "<p>a</p>");
  assert.deepStrictEqual(fs.readdirSync(dir), ["a.html"]);
});

test("an id cannot reach outside the folder, and OSCAR's own addresses cannot be taken", async () => {
  const dir = tmp("oscar-published-");
  const store = new PublishedStore(dir);
  fs.writeFileSync(path.join(dir, "..", "secret.html"), "secret");
  for (const bad of ["../secret", "..%2Fsecret", "a/b", "", ".", "A", "a b"]) {
    assert.strictEqual(await store.read(bad), null, JSON.stringify(bad));
    assert.strictEqual(await store.remove(bad), false, JSON.stringify(bad));
  }
  // GET /show/preview is the editor's hand-off; a page there could never be reached.
  assert.ok(RESERVED.includes("preview"));
  assert.strictEqual(store.idFor("Preview"), null);
  await assert.rejects(() => store.save("preview", "<p>x</p>"), /cannot be published/);
  assert.strictEqual(await store.read("preview"), null);
});

// ---- served by OSCAR ----------------------------------------------------------------

test("a served page is told so just before the address baked into it, and the file itself is untouched", () => {
  const page = '<html><body><p>x</p>\n<script>\nwindow.OSCAR_EXPORT = {"host":"10.0.0.5","port":8081};\n</script>\n</body></html>';
  const served = markServed(page, 18301);
  assert.ok(served.indexOf("window.OSCAR_SERVED = {\"port\":18301};") < served.indexOf("window.OSCAR_EXPORT"));
  assert.strictEqual(served.replace('<script>\nwindow.OSCAR_SERVED = {"port":18301};\n</script>\n', ""), page);
  // Nothing to say, or nowhere to say it: the page goes out as it is.
  for (const port of [undefined, 0, 70000, "x", 1.5]) assert.strictEqual(markServed(page, port), page, String(port));
  assert.strictEqual(markServed("<p>not an export</p>", 18301), "<p>not an export</p>");
});

test("a page OSCAR serves talks to the OSCAR that served it, not to the address it was exported with", () => {
  const baked = { host: "192.168.0.5", port: 8081 };
  // The laptop has moved network since publishing; the baked address is stale.
  assert.deepStrictEqual(resolveEndpoint(baked, "", { hostname: "10.1.1.7", port: 18301 }), { host: "10.1.1.7", port: 18301 });
  // Opened from disk, or hosted elsewhere: nothing was said, so the baked address stands.
  assert.deepStrictEqual(resolveEndpoint(baked, "", null), baked);
  assert.deepStrictEqual(resolveEndpoint(baked, ""), baked);
  // An address typed by a person still outranks both.
  assert.deepStrictEqual(resolveEndpoint(baked, "?oscar-host=10.9.9.9&oscar-port=9001", { hostname: "10.1.1.7", port: 18301 }), { host: "10.9.9.9", port: 9001 });
  // Half of one address and half of another is nowhere: both, or the baked one.
  assert.deepStrictEqual(resolveEndpoint(baked, "", { hostname: "10.1.1.7", port: "x" }), baked);
  assert.deepStrictEqual(resolveEndpoint(baked, "", { hostname: "", port: 18301 }), baked);
});

test("the address shown for a surface is one another device can use", () => {
  assert.strictEqual(surfaceAddress("192.168.2.11", 18300, "/show/main-stage"), "http://192.168.2.11:18300/show/main-stage");
  assert.strictEqual(surfaceAddress("oscar.local", "8080", "/show/a"), "http://oscar.local:8080/show/a");
  assert.strictEqual(surfaceAddress("192.168.2.11", 80, "/show/a"), "http://192.168.2.11/show/a", "80 is what http means already");
  assert.strictEqual(surfaceAddress("fe80::1", 8080, "/show/a"), "http://[fe80::1]:8080/show/a");
  for (const bad of [["", 8080, "/show/a"], [null, 8080, "/show/a"], ["h", 8080, "show/a"], ["h", 8080, null]]) {
    assert.strictEqual(surfaceAddress(...bad), "", JSON.stringify(bad));
  }
});

// ---- the routes ------------------------------------------------------------------------

async function withServer(run, options = {}) {
  const publicDir = tmp("oscar-publish-public-");
  fs.mkdirSync(path.join(publicDir, "src"), { recursive: true });
  const runtime = path.join(publicDir, "runtime.js");
  const socketio = path.join(publicDir, "socketio.js");
  fs.writeFileSync(runtime, "/* runtime */");
  fs.writeFileSync(socketio, "/* socket.io */");

  const published = new PublishedStore(tmp("oscar-published-"));
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use(
    "/",
    createRouter({
      store: new ProjectStore(tmp("oscar-publish-projects-")),
      serverIP: () => "192.168.0.5",
      socketPort: () => 18301,
      published: options.noStore ? undefined : published,
      exportFiles: { runtime, socketio, widgetCss: [] },
      lock: options.lock,
    })
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port, published);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const REQUEST = {
  title: "Main Stage",
  fileName: "Main Stage",
  html: '<body><button id="b1" data-oscar="oscar-button">Go</button></body>',
  css: "",
  connection: { host: "192.168.0.5", port: "18301" },
};
const post = (base, url, body) => fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("publish, open, list, publish again, unpublish", async () => {
  await withServer(async (base, store) => {
    assert.deepStrictEqual(await (await fetch(base + "/published")).json(), []);

    const answer = await (await post(base, "/publish", REQUEST)).json();
    assert.deepStrictEqual([answer.id, answer.path, answer.replaced], ["main-stage", "/show/main-stage", false]);

    // What is kept is exactly the export; what is served also says who served it.
    const kept = await store.read("main-stage");
    assert.ok(kept.includes("window.OSCAR_EXPORT") && !kept.includes("OSCAR_SERVED"));
    const res = await fetch(base + "/show/main-stage");
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.strictEqual(res.headers.get("cache-control"), "no-store", "publishing again has to show on a reload");
    const served = await res.text();
    assert.ok(served.includes('window.OSCAR_SERVED = {"port":18301};'));
    assert.ok(served.includes('data-oscar="oscar-button"'));

    const list = await (await fetch(base + "/published")).json();
    assert.deepStrictEqual(list.map((p) => [p.id, p.path]), [["main-stage", "/show/main-stage"]]);

    // The address is somebody's running show: it is not replaced without the question being answered.
    const asked = await (await post(base, "/publish", REQUEST)).json();
    assert.match(asked.confirm, /already an interface at \/show\/main-stage\. Replace it\?/);
    assert.strictEqual(asked.address, "main-stage");
    assert.strictEqual((await (await post(base, "/publish", Object.assign({}, REQUEST, { replace: true }))).json()).replaced, true);

    assert.strictEqual((await fetch(base + "/published/main-stage", { method: "DELETE" })).status, 200);
    assert.strictEqual((await fetch(base + "/published/main-stage", { method: "DELETE" })).status, 404);
    assert.strictEqual((await fetch(base + "/show/main-stage")).status, 404);
  });
});

test("publishing asks for no address: OSCAR's own is what goes into the stored page", async () => {
  await withServer(async (base, store) => {
    // The dialog sends no connection at all when publishing.
    const bare = Object.assign({}, REQUEST);
    delete bare.connection;
    const res = await post(base, "/publish", bare);
    assert.strictEqual(res.status, 200, "nothing about where OSCAR is has to be supplied");
    assert.ok((await store.read("main-stage")).includes('window.OSCAR_EXPORT = {"host":"192.168.0.5","port":18301'));

    // And one that is sent cannot matter: a typo there must not end up in a
    // page that would otherwise work.
    await post(base, "/publish", Object.assign({}, REQUEST, { connection: { host: "10.9.9.9", port: "1" } }));
    const kept = await store.read("main-stage");
    assert.ok(kept.includes('"host":"192.168.0.5","port":18301'));
    assert.ok(!kept.includes("10.9.9.9"));
  });
});

test("a download still has to be told where OSCAR is, since a file cannot ask", async () => {
  await withServer(async (base) => {
    const bare = Object.assign({}, REQUEST);
    delete bare.connection;
    const res = await post(base, "/export", bare);
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /where OSCAR/);
    assert.strictEqual((await post(base, "/export", REQUEST)).status, 200);
  });
});

test("a published surface can be taken away as a file, told where OSCAR is", async () => {
  await withServer(async (base, store) => {
    await post(base, "/publish", REQUEST);
    const res = await fetch(base + "/published/main-stage/file?host=10.0.0.9&port=9001");
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get("content-disposition"), /attachment; filename="main-stage\.html"/);
    const file = await res.text();
    assert.ok(file.includes('window.OSCAR_EXPORT = {"host":"10.0.0.9","port":9001'), "the address given, not OSCAR's own");
    assert.ok(!file.includes("OSCAR_SERVED"), "a file is not served");
    assert.ok((await store.read("main-stage")).includes('"host":"192.168.0.5"'), "and the stored page is untouched");

    assert.strictEqual((await fetch(base + "/published/main-stage/file?port=9001")).status, 400, "a file has to be told where OSCAR is");
    assert.match((await (await fetch(base + "/published/main-stage/file?host=10.0.0.9&port=x")).json()).error, /bridge port/);
    assert.strictEqual((await fetch(base + "/published/nowhere/file?host=10.0.0.9&port=9001")).status, 404);
  });
});

test("what cannot be exported cannot be published, and the reason comes back", async () => {
  await withServer(async (base) => {
    const empty = await post(base, "/publish", Object.assign({}, REQUEST, { html: "  " }));
    assert.strictEqual(empty.status, 400);
    const taken = await post(base, "/publish", Object.assign({}, REQUEST, { fileName: "preview" }));
    assert.strictEqual(taken.status, 400);
    assert.match((await taken.json()).error, /OSCAR uses itself/);
    assert.deepStrictEqual(await (await fetch(base + "/published")).json(), []);
  });
});

test("the editor's hand-off at /show/preview is not shadowed by the published pages", async () => {
  await withServer(async (base) => {
    const res = await fetch(base + "/show/preview");
    assert.match(res.headers.get("content-type"), /json/);
    assert.deepStrictEqual(await res.json(), {});
    assert.strictEqual((await fetch(base + "/show/nothing-here")).status, 404);
    assert.strictEqual((await fetch(base + "/show/..%2Fsecret")).status, 404);
  });
});

test("a locked OSCAR still serves its published surfaces, and lets nobody on the network change them", async () => {
  // The test client is on loopback, which is the one address a lock lets edit.
  // So publish first, then check the routes are the ones the lock covers.
  const router = createRouter({ store: new ProjectStore(tmp("oscar-lock-")), serverIP: () => "x", lock: { isLocked: () => true, setLocked() {} } });
  const guarded = (method, route) => {
    const layer = router.stack.find((l) => l.route && l.route.path === route && l.route.methods[method]);
    assert.ok(layer, method + " " + route + " exists");
    return layer.route.stack.length > 1;
  };
  assert.strictEqual(guarded("post", "/publish"), true, "publishing is editing");
  assert.strictEqual(guarded("delete", "/published/:id"), true, "so is unpublishing");
  assert.strictEqual(guarded("get", "/published"), true);
  assert.strictEqual(guarded("get", "/show/:id"), false, "opening a surface is driving the show");
});

test("an OSCAR started without anywhere to publish says so instead of failing", async () => {
  await withServer(
    async (base) => {
      assert.strictEqual((await post(base, "/publish", REQUEST)).status, 503);
      assert.deepStrictEqual(await (await fetch(base + "/published")).json(), []);
      assert.strictEqual((await fetch(base + "/show/main-stage")).status, 404);
    },
    { noStore: true }
  );
});

test("whoever keeps a copy elsewhere is told of a publish, and a listener that throws spoils nothing", async () => {
  const store = new PublishedStore(fs.mkdtempSync(path.join(os.tmpdir(), "oscar-published-")));
  const told = [];
  store.onSaved(() => { throw new Error("mine"); });
  const stop = store.onSaved((id) => told.push(id));
  assert.deepStrictEqual(await store.save("Lobby", "<p>one</p>"), { id: "lobby", replaced: false });
  await store.save("Lobby", "<p>two</p>");
  stop();
  await store.save("Lobby", "<p>three</p>");
  assert.deepStrictEqual(told, ["lobby", "lobby"]);
});

test("whoever keeps a copy elsewhere is told of an unpublish, and only of one that happened", async () => {
  const store = new PublishedStore(fs.mkdtempSync(path.join(os.tmpdir(), "oscar-published-")));
  const told = [];
  store.onRemoved(() => { throw new Error("mine"); });
  const stop = store.onRemoved((id) => told.push(id));
  await store.save("Lobby", "<p>one</p>");
  assert.strictEqual(await store.remove("lobby"), true);
  assert.strictEqual(await store.remove("lobby"), false, "nothing left to remove");
  assert.deepStrictEqual(told, ["lobby"], "told once, for the unpublish that happened");
  await store.save("Stage", "<p>two</p>");
  stop();
  await store.remove("stage");
  assert.deepStrictEqual(told, ["lobby"]);
  // And extensions hear it through surfaces, beside onPublished.
  const { createSurfaces } = require("../lib/surfaces");
  const surfaces = createSurfaces({ published: store, sendOSC() {}, sendDMX() {} });
  const heard = [];
  surfaces.onUnpublished((id) => heard.push(id));
  await store.save("Foyer", "<p>three</p>");
  await store.remove("foyer");
  assert.deepStrictEqual(heard, ["foyer"]);
});

// ---- a surface remembers the project it was published from --------------------------

const PROJECT = { format: 2, name: "Main Stage", id: "p-mainstage001", data: { pages: [{ name: "Page 1", frames: [{ component: { type: "wrapper" } }] }], styles: [] } };
const FROM_PROJECT = Object.assign({}, REQUEST, { fileName: "stage", project: { id: PROJECT.id, name: PROJECT.name }, source: PROJECT });

test("beside a published page: which project it is, and the project itself, to edit from later", async () => {
  await withServer(async (base, store) => {
    await post(base, "/publish", FROM_PROJECT);
    const [row] = await (await fetch(base + "/published")).json();
    assert.deepStrictEqual([row.id, row.name, row.project, row.editable], ["stage", "Main Stage", "p-mainstage001", true]);

    const record = await store.record("stage");
    assert.deepStrictEqual(record.project, { id: "p-mainstage001", name: "Main Stage" });
    assert.ok(!Number.isNaN(Date.parse(record.publishedAt)));

    // Edit: the project comes back as a project the editor can load, with who it is.
    const edit = await (await fetch(base + "/published/stage/project")).json();
    assert.deepStrictEqual([edit.id, edit.name, Array.isArray(edit.data.pages)], ["p-mainstage001", "Main Stage", true]);

    // The page list is still only the pages.
    assert.deepStrictEqual((await store.list()).map((p) => p.id), ["stage"]);
  });
});

test("the same project publishes again without a word; another project is asked about first", async () => {
  await withServer(async (base, store) => {
    await post(base, "/publish", FROM_PROJECT);
    const again = await (await post(base, "/publish", FROM_PROJECT)).json();
    assert.deepStrictEqual([again.id, again.replaced, again.confirm], ["stage", true, undefined], "its own address: Update is one click");

    const other = Object.assign({}, FROM_PROJECT, { project: { id: "p-somethingelse", name: "Bar" }, source: Object.assign({}, PROJECT, { id: "p-somethingelse", name: "Bar" }) });
    const asked = await (await post(base, "/publish", other)).json();
    assert.match(asked.confirm, /published from "Main Stage"\. Replace it\?/);
    assert.strictEqual((await store.record("stage")).project.id, "p-mainstage001", "nothing changed while the question stands");

    // Yes: the address is that project's from now on.
    await post(base, "/publish", Object.assign({}, other, { replace: true }));
    assert.deepStrictEqual((await store.record("stage")).project, { id: "p-somethingelse", name: "Bar" });
    assert.strictEqual((await (await fetch(base + "/published/stage/project")).json()).name, "Bar");
  });
});

test("a page published with no project has nothing to edit from, and says so", async () => {
  await withServer(async (base, store) => {
    await post(base, "/publish", REQUEST);
    const [row] = await (await fetch(base + "/published")).json();
    assert.deepStrictEqual([row.name, row.project, row.editable], [null, null, false]);
    const res = await fetch(base + "/published/main-stage/project");
    assert.strictEqual(res.status, 404);
    assert.match((await res.json()).error, /cannot be edited here/);

    // A project takes the address over, once the question is answered: the page gains its record.
    await post(base, "/publish", Object.assign({}, FROM_PROJECT, { fileName: "Main Stage", replace: true }));
    assert.strictEqual((await store.record("main-stage")).project.id, "p-mainstage001");

    // And a page with no project published over it loses what was beside it:
    // another project's copy must not be taken for this page's.
    await post(base, "/publish", Object.assign({}, REQUEST, { replace: true }));
    assert.strictEqual(await store.record("main-stage"), null);
    assert.strictEqual(await store.project("main-stage"), null);
  });
});

test("a project that cannot be opened again is not kept as the copy to edit from", async () => {
  await withServer(async (base, store) => {
    await post(base, "/publish", Object.assign({}, FROM_PROJECT, { source: { nothing: "like a project" } }));
    const [row] = await (await fetch(base + "/published")).json();
    assert.deepStrictEqual([row.project, row.editable], ["p-mainstage001", false], "known as that project, with nothing to edit from");
    assert.strictEqual((await fetch(base + "/published/stage/project")).status, 404);
  });
});

test("taking a surface down takes its record and its project copy with it", async () => {
  await withServer(async (base, store) => {
    await post(base, "/publish", FROM_PROJECT);
    assert.deepStrictEqual(fs.readdirSync(store.dir).sort(), ["stage.html", "stage.json", "stage.project.json"]);
    assert.strictEqual((await fetch(base + "/published/stage", { method: "DELETE" })).status, 200);
    assert.deepStrictEqual(fs.readdirSync(store.dir), []);
  });
});

test("a locked OSCAR does not hand a surface's project to the network", async () => {
  await withServer(
    async (base) => {
      // The request comes from this machine, which a lock lets through; the guard is what is checked.
      assert.strictEqual((await fetch(base + "/published/none/project")).status, 404);
    },
    { lock: { isLocked: () => true } }
  );
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "index.js"), "utf8");
  assert.match(routes, /router\.get\("\/published\/:id\/project", editorOnly,/);
});

test("an interface is not outdated because building it embedded its pictures: the stamp is of what the editor sent", async () => {
  const { surfaceStamp } = require("../lib/export/stamp");
  await withServer(async (base, store) => {
    const sent = '<body><div id="m1" data-oscar="oscar-media-browser" data-oscar-config="{&quot;items&quot;:&quot;Beams|1|images/beams.jpg&quot;}"></div></body>';
    await post(base, "/publish", Object.assign({}, FROM_PROJECT, { html: sent }));
    // As building does to a page: the picture goes into the widget's settings.
    const built = await store.read("stage");
    fs.writeFileSync(path.join(store.dir, "stage.html"), built.replace("images/beams.jpg", "data:image/jpeg;base64,AAAA"));
    const [row] = await (await fetch(base + "/published")).json();
    assert.strictEqual(row.stamp, surfaceStamp(sent), "what the canvas will be compared with is what the canvas sent");
    assert.notStrictEqual(surfaceStamp(await store.read("stage")), row.stamp, "which the built page itself no longer matches");
  });
});
