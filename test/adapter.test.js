"use strict";

/**
 * The GrapesJS adapter, driven with a stand-in editor.
 *
 * What is checked here is the translation -- what the adapter asks the
 * editor to register, and how it hands the host's events to a widget -- not
 * GrapesJS itself. The stand-in records the component type it is given and
 * lets a test call the view callbacks the way the editor would.
 */

const test = require("node:test");
const assert = require("node:assert");

const { register, toTrait, matches, visibleFields, revealKeys } = require("../public/src/adapters/grapesjs");
const { WIDGETS } = require("../lib/widgets");
const { slider } = require("../lib/widgets/slider");
const { field } = require("../lib/widgets/fields");
const { fakeElement } = require("./helpers/fake-dom");

function fakeEditor() {
  const types = {};
  const blocks = {};
  const handlers = {};
  return {
    types,
    blocks,
    sendOSC: null,
    on(event, fn) {
      // GrapesJS takes several event names in one string.
      event.split(" ").forEach((name) => (handlers[name] = handlers[name] || []).push(fn));
    },
    trigger(event, ...args) {
      for (const fn of handlers[event] || []) fn(...args);
    },
    /** What GrapesJS announces when someone deletes a component, before its views go. */
    deleting(component, opts) {
      this.trigger("component:remove:before", component, () => {}, opts || {});
    },
    DomComponents: {
      addType(name, definition) {
        types[name] = definition;
      },
    },
    BlockManager: {
      add(name, block) {
        blocks[name] = block;
      },
    },
  };
}

/** A Backbone model's worth of get/set/on/off, holding a widget's settings. */
function fakeModel(config, id) {
  const handlers = {};
  return {
    config,
    get(key) {
      return this.config[key];
    },
    /** Both of Backbone's forms: set(key, value) and set({ key: value }). */
    set(key, value) {
      if (key && typeof key === "object") Object.assign(this.config, key);
      else this.config[key] = value;
    },
    unset(key) {
      delete this.config[key];
    },
    getId() {
      return (this.config.attributes && this.config.attributes.id) || id || "i1";
    },
    /** GrapesJS's own way of writing an id: as the id attribute. */
    setId(value) {
      this.config.attributes = Object.assign({}, this.config.attributes, { id: value });
    },
    previous() {
      return undefined;
    },
    children: [],
    /** Visit this component and everything inside it, as GrapesJS's onAll does. */
    onAll(fn) {
      fn(this);
      for (const child of this.children) child.onAll(fn);
    },
    on(event, fn) {
      (handlers[event] = handlers[event] || []).push(fn);
    },
    off(event, fn) {
      handlers[event] = (handlers[event] || []).filter((f) => f !== fn);
    },
    /** Pretend the settings panel changed a key, as GrapesJS would announce it. */
    edit(key, value) {
      this.config[key] = value;
      for (const event of Object.keys(handlers)) {
        if (event.split(" ").includes("change:" + key)) handlers[event].forEach((fn) => fn());
      }
    },
    handlerCount() {
      return Object.values(handlers).reduce((n, fns) => n + fns.length, 0);
    },
  };
}

function registered(definition, ipserver) {
  const editor = fakeEditor();
  register(definition)(editor, { ipserver });
  return editor.types[definition.name];
}

const display = {
  name: "oscar-display-probe",
  tag: "div",
  sends: false,
  receives: false,
  dmx: false,
  block: { label: "Probe", category: "OSC", icon: "<svg></svg>" },
  defaults: { label: "hi" },
  fields: [],
  checks: {},
  attach: () => () => {},
};

test("a widget's connection starts pointed at this machine, and only a connected widget gets one", () => {
  for (const widget of WIDGETS) {
    const type = registered(widget, "10.0.0.5");
    const defaults = type.model.defaults;
    const hasIpField = widget.fields.some((f) => f.key === "ip");
    if (widget.sends) assert.ok(hasIpField, widget.name + " sends but has no Ip setting");
    if (hasIpField) {
      assert.strictEqual(defaults.ip, "10.0.0.5", widget.name);
    } else {
      assert.ok(!("ip" in defaults), widget.name + " carries a hidden ip");
    }
  }
  // The meter listens and never sends. It has no Ip setting, so an ip on its
  // model would be a value nothing shows, checks or uses.
  const meter = WIDGETS.find((w) => w.name === "oscar-meter");
  assert.ok(!("ip" in registered(meter, "10.0.0.5").model.defaults), "the meter carries a hidden ip");
  // A display-only widget has no ip field, so it must not hold an ip value
  // either -- the two would disagree the moment anything read it.
  assert.ok(!("ip" in registered(display, "10.0.0.5").model.defaults));
});

test("every field becomes a component property, never an HTML attribute", () => {
  for (const widget of WIDGETS) {
    for (const trait of registered(widget).model.defaults.traits) {
      assert.strictEqual(trait.changeProp, true, widget.name + "." + trait.name);
    }
  }
  assert.strictEqual(toTrait({ key: "x", label: "X", type: "select", options: [] }).type, "select");
});

