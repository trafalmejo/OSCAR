"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  mediaBrowser,
  parseItems,
  safeImageUrl,
  ITEM_ARG_TYPES,
  TILE_CLASS,
  SELECTED_CLASS,
  COLUMNS_PROPERTY,
} = require("../../lib/widgets/media-browser");
const { fakeContext } = require("../helpers/fake-dom");
const { fakeRoot } = require("../helpers/fake-tree");
const { mount: mountBare } = require("../helpers/widgets");

/** Mount the browser on an element that can hold children. */
function mount(overrides) {
  const el = fakeRoot("div");
  const ctx = fakeContext(Object.assign({}, mediaBrowser.defaults, overrides));
  const detach = mediaBrowser.attach(el, ctx);
  return { el, ctx, detach };
}

function selectedValues(el) {
  return el.children.filter((tile) => tile.classList.contains(SELECTED_CLASS)).map((tile) => tile.attributes.title);
}

function child(tile, tag) {
  return tile.children.find((node) => node.tagName === tag);
}

// --- the item list -----------------------------------------------------------

test("items are typed on one line: label, label|value or label|value|image", () => {
  assert.deepStrictEqual(parseItems("Forest; Waves|12; Stars|go|thumbs/stars.jpg"), [
    { label: "Forest", value: "1", image: "" },
    { label: "Waves", value: "12", image: "" },
    { label: "Stars", value: "go", image: "thumbs/stars.jpg" },
  ]);
});

test("an omitted value is the tile's 1-based position, counted over the tiles that exist", () => {
  assert.deepStrictEqual(
    parseItems(" A ;; B| ; |; C||c.png").map((item) => item.value),
    ["1", "2", "3"],
    "blank entries take no position, and an empty value between bars counts as omitted"
  );
});

test("newlines separate items too, for a project file written by hand", () => {
  assert.deepStrictEqual(
    parseItems("A|1\r\nB|2\nC|3").map((item) => item.label),
    ["A", "B", "C"]
  );
});

test("an entry with neither a label nor an image is dropped; an image alone is a tile", () => {
  assert.deepStrictEqual(parseItems("|5; ||pic.png"), [{ label: "", value: "1", image: "pic.png" }]);
  assert.deepStrictEqual(parseItems(""), []);
  assert.deepStrictEqual(parseItems(null), []);
  assert.deepStrictEqual(parseItems(undefined), []);
});

test("a data: URL keeps the semicolons that are part of it", () => {
  const url = "data:image/png;charset=x;base64,iVBORw0KGgo=";
  assert.deepStrictEqual(parseItems("A|1|" + url + "; B|2"), [
    { label: "A", value: "1", image: url },
    { label: "B", value: "2", image: "" },
  ]);
});

// --- image URLs --------------------------------------------------------------

test("an image may be a path, an http(s) address or a data:image URL, and nothing else", () => {
  for (const ok of ["thumbs/a.jpg", "/assets/a.png", "../a.gif", "http://host/a.jpg", "HTTPS://host/a.jpg", "data:image/png;base64,AAAA", "a.jpg?x=1:2"]) {
    assert.strictEqual(safeImageUrl(ok), ok, ok);
  }
  for (const bad of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    String.fromCharCode(1) + "javascript:alert(1)",
    "vbscript:x",
    "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:,x",
    "file:///etc/passwd",
    "blob:http://host/x",
  ]) {
    assert.strictEqual(safeImageUrl(bad), "", JSON.stringify(bad));
  }
  assert.strictEqual(safeImageUrl(""), "");
  assert.strictEqual(safeImageUrl(null), "");
});

test("a refused image URL never reaches an element, and the tile shows its name instead", () => {
  const { el } = mount({ items: "Bad|1|javascript:alert(1); Worse|2|data:text/html,<b>x</b>", showLabels: false });
  assert.strictEqual(el.children.length, 2);
  for (const tile of el.children) {
    assert.strictEqual(child(tile, "IMG"), undefined);
    assert.ok(child(tile, "SPAN"), "the label stands in for the picture");
  }
  for (const node of el.ownerDocument.created) {
    for (const value of Object.values(node.attributes)) assert.doesNotMatch(String(value), /javascript:|data:text/i);
  }
});

