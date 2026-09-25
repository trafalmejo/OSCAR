window.$ = $ = window.jQuery = require("jquery");

// jquery-confirm attaches itself to whichever jQuery it is handed. The bundle
// carries its own copy of jQuery, so it must be required here rather than
// loaded as a separate <script> tag -- otherwise it extends the page's jQuery
// and $.alert/$.confirm go missing on this one. Its CommonJS build exports an
// initialiser instead of running itself.
require("jquery-confirm")(window, $);
// Every $.alert and $.confirm draws with OSCAR's theme (css/oscar_theme.css)
// without each call site having to ask for it. jquery-confirm sizes its box
// with Bootstrap grid classes unless told otherwise, and with Bootstrap gone
// those classes have no width, so a prompt stretched across the whole screen.
window.jconfirm.defaults = { theme: "oscar", useBootstrap: false, boxWidth: "420px" };

// GrapesJS 0.21+ no longer ships Font Awesome, so OSCAR's icons are inline SVG.
var ICONS = {
  // Save and Load are a pair of folders, arrow up to send a project, arrow
  // down to bring one back. mdi-folder-upload and mdi-folder-download,
  // @mdi/svg 7.4.47 (Apache-2.0), copied from the package.
  save: "M20,6A2,2 0 0,1 22,8V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4H10L12,6H20M10.75,13H14V17H16V13H19.25L15,8.75",
  open: "M20,6A2,2 0 0,1 22,8V18A2,2 0 0,1 20,20H4C2.89,20 2,19.1 2,18V6C2,4.89 2.89,4 4,4H10L12,6H20M19.25,13H16V9H14V13H10.75L15,17.25",
  // mdi-palette and mdi-restore, @mdi/svg 7.4.47 (Apache-2.0): the widget
  // style gallery, and putting a widget back on its surface's style.
  palette: "M17.5,12A1.5,1.5 0 0,1 16,10.5A1.5,1.5 0 0,1 17.5,9A1.5,1.5 0 0,1 19,10.5A1.5,1.5 0 0,1 17.5,12M14.5,8A1.5,1.5 0 0,1 13,6.5A1.5,1.5 0 0,1 14.5,5A1.5,1.5 0 0,1 16,6.5A1.5,1.5 0 0,1 14.5,8M9.5,8A1.5,1.5 0 0,1 8,6.5A1.5,1.5 0 0,1 9.5,5A1.5,1.5 0 0,1 11,6.5A1.5,1.5 0 0,1 9.5,8M6.5,12A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,1 6.5,9A1.5,1.5 0 0,1 8,10.5A1.5,1.5 0 0,1 6.5,12M12,3A9,9 0 0,0 3,12A9,9 0 0,0 12,21A1.5,1.5 0 0,0 13.5,19.5C13.5,19.11 13.35,18.76 13.11,18.5C12.88,18.23 12.73,17.88 12.73,17.5A1.5,1.5 0 0,1 14.23,16H16A5,5 0 0,0 21,11C21,6.58 16.97,3 12,3Z",
  restore: "M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3Z",
  // mdi-upload, @mdi/svg 7.4.47 (Apache-2.0): publishing sends the surface
  // out, so its arrow points up. Import, beside it, brings code in and keeps
  // the arrow down that GrapesJS gives it. The two used to be the same icon.
  upload: "M9,16V10H5L12,3L19,10H15V16H9M5,20V18H19V20H5Z",
  // OSCAR's own mark, traced from assets/css/logo.png (the jellyfish, not the
  // word under it) with its strokes thickened to the weight the other icons
  // draw at. About wears it.
  jellyfish: "M12.2,8.4L12.2,9.4L12.7,9.8L13.6,9.4L14.4,9.8L15.1,9.3L14.9,8.3L13.9,7.6ZM8.1,8.8L8.1,9.3L8.8,9.8L9.4,9.4L10.4,9.8L10.9,9.4L10.9,8.4L9.8,7.6L8.8,7.9ZM10.4,1L7.9,2L6,3.8L4.1,7.5L4.3,10.4L6,12.7L6,16.9L5,18.5L5,19.5L6,20.2L6.8,19.9L7.8,18.7L8.1,17.5L8.4,20L9.8,20.4L10.4,19.9L10.6,13.2L10.8,18.7L11.4,19.2L12.4,19L12.7,18.7L12.9,13.2L13.1,22.2L14.4,22.8L15.2,22.2L15.2,13.4L15.6,13.2L17,14.9L18,15.4L18.9,15.4L19.7,14.7L19.5,13.7L17.9,12.6L17.9,11.9L19,10.3L19.2,7.6L17.9,4.6L16.1,2.5L13.6,1.2ZM7.8,5.1L9.1,3.8L10.6,3.2L12.6,3.2L14.2,3.8L15.6,5.1L17,8.3L16.7,9.9L15.2,11.1L10.9,10.8L8.6,11.3L7.3,10.8L6.5,9.6L6.3,8.3Z",
  help: "M15.07,11.25L14.17,12.17C13.45,12.89 13,13.5 13,15H11V14.5C11,13.39 11.45,12.39 12.17,11.67L13.41,10.41C13.78,10.05 14,9.55 14,9C14,7.89 13.1,7 12,7A2,2 0 0,0 10,9H8A4,4 0 0,1 12,5A4,4 0 0,1 16,9C16,9.88 15.64,10.67 15.07,11.25M13,19H11V17H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12C22,6.47 17.5,2 12,2Z",
  pages:
    "M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M19,21H8V7H19V21Z",
  remove: "M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z",
  locked:
    "M12,17A2,2 0 0,0 14,15C14,13.89 13.1,13 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6A2,2 0 0,1 4,20V10C4,8.89 4.9,8 6,8H7V6A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,3A3,3 0 0,0 9,6V8H15V6A3,3 0 0,0 12,3Z",
  unlocked:
    "M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V10A2,2 0 0,1 6,8H15V6A3,3 0 0,0 12,3A3,3 0 0,0 9,6H7A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,17A2,2 0 0,0 14,15A2,2 0 0,0 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17Z",
};

function icon(name, size) {
  size = size || 18;
  return (
    '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
    '<path fill="currentColor" d="' + ICONS[name] + '"/></svg>'
  );
}

var editor = {};

// One browserify bundle serves both the editor and the preview page, so each
// entry point only boots when its own container is on the page.
if (document.getElementById("gjs")) {
  // Extensions' scripts run as soon as this file has, which is before the
  // editor has finished loading. They wait here; see the end of this block.
  var extensionsWaiting = [];
  window.OSCAR = {
    api: 1,
    ready: function (fn) {
      if (typeof fn === "function") extensionsWaiting.push(fn);
    },
  };

  // Ask the server which address it is reachable on, so new widgets default to
  // an IP that other devices on the network can actually talk to.
  fetch("/connection")
    .then(function (res) {
      return res.json();
    })
    .catch(function () {
      return {};
    })
    .then(function (conn) {
      initGrape(conn.address || window.location.hostname || "localhost", conn.socketPort || 8081, conn.oscInPort);
      window.editor = editor;
    });

  checkForUpdate();
  loadDiagnostics();
  wireFeedbackButtons();
}

// ---- feedback --------------------------------------------------------------
// Reports are prefilled into GitHub's issue form and opened in the browser, so
// the person sees exactly what is being sent before submitting. OSCAR itself
// posts nothing and holds no credentials.
var ISSUES_URL = "https://github.com/trafalmejo/OSCAR/issues/new";

var diagnostics = null;

