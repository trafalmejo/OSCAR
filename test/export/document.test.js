"use strict";

/**
 * The exported file itself: one document, self-contained, that says what it
 * needs and cannot be broken out of by what is embedded in it.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildDocument, composeBody, embedJson, inlineHtmlAssets } = require("../../lib/export/document");
const { buildExport } = require("../../lib/export");

const CONNECTION = { host: "192.168.0.5", port: 8081 };

function build(overrides) {
  return buildDocument(
    Object.assign(
      {
        title: "Main stage",
        html: '<body id="i1"><button id="b1" data-oscar="oscar-button">Go</button></body>',
        css: "#b1{color:red;}",
        connection: CONNECTION,
        runtime: "/* runtime */ boot();",
        socketio: "/* socket.io */ var io;\n//# sourceMappingURL=socket.io.min.js.map",
        styles: [".toggle{opacity:1}"],
        oscarVersion: "2.0.0",
      },
      overrides
    )
  );
}

test("the file opens by saying what it needs, before any markup", () => {
  const page = build();
  const comment = page.slice(page.indexOf("<!--"), page.indexOf("-->"));
  assert.ok(page.indexOf("<!--") < page.indexOf("<html"), "at the top, where someone opening the file looks");
  assert.match(comment, /CANNOT SEND OSC OR DMX ON ITS OWN/);
  assert.match(comment, /OSCAR must be running on 192\.168\.0\.5/);
  assert.match(comment, /192\.168\.0\.5:8081/);
  assert.match(comment, /\?oscar-host=ADDRESS&oscar-port=PORT/);
  assert.match(comment, /never\s+falls back to default settings|stays switched off/);
});

test("where OSCAR is gets baked in; the page is never told to ask", () => {
  const page = build();
  assert.ok(page.includes('window.OSCAR_EXPORT = {"host":"192.168.0.5","port":8081,"oscar":"2.0.0"};'));
  assert.ok(!/\/connection\b/.test(page), "from file:// that request is exactly what 404s");
});

test("everything is in the one file, in an order that runs", () => {
  const page = build();
  assert.ok(!/<script[^>]+src=/i.test(page), "no script is fetched");
  assert.ok(!/<link[^>]+stylesheet/i.test(page), "no stylesheet is fetched");
  assert.ok(!page.includes("sourceMappingURL"), "the map is not in the file, so it is not asked for");

  const baked = page.indexOf("window.OSCAR_EXPORT");
  const socketio = page.indexOf("/* socket.io */");
  const runtime = page.indexOf("/* runtime */");
  assert.ok(baked !== -1 && baked < socketio && socketio < runtime);

  assert.ok(page.indexOf(".toggle{opacity:1}") < page.indexOf("#b1{color:red;}"), "the project's rules win over OSCAR's");
  assert.ok(page.includes("<title>Main stage</title>"));
});

test("the editor's body stays the body, so rules written against its id still apply", () => {
  const page = build();
  assert.strictEqual((page.match(/<body/g) || []).length, 1);
  assert.ok(page.includes('<body id="i1">'));
  assert.ok(page.indexOf("/* runtime */") < page.lastIndexOf("</body>"), "scripts inside it, after the controls");

  assert.strictEqual(composeBody("<div>x</div>", "<script></script>"), "<body>\n<div>x</div>\n<script></script>\n</body>");
  assert.strictEqual(composeBody("<body><p>x</p>", "T"), "<body><p>x</p>\nT", "an unclosed body is not nested in another");
});

test("embedded text cannot close the element it sits in", () => {
  const page = build({
    runtime: 'var s = "</script><h1>gotcha</h1>";',
    css: 'a::after{content:"</style><h1>gotcha</h1>"}',
    title: "</title><script>alert(1)</script>",
  });
  assert.ok(!page.includes("</script><h1>gotcha"));
  assert.ok(page.includes('var s = "<\\/script><h1>gotcha</h1>";'));
  assert.ok(!page.includes("</style><h1>gotcha"));
  assert.ok(page.includes("<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>"));
  assert.strictEqual(embedJson({ a: "</script><!--" }), '{"a":"\\u003c/script>\\u003c!--"}');
});

