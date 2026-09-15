window.$ = window.jQuery = require("jquery");

// Every widget in lib/widgets/registry.js, wired to GrapesJS by the adapter.
var { widgetPlugins } = require("./adapters/grapesjs");

var editor;

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
      ...widgetPlugins(ipServer),
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

      editor.loadProjectData(data);
      lockDown();
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
