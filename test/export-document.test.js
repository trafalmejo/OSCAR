"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildDocument,
  composeBody,
  normaliseConnection,
  inlineHtmlAssets,
  inlineCssAssets,
  guardClosingTag,
} = require("../lib/export/document");
const { resolveAsset, createAssetReader } = require("../lib/export/assets");

const PARTS = {
  html: '<body><button data-oscar="oscar-button">Go</button></body>',
  css: ".oscar-xypad { width: 220px; }",
  connection: { host: "192.168.1.7", port: 8081 },
  runtime: "/* runtime */ window.OSCAR_RUNTIME = 1;",
  socketio: "/* socket.io */ window.io = function () {};",
  styles: [".toggle { background: grey; }"],
  oscarVersion: "2.0.0",
};

function build(overrides) {
  return buildDocument(Object.assign({}, PARTS, overrides));
}

// --- one file, with everything in it ----------------------------------------

test("the export is one file carrying everything it needs", () => {
  const page = build();

  assert.match(page, /^<!doctype html>/);
  assert.ok(page.includes(PARTS.runtime), "the runtime is inlined");
  assert.ok(page.includes(PARTS.socketio), "the socket.io client is inlined");
  assert.ok(page.includes(PARTS.styles[0]), "the widget styling is inlined");
  assert.ok(page.includes(PARTS.css), "the project's own styling is inlined");
  assert.ok(page.includes("data-oscar=\"oscar-button\""), "the controls are there");

  // Nothing is fetched from anywhere: no external stylesheet, script or import.
  assert.ok(!/<link\b/i.test(page), "no external stylesheet");
  assert.ok(!/<script[^>]+\bsrc=/i.test(page), "no external script");
});

test("the file says what it needs to run, before any markup", () => {
  const page = build();
  const head = page.slice(0, page.indexOf("<body"));

  // Every report behind this feature was someone who did not know this.
  assert.match(head, /CANNOT SEND OSC ON ITS OWN/);
  assert.match(head, /192\.168\.1\.7/, "it names the machine OSCAR must run on");
  assert.match(head, /8081/, "and the port it must be reachable on");
});

test("the bridge address is baked in where the runtime will look for it", () => {
  const page = build();
  const baked = JSON.parse(page.match(/window\.OSCAR_EXPORT = (\{.*?\});/)[1]);

  assert.strictEqual(baked.host, "192.168.1.7");
  assert.strictEqual(baked.port, 8081);
});

test("the scripts come after the markup, so the controls exist when it runs", () => {
  const page = build();
  const controls = page.indexOf("<button data-oscar");

  assert.ok(controls > -1);
  assert.ok(controls < page.indexOf("window.OSCAR_EXPORT = {"), "settings come after");
  assert.ok(controls < page.indexOf(PARTS.runtime), "and so does the runtime");
});

// --- the body ---------------------------------------------------------------

test("the editor's <body> is used as the body rather than nested inside another", () => {
  // getHtml() hands back the wrapper, which is a <body>. Two of them and the
  // browser throws the inner one's attributes away, taking the project's own
  // background with them.
  const page = build({ html: '<body id="wrapper" class="stage">controls</body>' });

  assert.strictEqual(page.match(/<body/gi).length, 1);
  assert.match(page, /<body id="wrapper" class="stage">/);
});

test("markup that is not already a body gets one", () => {
  const out = composeBody("<button>Go</button>", "SCRIPTS");
  assert.match(out, /<body>[\s\S]*<button>Go<\/button>[\s\S]*SCRIPTS[\s\S]*<\/body>/);
});

test("the scripts land inside the body, not after it", () => {
  const out = composeBody("<body>controls</body>", "SCRIPTS");
  assert.ok(out.indexOf("SCRIPTS") < out.indexOf("</body>"));
});

test("a body left unclosed still gets its scripts", () => {
  const out = composeBody("<body>controls", "SCRIPTS");
  assert.ok(out.includes("SCRIPTS"));
});

// --- nothing embedded may break out of its element --------------------------

test("a closing tag inside embedded code cannot end the element early", () => {
  // A custom-code block can hold anything, including the string "</script>".
  // Unescaped, the rest of the export becomes visible text on the page.
  const page = build({ runtime: 'var end = "</script><h1>pwned</h1>";' });

  assert.ok(!page.includes("</script><h1>"), "the tag was left intact");
  assert.ok(page.includes("<\\/script>"), "and neutralised instead");
});

