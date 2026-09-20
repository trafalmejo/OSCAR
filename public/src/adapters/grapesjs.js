/**
 * The GrapesJS adapter: the only file in OSCAR that knows what editor we use.
 *
 * It translates a neutral widget definition (lib/widgets/) into the things
 * GrapesJS wants -- a component type, a trait list, a block -- and supplies the
 * `ctx` the widget's behaviour runs against. Swapping editors means rewriting
 * this file; the widgets themselves do not change.
 */

var { WIDGETS } = require("../../../lib/widgets");
var { sendsDmx, sendsMidi, upgradeRouting, sectionStatus, oscEndpoint, SECTIONS } = require("../../../lib/widgets/fields");
var features = require("../../../lib/features");
var { exportAttributes } = require("../../../lib/export/config");

/**
 * The collapsible section a field is drawn in. GrapesJS draws every trait
 * that has a category above every trait that has none, so the widget's own
 * settings get a section too -- first, because Enabled is the first field --
 * rather than ending up underneath the protocols.
 *
 * A protocol's section starts open when the widget uses that protocol. The
 * DMX section of a plain OSC button is one closed line, which keeps its panel
 * as short as it was before DMX existed.
 */
var WIDGET_SECTION = { id: "widget", label: "Widget" };
var SECTION_ATTRIBUTE = "data-oscar-section";

function categoryOf(field, config) {
  var section = null;
  SECTIONS.forEach(function (candidate) {
    if (candidate.id === field.section) section = candidate;
  });
  if (!section) return { id: WIDGET_SECTION.id, label: WIDGET_SECTION.label, open: true };
  // A protocol that is off starts folded away, so the panel of a widget that
  // only speaks OSC stays as short as it was before the others existed.
  var open = section.id === "dmx" ? sendsDmx(config || {}) : section.id === "midi" ? sendsMidi(config || {}) : true;
  // The attribute lands on the section's element, which is how the status
  // light finds it: by what it is, not by what its title happens to say.
  var attributes = {};
  attributes[SECTION_ATTRIBUTE] = section.id;
  return { id: section.id, label: section.label, open: open, attributes: attributes };
}

/** Neutral field descriptor -> GrapesJS trait. `config` decides which sections start open. */
function toTrait(field, config) {
  var trait = {
    // Every setting is a component property rather than an HTML attribute.
    // Attributes would end up in the exported markup, where they are noise at
    // best and a stale copy of the truth at worst.
    changeProp: true,
    name: field.key,
    label: field.label,
    type: field.type,
    category: categoryOf(field, config),
  };

  if (field.type === "select") {
    // GrapesJS wants { id, name }, which is the shape lib/widgets uses too.
    trait.options = field.options;
  }
  if (field.placeholder) trait.placeholder = field.placeholder;
  // Shown by the browser on hover. decoratePanel() copies it onto the label
  // too, which GrapesJS titles with the label's own text.
  // The field's name goes along so the panel can add to the hints that say
  // where data goes (see sectionLights).
  if (field.hint) trait.attributes = { title: field.hint, "data-oscar-field": field.key };
  if (field.min !== undefined) trait.min = field.min;
  if (field.max !== undefined) trait.max = field.max;
  if (field.step !== undefined) trait.step = field.step;

  return trait;
}

