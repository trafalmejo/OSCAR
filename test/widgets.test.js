"use strict";

/**
 * What every widget has in common. A widget's own behaviour is tested in
 * test/widgets/<name>.test.js; this file only checks the shape they share,
 * so that adding a widget never means editing it.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { WIDGETS, byName, validate, FLAGS, outgoing } = require("../lib/widgets");
const registry = require("../lib/widgets/registry");

const WIDGETS_DIR = path.join(__dirname, "..", "lib", "widgets");
const SRC_DIR = path.join(__dirname, "..", "public", "src");

const senders = WIDGETS.filter((w) => w.sends);
const active = WIDGETS.filter((w) => w.sends || w.receives);

// --- the registry -----------------------------------------------------------

test("there is at least one widget, and each is registered once", () => {
  assert.ok(WIDGETS.length >= 3);
  assert.strictEqual(new Set(WIDGETS.map((w) => w.name)).size, WIDGETS.length);
  for (const widget of WIDGETS) assert.strictEqual(byName[widget.name], widget);
});

test("every widget file in lib/widgets is in the registry", () => {
  // A widget that exists but is not registered is invisible in the editor,
  // and nothing else would notice.
  const helpers = ["index.js", "registry.js", "fields.js", "outgoing.js"];
  const missing = [];
  for (const file of fs.readdirSync(WIDGETS_DIR)) {
    if (!file.endsWith(".js") || helpers.includes(file)) continue;
    const exported = require(path.join(WIDGETS_DIR, file));
    for (const value of Object.values(exported)) {
      if (!value || typeof value.attach !== "function" || typeof value.name !== "string") continue;
      if (!registry.includes(value)) missing.push(file + " exports " + value.name);
    }
  }
  assert.deepStrictEqual(missing, [], "widgets not listed in lib/widgets/registry.js");
});

test("the registry is one require per line, so parallel additions merge cleanly", () => {
  const src = fs.readFileSync(path.join(WIDGETS_DIR, "registry.js"), "utf8");
  const lines = src.split("\n").filter((line) => /require\(/.test(line));
  assert.strictEqual(lines.length, WIDGETS.length);
  for (const line of lines) assert.match(line.trim(), /^require\("\.\/[\w-]+"\)\.\w+,$/, line);
});

test("a definition missing a capability flag is refused, not read as false", () => {
  const complete = Object.assign({}, WIDGETS[0]);
  assert.strictEqual(validate(complete), complete);

  for (const flag of FLAGS) {
    const broken = Object.assign({}, complete);
    delete broken[flag];
    assert.throws(() => validate(broken), new RegExp(flag), flag);
  }
  assert.throws(() => validate(Object.assign({}, complete, { name: "button" })), /oscar-/);
  assert.throws(() => validate(Object.assign({}, complete, { sends: false, dmx: true })), /dmx without sends/);
});

test("a text key that names no default is refused, rather than rendering an empty label", () => {
  const complete = Object.assign({}, WIDGETS[0]);
  assert.throws(() => validate(Object.assign({}, complete, { text: "lable" })), /text.*lable/);
  assert.throws(() => validate(Object.assign({}, complete, { text: 7 })), /text/);
  const key = Object.keys(complete.defaults)[0];
  assert.strictEqual(validate(Object.assign({}, complete, { text: key })).text, key);
});

test("a block missing its label, category or icon is refused", () => {
  const complete = Object.assign({}, WIDGETS[0]);
  for (const key of ["label", "category", "icon"]) {
    const block = Object.assign({}, complete.block);
    delete block[key];
    assert.throws(() => validate(Object.assign({}, complete, { block })), new RegExp("block\\." + key), key);
  }
});

// --- capability flags -------------------------------------------------------

test("a widget that sends offers the same connection settings as every other", () => {
  // Ip, port, message and argument type in every panel: a button and a pad
  // should feel like the same instrument when you click between them.
  for (const widget of senders) {
    const keys = widget.fields.map((f) => f.key);
    for (const required of ["enabled", "ip", "port", "message", "argType"]) {
      assert.ok(keys.includes(required), widget.name + " has " + required);
    }
  }
});

test("a widget that neither sends nor receives has no connection settings", () => {
  // An Ip field on something that never touches the network is a lie in
  // the panel.
  for (const widget of WIDGETS) {
    if (widget.sends || widget.receives) continue;
    const keys = widget.fields.map((f) => f.key);
    for (const key of ["ip", "port", "message", "argType"]) {
      assert.ok(!keys.includes(key), widget.name + " should not have " + key);
    }
  }
});

test("a widget that can drive DMX sends numbers", () => {
  for (const widget of WIDGETS) {
    if (!widget.dmx) continue;
    assert.ok(widget.sends, widget.name + " drives DMX so it must send");
    const argType = widget.fields.find((f) => f.key === "argType");
    assert.ok(argType, widget.name + " has an argument type");
    const numeric = argType.options.some((o) => o.id === "f" || o.id === "i");
    assert.ok(numeric, widget.name + " can send a number");
  }
});

// --- receiving --------------------------------------------------------------

const receivers = WIDGETS.filter((w) => w.receives);

test("a widget that receives has a Listen switch right after Message", () => {
  assert.ok(receivers.length >= 3, "button, slider and pad all follow the rig");
  for (const widget of receivers) {
    const keys = widget.fields.map((f) => f.key);
    assert.ok(keys.includes("message"), widget.name + " has an address to follow");
    assert.strictEqual(keys[keys.indexOf("message") + 1], "listen", widget.name);
  }
});

test("Listen is off by default on every control, so nothing starts moving on its own", () => {
  for (const widget of receivers) {
    if (widget.sends) assert.strictEqual(widget.defaults.listen, false, widget.name);
  }
  for (const widget of WIDGETS) {
    if (widget.receives) continue;
    assert.ok(!widget.fields.some((f) => f.key === "listen"), widget.name + " has a Listen switch wired to nothing");
  }
});

test("a receiver without a Listen switch, or a Listen switch without a receiver, is refused", () => {
  const complete = Object.assign({}, receivers[0]);
  const withoutListen = complete.fields.filter((f) => f.key !== "listen");
  assert.throws(() => validate(Object.assign({}, complete, { fields: withoutListen })), /listen/);
  assert.throws(
    () => validate(Object.assign({}, complete, { defaults: Object.assign({}, complete.defaults, { listen: true }) })),
    /listen must default to false/
  );
  assert.throws(() => validate(Object.assign({}, complete, { receives: false })), /receives: false/);
  const display = Object.assign({}, complete, {
    sends: false,
    dmx: false,
    defaults: Object.assign({}, complete.defaults, { listen: true }),
  });
  assert.strictEqual(validate(display), display, "a display-only widget may listen from the start");
});

test("no widget ever answers an incoming message with an outgoing one", () => {
  // An incoming value that triggers an outgoing message is an endless loop
  // between OSCAR and any software that echoes its own state. The fake host
  // throws on a send made while delivering, so a widget that walks its send
  // path from its receive path cannot pass this, whatever it would have sent.
  const { mount } = require("./helpers/widgets");
  const payloads = [[1], [0], [1, 1], [0.5, 0.5], ["go"], ["1"], [true], [false], [], [null], ["abc"]];
  for (const widget of WIDGETS) {
    const overrides = widget.receives ? { listen: true } : {};
    const message = widget.defaults.message || "/x";
    for (const mode of [undefined, "toggle", "two"]) {
      const { ctx, detach } = mount(widget, Object.assign({}, overrides, mode ? { mode, sendMode: mode } : {}));
      for (const address of [message, message + "/x", message + "/y", "/*", "/*/*"]) {
        for (const args of payloads) {
          assert.doesNotThrow(() => ctx.receive(address, args), widget.name + " " + address + " " + JSON.stringify(args));
        }
      }
      assert.deepStrictEqual(ctx.sent, [], widget.name + " sent something back");
      detach();
    }
  }
});

