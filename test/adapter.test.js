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

const { register, toTrait, matches } = require("../public/src/adapters/grapesjs");
const { WIDGETS } = require("../lib/widgets");
const { slider } = require("../lib/widgets/slider");
const { fakeElement } = require("./helpers/fake-dom");

function fakeEditor() {
  const types = {};
  const blocks = {};
  return {
    types,
    blocks,
    sendOSC: null,
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
function fakeModel(config) {
  const handlers = {};
  return {
    config,
    get(key) {
      return this.config[key];
    },
    set(key, value) {
      this.config[key] = value;
    },
    on(event, fn) {
      (handlers[event] = handlers[event] || []).push(fn);
    },
    off(event, fn) {
      handlers[event] = (handlers[event] || []).filter((f) => f !== fn);
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
    if (widget.sends || widget.receives) {
      assert.strictEqual(defaults.ip, "10.0.0.5", widget.name);
    } else {
      assert.ok(!("ip" in defaults), widget.name + " carries a hidden ip");
    }
  }
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

test("a widget sharing a tag is told apart by its attributes when a project is parsed", () => {
  const range = { tagName: "INPUT", getAttribute: (n) => (n === "type" ? "range" : null) };
  const text = { tagName: "INPUT", getAttribute: (n) => (n === "type" ? "text" : null) };
  assert.strictEqual(matches(slider, range), true);
  assert.strictEqual(matches(slider, text), false);
});
