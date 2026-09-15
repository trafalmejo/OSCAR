/**
 * The GrapesJS adapter: the only file in OSCAR that knows what editor we use.
 *
 * It translates a neutral widget definition (lib/widgets/) into the things
 * GrapesJS wants -- a component type, a trait list, a block -- and supplies the
 * `ctx` the widget's behaviour runs against. Swapping editors means rewriting
 * this file; the widgets themselves do not change.
 */

var { WIDGETS } = require("../../../lib/widgets");

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
 *
 * `onOsc` is the network coming the other way, and `send` is shut for as long
 * as a message is being delivered through it. That is the host's half of the
 * loop guard: a widget has no way to lift it, so a value that arrived from
 * outside cannot be bounced straight back out by any widget, however it is
 * written. (The widgets' half is in lib/widgets/incoming.js.)
 */
function contextFor(view, editor) {
  var model = view.model;
  var delivering = 0;

  var ctx = {
    onRewrite: function (fn) {
      view.oscarRewrites = (view.oscarRewrites || []).concat([fn]);
      return function () {
        view.oscarRewrites = (view.oscarRewrites || []).filter(function (f) {
          return f !== fn;
        });
      };
    },

    get: function (key) {
      return model.get(key);
    },

    set: function (key, value) {
      model.set(key, value, { silent: true });
    },

    send: function (message) {
      if (delivering) {
        console.warn("OSCAR: a widget tried to answer incoming OSC with outgoing OSC; dropped", message);
        return;
      }
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

  // Only a host that can receive offers onOsc at all; the widgets check for
  // it (through follow() in lib/widgets/incoming.js) rather than assume it.
  if (editor.onOscIn) {
    ctx.onOsc = function (fn) {
      return editor.onOscIn(function (message) {
        delivering++;
        try {
          fn(message);
        } finally {
          delivering--;
        }
      });
    };
  }

  return ctx;
}

/** Let the widget put back what GrapesJS just wiped off its element. */
function rewritten(view) {
  (view.oscarRewrites || []).forEach(function (fn) {
    fn();
  });
}

/**
 * Register one widget definition with GrapesJS.
 *
 * Returns a plugin function, which is what the editor's `plugins` list takes.
 */
function register(definition) {
  return function (editor, options) {
    var ipserver = (options && options.ipserver) || "localhost";

    // A widget that talks to the network starts pointed at this machine. One
    // that does not has no ip setting, and must not carry a hidden one.
    var defaults = Object.assign(
      {},
      definition.defaults,
      definition.sends || definition.receives ? { ip: ipserver } : {}
    );

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

      // GrapesJS's own updateAttributes strips every attribute off the element
      // and re-applies the model's copy, and updateClasses does the same for
      // the class list, on every class or style edit. Whatever the widget
      // wrote straight onto the element goes with them, so each runs the
      // widget's onRewrite handlers afterwards (extendFnView calls the
      // original first).
      extendFnView: ["updateAttributes", "updateClasses"],

      view: {
        updateAttributes: function () {
          rewritten(this);
        },

        updateClasses: function () {
          rewritten(this);
        },

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
 * One plugin per registered widget, each told the address other devices
 * should send to. This is the whole of what an entry point needs to do to get
 * every widget: spread it into the editor's `plugins` list.
 */
function widgetPlugins(ipServer) {
  return WIDGETS.map(function (definition) {
    var plugin = register(definition);
    return function (editor) {
      plugin(editor, { ipserver: ipServer });
    };
  });
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

module.exports = {
  register: register,
  widgetPlugins: widgetPlugins,
  toTrait: toTrait,
  matches: matches,
};
