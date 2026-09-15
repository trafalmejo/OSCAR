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
  download: "M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z",
  help: "M15.07,11.25L14.17,12.17C13.45,12.89 13,13.5 13,15H11V14.5C11,13.39 11.45,12.39 12.17,11.67L13.41,10.41C13.78,10.05 14,9.55 14,9C14,7.89 13.1,7 12,7A2,2 0 0,0 10,9H8A4,4 0 0,1 12,5A4,4 0 0,1 16,9C16,9.88 15.64,10.67 15.07,11.25M13,19H11V17H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12C22,6.47 17.5,2 12,2Z",
  remove: "M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z",
  locked:
    "M12,17A2,2 0 0,0 14,15C14,13.89 13.1,13 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6A2,2 0 0,1 4,20V10C4,8.89 4.9,8 6,8H7V6A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,3A3,3 0 0,0 9,6V8H15V6A3,3 0 0,0 12,3Z",
  unlocked:
    "M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V10A2,2 0 0,1 6,8H15V6A3,3 0 0,0 12,3A3,3 0 0,0 9,6H7A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,17A2,2 0 0,0 14,15A2,2 0 0,0 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17Z",
  pages:
    "M15,7H20.5L15,1.5V7M8,0H16L22,6V18A2,2 0 0,1 20,20H8C6.89,20 6,19.1 6,18V2A2,2 0 0,1 8,0M4,4V22H20V24H4A2,2 0 0,1 2,22V4H4Z",
  rename:
    "M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z",
  serial:
    "M15,7V11H16V13H13V5H15L12,1L9,5H11V13H8V10.93C8.7,10.56 9.2,9.85 9.2,9C9.2,7.78 8.21,6.78 7,6.78C5.78,6.78 4.78,7.78 4.78,9C4.78,9.85 5.28,10.56 6,10.93V13A2,2 0 0,0 8,15H11V18.05C10.29,18.41 9.8,19.15 9.8,20A2.2,2.2 0 0,0 12,22.2A2.2,2.2 0 0,0 14.2,20C14.2,19.15 13.71,18.41 13,18.05V15H16A2,2 0 0,0 18,13V11H19V7H15Z",
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