test("the widget is told after GrapesJS rewrites its element, and forgotten on removal", () => {
  // GrapesJS's updateAttributes and updateClasses strip what the widget wrote;
  // the adapter runs them first (extendFnView) and then the widget's handlers.
  const type = registered(slider);
  assert.deepStrictEqual(type.extendFnView.slice().sort(), ["updateAttributes", "updateClasses"]);

  const el = fakeElement();
  const model = fakeModel(Object.assign({}, slider.defaults, { orientation: "vertical", max: 255, value: 200 }));
  const view = { el, model };

  type.view.onRender.call(view);
  assert.strictEqual(el.getAttribute("orient"), "vertical");

  el.wipe();
  type.view.updateAttributes.call(view);
  assert.strictEqual(el.getAttribute("orient"), "vertical", "put back after updateAttributes");
  assert.strictEqual(el.value, "200");

  el.wipe();
  type.view.updateClasses.call(view);
  assert.strictEqual(el.getAttribute("orient"), "vertical", "put back after updateClasses");

  // A second render replaces the handlers rather than stacking them.
  type.view.onRender.call(view);
  assert.strictEqual(view.oscarRewrites.length, 1);

  type.view.removed.call(view);
  assert.deepStrictEqual(view.oscarRewrites, []);
  assert.strictEqual(model.handlerCount(), 0, "no change handlers left on the model");
});

test("a host that cannot receive offers no onOsc, and the widgets cope", () => {
  // The socket plugin is what provides onOscIn; without it the adapter must
  // not pretend, or a widget would subscribe to nothing and never know.
  const type = registered(slider);
  const view = { el: fakeElement(), model: fakeModel(Object.assign({}, slider.defaults, { listen: true })) };
  assert.doesNotThrow(() => type.view.onRender.call(view));
  type.view.removed.call(view);
});

test("an incoming message reaches the widget, and a send made while delivering it is dropped", () => {
  // The host's half of the loop guard. A widget cannot lift it, however it
  // is written, because the gate is in the adapter and not in the widget.
  const editor = fakeEditor();
  let listeners = [];
  editor.onOscIn = (fn) => {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((f) => f !== fn);
    };
  };
  const sent = [];
  editor.sendOSC = (ip, port, address, args) => sent.push({ address, args });
  register(slider)(editor, {});
  const type = editor.types[slider.name];

  const el = fakeElement();
  const model = fakeModel(Object.assign({}, slider.defaults, { listen: true, min: 0, max: 100, value: 0 }));
  const view = { el, model };
  type.view.onRender.call(view);
  assert.strictEqual(listeners.length, 1, "the slider subscribed");

  for (const fn of listeners) fn({ address: "/slider1", args: [40] });
  assert.strictEqual(el.value, "40", "the thumb followed");
  assert.deepStrictEqual(sent, [], "and nothing went out");

  // A widget that did try to answer would be refused by the host itself.
  const looping = { attach: (element, ctx) => ctx.onOsc(() => ctx.send({ ip: "localhost", port: 7000, address: "/x", args: [] })) };
  register(Object.assign({}, slider, { name: "oscar-loop-probe", attach: looping.attach }))(editor, {});
  const probe = { el: fakeElement(), model: fakeModel(Object.assign({}, slider.defaults)) };
  editor.types["oscar-loop-probe"].view.onRender.call(probe);
  const warn = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args.join(" "));
  try {
    for (const fn of listeners.slice()) fn({ address: "/x", args: [1] });
  } finally {
    console.warn = warn;
  }
  assert.deepStrictEqual(sent, [], "the send was dropped");
  assert.strictEqual(warned.length, 1, "and said so");

  // A send from a hand afterwards still goes out.
  el.value = "60";
  el.fire("input");
  assert.strictEqual(sent.length, 1);

  type.view.removed.call(view);
  editor.types["oscar-loop-probe"].view.removed.call(probe);
  assert.strictEqual(listeners.length, 0, "removal unsubscribes from the host");
});

// --- DMX --------------------------------------------------------------------

test("a message's OSC and DMX halves each go out on their own bridge, the DMX half stamped with the widget's id", () => {
  const editor = fakeEditor();
  const osc = [];
  const dmx = [];
  editor.sendOSC = (ip, port, address, args) => osc.push({ ip, port, address, args });
  editor.sendDMX = (request) => dmx.push(request);
  register(slider)(editor, {});
  const type = editor.types[slider.name];

  const el = fakeElement();
  const model = fakeModel(Object.assign({}, slider.defaults, { oscEnabled: true, dmxEnabled: true, min: 0, max: 100, dmxChannel: 7 }), "iabc");
  const view = { el, model };
  type.view.onRender.call(view);

  el.value = "50";
  el.fire("input");
  assert.strictEqual(osc.length, 1);
  assert.strictEqual(osc[0].address, "/slider1");
  assert.deepStrictEqual(dmx, [{ source: "iabc", protocol: "artnet", host: "", universe: 1, channel: 7, levels: [128] }]);

  // OSC only: nothing reaches the DMX bridge, and vice versa.
  Object.assign(model.config, { oscEnabled: true, dmxEnabled: false });
  el.fire("input");
  assert.strictEqual(osc.length, 2);
  assert.strictEqual(dmx.length, 1);
  Object.assign(model.config, { oscEnabled: false, dmxEnabled: true });
  el.fire("input");
  assert.strictEqual(osc.length, 2);
  assert.strictEqual(dmx.length, 2);
  type.view.removed.call(view);
});