test("assets are inlined where markup and stylesheets embed a file, and nowhere else", () => {
  const seen = [];
  const readAsset = (ref) => {
    seen.push(ref);
    return ref === "images/bg.png" ? "data:image/png;base64,AAAA" : null;
  };
  readAsset.linked = ["images/huge--clip.mp4"];

  const page = build({
    html:
      '<body><img src="images/bg.png"><img src=\'images/other.png\'><a href="images/bg.png">x</a>' +
      '<video poster="images/bg.png" src="images/huge--clip.mp4"></video></body>',
    css: "body{background:url(images/bg.png)} .a{background:url('images/bg.png')} .b{background:url(http://x/y.png)}",
    readAsset,
  });

  assert.ok(page.includes('<img src="data:image/png;base64,AAAA">'));
  assert.ok(page.includes("<img src='images/other.png'>"), "what cannot be inlined is left exactly as it was");
  assert.ok(page.includes('<a href="images/bg.png">'), "a link is somewhere to go, not something to embed");
  assert.ok(page.includes('poster="data:image/png;base64,AAAA"'));
  assert.ok(page.includes('body{background:url("data:image/png;base64,AAAA")}'));
  assert.ok(page.includes('.a{background:url("data:image/png;base64,AAAA")}'));
  assert.ok(page.includes(".b{background:url(http://x/y.png)}"));

  // Named in the header, and unable to close the comment it is named in.
  const comment = page.slice(page.indexOf("<!--") + 4, page.indexOf("<html"));
  assert.match(comment, /have to travel with this file/);
  assert.ok(comment.includes("images/huge- -clip.mp4"));
  assert.strictEqual((comment.match(/-->/g) || []).length, 1);
});

// ---- buildExport: the request checked, the pieces read off disk -------------

function publicDir(withRuntime) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-export-build-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets", "css"), { recursive: true });
  fs.mkdirSync(path.join(dir, "node_modules", "socket.io-client", "dist"), { recursive: true });
  fs.mkdirSync(path.join(dir, "images"), { recursive: true });
  if (withRuntime) fs.writeFileSync(path.join(dir, "src", "runtime.bundle.js"), "/* runtime */");
  fs.writeFileSync(path.join(dir, "node_modules", "socket.io-client", "dist", "socket.io.min.js"), "/* socket.io */");
  fs.writeFileSync(path.join(dir, "assets", "css", "toggle.css"), ".toggle{opacity:1}");
  fs.writeFileSync(path.join(dir, "images", "dot.png"), Buffer.from([1, 2, 3]));
  return dir;
}

const REQUEST = {
  title: "Main Stage!",
  fileName: "Main Stage!",
  html: '<body><img src="images/dot.png"><img src="../secret.png"></body>',
  css: "",
  connection: { host: "192.168.0.5", port: "8081" },
};

test("an export is one page with the runtime, the client, the widget styles and the small assets in it", () => {
  const result = buildExport(REQUEST, { publicDir: publicDir(true), oscarVersion: "2.0.0" });
  assert.strictEqual(result.error, undefined);
  assert.ok(result.page.includes("/* runtime */"));
  assert.ok(result.page.includes("/* socket.io */"));
  assert.ok(result.page.includes(".toggle{opacity:1}"));
  assert.ok(result.page.includes('src="data:image/png;base64,' + Buffer.from([1, 2, 3]).toString("base64") + '"'));
  assert.ok(result.page.includes('src="../secret.png"'), "a traversal is left as the dead link it is");
  assert.strictEqual(result.filename, "main-stage.html");
  assert.deepStrictEqual(result.linked, []);
});

test("a filename that would break out of its header is rebuilt, not quoted", () => {
  const result = buildExport(Object.assign({}, REQUEST, { fileName: 'x"\r\nSet-Cookie: a=b' }), { publicDir: publicDir(true) });
  assert.match(result.filename, /^[a-z0-9-]+\.html$/);
});

test("an export with nothing in it, or nowhere to send, is refused with a reason", () => {
  const deps = { publicDir: publicDir(true) };
  assert.strictEqual(buildExport(null, deps).status, 400);
  assert.strictEqual(buildExport(Object.assign({}, REQUEST, { html: "  " }), deps).status, 400);
  assert.strictEqual(buildExport(Object.assign({}, REQUEST, { html: 5 }), deps).status, 400);

  const nowhere = buildExport(Object.assign({}, REQUEST, { connection: { host: "", port: "" } }), deps);
  assert.strictEqual(nowhere.status, 400);
  assert.match(nowhere.error, /where OSCAR/);
  // No default is reached for: an export aimed at localhost:8081 by omission
  // works on the designer's laptop and nowhere else.
  assert.strictEqual(buildExport(Object.assign({}, REQUEST, { connection: undefined }), deps).status, 400);
  assert.strictEqual(buildExport(Object.assign({}, REQUEST, { connection: { host: "x", port: 0 } }), deps).status, 400);
});