// --- building the tiles ------------------------------------------------------

test("the tiles are built from the setting, in the element's own document", () => {
  const { el } = mount({ items: "Forest|7|thumbs/forest.jpg; Waves|12" });
  assert.strictEqual(el.children.length, 2);
  const [forest, waves] = el.children;
  for (const tile of el.children) {
    assert.strictEqual(tile.ownerDocument, el.ownerDocument, "made by the canvas iframe's document, not the outer page's");
    assert.strictEqual(tile.tagName, "BUTTON");
    assert.strictEqual(tile.attributes.type, "button", "a bare button inside a form would submit it");
    assert.strictEqual(tile.attributes.class, TILE_CLASS);
  }
  assert.strictEqual(child(forest, "IMG").attributes.src, "thumbs/forest.jpg");
  assert.strictEqual(child(forest, "IMG").attributes.alt, "Forest");
  assert.strictEqual(child(forest, "IMG").attributes.draggable, "false", "a native image drag would lift the tile out of the widget");
  assert.strictEqual(child(forest, "SPAN").textContent, "Forest");
  assert.strictEqual(child(waves, "IMG"), undefined);
  assert.strictEqual(child(waves, "SPAN").textContent, "Waves");
});

test("what the designer typed is text and attribute values, never markup", () => {
  const nasty = '<img src=x onerror=alert(1)>|1|"><script>alert(1)</script>';
  const { el } = mount({ items: nasty });
  assert.strictEqual(el.innerHTML, undefined, "nothing was assembled as a string of markup");
  const tile = el.children[0];
  assert.strictEqual(tile.innerHTML, undefined);
  assert.strictEqual(child(tile, "SPAN").textContent, "<img src=x onerror=alert(1)>");
  assert.strictEqual(child(tile, "IMG").attributes.src, '"><script>alert(1)</script>', "a path, however odd, set as an attribute value");
  const made = el.ownerDocument.created.map((node) => node.tagName).sort();
  assert.deepStrictEqual(made, ["BUTTON", "IMG", "SPAN"], "only the elements the widget means to make");
});

