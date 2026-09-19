"use strict";

/**
 * ownsChildren: a widget that builds the elements inside itself.
 *
 * The contract is in lib/widgets/index.js. These tests are about the flag and
 * what a host owes it, with a probe widget, so they hold for any widget that
 * sets it and not only for the one that needed it first.
 */

const test = require("node:test");
const assert = require("node:assert");

const { validate, WIDGETS } = require("../lib/widgets");
const { register } = require("../public/src/adapters/grapesjs");

function probe(extra) {
  return Object.assign(
    {
      name: "oscar-owner-probe",
      tag: "div",
      attributes: { class: "oscar-owner-probe" },
      sends: false,
      receives: false,
      dmx: false,
      block: { label: "Probe", category: "OSC", icon: "<svg></svg>" },
      defaults: { rows: "a; b" },
      fields: [],
      checks: {},
      attach: () => () => {},
    },
    extra
  );
}

function registered(definition) {
  const types = {};
  const editor = {
    on() {},
    DomComponents: { addType: (name, type) => (types[name] = type) },
    BlockManager: { add() {} },
  };
  register(definition)(editor, {});
  return types[definition.name];
}

/** An element as the parser hands it to isComponent. */
function parsedElement(className) {
  return {
    tagName: "DIV",
    getAttribute: () => null,
    classList: { contains: (name) => name === className },
  };
}

/** A component model holding children, with GrapesJS's components() getter-setter. */
function modelWith(children) {
  return {
    children: children,
    calls: [],
    get: () => undefined,
    on() {},
    getId: () => "i1",
    setId() {},
    components(next) {
      if (next === undefined) return this.children;
      this.calls.push(next);
      this.children = [];
      return this.children;
    },
  };
}

test("ownsChildren is optional, and has to be a boolean when given", () => {
  assert.doesNotThrow(() => validate(probe()));
  assert.doesNotThrow(() => validate(probe({ ownsChildren: true })));
  assert.doesNotThrow(() => validate(probe({ ownsChildren: false })));
  assert.throws(() => validate(probe({ ownsChildren: "yes" })), /ownsChildren \(must be true or false\)/);
  assert.throws(() => validate(probe({ ownsChildren: 1 })), /ownsChildren/);
});

test("a widget cannot both fill its element itself and have the host fill it with its label", () => {
  assert.throws(() => validate(probe({ ownsChildren: true, text: "rows" })), /ownsChildren together with text/);
  assert.doesNotThrow(() => validate(probe({ ownsChildren: false, text: "rows" })));
  for (const widget of WIDGETS) assert.ok(!(widget.ownsChildren && widget.text), widget.name);
});

test("parsed markup: the children of a widget that owns them are not read into the project", () => {
  // GrapesJS's parser descends into an element only when the type did not
  // already say what its components are. A page saved from a browser carries
  // the tiles the widget drew; parsed, they would be stored, selectable,
  // draggable out, and drawn twice.
  const owner = registered(probe({ ownsChildren: true }));
  assert.deepStrictEqual(owner.isComponent(parsedElement("oscar-owner-probe")), {
    type: "oscar-owner-probe",
    components: [],
  });
  assert.strictEqual(owner.isComponent(parsedElement("something-else")), undefined);
});

test("parsed markup: every other widget is recognised exactly as before", () => {
  const plain = registered(probe());
  assert.deepStrictEqual(plain.isComponent(parsedElement("oscar-owner-probe")), { type: "oscar-owner-probe" });
  assert.strictEqual(plain.isComponent(parsedElement("something-else")), undefined);
});

test("a project file: children stored for a widget that owns them are dropped when it is created", () => {
  const owner = registered(probe({ ownsChildren: true }));
  const model = modelWith([{ tagName: "button" }, { tagName: "button" }]);
  owner.model.init.call(model);
  assert.deepStrictEqual(model.calls, [""]);
  assert.deepStrictEqual(model.children, []);
});

test("a project file: a widget with nothing stored inside it is not touched, so loading is not an edit", () => {
  const owner = registered(probe({ ownsChildren: true }));
  const model = modelWith([]);
  owner.model.init.call(model);
  assert.deepStrictEqual(model.calls, []);
});

test("a project file: a widget that does not own its children keeps them", () => {
  const plain = registered(probe());
  const model = modelWith([{ tagName: "span" }]);
  plain.model.init.call(model);
  assert.deepStrictEqual(model.calls, []);
  assert.strictEqual(model.children.length, 1);
});

test("a host model with no components() is left alone rather than crashed", () => {
  const owner = registered(probe({ ownsChildren: true }));
  const model = modelWith([]);
  delete model.components;
  assert.doesNotThrow(() => owner.model.init.call(model));
});

test("a widget that owns its children starts with none in the editor's model", () => {
  const owner = registered(probe({ ownsChildren: true }));
  assert.strictEqual(owner.model.defaults.components, undefined);
  assert.strictEqual(owner.model.defaults.droppable, false, "and nothing can be dropped into it");
});
