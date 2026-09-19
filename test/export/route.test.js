"use strict";

/**
 * POST /export over HTTP, and the editor's side of it: the markup the GrapesJS
 * adapter hands over, driven with a stand-in editor.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const { ProjectStore } = require("../../lib/projects");
const { WIDGETS } = require("../../lib/widgets");
const { NAME_ATTR, CONFIG_ATTR, readWidget } = require("../../lib/export/config");
const createRouter = require("../../routes/index");
const { exportSnapshot } = require("../../public/src/adapters/grapesjs");

/**
 * The real router, with the runtime read from a temp file: the bundle is
 * build output and a fresh checkout running the tests has none.
 */
async function withServer(run, { locked = false, remote = false, runtime = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-export-route-"));
  const runtimeFile = path.join(dir, "runtime.bundle.js");
  if (runtime) fs.writeFileSync(runtimeFile, "/* the runtime */");

  const app = express();
  app.use(express.json({ limit: "25mb" }));
  if (remote) {
    app.use((req, res, next) => {
      Object.defineProperty(req, "socket", { value: { remoteAddress: "192.168.1.55" }, writable: true });
      next();
    });
  }
  app.use(
    "/",
    createRouter({
      store: new ProjectStore(path.join(dir, "projects")),
      serverIP: () => "192.168.0.5",
      lock: { isLocked: () => locked, setLocked() {} },
      diagnostics: () => ({ oscar: "9.9.9" }),
      exportFiles: { runtime: runtimeFile },
    })
  );

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, body) =>
  fetch(base + "/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const REQUEST = {
  title: "Main stage",
  fileName: "main-stage",
  html: '<body><button id="b1" data-oscar="oscar-button">Go</button><img src="../../package.json"></body>',
  css: "#b1{color:red;}",
  connection: { host: "192.168.0.5", port: "18271" },
};

test("POST /export answers with one downloadable page", async () => {
  await withServer(async (base) => {
    const res = await post(base, REQUEST);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.strictEqual(res.headers.get("content-disposition"), 'attachment; filename="main-stage.html"');
    assert.deepStrictEqual(JSON.parse(decodeURIComponent(res.headers.get("x-oscar-linked-assets"))), []);

    const page = await res.text();
    assert.ok(page.startsWith("<!doctype html>\n<!--"));
    assert.ok(page.includes("/* the runtime */"));
    assert.ok(page.includes('"host":"192.168.0.5","port":18271,"oscar":"9.9.9"'));
    assert.ok(page.includes('data-oscar="oscar-button"'));
    // The real toggle.css, so the controls look as they did on the canvas.
    assert.ok(page.includes(".toggle"));
    assert.ok(page.includes('src="../../package.json"'), "a traversal in the posted markup reads nothing");
    assert.ok(!page.includes('"dependencies"'));
  });
});

test("POST /export refuses what it cannot make a working page from", async () => {
  await withServer(async (base) => {
    const empty = await post(base, Object.assign({}, REQUEST, { html: "" }));
    assert.strictEqual(empty.status, 400);
    assert.match((await empty.json()).error, /nothing on the canvas/);

    const nowhere = await post(base, Object.assign({}, REQUEST, { connection: { host: "http://x", port: 1 } }));
    assert.strictEqual(nowhere.status, 400);
    assert.match((await nowhere.json()).error, /not an address/);
  });

  await withServer(
    async (base) => {
      const res = await post(base, REQUEST);
      assert.strictEqual(res.status, 500);
      assert.match((await res.json()).error, /npm run build/);
    },
    { runtime: false }
  );
});

test("locked: the layout is handed to nobody but the machine OSCAR runs on", async () => {
  await withServer(
    async (base) => {
      const res = await post(base, REQUEST);
      assert.strictEqual(res.status, 403);
      assert.match((await res.json()).error, /locked/i);
    },
    { locked: true, remote: true }
  );
  await withServer(async (base) => assert.strictEqual((await post(base, REQUEST)).status, 200), { locked: true });
});

// ---- the editor's side ---------------------------------------------------------

/** A component: a type, its properties, its attributes, its children. */
function component(type, props, attributes, children) {
  const model = {
    props: Object.assign({ type }, props),
    attributes: attributes || {},
    children: children || [],
    sets: 0,
    get(key) {
      return this.props[key];
    },
    set() {
      this.sets++;
    },
    addAttributes() {
      this.sets++;
    },
    getId() {
      return (this.attributes && this.attributes.id) || "generated1";
    },
  };
  return model;
}

/** getHtml as GrapesJS does it: the `attributes` option is asked once per component. */
function fakeEditor(pages) {
  function render(model, opts) {
    const given = Object.assign({}, model.attributes);
    const attributes = opts.attributes ? opts.attributes(model, given) : given;
    const text = Object.keys(attributes)
      .map((key) => " " + key + "='" + attributes[key] + "'")
      .join("");
    return "<" + model.props.type + text + ">" + model.children.map((c) => render(c, opts)).join("") + "</" + model.props.type + ">";
  }
  return {
    asked: [],
    Pages: { getAll: () => pages.map((main) => ({ getMainComponent: () => main })) },
    getHtml(opts) {
      this.asked.push(opts.component);
      return render(opts.component, opts);
    },
    getCss(opts) {
      return opts.component === pages[0] ? "#b1{color:red;}" : "WRONG PAGE";
    },
  };
}

function attributesIn(html, name) {
  const at = html.indexOf(NAME_ATTR + "='" + name + "'");
  assert.ok(at !== -1, name + " is not in the export");
  const tag = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at));
  const found = {};
  tag.replace(/ ([a-z-]+)='([^']*)'/g, (m, key, value) => (found[key] = value));
  return { getAttribute: (key) => (key in found ? found[key] : null) };
}