test("the widget source never writes markup", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs
    .readFileSync(path.join(__dirname, "..", "..", "lib", "widgets", "media-browser.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(src, /\bdocument\b(?!\s*[:=])/, "the global document is the wrong one inside the canvas iframe");
});

test("labels can be switched off for a wall of pictures, but a tile with no picture keeps its name", () => {
  const { el, ctx } = mount({ items: "Forest|1|f.jpg; Waves|2", showLabels: false });
  assert.strictEqual(child(el.children[0], "SPAN"), undefined);
  assert.strictEqual(el.children[0].attributes.title, "Forest", "still named for a pointer and a screen reader");
  assert.strictEqual(child(el.children[1], "SPAN").textContent, "Waves");

  ctx.edit("showLabels", true);
  assert.strictEqual(child(el.children[0], "SPAN").textContent, "Forest");
});

test("a thumbnail that fails to load gives way to the name, once", () => {
  const { el } = mount({ items: "Forest|1|missing.jpg", showLabels: false });
  const tile = el.children[0];
  const img = child(tile, "IMG");
  img.fire("error");
  img.fire("error");
  assert.deepStrictEqual(
    tile.children.map((node) => node.tagName),
    ["SPAN"]
  );
  assert.strictEqual(child(tile, "SPAN").textContent, "Forest");
});

test("editing the items rebuilds the grid without sending, and leaves no stale tiles", () => {
  const { el, ctx } = mount({ items: "A; B; C" });
  const old = el.children.slice();
  ctx.edit("items", "X|10; Y|20");
  assert.deepStrictEqual(
    el.children.map((tile) => tile.attributes.title),
    ["X", "Y"]
  );
  old[0].fire("click");
  assert.deepStrictEqual(ctx.sent, [], "a tile that was taken off no longer picks anything");
});

test("the column count is on the element, follows the setting, and survives a rewrite", () => {
  const { el, ctx } = mount({ columns: 4 });
  assert.strictEqual(el.style.properties[COLUMNS_PROPERTY], "4");
  ctx.edit("columns", 2);
  assert.strictEqual(el.style.properties[COLUMNS_PROPERTY], "2");
  el.wipe();
  ctx.rewrite();
  assert.strictEqual(el.style.properties[COLUMNS_PROPERTY], "2");
});

test("an unreadable column count falls back to the default and is never read as 0", () => {
  for (const bad of [null, "", "  ", "abc", undefined]) {
    const { el } = mount({ columns: bad });
    assert.strictEqual(el.style.properties[COLUMNS_PROPERTY], "3", JSON.stringify(bad));
  }
  assert.strictEqual(mount({ columns: 0 }).el.style.properties[COLUMNS_PROPERTY], "1");
  assert.strictEqual(mount({ columns: 99 }).el.style.properties[COLUMNS_PROPERTY], "12");
});

// --- picking -----------------------------------------------------------------

test("one tap sends the tile's value to Message", () => {
  const { el, ctx } = mount({ items: "Forest|7; Waves|12", ip: "10.0.0.5", port: 7001, message: "/layer1/clip" });
  el.children[1].fire("click");
  assert.deepStrictEqual(ctx.sent, [
    { ip: "10.0.0.5", port: 7001, address: "/layer1/clip", args: [{ type: "i", value: 12 }] },
  ]);
  assert.deepStrictEqual(selectedValues(el), ["Waves"]);
  assert.strictEqual(el.children[1].attributes["aria-pressed"], "true");
  assert.strictEqual(el.children[0].attributes["aria-pressed"], "false");
});

test("a tile with no value sends its position", () => {
  const { el, ctx } = mount({ items: "A; B; C" });
  el.children[2].fire("click");
  assert.deepStrictEqual(ctx.sent[0].args, [{ type: "i", value: 3 }]);
});

test("a clip can be picked by name, or as a float", () => {
  const named = mount({ items: "Forest|forest_loop", argType: "s" });
  named.el.children[0].fire("click");
  assert.deepStrictEqual(named.ctx.sent[0].args, [{ type: "s", value: "forest_loop" }]);

  const float = mount({ items: "Half|0.5", argType: "f" });
  float.el.children[0].fire("click");
  assert.deepStrictEqual(float.ctx.sent[0].args, [{ type: "f", value: 0.5 }]);
});

test("a pick is a click, not a pointerdown: a finger scrolling the grid launches nothing", () => {
  const { el, ctx } = mount({ items: "A; B" });
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchend", "mousedown"]) {
    el.children[0].fire(type);
    el.fire(type);
  }
  assert.deepStrictEqual(ctx.sent, []);
  assert.deepStrictEqual(selectedValues(el), []);
});

test("picking the tile that is already picked sends again: relaunching a clip is an instruction", () => {
  const { el, ctx } = mount({ items: "A; B" });
  el.children[0].fire("click");
  el.children[0].fire("click");
  assert.strictEqual(ctx.sent.length, 2);
  assert.deepStrictEqual(ctx.sent[0], ctx.sent[1]);
  assert.deepStrictEqual(selectedValues(el), ["A"]);
});

test("only one tile is ever highlighted", () => {
  const { el } = mount({ items: "A; B; C" });
  el.children[0].fire("click");
  el.children[2].fire("click");
  assert.deepStrictEqual(selectedValues(el), ["C"]);
});

test("a value the argument type cannot carry is not sent as 0, or at all", () => {
  // The panel refuses this; a project file edited by hand reaches here.
  const { el, ctx } = mount({ items: "Forest|forest", argType: "i" });
  el.children[0].fire("click");
  assert.deepStrictEqual(ctx.sent, []);
});

