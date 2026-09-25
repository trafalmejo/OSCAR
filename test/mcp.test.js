"use strict";

// OSCAR for AI assistants (lib/mcp/): levels one and two. Reading and
// diagnosing changes nothing; building saves a draft for a person to review
// and never touches the wire. The rails: loopback only, a per-boot bearer
// token compared in constant time, validators between an assistant and a
// saved file, and features.MCP as the off switch.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { validateSurface } = require("../lib/mcp/validate");
const { buildTools, HOWTO } = require("../lib/mcp/tools");
const { tokenMatches, newToken, attachMcp } = require("../lib/mcp/http");
const { byName } = require("../lib/widgets");
const { exportAttributes } = require("../lib/export/config");
const { PublishedStore } = require("../lib/published");
const features = require("../lib/features");

function tag(name, id, settings) {
  const definition = byName[name];
  const config = Object.assign({}, definition.defaults, settings);
  // The widget's own attributes (class, type) are what matches() knows it by,
  // exactly as a template or an assistant's HTML must carry them.
  const attributes = Object.assign(id ? { id } : {}, definition.attributes || {}, { "data-gjs-dmode": "flow" }, exportAttributes(name, (key) => config[key]));
  const text = Object.entries(attributes)
    .map(([k, v]) => k + '="' + String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"')
    .join(" ");
  return "<" + definition.tag + " " + text + "></" + definition.tag + ">";
}

const page = (body) => "<!doctype html><html><head><title>A Desk</title></head><body>" + body + "</body></html>";

// ---- the judge -------------------------------------------------------------

test("a clean surface passes; the usual mistakes are each named", () => {
  const good = validateSurface(page(tag("oscar-slider", "dim", { message: "/dim", min: 0, max: 1 })));
  assert.deepStrictEqual(good, { ok: true, widgets: 1, problems: [], warnings: [] });

  assert.match(validateSurface("<p>no body tag here").problems[0], /no <body>/);
  assert.match(validateSurface(page(tag("oscar-slider", null, { message: "/dim" }))).problems[0], /has no id/);
  const twice = tag("oscar-slider", "a", { message: "/x" }) + tag("oscar-slider", "a", { message: "/y" });
  assert.match(validateSurface(page(twice)).problems[0], /used twice/);
  assert.match(validateSurface(page('<div id="b" data-gjs-message="/x"></div>')).problems[0], /not a widget/);
  const bad = validateSurface(page(tag("oscar-slider", "c", { message: "no-slash" })));
  assert.ok(bad.problems.some((p) => /message/.test(p)), "a bad OSC address is refused: " + bad.problems.join("; "));
});

test("a setting the widget's own panel would refuse is refused here, and unknown settings are named", () => {
  const html = page('<input type="range" class="oscar-slider" id="d" data-oscar="oscar-slider" data-gjs-message="/d" data-gjs-nonsense="7">');
  const judged = validateSurface(html);
  assert.ok(judged.problems.some((p) => /"nonsense" is not a/.test(p)), judged.problems.join("; "));
});

test("warnings guide without blocking: no title, no widgets", () => {
  const untitled = validateSurface("<!doctype html><body>" + tag("oscar-button", "go", { message: "/go" }) + "</body>");
  assert.strictEqual(untitled.ok, true);
  assert.match(untitled.warnings[0], /No <title>/);
  const empty = validateSurface(page("<div></div>"));
  assert.strictEqual(empty.ok, true);
  assert.match(empty.warnings[0], /No widgets/);
});

// ---- the tools -------------------------------------------------------------

async function bench() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oscar-mcp-"));
  const published = new PublishedStore(path.join(dir, "published"));
  await published.save("Stage", page(tag("oscar-slider", "dim", { message: "/dim", min: 0, max: 1 })));
  const tools = buildTools({
    version: "9.9.9",
    features: { MIDI: true },
    httpPort: () => 8000,
    oscInPort: () => 8880,
    socketPort: () => 8081,
    store: { list: async () => [{ name: "one" }] },
    published,
    midi: { status: () => ({ supported: true, driver: "supervised", restarts: 0 }), ports: () => ({ supported: true, outputs: ["Fake Out"], inputs: [] }) },
    liveLog: () => [{ at: 1, dir: "in", protocol: "osc", what: "/dim", n: 3 }],
    lock: { isLocked: () => false },
    draftsDir: path.join(dir, "assistant"),
  });
  const by = {};
  for (const tool of tools) by[tool.name] = tool;
  return { by, dir, tools };
}

