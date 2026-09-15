/**
 * The GrapesJS adapter: the only file in OSCAR that knows what editor we use.
 *
 * It translates a neutral widget definition (lib/widgets/) into the things
 * GrapesJS wants -- a component type, a trait list, a block -- and supplies the
 * `ctx` the widget's behaviour runs against. Swapping editors means rewriting
 * this file; the widgets themselves do not change.
 */

var { WIDGETS } = require("../../../lib/widgets");
var { exportAttributes, NAME_ATTR, CONFIG_ATTR } = require("../../../lib/export/config");

/** Neutral field descriptor -> GrapesJS trait. */
function toTrait(field) {
  var trait = {
    // Every setting is a component property rather than an HTML attribute.
    // Attributes would end up in the exported markup, where they are noise at
    // best and a stale copy of the truth at worst.
    changeProp: true,
    name: field.key,
    label: field.label,
    type: field.type,
  };

  if (field.type === "select") {
    // GrapesJS wants { id, name }, which is the shape lib/widgets uses too.
    trait.options = field.options;
  }
  if (field.placeholder) trait.placeholder = field.placeholder;
  if (field.min !== undefined) trait.min = field.min;
  if (field.max !== undefined) trait.max = field.max;
  if (field.step !== undefined) trait.step = field.step;

  return trait;
}

/** Read every configured value off a component, for validators that need context. */
function configOf(model, definition) {
  var config = {};
  for (var key in definition.defaults) {
    if (Object.prototype.hasOwnProperty.call(definition.defaults, key)) {
      config[key] = model.get(key);
    }
  }
  return config;
}

/**
 * Build the `ctx` a widget's behaviour runs against.
 *
 * `set` writes with `silent` so that storing a value mid-drag cannot trigger
 * the validators or a re-render -- the old slider needed a `fromView` flag
 * threaded through its model to dodge exactly that, and the pad would have
 * fought its own handle.
 */
function contextFor(view, editor) {
  var model = view.model;

  return {
    get: function (key) {
      return model.get(key);
    },

    set: function (key, value) {
      model.set(key, value, { silent: true });
    },

    send: function (message) {
      if (!message || !editor.sendOSC) return;
      editor.sendOSC(message.ip, message.port, message.address, message.args);
    },

    setClass: function (name, on) {
      // Straight onto the element, never onto the model: a class added to the
      // model is saved into the project file, so a surface stored while a
      // toggle happened to be on would reload wearing its on state.
      if (on) view.el.classList.add(name);
      else view.el.classList.remove(name);
    },

    onChange: function (keys, fn) {
      var event = keys
        .map(function (key) {
          return "change:" + key;
        })
        .join(" ");
      model.on(event, fn);
      return function () {
        model.off(event, fn);
      };
    },
  };
}

/**
 * Register one widget definition with GrapesJS.
 *
 * Returns a plugin function, which is what the editor's `plugins` list takes.
 */
function register(definition) {
  return function (editor, options) {
    var ipserver = (options && options.ipserver) || "localhost";

    var defaults = Object.assign({}, definition.defaults, { ip: ipserver });

    editor.DomComponents.addType(definition.name, {
      isComponent: function (el) {
        if (matches(definition, el)) return { type: definition.name };
      },

      model: {
        defaults: Object.assign(
          {
            tagName: definition.tag,
            attributes: Object.assign({}, definition.attributes),
            droppable: false,
            resizable: true,
            traits: definition.fields.map(toTrait),
          },
          defaults,
          // A widget whose label is its text content renders that text as its
          // only child; anything else starts empty.
          definition.text ? { components: String(defaults[definition.text] || "") } : {}
        ),

        init: function () {
          var model = this;

          if (definition.text) {
            model.on("change:" + definition.text, function () {
              model.components(String(model.get(definition.text) || ""));
            });
          }

          // Validation runs only on edits made through the settings panel.
          // Values the widget writes back go through ctx.set, which is silent.
          Object.keys(definition.checks || {}).forEach(function (key) {
            model.on("change:" + key, function () {
              var complaint = definition.checks[key](model.get(key), configOf(model, definition));
              if (!complaint) return;
              alert(complaint);
              model.set(key, model.previous(key), { silent: true });
              // The panel is already showing the rejected text; make it show
              // what the component actually holds.
              editor.trigger("component:toggled");
            });
          });
        },
      },

      view: {
        onRender: function () {
          if (this.oscarDetach) this.oscarDetach();
          this.oscarDetach = definition.attach(this.el, contextFor(this, editor));
        },

        removed: function () {
          if (!this.oscarDetach) return;
          this.oscarDetach();
          this.oscarDetach = null;
        },
      },
    });

    editor.BlockManager.add(definition.name, {
      label: definition.block.label,
      // GrapesJS 0.21+ no longer ships Font Awesome, so icons are inline SVG.
      media: definition.block.icon,
      category: definition.block.category,
      content: { type: definition.name },
    });
  };
}