test("a missing runtime refuses the export rather than shipping a dead page", () => {
  const result = buildExport(REQUEST, { publicDir: publicDir(false) });
  assert.strictEqual(result.status, 500);
  assert.match(result.error, /runtime\.bundle\.js/);
  assert.match(result.error, /npm run build/);
  assert.strictEqual(result.page, undefined);
});

// ---- positions in the string that is cut --------------------------------------

test("the scripts land before </body> whatever the canvas says, U+0130 included", () => {
  // toLowerCase() turns each \u0130 into two units, so an index found in a
  // lowercased copy is one further along per character than the original.
  const markup = '<body id="x"><p>\u0130\u0130stanbul</p><p>\u0130leri \u0130ptal</p></body>';
  const out = composeBody(markup, "<script>TAIL</script>");
  assert.ok(out.endsWith("<script>TAIL</script>\n</body>"), out.slice(-40));
  assert.ok(out.startsWith('<body id="x"><p>\u0130\u0130stanbul</p>'));
});

test("a closing tag is found in any case, and the last one wins", () => {
  assert.ok(composeBody("<BODY><p>a</p></BODY >", "TAIL").endsWith("TAIL\n</BODY >"));
  const twice = composeBody("<body><pre>&lt;/body&gt;</pre><i></body></i></body>", "TAIL");
  assert.ok(twice.endsWith("<i></body></i>\nTAIL\n</body>"));
});

test("a whole export with Turkish labels still says where OSCAR is", () => {
  const out = buildDocument({
    html: "<body><p>\u0130\u0130\u0130\u0130\u0130\u0130\u0130\u0130</p></body>",
    connection: { host: "10.0.0.2", port: 8081 },
    runtime: "RUNTIME();",
    socketio: "IO();",
  });
  assert.match(out, /<script>\nwindow\.OSCAR_EXPORT = \{"host":"10\.0\.0\.2"/);
  assert.match(out, /RUNTIME\(\);\n<\/script>\n<\/body>\n<\/html>\n$/);
});

// ---- references are attributes, not text that looks like one ------------------

test("only a real src or poster attribute is inlined", () => {
  const read = (reference) => (reference === "a.png" ? "data:image/png;base64,AAAA" : null);
  const uri = "data:image/png;base64,AAAA";

  const title = "<p title=\"paste src='a.png' > here\">src=\"a.png\"</p>";
  assert.strictEqual(inlineHtmlAssets(title, read), title, "a title's value and text are left alone");

  assert.strictEqual(inlineHtmlAssets("<img data-src=\"a.png\">", read), "<img data-src=\"a.png\">");
  assert.strictEqual(inlineHtmlAssets("<img alt=\"x>y\" src='a.png'/>", read), "<img alt=\"x>y\" src='" + uri + "'/>");
  assert.strictEqual(inlineHtmlAssets("<video controls POSTER=\"a.png\" src=\"b.mp4\">", read), '<video controls POSTER="' + uri + '" src="b.mp4">');
});

test("an unquoted src is inlined too, not left as a relative link", () => {
  const read = (reference) => (reference === "images/x.png" ? "data:image/png;base64,AAAA" : null);
  assert.strictEqual(inlineHtmlAssets("<img src=images/x.png>", read), '<img src="data:image/png;base64,AAAA">');
});

test("a rewritten attribute keeps the quotes it came with, so a script string holding markup stays valid", () => {
  // The pass also sees tag-like text inside an inline script. Turning the
  // single quotes double here closed the JavaScript string early: a syntax
  // error in the exported page, and none of its script ran.
  const read = () => "data:image/png;base64,AAAA";
  const script = "<script>var s=\"<img src='images/a.png'>\";</script>";
  const out = inlineHtmlAssets(script, read);
  assert.strictEqual(out, "<script>var s=\"<img src='data:image/png;base64,AAAA'>\";</script>");
  assert.doesNotThrow(() => new Function(out.replace(/<\/?script>/g, "")));
});
