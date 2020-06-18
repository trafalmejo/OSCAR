window.$ = window.jQuery = require("jquery");
var localIPpromise = require("binternalip");
//var localIPpromise = require('./webRTC.js');
var ipLibrary = require("ip");
var editor;
var ipServer = "localhost";

$.get("/ipserver", function (data, status) {
  ipServer = data;
  initGrape();
  runPreview();
});

function runPreview() {
  //Bug
  editor.runCommand("production");
}

function initGrape() {
  editor = grapesjs.init({
    height: "100%",
    container: "#gjs-oscar-preview",
    allowScripts: 1,
    panels: { defaults: [] },
    canvas: { styles: ["assets/css/toggle.css"] },
    // Default configurations
    storageManager: {
      id: "gjs-", // Prefix identifier that will be used on parameters
      //type: 'local',          // Type of the storage
      //type: null,          // Type of the storage
      type: "remote", // Type of the storage
      //stepsBeforeSave: 1,     // If autosave enabled, indicates how many changes are necessary before store method is triggered
      //urlStore: 'http://'+ipServer+':8080/store',
      urlLoad: "http://" + ipServer + ":8080/load",
    },
    // TO READ: this plugin loads default blocks
    plugins: [
      "oscar_socket",
      "oscar_ip",
      "oscar_button",
      "oscar_slider",
      "grapesjs-touch",
    ],
    pluginsOpts: {
      oscar_socket: {
        ipserver: ipServer,
      },
      oscar_slider: {
        ipserver: ipServer,
      },
      oscar_button: {
        ipserver: ipServer,
      },
    },
  });
  //END EDITOR INIT
  editor.on("storage:end:load", () => {
    const updateAll = (model) => {
      model.set({
        editable: false,
        selectable: false,
        hoverable: false,
        draggable: false,
      });
      model.get("components").each((model) => updateAll(model));
    };
    updateAll(editor.DomComponents.getWrapper());
  });
  // editor.on("stop:preview", () => {
  //   // Execute a callback on all inner components starting from the root
  //   editor.runCommand("preview");
  // });
  const RemoteStorage = editor.StorageManager.get("remote").set({
    id: "gjs-", // Prefix identifier that will be used on parameters
    //type: 'local',          // Type of the storage
    //type: null,          // Type of the storage
    type: "remote", // Type of the storage
    stepsBeforeSave: 1, // If autosave enabled, indicates how many changes are necessary before store method is triggered
    urlStore: "http://" + ipServer + ":8080/save",
    urlLoad: "http://" + ipServer + ":8080/show/preview",
    autosave: false, // Store data automatically
    autoload: false, // Autoload stored data on init
    contentTypeJson: true,
  });
  editor.StorageManager.setCurrent("remote");

  editor.load((res) => {
    console.log("res: " + res);
  });
  editor.Commands.add("production", {
    run() {
      // production mode ON
      //this.sender = sender;
      const cmdVis = "sw-visibility";
      if (!this.shouldRunSwVisibility) {
        this.shouldRunSwVisibility = editor.Commands.isActive(cmdVis);
      }

      this.shouldRunSwVisibility && editor.stopCommand(cmdVis);
      editor.getModel().stopDefault();

      const panels = editor.Panels.getPanels();
      const canvas = editor.Canvas.getElement();
      const editorEl = editor.getEl();
      const pfx = editor.Config.stylePrefix;

      if (!this.helper) {
        const helper = document.createElement("span");
        helper.className = `${pfx}off-prv fa fa-eye-slash`;
        editorEl.appendChild(helper);
        helper.onclick = () => this.stopCommand();
        this.helper = helper;
      }

      this.helper.style.display = "inline-block";
      const body = editor.Canvas.getBody();
      const elP = body.querySelectorAll(`.${this.ppfx}no-pointer`);
      elP.forEach((item) => (item.style.pointerEvents = val ? "" : "all"));

      panels.forEach((panel) => panel.set("visible", false));
      panels.forEach((panel) => console.log(panel.get("id")));
      panels.forEach((panel) => console.log(panel));
      panels.forEach((panel) => editor.Panels.removePanel(panel.get("id")));

      const canvasS = canvas.style;
      canvasS.width = "100%";
      canvasS.height = "100%";
      canvasS.top = "0";
      canvasS.left = "0";
      canvasS.padding = "0";
      canvasS.margin = "0";
      editor.refresh();
    },
    stop() {
      // production mode OFF
    },
  });
  editor.runCommand("production");
}
