/**
 * The GrapesJS adapter: the only file in OSCAR that knows what editor we use.
 *
 * It translates a neutral widget definition (lib/widgets/) into the things
 * GrapesJS wants -- a component type, a trait list, a block -- and supplies the
 * `ctx` the widget's behaviour runs against. Swapping editors means rewriting
 * this file; the widgets themselves do not change.
 */

var { WIDGETS } = require("../../../lib/widgets");
var { sendsDmx } = require("../../../lib/widgets/fields");

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

/** The fields a trait list holds, in order, as one comparable string. */
function traitKeys(traits) {
  if (!traits || typeof traits.map !== "function") return null;
  return traits
    .map(function (trait) {
      // A GrapesJS trait is a model once the component has built it, and a
      // plain descriptor before.
      return trait.key || (typeof trait.get === "function" ? trait.get("name") : trait.name);
    })
    .join(" ");
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
 * A field may carry `showIf: { key, in: [...] }` (lib/widgets/fields.js),
 * which is how the DMX half of a panel stays out of the way of anyone sending
 * only OSC. It is data rather than a callback so this file can also work out
 * which settings it has to watch for the panel to keep up.
 */
function visibleFields(definition, config) {
  return definition.fields.filter(function (field) {
    var rule = field.showIf;
    return !rule || rule.in.indexOf(config[rule.key]) !== -1;
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

function changeEvent(keys) {
  return keys
    .map(function (key) {
      return "change:" + key;
    })
    .join(" ");
}

/**
 * Which components are on their way out because someone deleted them.
 *
 * GrapesJS removes a widget's view for more reasons than deletion: opening a
 * project, and the preview page taking a push, tear the whole surface down
 * and build the new one (an undo does the same). Releasing DMX on every one
 * of those would black the stage out on "Push to preview" while a tablet is
 * mid-show. Only an actual deletion -- the trash icon, the Delete key, a
 * script calling remove() -- goes through Component.remove(), which announces
 * itself with component:remove:before; a load resets the wrapper's children
 * and never does -- what it does remove that way is the wrapper itself, the
 * page's body, and the whole surface going is not a widget being deleted.
 * A move is a remove-and-append flagged `temporary`, so it does not count
 * either. The set is per editor and filled once, however many widgets
 * register against it.
 */
var deletionsByEditor = typeof WeakMap === "function" ? new WeakMap() : null;

function deletionsOf(editor) {
  var marked = deletionsByEditor && deletionsByEditor.get(editor);
  if (marked) return marked;

  marked = new WeakSet();
  if (deletionsByEditor) deletionsByEditor.set(editor, marked);

  // A host without events cannot tell a deletion from a reload, and holding
  // the rig is the safe answer to not knowing.
  if (typeof editor.on !== "function") return marked;

  editor.on("component:remove:before", function (component, remove, opts) {
    if (!component || (opts && opts.temporary)) return;
    if (typeof component.get === "function" && component.get("type") === "wrapper") return;
    var mark = function (model) {
      marked.add(model);
    };
    // A deleted container takes the widgets inside it with it.
    if (typeof component.onAll === "function") component.onAll(mark);
    else mark(component);
  });

  return marked;
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
 *
 * `onShared` is the other devices on the surface, and while their state is
 * being delivered both `send` and `share` are shut: the device that acted
 * already put the message on the wire, and a device that re-shared what it
 * was handed would hand it straight back. `share` stays open while OSC is
 * being delivered, on purpose -- a value the rig sent is recorded, so a
 * device joining later starts where the rig left things -- but it goes out
 * marked as heard, and the server tells nobody: the other devices were sent
 * the same OSC message (lib/shared-sync.js).
 *
 * Only the pages that show the surface take part. The editor is handed no
 * shareState (see oscar_socket.js), so neither method exists there.
 *
 * A message may carry an OSC half, a DMX half, or both (lib/widgets/outgoing.js);
 * each goes out on its own bridge. The DMX half is stamped with the
 * component's id on the way, which is what names this widget's claim on its
 * channels: the same widget replaces its own claim on every move, and hands
 * it back when deleted. The id lives in the project file, so a tablet that
 * reloads the surface resumes driving the same channels instead of turning
 * up as a second source fighting the first.
 */
function contextFor(view, editor) {
  var model = view.model;
  // How deep this widget is in taking an incoming OSC message, and in
  // taking another device's state. Each shuts a different door.
  var delivering = 0;
  var adopting = 0;

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
      if (adopting) {
        // The device that acted already sent this; a second copy from every
        // tablet watching would be a retrigger downstream.
        console.warn("OSCAR: a widget tried to answer another device's state by sending; dropped", message);
        return;
      }
      if (!message) return;
      if (message.address && editor.sendOSC) {
        editor.sendOSC(message.ip, message.port, message.address, message.args);
      }
      if (message.dmx && editor.sendDMX) {
        editor.sendDMX(Object.assign({ source: model.getId() }, message.dmx));
      }
    },

    setClass: function (name, on) {
      // Straight onto the element, never onto the model: a class added to the
      // model is saved into the project file, so a surface stored while a
      // toggle happened to be on would reload wearing its on state.
      if (on) view.el.classList.add(name);
      else view.el.classList.remove(name);
    },

    onChange: function (keys, fn) {
      var event = changeEvent(keys);
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

  // Likewise share and onShared: only where the socket plugin put the other
  // devices within reach. The state is keyed by the component's id, which
  // is written into the project (see pinId), so the same widget carries the
  // same id on every device the layout was pushed to.
  if (editor.shareState) {
    ctx.share = function (state, how) {
      if (adopting) {
        console.warn("OSCAR: a widget tried to re-share the state it was handed; dropped", state);
        return;
      }
      // Whatever is shared while the rig's message is being delivered is
      // something every device heard, whether or not the widget said so:
      // it is recorded and nobody is told (lib/shared-sync.js).
      var heard = delivering > 0 || !!(how && how.heard === true);
      editor.shareState(model.getId(), state, { heard: heard, release: how && how.release });
    };
  }

  if (editor.onSharedState) {
    ctx.onShared = function (fn) {
      return editor.onSharedState(model.getId(), function (state) {
        adopting++;
        try {
          fn(state);
        } finally {
          adopting--;
        }
      });
    };
  }

  return ctx;
}

/**
 * Write the component's id into the project.
 *
 * GrapesJS only saves a component's id when something refers to it -- a
 * style rule, a script; otherwise the id is made up afresh on every load,
 * and made up differently on every device. Widgets placed on the canvas
 * pick up a style rule and keep their id that way, but one pasted in from
 * an imported template does not, and the state the tablets share for it
 * would be keyed by an id no other tablet has. Pinning it as an attribute
 * makes the id part of the project on every path.
 */
function pinId(model) {
  var attributes = model.get("attributes") || {};
  if (attributes.id || typeof model.setId !== "function") return;
  model.setId(model.getId());
}

/**
 * Empty a component whose widget builds its own children.
 *
 * What the widget draws lives on the view's element only and GrapesJS never
 * hears of it, which is the whole arrangement: no component, so nothing to
 * save, select, move or delete. This is for children that got into the model
 * some other way -- a project file edited by hand, or written by something
 * that stored them.
 */
function disown(model) {
  if (typeof model.components !== "function") return;
  var children = model.components();
  if (children && children.length) model.components("");
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
    var deletions = definition.dmx ? deletionsOf(editor) : null;

    // A widget with an Ip setting starts pointed at this machine. One without
    // -- a label, or a meter, which listens and never sends -- has nowhere to
    // point, and must not carry a hidden ip that nothing shows or checks. The
    // test is the setting itself rather than the sends flag, so the hidden
    // value and the visible field cannot come apart.
    var defaults = Object.assign(
      {},
      definition.defaults,
      "ip" in (definition.defaults || {}) ? { ip: ipserver } : {}
    );

    editor.DomComponents.addType(definition.name, {
      isComponent: function (el) {
        if (!matches(definition, el)) return;
        // A widget that builds its own children (ownsChildren, lib/widgets/
        // index.js) has none as far as the project goes. Markup pasted in or
        // imported -- a page saved from a browser, with the tiles the widget
        // drew still inside it -- would otherwise have them parsed into
        // components: stored, selectable, draggable out, and drawn a second
        // time next to the ones the widget builds. The parser only descends
        // into an element whose components are not already given.
        if (definition.ownsChildren) return { type: definition.name, components: [] };
        return { type: definition.name };
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

          // The id is what the other devices know this widget by; it has to
          // reach the project file, or it never reaches them.
          pinId(model);

          if (definition.ownsChildren) disown(model);

          // The type's trait list was built from its defaults. A component
          // read back from a saved project may be set to DMX already, and
          // switching Output has to bring the right half of the panel with
          // it. GrapesJS rebuilds its traits on change:traits and redraws the
          // panel itself, so the list is only ever set when it would differ --
          // judged by which fields it holds, since two states of a widget can
          // show the same number of different fields.
          var reveals = revealKeys(definition);
          if (reveals.length) {
            var refresh = function () {
              var wanted = visibleFields(definition, configOf(model, definition));
              if (traitKeys(model.get("traits")) === traitKeys(wanted)) return;
              model.set("traits", wanted.map(toTrait));
            };
            refresh();
            model.on(changeEvent(reveals), refresh);
          }

          // A widget switched away from DMX must hand its channels back, or
          // the rig holds that widget's last look with nothing left able to
          // change it. Enabled off does not release: a disabled fader holds
          // its level the way a silent OSC fader leaves the software where it
          // was, and a blackout is not "no change".
          if (definition.dmx) {
            model.on("change:transport", function () {
              if (!sendsDmx(configOf(model, definition)) && editor.stopDMX) editor.stopDMX(model.getId());
            });
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
          // DMX is a stream: a deleted widget that was driving channels hands
          // them back, or the rig holds its last look with nothing on the
          // surface able to change it. Only a deletion, though (see
          // deletionsOf): a surface being reloaded keeps every channel where
          // it is, and so does a browser merely disconnecting -- that is the
          // server's rule, and a phone locking its screen must not black out
          // a show.
          if (deletions && deletions.has(this.model)) {
            deletions.delete(this.model);
            if (editor.stopDMX) editor.stopDMX(this.model.getId());
          }

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
  visibleFields: visibleFields,
  revealKeys: revealKeys,
};