test("a host with no DMX bridge drops the DMX half and keeps the OSC half", () => {
  const editor = fakeEditor();
  const osc = [];
  editor.sendOSC = (ip, port, address, args) => osc.push(address);
  register(slider)(editor, {});
  const view = { el: fakeElement(), model: fakeModel(Object.assign({}, slider.defaults, { oscEnabled: true, dmxEnabled: true })) };
  editor.types[slider.name].view.onRender.call(view);
  view.el.value = "50";
  assert.doesNotThrow(() => view.el.fire("input"));
  assert.deepStrictEqual(osc, ["/slider1"]);
});

test("deleting a widget that can drive DMX hands its channels back; one that cannot says nothing", () => {
  const editor = fakeEditor();
  const stopped = [];
  editor.stopDMX = (source) => stopped.push(source);
  register(slider)(editor, {});
  const view = { el: fakeElement(), model: fakeModel(Object.assign({}, slider.defaults), "igone") };
  editor.types[slider.name].view.onRender.call(view);
  // In the order GrapesJS does it: Component.remove() announces itself on the
  // editor, then the collection lets go and the view is removed.
  editor.deleting(view.model);
  editor.types[slider.name].view.removed.call(view);
  assert.deepStrictEqual(stopped, ["igone"]);

  register(Object.assign({}, display, { name: "oscar-display-probe-2" }))(editor, {});
  const probe = { el: fakeElement(), model: fakeModel({}, "iprobe") };
  editor.types["oscar-display-probe-2"].view.onRender.call(probe);
  editor.deleting(probe.model);
  editor.types["oscar-display-probe-2"].view.removed.call(probe);
  assert.deepStrictEqual(stopped, ["igone"], "a widget with dmx: false never had channels");
});

test("a surface being reloaded, or a widget being moved, keeps every channel where it is", () => {
  // Opening a project and "Push to preview" both tear the whole surface down
  // and build it again, removing every view without anyone deleting anything.
  // A release there would black the stage out under a tablet mid-show, so
  // the only removal that releases is one Component.remove() announced.
  const editor = fakeEditor();
  const stopped = [];
  editor.stopDMX = (source) => stopped.push(source);
  register(slider)(editor, {});
  const type = editor.types[slider.name];
  const view = { el: fakeElement(), model: fakeModel(Object.assign({}, slider.defaults, { oscEnabled: false, dmxEnabled: true }), "ilive") };

  type.view.onRender.call(view);
  type.view.removed.call(view);
  assert.deepStrictEqual(stopped, [], "a reload is not a deletion");

  // A move is a remove-and-append that GrapesJS flags as temporary.
  type.view.onRender.call(view);
  editor.deleting(view.model, { temporary: 1 });
  type.view.removed.call(view);
  assert.deepStrictEqual(stopped, [], "a move is not a deletion");

  type.view.onRender.call(view);
  editor.deleting(view.model);
  type.view.removed.call(view);
  assert.deepStrictEqual(stopped, ["ilive"], "a deletion afterwards still releases");

  // The mark is spent: the next reload of a widget with the same identity
  // holds again.
  type.view.onRender.call(view);
  type.view.removed.call(view);
  assert.deepStrictEqual(stopped, ["ilive"]);
});

test("the page's own wrapper going, which is how a load tears the surface down, deletes nothing", () => {
  // GrapesJS removes the wrapper (the <body>) through Component.remove() on
  // every project load, the one such announcement a load makes. Seen live:
  // marking its descendants there released every widget on "Push to preview".
  const editor = fakeEditor();
  const stopped = [];
  editor.stopDMX = (source) => stopped.push(source);
  register(slider)(editor, {});
  const type = editor.types[slider.name];

  const view = { el: fakeElement(), model: fakeModel(Object.assign({}, slider.defaults, { oscEnabled: false, dmxEnabled: true }), "iheld") };
  const body = fakeModel({ type: "wrapper" }, "ibody");
  body.children = [view.model];
  type.view.onRender.call(view);

  editor.deleting(body, { root: true });
  type.view.removed.call(view);
  assert.deepStrictEqual(stopped, []);
});

test("deleting a page hands back the channels of every DMX widget on it, showing or not", () => {
  // GrapesJS announces a page going with page:remove:before and, for its
  // components, only the wrapper's removal -- which a load also produces and
  // is ignored. A page that is not on the canvas has no views either, so
  // nothing else would ever release these channels.
  const editor = fakeEditor();
  const stopped = [];
  editor.stopDMX = (source) => stopped.push(source);
  register(slider)(editor, { ipserver: "localhost" });

  const wrapper = fakeModel({ type: "wrapper" }, "wrap");
  const fader = fakeModel({ type: "oscar-slider" }, "fader1");
  const label = fakeModel({ type: "text" }, "label1");
  wrapper.children = [fader, label];

  editor.trigger("page:remove:before", { getMainComponent: () => wrapper });
  assert.deepStrictEqual(stopped, ["fader1"], "the DMX widget, and nothing that could not hold channels");

  // A page with nothing built yet must not throw the deletion off course.
  assert.doesNotThrow(() => editor.trigger("page:remove:before", { getMainComponent: () => undefined }));
});

