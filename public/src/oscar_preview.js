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
    storageManager: {
      id: "gjs-",
      type: "remote",
      urlLoad: "/show/preview",
      contentTypeJson: true,
      autosave: false,
      autoload: false,
    },
    plugins: ["oscar_socket", "oscar_ip", "oscar_button", "oscar_slider", "grapesjs-touch"],
    pluginsOpts: {
      oscar_socket: { ipserver: ipServer },
      oscar_slider: { ipserver: ipServer },
      oscar_button: { ipserver: ipServer },
    },
  });

  // A preview is for driving the show, not editing it: lock everything down
  // once the project has loaded.
  editor.on("storage:end:load", function () {
    var lock = function (model) {
      model.set({
        editable: false,
        selectable: false,
        hoverable: false,
        draggable: false,
      });
      model.get("components").each(lock);
    };
    lock(editor.DomComponents.getWrapper());
  });

  editor.Commands.add("production", {
    run: function () {
      var cmdVis = "sw-visibility";
      if (!this.shouldRunSwVisibility) {
        this.shouldRunSwVisibility = editor.Commands.isActive(cmdVis);
      }
      this.shouldRunSwVisibility && editor.stopCommand(cmdVis);
      editor.getModel().stopDefault();

      var panels = editor.Panels.getPanels();
      var canvas = editor.Canvas.getElement();

      // Make every widget clickable: in edit mode grapesjs disables pointer
      // events on some elements, which would swallow OSC triggers.
      var pfx = editor.Config.stylePrefix || "gjs-";
      var body = editor.Canvas.getBody();
      var blocked = body.querySelectorAll("." + pfx + "no-pointer");
      Array.prototype.forEach.call(blocked, function (item) {
        item.style.pointerEvents = "all";
      });

      panels.forEach(function (panel) {
        editor.Panels.removePanel(panel.get("id"));
      });

      var style = canvas.style;
      style.width = "100%";
      style.height = "100%";
      style.top = "0";
      style.left = "0";
      style.padding = "0";
      style.margin = "0";
      editor.refresh();
    },
    stop: function () {},
  });

  editor.load(function () {
    editor.runCommand("production");
  });
}