function loadDiagnostics() {
  fetch("/diagnostics")
    .then(function (res) {
      return res.json();
    })
    .then(function (info) {
      diagnostics = info || {};
      var el = document.getElementById("about-version");
      if (el && diagnostics.oscar) el.textContent = "OSCAR " + diagnostics.oscar;
    })
    .catch(function () {
      diagnostics = {};
    });
}

/** The version details a bug report always ends up asking for. */
function environmentReport() {
  var info = diagnostics || {};
  var lines = [
    "OSCAR:      " + (info.oscar || "unknown"),
    "Runs as:    " + (info.electron ? "desktop app (Electron " + info.electron + ")" : "browser"),
    "System:     " + (info.platform || "?") + " " + (info.arch || ""),
    "Node:       " + (info.node || "?"),
    "GrapesJS:   " + (typeof grapesjs !== "undefined" ? grapesjs.version : "?"),
    "Project:    format " + (info.projectFormat || "?"),
    // Whether this build can open a serial port at all is the first question
    // a "my Arduino does nothing" report raises. The port name stays out.
    "Serial:     " + (info.serial ? (info.serial.supported ? info.serial.state : "not in this build") : "?"),
    // Counts only: a MIDI port is named after the hardware plugged in.
    "MIDI:       " +
      (info.midi
        ? info.midi.supported
          ? (info.midi.outputs || []).length + " out, " + (info.midi.inputs || []).length + " in"
          : "not in this build"
        : "?"),
    // Behaviour nobody else sees is sometimes an extension's (lib/extensions.js).
    "Extensions: " +
      ((info.extensions || [])
        .map(function (e) {
          return e.name + (e.version ? " " + e.version : "");
        })
        .join(", ") || "none"),
    "Browser:    " + navigator.userAgent,
  ];
  return lines.join("\n");
}

function openIssue(template) {
  var url =
    ISSUES_URL +
    "?template=" +
    encodeURIComponent(template) +
    "&environment=" +
    encodeURIComponent(environmentReport());
  window.open(url, "_blank", "noopener");
}

function wireFeedbackButtons() {
  var report = document.getElementById("report-problem");
  if (report) {
    report.onclick = function (e) {
      e.preventDefault();
      openIssue("bug.yml");
    };
  }

  var suggest = document.getElementById("suggest-feature");
  if (suggest) {
    suggest.onclick = function (e) {
      e.preventDefault();
      // The feature form has no environment field; nothing to prefill.
      window.open(ISSUES_URL + "?template=feature.yml", "_blank", "noopener");
    };
  }
}

// ---- update notice ---------------------------------------------------------
// The server does the checking; this only reports what it found. It is a
// corner toast rather than a modal on purpose: OSCAR is often on screen during
// a show, and nothing here may steal focus, cover the toolbar, or block work.
var SKIPPED_KEY = "oscarSkippedUpdate";

function skippedVersion() {
  try {
    return localStorage.getItem(SKIPPED_KEY);
  } catch (err) {
    return null; // private windows and locked-down browsers
  }
}

function showUpdateNotice(info) {
  var box = document.createElement("div");
  box.className = "oscar-update";

  var title = document.createElement("div");
  title.className = "oscar-update-title";
  title.textContent = "OSCAR " + info.version + " is available";

  var current = document.createElement("div");
  current.className = "oscar-update-current";
  current.textContent = info.current
    ? "You are running " + info.current + "."
    : "You are running an older version.";

  var actions = document.createElement("div");
  actions.className = "oscar-update-actions";

  // Only ever link to a GitHub release page, whatever the server replied.
  var link = document.createElement("a");
  link.className = "oscar-update-get";
  link.textContent = "What's new";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.href = /^https:\/\/github\.com\//.test(info.url || "")
    ? info.url
    : "https://github.com/trafalmejo/OSCAR/releases/latest";

  var later = document.createElement("button");
  later.className = "oscar-update-later";
  later.type = "button";
  later.textContent = "Later";
  later.onclick = function () {
    box.remove();
  };

  var skip = document.createElement("button");
  skip.className = "oscar-update-skip";
  skip.type = "button";
  skip.textContent = "Skip this version";
  skip.onclick = function () {
    try {
      localStorage.setItem(SKIPPED_KEY, info.version);
    } catch (err) {
      /* nothing to do -- it just gets offered again next launch */
    }
    box.remove();
  };

  actions.appendChild(link);
  actions.appendChild(later);
  actions.appendChild(skip);
  box.appendChild(title);
  box.appendChild(current);
  box.appendChild(actions);
  document.body.appendChild(box);
}

function checkForUpdate() {
  fetch("/update")
    .then(function (res) {
      return res.json();
    })
    .then(function (info) {
      if (!info || !info.available || !info.version) return;
      if (info.version === skippedVersion()) return;
      showUpdateNotice(info);
    })
    .catch(function () {
      // Offline, or the server said nothing. Never worth bothering anyone.
    });
}

// The same module the server uses to stamp and check project files, so the
// format number and the "is this a project?" rule can never drift apart.
var projectFormat = require("../../lib/project-format");
var projectsTable = require("../../lib/projects-table");
var widgetStyles = require("../../lib/widget-styles");
var htmlDocument = require("../../lib/html-document");
var { followSurfaceStyle, sectionLights, noSelectingWhile, suggest, refreshChoices } = require("./adapters/grapesjs");

// Every widget in lib/widgets/registry.js, wired to GrapesJS by the adapter.
var { widgetPlugins, runOffstage } = require("./adapters/grapesjs");

// Tabs and the page-by-page lock, shared with the /preview page.
var oscarPages = require("./pages");
var features = require("../../lib/features");
var welcome = require("./first_run");

var oscarExport = require("./export_dialog");
var toolbarOrder = require("../../lib/toolbar-order");

var isProjectData = projectFormat.isGrapesProject;

function postJSON(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(function (res) {
    return res.json();
  });
}

