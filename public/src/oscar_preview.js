window.$ = window.jQuery = require("jquery");

// The same module the server uses, so the label an unnamed page is given here
// is the one the file on disk carries.
var projectFormat = require("../../lib/project-format");

var oscarButton = require("./oscar_button");
var oscarSlider = require("./oscar_slider");
var oscarXypad = require("./oscar_xypad");

var editor;

/** Hand a widget plugin the address other devices should send to. */
function withIp(plugin, ipServer) {
  return function (ed) {
    plugin(ed, { ipserver: ipServer });
  };
}

// One browserify bundle serves both the editor and the preview page, so each
// entry point only boots when its own container is on the page.
if (document.getElementById("gjs-oscar-preview")) {
  // Ask the server which address it is reachable on, so widgets default to
  // something other devices on the network can actually talk to.
  fetch("/connection")
    .then(function (res) {
      return res.json();
    })
    .catch(function () {
      return {};
    })
    .then(function (conn) {
      initGrape(conn.address || window.location.hostname || "localhost", conn.socketPort || 8081);
    });
}

function initGrape(ipServer, socketPort) {
  editor = grapesjs.init({
    height: "100%",
    container: "#gjs-oscar-preview",
    allowScripts: 1,
    panels: { defaults: [] },
    canvas: { styles: ["assets/css/toggle.css"] },
    // The preview only displays whatever the editor handed over; it must never
    // write into the editor's autosave.
    storageManager: false,
    plugins: [
      "oscar_socket",
      "oscar_ip",
      withIp(oscarButton, ipServer),
      withIp(oscarSlider, ipServer),
      withIp(oscarXypad, ipServer),
      "grapesjs-touch",
    ],
    pluginsOpts: {
      oscar_socket: { ipserver: ipServer, socketPort: socketPort },
    },
  });

  editor.on("load", function () {
    showLatest();

    // The editor's "Push to preview" button tells the server, which tells
    // every open preview page. Without this a tablet keeps showing the
    // previous push until someone walks over and reloads it.
    if (editor.socket) {
      editor.socket.on("preview:updated", showLatest);
    }
  });
}

/** Fetch whatever was last pushed and display it, ready to drive a show. */
function showLatest() {
  return fetch("/show/preview")
    .then(function (res) {
      return res.json();
    })
    .then(function (data) {
      // loadProjectData tears down the current page before reading the new
      // one, so only hand it something shaped like a GrapesJS project.
      if (!data || !Array.isArray(data.pages) || !data.pages.length) return;

      // A push mid-show should not throw whoever is driving back to page one.
      var wasOn = editor.Pages.getSelected();
      wasOn = wasOn && wasOn.getId();

      editor.loadProjectData(data);

      if (wasOn && editor.Pages.get(wasOn)) editor.Pages.select(wasOn);

      lockDown();
      renderPageBar();
    })
    .catch(function (err) {
      console.log("Could not load the preview", err);
    });
}

/**
 * A preview is for driving the show, not editing it.
 *
 * Safe to set on the components here, unlike in the editor: this page never
 * saves anything (storageManager is off), so none of it can reach a file.
 *
 * Only the page on the canvas is locked, because only its components exist as
 * views; every page is locked again as it is switched to.
 */
function lockDown() {
  editor.getWrapper().onAll(function (component) {
    component.set({
      editable: false,
      selectable: false,
      hoverable: false,
      draggable: false,
      highlightable: false,
    });
  });

  // GrapesJS's own preview mode hides the panels and makes the canvas full
  // size. Its "exit preview" button is hidden in preview.ejs.
  if (!editor.Commands.isActive("preview")) editor.runCommand("preview");
}

// ---- page switcher ---------------------------------------------------------
// Tabs along the bottom of the surface, deliberately outside the GrapesJS
// canvas: nothing in the canvas survives the lock above with its events
// intact, and a tab drawn as a component could be dragged or deleted by
// whoever edits the project next.

var BAR_HEIGHT = 56; // keep in step with .oscar-page-bar in css/oscar_pages.css

function pageBar() {
  var bar = document.getElementById("oscar-page-bar");
  if (bar) return bar;

  bar = document.createElement("div");
  bar.id = "oscar-page-bar";
  bar.className = "oscar-page-bar";
  document.body.appendChild(bar);
  return bar;
}

function showPage(id) {
  var page = editor.Pages.get(id);
  if (!page) return;

  editor.Pages.select(page);
  // The components of the page now on screen have never been locked.
  lockDown();
  renderPageBar();
}

function renderPageBar() {
  var bar = pageBar();
  var all = editor.Pages.getAll();
  var el = editor.getEl();

  // A single-page surface gets no tabs at all -- they would only take away
  // room from the controls.
  bar.innerHTML = "";

  if (all.length < 2) {
    bar.style.display = "none";
    if (el) el.style.height = "";
    return;
  }

  var selected = editor.Pages.getSelected();
  bar.style.display = "";

  all.forEach(function (page, index) {
    var tab = document.createElement("button");
    tab.type = "button";
    tab.className = "oscar-page-tab";
    if (selected && selected.getId() === page.getId()) {
      tab.className += " oscar-page-tab-current";
    }
    tab.textContent = page.getName() || projectFormat.defaultPageName(index);
    tab.onclick = function () {
      showPage(page.getId());
    };
    bar.appendChild(tab);
  });

  // Shorten the canvas rather than float the tabs over it: a bar sitting on
  // top of the bottom row of a surface would hide controls mid-show.
  if (el) el.style.height = "calc(100% - " + BAR_HEIGHT + "px)";
}