test("deleting a container takes the widgets inside it with it", () => {
  const editor = fakeEditor();
  const stopped = [];
  editor.stopDMX = (source) => stopped.push(source);
  register(slider)(editor, {});
  const type = editor.types[slider.name];

  const inner = { el: fakeElement(), model: fakeModel(Object.assign({}, slider.defaults, { oscEnabled: false, dmxEnabled: true }), "iinner") };
  const box = fakeModel({}, "ibox");
  box.children = [inner.model];
  type.view.onRender.call(inner);

  editor.deleting(box);
  type.view.removed.call(inner);
  assert.deepStrictEqual(stopped, ["iinner"]);
});

test("a host with no events cannot tell a deletion from a reload, and holds", () => {
  const editor = fakeEditor();
  delete editor.on;
  const stopped = [];
  editor.stopDMX = (source) => stopped.push(source);
  register(slider)(editor, {});
  const view = { el: fakeElement(), model: fakeModel(Object.assign({}, slider.defaults), "ideaf") };
  editor.types[slider.name].view.onRender.call(view);
  editor.types[slider.name].view.removed.call(view);
  assert.deepStrictEqual(stopped, []);
});

test("unticking DMX's Enable hands the channels back; ticking OSC's Enable beside it does not", () => {
  const editor = fakeEditor();
  const stopped = [];
  editor.stopDMX = (source) => stopped.push(source);
  register(slider)(editor, {});
  const model = fakeModel(Object.assign({}, slider.defaults, { oscEnabled: false, dmxEnabled: true }), "isw");
  editor.types[slider.name].model.init.call(model);

  model.edit("oscEnabled", true);
  assert.deepStrictEqual(stopped, [], "still driving DMX");
  model.edit("dmxEnabled", false);
  assert.deepStrictEqual(stopped, ["isw"]);
  model.edit("enabled", false);
  assert.deepStrictEqual(stopped, ["isw"], "Enabled off holds the level rather than blacking out");
});

test("the panel is one collapsible section per protocol, under the widget's own settings", () => {
  const type = registered(slider);
  const traits = type.model.defaults.traits;
  const names = (list) => list.map((t) => t.name);
  const inSection = (id) => names(traits.filter((t) => t.category.id === id));

  assert.ok(!names(traits).includes("transport"), "no Output list: the checkboxes say it");
  assert.deepStrictEqual(inSection("osc"), ["oscEnabled", "ip", "port", "message", "listen", "argType"]);
  assert.deepStrictEqual(inSection("dmx"), ["dmxEnabled", "dmxProtocol", "dmxHost", "dmxUniverse", "dmxChannel", "dmxCount"]);
  // GrapesJS draws categorised traits above uncategorised ones, so the
  // widget's own settings need a section to stay on top. Sections appear in
  // the order their first field does, and Enabled is always first.
  assert.strictEqual(traits[0].name, "enabled");
  assert.deepStrictEqual(traits[0].category, { id: "widget", label: "Widget", open: true });
  assert.ok(inSection("widget").includes("orientation"));
  assert.strictEqual(traits.every((t) => t.category && t.category.id), true, "nothing is left outside a section");

  const labels = {};
  traits.forEach((t) => (labels[t.category.id] = t.category.label));
  assert.deepStrictEqual(labels, { widget: "Widget", osc: "OSC", dmx: "DMX" });
});

test("the DMX section is closed on a widget that sends no DMX, and open on one that does", () => {
  const type = registered(slider);
  const dmxOpen = (traits) => traits.find((t) => t.name === "dmxChannel").category.open;
  const oscOpen = (traits) => traits.find((t) => t.name === "ip").category.open;
  assert.strictEqual(dmxOpen(type.model.defaults.traits), false, "one closed line on a plain OSC slider");
  assert.strictEqual(oscOpen(type.model.defaults.traits), true);

  const model = fakeModel(Object.assign({}, slider.defaults, { oscEnabled: false, dmxEnabled: true }));
  type.model.init.call(model);
  assert.strictEqual(dmxOpen(model.get("traits")), true, "a loaded DMX slider opens on its channels");
  assert.ok(model.get("traits").some((t) => t.name === "ip"), "and keeps its OSC settings, to be switched back on");

  // toTrait is handed (field, index) by Array.map; an index is not settings.
  assert.strictEqual(toTrait(slider.fields.find((f) => f.key === "dmxChannel"), 3).category.open, false);
});

test("a widget saved with the old Output setting opens with its checkboxes telling the truth", () => {
  const type = registered(slider);
  for (const [word, flags] of [["dmx", [false, true]], ["both", [true, true]], ["osc", [true, false]]]) {
    // As GrapesJS builds it: the saved word, and the checkboxes at their defaults.
    const model = fakeModel(Object.assign({}, slider.defaults, { transport: word }));
    type.model.init.call(model);
    assert.deepStrictEqual([model.get("oscEnabled"), model.get("dmxEnabled")], flags, word);
    assert.strictEqual("transport" in model.config, false, word + ": the old word is gone, so it cannot outvote a later edit");
  }
  const untouched = fakeModel(Object.assign({}, slider.defaults));
  type.model.init.call(untouched);
  assert.deepStrictEqual([untouched.get("oscEnabled"), untouched.get("dmxEnabled")], [true, false]);
});

