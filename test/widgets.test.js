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

test("a widget that can drive DMX offers Output and the DMX settings, hidden until asked for", () => {
  // The same DMX vocabulary on every such widget, and OSC by default, so a
  // project made before DMX existed behaves exactly as it did.
  const DMX_KEYS = ["dmxProtocol", "dmxHost", "dmxUniverse", "dmxChannel", "dmxCount"];
  for (const widget of WIDGETS) {
    const keys = widget.fields.map((f) => f.key);
    if (!widget.dmx) {
      for (const key of ["transport"].concat(DMX_KEYS)) {
        assert.ok(!keys.includes(key), widget.name + " cannot drive DMX but has " + key);
      }
      continue;
    }
    assert.ok(keys.includes("transport"), widget.name + " has an Output setting");
    assert.strictEqual(widget.defaults.transport, "osc", widget.name + " sends OSC by default");
    for (const key of DMX_KEYS) {
      const field = widget.fields.find((f) => f.key === key);
      assert.ok(field, widget.name + " has " + key);
      assert.deepStrictEqual(field.showIf, { key: "transport", in: ["dmx", "both"] }, widget.name + "." + key + " is shown only for DMX");
    }
    for (const key of ["dmxProtocol", "dmxUniverse", "dmxChannel", "dmxCount"]) {
      assert.strictEqual(typeof widget.checks[key], "function", widget.name + " checks " + key);
    }
  }
});

test("every field that is shown conditionally depends on a setting the widget has", () => {
  for (const widget of WIDGETS) {
    const keys = widget.fields.map((f) => f.key);
    for (const field of widget.fields) {
      if (!field.showIf) continue;
      assert.ok(keys.includes(field.showIf.key), widget.name + "." + field.key + " depends on " + field.showIf.key + " which it has no field for");
    }
  }
});

test("on DMX, every such widget puts a level on the wire that a channel can carry", () => {
  // The DMX half is stamped by the host with the widget's identity; the
  // widget's half is levels 0-255, one per channel of its block.
  const { mount } = require("./helpers/widgets");
  for (const widget of WIDGETS) {
    if (!widget.dmx) continue;
    const { el, ctx } = mount(widget, { transport: "dmx", rect: { left: 0, top: 0, width: 100, height: 100 } });
    el.value = "100";
    el.fire("pointerdown", { clientX: 100, clientY: 0 });
    el.fire("input");
    el.fire("pointerup", { clientX: 100, clientY: 0 });
    assert.ok(ctx.sent.length >= 1, widget.name + " sent");
    for (const message of ctx.sent) {
      assert.ok(!("address" in message), widget.name + " sent OSC while set to DMX only");
      assert.ok(message.dmx, widget.name + " sent no DMX half");
      assert.strictEqual(message.dmx.protocol, "artnet");
      assert.strictEqual(message.dmx.universe, 1);
      assert.strictEqual(message.dmx.channel, 1);
      for (const level of message.dmx.levels) {
        assert.ok(Number.isInteger(level) && level >= 0 && level <= 255, widget.name + " level " + level);
      }
    }
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

test("no widget ever answers an incoming message with an outgoing one", async () => {
  // An incoming value that triggers an outgoing message is an endless loop
  // between OSCAR and any software that echoes its own state. The fake host
  // throws on a send made while delivering, so a widget that walks its send
  // path from its receive path cannot pass this, whatever it would have sent.
  //
  // The host's refusal covers the delivery itself, so a widget that put its
  // send on a frame or a timer instead would slip past it. Here every frame a
  // widget asks for is recorded and run after the delivery, then timers get
  // their turn; the pad already sends on a frame from a hand, and a widget
  // copying that from its receive path must fail here.
  const { mount } = require("./helpers/widgets");
  const payloads = [[1], [0], [1, 1], [0.5, 0.5], ["go"], ["1"], [true], [false], [], [null], ["abc"]];
  const frames = [];
  global.requestAnimationFrame = (fn) => frames.push(fn);
  global.cancelAnimationFrame = () => {};
  const mounted = [];
  try {
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
        mounted.push({ widget, ctx, detach });
      }
    }
    while (frames.length) frames.shift()();
    await new Promise((resolve) => setTimeout(resolve, 30));
    for (const { widget, ctx, detach } of mounted) {
      assert.deepStrictEqual(ctx.sent, [], widget.name + " sent something back on a frame or a timer");
      detach();
    }
  } finally {
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
  }
});

test("the loop-guard test would catch a widget that answers on a frame", async () => {
  // Proof that the frame flush above is real, with a widget that does exactly
  // what a copied schedule()/flush() from the pad would do in its receive path.
  const { mount } = require("./helpers/widgets");
  const { follow } = require("../lib/widgets/incoming");
  const frames = [];
  global.requestAnimationFrame = (fn) => frames.push(fn);
  try {
    const deferred = Object.assign({}, WIDGETS[0], {
      attach: (el, ctx) =>
        follow(ctx, () => requestAnimationFrame(() => ctx.send({ ip: "localhost", port: 7000, address: "/x", args: [] }))) ||
        (() => {}),
    });
    const { ctx } = mount(deferred, { listen: true });
    ctx.receive(deferred.defaults.message, [1]);
    assert.deepStrictEqual(ctx.sent, [], "nothing yet: the send is on a frame");
    while (frames.length) frames.shift()();
    assert.strictEqual(ctx.sent.length, 1, "which the flush ran, and the assertion above would have seen");
  } finally {
    delete global.requestAnimationFrame;
  }
});

test("a receiver with Enabled off is deaf: Listen moves nothing on it", () => {
  // Enabled is the master switch. A surface is switched off to be laid out
  // while the rig is live, and a control jumping under the pointer is not
  // being laid out.
  const { mount } = require("./helpers/widgets");
  for (const widget of receivers) {
    for (const mode of [undefined, "toggle", "two"]) {
      const overrides = Object.assign({ enabled: false, listen: true }, mode ? { mode, sendMode: mode } : {});
      const { ctx, state } = mount(widget, overrides);
      const before = state() + JSON.stringify(ctx.config);
      const message = widget.defaults.message;
      for (const address of [message, message + "/x", message + "/y", "/*"]) {
        ctx.receive(address, [1, 1]);
        ctx.receive(address, [1]);
      }
      assert.strictEqual(state() + JSON.stringify(ctx.config), before, widget.name + " moved with Enabled off");
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
