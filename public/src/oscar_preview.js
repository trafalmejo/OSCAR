window.$ = window.jQuery = require("jquery");

// Every widget in lib/widgets/registry.js, wired to GrapesJS by the adapter.
var { widgetPlugins } = require("./adapters/grapesjs");

// Tabs, and the rule for staying on a page across a push; shared with the
// editor so its preview draws the same thing the tablet does.
var oscarPages = require("./pages");

var editor;
var tabs = null;

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
      // `surface`: this page is a device showing the layout, so it agrees with
      // the others on what each widget shows. The editor never sets it.
      oscar_socket: { ipserver: ipServer, socketPort: socketPort, surface: true },
    },
  });

  tabs = oscarPages.pageTabs(editor, {
    bar: document.getElementById("oscar-page-bar"),
    body: document.body,
  });

  // Pages.select brings the next page in with its components unlocked: the
  // lock was set on the components of the page that was showing, and these
  // are not those. On every switch, whoever asked for it -- a tab, or the
  // reselect after a push -- the page that came in is locked before anyone
  // can put a finger on it.
  editor.on("page:select", function () {
    lockDown();
    // The rig's word on a widget is recorded by the server but told to no
    // device, since every device showing that widget heard the rig itself
    // (lib/shared-sync.js). A device that was on another page did not, so
    // what it has cached for the page coming in may be behind. Ask again.
    if (editor.syncSharedState) editor.syncSharedState();
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

      // A push mid-show must not throw whoever is driving back to page one.
      var wasOn = oscarPages.currentPageId(editor.Pages);

      editor.loadProjectData(data);
      oscarPages.reselect(editor.Pages, wasOn);

      // Locked here as well as on page:select: a project that opens on the
      // page it was already on selects nothing.
      lockDown();
      tabs.show();
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
 * Only the page on the canvas is reached: getWrapper() is that page's, and
 * the components of the others are locked as each is switched to.
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