test("every widget on the canvas is carried with its settings, nested ones included, without being listed", () => {
  const models = WIDGETS.map((widget, i) =>
    component(widget.name, Object.assign({}, widget.defaults, { enabled: i % 2 === 0 }), { id: "w" + i })
  );
  const wrapper = component("wrapper", {}, { id: "body1" }, [component("row", {}, {}, models)]);
  const snapshot = exportSnapshot(fakeEditor([wrapper]));

  assert.strictEqual(snapshot.widgets, WIDGETS.length);
  assert.strictEqual(snapshot.pages, 1);
  assert.strictEqual(snapshot.css, "#b1{color:red;}");

  WIDGETS.forEach((widget, i) => {
    const el = attributesIn(snapshot.html, widget.name);
    const back = readWidget(el);
    assert.deepStrictEqual(back.config, Object.assign({}, widget.defaults, { enabled: i % 2 === 0 }), widget.name);
    assert.strictEqual(el.getAttribute("id"), "w" + i, "its name on the wire travels with it");
  });

  // Plain components gain nothing.
  assert.ok(snapshot.html.startsWith("<wrapper id='body1'><row>"));
});

test("exporting writes nothing onto the project: no second copy of the truth to save or undo", () => {
  const slider = WIDGETS.find((w) => w.name === "oscar-slider");
  const model = component(slider.name, Object.assign({}, slider.defaults), { id: "s1" });
  const wrapper = component("wrapper", {}, {}, [model]);
  const before = JSON.stringify([model.attributes, model.props]);

  exportSnapshot(fakeEditor([wrapper]));

  assert.strictEqual(model.sets + wrapper.sets, 0, "no model was written to, not even for the length of the call");
  assert.strictEqual(JSON.stringify([model.attributes, model.props]), before);
  assert.ok(!(CONFIG_ATTR in model.attributes));
});

test("a widget that never had its id pinned is still named in the export", () => {
  const button = WIDGETS.find((w) => w.name === "oscar-button");
  const model = component(button.name, Object.assign({}, button.defaults), {});
  const snapshot = exportSnapshot(fakeEditor([component("wrapper", {}, {}, [model])]));
  assert.strictEqual(attributesIn(snapshot.html, button.name).getAttribute("id"), "generated1");
  assert.deepStrictEqual(model.attributes, {});
});

test("only the first page is exported, and the count is reported so the dialog can say so", () => {
  const first = component("wrapper", {}, { id: "first" });
  const second = component("wrapper", {}, { id: "second" });
  const editor = fakeEditor([first, second]);
  const snapshot = exportSnapshot(editor);
  assert.strictEqual(snapshot.pages, 2);
  assert.deepStrictEqual(editor.asked, [first]);
  assert.ok(snapshot.html.includes("first") && !snapshot.html.includes("second"));
});