test("with Enabled off a tap sends nothing and moves nothing", () => {
  const { el, ctx } = mount({ items: "A; B", enabled: false });
  el.children[0].fire("click");
  assert.deepStrictEqual(ctx.sent, []);
  assert.deepStrictEqual(ctx.shared, []);
  assert.deepStrictEqual(selectedValues(el), []);
});

test("nothing is picked to begin with, and the pick is never stored as a setting", () => {
  const { el, ctx } = mount({ items: "A; B" });
  assert.deepStrictEqual(selectedValues(el), []);
  const before = JSON.stringify(ctx.config);
  el.children[1].fire("click");
  assert.strictEqual(JSON.stringify(ctx.config), before, "what is playing is the rig's to say, not the project file's");
});

test("editing the items keeps the highlight if the value is still offered, and drops it if not", () => {
  const { el, ctx } = mount({ items: "A|1; B|2" });
  el.children[1].fire("click");
  ctx.edit("items", "New|9; B again|2");
  assert.deepStrictEqual(selectedValues(el), ["B again"]);
  ctx.edit("items", "New|9");
  assert.deepStrictEqual(selectedValues(el), []);
  ctx.edit("items", "New|9; B|2");
  assert.deepStrictEqual(selectedValues(el), [], "and it does not come back on its own");
});

// --- following the rig -------------------------------------------------------

test("with Listen on, the rig saying which clip plays moves the highlight and sends nothing", () => {
  const { el, ctx } = mount({ items: "A|1; B|2; C|3", listen: true });
  ctx.receive("/clip", [2]);
  assert.deepStrictEqual(selectedValues(el), ["B"]);
  assert.deepStrictEqual(ctx.sent, []);
  assert.deepStrictEqual(ctx.shared, [{ value: "2" }], "recorded for a device that joins later");
  assert.deepStrictEqual(ctx.sharedHow, [{ heard: true }], "and marked as heard, so nobody else is told");
});

test("what arrives is matched as text, then as a number", () => {
  const { el, ctx } = mount({ items: "A|1; B|2.50; Go|go", listen: true, argType: "s" });
  ctx.receive("/clip", ["1"]);
  assert.deepStrictEqual(selectedValues(el), ["A"]);
  ctx.receive("/clip", [2.5]);
  assert.deepStrictEqual(selectedValues(el), ["B"]);
  ctx.receive("/clip", ["go"]);
  assert.deepStrictEqual(selectedValues(el), ["Go"]);
});

test("an unreadable value is ignored, never read as tile 0", () => {
  const { el, ctx } = mount({ items: "Zero|0; One|1", listen: true });
  ctx.receive("/clip", [1]);
  for (const args of [[null], [""], ["  "], [], [undefined], [{}], [[0]], [false], [true], ["abc"]]) {
    ctx.receive("/clip", args);
    assert.deepStrictEqual(selectedValues(el), ["One"], JSON.stringify(args));
  }
  assert.deepStrictEqual(ctx.shared, [{ value: "1" }]);
  ctx.receive("/clip", [0]);
  assert.deepStrictEqual(selectedValues(el), ["Zero"], "a real 0 is a value like any other");
});

test("a value no tile sends changes nothing", () => {
  const { el, ctx } = mount({ items: "A|1; B|2", listen: true });
  ctx.receive("/clip", [1]);
  ctx.receive("/clip", [9]);
  assert.deepStrictEqual(selectedValues(el), ["A"]);
});

test("Listen off, another address, or Enabled off: the rig moves nothing", () => {
  const off = mount({ items: "A|1", listen: false });
  off.ctx.receive("/clip", [1]);
  assert.deepStrictEqual(selectedValues(off.el), []);

  const other = mount({ items: "A|1", listen: true });
  other.ctx.receive("/other", [1]);
  assert.deepStrictEqual(selectedValues(other.el), []);

  const disabled = mount({ items: "A|1", listen: true, enabled: false });
  disabled.ctx.receive("/clip", [1]);
  assert.deepStrictEqual(selectedValues(disabled.el), []);
});

