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
  //alert("Data: " + data + "\nStatus: " + status);
});

// fetch('/ipserver')
// 	  .then(function(response) {
// 		return response.text();
// 	  })
// 	  .then(function(ip) {
// 		console.log('Request successful', ip);
//     ipServer = ip;
// })
// .catch(function(error) {
// console.log('Request failed', error)
// });
function initGrape(){
editor =  grapesjs.init({
 // domComponents: { storeWrapper: 1 },
  //dragMode: 'absolute',
  height: '100%',
  container: '#gjs',
  fromElement: true,
  allowScripts: 1,
  canvas: { styles: ['assets/css/toggle.css'] },
  panels: {

  },
  assetManager: {
    assets: [
      'images/fruits/emoji-apple.png',
      'images/fruits/emoji-apple-click.png',
      'images/fruits/emoji-orange.png',
      'images/fruits/emoji-orange-click.png',
      'images/fruits/emoji-banana.png',
      'images/fruits/emoji-banana-click.png',
      'images/fruits/background.png',
      // Pass an object with your properties
      {
        type: 'image',
        src: 'http://placehold.it/350x250/459ba8/fff/image2.jpg',
        height: 350,
        width: 250
      },
      {
        type: 'image',
        src: 'http://placehold.it/350x250/78c5d6/fff/image1.jpg',
        height: 200,
        width: 200
      },
      {
        // As the 'image' is the base type of assets, omitting it will
        // be set as `image` by default
        src: 'http://placehold.it/350x250/79c267/fff/image3.jpg',
        height: 350,
        width: 250
      },
    ],
  },
  //Just draw on set of style options
  styleManager: {},
  // Configurations for Block Manager
  blockManager: {},
  traitManager: {
  },
  //Persistance
  // Default configurations
  storageManager: {
    id: 'gjs-',             // Prefix identifier that will be used on parameters
    //type: 'local',          // Type of the storage
    //type: null,          // Type of the storage
    type: 'remote',          // Type of the storage
    stepsBeforeSave: 3,     // If autosave enabled, indicates how many changes are necessary before store method is triggered
    urlStore: 'http://'+ipServer+':8080/store',
    urlLoad: 'http://'+ipServer+':8080/load',
    //autosave: true,         // Store data automatically
    //autoload: true,         // Autoload stored data on init
    // For custom parameters/headers on requests
    // params: { _some_token: '....' },
    // headers: { Authorization: 'Basic ...' }, 
    // //Enable/Disable components model (JSON format)
    //storeComponents: 1,
    // //Enable/Disable styles model (JSON format)
    // storeStyles: 1,
    // //Enable/Disable saving HTML template
    // storeHtml: 1,
    // //Enable/Disable saving CSS template
    // storeCss: 1,
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


//EVENT WHEN THE EDITOR IS LOADED
editor.on('load', function (edit) {
  console.log('Model was loaded, Editor:', edit);
  //jquery doesnot work in electron
  //jQuery.get( "dom", function(data, textStatus, jqXHR){
    // alert('status: ' + textStatus + ', data:' + data);
    //editor.setComponents(data);
  //})

});
//Event is trigger for every loaded component
editor.on('storage:load', function (editor) {
  console.log("Loading...")
});
editor.on('storage:store', function (editor) {
  console.log("Storing...")
});
editor.on('component:add', function (model) {

});
editor.on('component:remove', function (model) {

});
//UPDATE TRAITS
editor.on("component:update", function (component) {

})

//EXAMPLE OF SHORT FUNCTION
editor.on('block:drag:stop', model => console.log('dropped ', model))

//FIXES MODAL FOR CUSTOM CODE PLUGIN
editor.on('run:custom-code:open-modal', () =>
  editor.once('modal:close', () => {
    const { Commands } = editor;
    if (Commands.isActive('custom-code:open-modal')) {
      Commands.stop('custom-code:open-modal');
    }
  }),
);
const storageManager = editor.StorageManager;

//Turn OFF editable mode on Preview
editor.on('run:preview', () => {
  // Execute a callback on all inner components starting from the root
  console.log("Run Preview Mode")
  console.log("JS: ", editor.getJs())
  var res = editor.store(res => console.log('Store callback'));
  console.log("res: ", res);
	editor.DomComponents.getWrapper().onAll(comp => 
		comp.set({ editable: false, draggable: false })
  );
  const domComponents = editor.DomComponents;
  //var code = editor.getComponents();
  var code = domComponents.getComponents();
  console.log("Components: ", code.models)
  editor.socket.emit('code', code);
  //editor.DomComponents = code
});

//Turn ON editable mode on Preview
editor.on('stop:preview', () => {
  // Execute a callback on all inner components starting from the root
  console.log("Stop Preview Mode")
	editor.DomComponents.getWrapper().onAll(comp => 
		comp.set({ editable: true,  draggable: true })
	);
});


//FIXES MODAL FOR IMPORT HTML CODE
editor.on('run:gjs-open-import-webpage', () =>
  editor.once('modal:close', () => {
    const { Commands } = editor;
    if (Commands.isActive('gjs-open-import-webpage')) {
      Commands.stop('gjs-open-import-webpage');
    }
  }),
);

// Add and beautify tooltips

var pn = editor.Panels;
var modal = editor.Modal;
var commands = editor.Commands;

console.log("Commands: ", commands.getAll())

// Add info command
var mdlClass = 'gjs-mdl-dialog-sm';
var infoContainer = document.getElementById('info-panel');
commands.add('open-info', function () {
  var mdlDialog = document.querySelector('.gjs-mdl-dialog');
  mdlDialog.className += ' ' + mdlClass;
  infoContainer.style.display = 'block';
  modal.setTitle('About this demo');
  modal.setContent(infoContainer);
  modal.open();
  modal.getModel().once('change:open', function () {
    mdlDialog.className = mdlDialog.className.replace(mdlClass, '');
  })
});

pn.addButton('options', {
  id: 'open-info',
  className: 'fa fa-question-circle',
  command: function () { editor.runCommand('open-info') },
  attributes: {
    'title': 'About',
    'data-tooltip-pos': 'bottom',
  },
});

var ipButton = pn.addButton('devices-c', {
  id: 'ipButton',
  className: 'someClass',
  label: "IP: ",
  command: null,
  attributes: { title: 'Some title' },
  active: false,
  disable: true,
});


var IPLabel = pn.getButton('devices-c', 'ipButton');
getipServer(); 
function getipServer(){
     IPLabel.set("label", "Server IP: " + editor.ipserver);
}
// function getipServer(){
// fetch('/ipserver')
//   .then(function(response) {
//     return response.text();
//   })
//   .then(function(ip) {
//     editor.ipserver = ip
//     IPLabel.set("label", "Server IP: " + editor.ipserver);
//     console.log("Socket: ", editor.ipserver)
//   })
//   .catch(function(error) {
//     console.log('Request failed', error)
//   });
// }



//Default value of editor.ip is localhost
editor.ip  = "localhost"

var promise = localIPpromise.then((ipAddr) => {
  var ipv4 = "";
  for (let i = 0; i < ipAddr.length; i++) {
    if(ipLibrary.isV4Format(ipAddr[i])){
      ipv4 = ipAddr[i];
      console.log("Promise solved: ", ipAddr)
      //IPLabel.set("label", "Client IP" + ipAddr);
      editor.ip = ipAddr;
    }
  }
  if(editor.ip == "" || !ipLibrary.isV4Format(editor.ip) ){
    //console.log("editor.ip is empty")
    editor.ip  = "localhost"
    //IPLabel.set("label", "Client IP: " + editor.ip);
  }
})

localIPpromise.catch(error => { 
  console.log("Error: ", error);
  editor.ip = "localhost"
  IPLabel.set("label", "IP: " + editor.ip);
});

console.log("Panels: ", pn.getPanels());

console.log("Button for tooltp: ", pn.getButton('options', 'export-template', 'Export'));
// Add and beautify tooltips
[['sw-visibility', 'Show Borders'], ['preview', 'Preview'], ['fullscreen', 'Fullscreen'],
['export-template', 'Export'], ['undo', 'Undo'], ['redo', 'Redo'],
['gjs-open-import-webpage', 'Import'], ['canvas-clear', 'Clear canvas', 'open-info', 'About']]
  .forEach(function (item) {
    pn.getButton('options', item[0]).set('attributes', { title: item[1], 'data-tooltip-pos': 'bottom' });
  });
[['open-sm', 'Style Manager'], ['open-tm', 'Settings'], ['open-layers', 'Layers'], ['open-blocks', 'Blocks']]
  .forEach(function (item) {
    pn.getButton('views', item[0]).set('attributes', { title: item[1], 'data-tooltip-pos': 'bottom' });
  });
var titles = document.querySelectorAll('*[title]');

for (var i = 0; i < titles.length; i++) {
  var el = titles[i];
  var title = el.getAttribute('title');
  title = title ? title.trim() : '';
  if (!title)
    break;
  el.setAttribute('data-tooltip', title);
  el.setAttribute('title', '');
}

}
