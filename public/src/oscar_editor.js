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

// Every widget in lib/widgets/registry.js, wired to GrapesJS by the adapter.
var { widgetPlugins } = require("./adapters/grapesjs");

// Tabs and the page-by-page lock, shared with the /preview page.
var oscarPages = require("./pages");

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
      // Stamp the autosave the same way saved files are stamped, and never
      // let editor state into it.
      onStore: function (data) {
        return Object.assign(
          { oscarFormat: projectFormat.CURRENT_FORMAT },
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

  // ---- pages -------------------------------------------------------------
  // A surface can hold several pages -- a page per fixture group, or per
  // scene. GrapesJS has had the model for this all along (editor.Pages, and a
  // pages array in every project); what it lacks is any way to reach it.
  var pages = editor.Pages;

  function labelOf(page) {
    return projectFormat.pageLabel(page.getName(), pages.getAll().indexOf(page));
  }

  /**
   * Ask for a page name in a jquery-confirm form. Not window.prompt: Electron
   * does not implement it, so in the desktop app it would silently return
   * nothing and the page could never be renamed.
   */
  function askPageName(title, current, onName) {
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
          askPageName("Rename page", entry.label, function (name) {
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

    // Naming it is optional; a page left unnamed is given the name it would
    // be shown under anyway, because GrapesJS would drop an empty one.
    var page = pages.add(
      { name: name || projectFormat.defaultPageName(pages.getAll().length) },
      { select: true }
    );
    if (!page) {
      $.alert("That page could not be added");
      return;
    }
    if (input) input.value = "";
  }

  editor.Commands.add("open-pages", function () {
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
  });

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

    // The selection toolbar, badges and resize handles live outside the canvas
    // and would otherwise float over the control surface, delete button and
    // all.
    editor.getEl().classList.add("oscar-previewing");
  });

  editor.on("command:stop:preview", function () {
    previewing = false;
    previewLock.release();
    previewTabs.hide();
    editor.getEl().classList.remove("oscar-previewing");
  });

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
    id: "open-pages",
    label: icon("pages"),
    command: function () {
      editor.runCommand("open-pages");
    },
    attributes: { title: "Pages", "data-tooltip-pos": "bottom" },
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
    "open-save": "Save project",
    "open-load": "Load project",
    "open-pages": "Pages",
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