test("after the rig moved the highlight, a tap on that tile still sends", () => {
  const { el, ctx } = mount({ items: "A|1; B|2", listen: true });
  ctx.receive("/clip", [2]);
  el.children[1].fire("click");
  assert.deepStrictEqual(ctx.sent.map((m) => m.args[0].value), [2]);
});

// --- several devices ---------------------------------------------------------

test("a pick is shared, so another tablet shows the same highlight", () => {
  const { el, ctx } = mount({ items: "A|1; B|2" });
  el.children[1].fire("click");
  assert.deepStrictEqual(ctx.shared, [{ value: "2" }]);
  assert.deepStrictEqual(ctx.sharedHow, [null], "a hand's pick is news for every device");
});

test("another device's pick moves the highlight here, Listen or not, and nothing is sent or re-shared", () => {
  const { el, ctx } = mount({ items: "A|1; B|2", listen: false });
  ctx.receiveShared({ value: "2" });
  assert.deepStrictEqual(selectedValues(el), ["B"]);
  assert.deepStrictEqual(ctx.sent, []);
  assert.deepStrictEqual(ctx.shared, []);
});

test("a shared record is read as carefully as a value from the rig", () => {
  const { el, ctx } = mount({ items: "Zero|0; One|1" });
  ctx.receiveShared({ value: "1" });
  for (const state of [{}, { value: null }, { value: "" }, { value: {} }, { on: true }, null, { value: "9" }]) {
    assert.doesNotThrow(() => ctx.receiveShared(state), JSON.stringify(state));
    assert.deepStrictEqual(selectedValues(el), ["One"], JSON.stringify(state));
  }
});

test("a host with no other devices, and no OSC coming in, is coped with", () => {
  const el = fakeRoot("div");
  const ctx = fakeContext(Object.assign({}, mediaBrowser.defaults));
  delete ctx.share;
  delete ctx.onShared;
  delete ctx.onOsc;
  delete ctx.onRewrite;
  const detach = mediaBrowser.attach(el, ctx);
  el.children[0].fire("click");
  assert.strictEqual(ctx.sent.length, 1);
  assert.doesNotThrow(detach);
});

// --- lifecycle ---------------------------------------------------------------

test("detaching takes the tiles away and lets go of the host, so a re-render does not double the grid", () => {
  const { el, ctx, detach } = mount({ items: "A; B" });
  const tiles = el.children.slice();
  detach();
  assert.strictEqual(el.children.length, 0);
  assert.strictEqual(ctx.listening(), 0);
  for (const tile of tiles) assert.strictEqual(tile.listenerCount("click"), 0);

  mediaBrowser.attach(el, ctx);
  assert.strictEqual(el.children.length, 2);
});

test("an element with no document gets no tiles and still attaches and detaches", () => {
  const { el, detach } = mountBare(mediaBrowser);
  assert.strictEqual(el.children, undefined);
  assert.doesNotThrow(detach);
});

// --- the definition and its checks -------------------------------------------

test("it sends and receives over OSC only, as int, float or string", () => {
  assert.strictEqual(mediaBrowser.sends, true);
  assert.strictEqual(mediaBrowser.receives, true);
  assert.strictEqual(mediaBrowser.dmx, false);
  assert.strictEqual(mediaBrowser.ownsChildren, true);
  assert.deepStrictEqual(
    ITEM_ARG_TYPES.map((type) => type.id),
    ["i", "f", "s"]
  );
  const keys = mediaBrowser.fields.map((f) => f.key);
  assert.ok(!keys.includes("oscEnabled") && !keys.includes("dmxEnabled") && !keys.some((key) => /^dmx/.test(key)));
});