test("a field shown only for some settings is a trait only then, and follows an edit", () => {
  // showIf is data the adapter can act on: the type's trait list is built
  // from the defaults, a loaded component rebuilds its own if it disagrees,
  // and an edit to the setting the rule names rebuilds again.
  const { colour } = require("../lib/widgets/colour");
  const type = registered(colour);
  const names = (traits) => traits.map((t) => t.name);
  assert.ok(!names(type.model.defaults.traits).includes("alpha"), "no Alpha while the colour goes out as r, g, b");

  const model = fakeModel(Object.assign({}, colour.defaults, { format: "rgba" }));
  type.model.init.call(model);
  assert.ok(names(model.get("traits")).includes("alpha"), "a loaded r, g, b, a picker shows its Alpha");
  model.edit("format", "hex");
  assert.ok(!names(model.get("traits")).includes("alpha"));
  assert.ok(!names(model.get("traits")).includes("argType"), "a hex string has no argument type");

  assert.deepStrictEqual(revealKeys(colour), ["format"]);
  assert.deepStrictEqual(revealKeys(slider), [], "nothing on a slider is hidden any more");
  assert.strictEqual(visibleFields(slider, {}).length, slider.fields.length);
});

test("the panel follows a setting whose states show different fields of the same number", () => {
  // Whether to rebuild is judged by which fields the panel holds, not how
  // many: two states of one setting can each show one field, a different one.
  const probe = Object.assign({}, display, {
    name: "oscar-mode-probe",
    defaults: { mode: "x", a: 1, b: 2 },
    fields: [
      field("mode", "Mode", "select", { options: [{ id: "x", name: "X" }, { id: "y", name: "Y" }] }),
      field("a", "A", "number", { showIf: { key: "mode", in: ["x"] } }),
      field("b", "B", "number", { showIf: { key: "mode", in: ["y"] } }),
    ],
  });
  const type = registered(probe);
  const names = (traits) => traits.map((t) => t.name);
  assert.deepStrictEqual(names(type.model.defaults.traits), ["mode", "a"]);

  const model = fakeModel({ mode: "x", a: 1, b: 2 });
  type.model.init.call(model);
  assert.deepStrictEqual(names(model.get("traits")), ["mode", "a"]);
  model.edit("mode", "y");
  assert.deepStrictEqual(names(model.get("traits")), ["mode", "b"]);
  model.edit("mode", "x");
  assert.deepStrictEqual(names(model.get("traits")), ["mode", "a"]);
});

test("a widget with nothing conditional is left alone: its trait list is never rebuilt", () => {
  const type = registered(display);
  const model = fakeModel({ label: "hi" });
  type.model.init.call(model);
  assert.strictEqual(model.get("traits"), undefined);
  assert.strictEqual(model.handlerCount(), 0);
});

// --- the other devices ------------------------------------------------------

/** An editor whose socket plugin has put the other devices within reach. */
function sharingEditor() {
  const editor = fakeEditor();
  const shared = [];
  let listeners = {};
  editor.sendOSC = (ip, port, address, args) => (editor.osc = (editor.osc || []).concat([{ address, args }]));
  const how = [];
  editor.how = how;
  editor.shareState = (id, state, options) => (shared.push({ id, state }), how.push(options));
  editor.onSharedState = (id, fn) => {
    (listeners[id] = listeners[id] || []).push(fn);
    return () => {
      listeners[id] = listeners[id].filter((f) => f !== fn);
    };
  };
  /** What another device shares for one widget, as the socket plugin would deliver it. */
  editor.arrives = (id, state) => (listeners[id] || []).slice().forEach((fn) => fn(state));
  editor.subscribed = (id) => (listeners[id] || []).length;
  return Object.assign(editor, { shared });
}

test("a widget's share goes out under the component's id, and what arrives under that id reaches it", () => {
  const editor = sharingEditor();
  register(slider)(editor, {});
  const type = editor.types[slider.name];
  const el = fakeElement();
  const view = { el, model: fakeModel(Object.assign({}, slider.defaults, { min: 0, max: 100, value: 0 }), "iabc") };
  type.view.onRender.call(view);
  assert.strictEqual(editor.subscribed("iabc"), 1, "subscribed under its own id");

  el.value = "40";
  el.fire("input");
  assert.deepStrictEqual(editor.shared, [{ id: "iabc", state: { value: 40 } }]);

  editor.arrives("iabc", { value: 70 });
  assert.strictEqual(el.value, "70", "the thumb followed the other device");
  assert.strictEqual(editor.shared.length, 1, "and did not share it again");
  assert.deepStrictEqual(editor.osc, [{ address: "/slider1", args: [{ type: "f", value: 40 }] }], "nor send it");

  editor.arrives("other", { value: 10 });
  assert.strictEqual(el.value, "70", "another widget's state is not this widget's business");

  type.view.removed.call(view);
  assert.strictEqual(editor.subscribed("iabc"), 0, "removal unsubscribes");
});