test("the same holds for stylesheets", () => {
  const page = build({ css: '.x::after { content: "</style>"; }' });
  assert.ok(!page.includes('content: "</style>"'));
  assert.ok(page.includes("<\\/style>"));
});

test("the baked-in settings cannot close the script they sit in", () => {
  const page = build({ title: "</script><h1>hello" });
  assert.ok(!page.includes("</script><h1>hello"));
  assert.match(page, /\\u003c\/script/);
});

test("the title is escaped where it is shown", () => {
  const page = build({ title: '<img src=x onerror="boom">' });
  assert.match(page, /<title>&lt;img src=x onerror=&quot;boom&quot;&gt;<\/title>/);
});

test("guardClosingTag leaves everything else alone", () => {
  assert.strictEqual(guardClosingTag("a < b && c > d", "script"), "a < b && c > d");
  assert.strictEqual(guardClosingTag("</svg>", "script"), "</svg>");
});

// --- the connection ---------------------------------------------------------

test("a port that cannot be read falls back to OSCAR's default, never to zero", () => {
  // Port 0 means "any free port" to a TCP stack, so it connects to nothing.
  for (const port of ["", null, undefined, "abc", 0, -1, 70000, 1.5]) {
    assert.strictEqual(normaliseConnection({ host: "x", port }).port, 8081, String(port));
  }
  assert.strictEqual(normaliseConnection({ host: "x", port: "9000" }).port, 9000);
});

test("a missing host becomes localhost rather than an empty address", () => {
  assert.strictEqual(normaliseConnection({}).host, "localhost");
  assert.strictEqual(normaliseConnection({ host: "  " }).host, "localhost");
  assert.strictEqual(normaliseConnection().host, "localhost");
});

// --- assets -----------------------------------------------------------------

test("images become part of the file, so the export survives being moved", () => {
  const readAsset = (ref) => (ref === "images/logo.png" ? "data:image/png;base64,AAA" : null);

  assert.strictEqual(
    inlineHtmlAssets('<img src="images/logo.png">', readAsset),
    '<img src="data:image/png;base64,AAA">'
  );
  assert.strictEqual(
    inlineCssAssets("body { background: url(images/logo.png); }", readAsset),
    'body { background: url("data:image/png;base64,AAA"); }'
  );
});

test("a reference that cannot be inlined is left exactly as it was", () => {
  const readAsset = () => null;
  const html = '<a href="https://example.com/x">x</a><img src="missing.png">';
  assert.strictEqual(inlineHtmlAssets(html, readAsset), html);
});

test("only files under the public folder resolve", () => {
  const root = path.join(os.tmpdir(), "oscar-export-root");

  // The markup arrives in an HTTP request, so a reference in it is untrusted.
  for (const ref of [
    "../../../etc/passwd",
    "..\\..\\windows\\win.ini",
    "/etc/passwd/../../../../etc/passwd",
    "http://example.com/x.png",
    "//example.com/x.png",
    "data:image/png;base64,AAA",
    "#anchor",
    "",
    "   ",
  ]) {
    assert.strictEqual(resolveAsset(root, ref), null, "resolved " + JSON.stringify(ref));
  }

  assert.strictEqual(resolveAsset(root, "images/a.png"), path.join(root, "images", "a.png"));
  // A leading slash is how the asset manager writes a reference, not an escape.
  assert.strictEqual(resolveAsset(root, "/images/a.png"), path.join(root, "images", "a.png"));
  // Query strings and fragments are addressing, not part of the filename.
  assert.strictEqual(resolveAsset(root, "images/a.png?v=2"), path.join(root, "images", "a.png"));
});

test("the asset reader inlines what it finds and ignores what it cannot", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-assets-"));
  fs.mkdirSync(path.join(dir, "images"));
  fs.writeFileSync(path.join(dir, "images", "dot.png"), Buffer.from([1, 2, 3]));

  const read = createAssetReader(dir);
  assert.strictEqual(read("images/dot.png"), "data:image/png;base64," + Buffer.from([1, 2, 3]).toString("base64"));
  assert.strictEqual(read("images/missing.png"), null);
  assert.strictEqual(read("../outside.png"), null);
  // A directory is not an asset.
  assert.strictEqual(read("images"), null);
});

test("an asset too big to inline is left as a link rather than bloating the file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-assets-"));
  fs.writeFileSync(path.join(dir, "big.png"), Buffer.alloc(64));

  assert.strictEqual(createAssetReader(dir, { maxBytes: 16 })("big.png"), null);
  assert.match(createAssetReader(dir, { maxBytes: 128 })("big.png"), /^data:image\/png;base64,/);
});