test("the panel refuses an empty list, an unsendable value, a duplicate value and a refused image", () => {
  const check = mediaBrowser.checks.items;
  assert.strictEqual(check("A; B|5; C|6|thumbs/c.jpg", { argType: "i" }), null);
  assert.match(check("", { argType: "i" }), /List the items/);
  assert.match(check(" ; | ", { argType: "i" }), /List the items/);
  assert.match(check("A|forest", { argType: "i" }), /cannot be sent as i/);
  assert.strictEqual(check("A|forest", { argType: "s" }), null);
  assert.match(check("A|2; B", { argType: "i" }), /Two items send "2"/, "a typed value colliding with a position");
  assert.match(check("A|1|javascript:alert(1)", { argType: "i" }), /image for "A"/);
});

test("switching the argument type is refused while a tile holds a value it cannot carry", () => {
  const check = mediaBrowser.checks.argType;
  assert.match(check("i", { items: "A|forest" }), /change the value first/);
  assert.strictEqual(check("s", { items: "A|forest" }), null);
  assert.strictEqual(check("f", { items: "A; B" }), null);
});

test("columns has to be a whole number from 1 to 12", () => {
  const check = mediaBrowser.checks.columns;
  for (const ok of [1, 3, "4", 12]) assert.strictEqual(check(ok), null, String(ok));
  for (const bad of [0, 13, 2.5, "", null, "abc", -1]) assert.match(check(bad), /whole number/, JSON.stringify(bad));
});

// --- found in review ---------------------------------------------------------

test("two items are duplicates when they send the same value, however each was typed", () => {
  const check = mediaBrowser.checks.items;
  assert.match(check("A|07; B|7", { argType: "i" }), /Two items send "7"/);
  assert.match(check("A|1.4; B|1", { argType: "i" }), /Two items send "1"/, "an int is rounded on its way out");
  assert.match(check("A|1.0; B|1", { argType: "f" }), /Two items send "1"/);
  assert.match(check("A; B|1.2", { argType: "i" }), /Two items send "1"/, "a position is a value too");
  // As strings these are different messages, and as floats so are 1.4 and 1.
  assert.strictEqual(check("A|07; B|7", { argType: "s" }), null);
  assert.strictEqual(check("A|1.4; B|1", { argType: "f" }), null);
});

test("the rig echoing what an int tile really sent finds that tile", () => {
  const { el, ctx } = mount({ items: "A|1.4; B|5", listen: true });
  ctx.receive("/clip", [1]);
  assert.deepStrictEqual(selectedValues(el), ["A"]);
  assert.deepStrictEqual(ctx.sent, []);
});

test("a data: URL with no comma does not swallow the items after it, and the panel names it", () => {
  assert.deepStrictEqual(parseItems("A|1|data:image/png;base64; B|2; C"), [
    { label: "A", value: "1", image: "data:image/png" },
    { label: "base64", value: "2", image: "" },
    { label: "B", value: "2", image: "" },
    { label: "C", value: "4", image: "" },
  ]);
  assert.deepStrictEqual(
    parseItems("A|1|data:image/png; B; C|3|thumbs/a,b.jpg").map((item) => item.label),
    ["A", "B", "C"],
    "a comma in a later item does not finish the URL either"
  );
  assert.strictEqual(safeImageUrl("data:image/png;base64"), "");
  assert.strictEqual(safeImageUrl("data:image/png"), "");
  assert.match(mediaBrowser.checks.items("A|1|data:image/png;base64; B|5", { argType: "i" }), /image for "A"/);

  const { el } = mount({ items: "A|1|data:image/png; B|2" });
  assert.strictEqual(el.children.length, 2);
  assert.strictEqual(child(el.children[0], "img"), undefined);
});

test("a tap that sends nothing highlights nothing and tells no other device", () => {
  // The panel refuses this; a project file edited by hand reaches here.
  const { el, ctx } = mount({ items: "Forest|forest; Waves|2", argType: "i" });
  el.children[1].fire("click");
  el.children[0].fire("click");
  assert.strictEqual(ctx.sent.length, 1);
  assert.deepStrictEqual(selectedValues(el), ["Waves"], "the clip that did go out is still the one playing");
  assert.deepStrictEqual(ctx.shared, [{ value: "2" }]);
});
