window.$ = window.jQuery = require("jquery");

var editor;

// One browserify bundle serves both the editor and the preview page, so each
// entry point only boots when its own container is on the page.
if (document.getElementById("gjs-oscar-preview")) {
  // Ask the server which address it is reachable on, so widgets default to
  // something other devices on the network can actually talk to.
  $.get("/ipserver", function (data) {
    initGrape(data || window.location.hostname || "localhost");
  });
}

function initGrape(ipServer) {
  editor = grapesjs.init({
    height: "100%",
    container: "#gjs-oscar-preview",
    allowScripts: 1,
    panels: { defaults: [] },
    canvas: { styles: ["assets/css/toggle.css"] },
    // The preview only displays whatever the editor handed over; it must never
    // write into the editor's autosave.
    storageManager: false,
    plugins: ["oscar_socket", "oscar_ip", "oscar_button", "oscar_slider", "grapesjs-touch"],
    pluginsOpts: {
      oscar_socket: { ipserver: ipServer },
      oscar_slider: { ipserver: ipServer },
      oscar_button: { ipserver: ipServer },
    },
  });

  editor.on("load", function () {
    fetch("/show/preview")
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        // loadProjectData tears down the current page before reading the new
        // one, so only hand it something shaped like a GrapesJS project.
        if (data && Array.isArray(data.pages) && data.pages.length) {
          editor.loadProjectData(data);
        }

        // A preview is for driving the show, not editing it.
        editor.getWrapper().onAll(function (component) {
          component.set({
            editable: false,
            selectable: false,
            hoverable: false,
            draggable: false,
            highlightable: false,
          });
        });

        // GrapesJS's own preview mode hides the panels and makes the canvas
        // full size. Its "exit preview" button is hidden in preview.ejs.
        editor.runCommand("preview");
      })
      .catch(function (err) {
        console.log("Could not load the preview", err);
      });
  });
}
