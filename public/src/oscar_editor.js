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
  help: "M15.07,11.25L14.17,12.17C13.45,12.89 13,13.5 13,15H11V14.5C11,13.39 11.45,12.39 12.17,11.67L13.41,10.41C13.78,10.05 14,9.55 14,9C14,7.89 13.1,7 12,7A2,2 0 0,0 10,9H8A4,4 0 0,1 12,5A4,4 0 0,1 16,9C16,9.88 15.64,10.67 15.07,11.25M13,19H11V17H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12C22,6.47 17.5,2 12,2Z",
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
var projectsTable = require("../../lib/projects-table");
var widgetStyles = require("../../lib/widget-styles");
var { followSurfaceStyle } = require("./adapters/grapesjs");

var oscarButton = require("./oscar_button");
var oscarSlider = require("./oscar_slider");
var oscarXypad = require("./oscar_xypad");

/** Hand a widget plugin the address other devices should send to. */
function withIp(plugin, ipServer) {
  return function (editor) {
    plugin(editor, { ipserver: ipServer });
  };
}
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
      options: { local: { key: "oscarProject" } },
      // Stamp the autosave the same way saved files are stamped, and never
      // let editor state into it.
      onStore: function (data) {
        return Object.assign(
          { oscarFormat: projectFormat.CURRENT_FORMAT },
          projectFormat.stripEditorState(data)
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
      withIp(oscarButton, ipServer),
      withIp(oscarSlider, ipServer),
      withIp(oscarXypad, ipServer),
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
        modalImportTitle: "Import Template",
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

    if (projectsProblem || !projectRows.length) {
      var empty = document.createElement("tr");
      empty.className = "o-empty";
      var message = projectCell(projectsProblem || "No saved projects yet");
      message.colSpan = 4;
      empty.appendChild(message);
      projectsBody.appendChild(empty);
      return;
    }

    projectsTable
      .sortProjects(projectRows, projectSort.key, projectSort.direction)
      .forEach(function (row) {
        var tr = document.createElement("tr");
        tr.tabIndex = 0;
        tr.setAttribute("aria-selected", String(row._id === selectedId));
        tr.appendChild(projectCell(row.name));
        tr.appendChild(projectCell(projectsTable.formatSize(row.size), "o-num"));
        tr.appendChild(projectCell(row.date, "o-date"));

        var actions = document.createElement("td");
        actions.className = "o-actions";
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
      });
  }

  // Marks the row in place rather than re-rendering, so a keyboard user's
  // focus stays on the row they just chose.
  function selectProject(row, tr) {
    $("#project-name").val(row.name).attr("id-project", row._id);
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
  var beforePreview = null;

  editor.on("command:run:preview", function () {
    // Hand the canvas to the preview page before locking, so the lock doesn't
    // travel with it.
    postJSON("/save/preview", { project: editor.getProjectData() }).catch(function (err) {
      console.log("Could not hand off preview", err);
    });

    editor.select();
    beforePreview = [];
    editor.getWrapper().onAll(function (component) {
      var previous = {};
      Object.keys(PREVIEW_LOCK).forEach(function (key) {
        previous[key] = component.get(key);
      });
      beforePreview.push([component, previous]);
      component.set(PREVIEW_LOCK, { avoidStore: true });
    });

    // The selection toolbar, badges and resize handles live outside the canvas
    // and would otherwise float over the control surface, delete button and
    // all.
    editor.getEl().classList.add("oscar-previewing");
  });

  editor.on("command:stop:preview", function () {
    if (beforePreview) {
      beforePreview.forEach(function (entry) {
        entry[0].set(entry[1], { avoidStore: true });
      });
      beforePreview = null;
    }
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
    widgetStyles.STYLES.forEach(function (entry) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "o-style-card";
      card.setAttribute("data-style", entry.id);

      // The preview is only a picture: the card is what gets clicked.
      var preview = document.createElement("iframe");
      preview.className = "o-style-preview";
      preview.tabIndex = -1;
      preview.setAttribute("aria-hidden", "true");
      card.appendChild(preview);

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

  pn.addButton("options", {
    id: "open-load",
    label: icon("open"),
    command: function () {
      editor.runCommand("open-projects", { type: "Load" });
    },
    attributes: { title: "Load project", "data-tooltip-pos": "bottom" },
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
  // GrapesJS renders the panels during init, before any of this runs, and a
  // button does not re-render when its attributes change afterwards. Setting
  // the model alone is silently ignored, so the text is written onto the
  // elements as well. Buttons render in the order the panel holds them.
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
    "gjs-open-import-webpage": "Import",
    "canvas-clear": "Clear canvas",
    "toggle-lock": null,
    "open-styles": "Widget style",
    "open-save": "Save project",
    "open-load": "Load project",
    "open-info": "About",
  });

  retitle("views", {
    "open-sm": "Style Manager",
    "open-tm": "OSC Settings",
    "open-layers": "Layers",
    "open-blocks": "Blocks",
  });

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