test("a widget with Listen off is deaf: the network changes nothing on it", () => {
  const { mount } = require("./helpers/widgets");
  for (const widget of receivers) {
    const { el, ctx, state } = mount(widget);
    const before = state() + JSON.stringify(ctx.config);
    ctx.receive(widget.defaults.message, [1, 1]);
    ctx.receive("/*", [1]);
    assert.strictEqual(state() + JSON.stringify(ctx.config), before, widget.name + " moved with Listen off");
    assert.ok(el, widget.name);
  }
});

// --- the Enabled switch -----------------------------------------------------

test("a disabled widget sends nothing at all", () => {
  const message = outgoing({ enabled: false, ip: "1.2.3.4", port: 7000, message: "/x", argType: "f" }, 1);
  assert.strictEqual(message, null);
});

test("Enabled leads on every active widget, above even the label", () => {
  // Whether a control is live matters more than what it is called, and a
  // master switch buried mid-panel is one you do not find mid-show.
  for (const widget of active) {
    assert.strictEqual(widget.fields[0].key, "enabled", widget.name);
  }
});

test("Enabled is off by default nowhere -- a widget you drop works immediately", () => {
  for (const widget of active) {
    assert.strictEqual(widget.defaults.enabled, true, widget.name);
  }
});

// --- fields and defaults ----------------------------------------------------