function initGrape(ipServer, socketPort, oscInPort) {
  // Asked before the editor starts: starting it writes the first autosave.
  var firstRun = welcome.isFirstRun(window.localStorage);

  editor = grapesjs.init({
    // GrapesJS fetches Font Awesome from a CDN by default, which fails without
    // a word at a venue with no internet. The few icons it still draws that
    // way are supplied by css/oscar_theme.css instead.
    cssIcons: "",
    // The outline on a selected component is drawn inside the canvas, which
    // cannot see the editor's theme variables, so GrapesJS's own light blue
    // stayed while the handles and toolbar turned pink. canvasCss is added
    // after GrapesJS's rule and is editor-only: it never reaches a saved or
    // exported project. The colour is read from the theme, not repeated here.
    canvasCss:
      ".gjs-selected { outline: 2px solid " +
      (getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#ff3663") +
      " !important; }",
    dragMode: "absolute",
    // Code pasted into Import, and templates, are read with these.
    //
    // A whole document is reduced to its CSS and its body first (see
    // lib/html-document.js for why GrapesJS must not read it as a document),
    // and the style named on its <body> is put on the surface. data-gjs-min-x
    // becomes the minX setting, since HTML attribute names cannot hold
    // capitals. The rest are GrapesJS's own defaults, restated because this
    // option replaces them.
    parser: {
      optionsHtml: {
        preParser: function (input, context) {
          var doc = htmlDocument.readDocument(input);
          // A snippet keeps its shape; only the comments inside its <style>
          // blocks go, for the reason given at stripCssComments.
          if (!doc) return htmlDocument.cleanStyleBlocks(input);
          var wrapper = context && context.editor && context.editor.getWrapper();
          if (wrapper) {
            wrapper.setAttributes(widgetStyles.withSurfaceStyle(wrapper.getAttributes(), doc.bodyAttributes));
          }
          return doc.html;
        },
        htmlType: "text/html",
        allowScripts: false,
        allowUnsafeAttr: false,
        allowUnsafeAttrValue: false,
        keepEmptyTextNodes: false,
        convertDataGjsAttributesHyphens: true,
        convertAttributeValues: false,
      },
    },
    height: "100%",
    container: "#gjs",
    fromElement: true,
    allowScripts: 1,
    // The canvas is its own document and loads nothing from the editor page:
    // fonts, every style's tokens and the widgets all come in here.
    canvas: { styles: widgetStyles.canvasStylesheets() },
    // The surface follows its style too; see SURFACE_CSS for why this one
    // rule cannot sit in a layer.
    protectedCss: widgetStyles.SURFACE_CSS,
    assetManager: {
      assets: [
        "images/fruits/emoji-apple.png",
        "images/fruits/emoji-apple-click.png",
        "images/fruits/emoji-orange.png",
        "images/fruits/emoji-orange-click.png",
        "images/fruits/emoji-banana.png",
        "images/fruits/emoji-banana-click.png",
        "images/fruits/background.png",
      ],
    },
    // The canvas autosaves into this browser. Named projects are a separate,
    // explicit action that writes JSON files next to the OSCAR server.
    storageManager: {
      type: "local",
      autosave: true,
      autoload: true,
      stepsBeforeSave: 1,
      // A key distinct from 0.16's `gjs-*` entries, so a browser that ran an
      // older OSCAR ignores that data instead of half-loading it.
      options: { local: { key: welcome.AUTOSAVE_KEY } },
      // Stamp the autosave the same way saved files are stamped, and never
      // let editor state into it.
      onStore: function (data) {
        // formatFor, as for a saved file: a single page stays readable by
        // an older OSCAR sharing this browser's storage.
        return Object.assign(
          { oscarFormat: projectFormat.formatFor(data) },
          projectFormat.namePages(projectFormat.stripEditorState(data))
        );
      },
      onLoad: function (data) {
        if (!data || !Object.keys(data).length) return data;

        var format = typeof data.oscarFormat === "number" ? data.oscarFormat : 0;
        delete data.oscarFormat;

        // An autosave from a newer OSCAR would be quietly mangled by this one,
        // and the next change would save the damage. Start fresh, but keep the
        // newer copy rather than destroying someone's canvas.
        if (format > projectFormat.CURRENT_FORMAT) {
          try {
            localStorage.setItem("oscarProject.newer", JSON.stringify(data));
          } catch (err) {
            /* nothing more we can do */
          }
          console.warn(
            "OSCAR: this browser holds work from a newer OSCAR. Starting fresh; " +
              "the newer copy is kept under the oscarProject.newer key."
          );
          return {};
        }

        // Repair an autosave that already holds editor state. A build once
        // wrote the preview lock in here, which left widgets unmovable on
        // every launch; that data carries the current stamp, so a version
        // check would not catch it.
        data = projectFormat.stripEditorState(data);

        // And name its pages, on every load for the same reason: GrapesJS
        // drops an empty page name when it stores, so page one of an autosave
        // carrying the current stamp is routinely unnamed.
        data = projectFormat.namePages(data);

        // An autosave with no pages (from a crash mid-load, say) would leave
        // the editor blank and unusable on every launch, with no way out short
        // of clearing browser data. Start fresh -- `{}` is exactly what a
        // first-ever launch loads.
        if (isProjectData(data)) return data;
        console.warn("OSCAR: discarding an unreadable autosave and starting fresh");
        return {};
      },
    },
    plugins: [
      "oscar_socket",
      "oscar_ip",
      // OSCAR's widgets are bundled rather than loaded as globals, so they go
      // in as functions. Named plugins are resolved through window[name], which
      // silently does nothing when the name is wrong -- that is how the
      // gjs-blocks-basic mismatch went unnoticed.
      ...widgetPlugins(ipServer),
      "grapesjs-preset-webpage",
      "gjs-blocks-basic",
      "grapesjs-custom-code",
      "grapesjs-parser-postcss",
      "grapesjs-touch",
      "grapesjs-tooltip",
    ],
    pluginsOpts: {
      oscar_socket: { ipserver: ipServer, socketPort: socketPort },
      "grapesjs-tooltip": {},
      "gjs-blocks-basic": { flexGrid: true },
      "grapesjs-preset-webpage": {
        blocks: [],
        // Keep OSCAR's own palette (css/oscar_theme.css) rather than the
        // preset's theme.
        useCustomTheme: false,
        showStylesOnChange: true,
        // Not "Import Template": a template is now something in the Load list.
        modalImportTitle: "Import HTML/CSS",
        modalImportLabel:
          '<div style="margin-bottom: 10px; font-size: 13px;">Paste here your HTML/CSS and click Import</div>',
        modalImportContent: function (editor) {
          return editor.getHtml() + "<style>" + editor.getCss() + "</style>";
        },
      },
    },
  });

  // The chosen style is saved on the wrapper; the canvas body follows it.
  followSurfaceStyle(editor, widgetStyles.copyToBody);

  // While previewing, a click has to do what clicking does; see the adapter.
  noSelectingWhile(editor, function () {
    return editor.Commands.isActive("preview");
  });

  // A light on each protocol section of the settings panel, so a collapsed
  // section still says whether the widget uses it. Watches the views column,
  // which is where GrapesJS draws and redraws the panel.
  sectionLights(editor, {
    root: document.querySelector(".gjs-pn-views-container") || document.body,
    listeningPort: oscInPort,
  });

  // The MIDI ports this computer has, for a widget's Port setting to suggest.
  // Asked again whenever a widget is picked, since instruments come and go.
  if (features.MIDI) {
    var askForMidiPorts = function () {
      fetch("/midi/ports")
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (ports) {
          if (ports) suggest("midi-outputs", ports.outputs, editor);
          if (ports) suggest("midi-inputs", ports.inputs, editor);
        })
        .catch(function () {});
    };
    askForMidiPorts();
    editor.on("component:selected", function () {
      // With what is known already, at once; then with what the server says.
      refreshChoices(editor);
      askForMidiPorts();
    });
  }

  // The serial ports, for a DMX widget's Interface to choose from. Asked the
  // same way: dongles come and go with the cable.
  {
    var askForSerialPorts = function () {
      fetch("/serial")
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (report) {
          if (report && Array.isArray(report.ports)) {
            suggest(
              "serial-ports",
              report.ports.map(function (port) {
                return { id: port.path, name: port.label || port.path };
              }),
              editor
            );
          }
        })
        .catch(function () {});
    };
    askForSerialPorts();
    editor.on("component:selected", askForSerialPorts);
    // Learn, and ticking Data in, can name a port the dropdown has not got.
  // ---- the bridge's confirmation -------------------------------------------
  // Only the same protocol both ways can loop: OSC in with OSC bridged out,
  // MIDI in with MIDI bridged out. Creating such a pair is confirmed, from
  // whichever side arrives last; a cross-protocol bridge (a knob to OSC) and
  // DMX (no way in) ask nothing. Only for the selected widget: a project
  // loading is not a hand in the panel.
  var BRIDGE_PAIRS = [
    { input: "listen", when: "oscSendWhen", protocol: "OSC" },
    { input: "midiListen", when: "midiSendWhen", protocol: "MIDI" },
  ];
  var BRIDGE_KEYS = ["listen", "oscSendWhen", "midiListen", "midiSendWhen"];
  var revertingBridge = false;
  // GrapesJS says component:update:<key> twice for one change (once from the
  // model, once from the trait), and the question must not stack.
  var bridgeAsking = false;
  function loopedPairs(get) {
    return BRIDGE_PAIRS.filter(function (pair) {
      return get(pair.input) === true && get(pair.when) === "data";
    });
  }
  editor.on(
    BRIDGE_KEYS.map(function (key) {
      return "component:update:" + key;
    }).join(" "),
    function (model) {
      if (revertingBridge || bridgeAsking || editor.getSelected() !== model) return;
      var changed = Object.keys(model.changed || {}).filter(function (key) {
        return BRIDGE_KEYS.indexOf(key) !== -1;
      })[0];
      if (!changed) return;
      var before = model.previous(changed);
      var was = function (key) {
        return key === changed ? before : model.get(key);
      };
      // Only a pair this very change created asks; each protocol's pair asks
      // once, and edits near an accepted pair stay quiet.
      var beforePairs = loopedPairs(was);
      var pair = loopedPairs(model.get.bind(model)).filter(function (candidate) {
        return beforePairs.indexOf(candidate) === -1;
      })[0];
      if (!pair) return;
      bridgeAsking = true;
      $.confirm({
        title: "This can loop",
        content:
          "This control listens to " + pair.protocol + " and will now also send on what it hears. " +
          "If what it sends comes back -- software that echoes it, or OSCAR's own port -- it goes " +
          "round in circles. The Loop guard (on) passes only real changes, which stops that.",
        boxWidth: "460px",
        useBootstrap: false,
        onDestroy: function () {
          bridgeAsking = false;
        },
        buttons: {
          confirm: { text: "Keep it" },
          cancel: {
            text: "Undo",
            action: function () {
              revertingBridge = true;
              model.set(changed, before);
              revertingBridge = false;
            },
          },
        },
      });
    }
  );

    editor.on("component:update:midiInPort component:update:midiPort", function () {
      refreshChoices(editor);
    });
  }

  var pn = editor.Panels;
  var modal = editor.Modal;

  // ---- modals ------------------------------------------------------------
  function setModal(title, containerId) {
    var container = document.getElementById(containerId);
    container.style.display = "block";
    modal.open({ title: title, content: container, attributes: { class: "modal-login" } });
  }

  function showLoader() {
    $("#table-container").hide();
    $("#loader-table").show();
  }

  function hideLoader() {
    $("#table-container").show();
    $("#loader-table").hide();
  }

  function openProjects(mode) {
    projectsMode = mode;
    // Save leaves templates out of the list, so one picked in Load must not
    // linger as the name a project is saved under.
    if (mode === "Save" && selectedTemplate) {
      selectedTemplate = null;
      templateUrl = null;
      $("#project-name").val("");
    }
    setModal(mode, "table-panel");
    $("#save-button").toggle(mode === "Save");
    $("#load-button").toggle(mode === "Load");
    refreshProjects();
  }

  editor.Commands.add("open-projects", function (ed, sender, options) {
    openProjects((options && options.type) || "Save");
  });

  // ---- project table -----------------------------------------------------
  // A plain table rather than a plugin: it is one list with four columns.
  // Every cell is filled with textContent, because a project's name is text a
  // person typed. Sorting and formatting live in lib/projects-table.js.
  var projectRows = [];
  var projectsMode = "Save";
  // The template picked in the list, if any. Kept apart from the project id
  // because a template and a saved project can share a name.
  var selectedTemplate = null;
  var projectsProblem = null;
  var projectSort = projectsTable.DEFAULT_SORT;
  var projectsBody = document.querySelector("#projects-table tbody");

  function refreshProjects() {
    return fetch("/projects")
      .then(function (res) {
        return res.json();
      })
      .then(function (rows) {
        projectRows = Array.isArray(rows) ? rows : [];
        projectsProblem = null;
        renderProjects();
      })
      .catch(function (err) {
        console.log("Could not load projects", err);
        projectRows = [];
        projectsProblem = "Could not load projects";
        renderProjects();
      });
  }

  function projectCell(text, className) {
    var td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text === null || text === undefined ? "" : String(text);
    return td;
  }

  function renderProjects() {
    var selectedId = document.getElementById("project-name").getAttribute("id-project");

    document.querySelectorAll("#projects-table th[data-sort]").forEach(function (th) {
      if (th.getAttribute("data-sort") === projectSort.key) {
        th.setAttribute("aria-sort", projectSort.direction);
      } else {
        th.removeAttribute("aria-sort");
      }
    });

    projectsBody.textContent = "";

    var rows = projectsTable.orderProjects(
      projectRows,
      projectSort.key,
      projectSort.direction,
      projectsMode === "Load"
    );

    if (projectsProblem || !rows.length) {
      var empty = document.createElement("tr");
      empty.className = "o-empty";
      var message = projectCell(projectsProblem || "No saved projects yet");
      message.colSpan = 4;
      empty.appendChild(message);
      projectsBody.appendChild(empty);
      return;
    }

    rows.forEach(function (row) {
        var tr = document.createElement("tr");
        tr.tabIndex = 0;
        tr.setAttribute(
          "aria-selected",
          String(row.template ? row._id === selectedTemplate : !selectedTemplate && row._id === selectedId)
        );
        var name = projectCell(row.name);
        if (row.template) {
          var badge = document.createElement("span");
          badge.className = "o-badge";
          badge.textContent = "Template";
          name.appendChild(badge);
        }
        tr.appendChild(name);
        tr.appendChild(projectCell(projectsTable.formatSize(row.size), "o-num"));
        tr.appendChild(projectCell(row.date, "o-date"));

        var actions = document.createElement("td");
        actions.className = "o-actions";
        tr.appendChild(actions);
        tr.onclick = function () {
          selectProject(row, tr);
        };
        tr.onkeydown = function (e) {
          // Enter on the delete button belongs to the button.
          if (e.target !== tr) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectProject(row, tr);
          }
        };
        projectsBody.appendChild(tr);

        // Templates ship with OSCAR and cannot be deleted.
        if (row.template) return;

        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "o-icon-btn";
        remove.title = "Delete " + row.name;
        remove.setAttribute("aria-label", "Delete " + row.name);
        // A fixed SVG from ICONS, never anything a person typed.
        remove.innerHTML = icon("remove", 16);
        remove.onclick = function (e) {
          e.stopPropagation();
          confirmRemove(row);
        };
        actions.appendChild(remove);
      });
  }

  // Marks the row in place rather than re-rendering, so a keyboard user's
  // focus stays on the row they just chose.
  function selectProject(row, tr) {
    selectedTemplate = row.template ? row._id : null;
    $("#project-name").val(row.name).attr("id-project", row.template ? "" : row._id);
    templateUrl = row.template ? row.url : null;
    projectsBody.querySelectorAll("tr[aria-selected]").forEach(function (other) {
      other.setAttribute("aria-selected", String(other === tr));
    });
  }

  document.querySelectorAll("#projects-table th[data-sort] .o-sort").forEach(function (button) {
    button.onclick = function () {
      projectSort = projectsTable.nextSort(projectSort, button.parentNode.getAttribute("data-sort"));
      renderProjects();
    };
  });

  function confirmRemove(row) {
    $.confirm({
      title: "Delete Project",
      content:
        "Are you sure you want to delete this project? You won't be able to recover it afterwards.",
      buttons: {
        confirm: function () {
          $.ajax({ type: "DELETE", url: "/remove/" + row._id })
            .done(function (data) {
              refreshProjects();
              $.alert(data.error || data.msg);
            })
            .fail(function () {
              $.alert("Could not delete that project");
            });
        },
        cancel: function () {},
      },
    });
  }

  // ---- save --------------------------------------------------------------
  var projectName = document.getElementById("project-name");

  document.getElementById("save-button").onclick = function () {
    var name = (projectName.value || "").trim();
    if (!name) {
      $.alert("Give your project a name first");
      return;
    }
    saveProject(name, false);
  };

  function saveProject(name, overwrite) {
    showLoader();

    // The project JSON is sent flat alongside OSCAR's own `name`/`overwrite`
    // fields; the server strips those two before writing the file.
    var body = Object.assign(
      { name: name, overwrite: overwrite, grapesjs: grapesjs.version },
      editor.getProjectData()
    );

    postJSON("/save", body)
      .then(function (res) {
        hideLoader();

        if (!res || res.error) {
          $.alert((res && res.error) || "Could not be saved");
          return;
        }

        if (res.confirm) {
          $.confirm({
            title: "Overwriting",
            content: res.confirm,
            buttons: {
              confirm: function () {
                saveProject(name, true);
              },
              cancel: function () {},
            },
          });
          return;
        }

        refreshProjects();
        $.alert(res.msg);
        modal.close();
      })
      .catch(function () {
        hideLoader();
        $.alert("Could not reach the OSCAR server");
      });
  }

  // ---- load --------------------------------------------------------------
  var templateUrl = null;

  document.getElementById("load-button").onclick = function () {
    var id = projectName.getAttribute("id-project");
    if (templateUrl) {
      confirmLoadTemplate(templateUrl);
      return;
    }
    if (!id) {
      $.alert("Pick a project from the list first");
      return;
    }

    $.confirm({
      title: "Load",
      content:
        "If you load this project, you will lose all unsaved changes in the current one.",
      buttons: {
        confirm: function () {
          showLoader();

          fetch("/load/" + encodeURIComponent(id))
            .then(function (res) {
              return res.json();
            })
            .then(function (data) {
              hideLoader();

              if (!data || data.error || !Object.keys(data).length) {
                $.alert((data && data.error) || "That project could not be found");
                return;
              }

              // loadProjectData tears down the current page before reading
              // the new one, so a file that isn't a GrapesJS 0.21+ project
              // leaves the editor with no page at all. Check the shape first.
              if (!isProjectData(data)) {
                $.alert(
                  "This file isn't an OSCAR 2 project, so it can't be opened. " +
                    "Your current project hasn't been changed."
                );
                return;
              }

              editor.loadProjectData(data);
              $.alert("Loaded successfully");
              modal.close();
            })
            .catch(function () {
              hideLoader();
              $.alert("Could not reach the OSCAR server");
            });
        },
        cancel: function () {},
      },
    });
  };

  // ---- pages -------------------------------------------------------------
  // A surface can hold several pages -- a page per fixture group, or per
  // scene. GrapesJS has had the model for this all along (editor.Pages, and a
  // pages array in every project); what it lacks is any way to reach it.
  var pages = editor.Pages;

  function pageLabels() {
    return oscarPages.pageEntries(pages).map(function (entry) {
      return entry.label;
    });
  }

  function labelOf(page) {
    return projectFormat.pageLabel(page.getName(), pages.getAll().indexOf(page));
  }

  /**
   * Ask for a page name in a jquery-confirm form. Not window.prompt: Electron
   * does not implement it, so in the desktop app it would silently return
   * nothing and the page could never be renamed.
   */
  function askPageName(title, current, except, onName) {
    $.confirm({
      title: title,
      content:
        '<form action="" class="oscar-page-name-form">' +
        '<input class="oscar-page-name-input" type="text" maxlength="40" />' +
        "</form>",
      onContentReady: function () {
        var dialog = this;
        var input = dialog.$content.find(".oscar-page-name-input");
        // Set as a value, not written into the markup: a page name is
        // whatever someone typed.
        input.val(current).trigger("focus").trigger("select");
        dialog.$content.find("form").on("submit", function (e) {
          // Enter submits the form; without this the page would reload.
          e.preventDefault();
          dialog.$$confirm.trigger("click");
        });
      },
      buttons: {
        confirm: function () {
          var name = (this.$content.find(".oscar-page-name-input").val() || "").trim();
          if (!name) {
            $.alert("Give the page a name");
            return false;
          }
          // Two tabs reading the same cannot be told apart on a tablet.
          if (oscarPages.nameTaken(pageLabels(), name, except)) {
            $.alert('There is already a page called "' + name + '"');
            return false;
          }
          onName(name);
        },
        cancel: function () {},
      },
    });
  }

  function deletePage(page) {
    // Never the last one: GrapesJS would be left with no page to draw, and a
    // project with no pages is one OSCAR refuses to open.
    if (pages.getAll().length < 2) return;

    $.confirm({
      title: "Delete Page",
      // Built as text for the same reason as above.
      content: $("<div>").text(
        'Delete "' + labelOf(page) + '" and every widget on it? You won\'t be able to recover it afterwards.'
      ),
      buttons: {
        confirm: function () {
          if (pages.getAll().length < 2) return;
          // Move off the page first, so the canvas is never showing a page
          // that no longer exists.
          if (pages.getSelected() === page) {
            var all = pages.getAll();
            var index = all.indexOf(page);
            pages.select(all[index === 0 ? 1 : index - 1]);
          }
          pages.remove(page);
        },
        cancel: function () {},
      },
    });
  }

  function pageAction(label, title, onClick) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "oscar-page-action";
    button.textContent = label;
    button.setAttribute("aria-label", title);
    button.onclick = onClick;
    return button;
  }

  function renderPages() {
    var list = document.getElementById("pages-list");
    if (!list) return;

    var all = pages.getAll();
    list.innerHTML = "";

    oscarPages.pageEntries(pages).forEach(function (entry, index) {
      var page = all[index];
      var row = document.createElement("li");
      row.className = "oscar-page" + (entry.current ? " oscar-page-current" : "");

      var open = document.createElement("button");
      open.type = "button";
      open.className = "oscar-page-open";
      open.textContent = entry.label;
      open.onclick = function () {
        pages.select(page);
      };
      row.appendChild(open);

      row.appendChild(
        pageAction("Rename", "Rename " + entry.label, function () {
          askPageName("Rename page", entry.label, index, function (name) {
            page.setName(name);
          });
        })
      );

      if (all.length > 1) {
        row.appendChild(
          pageAction("Delete", "Delete " + entry.label, function () {
            deletePage(page);
          })
        );
      }

      list.appendChild(row);
    });
  }

  function addPage() {
    var input = document.getElementById("new-page-name");
    var name = ((input && input.value) || "").trim();

    if (name && oscarPages.nameTaken(pageLabels(), name)) {
      $.alert('There is already a page called "' + name + '"');
      return;
    }

    // Naming it is optional; a page left unnamed is given a name, because
    // GrapesJS would drop an empty one. Not simply "Page <count + 1>": after
    // a deletion that name may still be on another tab.
    var page = pages.add({ name: name || oscarPages.freePageName(pageLabels()) }, { select: true });
    if (!page) {
      $.alert("That page could not be added");
      return;
    }
    if (input) input.value = "";
  }

  editor.Commands.add("open-pages", function () {
    if (!features.PAGES) return;
    renderPages();
    setModal("Pages", "pages-panel");
  });

  document.getElementById("add-page-button").onclick = addPage;
  document.getElementById("new-page-name").onkeydown = function (e) {
    if (e.key === "Enter") addPage();
  };

  // The list may be open while pages change under it (a rename, a load).
  // page:update is what a rename fires, and it is also what tells the
  // storage manager the project changed.
  editor.on("page:add page:remove page:select page:update", renderPages);

  /**
   * Open a template: an HTML file with its CSS, read exactly the way Import
   * reads pasted code. Everything in the current surface is replaced, and the
   * name is cleared so the first save asks for a new one rather than
   * suggesting the template's.
   */
  function confirmLoadTemplate(url) {
    $.confirm({
      title: "Load",
      content:
        "If you load this template, you will lose all unsaved changes in the current project.",
      buttons: {
        confirm: function () {
          showLoader();

          fetch(url)
            .then(function (res) {
              if (!res.ok) throw new Error("status " + res.status);
              return res.text();
            })
            .then(function (html) {
              hideLoader();
              loadTemplate(html);
              selectedTemplate = null;
              templateUrl = null;
              $("#project-name").val("").attr("id-project", "");
              $.alert("Loaded successfully");
              modal.close();
            })
            .catch(function () {
              hideLoader();
              $.alert("That template could not be opened");
            });
        },
        cancel: function () {},
      },
    });
  }

  function loadTemplate(html) {
    editor.select();
    editor.Css.clear();
    // Nothing from the surface being replaced carries over; the template's
    // own style is put back while it is read.
    editor.getWrapper().setAttributes({});
    editor.setComponents(html);
    editor.UndoManager.clear();
  }

  // Somebody opening OSCAR for the first time is shown the Showcase, where
  // every widget works, not an empty canvas (first_run.js).
  if (firstRun) {
    editor.onReady(function () {
      welcome.openWelcome({
        fetch: function (url) {
          return fetch(url);
        },
        load: loadTemplate,
        // Anything already on the canvas is somebody's, however quick they were.
        untouched: function () {
          return editor.getWrapper().components().length === 0;
        },
      });
    });
  }

  // ---- preview mode ------------------------------------------------------
  // GrapesJS's preview hides the panels but leaves components draggable in
  // absolute mode, so dragging a button in preview pulls it apart.
  //
  // This locks the components rather than swallowing events in the canvas. An
  // earlier version did the latter, and it blocked pointerdown and touchmove
  // -- which is exactly what a drag-based widget like the XY pad needs, so it
  // would have been dead in preview. The button survived only because it uses
  // click, and the slider because its dragging is a browser default action.
  //
  // Locking components is what corrupted projects once, by being saved. It is
  // safe now: editor state is stripped on every path in and out of storage, so
  // it cannot persist. The /preview page has always worked this way.
  var PREVIEW_LOCK = {
    draggable: false,
    selectable: false,
    hoverable: false,
    editable: false,
    highlightable: false,
  };
  // Only the page on the canvas has components to lock. A page switched to
  // mid-preview arrives unlocked, so it is locked as it comes in; the lock
  // remembers what it has touched, so coming back to a page does not record
  // its locked state as the one to restore (see createLock).
  var previewLock = oscarPages.createLock(PREVIEW_LOCK, { avoidStore: true });
  var previewing = false;

  // The designer's preview shows the same tabs the tablet does: a surface
  // with several pages cannot be tried out from page one alone.
  var previewTabs = oscarPages.pageTabs(editor, {
    bar: document.getElementById("oscar-page-bar"),
    body: document.body,
    windows: function () {
      return oscarPages.widgetWindows(editor, window);
    },
  });

  // Only while previewing: a project being edited changes under a widget in
  // ways a viewless copy is never told about.
  var offstage = runOffstage(editor, { document: document });

  editor.on("page:select", function () {
    if (!previewing) return;
    editor.select();
    previewLock.lock(editor.getWrapper());
  });

  editor.on("command:run:preview", function () {
    // Hand the canvas to the preview page before locking, so the lock doesn't
    // travel with it. Every page goes across, not only the one showing, and
    // named, so a tab never has to guess.
    postJSON("/save/preview", {
      project: projectFormat.namePages(editor.getProjectData()),
    }).catch(function (err) {
      console.log("Could not hand off preview", err);
    });

    editor.select();
    previewing = true;
    previewLock.lock(editor.getWrapper());
    previewTabs.show();
    // As on the tablet: a fader on a page that is not showing still follows
    // the rig, or trying a surface out here would not show what it does.
    offstage.start();

    // The selection toolbar, badges and resize handles live outside the canvas
    // and would otherwise float over the control surface, delete button and
    // all.
    editor.getEl().classList.add("oscar-previewing");
  });

  editor.on("command:stop:preview", function () {
    previewing = false;
    offstage.stop();
    previewLock.release();
    previewTabs.hide();
    editor.getEl().classList.remove("oscar-previewing");
  });

  // ---- panel buttons -----------------------------------------------------
  // ---- widget styles -----------------------------------------------------
  // A style is chosen for the whole surface and recorded as two attributes on
  // its body, so it is saved with the project and reaches the preview and
  // every tablet with nothing else to set. lib/widget-styles.js lists the
  // styles; assets/css/styles/ holds their values.

  function surfaceStyle() {
    var attrs = editor.getWrapper().getAttributes();
    var style = attrs[widgetStyles.STYLE_ATTRIBUTE];
    var appearance = attrs[widgetStyles.APPEARANCE_ATTRIBUTE];
    return {
      style: widgetStyles.isStyle(style) ? style : widgetStyles.DEFAULT_STYLE,
      appearance: widgetStyles.isAppearance(appearance) ? appearance : widgetStyles.DEFAULT_APPEARANCE,
    };
  }

  function applySurfaceStyle(style, appearance) {
    var attrs = {};
    attrs[widgetStyles.STYLE_ATTRIBUTE] = style;
    attrs[widgetStyles.APPEARANCE_ATTRIBUTE] = appearance;
    editor.getWrapper().addAttributes(attrs);
  }

  /**
   * A small document showing the real widgets in one style: the same fonts,
   * tokens and widget rules the canvas loads, so a card looks exactly like the
   * surface will. Everything in it comes from the style registry, never from
   * anything a person typed.
   */
  function stylePreviewDocument(style, appearance) {
    var links = widgetStyles
      .canvasStylesheets()
      .map(function (href) {
        return '<link rel="stylesheet" href="' + href + '">';
      })
      .join("");

    return (
      '<!doctype html><html><head><meta charset="utf-8">' +
      links +
      "<style>" +
      widgetStyles.SURFACE_CSS +
      " body { height: 100vh; display: flex; align-items: center; justify-content: center;" +
      " gap: 10px; padding: 8px; overflow: hidden; }" +
      " .col { display: flex; flex-direction: column; gap: 8px; }" +
      " button { min-height: 28px; padding: 0 10px; font-size: 12px; }" +
      " input[type=range] { width: 64px; height: 22px; }" +
      " .oscar-xypad { width: 56px; height: 56px; flex-shrink: 0; }" +
      "</style></head>" +
      "<body " +
      widgetStyles.STYLE_ATTRIBUTE + '="' + style + '" ' +
      widgetStyles.APPEARANCE_ATTRIBUTE + '="' + appearance + '">' +
      '<div class="col"><button type="button">Off</button>' +
      '<button type="button" class="toggle">On</button>' +
      '<input type="range" min="0" max="100" value="60" style="--oscar-fill: 60%"></div>' +
      '<div class="oscar-xypad" style="--oscar-x: 65%; --oscar-y: 35%"></div>' +
      "</body></html>"
    );
  }

  var stylePanel = null;

  function buildStylePanel() {
    var panel = document.createElement("div");
    panel.className = "o-style-panel";

    var segmented = document.createElement("div");
    segmented.className = "o-segmented";
    segmented.setAttribute("role", "group");
    segmented.setAttribute("aria-label", "Appearance");
    widgetStyles.APPEARANCES.forEach(function (appearance) {
      var segment = document.createElement("button");
      segment.type = "button";
      segment.className = "o-segment";
      segment.setAttribute("data-appearance", appearance);
      segment.textContent = appearance === "dark" ? "Dark" : "Light";
      segment.onclick = function () {
        applySurfaceStyle(surfaceStyle().style, appearance);
        refreshStylePanel();
      };
      segmented.appendChild(segment);
    });

    var grid = document.createElement("div");
    grid.className = "o-style-grid";
    widgetStyles.CHOICES.forEach(function (entry) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "o-style-card";
      card.setAttribute("data-style", entry.id);

      if (entry === widgetStyles.OWN_STYLE) {
        // Nothing to picture: how it looks is whatever the page says. The
        // name stands alone in the middle, and the hint says what it means.
        card.className += " o-style-card-own";
        card.title = entry.hint;
      } else {
        // The preview is only a picture: the card is what gets clicked.
        var preview = document.createElement("iframe");
        preview.className = "o-style-preview";
        preview.tabIndex = -1;
        preview.setAttribute("aria-hidden", "true");
        card.appendChild(preview);
      }

      var name = document.createElement("span");
      name.className = "o-style-name";
      name.textContent = entry.label;
      card.appendChild(name);

      card.onclick = function () {
        applySurfaceStyle(entry.id, surfaceStyle().appearance);
        refreshStylePanel();
      };
      grid.appendChild(card);
    });

    panel.appendChild(segmented);
    panel.appendChild(grid);
    return panel;
  }

  function refreshStylePanel() {
    var current = surfaceStyle();

    stylePanel.querySelectorAll(".o-segment").forEach(function (segment) {
      segment.setAttribute("aria-pressed", String(segment.getAttribute("data-appearance") === current.appearance));
    });

    stylePanel.querySelectorAll(".o-style-card").forEach(function (card) {
      var style = card.getAttribute("data-style");
      card.setAttribute("aria-pressed", String(style === current.style));
      var preview = card.querySelector("iframe");
      if (!preview) return;
      // Rewriting the document restarts it; only do that when the picture
      // would actually change.
      var wanted = style + "/" + current.appearance;
      if (preview.getAttribute("data-showing") !== wanted) {
        preview.setAttribute("data-showing", wanted);
        preview.srcdoc = stylePreviewDocument(style, current.appearance);
      }
    });
  }

  editor.Commands.add("open-styles", function () {
    if (!stylePanel) stylePanel = buildStylePanel();
    refreshStylePanel();
    modal.open({ title: "Widget style", content: stylePanel, attributes: { class: "modal-login" } });
  });

  pn.addButton("options", {
    id: "open-styles",
    label: icon("palette"),
    command: function () {
      editor.runCommand("open-styles");
    },
    attributes: { title: "Widget style", "data-tooltip-pos": "bottom" },
  });

  // Reset to style: a widget someone recoloured by hand keeps that colour when
  // the surface changes style, which reads as switching "not working". This
  // takes its own appearance edits away so it follows the style again, and
  // leaves where it is and how big it is alone.
  editor.Commands.add("oscar-reset-style", function (ed) {
    var component = ed.getSelected();
    if (!component) return;
    component.setStyle(widgetStyles.withoutAppearance(component.getStyle()));
  });

  // Offered on OSCAR's own widgets and on the body, in the toolbar over a
  // selection. GrapesJS never saves a component's toolbar into the project,
  // so this editor-only button cannot leak into a saved file.
  editor.on("component:selected", function (component) {
    if (!widgetStyles.offersReset(component.get("type"))) return;
    var toolbar = component.get("toolbar") || [];
    var present = toolbar.some(function (item) {
      return item.command === "oscar-reset-style";
    });
    if (present) return;
    component.set(
      "toolbar",
      toolbar.concat([
        {
          label: icon("restore", 16),
          command: "oscar-reset-style",
          attributes: { title: "Reset to style" },
        },
      ])
    );
  });

  pn.addButton("options", {
    id: "open-save",
    label: icon("save"),
    command: function () {
      editor.runCommand("open-projects", { type: "Save" });
    },
    attributes: { title: "Save project", "data-tooltip-pos": "bottom" },
  });

  // Not offered while the feature is off; see lib/features.js.
  if (features.PAGES) {
    pn.addButton("options", {
      id: "open-pages",
      label: icon("pages"),
      command: function () {
        editor.runCommand("open-pages");
      },
      attributes: { title: "Pages", "data-tooltip-pos": "bottom" },
    });
  }

  pn.addButton("options", {
    id: "open-load",
    label: icon("open"),
    command: function () {
      editor.runCommand("open-projects", { type: "Load" });
    },
    attributes: { title: "Load project", "data-tooltip-pos": "bottom" },
  });

  // ---- export ------------------------------------------------------------
  // Distinct from "See code" beside it, which is GrapesJS's own view of the
  // markup and cannot send anything. This one produces a file that does.
  var publishDialog = oscarExport.install(editor, {
    host: ipServer,
    port: socketPort,
    projectName: function () {
      return projectName ? projectName.value : "";
    },
  });

  pn.addButton("options", {
    id: "oscar-export",
    label: icon("upload"),
    command: function () {
      editor.runCommand("oscar-export");
    },
    attributes: { title: "Publish your interface", "data-tooltip-pos": "bottom" },
  });

  // ---- locked mode -------------------------------------------------------
  // Locking leaves the control surface open to the network while the editor
  // answers only this computer. A locked OSCAR that looked unlocked would be
  // its own hazard, so the button states its condition plainly.
  var lockButtonId = "toggle-lock";

  function paintLockButton(locked) {
    var el = document.querySelector(".gjs-pn-options .oscar-lock-btn");
    if (!el) return;
    el.innerHTML = icon(locked ? "locked" : "unlocked");
    el.setAttribute("data-tooltip", locked ? "Locked: tap to allow editing" : "Lock editing");
    el.setAttribute("data-tooltip-pos", "bottom");
    el.classList.toggle("oscar-locked", !!locked);
  }

  function setLocked(locked) {
    postJSON("/lock", { locked: locked })
      .then(function (res) {
        if (res && res.error) {
          $.alert(res.error);
          return;
        }
        paintLockButton(res && res.locked);
      })
      .catch(function () {
        $.alert("Could not change the lock");
      });
  }

  pn.addButton("options", {
    id: lockButtonId,
    className: "oscar-lock-btn",
    label: icon("unlocked"),
    command: function () {
      var el = document.querySelector(".gjs-pn-options .oscar-lock-btn");
      setLocked(!(el && el.classList.contains("oscar-locked")));
    },
    attributes: { title: "Lock editing", "data-tooltip-pos": "bottom" },
  });

  fetch("/lock")
    .then(function (res) {
      return res.json();
    })
    .then(function (state) {
      paintLockButton(state && state.locked);
    })
    .catch(function () {});

  // ---- serial -------------------------------------------------------------
  // The panel is its own script (oscar_serial.js); it adds its own button
  // here, between the lock and About. Not offered while the feature is off
  // (lib/features.js), which also spares the server its two-second poll.
  if (features.SERIAL && typeof oscar_serial === "function") {
    oscar_serial({
      panels: pn,
      openModal: function () {
        setModal("Serial (Arduino)", "serial-panel");
      },
      alert: function (text) {
        $.alert(text);
      },
    });
  }

  // About, behind OSCAR's own mark. An extension may add to it, ahead of
  // OSCAR's words (aboutDialog.addSection below): what this OSCAR is, to whom.
  var aboutSections = [];
  var aboutExtras = document.getElementById("about-extras");
  pn.addButton("options", {
    id: "open-info",
    label: icon("jellyfish"),
    command: function () {
      aboutSections.forEach(function (section) {
        try {
          section.draw(section.box);
        } catch (err) {
          console.error("A section of About failed:", err);
        }
      });
      setModal("About OSCAR", "info-panel");
    },
    attributes: { title: "About Oscar", "data-tooltip-pos": "bottom" },
  });

  pn.addButton("devices-c", {
    id: "ipButton",
    className: "oscar-ip-label",
    label: "Server IP: " + ipServer + (oscInPort ? " · Listening Port: " + oscInPort : ""),
    command: null,
    attributes: {
      title: oscInPort
        ? "Point other devices at this address. OSCAR hears OSC on port " + oscInPort
        : "Point other devices at this address",
    },
    active: false,
    disable: true,
  });

  // ---- tooltips ----------------------------------------------------------
  // GrapesJS renders the panels during init, before any of this runs, and a
  // button does not re-render when its attributes change afterwards. Setting
  // the model alone is silently ignored, so the text is written onto the
  // elements as well. Buttons render in the order the panel holds them.
  // ---- toolbar order -----------------------------------------------------
  // Every button exists by now. GrapesJS can only append, so the ones that
  // belong elsewhere are moved: in the panel's own list and on the page
  // together, because retitle() below pairs the two by position.
  /**
   * Put the toolbar's buttons in the order lib/toolbar-order.js states, or,
   * given placements, move those alone: an extension's button that belongs
   * beside one of OSCAR's, added long after the toolbar was drawn.
   */
  function arrangeToolbar(placements) {
    var panel = pn.getPanel("options");
    var row = document.querySelector(".gjs-pn-options .gjs-pn-buttons");
    if (!panel || !row) return;

    var buttons = panel.get("buttons");
    var models = buttons.models.slice();
    var els = Array.prototype.slice.call(row.querySelectorAll(".gjs-pn-btn"));
    // If the two ever disagree, moving either would mislabel the rest.
    if (models.length !== els.length) return;

    var ids = models.map(function (model) {
      return model.get("id");
    });
    var wanted = toolbarOrder.arrange(ids, placements);

    wanted.forEach(function (id) {
      row.appendChild(els[ids.indexOf(id)]);
    });
    // Silent: the panel's view answers a reset by drawing every button again,
    // which would throw away the elements just moved.
    buttons.reset(
      wanted.map(function (id) {
        return models[ids.indexOf(id)];
      }),
      { silent: true }
    );
  }
  arrangeToolbar();

  function retitle(panelId, labels) {
    var panel = pn.getPanel(panelId);
    var els = document.querySelectorAll(".gjs-pn-" + panelId + " .gjs-pn-btn");
    if (!panel || !els.length) return;

    panel.get("buttons").forEach(function (button, index) {
      var label = labels[button.get("id")];
      var el = els[index];
      if (!label || !el) return;

      button.set("attributes", { title: label, "data-tooltip-pos": "bottom" });
      el.setAttribute("data-tooltip", label);
      el.setAttribute("data-tooltip-pos", "bottom");
      el.setAttribute("title", "");
    });
  }

  retitle("options", {
    "sw-visibility": "Show borders",
    // "Push", not "Preview": this is also what sends the layout to the
    // /preview page, which keeps showing the last pushed version until it is.
    preview: "Push to preview",
    fullscreen: "Fullscreen",
    "export-template": "See code",
    undo: "Undo",
    redo: "Redo",
    // Says what goes in. "Import" alone sat beside Load, which also brings
    // something in, and templates -- the other thing one might import -- are
    // opened from Load.
    "gjs-open-import-webpage": "Import HTML/CSS",
    "canvas-clear": "Clear canvas",
    "toggle-lock": null,
    "open-styles": "Widget style",
    "open-save": "Save project",
    "open-load": "Load project",
    "open-pages": "Pages",
    "oscar-export": "Publish your interface",
    "open-info": "About Oscar",
  });

  retitle("views", {
    "open-sm": "Style Manager",
    "open-tm": "OSC Settings",
    "open-layers": "Layers",
    "open-blocks": "Blocks",
  });

  // ---- extensions ----------------------------------------------------------
  // What an extension's editor script is handed (lib/extensions.js), through
  // window.OSCAR.ready(function (oscar) { ... }). Kept small on purpose: every
  // name here is a promise to code OSCAR cannot see, and api goes up when one
  // of them changes shape.
  var oscarApi = {
    api: 1,
    /** The GrapesJS editor, for everything not wrapped below. */
    editor: editor,
    /** The feature switches as they stand; see lib/features.js. */
    features: features,
    /**
     * A button in the top toolbar: at the end, or straight after one of
     * OSCAR's own (`after`, a button id such as "open-styles").
     * { id, title, iconPath (the d of a 24x24 SVG path), run(editor), after? }
     */
    addToolbarButton: function (button) {
      if (!button || !button.id || typeof button.run !== "function") {
        throw new Error("A toolbar button needs an id and a run function");
      }
      if (pn.getButton("options", button.id)) return;
      var title = String(button.title || button.id);
      pn.addButton("options", {
        id: button.id,
        label:
          '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="' +
          String(button.iconPath || "").replace(/[^\w\s.,-]/g, "") +
          '"/></svg>',
        command: function () {
          button.run(editor);
        },
        // Tooltips are drawn from data-tooltip; a title as well would show twice.
        attributes: { "data-tooltip": title, "data-tooltip-pos": "bottom", "aria-label": title },
      });
      if (button.after) arrangeToolbar([{ id: button.id, after: String(button.after) }]);
    },
    /** Take a button of the extension's own out of the toolbar again: one that is only for some accounts. */
    removeToolbarButton: function (id) {
      if (!pn.getButton("options", id)) return;
      if (typeof pn.removeButton === "function") pn.removeButton("options", id);
    },
    /** Open OSCAR's modal on an element of the extension's own. */
    openModal: function (title, content) {
      modal.open({ title: title, content: content, attributes: { class: "modal-login" } });
    },
    /**
     * Add to the Publish dialog, under what was just published: for what
     * else a published surface can become. See addSection in export_dialog.js.
     */
    publishDialog: {
      addSection: function (draw) {
        if (publishDialog) publishDialog.addSection(draw);
      },
    },
    /**
     * Add to About, ahead of OSCAR's own words. `draw(box)` is called with a
     * box of the extension's own every time About opens.
     */
    aboutDialog: {
      addSection: function (draw) {
        if (typeof draw !== "function") throw new Error("A section of About is a draw function");
        var box = document.createElement("div");
        box.className = "oscar-about-section";
        if (aboutExtras) aboutExtras.appendChild(box);
        aboutSections.push({ draw: draw, box: box });
      },
    },
  };

  // One extension throwing must not cost the others, or the editor, anything.
  function runExtension(fn) {
    try {
      fn(oscarApi);
    } catch (err) {
      console.error("An OSCAR extension failed in the editor:", err);
    }
  }
  oscarApi.ready = runExtension;
  window.OSCAR = oscarApi;
  extensionsWaiting.splice(0).forEach(runExtension);

  // Anything else that still carries a title (modal contents, for instance).
  var titles = document.querySelectorAll("*[title]");
  for (var i = 0; i < titles.length; i++) {
    var el = titles[i];
    var title = (el.getAttribute("title") || "").trim();
    if (!title) continue;
    el.setAttribute("data-tooltip", title);
    el.setAttribute("title", "");
  }
}
