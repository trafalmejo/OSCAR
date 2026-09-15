/**
 * The GrapesJS adapter: the only file in OSCAR that knows what editor we use.
 *
 * It translates a neutral widget definition (lib/widgets/) into the things
 * GrapesJS wants -- a component type, a trait list, a block -- and supplies the
 * `ctx` the widget's behaviour runs against. Swapping editors means rewriting
 * this file; the widgets themselves do not change.
 */

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
 * The fields that apply to a widget as it is currently configured.
 *
 * A field may carry `showIf: { key, in: [...] }`, which is how the DMX half of
 * a panel stays out of the way of anyone sending only OSC. The rule is data
 * rather than a callback so the adapter can also work out which settings it has
 * to watch for the panel to keep up.
 */
function visibleFields(definition, config) {
  return definition.fields.filter(function (field) {
    var rule = field.showIf;
    if (!rule) return true;
    return rule.in.indexOf(config[rule.key]) !== -1;
  });
}

/** The settings some field's visibility depends on. */
function revealKeys(definition) {
  var keys = [];
  definition.fields.forEach(function (field) {
    if (field.showIf && keys.indexOf(field.showIf.key) === -1) keys.push(field.showIf.key);
  });
  return keys;
}

/**
 * Build the `ctx` a widget's behaviour runs against.
 *
 * `set` writes with `silent` so that storing a value mid-drag cannot trigger
 * the validators or a re-render -- the old slider needed a `fromView` flag
 * threaded through its model to dodge exactly that, and the pad would have
 * fought its own handle.
 *
 * `onOsc`, `share` and `onShared` are the network coming the other way. They
 * only ever hand a widget a value; none of them can make it send one, which is
 * deliberate -- that asymmetry is what stops a value arriving from outside
 * being bounced straight back out.
 */
function contextFor(view, editor) {
  var model = view.model;

  return {
    // The component's own id, which is what names this widget's claim on a
    // block of DMX channels. It survives saving, loading and reconnecting, so a
    // tablet that drops off the wifi resumes driving the same channels instead
    // of appearing as a second source fighting the first.
    id: model.getId(),

    get: function (key) {
      return model.get(key);
    },

    set: function (key, value) {
      model.set(key, value, { silent: true });
    },

    // A message may carry an OSC half, a DMX half, or both; each goes out on
    // its own bridge and neither waits for the other.
    send: function (message) {
      if (!message) return;
      if (message.address && editor.sendOSC) {
        editor.sendOSC(message.ip, message.port, message.address, message.args);
      }
      if (message.dmx && editor.sendDMX) editor.sendDMX(message.dmx);
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

    onOsc: function (fn) {
      if (!editor.onOscIn) return noop;
      return editor.onOscIn(fn);
    },

    // A component's GrapesJS id is saved into the project, so the same widget
    // carries the same id on every device the layout was pushed to. That is
    // what lets two tablets recognise each other's state at all.
    share: function (state) {
      if (editor.shareState) editor.shareState(model.getId(), state);
    },

    onShared: function (fn) {
      if (!editor.onSharedState) return noop;
      return editor.onSharedState(model.getId(), fn);
    },
  };
}

function noop() {}

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
            traits: visibleFields(definition, defaults).map(toTrait),
          },
          defaults,
          // A widget whose label is its text content renders that text as its
          // only child; anything else starts empty.
          definition.text ? { components: String(defaults[definition.text] || "") } : {}
        ),

        init: function () {
          var model = this;

          // A loaded project may already be set to DMX, and switching Output
          // has to bring the right half of the panel with it. GrapesJS renders
          // the trait list once per selection, so the panel is also told to
          // redraw the component it is showing.
          var reveals = revealKeys(definition);
          if (reveals.length) {
            // The type's traits were built from its defaults. A component read
            // back from a saved project may disagree with them, so its panel is
            // rebuilt -- but only when it would actually come out different.
            var wanted = visibleFields(definition, configOf(model, definition));
            var current = model.get("traits");
            if (!current || current.length !== wanted.length) {
              model.set("traits", wanted.map(toTrait));
            }

            model.on(
              reveals
                .map(function (key) {
                  return "change:" + key;
                })
                .join(" "),
              function () {
                model.set(
                  "traits",
                  visibleFields(definition, configOf(model, definition)).map(toTrait)
                );
                editor.trigger("component:toggled");
              }
            );
          }

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
          // DMX is a stream: deleting a widget that was driving channels has to
          // hand them back, or the rig holds that widget's last look with
          // nothing left on the surface able to change it.
          if (editor.stopDMX) editor.stopDMX(this.model.getId());

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

module.exports = {
  register: register,
  toTrait: toTrait,
  matches: matches,
  visibleFields: visibleFields,
  revealKeys: revealKeys,
};
