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
  // mdi-export-variant, @mdi/svg 7.4.47 (Apache-2.0): publishing sends the
  // surface out of the editor, an arrow leaving its box. (A bare up arrow
  // read as "upload a file".)
  publish: "M12,1L8,5H11V14H13V5H16M18,23H6C4.89,23 4,22.1 4,21V9A2,2 0 0,1 6,7H9V9H6V21H18V9H15V7H18A2,2 0 0,1 20,9V21A2,2 0 0,1 18,23Z",
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
var adapters = require("./adapters/grapesjs");
var { widgetPlugins, runOffstage } = adapters;

// Tabs and the page-by-page lock, shared with the /preview page.
var oscarPages = require("./pages");
var features = require("../../lib/features");
var welcome = require("./first_run");

var oscarExport = require("./export_dialog");
var { createOpenProject } = require("../../lib/open-project");
var { createProjectSync } = require("../../lib/project-sync");
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
    // Style the selected element, not its classes. GrapesJS's default puts
    // a resize or a style change on the element's class combination, which
    // silently rewrites every sibling wearing the same classes: scale one
    // drum and the whole kit grows, and the layout reflows under the
    // handles ("I scale an element and something else moves"). The classes
    // stay editable on purpose -- picking one in the Selector panel styles
    // it deliberately.
    selectorManager: { componentFirst: true },
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
      oscar_socket: { ipserver: ipServer, socketPort: socketPort, from: "canvas" },
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
    serial: features.SERIAL
      ? {
          state: function () {
            return window.oscarSerialForPanel ? window.oscarSerialForPanel.state() : {};
          },
          pick: function (path) {
            if (window.oscarSerialForPanel) window.oscarSerialForPanel.pick(path);
          },
        }
      : null,
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

  // The canvas yields to the show, per widget id: what is published is read
  // on a slow beat, each widget wears its light (green sends, red yields),
  // and the dots follow the layout on a faster one (adapters/grapesjs.js).
  var askForPublished = function () {
    if (!features.CANVAS_YIELD) return;
    fetch("/published")
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (rows) {
        if (rows) adapters.tellPublishedWidgets(editor, rows);
      })
      .catch(function () {});
  };
  askForPublished();
  setInterval(askForPublished, 5000);
  // Position follows the layout every frame, so a dragged widget carries
  // its light; membership and colour repaint on edits, debounced.
  (function beat() {
    adapters.repositionWidgetLights(editor);
    window.requestAnimationFrame(beat);
  })();
  var repaintLights = (function () {
    var wait = null;
    return function () {
      if (wait) clearTimeout(wait);
      wait = setTimeout(function () {
        adapters.paintWidgetLights(editor);
      }, 150);
    };
  })();
  editor.on("update component:add component:remove change:device undo redo", repaintLights);

  // The serial ports, for a DMX widget's Interface and the OSC Board to
  // choose from, and the cable's own state, for the Board row to say. Asked
  // the same way: dongles come and go with the cable.
  var serialLink = { path: "", state: "idle", error: null, bitrate: null };
  {
    var askForSerialPorts = function () {
      fetch("/serial")
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (report) {
          if (!report) return;
          serialLink = report;
          if (Array.isArray(report.ports)) {
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
    window.oscarSerialForPanel = {
      state: function () {
        return serialLink;
      },
      pick: function (path) {
        fetch("/serial", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(path ? { action: "connect", path: path } : { action: "disconnect" }),
        })
          .then(function (res) {
            return res.json().catch(function () {
              return {};
            });
          })
          .then(function (answer) {
            if (answer && answer.error) $.alert(answer.error);
          })
          .catch(function () {})
          .then(askForSerialPorts);
      },
    };
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
    selectedRow = null;
    // Save leaves templates out of the list, so one picked in Load must not
    // linger as the name a project is saved under.
    if (mode === "Save" && selectedTemplate) {
      selectedTemplate = null;
      templateUrl = null;
      $("#project-name").val("");
    }
    setModal(mode === "Load" ? "Open a project or template" : mode, "table-panel");
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
        // An assistant's draft rides the template mechanism but is not one:
        // it is user data, badged apart and deletable below.
        var isDraft = row.template && String(row._id).indexOf("assistant:") === 0;
        if (row.template) {
          var badge = document.createElement("span");
          badge.className = isDraft ? "o-badge o-badge-draft" : "o-badge";
          badge.textContent = isDraft ? "Draft" : "Template";
          if (isDraft) badge.setAttribute("title", "Written by an assistant through MCP. Review it before it goes anywhere near the rig.");
          name.appendChild(badge);
        } else if (row.id && row.id === openProject.get().id) {
          // The one on the canvas.
          var here = document.createElement("span");
          here.className = "o-badge";
          here.textContent = "Open";
          name.appendChild(here);
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

        // Templates ship with OSCAR and cannot be deleted; a draft can.
        if (row.template && !isDraft) return;

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
    selectedRow = row;
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
    var draft = row.template && String(row._id).indexOf("assistant:") === 0;
    if (draft || !row.id) return askRemove(row, draft, null);
    // A project that is live says so before it goes: its interface keeps
    // running without it unless it is taken down too.
    fetch("/published")
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .catch(function () {
        return [];
      })
      .then(function (pages) {
        var live = (Array.isArray(pages) ? pages : []).filter(function (page) {
          return page.project === row.id;
        })[0];
        askRemove(row, false, live || null);
      });
  }

  function askRemove(row, draft, live) {
    var remove = function (takeDown) {
      var call = draft
        ? $.ajax({ type: "DELETE", url: "/drafts/" + encodeURIComponent(String(row._id).slice("assistant:".length)) + ".html" })
        : $.ajax({ type: "DELETE", url: row.id ? "/projects/" + encodeURIComponent(row.id) : "/remove/" + row._id });
      call
        .done(function (data) {
          if (takeDown && live && !data.error) fetch("/published/" + encodeURIComponent(live.id), { method: "DELETE" }).catch(function () {});
          // The one on the canvas is gone: the canvas starts again as nobody,
          // and what was on it is not saved back.
          if (!draft && !data.error && row.id && row.id === openProject.get().id) {
            projectSync.begin(
              "",
              function () {
                loadTemplate("");
              },
              { discard: true }
            );
          }
          refreshProjects();
          $.alert(data.error || data.msg);
        })
        .fail(function () {
          $.alert(draft ? "Could not delete that draft" : "Could not delete that project");
        });
    };
    var buttons = {
      confirm: {
        text: live ? "Delete, keep it live" : "Confirm",
        action: function () {
          remove(false);
        },
      },
    };
    if (live) {
      buttons.takeDown = {
        text: "Delete and take it down",
        btnClass: "btn-red",
        action: function () {
          remove(true);
        },
      };
    }
    buttons.cancel = function () {};
    $.confirm({
      title: draft ? "Delete Draft" : "Delete Project",
      content: draft
        ? "Delete this assistant-written draft? Anything you loaded from it and saved as a project stays."
        : "Are you sure you want to delete this project? You won't be able to recover it afterwards." +
          (live ? " It is live at /show/" + live.id + ": the interface keeps running, and can still be edited from the Publish window, unless you take it down too." : ""),
      boxWidth: live ? "560px" : undefined,
      useBootstrap: live ? false : undefined,
      buttons: buttons,
    });
  }

  // ---- the project on the canvas -------------------------------------------
  // A project lives in OSCAR, on the computer it runs on, under one title
  // (lib/projects.js). The canvas is one of them being edited: every change
  // is saved a moment after it is made (lib/project-sync.js), and what OSCAR
  // has not yet confirmed stays in this browser. There is no Save to press.
  var projectName = document.getElementById("project-name");
  var openProject = createOpenProject(window.localStorage);
  var selectedRow = null; // the row picked in the projects list

  /** Text a person typed, made safe to put in a dialog (its content is markup). */
  function plain(text) {
    return String(text == null ? "" : text).replace(/[<>&"]/g, "");
  }

  /** OSCAR's projects over HTTP: each answers { ok, status, body }, and fails only when OSCAR cannot be reached. */
  function projectCall(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().then(
        function (json) {
          return { ok: res.ok, status: res.status, body: json };
        },
        function () {
          return { ok: res.ok, status: res.status, body: {} };
        }
      );
    });
  }
  var projectApi = {
    read: function (id) {
      return projectCall("GET", "/projects/" + encodeURIComponent(id));
    },
    create: function (body) {
      return projectCall("POST", "/projects", body);
    },
    write: function (id, body) {
      return projectCall("PUT", "/projects/" + encodeURIComponent(id), body);
    },
    copy: function (id) {
      return projectCall("POST", "/projects/" + encodeURIComponent(id) + "/copy");
    },
  };

  // The project as it was when this window opened it: what File > Revert
  // goes back to. Kept for this tab only; another tab has its own.
  var OPENED_KEY = "oscarProject.opened";

  function keepOpened(id, data) {
    try {
      sessionStorage.setItem(OPENED_KEY, JSON.stringify({ id: id, data: data }));
    } catch (err) {
      // No room, or no storage: Revert has nothing to offer, and says so.
    }
  }

  function openedCopy() {
    try {
      var held = JSON.parse(sessionStorage.getItem(OPENED_KEY));
      return held && held.id === openProject.get().id && isProjectData(held.data) ? held.data : null;
    } catch (err) {
      return null;
    }
  }

  // The title and how it stands, in the top bar beside File and Edit.
  var SAVE_STATES = {
    new: ["", "Nothing to save yet: this becomes a project at its first change."],
    saving: ["Saving\u2026", "Sending your changes to OSCAR."],
    saved: ["Saved", "Every change is saved in OSCAR as you make it."],
    unsaved: ["Not saved", "OSCAR could not be reached. Your changes are kept in this browser and sent as soon as it answers."],
    conflict: ["Changed elsewhere", "This project was saved from another window or device. Change something here to choose which version to keep."],
  };

  function paintTitle() {
    var el = document.querySelector(".gjs-pn-devices-c .oscar-title-btn");
    if (el) el.textContent = openProject.get().name || "Untitled";
  }

  function paintSaveState(status, detail) {
    var el = document.querySelector(".gjs-pn-devices-c .oscar-save-state");
    if (!el) return;
    var words = SAVE_STATES[status] || SAVE_STATES.new;
    el.textContent = words[0];
    el.setAttribute("data-state", status);
    el.setAttribute("data-tooltip", status === "unsaved" && detail ? "Not saved: " + detail + " Your changes are kept in this browser meanwhile." : words[1]);
    el.setAttribute("data-tooltip-pos", "bottom");
  }

  /** Saved from two places: which version stays is the person's call, never OSCAR's. */
  function askConflict(info) {
    return new Promise(function (resolve) {
      $.confirm({
        title: "Changed somewhere else",
        content: '"' + plain(info.name) + '" was saved from another window or device since this one opened it. Which version do you keep?',
        boxWidth: "520px",
        useBootstrap: false,
        buttons: {
          mine: {
            text: "Keep this window's",
            action: function () {
              resolve("mine");
            },
          },
          theirs: {
            text: "Load the other one",
            action: function () {
              resolve("theirs");
            },
          },
        },
      });
    });
  }

  var projectSync = createProjectSync({
    pointer: openProject,
    api: projectApi,
    // Tidied as a saved project is: no editor state, every page named.
    getData: function () {
      return projectFormat.namePages(projectFormat.stripEditorState(editor.getProjectData()));
    },
    loadData: function (data) {
      editor.loadProjectData(data);
      editor.UndoManager.clear();
    },
    isEmpty: function () {
      return editor.getWrapper().components().length === 0;
    },
    onStatus: paintSaveState,
    onName: paintTitle,
    conflict: askConflict,
    keepOpened: keepOpened,
    grapesjs: grapesjs.version,
  });

  // Any change to the project is a change to save.
  editor.on("update", function () {
    projectSync.changed();
  });
  editor.onReady(function () {
    projectSync.start();
  });

  // Ctrl+S is in everybody's fingers. It sends what is waiting, now.
  document.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && String(event.key).toLowerCase() === "s") {
      event.preventDefault();
      projectSync.flush();
    }
  });

  /** Click the title: a new one. The address of a published interface does not move with it. */
  function renameProject() {
    $.confirm({
      title: "Rename project",
      // The title is in the field as the dialog draws, not put there after:
      // plain() has taken out what could end the attribute.
      content: '<input type="text" class="o-input oscar-rename-input" maxlength="200" aria-label="Project title" value="' + plain(openProject.get().name || "Untitled") + '" />',
      onContentReady: function () {
        var dialog = this;
        var input = dialog.$content.find("input");
        input.trigger("focus").trigger("select");
        input.on("keydown", function (event) {
          if (event.key === "Enter") dialog.$$confirm.trigger("click");
        });
      },
      buttons: {
        confirm: {
          text: "Rename",
          action: function () {
            projectSync.rename(this.$content.find("input").val());
          },
        },
        cancel: function () {},
      },
    });
  }

  /** File > New project: an empty canvas, nobody until its first change. */
  function newProject() {
    projectSync.begin("", function () {
      loadTemplate("");
    });
  }

  /** File > Make a copy: a second project like this one, opened in its place. */
  function copyProject() {
    projectSync.copy().then(null, function (err) {
      $.alert(plain(err && err.message) || "The project could not be copied.");
    });
  }

  // ---- revert ------------------------------------------------------------
  // With every change saved there is no "close without saving". These are
  // the two ways back: how the project was when this window opened it, and
  // the version that is published.
  function revertWith(data, what) {
    $.confirm({
      title: "Revert",
      content: "Put this project back as " + what + "? What you changed since is replaced.",
      buttons: {
        confirm: {
          text: "Revert",
          action: function () {
            projectSync.replaceWith(data);
          },
        },
        cancel: function () {},
      },
    });
  }

  function revertToOpened() {
    var data = openedCopy();
    if (!data) {
      $.alert("There is nothing to go back to: this project was not opened in this window, or has only just been made.");
      return;
    }
    revertWith(data, "it was when this window opened it");
  }

  function revertToPublished() {
    var id = openProject.get().id;
    fetch("/published")
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .then(function (pages) {
        var live = (Array.isArray(pages) ? pages : []).filter(function (page) {
          return id && page.project === id && page.editable;
        })[0];
        if (!live) {
          $.alert("This project has no published version to go back to.");
          return null;
        }
        return fetch("/published/" + encodeURIComponent(live.id) + "/project")
          .then(function (res) {
            return res.json();
          })
          .then(function (answer) {
            if (!answer || !isProjectData(answer.data)) {
              $.alert(plain(answer && answer.error) || "The published version could not be read.");
              return;
            }
            revertWith(answer.data, "it is published at /show/" + live.id);
          });
      })
      .catch(function () {
        $.alert("Could not reach the OSCAR server");
      });
  }

  // ---- open, from the list -------------------------------------------------
  // Nothing asks about unsaved changes any more: there are none to lose.
  var templateUrl = null;

  document.getElementById("load-button").onclick = function () {
    var row = selectedRow;
    if (!row) {
      $.alert("Pick a project from the list first");
      return;
    }
    if (row.template) {
      openTemplate(row.url, row.name);
      return;
    }
    showLoader();
    projectSync.open(row.id).then(
      function () {
        hideLoader();
        modal.close();
      },
      function (err) {
        hideLoader();
        $.alert(plain(err && err.message) || "That project could not be opened");
      }
    );
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
   * reads pasted code. It starts a new project, named after the template,
   * which joins the list at its first change: one that was only looked at
   * leaves nothing behind. What was on the canvas is a project, and saved.
   */
  function openTemplate(url, name) {
    showLoader();
    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("status " + res.status);
        return res.text();
      })
      .then(function (html) {
        return projectSync.begin(name || "", function () {
          loadTemplate(html);
        });
      })
      .then(
        function () {
          hideLoader();
          selectedTemplate = null;
          templateUrl = null;
          selectedRow = null;
          modal.close();
        },
        function () {
          hideLoader();
          $.alert("That template could not be opened");
        }
      );
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

  // ---- a project as a file --------------------------------------------
  // A project lives in OSCAR. An .oscar file is a copy of one: to keep as a
  // backup, to send to a colleague, to carry to another OSCAR. Export a
  // copy writes one; Open a file brings one in as a project. A .html
  // template opens through the same door, as a template does.

  function slugName(name) {
    var slug = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "untitled";
  }

  function projectRecord(name, id) {
    // The same stamping OSCAR does when it keeps a project, so an exported
    // file and a project in OSCAR are one format, not two. The id is who the
    // project is: brought back in, the file is known as this project.
    var data = projectFormat.stripEditorState(editor.getProjectData());
    return projectFormat.stampProject({ name: name, data: data, grapesjs: grapesjs.version, id: id });
  }

  /** File > Export a copy: an .oscar file wherever the person says. The project stays in OSCAR. */
  function exportCopy() {
    projectSync.flush().then(function () {
      var now = openProject.get();
      var name = now.name || "Untitled";
      var text = JSON.stringify(projectRecord(name, now.id || undefined), null, 2);

      var fallback = function () {
        // No file pickers in this browser: the file lands in Downloads.
        var blob = new Blob([text], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = slugName(name) + ".oscar";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
        }, 5000);
      };

      if (!window.showSaveFilePicker) return fallback();
      window
        .showSaveFilePicker({
          suggestedName: slugName(name) + ".oscar",
          types: [{ description: "OSCAR project", accept: { "application/json": [".oscar"] } }],
        })
        .then(function (handle) {
          return handle
            .createWritable()
            .then(function (writable) {
              return writable.write(text).then(function () {
                return writable.close();
              });
            })
            .then(function () {
              $.alert('Exported a copy to "' + plain(handle.name) + '". The project itself stays in OSCAR.');
            });
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") return; // they closed the picker
          fallback();
        });
    });
  }

  /**
   * Bring a project in: one more in OSCAR's list, opened. A file says who it
   * is; when that project is already here the person chooses -- replace it,
   * or keep both -- because either answer is right for somebody.
   */
  function importProject(project, ifExists) {
    return projectApi
      .create({ id: project.id, name: project.name, data: project.data, grapesjs: grapesjs.version, ifExists: ifExists })
      .then(function (res) {
        if (res.status === 409 && res.body && res.body.exists) {
          $.confirm({
            title: "Already in OSCAR",
            content: '"' + plain(res.body.name) + '" is already one of your projects. Replace it with this file, or keep both?',
            boxWidth: "520px",
            useBootstrap: false,
            buttons: {
              replace: {
                text: "Replace it",
                btnClass: "btn-red",
                action: function () {
                  importProject(project, "replace");
                },
              },
              both: {
                text: "Keep both",
                action: function () {
                  importProject(project, "copy");
                },
              },
              cancel: function () {},
            },
          });
          return null;
        }
        if (!res.ok) {
          $.alert(plain(res.body && res.body.error) || "That file could not be brought in.");
          return null;
        }
        // The one on the canvas was replaced: show what it is now, without
        // first saving what it was over the top of it.
        if (res.body.id === openProject.get().id) return projectSync.reload();
        return projectSync.open(res.body.id);
      })
      .catch(function () {
        $.alert("Could not reach the OSCAR server");
      });
  }

  function openProjectText(fileName, text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      $.alert('"' + plain(fileName) + '" is not an OSCAR project file.');
      return;
    }
    // openProject answers { status, data }: the project is its data, once
    // read, migrated and tidied. (This once checked the answer itself for
    // pages, and refused every file.)
    var opened = projectFormat.openProject(parsed);
    if (opened.status === "too-new") {
      $.alert("This project was saved by a newer OSCAR (format " + opened.format + "). Update OSCAR to open it; nothing here was changed.");
      return;
    }
    var data = opened.status === "ok" ? opened.data : null;
    if (!isProjectData(data)) {
      $.alert('"' + plain(fileName) + '" is not an OSCAR 2 project, so it cannot be opened. Your current project has not been changed.');
      return;
    }
    importProject({
      // Who the file says it is; one from before projects had ids is a new project.
      id: projectFormat.isProjectId(parsed.id) ? parsed.id : undefined,
      name: (typeof parsed.name === "string" && parsed.name.trim()) || fileName.replace(/\.(oscar|json)$/i, ""),
      data: data,
    });
  }

  function openHtmlText(fileName, text) {
    // An HTML page is a template: a new project, named after the page.
    var title = /<title[^>]*>([^<]*)<\/title>/i.exec(text);
    projectSync.begin((title && title[1].trim()) || fileName.replace(/\.html?$/i, ""), function () {
      loadTemplate(text);
    });
  }

  function openPicked(fileName, text) {
    if (/\.html?$/i.test(fileName) || (!/^\s*\{/.test(text) && /^\s*</.test(text))) openHtmlText(fileName, text);
    else openProjectText(fileName, text);
  }

  // The fallback for browsers without file pickers.
  var openFileInput = document.createElement("input");
  openFileInput.type = "file";
  openFileInput.accept = ".oscar,.json,.html,.htm";
  openFileInput.style.display = "none";
  document.body.appendChild(openFileInput);
  openFileInput.addEventListener("change", function () {
    var file = openFileInput.files && openFileInput.files[0];
    openFileInput.value = "";
    if (!file) return;
    file.text().then(function (text) {
      openPicked(file.name, text);
    });
  });

  function oscarOpenFile() {
    if (!window.showOpenFilePicker) return openFileInput.click();
    window
      .showOpenFilePicker({
        types: [{ description: "OSCAR project or template", accept: { "application/json": [".oscar", ".json"], "text/html": [".html", ".htm"] } }],
      })
      .then(function (picked) {
        return picked[0].getFile().then(function (file) {
          return file.text().then(function (text) {
            openPicked(file.name, text);
          });
        });
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return;
        openFileInput.click();
      });
  }

  /** One menu under a bar word: built, placed, closed by a click away. */
  function showBarMenu(anchorSelector, items) {
    var open = document.querySelector(".oscar-open-menu");
    if (open) {
      open.remove();
      return;
    }
    var anchor = document.querySelector(anchorSelector);
    if (!anchor) return;
    var at = anchor.getBoundingClientRect();
    var menu = document.createElement("div");
    menu.className = "oscar-open-menu";
    menu.style.left = Math.round(at.left) + "px";
    menu.style.top = Math.round(at.bottom + 6) + "px";
    items.forEach(function (item) {
      if (item.rule) {
        var line = document.createElement("div");
        line.className = "oscar-open-menu-rule";
        menu.appendChild(line);
        return;
      }
      var row = document.createElement("button");
      row.type = "button";
      row.className = "oscar-open-menu-item";
      row.textContent = item.label;
      // A switch says where it stands: a tick when on, the tick's room when off.
      if (typeof item.checked === "boolean") {
        row.setAttribute("role", "menuitemcheckbox");
        row.setAttribute("aria-checked", String(item.checked));
      }
      row.onclick = function () {
        menu.remove();
        item.run();
      };
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    var away = function (event) {
      // The anchor's own pointerdown is left alone: the click that follows
      // it toggles the menu closed. Without this, away closed the menu a
      // breath before the click reopened it, and the word never closed.
      if (menu.contains(event.target) || anchor.contains(event.target)) return;
      menu.remove();
      document.removeEventListener("pointerdown", away, true);
    };
    setTimeout(function () {
      document.addEventListener("pointerdown", away, true);
    }, 0);
  }

  /** Fullscreen as the window has it: Esc leaves fullscreen without telling the command. */
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function toggleFullscreen() {
    var active = editor.Commands.isActive("fullscreen");
    if (isFullscreen()) {
      if (active) editor.stopCommand("fullscreen");
      else if (document.exitFullscreen) document.exitFullscreen();
      return;
    }
    // A command still marked active after Esc would take this click to stop itself.
    if (active) editor.stopCommand("fullscreen");
    // The whole page, not GrapesJS's default of the editor's container: the
    // browser draws nothing outside the fullscreen element, and File's and
    // Edit's menus, the alerts and Pro's dialogs all live on the body.
    editor.runCommand("fullscreen", { target: document.documentElement });
  }

  // Show borders is remembered in this browser: on until turned off once, and
  // off after that, refresh after refresh. A browser that keeps nothing
  // (private window, locked-down storage) gets the default each time.
  var BORDERS_KEY = "oscarShowBorders";

  function bordersWanted() {
    try {
      return localStorage.getItem(BORDERS_KEY) !== "off";
    } catch (err) {
      return true;
    }
  }

  function toggleBorders() {
    var on = !editor.Commands.isActive("sw-visibility");
    if (on) editor.runCommand("sw-visibility");
    else editor.stopCommand("sw-visibility");
    try {
      localStorage.setItem(BORDERS_KEY, on ? "on" : "off");
    } catch (err) {
      /* shown now, just not remembered */
    }
  }

  // Items an extension adds to File or Edit (oscarApi.addMenuItem): Pro's
  // Schedule, say. Drawn with each opening, so one added or taken away since
  // shows at once.
  var menuExtras = { file: [], edit: [] };

  function extraItems(menu) {
    return menuExtras[menu].map(function (item) {
      return {
        label: item.label,
        run: function () {
          item.run(editor);
        },
      };
    });
  }

  // Edit holds what acts on the canvas as a whole: undoing, how it is shown,
  // its code, its style, locking it, and emptying it. Their icons retired
  // from the bar, except the padlock.
  function showEditMenu() {
    showBarMenu(
      ".gjs-pn-devices-c .oscar-edit-btn",
      [
      {
        label: "Undo",
        run: function () {
          editor.runCommand("core:undo");
        },
      },
      {
        label: "Redo",
        run: function () {
          editor.runCommand("core:redo");
        },
      },
      { rule: true },
      { label: "Show borders", checked: editor.Commands.isActive("sw-visibility"), run: toggleBorders },
      { label: "Fullscreen", checked: isFullscreen(), run: toggleFullscreen },
      { rule: true },
      {
        label: "See code",
        run: function () {
          editor.runCommand("export-template");
        },
      },
      {
        label: "Widget style…",
        run: function () {
          editor.runCommand("open-styles");
        },
      },
      { rule: true },
      // Also the padlock on the bar, which stays.
      { label: "Lock editing", checked: isLockedNow(), run: function () { setLocked(!isLockedNow()); } },
    ]
      .concat(extraItems("edit"))
      .concat([
      { rule: true },
      {
        label: "Clear canvas…",
        run: function () {
          editor.runCommand("canvas-clear");
        },
      },
      ])
    );
  }

  /** Locked as the padlock on the bar shows it: the server's answer, painted there. */
  function isLockedNow() {
    var el = document.querySelector(".gjs-pn-options .oscar-lock-btn");
    return !!(el && el.classList.contains("oscar-locked"));
  }

  function showFileMenu() {
    showBarMenu(".gjs-pn-devices-c .oscar-file-btn", [
      { label: "New project", run: newProject },
      {
        label: "Open\u2026",
        run: function () {
          editor.runCommand("open-projects", { type: "Load" });
        },
      },
      { label: "Open a file\u2026", run: oscarOpenFile },
      {
        label: "Import HTML/CSS\u2026",
        run: function () {
          editor.runCommand("gjs-open-import-webpage");
        },
      },
      { rule: true },
      // No Save: every change is saved in OSCAR as it is made. These are the
      // ways to a second project, to a file, and back to an earlier version.
      { label: "Make a copy", run: copyProject },
      { label: "Export a copy\u2026", run: exportCopy },
      { label: "Revert to how it was when opened\u2026", run: revertToOpened },
      { label: "Revert to the published version\u2026", run: revertToPublished },
      { rule: true },
      {
        label: "Publish\u2026",
        run: function () {
          editor.runCommand("oscar-export");
        },
      },
      // Both ways the surface leaves the editor, side by side. Its eye on the
      // bar is retired; GrapesJS's own button over the canvas ends preview.
      {
        label: "Push to preview",
        run: function () {
          editor.runCommand("preview");
        },
      },
      { rule: true },
    ]
      // An extension's items open the last group, beside About: Pro's Log in
      // or Log out, which is done in About.
      .concat(extraItems("file"))
      .concat([
      // Its jellyfish on the bar is retired: this is where people look for it.
      {
        label: "About OSCAR",
        run: function () {
          editor.runCommand("oscar-about");
        },
      },
      ]));
  }

  // A file double-clicked in the file manager arrives through the server,
  // once, and comes in as any picked file does: as a project in OSCAR.
  fetch("/boot-file")
    .then(function (res) {
      return res.json();
    })
    .then(function (file) {
      if (file && file.name && typeof file.text === "string") openPicked(file.name, file.text);
    })
    .catch(function () {});

  // Somebody opening OSCAR for the first time is shown the Showcase, where
  // every widget works, not an empty canvas (first_run.js).
  if (firstRun) {
    editor.onReady(function () {
      welcome.openWelcome({
        fetch: function (url) {
          return fetch(url);
        },
        load: function (html) {
          projectSync.begin("", function () {
            loadTemplate(html);
          });
        },
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

  // No button of its own: Widget style is under Edit (showEditMenu).

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

  // ---- the bar answers through one listener --------------------------------
  // Every word and pill on the bar registers here instead of binding to its
  // element: a panel re-render -- an extension adding a button, a silent
  // reset -- replaces the elements, and a listener bound to a dead element
  // is the bug this bar has now had three times. The document outlives them
  // all.
  var barClicks = [];
  function onBarClick(selector, run) {
    barClicks.push([selector, run]);
  }
  document.addEventListener("click", function (event) {
    if (!event.target.closest) return;
    for (var i = 0; i < barClicks.length; i++) {
      var found = event.target.closest(barClicks[i][0]);
      if (found) {
        event.stopPropagation();
        barClicks[i][1](found);
        return;
      }
    }
  });

  // ---- the bar's geography, first half ------------------------------------
  // The screen sizes leave the left panel NOW, before File and the pills are
  // created there: pn.removeButton re-renders the whole panel, and any click
  // listener wired before it would die with its element. A button moves
  // whole: command, label and state along.
  // They sit alone at the middle of the bar over the canvas (not of the
  // window): a panel of their own, which the CSS places there.
  // Created with the buttons already in it: a panel added empty draws no
  // buttons that are added to it later.
  var sizeButtons = [];
  ["set-device-desktop", "set-device-tablet", "set-device-mobile"].forEach(function (id) {
    var button = pn.getButton("devices-c", id);
    if (!button) return;
    sizeButtons.push({
      id: id,
      command: button.get("command"),
      label: button.get("label"),
      className: button.get("className"),
      attributes: button.get("attributes"),
      active: button.get("active"),
      // A screen size is a choice, not a switch: clicking the chosen one
      // again stays chosen instead of toggling half-off.
      togglable: false,
      context: button.get("context"),
    });
    pn.removeButton("devices-c", id);
  });
  pn.addPanel({ id: "oscar-sizes", visible: true, buttons: sizeButtons });
  // Undo and Redo live under Edit at the left edge; their icons retire.
  // Removed here, early, for the same re-render reason as above.
  pn.removeButton("options", "undo");
  pn.removeButton("options", "redo");
  // Show borders, Fullscreen, See code and Clear canvas join them under Edit
  // (the widget style too, which is never added to the bar at all).
  // And the eye: Push to preview is under File.
  ["sw-visibility", "fullscreen", "export-template", "canvas-clear", "preview"].forEach(function (id) {
    pn.removeButton("options", id);
  });
  // Show borders was on from the start because its button said so; with the
  // button gone, the editor sets it itself, as it was last left.
  editor.onReady(function () {
    var active = editor.Commands.isActive("sw-visibility");
    if (bordersWanted() && !active) editor.runCommand("sw-visibility");
    else if (!bordersWanted() && active) editor.stopCommand("sw-visibility");
  });

  // Open and Save live under one word at the bar's left edge: File.

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

  // Disabled to GrapesJS with its own click, like the pills: a command
  // would toggle the button active, and only every other click would run.
  pn.addButton("devices-c", {
    id: "oscar-file",
    className: "oscar-file-btn",
    label: "File",
    command: null,
    attributes: { title: "Open and save", "data-tooltip-pos": "bottom" },
    active: false,
    disable: true,
  });
  onBarClick(".oscar-file-btn", function () {
    showFileMenu();
  });

  pn.addButton("devices-c", {
    id: "oscar-edit",
    className: "oscar-edit-btn",
    label: "Edit",
    command: null,
    attributes: { title: "Undo, the canvas and its style", "data-tooltip-pos": "bottom" },
    active: false,
    disable: true,
  });
  onBarClick(".oscar-edit-btn", function () {
    showEditMenu();
  });

  // The project's title, beside File and Edit: click it to rename. And how
  // it stands with OSCAR: Saving, Saved, Not saved.
  pn.addButton("devices-c", {
    id: "oscar-title",
    className: "oscar-title-btn",
    label: "Untitled",
    command: null,
    attributes: { title: "Rename this project", "data-tooltip-pos": "bottom" },
    active: false,
    disable: true,
  });
  onBarClick(".oscar-title-btn", function () {
    renameProject();
  });
  pn.addButton("devices-c", {
    id: "oscar-save-state",
    className: "oscar-save-state",
    label: "",
    command: null,
    attributes: { title: "", "data-tooltip-pos": "bottom" },
    active: false,
    disable: true,
  });
  paintTitle();
  paintSaveState(projectSync.status());

  // ---- export ------------------------------------------------------------
  // Distinct from "See code" beside it, which is GrapesJS's own view of the
  // markup and cannot send anything. This one produces a file that does.
  var publishDialog = oscarExport.install(editor, {
    host: ipServer,
    port: socketPort,
    // Publishing needs a project to belong to: a canvas that is nobody yet
    // becomes one as the window opens, and what is waiting is saved.
    beforeOpen: function () {
      return projectSync.materialise();
    },
    // Who the canvas is: what it publishes is remembered as this project.
    project: function () {
      var now = openProject.get();
      return { id: now.id, name: now.name || "Untitled" };
    },
    newId: function () {
      return openProject.get().id || openProject.newId();
    },
    adopt: function () {},
    // The project itself, kept beside the page: what phones are showing.
    source: function (name, id) {
      return projectRecord(name, id);
    },
    // Edit, from a live interface's row: its project, on the canvas. One
    // that is no longer among the projects is brought back from the copy
    // kept with the live interface.
    openProject: function (project) {
      if (!project || !isProjectData(project.data)) {
        $.alert("That project could not be opened. Your current project has not been changed.");
        return;
      }
      projectSync
        .open(project.id)
        .then(null, function () {
          return importProject({ id: project.id, name: project.name, data: project.data });
        })
        .then(function () {
          modal.close();
        });
    },
  });

  pn.addButton("options", {
    id: "oscar-export",
    className: "oscar-publish-btn",
    // A pill like its neighbours: the icon and the word.
    label: icon("publish") + '<span class="oscar-bar-pill-word">Publish</span>',
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

  // ---- telemetry switch, in About ----------------------------------------
  // Shown only when this build can speak at all (a key baked in): a switch
  // for something that sends nothing would only sow doubt. The full list of
  // what OSCAR can say is lib/telemetry.js; the label links to it.
  fetch("/telemetry-state")
    .then(function (res) {
      return res.json();
    })
    .then(function (state) {
      if (!state || !state.wired) return;
      var row = document.getElementById("about-telemetry");
      var box = document.getElementById("about-telemetry-switch");
      if (!row || !box) return;
      row.style.display = "";
      box.checked = !!state.on;
      box.addEventListener("change", function () {
        fetch("/telemetry-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ on: box.checked }),
        }).catch(function () {});
      });
    })
    .catch(function () {});

  // ---- serial -------------------------------------------------------------
  // No panel: the cable is picked where it is used, the Board row the
  // settings panel draws under a widget's Via (adapters/grapesjs.js).

  // About, behind OSCAR's own mark. An extension may add to it, ahead of
  // OSCAR's words (aboutDialog.addSection below): what this OSCAR is, to whom.
  var aboutSections = [];
  var aboutExtras = document.getElementById("about-extras");
  // A command of its own, so the jellyfish on the bar and File's "About
  // OSCAR" open the same thing.
  editor.Commands.add("oscar-about", function () {
    aboutSections.forEach(function (section) {
      try {
        section.draw(section.box);
      } catch (err) {
        console.error("A section of About failed:", err);
      }
    });
    setModal("About OSCAR", "info-panel");
  });
  // No button of its own: About is under File (showFileMenu).

  // ---- resize keeps its hands off flow parts' coordinates -------------------
  // GrapesJS writes top and left along with width and height whenever the
  // resized component's drag mode is truthy -- it only knows "absolute",
  // "translate" and "", and our templates' dmode="flow" is truthy but
  // neither. So a resize stamped a flow part with its own coordinates:
  // harmless on position:static, a jump by its own offset on
  // position:relative (the drum kit draft made it plain). Strip the
  // coordinates for flow parts alone; a hand-placed widget (no dmode, the
  // editor's absolute mode) keeps them, as resizing its left edge must.
  editor.on("component:resize:update", function (props) {
    if (!props || !props.style || typeof props.updateStyle !== "function") return;
    var mode = (props.component && props.component.getDragMode && props.component.getDragMode()) || "";
    if (!mode || mode === "absolute" || mode === "translate") return;
    if (!("top" in props.style) && !("left" in props.style)) return;
    var style = {};
    Object.keys(props.style).forEach(function (key) {
      if (key !== "top" && key !== "left") style[key] = props.style[key];
    });
    props.updateStyle(style);
  });

  // ---- the MCP pill --------------------------------------------------------
  // To the left of the LIVE pill: whether assistants (Claude and friends, by
  // MCP) may talk to this OSCAR. On, the pill wears the accent and the
  // server answers /mcp on this machine; off, the word is struck through,
  // the route refuses, and the handshake file assistants find OSCAR by is
  // removed. Added before the LIVE pill on purpose: buttons render in the
  // order they are added. Same construction as the LIVE pill, for the same
  // reason: disabled to GrapesJS, its own click, no re-render to wipe it.
  if (features.MCP) {
    pn.addButton("options", {
      id: "oscar-mcp-pill",
      className: "oscar-mcp-btn",
      label: '<span class="oscar-mcp-pill"><span class="oscar-mcp-dot"></span><span class="oscar-mcp-word">MCP</span></span>',
      command: null,
      active: false,
      disable: true,
    });

    (function wireMcpPill() {
      var known = null;

      function paintMcp(on) {
        known = !!on;
        var el = document.querySelector(".oscar-mcp-btn");
        if (!el) return;
        el.classList.toggle("oscar-mcp-on", known);
        el.setAttribute(
          "data-tooltip",
          known
            ? "Assistants (MCP) are on: an assistant on this computer can read this OSCAR and draft surfaces -- never send. Click to turn off."
            : "Assistants (MCP) are off: the door is closed. Click to turn on."
        );
        el.setAttribute("data-tooltip-pos", "bottom");
      }

      fetch("/mcp-state")
        .then(function (res) {
          return res.json();
        })
        .then(function (state) {
          paintMcp(state && state.on);
        })
        .catch(function () {});

      onBarClick(".oscar-mcp-btn", function () {
        fetch("/mcp-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ on: !known }),
        })
          .then(function (res) {
            return res.json();
          })
          .then(function (state) {
            if (state && typeof state.on === "boolean") paintMcp(state.on);
          })
          .catch(function () {});
      });
    })();
  }

  // ---- the LIVE pill ------------------------------------------------------
  // OSCAR serves published surfaces in the background all the time, and while
  // editing it is easy to forget the rig is listening to them too. The pill
  // sits between the screen sizes and the network info and counts them; IN
  // flickers when the server consumes OSC or MIDI for a published surface,
  // OUT when it sends on one's behalf -- a bridge, a schedule, a phone. Never
  // for a hand on this canvas: that send does not pass through the server's
  // surfaces at all (lib/surfaces.js onActivity). Hidden while nothing is
  // published. Added before ipButton on purpose: buttons render in the order
  // they are added, which is what puts it in that gap.
  //
  // Two halves, each its own door: LIVE and the count open the publish
  // window, the IN/OUT lights open the network log. Like ipButton it is
  // `disable: true` with its own click handlers: a command would toggle the
  // button active, and GrapesJS re-renders a button whose model changed,
  // which would wipe the count and the lights back to their pristine,
  // hidden state.
  pn.addButton("options", {
    id: "oscar-live-pill",
    className: "oscar-live-btn",
    // Three pills in one button: what is served on this network, what is
    // public on the internet (both open the publish window), and the server
    // itself with its traffic meters (the network log).
    label:
      '<span class="oscar-live-pills">' +
      '<span class="oscar-live-pill oscar-live-zone oscar-live-local" data-zone="publish" data-pill="local">' +
      '<span class="oscar-live-dot"></span>' +
      '<span class="oscar-live-word">LOCAL</span>' +
      '<span class="oscar-live-count">0</span>' +
      "</span>" +
      '<span class="oscar-live-pill oscar-live-zone oscar-live-public" data-zone="publish" data-pill="public">' +
      '<span class="oscar-live-dot"></span>' +
      '<span class="oscar-live-word">PUBLIC</span>' +
      '<span class="oscar-live-count">0</span>' +
      "</span>" +
      '<span class="oscar-live-pill oscar-live-zone oscar-live-server" data-zone="log" data-pill="server">' +
      '<span class="oscar-live-word">OSCAR SERVER</span>' +
      '<span class="oscar-live-led" data-led="in">IN<span class="oscar-live-meter"></span></span>' +
      '<span class="oscar-live-led" data-led="out">OUT<span class="oscar-live-meter"></span></span>' +
      "</span>" +
      "</span>",
    command: null,
    active: false,
    disable: true,
  });

  // What an extension says is public on the internet (Pro's public links),
  // for the PUBLIC pill: set by oscarApi.setPublicCount below.
  var livePublic = { set: function () {} };

  (function wireLivePill() {
    var flashes = { in: null, out: null };
    // The network log's rows, oldest first, the server's cap mirrored here.
    var LOG_KEEP = 200;
    var logRows = [];
    var logFilters = { in: true, out: true, osc: true, midi: true, dmx: true, unfollowed: true, dropped: true, canvas: true, local: true, internet: true, schedule: true, bridge: true };
    // Whose move an outgoing row was (lib/activity.js), as the row says it.
    var ORIGIN_WORDS = { canvas: "Canvas", local: "Local", internet: "Internet", schedule: "Schedule", bridge: "Bridge" };
    var ORIGIN_HINTS = {
      canvas: "Sent from the editor's canvas",
      local: "Sent from a device on this network",
      internet: "Sent from a visitor's phone, through the public link",
      schedule: "Sent by a schedule",
      bridge: "Passed on from what came in (Send when)",
    };

    // Auto-scroll: the newest row is kept in view as rows arrive (the list
    // runs newest first). Off, the rows being read stay where they are while
    // new ones gather above. Remembered in this browser.
    var AUTOSCROLL_KEY = "oscarLogAutoScroll";
    var autoScroll = (function () {
      try {
        return localStorage.getItem(AUTOSCROLL_KEY) !== "off";
      } catch (err) {
        return true;
      }
    })();

    /** An incoming message nothing followed: no published surface, not the canvas. */
    function unfollowed(row) {
      return row.dir === "in" && !row.dropped && !row.canvas && !(row.surfaces && row.surfaces.length);
    }

    /**
     * A row from the server, new or updated (lib/wire-log.js). An update --
     * the canvas saying it followed a message, a surface found to follow it --
     * replaces the row it is about; a new row goes where its own time says.
     */
    function takeRow(row) {
      for (var i = logRows.length - 1; i >= 0 && i >= logRows.length - LOG_KEEP; i--) {
        if (logRows[i].id === row.id) {
          logRows[i] = row;
          return false;
        }
      }
      var at = logRows.length;
      while (at > 0 && logRows[at - 1].at > row.at) at--;
      logRows.splice(at, 0, row);
      if (logRows.length > LOG_KEEP) logRows.splice(0, logRows.length - LOG_KEEP);
      return true;
    }

    function span(className, text, title) {
      var el = document.createElement("span");
      el.className = className;
      el.textContent = text;
      if (title) el.setAttribute("title", title);
      return el;
    }
    var logBox = null;
    var logList = null;

    function pillEl() {
      return document.querySelector(".oscar-live-btn");
    }

    function pill(name) {
      var el = pillEl();
      return el ? el.querySelector('[data-pill="' + name + '"]') : null;
    }

    function say(el, text) {
      el.setAttribute("data-tooltip", text);
      el.setAttribute("data-tooltip-pos", "bottom");
    }

    function quoted(ids) {
      return ids
        .map(function (id) {
          return '"' + id + '"';
        })
        .join(", ");
    }

    // LOCAL: the surfaces OSCAR serves on this network.
    function paintLive(rows) {
      var local = pill("local");
      if (!local) return;
      local.querySelector(".oscar-live-count").textContent = String(rows.length);
      local.classList.toggle("oscar-live-on", rows.length > 0);
      var names = quoted(
        rows.map(function (row) {
          return row.id;
        })
      );
      say(
        local,
        rows.length === 0
          ? "Nothing is published: OSCAR serves no surfaces in the background. Click for the publish window."
          : (rows.length === 1 ? "OSCAR is serving " + names : "OSCAR is serving " + rows.length + " published surfaces: " + names) +
              " on this network. Click for the publish window."
      );
      paintServer();
    }

    // PUBLIC: the surfaces reachable from the internet, as an extension says
    // (Pro's public links). Without one, nothing can be, and the pill says why.
    var publicState = null; // { surfaces: [{ id, online }] }
    function paintPublic() {
      var el = pill("public");
      if (!el) return;
      var surfaces = (publicState && publicState.surfaces) || [];
      el.querySelector(".oscar-live-count").textContent = String(surfaces.length);
      el.classList.toggle("oscar-live-on", surfaces.length > 0);
      var waiting = surfaces.filter(function (s) {
        return !s.online;
      });
      say(
        el,
        !publicState
          ? "Nothing is public. A public surface is one visitors reach from their own phones, anywhere: part of OSCAR Pro. Click for the publish window."
          : surfaces.length === 0
            ? "Nothing is public on the internet. Click for the publish window."
            : "Public on the internet: " +
                quoted(
                  surfaces.map(function (s) {
                    return s.id;
                  })
                ) +
                (waiting.length ? " (still connecting: " + quoted(waiting.map(function (s) { return s.id; })) + ")" : "") +
                ". Click for the publish window."
      );
    }
    livePublic.set = function (state) {
      publicState = state && Array.isArray(state.surfaces) ? state : { surfaces: [] };
      paintPublic();
    };

    // OSCAR SERVER: whether this editor reaches it, and its traffic. The
    // meters read the network log's rows, which carry how many messages
    // each gathers: messages a second over the last second, filled on a
    // log scale (1 a second shows, 100 fills it).
    var traffic = { in: [], out: [] };
    function countTraffic(row) {
      if (traffic[row.dir]) traffic[row.dir].push({ at: Date.now(), n: row.n || 1 });
    }
    function rateOf(dir) {
      var since = Date.now() - 1000;
      traffic[dir] = traffic[dir].filter(function (t) {
        return t.at >= since;
      });
      return traffic[dir].reduce(function (sum, t) {
        return sum + t.n;
      }, 0);
    }
    function paintServer() {
      var el = pill("server");
      if (!el) return;
      var connected = !!(editor.socket && editor.socket.connected);
      el.classList.toggle("oscar-live-on", connected);
      var rates = { in: rateOf("in"), out: rateOf("out") };
      ["in", "out"].forEach(function (dir) {
        var meter = el.querySelector('.oscar-live-led[data-led="' + dir + '"] .oscar-live-meter');
        if (meter) meter.style.width = Math.round(Math.min(1, Math.log(1 + rates[dir]) / Math.log(101)) * 100) + "%";
      });
      say(
        el,
        connected
          ? "OSCAR's server: IN " + rates.in + "/s, OUT " + rates.out + "/s. Click for the network log."
          : "This editor cannot reach OSCAR's server. Click for the network log."
      );
    }
    setInterval(paintServer, 250);

    function refreshLive() {
      fetch("/published")
        .then(function (res) {
          return res.json();
        })
        .then(function (rows) {
          // LOCAL counts what a device on the network can open: an interface
          // that is switched off is kept, and served to nobody.
          paintLive(
            (Array.isArray(rows) ? rows : []).filter(function (row) {
              return row.access !== "off";
            })
          );
        })
        .catch(function () {});
    }

    function flash(dir) {
      var el = pillEl();
      var led = el && el.querySelector('.oscar-live-led[data-led="' + dir + '"]');
      if (!led) return;
      led.classList.add("oscar-live-led-on");
      if (flashes[dir]) clearTimeout(flashes[dir]);
      // A hair longer than the server's throttle, so steady traffic reads as
      // a steady light instead of a strobe.
      flashes[dir] = setTimeout(function () {
        led.classList.remove("oscar-live-led-on");
        flashes[dir] = null;
      }, 350);
    }

    // ---- the network log window ------------------------------------------
    // What OSCAR's server actually received and sent, newest at the top
    // (lib/wire-log.js): each message with what it carried, where it came
    // from or went, and on the same row why -- whose move a send was, which
    // published surfaces and whether the canvas followed what came in. What
    // was refused is there too, marked Dropped. Repeats within a moment are
    // one row with a count. Filters by direction, protocol and origin.
    //
    // A floating window, not a modal, on purpose: the log is for debugging,
    // so the editor has to stay usable while it is open -- move a fader,
    // watch the row appear. Dragged by its title bar, closed by its own
    // button or by clicking the pill's lights again.

    function timeOf(at) {
      var d = new Date(at);
      return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + ":" + ("0" + d.getSeconds()).slice(-2);
    }

    // Clear hides, it does not delete: the server's log is shared with every
    // editor and with an assistant's recent_activity, so it stays whole, and
    // a refresh brings it all back. What is hidden is every row up to the
    // newest one on screen, by the server's own clock -- not this device's,
    // which on a tablet may be minutes out -- so the backlog fetched when
    // the window reopens stays cleared too.
    var clearedThrough = 0;
    var clearedAtWords = "";

    function clearLog() {
      for (var i = 0; i < logRows.length; i++) {
        if (logRows[i].at > clearedThrough) clearedThrough = logRows[i].at;
      }
      clearedAtWords = timeOf(Date.now());
      renderLog();
    }

    function renderLog() {
      if (!logList) return;
      // With auto-scroll off, remember the first row in view and where it
      // sat, to put it back there once the list is redrawn.
      var anchor = null;
      if (!autoScroll) {
        var top = logList.getBoundingClientRect().top;
        for (var c = 0; c < logList.children.length; c++) {
          var at = logList.children[c].getBoundingClientRect();
          if (at.bottom > top) {
            anchor = { key: logList.children[c].getAttribute("data-key"), offset: at.top - top };
            break;
          }
        }
      }
      logList.textContent = "";
      var shown = 0;
      var kept = 0;
      for (var i = logRows.length - 1; i >= 0; i--) {
        var row = logRows[i];
        if (row.at <= clearedThrough) continue;
        kept++;
        if (!logFilters[row.dir] || !logFilters[row.protocol]) continue;
        if (row.origin && logFilters[row.origin] === false) continue;
        if (unfollowed(row) && !logFilters.unfollowed) continue;
        if (row.dropped && !logFilters.dropped) continue;
        shown++;
        var line = document.createElement("div");
        line.className = "oscar-log-row" + (row.dropped ? " oscar-log-row-dropped" : "");
        line.setAttribute("data-key", String(row.id));
        line.appendChild(span("oscar-log-time", timeOf(row.at)));
        line.appendChild(span("oscar-log-chip oscar-log-" + row.dir, row.dir === "in" ? "IN" : "OUT"));
        line.appendChild(span("oscar-log-chip oscar-log-protocol", String(row.protocol || "").toUpperCase()));
        // One label: dropped outranks the rest, then whose send it was, or
        // for what came in, whether the canvas or nothing at all followed it.
        if (row.dropped) {
          line.appendChild(span("oscar-log-chip oscar-log-origin oscar-log-dropped", "Dropped", "Not " + (row.dir === "in" ? "acted on" : "sent") + ": " + row.dropped));
        } else if (row.dir === "out" && row.origin && ORIGIN_WORDS[row.origin]) {
          // Which tablet, when two share a surface: its address on this network.
          line.appendChild(span("oscar-log-chip oscar-log-origin oscar-log-origin-" + row.origin, ORIGIN_WORDS[row.origin], ORIGIN_HINTS[row.origin] + (row.device ? " (" + row.device + ")" : "")));
        } else if (row.dir === "in" && row.canvas) {
          line.appendChild(span("oscar-log-chip oscar-log-origin oscar-log-origin-canvas", "Canvas", "Followed by a widget on the editor's canvas"));
        } else if (unfollowed(row)) {
          line.appendChild(span("oscar-log-chip oscar-log-origin oscar-log-unfollowed", "Unfollowed", "Nothing follows this: no published surface, and not the editor's canvas."));
        }
        line.appendChild(span("oscar-log-what", String(row.what || "")));
        // What the latest of them carried.
        if (row.value) line.appendChild(span("oscar-log-value", "= " + row.value));
        if (row.dir === "out") {
          if (row.to) line.appendChild(span("oscar-log-from", "→ " + row.to));
          if (row.surface) line.appendChild(span("oscar-log-surface", '"' + row.surface + '"', row.widget ? "Sent for " + row.widget : ""));
        } else {
          // Who sent what came in: it is the first thing to know about it.
          if (row.device) line.appendChild(span("oscar-log-from", row.device === "serial" ? "from the serial cable" : "from " + row.device));
          (row.surfaces || []).forEach(function (surface) {
            line.appendChild(span("oscar-log-surface", '"' + surface + '"', "Followed on this published surface"));
          });
        }
        if (row.n > 1) {
          var times = document.createElement("span");
          times.className = "oscar-log-n";
          times.textContent = "×" + row.n;
          line.appendChild(times);
        }
        logList.appendChild(line);
      }
      if (!shown) {
        var quiet = document.createElement("div");
        quiet.className = "oscar-log-quiet";
        quiet.textContent = kept
          ? "Nothing matches these filters."
          : clearedAtWords
            ? "Cleared at " + clearedAtWords + ". Waiting for new messages."
            : "Nothing yet: nothing has been sent or heard.";
        logList.appendChild(quiet);
      }
      if (autoScroll) {
        logList.scrollTop = 0;
      } else if (anchor) {
        var again = logList.querySelector('[data-key="' + (window.CSS && CSS.escape ? CSS.escape(anchor.key) : anchor.key) + '"]');
        if (again) logList.scrollTop += again.getBoundingClientRect().top - logList.getBoundingClientRect().top - anchor.offset;
      }
    }

    function buildLogBox() {
      logBox = document.createElement("div");
      logBox.className = "oscar-live-log";

      var bar = document.createElement("div");
      bar.className = "oscar-log-titlebar";
      var title = document.createElement("span");
      title.className = "oscar-log-title";
      title.textContent = "Network log";
      bar.appendChild(title);
      var scrollLabel = document.createElement("label");
      scrollLabel.className = "oscar-log-autoscroll";
      scrollLabel.setAttribute("title", "Keep the newest message in view as messages arrive");
      var scrollBox = document.createElement("input");
      scrollBox.type = "checkbox";
      scrollBox.checked = autoScroll;
      scrollBox.addEventListener("change", function () {
        autoScroll = scrollBox.checked;
        try {
          localStorage.setItem(AUTOSCROLL_KEY, autoScroll ? "on" : "off");
        } catch (err) {
          /* kept for this session only */
        }
        if (autoScroll && logList) logList.scrollTop = 0;
      });
      scrollLabel.appendChild(scrollBox);
      scrollLabel.appendChild(document.createTextNode("Auto-scroll"));
      bar.appendChild(scrollLabel);
      var clear = document.createElement("button");
      clear.className = "oscar-log-clear";
      clear.type = "button";
      clear.textContent = "Clear";
      clear.setAttribute("title", "Hide what is listed so far, to watch only what comes next");
      clear.addEventListener("click", clearLog);
      bar.appendChild(clear);
      var close = document.createElement("button");
      close.className = "oscar-log-close";
      close.type = "button";
      close.textContent = "×";
      close.setAttribute("title", "Close the log");
      close.addEventListener("click", function () {
        logBox.style.display = "none";
      });
      bar.appendChild(close);
      logBox.appendChild(bar);

      // Dragged by the title bar: the window must be movable off whatever
      // fader is being debugged under it. The moves are listened for on the
      // window, not the bar, and the canvas iframe is shielded while a drag
      // holds (the body class below): an iframe eats pointer moves, which
      // left the drag sticking the moment the pointer crossed the canvas.
      var hold = null;
      bar.addEventListener("pointerdown", function (event) {
        if (close.contains(event.target) || clear.contains(event.target) || scrollLabel.contains(event.target)) return;
        var at = logBox.getBoundingClientRect();
        hold = { x: event.clientX - at.left, y: event.clientY - at.top };
        document.body.classList.add("oscar-log-dragging");
        event.preventDefault();
      });
      window.addEventListener("pointermove", function (event) {
        if (!hold) return;
        logBox.style.left = Math.max(0, Math.min(window.innerWidth - 80, event.clientX - hold.x)) + "px";
        logBox.style.top = Math.max(0, Math.min(window.innerHeight - 40, event.clientY - hold.y)) + "px";
        logBox.style.right = "auto";
        event.preventDefault();
      });
      window.addEventListener("pointerup", function () {
        if (!hold) return;
        hold = null;
        document.body.classList.remove("oscar-log-dragging");
      });

      var head = document.createElement("div");
      head.className = "oscar-log-head";
      head.textContent = "Server IP: " + ipServer + (oscInPort ? " · Listening Port: " + oscInPort : "");
      logBox.appendChild(head);

      var filterBar = document.createElement("div");
      filterBar.className = "oscar-log-filters";
      [
        ["in", "Incoming"],
        ["out", "Outgoing"],
        ["osc", "OSC"],
        ["midi", "MIDI"],
        ["dmx", "DMX"],
        ["unfollowed", "Unfollowed"],
        ["dropped", "Dropped"],
        ["canvas", "Canvas"],
        ["local", "Local"],
        ["internet", "Internet"],
        ["schedule", "Schedule"],
        ["bridge", "Bridge"],
      ].forEach(function (pair, index) {
        if (index === 2 || index === 5) {
          var gap = document.createElement("span");
          gap.className = "oscar-log-filter-gap";
          filterBar.appendChild(gap);
        }
        // Whose move it was gets a row of its own, named.
        if (index === 7) {
          var rowBreak = document.createElement("span");
          rowBreak.className = "oscar-log-filter-break";
          filterBar.appendChild(rowBreak);
          var fromWord = document.createElement("span");
          fromWord.className = "oscar-log-filter-word";
          fromWord.textContent = "Sent from";
          filterBar.appendChild(fromWord);
        }
        var label = document.createElement("label");
        label.className = "oscar-log-filter";
        var box = document.createElement("input");
        box.type = "checkbox";
        box.checked = logFilters[pair[0]];
        box.addEventListener("change", function () {
          logFilters[pair[0]] = box.checked;
          renderLog();
        });
        label.appendChild(box);
        label.appendChild(document.createTextNode(pair[1]));
        filterBar.appendChild(label);
      });
      logBox.appendChild(filterBar);

      logList = document.createElement("div");
      logList.className = "oscar-log-list";
      logBox.appendChild(logList);
      document.body.appendChild(logBox);
    }

    function logOpen() {
      return !!(logBox && logBox.style.display !== "none");
    }

    function openLiveLog() {
      // The lights toggle it: open to watch, the same click to put it away.
      if (logOpen()) {
        logBox.style.display = "none";
        return;
      }
      if (!logBox) buildLogBox();
      logBox.style.display = "";
      // Opened in the middle of the screen; a drag moves it from there, and
      // the window then keeps its place, toggle after toggle.
      if (!logBox.style.left) {
        var at = logBox.getBoundingClientRect();
        logBox.style.left = Math.max(0, Math.round((window.innerWidth - at.width) / 2)) + "px";
        logBox.style.top = Math.max(0, Math.round((window.innerHeight - at.height) / 2)) + "px";
        logBox.style.right = "auto";
      }
      fetch("/live/log")
        .then(function (res) {
          return res.json();
        })
        .then(function (rows) {
          if (Array.isArray(rows)) logRows = rows;
          renderLog();
        })
        .catch(function () {
          renderLog();
        });
      renderLog();
    }

    // The canvas's own sends are logged by the server like every other
    // (server.js, origin "canvas"), so every editor and the MCP server see
    // them, and opening the window keeps them instead of replacing them with
    // the server's backlog.
    //
    // What the canvas follows of what comes in only the canvas knows: its
    // widgets decide for themselves (follow() in lib/widgets/incoming.js,
    // midi-source.js) and say so through ctx.noteHeard. Gathered here and
    // told to the server a few times a second, which logs it as "canvas";
    // a fader ridden from outside is one line with a count.
    var heardPending = {};
    var heardTimer = null;
    editor.noteHeard = function (protocol, what, device) {
      if (!editor.socket) return;
      var key = protocol + "|" + what + "|" + (device || "");
      if (!heardPending[key]) heardPending[key] = device ? { protocol: protocol, what: String(what), device: String(device) } : { protocol: protocol, what: String(what) };
      if (!heardTimer) {
        heardTimer = setTimeout(function () {
          heardTimer = null;
          var rows = Object.keys(heardPending).map(function (k) {
            return heardPending[k];
          });
          heardPending = {};
          if (rows.length) editor.socket.emit("canvas:heard", rows);
          // Well inside the server's hold (ARRIVAL_HOLD_MS), so the word
          // lands on the row of the message it is about.
        }, 150);
      }
    };

    // The zones' clicks, through the bar's one listener: re-renders replace
    // elements, the document does not.
    onBarClick(".oscar-live-zone", function (zone) {
      if (zone.getAttribute("data-zone") === "publish") editor.runCommand("oscar-export");
      else openLiveLog();
    });

    if (editor.socket) {
      editor.socket.on("live:activity", function (msg) {
        if (msg && (msg.dir === "in" || msg.dir === "out")) flash(msg.dir);
      });
      // The log listens all along, not only while its window is open: what
      // happened a minute before it was opened is exactly what it is for.
      editor.socket.on("live:log", function (row) {
        if (!row || (row.dir !== "in" && row.dir !== "out") || !row.id) return;
        // An update is the same traffic said again: the meters count it once.
        if (takeRow(row) && !row.dropped) countTraffic(row);
        if (logOpen()) renderLog();
      });
      editor.socket.on("published:changed", refreshLive);
      // A server that restarted may have a different roster than the one
      // this pill last drew.
      editor.socket.on("connect", refreshLive);
      editor.socket.on("disconnect", paintServer);
    }
    refreshLive();
    paintPublic();
  })();

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
  // Import's dialog lives on behind the Open menu ("Paste HTML / CSS...");
  // the toolbar button itself retires.
  pn.removeButton("options", "gjs-open-import-webpage");

  // (The sizes crossed panels earlier, before anything on the left was
  // wired: removing a button re-renders the whole panel, and listeners
  // bound to the old elements die with them.)

  // The left half's order, applied the way arrangeToolbar applies the
  // right's: models and elements moved together, silently, because a reset
  // that redraws would throw away the pills' painted state.
  (function orderLeftPanel() {
    var panel = pn.getPanel("devices-c");
    var row = document.querySelector(".gjs-pn-devices-c .gjs-pn-buttons");
    if (!panel || !row) return;
    var buttons = panel.get("buttons");
    var models = buttons.models.slice();
    var els = Array.prototype.slice.call(row.querySelectorAll(".gjs-pn-btn"));
    if (models.length !== els.length) return;
    var ids = models.map(function (model) {
      return model.get("id");
    });
    var wanted = ["oscar-file", "oscar-edit", "oscar-title", "oscar-save-state", "ipButton"]
      .filter(function (id) {
        return ids.indexOf(id) !== -1;
      })
      .concat(
        ids.filter(function (id) {
          return ["oscar-file", "oscar-edit", "oscar-title", "oscar-save-state", "ipButton"].indexOf(id) === -1;
        })
      );
    wanted.forEach(function (id) {
      row.appendChild(els[ids.indexOf(id)]);
    });
    buttons.reset(
      wanted.map(function (id) {
        return models[ids.indexOf(id)];
      }),
      { silent: true }
    );
  })();

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
    // "Push", not "Preview": this is also what sends the layout to the
    // /preview page, which keeps showing the last pushed version until it is.
    preview: "Push to preview",
    // something in, and templates -- the other thing one might import -- are
    // opened from Load.
    "toggle-lock": null,
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
     * OSCAR's own (`after`, a button id such as "toggle-lock").
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
    /**
     * An item in File's or Edit's menu: "file" or "edit", { id, label,
     * run(editor) }. Edit's sit beside Lock editing, File's just above About.
     * The same id again replaces the item.
     */
    addMenuItem: function (menu, item) {
      if (!menuExtras[menu]) throw new Error('A menu item goes in "file" or "edit"');
      if (!item || !item.id || typeof item.run !== "function") throw new Error("A menu item needs an id and a run function");
      oscarApi.removeMenuItem(menu, item.id);
      menuExtras[menu].push({ id: String(item.id), label: String(item.label || item.id), run: item.run });
    },
    /**
     * What is public on the internet, for the PUBLIC pill: { surfaces: [{ id,
     * online }] }, every time it changes. Until an extension says, the pill
     * reads 0 and says public surfaces are OSCAR Pro's.
     */
    setPublicCount: function (state) {
      livePublic.set(state);
    },
    /** Take an item of the extension's own out of a menu again. */
    removeMenuItem: function (menu, id) {
      if (!menuExtras[menu]) return;
      menuExtras[menu] = menuExtras[menu].filter(function (item) {
        return item.id !== String(id);
      });
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
      /**
       * Add an answer to "who can open it" on every row, after OSCAR's own
       * Off and This network. See addAccessLevel in export_dialog.js.
       */
      addAccessLevel: function (level) {
        if (publishDialog) publishDialog.addAccessLevel(level);
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