/**
 * Recognise an element as this widget when a project is parsed.
 *
 * Matching on the tag alone is too greedy: every <input> in an imported form
 * would become a slider, so a widget that shares its tag is identified by the
 * attributes it was defined with.
 */
function matches(definition, el) {
  if (!el || !el.tagName) return false;
  if (el.tagName.toLowerCase() !== definition.tag) return false;

  var attributes = definition.attributes || {};
  if (attributes.type && el.getAttribute("type") !== attributes.type) return false;
  if (attributes.class && !(el.classList && el.classList.contains(attributes.class))) return false;
  return true;
}

/** Run `fn` for every OSCAR widget on the canvas, with its definition. */
function eachWidget(editor, fn) {
  var byName = {};
  WIDGETS.forEach(function (widget) {
    byName[widget.name] = widget;
  });

  editor.getWrapper().onAll(function (component) {
    var definition = byName[component.get("type")];
    if (definition) fn(component, definition);
  });
}

/**
 * The markup and stylesheet an export is built from.
 *
 * Each widget's settings are written onto its element as data-oscar attributes
 * for exactly as long as getHtml() takes to run, and taken off again. Leaving
 * them on would undo the decision toTrait explains: attributes are saved into
 * the project file, and a project carrying a copy of every setting has two
 * places for the truth to live and one of them goes stale on the next edit.
 *
 * Undo is paused and the writes are marked avoidStore, so neither the undo
 * stack nor the autosave notices anything happened.
 */
function exportSnapshot(editor) {
  var undo = editor.UndoManager;
  var restore = [];

  undo.stop();
  eachWidget(editor, function (component, definition) {
    var attributes = exportAttributes(definition.name, configOf(component, definition));
    if (!attributes) return;

    // The raw attributes object, not getAttributes(): that one folds in the
    // classes and id GrapesJS computes, and writing those back as literal
    // attributes would leave a component styled by a frozen copy of its
    // classes.
    var before = Object.assign({}, component.get("attributes"));
    // Changing attributes makes GrapesJS rewrite the element's attribute list
    // from the model, and the pad's handle position is not in the model -- it
    // is a custom property the widget writes straight onto the element. Without
    // this every pad's handle jumps to the corner after an export.
    var view = component.getView && component.getView();
    var el = view && view.el;

    restore.push({
      component: component,
      attributes: before,
      el: el,
      style: el ? el.getAttribute("style") : null,
    });
    component.set("attributes", Object.assign({}, before, attributes), { avoidStore: true });
  });

  try {
    return { html: editor.getHtml(), css: editor.getCss() };
  } finally {
    restore.forEach(function (entry) {
      entry.component.set("attributes", entry.attributes, { avoidStore: true });
      if (entry.el && entry.style !== null) entry.el.setAttribute("style", entry.style);
    });
    undo.start();
  }
}

module.exports = {
  register: register,
  toTrait: toTrait,
  matches: matches,
  eachWidget: eachWidget,
  exportSnapshot: exportSnapshot,
  NAME_ATTR: NAME_ATTR,
  CONFIG_ATTR: CONFIG_ATTR,
};