test("while another device's state is being delivered, a send or a share made in answer is dropped", () => {
  // The host's half of the guard between devices. Adoption never sends: the
  // device that acted already put the message on the wire. And it never
  // re-shares: the server would find nothing changed, but only because it
  // was stopped here first -- two hosts without this gate would hand the
  // value back and forth through a server that saw a change each time the
  // value differed by rounding.
  const editor = sharingEditor();
  const answering = {
    attach: (element, ctx) =>
      ctx.onShared(() => {
        ctx.send({ ip: "localhost", port: 7000, address: "/x", args: [] });
        ctx.share({ value: 1 });
      }),
  };
  register(Object.assign({}, slider, { name: "oscar-answer-probe", attach: answering.attach }))(editor, {});
  const view = { el: fakeElement(), model: fakeModel(Object.assign({}, slider.defaults), "iprobe") };
  editor.types["oscar-answer-probe"].view.onRender.call(view);

  const warn = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args.join(" "));
  try {
    editor.arrives("iprobe", { value: 5 });
  } finally {
    console.warn = warn;
  }
  assert.strictEqual(editor.osc, undefined, "the send was dropped");
  assert.deepStrictEqual(editor.shared, [], "the share was dropped");
  assert.strictEqual(warned.length, 2, "and both said so");
});

test("a share made while incoming OSC is being delivered goes out: the rig's value is shared once", () => {
  const editor = sharingEditor();
  let oscListeners = [];
  editor.onOscIn = (fn) => {
    oscListeners.push(fn);
    return () => {
      oscListeners = oscListeners.filter((f) => f !== fn);
    };
  };
  register(slider)(editor, {});
  const el = fakeElement();
  const view = { el, model: fakeModel(Object.assign({}, slider.defaults, { listen: true, min: 0, max: 100, value: 0 }), "irig") };
  editor.types[slider.name].view.onRender.call(view);

  for (const fn of oscListeners) fn({ address: "/slider1", args: [33] });
  assert.strictEqual(el.value, "33");
  assert.deepStrictEqual(editor.shared, [{ id: "irig", state: { value: 33 } }]);
  assert.strictEqual(editor.osc, undefined, "nothing went back to the rig");
  assert.strictEqual(editor.how[0].heard, true, "marked as heard, so the server tells nobody");

  el.value = "50";
  el.fire("input");
  assert.strictEqual(editor.how[1].heard, false, "a hand's value is news");
});

test("whatever a widget shares while the rig's message is being delivered goes out as heard, whether it said so or not", () => {
  // The host's half of the rule, like the send gate: every device was sent
  // the same OSC message, and a widget that forgot to say so would have each
  // tablet telling every other what they all heard.
  const editor = sharingEditor();
  let oscListeners = [];
  editor.onOscIn = (fn) => (oscListeners.push(fn), () => {});
  const forgetful = { attach: (element, ctx) => ctx.onOsc(() => ctx.share({ value: 1 })) };
  register(Object.assign({}, slider, { name: "oscar-heard-probe", attach: forgetful.attach }))(editor, {});
  const view = { el: fakeElement(), model: fakeModel(Object.assign({}, slider.defaults), "iheard") };
  editor.types["oscar-heard-probe"].view.onRender.call(view);
  for (const fn of oscListeners) fn({ address: "/anything", args: [1] });
  assert.deepStrictEqual(editor.how, [{ heard: true, release: undefined }]);
});

test("a release asked for by the widget reaches the socket plugin", () => {
  const editor = sharingEditor();
  let ctx = null;
  const probe = { attach: (element, context) => ((ctx = context), () => {}) };
  register(Object.assign({}, slider, { name: "oscar-release-probe", attach: probe.attach }))(editor, {});
  const view = { el: fakeElement(), model: fakeModel(Object.assign({}, slider.defaults), "irel") };
  editor.types["oscar-release-probe"].view.onRender.call(view);
  ctx.share({ on: true }, { release: { on: false } });
  assert.deepStrictEqual(editor.how, [{ heard: false, release: { on: false } }]);
});

test("a host with no other devices offers neither share nor onShared, and the widgets cope", () => {
  const editor = fakeEditor();
  let ctx = null;
  const probe = { attach: (element, context) => ((ctx = context), () => {}) };
  register(Object.assign({}, slider, { name: "oscar-lonely-probe", attach: probe.attach }))(editor, {});
  const view = { el: fakeElement(), model: fakeModel(Object.assign({}, slider.defaults)) };
  editor.types["oscar-lonely-probe"].view.onRender.call(view);
  assert.strictEqual(ctx.share, undefined);
  assert.strictEqual(ctx.onShared, undefined);

  register(slider)(editor, {});
  const real = { el: fakeElement(), model: fakeModel(Object.assign({}, slider.defaults)) };
  assert.doesNotThrow(() => editor.types[slider.name].view.onRender.call(real));
  real.el.value = "10";
  assert.doesNotThrow(() => real.el.fire("input"));
  editor.types[slider.name].view.removed.call(real);
});

