"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  NAME_ATTR,
  CONFIG_ATTR,
  exportAttributes,
  readWidget,
  parseConfig,
} = require("../lib/export/config");
const { WIDGETS } = require("../lib/widgets");
const { button } = require("../lib/widgets/button");
const { slider } = require("../lib/widgets/slider");
const { fakeElement } = require("./helpers/fake-dom");

/** An element wearing the attributes an export would put on it. */
function exported(name, config) {
  const el = fakeElement();
  const attributes = exportAttributes(name, config);
  for (const key of Object.keys(attributes)) el.setAttribute(key, attributes[key]);
  return el;
}

// --- the round trip ---------------------------------------------------------

test("every widget's settings survive the trip into markup and back", () => {
  for (const widget of WIDGETS) {
    const read = readWidget(exported(widget.name, widget.defaults));
    assert.ok(read, widget.name + " is recognised");
    assert.strictEqual(read.name, widget.name);
    assert.deepStrictEqual(read.config, widget.defaults, widget.name + " came back changed");
  }
});

test("types survive: a flag is still a boolean and a port is still a number", () => {
  // One attribute per setting would make these the strings "false" and "7000",
  // and "false" is truthy -- an inverted slider would come back running the
  // right way round and a working one would come back inverted.
  const read = readWidget(
    exported(slider.name, Object.assign({}, slider.defaults, { invert: false, port: 7000 }))
  );

  assert.strictEqual(read.config.invert, false);
  assert.strictEqual(read.config.port, 7000);
});

test("a widget carries its own target, not the editor's idea of one", () => {
  const read = readWidget(
    exported(
      slider.name,
      Object.assign({}, slider.defaults, { ip: "10.0.0.9", port: 9000, message: "/master/level" })
    )
  );

  assert.strictEqual(read.config.ip, "10.0.0.9");
  assert.strictEqual(read.config.port, 9000);
  assert.strictEqual(read.config.message, "/master/level");
});

test("only what the widget declares is written out", () => {
  // A component model also holds position, layer name and selection state.
  // None of that is configuration and none of it belongs on a control surface.
  const attributes = exportAttributes(
    button.name,
    Object.assign({}, button.defaults, { draggable: false, "layer-name": "Button 3" })
  );

  const written = JSON.parse(attributes[CONFIG_ATTR]);
  assert.deepStrictEqual(Object.keys(written).sort(), Object.keys(button.defaults).sort());
});

test("a setting the editor never gave a value is left out, not written as null", () => {
  const written = JSON.parse(
    exportAttributes(button.name, { ip: "1.2.3.4", port: 7000 })[CONFIG_ATTR]
  );

  assert.strictEqual(Object.prototype.hasOwnProperty.call(written, "message"), false);
  assert.deepStrictEqual(written, { ip: "1.2.3.4", port: 7000 });
});

test("a partial configuration fills its gaps from the widget's defaults", () => {
  // This is the path for someone re-aiming an exported file by hand.
  const el = fakeElement();
  el.setAttribute(NAME_ATTR, button.name);
  el.setAttribute(CONFIG_ATTR, '{"ip":"192.168.1.40","message":"/go"}');

  const read = readWidget(el);
  assert.strictEqual(read.config.ip, "192.168.1.40");
  assert.strictEqual(read.config.message, "/go");
  assert.strictEqual(read.config.port, button.defaults.port);
  assert.strictEqual(read.config.argType, button.defaults.argType);
});

// --- what is not a widget ---------------------------------------------------

test("a plain element is not mistaken for a widget", () => {
  assert.strictEqual(readWidget(fakeElement()), null);
  assert.strictEqual(readWidget(null), null);
  assert.strictEqual(readWidget({}), null);
});

test("an unknown widget name is refused rather than guessed at", () => {
  assert.strictEqual(exportAttributes("oscar-theremin", {}), null);

  const el = fakeElement();
  el.setAttribute(NAME_ATTR, "oscar-theremin");
  el.setAttribute(CONFIG_ATTR, "{}");
  assert.strictEqual(readWidget(el), null);
});

test("unreadable settings leave the control inert rather than aimed at the defaults", () => {
  // Falling back to the defaults would point it at localhost:7000 /slider1 --
  // a live control firing at whatever happens to be listening there. A dead
  // control is the safer failure and the easier one to spot.
  for (const raw of ["{not json}", "", "[1,2,3]", "42", '"text"', "null"]) {
    const el = fakeElement();
    el.setAttribute(NAME_ATTR, slider.name);
    el.setAttribute(CONFIG_ATTR, raw);
    assert.strictEqual(readWidget(el), null, "accepted " + JSON.stringify(raw));
  }
});

test("a widget marker with no settings at all is refused", () => {
  const el = fakeElement();
  el.setAttribute(NAME_ATTR, slider.name);
  assert.strictEqual(readWidget(el), null);
});

test("an empty settings object is a choice, and is honoured", () => {
  const el = fakeElement();
  el.setAttribute(NAME_ATTR, slider.name);
  el.setAttribute(CONFIG_ATTR, "{}");
  assert.deepStrictEqual(readWidget(el).config, slider.defaults);
});

// --- parseConfig ------------------------------------------------------------

test("parseConfig takes objects and nothing else", () => {
  assert.deepStrictEqual(parseConfig('{"a":1}'), { a: 1 });
  assert.strictEqual(parseConfig("[]"), null);
  assert.strictEqual(parseConfig("0"), null);
  assert.strictEqual(parseConfig(undefined), null);
  assert.strictEqual(parseConfig(null), null);
});
