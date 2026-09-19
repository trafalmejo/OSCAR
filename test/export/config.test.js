"use strict";

/**
 * A widget's settings on their way out of the editor and back in on the
 * exported page. Every test that names no widget walks WIDGETS, so a widget
 * added to the registry is held to the same promises without being listed.
 */

const test = require("node:test");
const assert = require("node:assert");

const { WIDGETS } = require("../../lib/widgets");
const { NAME_ATTR, CONFIG_ATTR, exportAttributes, readWidget, definitionFor } = require("../../lib/export/config");

function elementWith(attributes) {
  return {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    },
  };
}

test("every registered widget's settings survive the trip, types intact", () => {
  assert.ok(WIDGETS.length >= 8);
  for (const widget of WIDGETS) {
    const attributes = exportAttributes(widget.name, (key) => widget.defaults[key]);
    assert.strictEqual(attributes[NAME_ATTR], widget.name);
    assert.strictEqual(typeof attributes[CONFIG_ATTR], "string");

    const back = readWidget(elementWith(attributes));
    assert.strictEqual(back.definition, widget, widget.name);
    assert.deepStrictEqual(back.config, widget.defaults, widget.name + " came back changed");
  }
});

test("what is carried is what the editor holds, not the defaults", () => {
  const slider = WIDGETS.find((w) => w.name === "oscar-slider");
  const edited = Object.assign({}, slider.defaults, { ip: "10.0.0.7", port: 9001, invert: true, message: "/master" });
  const back = readWidget(elementWith(exportAttributes(slider.name, (key) => edited[key])));
  assert.strictEqual(back.config.ip, "10.0.0.7");
  assert.strictEqual(back.config.port, 9001, "a number, not the string an attribute would make of it");
  assert.strictEqual(back.config.invert, true, "a boolean: the string 'false' would be truthy");
});

test("only the keys a definition declares travel", () => {
  const button = WIDGETS.find((w) => w.name === "oscar-button");
  const attributes = exportAttributes(button.name, () => "x");
  assert.deepStrictEqual(Object.keys(JSON.parse(attributes[CONFIG_ATTR])).sort(), Object.keys(button.defaults).sort());
});

test("a component that is not a widget gains nothing", () => {
  assert.strictEqual(exportAttributes("text", () => 1), null);
  assert.strictEqual(exportAttributes(undefined, () => 1), null);
  // byName is a plain object; its prototype's members are not widgets.
  assert.strictEqual(exportAttributes("constructor", () => 1), null);
  assert.strictEqual(definitionFor("__proto__"), null);
});

test("an element that does not claim to be a widget is left alone", () => {
  assert.strictEqual(readWidget(elementWith({})), null);
  assert.strictEqual(readWidget(null), null);
});

test("damaged settings are a problem, never the defaults", () => {
  for (const widget of WIDGETS) {
    const good = exportAttributes(widget.name, (key) => widget.defaults[key]);
    const keys = Object.keys(widget.defaults);

    const partial = JSON.parse(good[CONFIG_ATTR]);
    delete partial[keys[keys.length - 1]];

    const damaged = [
      { [NAME_ATTR]: widget.name },
      { [NAME_ATTR]: widget.name, [CONFIG_ATTR]: "" },
      { [NAME_ATTR]: widget.name, [CONFIG_ATTR]: "{not json" },
      { [NAME_ATTR]: widget.name, [CONFIG_ATTR]: "[]" },
      { [NAME_ATTR]: widget.name, [CONFIG_ATTR]: "7" },
      { [NAME_ATTR]: widget.name, [CONFIG_ATTR]: "null" },
      { [NAME_ATTR]: widget.name, [CONFIG_ATTR]: JSON.stringify(partial) },
    ];
    for (const attributes of damaged) {
      const back = readWidget(elementWith(attributes));
      assert.ok(back && back.problem, widget.name + " read " + JSON.stringify(attributes));
      assert.strictEqual(back.config, undefined);
      assert.strictEqual(back.definition, undefined);
    }
  }
});

test("a widget this runtime does not know is a problem, not a guess", () => {
  const back = readWidget(elementWith({ [NAME_ATTR]: "oscar-hologram", [CONFIG_ATTR]: "{}" }));
  assert.match(back.problem, /unknown widget/);
});

test("a setting the editor holds as undefined still travels, as null", () => {
  const button = WIDGETS.find((w) => w.name === "oscar-button");
  const back = readWidget(elementWith(exportAttributes(button.name, () => undefined)));
  assert.ok(back.config, "every key present, so it is not damage");
  for (const key of Object.keys(button.defaults)) assert.strictEqual(back.config[key], null);
});
