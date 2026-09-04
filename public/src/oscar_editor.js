window.$ = $ = window.jQuery = require("jquery");

// These plugins attach themselves to whichever jQuery they are handed. The
// bundle carries its own copy of jQuery, so they must be required here rather
// than loaded as separate <script> tags -- otherwise they extend the page's
// jQuery and $.alert/$.confirm/.bootstrapTable go missing on this one.
require("bootstrap-table");
// jquery-confirm's CommonJS build exports an initialiser instead of running
// itself, so it has to be invoked with the jQuery it should extend.
require("jquery-confirm")(window, $);

var editor = {};

// One browserify bundle serves both the editor and the preview page, so each
// entry point only boots when its own container is on the page.
if (document.getElementById("gjs")) {
  // Ask the server which address it is reachable on, so new widgets default to
  // an IP that other devices on the network can actually talk to.
  $.get("/ipserver", function (data) {
    initGrape(data || window.location.hostname || "localhost");
    window.editor = editor;
  });
}

function initGrape(ipServer) {
  editor = grapesjs.init({
    dragMode: "absolute",
    height: "100%",
    container: "#gjs",
    fromElement: true,
    allowScripts: 1,
    canvas: { styles: ["assets/css/toggle.css"] },
    panels: {},
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
    styleManager: {},
    blockManager: {},
    traitManager: {},
    // The canvas autosaves into this browser. Named projects are a separate,
    // explicit action that writes JSON files next to the OSCAR server.
    storageManager: {
      id: "gjs-",
      type: "local",
      stepsBeforeSave: 1,
      autosave: true,
      autoload: true,
      contentTypeJson: true,
    },
    plugins: [
      "oscar_socket",
      "oscar_ip",
      "oscar_button",
      "oscar_slider",
      "gjs-preset-webpage",
      "grapesjs-custom-code",
      "grapesjs-parser-postcss",
      "grapesjs-touch",
      "grapesjs-tooltip",
    ],
    pluginsOpts: {
      oscar_socket: { ipserver: ipServer },
      oscar_slider: { ipserver: ipServer },
      oscar_button: { ipserver: ipServer },
      "grapesjs-tooltip": {},
      "gjs-preset-webpage": {
        blocks: [],
        formsOpts: false,
        exportOpts: false,
        navbarOpts: false,
        countdownOpts: false,
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
  var commands = editor.Commands;

  // Named projects go through the "remote" storage, which now points at
  // OSCAR's own local file API rather than a cloud account.
  var ProjectStorage = editor.StorageManager.get("remote").set({
    id: "gjs-",
    type: "remote",
    stepsBeforeSave: 1,
    urlStore: "/save",
    urlLoad: "/load",
    autosave: false,
    autoload: false,
    contentTypeJson: true,
  });

  // Run a project-library action against the server, then always hand the
  // editor back to local autosave so the canvas keeps saving itself.
  function withProjectStorage(action) {
    editor.StorageManager.setCurrent("remote");
    action(function restore() {
      editor.StorageManager.setCurrent("local");
    });
  }

  // ---- modals ------------------------------------------------------------
  function setModal(title, containerId) {
    var container = document.getElementById(containerId);
    var dialog = document.querySelector(".gjs-mdl-dialog");
    var cls = "modal-login";

    dialog.className += " " + cls;
    container.style.display = "block";
    modal.setTitle(title);
    modal.setContent(container);
    modal.open();
    modal.getModel().once("change:open", function () {
      dialog.className = dialog.className.replace(cls, "");
    });
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

  commands.add("open-projects", function (ed, sender, options) {
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
    return '<a class="remove icon" href="javascript:void(0)" title="Remove"><i class="fa fa-times-circle"></i></a>';
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
    ProjectStorage.set("params", { name: name, overwrite: overwrite });

    withProjectStorage(function (restore) {
      editor.store(function (res) {
        hideLoader();
        restore();

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
      });
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
          ProjectStorage.set({ urlLoad: "/load/" + id });

          withProjectStorage(function (restore) {
            editor.load(function (res) {
              hideLoader();
              restore();

              if (!res || !Object.keys(res).length) {
                $.alert("That project could not be found");
                return;
              }
              if (res.error) {
                $.alert(res.error);
                return;
              }
              $.alert("Loaded successfully");
              modal.close();
            });
          });
        },
        cancel: function () {
          hideLoader();
        },
      },
    });
  };

  // ---- preview hand-off --------------------------------------------------
  editor.on("run:preview", function () {
    editor.DomComponents.getWrapper().onAll(function (comp) {
      comp.set({ editable: false, draggable: false });
    });

    // Hand the current canvas to the preview tab, which reads it back from
    // /show/preview.
    //
    // With local storage `editor.store(cb)` hands the callback nothing -- the
    // data is the return value, and its keys come back unprefixed. The preview
    // page asks for them under the "gjs-" prefix, so add it here.
    var data = editor.store() || {};
    var project = {};
    Object.keys(data).forEach(function (key) {
      project["gjs-" + key] = data[key];
    });

    $.ajax({
      type: "POST",
      url: "/save/preview",
      contentType: "application/json",
      data: JSON.stringify({ project: project }),
    }).fail(function (jqXHR) {
      console.log("Could not hand off preview", jqXHR);
    });
  });

  editor.on("stop:preview", function () {
    editor.DomComponents.getWrapper().onAll(function (comp) {
      comp.set({ editable: true, draggable: true });
    });
  });

  // ---- panel buttons -----------------------------------------------------
  pn.addButton("options", {
    id: "open-save",
    className: "fa fa-download",
    command: function () {
      editor.runCommand("open-projects", { type: "Save" });
    },
    attributes: { title: "Save project", "data-tooltip-pos": "bottom" },
  });

  pn.addButton("options", {
    id: "open-load",
    className: "fa fa-upload",
    command: function () {
      editor.runCommand("open-projects", { type: "Load" });
    },
    attributes: { title: "Load project", "data-tooltip-pos": "bottom" },
  });

  pn.addButton("options", {
    id: "open-info",
    className: "fa fa-question-circle",
    command: function () {
      setModal("About", "info-panel");
    },
    attributes: { title: "About", "data-tooltip-pos": "bottom" },
  });

  var IPLabel = pn.addButton("devices-c", {
    id: "ipButton",
    className: "someClass",
    label: "Server IP: " + ipServer,
    command: null,
    attributes: { title: "Point other devices at this address" },
    active: false,
    disable: true,
  });
  IPLabel.set("label", "Server IP: " + ipServer);

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

  // Keep the custom-code and import modals from getting stuck open.
  ["custom-code:open-modal", "gjs-open-import-webpage"].forEach(function (cmd) {
    editor.on("run:" + cmd, function () {
      editor.once("modal:close", function () {
        if (editor.Commands.isActive(cmd)) editor.Commands.stop(cmd);
      });
    });
  });
}
