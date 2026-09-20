"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { sectionLights } = require("../public/src/adapters/grapesjs");
const { byName } = require("../lib/widgets");

// Just enough of a settings panel: a title per section, which the adapter
// hangs the lights and the Learn button on.
function node(attrs) {
  const el = { attrs: Object.assign({}, attrs), children: [], className: "", textContent: "", handlers: {} };
  el.getAttribute = (k) => (k in el.attrs ? el.attrs[k] : null);
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  el.appendChild = (child) => { el.children.push(child); return child; };
  el.removeChild = (child) => { el.children = el.children.filter((c) => c !== child); return child; };
  el.addEventListener = (event, fn) => { el.handlers[event] = fn; };
  el.querySelector = (sel) => {
    if (sel === "[data-title]") return el.title || null;
    if (sel.charAt(0) === ".") return el.children.find((c) => c.className === sel.slice(1)) || null;
    const dir = /data-direction="(\w+)"/.exec(sel);
    return dir ? el.children.find((c) => c.attrs["data-direction"] === dir[1]) || null : null;
  };
  return el;
}

function panel(widgetName, settings, editorExtras) {
  const definition = byName[widgetName];
  const values = Object.assign({ type: widgetName }, definition.defaults, settings);
  const model = {
    get: (k) => values[k],
    set: (patch) => Object.assign(values, patch),
    on: () => {},
    off: () => {},
  };
  const sections = {};
  for (const id of ["osc", "dmx", "midi"]) {
    sections[id] = node({ "data-oscar-section": id });
    sections[id].title = node({});
  }
  const root = { querySelectorAll: (sel) => (sel.indexOf("data-oscar-section") !== -1 ? Object.values(sections) : []) };
  const handlers = {};
  const editor = Object.assign({ getSelected: () => model, on: (events, fn) => events.split(" ").forEach((e) => (handlers[e] = fn)) }, editorExtras);
  const paint = sectionLights(editor, { document: { createElement: () => node({}) }, root });
  paint();
  const button = (id) => {
    const holder = sections[id].title.children[0];
    return holder ? holder.children.find((c) => c.className === "oscar-learn") || null : null;
  };
  const click = (id) => button(id).handlers.click({ stopPropagation() {} });
  return { values, button, click, handlers, paint };
}

/** An editor that can hear OSC: deliver(message) plays one in. */
function oscEars() {
  const ears = { listeners: [] };
  ears.onOscIn = (fn) => {
    ears.listeners.push(fn);
    return () => { ears.listeners = ears.listeners.filter((other) => other !== fn); };
  };
  ears.deliver = (message) => ears.listeners.slice().forEach((fn) => fn(message));
  return ears;
}

test("Learn is offered on the sections that can be taught, for a widget that has them, in an editor that can hear", () => {
  const ears = oscEars();
  const full = panel("oscar-slider", {}, { onOscIn: ears.onOscIn, learnMidi: () => () => {} });
  assert.strictEqual(full.button("osc").textContent, "Learn");
  assert.strictEqual(full.button("midi").textContent, "Learn");
  assert.strictEqual(full.button("dmx"), null, "DMX only goes out: there is nothing to hear");

  assert.strictEqual(panel("oscar-slider", {}, {}).button("osc"), null, "an editor with no way to hear offers nothing");
  const meter = panel("oscar-meter", {}, { onOscIn: ears.onOscIn, learnMidi: () => () => {} });
  assert.strictEqual(meter.button("osc").textContent, "Learn", "a meter only follows, which is all Learn needs");
  assert.strictEqual(meter.button("midi"), null, "and it has no MIDI section");
});

test("OSC Learn takes the address of the next message, turns Data in on, and stops listening", () => {
  const ears = oscEars();
  const p = panel("oscar-slider", { message: "/slider1", listen: false }, { onOscIn: ears.onOscIn });

  p.click("osc");
  assert.strictEqual(p.button("osc").textContent, "Listening...");
  assert.strictEqual(p.button("osc").attrs["data-busy"], "true");
  assert.strictEqual(p.values.message, "/slider1", "nothing changes until something arrives");

  ears.deliver({ address: "/composition/layers/1/video/opacity", args: [{ type: "f", value: 0.5 }] });
  assert.strictEqual(p.values.message, "/composition/layers/1/video/opacity");
  assert.strictEqual(p.values.listen, true);
  assert.strictEqual(p.button("osc").textContent, "Learned");
  assert.strictEqual(ears.listeners.length, 0);

  // The next message is just a message.
  ears.deliver({ address: "/something/else", args: [] });
  assert.strictEqual(p.values.message, "/composition/layers/1/video/opacity");
});

test("a pad that sends its axes apart learns the address they share", () => {
  const ears = oscEars();
  const p = panel("oscar-xypad", { sendMode: "two" }, { onOscIn: ears.onOscIn });
  p.click("osc");
  ears.deliver({ address: "/head/1/y", args: [] });
  assert.strictEqual(p.values.message, "/head/1");
});

test("a second click calls Learn off, and so does picking another widget", () => {
  const ears = oscEars();
  const p = panel("oscar-slider", { message: "/slider1" }, { onOscIn: ears.onOscIn });
  p.click("osc");
  p.click("osc");
  assert.strictEqual(p.button("osc").textContent, "Learn");
  assert.strictEqual(ears.listeners.length, 0);

  p.click("osc");
  p.handlers["component:selected"]();
  assert.strictEqual(ears.listeners.length, 0, "Learn belongs to the widget it was started on");
  ears.deliver({ address: "/late", args: [] });
  assert.strictEqual(p.values.message, "/slider1");
});

test("MIDI Learn fills port, channel, type and number from what was played, or says why not", () => {
  let answer = null;
  let stopped = 0;
  const learnMidi = (fn) => { answer = fn; return () => { stopped++; }; };
  const p = panel("oscar-button", {}, { learnMidi });

  p.click("midi");
  assert.strictEqual(p.button("midi").textContent, "Listening...");
  answer({ port: "Launchpad Mini", type: "note", channel: 10, number: 36 });
  assert.deepStrictEqual(
    [p.values.midiInPort, p.values.midiChannel, p.values.midiType, p.values.midiNumber, p.values.midiListen],
    ["Launchpad Mini", 10, "note", 36, true]
  );
  assert.strictEqual(p.values.midiEnabled, false, "hearing a controller is no reason to start sending to one");
  assert.strictEqual(p.button("midi").textContent, "Learned");

  p.click("midi");
  answer({ error: "Nothing was played." });
  assert.strictEqual(p.button("midi").textContent, "Nothing was played.");
  assert.strictEqual(p.values.midiNumber, 36, "and nothing is changed");

  p.click("midi");
  p.click("midi");
  assert.strictEqual(stopped, 1, "calling it off tells the server to stop waiting");
});

test("ticking MIDI's Data in names a port, so OSCAR does not take every controller from every other program", () => {
  const { suggest, namedMidiInput } = require("../public/src/adapters/grapesjs");
  suggest("midi-inputs", ["nanoKONTROL2", "Launchpad Mini"]);
  assert.strictEqual(namedMidiInput({ midiListen: true, midiInPort: "" }), "nanoKONTROL2", "the first there is");
  assert.strictEqual(namedMidiInput({ midiListen: true, midiInPort: "Launchpad" }), null, "one that is named is left alone");
  assert.strictEqual(namedMidiInput({ midiListen: false, midiInPort: "" }), null, "only when Data in goes on");
  suggest("midi-inputs", []);
  assert.strictEqual(namedMidiInput({ midiListen: true, midiInPort: "" }), null, "nothing plugged in: left blank, which is the first port when one turns up");
});