test("level one reads: status, the published roster, one surface's widgets, the recent activity", async () => {
  const { by } = await bench();
  const status = await by.status.handler({});
  assert.strictEqual(status.version, "9.9.9");
  assert.deepStrictEqual(status.ports, { http: 8000, oscIn: 8880, socket: 8081 });
  assert.strictEqual(status.published, 1);
  assert.strictEqual(status.midi.driver, "supervised");

  const roster = await by.list_published.handler({});
  assert.deepStrictEqual(roster.published, [{ id: "stage", path: "/show/stage", widgets: 1 }]);

  const surface = await by.read_surface.handler({ surface: "stage" });
  assert.strictEqual(surface.widgets[0].id, "dim");
  assert.strictEqual(surface.widgets[0].config.message, "/dim");
  assert.match((await by.read_surface.handler({ surface: "nope" })).error, /no published surface/);

  const activity = await by.recent_activity.handler({});
  assert.strictEqual(activity.activity[0].what, "/dim");
});

test("describe_widgets says how to write a surface, and what every setting means", async () => {
  const { by } = await bench();
  const told = await by.describe_widgets.handler({});
  assert.strictEqual(told.howto, HOWTO);
  assert.match(told.howto, /data-gjs-min-x/, "the attribute encoding is spelled out");
  const slider = told.widgets.find((w) => w.widget === "oscar-slider");
  assert.ok(slider.settings.some((s) => s.key === "message"), "the address setting is described");
  assert.ok(slider.settings.some((s) => s.hint), "settings carry their hints");
  assert.ok(told.widgets.length >= 9);
});

test("create_surface refuses what the validators refuse, saves what is clean, and will not overwrite unasked", async () => {
  const { by, dir } = await bench();
  const refused = await by.create_surface.handler({ name: "Bad Desk", html: page(tag("oscar-slider", null, { message: "/x" })) });
  assert.strictEqual(refused.saved, false);
  assert.match(refused.problems[0], /has no id/);

  const html = "<!doctype html><body>" + tag("oscar-button", "go", { message: "/go" }) + "</body>";
  const saved = await by.create_surface.handler({ name: "Show Desk", html });
  assert.strictEqual(saved.saved, true);
  assert.strictEqual(saved.draft, "show-desk");
  const file = path.join(dir, "assistant", "show-desk.html");
  assert.match(fs.readFileSync(file, "utf8"), /<title>Show Desk<\/title>/, "an untitled draft is given its name");

  const again = await by.create_surface.handler({ name: "Show Desk", html });
  assert.strictEqual(again.saved, false);
  assert.match(again.problems[0], /already exists/);
  const replaced = await by.create_surface.handler({ name: "Show Desk", html, overwrite: true });
  assert.strictEqual(replaced.saved, true);
});

test("no tool touches the wire: nothing named send, drive, publish or unpublish", async () => {
  const { tools } = await bench();
  for (const tool of tools) {
    assert.ok(!/^(send|drive|publish|unpublish|operate)/i.test(tool.name), tool.name + " sounds like level three");
  }
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "mcp", "tools.js"), "utf8");
  for (const forbidden of ["sendOSC", "sendDMX", "sendMIDI", ".drive(", "published.save", "published.remove"]) {
    assert.ok(source.indexOf(forbidden) === -1, "tools.js reaches for " + forbidden);
  }
});