var oscarButton = require("./oscar_button");
var oscarSlider = require("./oscar_slider");
var oscarXypad = require("./oscar_xypad");
var oscarColour = require("./oscar_colour");
var oscarText = require("./oscar_text");
var oscarNumber = require("./oscar_number");
var oscarSelect = require("./oscar_select");
var oscarMeter = require("./oscar_meter");
var oscarMedia = require("./oscar_media");
var oscarExport = require("./oscar_export");

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
        data = projectFormat.namePages(projectFormat.stripEditorState(data));

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
      withIp(oscarColour, ipServer),
      withIp(oscarText, ipServer),
      withIp(oscarNumber, ipServer),
      withIp(oscarSelect, ipServer),
      withIp(oscarMeter, ipServer),
      withIp(oscarMedia, ipServer),
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
  // A surface can hold several pages -- a page per fixture group, or per scene
  // -- and the person driving it switches between them from the tabs along the
  // bottom of the control surface. This is the designer's end of that: the
  // list, and the add/rename/delete around it.
  var pages = editor.Pages;

  /**
   * GrapesJS leaves a page it created itself with an empty name, so there is
   * always something to fall back to. The fallback is the same label the
   * project format writes into the file, so the tab does not change wording
   * the first time a project is saved.
   */
  function pageLabel(page, index) {
    return page.getName() || projectFormat.defaultPageName(index);
  }

  function renamePage(page, index) {
    $.confirm({
      title: "Rename page",
      content:
        '<input id="page-rename-input" class="oscar-page-rename-input" type="text" />',
      onContentReady: function () {
        var input = this.$content.find("#page-rename-input");
        input.val(pageLabel(page, index));
        // Electron has no window.prompt, so this small form is the prompt.
        input.trigger("focus").trigger("select");
      },
      buttons: {
        confirm: function () {
          var name = (this.$content.find("#page-rename-input").val() || "").trim();
          if (!name) return;
          page.setName(name);
          renderPages();
        },
        cancel: function () {},
      },
    });
  }

  function deletePage(page, index) {
    $.confirm({
      title: "Delete Page",
      content:
        'Delete "' +
        pageLabel(page, index) +
        '" and everything on it? You won\'t be able to recover it afterwards.',
      buttons: {
        confirm: function () {
          pages.remove(page);
          renderPages();
        },
        cancel: function () {},
      },
    });
  }

  function pageAction(name, title, onClick) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "oscar-page-action";
    button.innerHTML = icon(name, 16);
    button.setAttribute("data-tooltip", title);
    button.onclick = onClick;
    return button;
  }

  function renderPages() {
    var list = document.getElementById("pages-list");
    if (!list) return;

    var all = pages.getAll();
    var selected = pages.getSelected();
    list.innerHTML = "";

    all.forEach(function (page, index) {
      var row = document.createElement("li");
      row.className = "oscar-page";
      if (selected && selected.getId() === page.getId()) row.className += " oscar-page-current";

      var open = document.createElement("button");
      open.type = "button";
      open.className = "oscar-page-open";
      open.textContent = pageLabel(page, index);
      open.onclick = function () {
        pages.select(page);
        modal.close();
      };
      row.appendChild(open);

      row.appendChild(
        pageAction("rename", "Rename", function () {
          renamePage(page, index);
        })
      );

      // The last page cannot go: GrapesJS would be left with no page to draw,
      // and there would be no way back to a working canvas.
      if (all.length > 1) {
        row.appendChild(
          pageAction("remove", "Delete", function () {
            deletePage(page, index);
          })
        );
      }

      list.appendChild(row);
    });
  }

  function addPage() {
    var input = document.getElementById("new-page-name");
    var name = ((input && input.value) || "").trim();
    // Naming it is optional; an unnamed page is called what it would be called
    // in the file anyway.
    var page = pages.add(
      { name: name || projectFormat.defaultPageName(pages.getAll().length) },
      { select: true }
    );
    if (input) input.value = "";
    if (!page) {
      $.alert("That page could not be added");
      return;
    }
    modal.close();
  }

  editor.Commands.add("open-pages", function () {
    renderPages();
    setModal("Pages", "pages-panel");
  });

  (function wirePagesPanel() {
    var add = document.getElementById("add-page-button");
    if (add) add.onclick = addPage;

    var input = document.getElementById("new-page-name");
    if (input) {
      input.onkeydown = function (e) {
        if (e.key === "Enter") addPage();
      };
    }
  })();

  // The list is also open while pages are added from elsewhere (undo, a
  // project load), so keep it honest rather than only redrawing on our own
  // actions.
  editor.on("page:add page:remove page:select page:update", renderPages);

  // ---- serial ------------------------------------------------------------
  // Which board on a USB cable OSCAR talks to. Widgets aimed at it say
  // `serial` in their Ip field; this panel only decides which cable that is.
  var serialState = null;

  function describeSerial(state) {
    if (!state.supported) return state.reason || "Serial is not available in this build.";
    if (state.state === "open") return "Connected to " + state.path + " at " + state.bitrate + " baud";
    if (state.state === "opening") {
      return (
        "Trying " + state.path + "…" + (state.error ? " (" + state.error + ")" : "")
      );
    }
    return state.error ? "Not connected — " + state.error : "Not connected";
  }

  function paintSerial(state) {
    serialState = state || {};

    var status = document.getElementById("serial-status");
    if (status) {
      status.textContent = describeSerial(serialState);
      status.classList.toggle("oscar-serial-open", serialState.state === "open");
    }

    var select = document.getElementById("serial-port");
    if (select) {
      var wanted = serialState.path || select.value;
      select.innerHTML = "";

      var ports = serialState.ports || [];
      if (!ports.length) {
        var empty = document.createElement("option");
        empty.textContent = serialState.supported
          ? "No serial ports found — is the board plugged in?"
          : "Serial unavailable";
        empty.value = "";
        select.appendChild(empty);
      }

      ports.forEach(function (port) {
        var option = document.createElement("option");
        option.value = port.path;
        option.textContent = port.label && port.label !== port.path
          ? port.path + " — " + port.label
          : port.path;
        if (port.path === wanted) option.selected = true;
        select.appendChild(option);
      });

      select.disabled = !serialState.supported || !ports.length;
    }

    var bitrate = document.getElementById("serial-bitrate");
    if (bitrate && serialState.bitrate) bitrate.value = serialState.bitrate;

    ["serial-connect", "serial-disconnect", "serial-refresh"].forEach(function (id) {
      var button = document.getElementById(id);
      if (button) button.disabled = !serialState.supported;
    });
  }

  function loadSerial() {
    return fetch("/serial")
      .then(function (res) {
        return res.json();
      })
      .then(paintSerial)
      .catch(function () {
        paintSerial({ supported: false, reason: "Could not reach the OSCAR server" });
      });
  }

  function changeSerial(body) {
    postJSON("/serial", body)
      .then(paintSerial)
      .catch(function () {
        $.alert("Could not reach the OSCAR server");
      });
  }

  editor.Commands.add("open-serial", function () {
    loadSerial();
    setModal("Serial", "serial-panel");
  });

  (function wireSerialPanel() {
    var refresh = document.getElementById("serial-refresh");
    if (refresh) refresh.onclick = loadSerial;

    var connect = document.getElementById("serial-connect");
    if (connect) {
      connect.onclick = function () {
        var select = document.getElementById("serial-port");
        var bitrate = document.getElementById("serial-bitrate");
        if (!select || !select.value) {
          $.alert("Pick a serial port first");
          return;
        }
        changeSerial({
          connect: true,
          path: select.value,
          bitrate: Number(bitrate && bitrate.value) || 115200,
        });
      };
    }

    var disconnect = document.getElementById("serial-disconnect");
    if (disconnect) {
      disconnect.onclick = function () {
        changeSerial({ connect: false });
      };
    }
  })();

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
  // Which components the lock has already been applied to. Switching pages
  // mid-preview locks the page that comes into view, and switching back must
  // not record the lock itself as the state to restore.
  var previewLocked = null;

  /** Lock whatever page is on the canvas right now. */
  function lockVisiblePage() {
    if (!beforePreview) return;

    editor.getWrapper().onAll(function (component) {
      if (previewLocked.indexOf(component.cid) !== -1) return;
      previewLocked.push(component.cid);

      var previous = {};
      Object.keys(PREVIEW_LOCK).forEach(function (key) {
        previous[key] = component.get(key);
      });
      beforePreview.push([component, previous]);
      component.set(PREVIEW_LOCK, { avoidStore: true });
    });
  }

  editor.on("command:run:preview", function () {
    // Hand the canvas to the preview page before locking, so the lock doesn't
    // travel with it. Every page goes across, not just the one on screen.
    postJSON("/save/preview", { project: editor.getProjectData() }).catch(function (err) {
      console.log("Could not hand off preview", err);
    });

    editor.select();
    beforePreview = [];
    previewLocked = [];
    lockVisiblePage();

    // The selection toolbar, badges and resize handles live outside the canvas
    // and would otherwise float over the control surface, delete button and
    // all.
    editor.getEl().classList.add("oscar-previewing");
  });

  // A page the designer opens while previewing arrives unlocked, and dragging
  // a widget in absolute mode pulls it apart.
  editor.on("page:select", lockVisiblePage);

  editor.on("command:stop:preview", function () {
    if (beforePreview) {
      beforePreview.forEach(function (entry) {
        entry[0].set(entry[1], { avoidStore: true });
      });
      beforePreview = null;
      previewLocked = null;
    }
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
    id: "open-serial",
    label: icon("serial"),
    command: function () {
      editor.runCommand("open-serial");
    },
    attributes: { title: "Serial", "data-tooltip-pos": "bottom" },
  });

  pn.addButton("options", {
    id: "open-load",
    label: icon("open"),
    command: function () {
      editor.runCommand("open-projects", { type: "Load" });
    },
    attributes: { title: "Load project", "data-tooltip-pos": "bottom" },
  });

  // ---- export ------------------------------------------------------------
  // Distinct from "See code" next to it, which is GrapesJS's own view of the
  // markup. This one produces a file that actually sends.
  oscarExport.install(editor, {
    host: ipServer,
    port: socketPort,
    projectName: function () {
      return projectName ? projectName.value : "";
    },
  });

  pn.addButton("options", {
    id: "oscar-export",
    label: icon("download"),
    command: function () {
      editor.runCommand("oscar-export");
    },
    attributes: { title: "Export interface", "data-tooltip-pos": "bottom" },
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
    "open-pages": "Pages",
    "open-serial": "Serial",
    "open-load": "Load project",
    "oscar-export": "Export a working interface",
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