/** The whole panel for a widget in a given state. */
function traitsFor(definition, config) {
  return visibleFields(definition, config).map(function (field) {
    return toTrait(field, config);
  });
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
    // A protocol that is switched off (lib/features.js) has no section.
    if (field.section === "midi" && !features.MIDI) return false;
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
// The widget types that can hold DMX channels, by component type name.
var DMX_TYPES = {};
WIDGETS.forEach(function (definition) {
  if (definition.dmx) DMX_TYPES[definition.name] = true;
});

var deletionsByEditor = typeof WeakMap === "function" ? new WeakMap() : null;

function deletionsOf(editor) {
  var marked = deletionsByEditor && deletionsByEditor.get(editor);
  if (marked) return marked;

  marked = new WeakSet();
  if (deletionsByEditor) deletionsByEditor.set(editor, marked);

  // A host without events cannot tell a deletion from a reload, and holding
  // the rig is the safe answer to not knowing.
  if (typeof editor.on !== "function") return marked;

  // Deleting a whole page is a deletion of everything on it, and GrapesJS
  // announces it differently: the only component:remove:before is for the
  // page's wrapper, which is rightly ignored below, and a page that is not
  // showing has no views whose removal could hand anything back. So the
  // channels are given up here, by id, before the page's components are gone
  // (by page:remove they already are). A widget that holds no channels costs
  // a message the server answers with "not known".
  editor.on("page:remove:before", function (page) {
    if (!page || typeof page.getMainComponent !== "function" || !editor.stopDMX) return;
    var main = page.getMainComponent();
    if (!main || typeof main.onAll !== "function") return;
    main.onAll(function (model) {
      if (DMX_TYPES[model.get("type")]) editor.stopDMX(model.getId());
    });
  });

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
      if (message.midi && editor.sendMIDI) editor.sendMIDI(message.midi);
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

// The widget types that follow the rig, by component type name.
var RECEIVERS = {};
WIDGETS.forEach(function (definition) {
  if (definition.receives) RECEIVERS[definition.name] = definition;
});

// editor -> Map(component model -> detach), for the widgets kept running
// without a view. Per editor, like the deletions above.
var offstageByEditor = typeof WeakMap === "function" ? new WeakMap() : null;

/** Stop the viewless copy of one widget, if there is one: its view has arrived. */
function stopOffstage(editor, model) {
  var running = offstageByEditor && offstageByEditor.get(editor);
  var detach = running && running.get(model);
  if (!detach) return;
  running.delete(model);
  detach();
}

/**
 * Keep the widgets of the pages that are not showing listening to the rig.
 *
 * GrapesJS only builds views for the page on the canvas, and a widget only
 * runs while it has a view. So on a surface with several pages, what the rig
 * said to a fader on page two while page one was up reached nobody: with a
 * single tablet -- the usual rig -- no device anywhere was running that
 * fader, the value was never stored or recorded, and the fader came back
 * where it had been left, disagreeing with the rig. The next touch then sent
 * from the stale position, which is a jump on the rig.
 *
 * The components of every page exist whether or not they are showing; only
 * their views do not. So each widget that can receive is attached to an
 * element that is never put on screen, against the same ctx a view would
 * get. It does what it always does with what it hears -- stores it with
 * set(), shares it as heard -- and because nothing can touch an element that
 * is not in any document, it never sends. When its page is turned to, the
 * view's own attach takes over (onRender stops this copy first) and starts
 * from the stored value and, on a sharing device, the shared state.
 *
 * Widgets that only send are left alone: they have nothing to hear, and what
 * other devices do to them is cached by the socket plugin without them.
 *
 *   var offstage = runOffstage(editor, { document: document });
 *   offstage.start() / offstage.refresh() / offstage.stop()
 *
 * start() doubles as the refresh after a project load, which replaces every
 * component without necessarily announcing a page change.
 */
function runOffstage(editor, options) {
  var doc = (options && options.document) || (typeof document === "undefined" ? null : document);
  var running = new Map();
  var started = false;
  if (offstageByEditor) offstageByEditor.set(editor, running);

  function attach(model, definition) {
    var el = doc.createElement(definition.tag);
    var attributes = definition.attributes || {};
    Object.keys(attributes).forEach(function (name) {
      el.setAttribute(name, attributes[name]);
    });
    try {
      running.set(model, definition.attach(el, contextFor({ model: model, el: el }, editor)) || function () {});
    } catch (err) {
      // One widget that cannot run without a view must not stop the page
      // from turning, or the rest from listening.
      console.warn("OSCAR: a widget could not be kept listening off its page:", err && err.message);
    }
  }

  function refresh() {
    var wanted = new Map();
    if (started && doc && editor.Pages) {
      var selected = editor.Pages.getSelected();
      editor.Pages.getAll().forEach(function (page) {
        if (page === selected || typeof page.getMainComponent !== "function") return;
        var main = page.getMainComponent();
        if (!main || typeof main.onAll !== "function") return;
        main.onAll(function (model) {
          var definition = RECEIVERS[model.get("type")];
          if (definition) wanted.set(model, definition);
        });
      });
    }

    // Whatever is no longer off stage goes first: the page turned to, and
    // after a load every component of the project that was replaced.
    Array.from(running.keys()).forEach(function (model) {
      if (!wanted.has(model)) stopOffstage(editor, model);
    });
    wanted.forEach(function (definition, model) {
      if (!running.has(model)) attach(model, definition);
    });
  }

  // A host that cannot receive has nothing for these widgets to hear.
  if (typeof editor.on === "function" && editor.onOscIn) {
    editor.on("page:select page:add page:remove", refresh);
  }

  return {
    refresh: refresh,
    start: function () {
      started = !!editor.onOscIn;
      refresh();
    },
    stop: function () {
      started = false;
      refresh();
    },
    get size() {
      return running.size;
    },
  };
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
    var ownClass = definition.attributes && definition.attributes.class;

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
        return parsed(definition, el);
      },

      model: {
        defaults: Object.assign(
          {
            tagName: definition.tag,
            attributes: Object.assign({}, definition.attributes),
            droppable: false,
            resizable: true,
            traits: traitsFor(definition, defaults),
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

          // A widget's own class is how its stylesheet finds it and how a
          // project's HTML is recognised, not something to style through.
          // GrapesJS styles a component through its classes whenever it has
          // any, so every edit to one XY pad -- a resize, a move, a colour --
          // went to the rule all pads share, and they changed together.
          // Private keeps the class on the element but out of styling, so
          // edits land on this one component; protected stops it being
          // removed from the Classes list by accident.
          //
          // Flagged here, per component, rather than once when the plugin
          // loads: loading a project creates the selector afresh, and a flag
          // set on the earlier one is lost with it.
          // A host that keeps no class list has nothing to flag.
          var classes = ownClass ? model.get("classes") : null;
          if (classes && typeof classes.forEach === "function") {
            classes.forEach(function (selector) {
              if (selector.get("name") === ownClass) {
                selector.set({ private: true, protected: true });
              }
            });
          }

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
              model.set(
                "traits",
                wanted.map(function (field) {
                  return toTrait(field, configOf(model, definition));
                })
              );
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
            // A project saved while the choice was one Output setting says
            // osc, dmx or both. Turn that into the two checkboxes the panel
            // now shows, or they would sit at their defaults and lie about a
            // widget that is driving DMX. Silent: opening a project is not
            // an edit, and nothing has changed about what the widget does.
            var upgraded = upgradeRouting({ transport: model.get("transport") });
            if (upgraded) {
              model.set(upgraded, { silent: true });
              model.unset("transport", { silent: true });
            }

            // The type's panel was built with DMX off, so its DMX section
            // starts closed. One that is driving DMX opens on it.
            if (sendsDmx(configOf(model, definition))) {
              model.set("traits", traitsFor(definition, configOf(model, definition)));
            }

            model.on("change:dmxEnabled", function () {
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
          // The view takes over from the copy that listened while this page
          // was not showing (runOffstage); two of them would share twice.
          stopOffstage(editor, this.model);
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

/**
 * The markup and stylesheet an export is built from, with every widget's
 * settings written into the markup.
 *
 * The settings are handed to getHtml() as it serialises each component (its
 * `attributes` option is called per component, children included) and exist
 * only in the string it returns. They are never set on a model, not even for
 * the length of the call, so there is nothing to strip afterwards and no
 * moment at which an autosave, an undo step or a crash could catch a project
 * holding a second copy of its settings -- the thing toTrait's comment rules
 * out. Writing them on and taking them off again would also have GrapesJS
 * rewrite every widget's element twice per export, mid-show.
 *
 * Which components are widgets, and which keys travel, comes from WIDGETS by
 * way of lib/export/config.js; nothing here lists a widget.
 *
 * Only the first page: an exported file is one surface, and the dialog says
 * so when the project has more.
 */
function exportSnapshot(editor) {
  var pages = editor.Pages.getAll();
  var component = pages[0].getMainComponent();
  var widgets = 0;

  var html = editor.getHtml({
    component: component,
    attributes: function (model, attributes) {
      var settings = exportAttributes(model.get("type"), function (key) {
        return model.get(key);
      });
      if (!settings) return attributes;
      widgets++;
      // The id is the widget's name on the wire: its claim on DMX channels
      // and the key the devices share its state under. pinId writes it into
      // every widget that has been through init; this covers one that has
      // not, in the output only.
      var id = attributes && attributes.id ? null : typeof model.getId === "function" && model.getId();
      return Object.assign({}, attributes, id ? { id: id } : null, settings);
    },
  });

  return {
    html: html,
    css: editor.getCss({ component: component }) || "",
    pages: pages.length,
    widgets: widgets,
  };
}

/**
 * What an element parsed from HTML becomes: this widget, or nothing.
 *
 * A widget whose label is its text takes the label from the element too, so
 * pasted or templated code such as <button>Strobe</button> is a button called
 * Strobe in its settings, not one showing Strobe while its Label field says
 * something else.
 *
 * A widget that builds its own children (ownsChildren, lib/widgets/index.js)
 * has none as far as the project goes. Markup pasted in or imported -- a page
 * saved from a browser, with the tiles the widget drew still inside it --
 * would otherwise have them parsed into components: stored, selectable,
 * draggable out, and drawn a second time next to the ones the widget builds.
 * The parser only descends into an element whose components are already given.
 */
function parsed(definition, el) {
  if (!matches(definition, el)) return undefined;
  var result = { type: definition.name };
  if (definition.ownsChildren) result.components = [];
  if (definition.text) {
    var label = String(el.textContent || "").trim();
    if (label) result[definition.text] = label;
  }
  return result;
}

/**
 * Keep the canvas body in the surface's style. The style is saved on the
 * wrapper component, but the body is outside anything GrapesJS stores, so it
 * is brought back in line on every canvas load, project load, page turn (each
 * page has its own wrapper, and so its own style) and attribute change.
 * `copy(attributes, body)` does the copying.
 */
function followSurfaceStyle(editor, copy) {
  function sync() {
    var doc = editor.Canvas.getDocument();
    var wrapper = editor.getWrapper();
    if (doc && doc.body && wrapper) copy(wrapper.getAttributes(), doc.body);
  }
  editor.on("load canvas:frame:load project:load page:select", sync);
  editor.on("component:update:attributes", function (component) {
    if (component === editor.getWrapper()) sync();
  });
  sync();
}

/**
 * What the settings panel shows beyond what GrapesJS draws: lights on each
 * protocol section's title, one per direction the widget has (IN and OUT for
 * OSC, OUT alone for DMX, IN alone for a meter), green while that direction
 * is live on the selected widget and grey while it is not, so a collapsed
 * section still says what it is doing; and the hint of any setting that has
 * one, on its label.
 *
 * GrapesJS rebuilds the panel whenever the selection or a widget's trait list
 * changes and has no hook for after it has, so the panel is watched and
 * decorated again when its contents change. Only child elements are watched,
 * and a repaint changes attributes, so decorating cannot set itself off.
 */
var DIRECTIONS = [
  { id: "in", tag: "IN", label: "Data in", field: "listen" },
  { id: "out", tag: "OUT", label: "Data out", field: "oscEnabled" },
];

function sectionLights(editor, options) {
  var doc = (options && options.document) || document;
  var root = (options && options.root) || doc;
  // What the server said of itself: { listeningPort }, the one OSC in port.
  var server = { listeningPort: options && options.listeningPort };
  var watched = null;
  var unwatch = null;

  function paint() {
    var model = editor.getSelected();
    var definition = model && byType(model.get("type"));
    var config = definition ? configOf(model, definition) : {};
    var status = definition ? sectionStatus(definition.fields, config) : {};

    var sections = root.querySelectorAll("[" + SECTION_ATTRIBUTE + "]");
    Array.prototype.forEach.call(sections, function (section) {
      var title = section.querySelector("[data-title]");
      if (!title) return;
      var directions = status[section.getAttribute(SECTION_ATTRIBUTE)] || {};

      // One holder per title, made once; the lights in it are redrawn, since
      // which directions exist changes with the widget selected.
      var holder = title.querySelector(".oscar-section-lights");
      if (!holder) {
        holder = doc.createElement("span");
        holder.className = "oscar-section-lights";
        title.appendChild(holder);
      }
      DIRECTIONS.forEach(function (direction) {
        var light = holder.querySelector('[data-direction="' + direction.id + '"]');
        if (!(direction.id in directions)) {
          // The widget has no such direction: a meter never sends, DMX never listens.
          if (light) holder.removeChild(light);
          return;
        }
        if (!light) {
          light = doc.createElement("span");
          light.className = "oscar-section-light";
          light.setAttribute("data-direction", direction.id);
          // Two unlabelled dots would be a guess; the tag says which is which.
          light.textContent = direction.tag;
          holder.appendChild(light);
        }
        var on = directions[direction.id] === true;
        var words = direction.label + (on ? ": on" : ": off");
        // OSC's lights also say where: the port OSCAR listens on, or the
        // address this widget sends to.
        var where = section.getAttribute(SECTION_ATTRIBUTE) === "osc" ? oscEndpoint(direction.field, config, server) : "";
        if (where) words += ". " + where;
        light.setAttribute("data-on", String(on));
        // In words as well as colour, for a reader and for anyone who cannot
        // tell the two colours apart.
        light.setAttribute("title", words);
        light.setAttribute("role", "img");
        light.setAttribute("aria-label", words);
      });
    });

    // GrapesJS puts a trait's attributes on the wrapper around its row.
    var hinted = root.querySelectorAll(".gjs-trt-trait__wrp[title]");
    Array.prototype.forEach.call(hinted, function (row) {
      var key = row.getAttribute("data-oscar-field");
      var field = key && definition ? fieldOf(definition, key) : null;
      if (field && field.hint) {
        // Written from the field's own hint each time, so a changed port
        // replaces the old one rather than piling up after it.
        var where = oscEndpoint(key, config, server);
        row.setAttribute("title", where ? field.hint + " " + where : field.hint);
      }
      var label = row.querySelector(".gjs-label");
      if (label) label.setAttribute("title", row.getAttribute("title"));
      // A setting that names a list is offered it as suggestions, and stays
      // free text: a port unplugged for the night is still the widget's port.
      if (field && field.source && suggestions[field.source]) {
        var input = row.querySelector("input");
        if (input) input.setAttribute("list", listFor(doc, field.source));
      }
    });
  }

  function watch(model) {
    if (unwatch) unwatch();
    unwatch = null;
    watched = model || null;
    if (!watched || typeof watched.on !== "function") return;
    var events = "change:enabled change:listen change:oscEnabled change:dmxEnabled change:midiEnabled change:ip change:port";
    watched.on(events, paint);
    unwatch = function () {
      watched.off(events, paint);
    };
  }

  editor.on("component:selected component:deselected", function () {
    watch(editor.getSelected());
    // The panel is drawn after the selection is announced.
    setTimeout(paint, 0);
  });

  if (typeof MutationObserver === "function" && root.nodeType) {
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () {
        pending = false;
        paint();
      }, 0);
    }).observe(root, { childList: true, subtree: true });
  }

  return paint;
}

/**
 * Lists a text setting can suggest from, by the name a field gives as its
 * `source`. The editor fills them (suggest()); the panel hangs a <datalist>
 * on the input. Kept here, not fetched here: the adapter knows no routes.
 */
var suggestions = {};

function suggest(source, values) {
  suggestions[source] = Array.isArray(values) ? values.slice() : [];
  if (typeof document !== "undefined") listFor(document, source);
}

/** The id of the <datalist> for `source`, made or refilled as needed. */
function listFor(doc, source) {
  var id = "oscar-suggest-" + source;
  if (!doc.getElementById) return id;
  var list = doc.getElementById(id);
  if (!list) {
    list = doc.createElement("datalist");
    list.id = id;
    (doc.body || doc.documentElement).appendChild(list);
  }
  var wanted = (suggestions[source] || []).join("\n");
  if (list.getAttribute("data-values") !== wanted) {
    list.setAttribute("data-values", wanted);
    while (list.firstChild) list.removeChild(list.firstChild);
    (suggestions[source] || []).forEach(function (value) {
      var option = doc.createElement("option");
      option.value = value;
      list.appendChild(option);
    });
  }
  return id;
}

function fieldOf(definition, key) {
  var fields = definition.fields || [];
  for (var i = 0; i < fields.length; i++) if (fields[i].key === key) return fields[i];
  return null;
}

function byType(type) {
  for (var i = 0; i < WIDGETS.length; i++) if (WIDGETS[i].name === type) return WIDGETS[i];
  return null;
}

/**
 * Keep GrapesJS's select tool off for as long as the surface is being
 * previewed.
 *
 * Preview mode stops the tool, but GrapesJS starts its default command again
 * whenever a frame loads -- a page turn, a project load -- without asking
 * whether a preview is on. While it runs it cancels every click in the
 * canvas, so that a click selects instead of doing what clicking does. The
 * one control that depends on a click's default action is the colour picker,
 * whose dialog then never opens.
 *
 * Stopped through the editor's own stopDefault(), not by stopping the command:
 * that also clears the flag GrapesJS checks when the preview ends, so leaving
 * preview brings the select tool back as it should.
 */
function noSelectingWhile(editor, isPreviewing) {
  editor.on("command:run:select-comp", function () {
    if (!isPreviewing()) return;
    // After the run that announced itself has finished.
    setTimeout(function () {
      if (isPreviewing()) editor.getModel().stopDefault();
    }, 0);
  });
}

module.exports = {
  noSelectingWhile: noSelectingWhile,
  sectionLights: sectionLights,
  suggest: suggest,
  parsed: parsed,
  followSurfaceStyle: followSurfaceStyle,
  exportSnapshot: exportSnapshot,
  register: register,
  widgetPlugins: widgetPlugins,
  runOffstage: runOffstage,
  toTrait: toTrait,
  matches: matches,
  visibleFields: visibleFields,
  revealKeys: revealKeys,
};
