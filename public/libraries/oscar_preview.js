window.$ = window.jQuery = require('jquery');
var localIPpromise = require('binternalip');
//var localIPpromise = require('./webRTC.js');
var ipLibrary = require('ip');
var editor;
var ipServer = "localhost";

$.get("/ipserver", function(data, status){
  console.log("jquery: ", data);
  ipServer = data;
  initGrape();
  runPreview();
  //uneditable();
  
});
function uneditable(){
  console.log("uneditable")
  editor.DomComponents.getWrapper().onAll(comp => 
		comp.set({ editable: false, draggable: false })
  );
}
function runPreview(){
  editor.runCommand('preview');
}

function initGrape(){
editor =  grapesjs.init({
 // domComponents: { storeWrapper: 1 },
  //dragMode: 'absolute',
  height: '100%',
  container: '#gjs-oscar-preview',
  //fromElement: true,
  allowScripts: 1,
  showOffsets: false,
  showOffsetsSelected: false,

  canvas: { styles: ['assets/css/toggle.css'] },
  // Default configurations
  storageManager: {
    id: 'gjs-',             // Prefix identifier that will be used on parameters
    //type: 'local',          // Type of the storage
    //type: null,          // Type of the storage
    type: 'remote',          // Type of the storage
    stepsBeforeSave: 3,     // If autosave enabled, indicates how many changes are necessary before store method is triggered
    urlStore: 'http://'+ipServer+':8080/store',
    urlLoad: 'http://'+ipServer+':8080/load',

  },
  // TO READ: this plugin loads default blocks
  plugins: ['oscar_socket', 'oscar_ip', 'oscar_button', 'oscar_slider', 'gjs-preset-webpage', 'grapesjs-custom-code', 'grapesjs-parser-postcss', 'grapesjs-touch'],
  pluginsOpts: {
    'oscar_socket' : {
      ipserver: ipServer,
    },
    'oscar_slider' : {
      ipserver: ipServer,
    },
    'oscar_button': {
      ipserver: ipServer,
    },
    'gjs-preset-webpage': {
      blocks: [],
      formsOpts: false,
      navbarOpts: false,
      countdownOpts: false,
      showStylesOnChange: true,
      modalImportTitle: 'Import Template',
      modalImportLabel: '<div style="margin-bottom: 10px; font-size: 13px;">Paste here your HTML/CSS and click Import</div>',
      modalImportContent: function (editor) {
        return editor.getHtml() + '<style>' + editor.getCss() + '</style>'
      }
    },
  }
});
//END EDITOR INIT
editor.on('stop:preview', () => {
  // Execute a callback on all inner components starting from the root
  editor.runCommand('preview');
});

editor.on('load', function()
{
    // const updateAll = model => {
    //     model.set({editable: false,selectable:false,hoverable:false});
    //     model.get('components').each(model => updateAll(model));
    // }
    // updateAll(editor.DomComponents.getWrapper());
});

}