// ---- the front door --------------------------------------------------------

function fakeApp() {
  const routes = {};
  return {
    post: (p, h) => (routes["POST " + p] = h),
    get: (p, h) => (routes["GET " + p] = h),
    delete: (p, h) => (routes["DELETE " + p] = h),
    routes,
  };
}

function fakeRes() {
  const res = {
    code: 200,
    body: null,
    status: (c) => ((res.code = c), res),
    json: (b) => ((res.body = b), res),
    set: () => res,
    end: () => res,
    on: () => res,
  };
  return res;
}

test("the door: loopback only, then the token, in that order and in constant time", async () => {
  const app = fakeApp();
  const token = attachMcp(app, { tools: [], version: "9.9.9" });
  assert.ok(token && token.length >= 32, "a real token");

  const far = fakeRes();
  await app.routes["POST /mcp"]({ socket: { remoteAddress: "192.168.2.40" }, headers: { authorization: "Bearer " + token } }, far);
  assert.strictEqual(far.code, 403, "the right token from the wrong machine is still refused");

  const wrong = fakeRes();
  await app.routes["POST /mcp"]({ socket: { remoteAddress: "127.0.0.1" }, headers: { authorization: "Bearer nope" } }, wrong);
  assert.strictEqual(wrong.code, 401);

  assert.strictEqual(tokenMatches("Bearer " + token, token), true);
  assert.strictEqual(tokenMatches("Bearer " + token + "x", token), false);
  assert.strictEqual(tokenMatches(undefined, token), false);
  assert.notStrictEqual(newToken(), newToken());

  const gone = fakeRes();
  await app.routes["GET /mcp"]({}, gone);
  assert.strictEqual(gone.code, 405, "stateless: nothing to stream, nothing to end");
});

// ---- the wiring, read from the sources --------------------------------------

const readSource = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8").replace(/\r\n/g, "\n");