test("a widget's id is written into the project when it is created, so every device keys it the same way", () => {
  // GrapesJS saves an id only when a style or a script refers to it; one it
  // made up is made up again, differently, on every device. The state the
  // devices share is keyed by that id, so the adapter pins it.
  const type = registered(slider);
  const fresh = fakeModel(Object.assign({}, slider.defaults), "igen");
  type.model.init.call(fresh);
  assert.deepStrictEqual(fresh.get("attributes"), { id: "igen" });
  assert.strictEqual(fresh.getId(), "igen", "and the id did not change in the process");

  // One loaded from a project already carries its id, which is kept.
  const loaded = fakeModel(Object.assign({}, slider.defaults, { attributes: { id: "isaved", type: "range" } }));
  type.model.init.call(loaded);
  assert.deepStrictEqual(loaded.get("attributes"), { id: "isaved", type: "range" });

  // A host with no way to set an id is left alone rather than crashed.
  const bare = fakeModel(Object.assign({}, slider.defaults));
  delete bare.setId;
  assert.doesNotThrow(() => type.model.init.call(bare));
  assert.strictEqual(bare.get("attributes"), undefined);
});

test("a widget sharing a tag is told apart by its attributes when a project is parsed", () => {
  const range = { tagName: "INPUT", getAttribute: (n) => (n === "type" ? "range" : null) };
  const text = { tagName: "INPUT", getAttribute: (n) => (n === "type" ? "text" : null) };
  assert.strictEqual(matches(slider, range), true);
  assert.strictEqual(matches(slider, text), false);
});

// ---- pages that are not showing ------------------------------------------------
const { runOffstage } = require("../public/src/adapters/grapesjs");

/** A receiving editor with two pages of fake components; page one is showing. */
function pagedEditor(pageModels) {
  const editor = sharingEditor();
  let oscListeners = [];
  editor.onOscIn = (fn) => {
    oscListeners.push(fn);
    return () => {
      oscListeners = oscListeners.filter((f) => f !== fn);
    };
  };
  editor.hears = (address, args) => oscListeners.slice().forEach((fn) => fn({ address, args }));
  editor.listening = () => oscListeners.length;

  const all = pageModels.map((models, index) => {
    const wrapper = fakeModel({ type: "wrapper" }, "wrap" + index);
    wrapper.children = models;
    return { getMainComponent: () => wrapper };
  });
  editor.Pages = {
    selected: all[0],
    getAll: () => all.slice(),
    getSelected: () => editor.Pages.selected,
  };
  editor.turnTo = (index) => {
    editor.Pages.selected = all[index];
    editor.trigger("page:select");
  };
  return editor;
}

const offstageDocument = { createElement: () => fakeElement() };

test("a Listen fader on a page that is not showing still follows the rig, and its view starts from there", () => {
  const onPageOne = fakeModel(Object.assign({ type: slider.name }, slider.defaults, { message: "/p1/fader", listen: true, value: 10 }), "f1");
  const onPageTwo = fakeModel(Object.assign({ type: slider.name }, slider.defaults, { message: "/p2/fader", listen: true, value: 25 }), "f2");
  const editor = pagedEditor([[onPageOne], [onPageTwo, fakeModel({ type: "text" }, "label")]]);
  register(slider)(editor, {});
  const type = editor.types[slider.name];

  const offstage = runOffstage(editor, { document: offstageDocument });
  offstage.start();
  assert.strictEqual(offstage.size, 1, "the fader of the hidden page, and nothing that cannot receive");

  // One tablet, on page one; the rig moves the fader on page two.
  editor.hears("/p2/fader", [40]);
  assert.strictEqual(onPageTwo.get("value"), 40, "stored, so the view opens there");
  assert.deepStrictEqual(editor.shared, [{ id: "f2", state: { value: 40 } }]);
  assert.strictEqual(editor.how[0].heard, true, "recorded as heard: nobody else is told");
  assert.ok(!editor.osc, "and nothing went back out");

  // The rule that matters most holds off stage too.
  editor.hears("/p2/fader", [""]);
  editor.hears("/p2/fader", []);
  assert.strictEqual(onPageTwo.get("value"), 40);

  // Turn to page two: the view takes over, page one goes off stage.
  editor.turnTo(1);
  const el = fakeElement();
  type.view.onRender.call({ el, model: onPageTwo });
  assert.strictEqual(el.value, "40", "the thumb is where the rig left it, not at 25");
  assert.strictEqual(offstage.size, 1);
  editor.hears("/p1/fader", [7]);
  assert.strictEqual(onPageOne.get("value"), 7);

  offstage.stop();
  assert.strictEqual(offstage.size, 0);
  assert.strictEqual(editor.listening(), 1, "only the view is left listening");
});

test("the view stops the copy that listened in its place, so a value is never shared twice", () => {
  const fader = fakeModel(Object.assign({ type: slider.name }, slider.defaults, { message: "/p2/fader", listen: true }), "f2");
  const editor = pagedEditor([[], [fader]]);
  register(slider)(editor, {});
  const offstage = runOffstage(editor, { document: offstageDocument });
  offstage.start();

  // The view renders before anyone announces the page change.
  editor.Pages.selected = editor.Pages.getAll()[1];
  editor.types[slider.name].view.onRender.call({ el: fakeElement(), model: fader });
  assert.strictEqual(offstage.size, 0);

  editor.hears("/p2/fader", [12]);
  assert.strictEqual(editor.shared.length, 1);
});

