window.$ = $ = window.jQuery = require("jquery");

// These plugins attach themselves to whichever jQuery they are handed. The
// bundle carries its own copy of jQuery, so they must be required here rather
// than loaded as separate <script> tags -- otherwise they extend the page's
// jQuery and $.alert/$.confirm/.bootstrapTable go missing on this one.
require("bootstrap-table");
// jquery-confirm's CommonJS build exports an initialiser instead of running
// itself, so it has to be invoked with the jQuery it should extend.
require("jquery-confirm")(window, $);

// GrapesJS 0.21+ no longer ships Font Awesome, so OSCAR's icons are inline SVG.
var ICONS = {
  save: "M15,9H5V5H15M12,19A3,3 0 0,1 9,16A3,3 0 0,1 12,13A3,3 0 0,1 15,16A3,3 0 0,1 12,19M17,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3Z",
  open: "M19,20H4C2.89,20 2,19.1 2,18V6C2,4.89 2.89,4 4,4H10L12,6H19A2,2 0 0,1 21,8H21L4,8V18L6.14,10H23.21L20.93,18.5C20.7,19.37 19.92,20 19,20Z",
  help: "M15.07,11.25L14.17,12.17C13.45,12.89 13,13.5 13,15H11V14.5C11,13.39 11.45,12.39 12.17,11.67L13.41,10.41C13.78,10.05 14,9.55 14,9C14,7.89 13.1,7 12,7A2,2 0 0,0 10,9H8A4,4 0 0,1 12,5A4,4 0 0,1 16,9C16,9.88 15.64,10.67 15.07,11.25M13,19H11V17H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12C22,6.47 17.5,2 12,2Z",
  remove: "M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z",
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
      initGrape(conn.address || window.location.hostname || "localhost", conn.socketPort || 8081);
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

function initGrape(ipServer, socketPort) {
  editor = grapesjs.init({
    dragMode: "absolute",
    height: "100%",
    container: "#gjs",
    fromElement: true,
    allowScripts: 1,
    canvas: { styles: ["assets/css/toggle.css"] },
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
      options: { local: { key: "oscarProject" } },
      // Stamp the autosave the same way saved files are stamped.
      onStore: function (data) {
        return Object.assign({ oscarFormat: projectFormat.CURRENT_FORMAT }, data);
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
      "oscar_button",
      "oscar_slider",
      "grapesjs-preset-webpage",
      "gjs-blocks-basic",
      "grapesjs-custom-code",
      "grapesjs-parser-postcss",
      "grapesjs-touch",
      "grapesjs-tooltip",
    ],
    pluginsOpts: {
      oscar_socket: { ipserver: ipServer, socketPort: socketPort },
      oscar_slider: { ipserver: ipServer },
      oscar_button: { ipserver: ipServer },
      "grapesjs-tooltip": {},
      "gjs-blocks-basic": { flexGrid: true },
      "grapesjs-preset-webpage": {
        blocks: [],
        // Keep OSCAR's own palette (css/oscar_colors.css) rather than the
        // preset's theme.
        useCustomTheme: false,
        showStylesOnChange: true,
        modalImportTitle: "Import Template",
        modalImportLabel:
          '<div style="margin-bottom: 10px; font-size: 13px;">Paste here your HTML/CSS and click Import</div>',
        modalImportContent: function (editor) {
          return editor.getHtml() + "<style>" + editor.getCss() + "</style>";
        },
      },
    },
  });

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

  var tableReady = false;

  function openProjects(mode) {
    setModal(mode, "table-panel");
    $("#save-button").toggle(mode === "Save");
    $("#load-button").toggle(mode === "Load");

    if (!tableReady) {
      initTable();
      tableReady = true;
    } else {
      $("#projects-table").bootstrapTable("refresh");
    }
  }

  editor.Commands.add("open-projects", function (ed, sender, options) {
    openProjects((options && options.type) || "Save");
  });

  // ---- project table -----------------------------------------------------
  function initTable() {
    $("#projects-table").bootstrapTable({
      url: "/projects",
      height: 300,
      columns: [
        { title: "Name", field: "name", sortable: true },
        { title: "Size", field: "size", sortable: true, formatter: sizeFormatter },
        { title: "Saved", field: "date", sortable: true },
        {
          title: "",
          field: "action",
          clickToSelect: false,
          events: window.operateEvents,
          formatter: operateFormatter,
        },
      ],
      pagination: false,
      search: false,
      sortable: true,
      clickToSelect: true,
      singleSelect: true,
      onClickRow: function (row) {
        $("#project-name").val(row.name).attr("id-project", row._id);
      },
      onLoadError: function (status, jqXHR) {
        console.log("Could not load projects", jqXHR);
      },
    });
  }

  function sizeFormatter(value) {
    if (value !== 0 && !value) return "";
    return value < 1024 ? value + " B" : Math.round(value / 1024) + " KB";
  }

  function operateFormatter() {
    return '<a class="remove icon" href="javascript:void(0)" title="Remove">' + icon("remove") + "</a>";
  }

  window.operateEvents = {
    "click .remove": function (e, value, row) {
      $.confirm({
        title: "Delete Project",
        content:
          "Are you sure you want to delete this project? You won't be able to recover it afterwards.",
        buttons: {
          confirm: function () {
            $.ajax({ type: "DELETE", url: "/remove/" + row._id })
              .done(function (data) {
                $("#projects-table").bootstrapTable("refresh");
                $.alert(data.error || data.msg);
              })
              .fail(function () {
                $.alert("Could not delete that project");
              });
          },
          cancel: function () {},
        },
      });
    },
  };

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

        $("#projects-table").bootstrapTable("refresh");
        $.alert(res.msg);
        modal.close();
      })
      .catch(function () {
        hideLoader();
        $.alert("Could not reach the OSCAR server");
      });
  }

  // ---- load --------------------------------------------------------------
  document.getElementById("load-button").onclick = function () {
    var id = projectName.getAttribute("id-project");
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

  // ---- preview mode ------------------------------------------------------
  // GrapesJS's preview hides the panels, but in absolute drag mode it leaves
  // components draggable -- dragging a button in preview pulls its label out.
  //
  // This blocks the drag in the canvas rather than marking components
  // undraggable. An earlier version set draggable/selectable/... to false and
  // restored them on exit, but those values are part of the project: saving
  // while previewing wrote "don't move me" into the file permanently.
  // Component data must never carry editor state.
  //
  // Only mousedown and dragstart are swallowed, and only propagation -- never
  // the default action. Clicks are still generated, and a range slider still
  // drags natively, so widgets keep sending OSC while previewing.
  // touchstart is deliberately NOT in this list: OSCAR's buttons listen for it,
  // and swallowing it would stop every widget working on a tablet -- the whole
  // point of the preview. Blocking touchmove stops a touch-driven drag without
  // affecting a range slider, whose touch dragging is a default action and so
  // survives stopped propagation.
  var BLOCKED_IN_PREVIEW = ["mousedown", "pointerdown", "dragstart", "touchmove"];
  var swallow = null;

  function blockCanvasEditing() {
    var doc = editor.Canvas.getDocument();
    if (!doc || swallow) return;

    swallow = function (e) {
      e.stopImmediatePropagation();
    };
    BLOCKED_IN_PREVIEW.forEach(function (type) {
      doc.addEventListener(type, swallow, true);
    });

    // The selection toolbar, badges and resize handles live outside the canvas
    // and would otherwise float over the control surface -- including a delete
    // button. Hide the lot while previewing.
    editor.getEl().classList.add("oscar-previewing");
  }

  function unblockCanvasEditing() {
    var doc = editor.Canvas.getDocument();
    if (!doc || !swallow) return;

    BLOCKED_IN_PREVIEW.forEach(function (type) {
      doc.removeEventListener(type, swallow, true);
    });
    swallow = null;
    editor.getEl().classList.remove("oscar-previewing");
  }

  editor.on("command:run:preview", function () {
    // Hand the canvas to the preview page (read back from /show/preview).
    postJSON("/save/preview", { project: editor.getProjectData() }).catch(function (err) {
      console.log("Could not hand off preview", err);
    });

    editor.select();
    blockCanvasEditing();
  });

  editor.on("command:stop:preview", unblockCanvasEditing);

  // ---- panel buttons -----------------------------------------------------
  pn.addButton("options", {
    id: "open-save",
    label: icon("save"),
    command: function () {
      editor.runCommand("open-projects", { type: "Save" });
    },
    attributes: { title: "Save project", "data-tooltip-pos": "bottom" },
  });

  pn.addButton("options", {
    id: "open-load",
    label: icon("open"),
    command: function () {
      editor.runCommand("open-projects", { type: "Load" });
    },
    attributes: { title: "Load project", "data-tooltip-pos": "bottom" },
  });

  pn.addButton("options", {
    id: "open-info",
    label: icon("help"),
    command: function () {
      setModal("About", "info-panel");
    },
    attributes: { title: "About", "data-tooltip-pos": "bottom" },
  });

  pn.addButton("devices-c", {
    id: "ipButton",
    className: "oscar-ip-label",
    label: "Server IP: " + ipServer,
    command: null,
    attributes: { title: "Point other devices at this address" },
    active: false,
    disable: true,
  });

  // ---- tooltips ----------------------------------------------------------
  [
    ["sw-visibility", "Show Borders"],
    ["preview", "Preview"],
    ["fullscreen", "Fullscreen"],
    ["export-template", "See Code"],
    ["undo", "Undo"],
    ["redo", "Redo"],
    ["gjs-open-import-webpage", "Import"],
    ["canvas-clear", "Clear canvas"],
  ].forEach(function (item) {
    var button = pn.getButton("options", item[0]);
    button && button.set("attributes", { title: item[1], "data-tooltip-pos": "bottom" });
  });

  [
    ["open-sm", "Style Manager"],
    ["open-tm", "OSC Settings"],
    ["open-layers", "Layers"],
    ["open-blocks", "Blocks"],
  ].forEach(function (item) {
    var button = pn.getButton("views", item[0]);
    button && button.set("attributes", { title: item[1], "data-tooltip-pos": "bottom" });
  });

  var titles = document.querySelectorAll("*[title]");
  for (var i = 0; i < titles.length; i++) {
    var el = titles[i];
    var title = (el.getAttribute("title") || "").trim();
    if (!title) continue;
    el.setAttribute("data-tooltip", title);
    el.setAttribute("title", "");
  }
}