test("the switch, the handshake, and the drafts' way into the Load list", () => {
  assert.strictEqual(typeof features.DEFAULTS.MCP, "boolean", "MCP is a feature switch");
  const server = readSource("server.js");
  assert.match(server, /if \(features\.MCP\) \{/, "off means the route does not exist");
  assert.match(server, /\.oscar", "mcp\.json"/, "the handshake file an assistant's shim reads");
  assert.match(server, /mode: 0o600/, "readable by this user alone");
  const routes = readSource("routes", "index.js");
  assert.match(routes, /\/\^\[a-z0-9\]\[a-z0-9-\]\*\\\.html\$\//, "the drafts route takes flat names only");
  assert.match(routes, /listTemplates\(draftsDir, \{ name: "assistant", urlPrefix: "drafts\/" \}\)/, "drafts list like templates");
});

test("the pill's switch closes the door mid-session: 403 with the right token, and the handshake goes", async () => {
  const app = fakeApp();
  let on = true;
  const token = attachMcp(app, { tools: [], version: "9.9.9", enabled: () => on });

  on = false;
  const shut = fakeRes();
  await app.routes["POST /mcp"]({ socket: { remoteAddress: "127.0.0.1" }, headers: { authorization: "Bearer " + token } }, shut);
  assert.strictEqual(shut.code, 403, "off refuses even the right token");
  assert.match(shut.body.error, /switched off/);

  const server = readSource("server.js");
  assert.match(server, /const mcpOn = \(\) => settings\.get\("mcp"\) !== false;/, "on unless turned off: the default is on");
  assert.match(server, /if \(value\) writeMcpHandshake\(\);\n(\s+)else removeMcpHandshake\(\);/, "the handshake file follows the switch");
  const routes = readSource("routes", "index.js");
  assert.match(routes, /router\.get\("\/mcp-state", editorOnly/, "the pill reads the switch");
  assert.match(routes, /router\.post\("\/mcp-state", editorOnly/, "and throws it");
});

test("the MCP pill sits to the left of the LIVE pill and speaks plainly", () => {
  const editor = readSource("public", "src", "oscar_editor.js");
  const mcpPill = editor.indexOf('id: "oscar-mcp-pill"');
  const livePill = editor.indexOf('id: "oscar-live-pill"');
  assert.ok(mcpPill !== -1 && livePill !== -1 && mcpPill < livePill, "added before the LIVE pill, which renders it to its left");
  assert.match(editor, /if \(features\.MCP\) \{/, "gone when the feature is off");
  assert.match(editor, /never send\. Click to turn off\./, "the tooltip says what it is and is not");
  const theme = readSource("public", "css", "oscar_theme.css");
  assert.match(theme, /\.oscar-mcp-word \{\n  text-decoration: line-through;/, "off is struck through, the LIVE pill's own off-language");
});

test("a draft in the Load list is badged Draft, in the assistant green, and can be deleted", () => {
  const editor = readSource("public", "src", "oscar_editor.js");
  assert.match(editor, /String\(row\._id\)\.indexOf\("assistant:"\) === 0/, "known by its id prefix");
  assert.match(editor, /badge\.textContent = isDraft \? "Draft" : "Template";/, "badged apart from shipped templates");
  assert.match(editor, /Written by an assistant through MCP\. Review it/, "the badge says where it came from");
  assert.match(editor, /if \(row\.template && !isDraft\) return;/, "templates keep their no-delete rule; drafts do not");
  assert.match(editor, /DELETE", url: "\/drafts\/"/, "deleted through the drafts route");
  const routes = readSource("routes", "index.js");
  assert.match(routes, /router\.delete\("\/drafts\/:file", editorOnly/, "the route exists");
  const table = readSource("public", "css", "oscar_table.css");
  const base = table.indexOf(".o-table .o-badge {");
  const draft = table.indexOf(".o-table .o-badge-draft {");
  assert.ok(base !== -1 && draft !== -1 && base < draft, "the draft recolour comes after the base badge, or the cascade undoes it");
});

test("every part of a saved draft drags in flow: absolute mode is what made the handles messy", async () => {
  const { stampFlow } = require("../lib/mcp/validate");
  const stamped = stampFlow('<body><div id="a"><button id="b" data-gjs-dmode="abs">GO</button></div><script>var x = "<div>"; if (1 < 2) x;</script></body>');
  assert.match(stamped, /<div id="a" data-gjs-dmode="flow">/, "an unstamped part is stamped");
  assert.match(stamped, /<button id="b" data-gjs-dmode="abs">/, "a part that chose its mode keeps it");
  assert.match(stamped, /var x = "<div>"; if \(1 < 2\) x;/, "markup inside a script's code is not touched");
  assert.ok(stamped.indexOf('<body data-gjs-dmode') === -1, "the body itself is not a draggable part");

  const bare = validateSurface('<!doctype html><title>T</title><body><button id="go" class="oscar-button" data-oscar="oscar-button" data-gjs-message="/go">GO</button></body>');
  assert.ok(bare.warnings.some((w) => /data-gjs-dmode/.test(w)), "the validator says why the handles would misbehave");

  const { by, dir } = await bench();
  const html = '<!doctype html><body><div><button id="go" class="oscar-button" data-oscar="oscar-button" data-gjs-message="/go">GO</button></div></body>';
  const saved = await by.create_surface.handler({ name: "Flow Desk", html });
  assert.strictEqual(saved.saved, true);
  const file = fs.readFileSync(path.join(dir, "assistant", "flow-desk.html"), "utf8");
  assert.strictEqual((file.match(/data-gjs-dmode="flow"/g) || []).length, 2, "the div and the button both stamped");
  assert.match(HOWTO, /data-gjs-dmode/, "and the how-to teaches it up front");
});