test("a load replaces every component: the old project's widgets stop listening", () => {
  const old = fakeModel(Object.assign({ type: slider.name }, slider.defaults, { message: "/old", listen: true, value: 1 }), "old");
  const editor = pagedEditor([[], [old]]);
  register(slider)(editor, {});
  const offstage = runOffstage(editor, { document: offstageDocument });
  offstage.start();

  const fresh = fakeModel(Object.assign({ type: slider.name }, slider.defaults, { message: "/old", listen: true, value: 2 }), "fresh");
  const wrapper = fakeModel({ type: "wrapper" }, "w");
  wrapper.children = [fresh];
  const pagesNow = [{ getMainComponent: () => fakeModel({ type: "wrapper" }, "w0") }, { getMainComponent: () => wrapper }];
  editor.Pages.getAll = () => pagesNow.slice();
  editor.Pages.selected = pagesNow[0];
  offstage.start();

  editor.hears("/old", [50]);
  assert.strictEqual(old.get("value"), 1, "the component that is gone hears nothing");
  assert.strictEqual(fresh.get("value"), 50);
  assert.strictEqual(editor.listening(), 1);
});

test("a host that cannot receive keeps nothing running off stage", () => {
  const fader = fakeModel(Object.assign({ type: slider.name }, slider.defaults, { listen: true }), "f2");
  const editor = pagedEditor([[], [fader]]);
  delete editor.onOscIn;
  register(slider)(editor, {});
  const offstage = runOffstage(editor, { document: offstageDocument });
  offstage.start();
  assert.strictEqual(offstage.size, 0);
});

// --- the settings panel's status lights --------------------------------------------

test("each protocol section carries what it is, and a setting's hint travels with its trait", () => {
  const type = registered(slider);
  const traits = type.model.defaults.traits;
  const section = (name) => traits.find((t) => t.name === name).category;
  assert.deepStrictEqual(section("ip").attributes, { "data-oscar-section": "osc" });
  assert.deepStrictEqual(section("dmxChannel").attributes, { "data-oscar-section": "dmx" });
  assert.strictEqual(section("enabled").attributes, undefined, "the widget's own section has no light");

  const master = traits.find((t) => t.name === "enabled");
  assert.strictEqual(master.label, "Master comms");
  assert.match(master.attributes.title, /Master switch/);
  assert.strictEqual(traits.find((t) => t.name === "ip").attributes, undefined, "a setting with no hint gets no title");
});

test("the lights follow the selected widget: green for a protocol in use, grey otherwise", () => {
  const { sectionLights } = require("../public/src/adapters/grapesjs");

  // Just enough of a document: two section titles, and a hinted row.
  function node(attrs) {
    const el = { attrs: Object.assign({}, attrs), children: [], className: "" };
    el.getAttribute = (k) => (k in el.attrs ? el.attrs[k] : null);
    el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
    el.appendChild = (child) => { el.children.push(child); return child; };
    el.querySelector = (sel) => {
      if (sel === "[data-title]") return el.title || null;
      if (sel === ".oscar-section-light") return el.children.find((c) => c.className === "oscar-section-light") || null;
      if (sel === ".gjs-label") return el.label || null;
      return null;
    };
    return el;
  }
  const osc = node({ "data-oscar-section": "osc" });
  const dmx = node({ "data-oscar-section": "dmx" });
  osc.title = node({});
  dmx.title = node({});
  const row = node({ title: "Master switch for..." });
  row.label = node({ title: "Master comms" });
  const root = {
    querySelectorAll: (sel) => (sel.indexOf("data-oscar-section") !== -1 ? [osc, dmx] : [row]),
  };
  const doc = { createElement: () => node({}) };

  const handlers = {};
  const model = fakeModel(Object.assign({}, slider.defaults, { type: "oscar-slider" }));
  const editor = {
    getSelected: () => model,
    on: (events, fn) => events.split(" ").forEach((e) => (handlers[e] = fn)),
  };

  const paint = sectionLights(editor, { document: doc, root });
  paint();
  const light = (section) => section.title.children[0];
  assert.strictEqual(light(osc).attrs["data-on"], "true");
  assert.strictEqual(light(dmx).attrs["data-on"], "false");
  assert.strictEqual(light(dmx).attrs.title, "Not in use", "said in words as well as in colour");
  assert.strictEqual(row.label.attrs.title, "Master switch for...", "the hint replaces the label's own title");

  // Ticking DMX's Enable repaints without a reselect, and adds no second light.
  handlers["component:selected"]();
  model.edit("dmxEnabled", true);
  assert.strictEqual(light(dmx).attrs["data-on"], "true");
  assert.strictEqual(dmx.title.children.length, 1);

  // The master switch takes both down.
  model.edit("enabled", false);
  assert.deepStrictEqual([light(osc).attrs["data-on"], light(dmx).attrs["data-on"]], ["false", "false"]);
});