test("every field a widget declares has a default behind it", () => {
  // A trait with no default renders empty and writes undefined into the
  // project the first time it is touched.
  for (const widget of WIDGETS) {
    for (const field of widget.fields) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(widget.defaults, field.key),
        widget.name + " has a default for " + field.key
      );
    }
  }
});

test("every select offers its own default as one of the options", () => {
  for (const widget of WIDGETS) {
    for (const field of widget.fields) {
      if (field.type !== "select") continue;
      const ids = field.options.map((o) => o.id);
      assert.ok(
        ids.includes(widget.defaults[field.key]),
        widget.name + "." + field.key + " default is selectable"
      );
    }
  }
});

test("every check names a field that exists", () => {
  // A validator on a key nothing edits never runs, and its author thinks the
  // value is guarded.
  for (const widget of WIDGETS) {
    const keys = widget.fields.map((f) => f.key);
    for (const key of Object.keys(widget.checks || {})) {
      assert.ok(keys.includes(key), widget.name + " checks " + key + " which has no field");
    }
  }
});

test("every widget attaches and detaches cleanly against a bare element", () => {
  const { mount } = require("./helpers/widgets");
  for (const widget of WIDGETS) {
    const { detach } = mount(widget);
    assert.strictEqual(typeof detach, "function", widget.name + " returns a detach function");
    detach();
  }
});

test("detaching lets go of every handler on the host, not only those on the element", () => {
  // The editor attaches again on every re-render. A widget that keeps its
  // onChange or onRewrite handler would apply each edit N times by the end of
  // a session, and the element-listener check alone cannot see it.
  const { mount } = require("./helpers/widgets");
  for (const widget of WIDGETS) {
    const { ctx, detach } = mount(widget);
    detach();
    assert.strictEqual(ctx.listening(), 0, widget.name + " still listens to the host after detach");
  }
});

test("what a widget puts on its element survives the host rewriting it", () => {
  // GrapesJS strips every attribute, class and inline property and re-applies
  // its own copy on any class or style edit; a widget that wrote something
  // straight onto the element must put it back through onRewrite.
  const { mount } = require("./helpers/widgets");
  for (const widget of WIDGETS) {
    const { state, rewrite } = mount(widget);
    const before = state();
    rewrite();
    assert.strictEqual(state(), before, widget.name + " loses its element state on a rewrite");
  }
});

// --- the editor seam --------------------------------------------------------

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("widget definitions stay free of the editor", () => {
  // The point of lib/widgets: swapping GrapesJS means rewriting one adapter.
  // Comments may name it -- they are how the seam is documented; code may not.
  for (const file of fs.readdirSync(WIDGETS_DIR)) {
    const code = stripComments(fs.readFileSync(path.join(WIDGETS_DIR, file), "utf8"));
    assert.ok(!/grapesjs/i.test(code), file + " depends on GrapesJS");
    // Nor on anything else that only exists inside an editor.
    assert.ok(!/\beditor\./.test(code), file + " reaches for an editor");
  }
});

test("only the adapter knows which editor OSCAR uses", () => {
  const offenders = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.startsWith("oscar_") && f.endsWith(".js"))
    .filter((f) => /DomComponents|BlockManager/.test(fs.readFileSync(path.join(SRC_DIR, f), "utf8")));

  assert.deepStrictEqual(offenders, [], "these register components outside the adapter");
});

test("the editor and the preview take their widgets from the registry, never by name", () => {
  // If either entry point required a widget directly, adding one would mean
  // editing it -- which is the merge conflict the registry exists to avoid.
  for (const entry of ["oscar_editor.js", "oscar_preview.js"]) {
    const code = stripComments(fs.readFileSync(path.join(SRC_DIR, entry), "utf8"));
    assert.ok(!/lib\/widgets\//.test(code), entry + " requires a widget module directly");
    assert.ok(!/require\("\.\/oscar_[a-z]+"\)/.test(code), entry + " requires a per-widget file");
    assert.ok(/widgetPlugins\(/.test(code), entry + " registers the widgets generically");
  }
});
