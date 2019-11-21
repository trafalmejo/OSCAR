(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
function oscar_button(editor) {
  var comps = editor.DomComponents;
  var dType = comps.getType('default');
  var dModel = dType.model;
  var dView = dType.view;

  //BUTTON type
  comps.addType('button', {
    // Define the Model
    model: dModel.extend({
      defaults: Object.assign({}, dModel.prototype.defaults, {
        // Can't drop other elements inside it
        tagName: 'button',
        attributes: { // Default attributes
          // type: 'button',
          name: 'button_oscar',
        },
        components: [{
          type: 'textnode',
          content: 'Insert here your text'
        }],
        droppable: false,
        resizable: true,
        editable: true,
        // // Traits (Settings)
        ip: 'localhost',
        port: 10000,
        message: '/push1',
        max: '1',
        toggle: false,
        value: false,
        traits: [
          {
            type: 'text',
            label: 'Ip',
            name: 'ip',
            changeProp: 1,
          },
          {
            type: 'text',
            label: 'Port',
            name: 'port',
            changeProp: 1,
          },
          {
            type: 'text',
            label: 'Message',
            name: 'message',
            changeProp: 1,
          },
          {
            type: 'text',
            label: 'Max',
            name: 'max',
            changeProp: 1,
          },
          {
            type: 'checkbox',
            label: 'Toggle Button',
            name: 'toggle',
            changeProp: 1,
        }
        ],
      }
      ),
      //init is inside the model
      init() {
        this.on('change:port', this.changePort);
        this.on('change:ip', this.changeIP);
        this.on('change:max', this.changeMax);
        this.on('change:message', this.changeMessage);
        this.on('change:toggle', this.changeToggle);
      },
      changeIP() {
        console.log("IP Changed in component: ", this)
        var newIP = this.get('ip');
        if (newIP == 'localhost' || this.validateIPaddress(newIP)) {
          this.set({ ip: newIP })
          editor.socket.emit('config', {
            server: { port: 4000, host: config.ip },
            client: { port: this.get('port'), host: newIP }
          });
        } else {
          alert("Your IP is incorrect: " + this.attributes.ip);
          this.set({ ip: this._previousAttributes.ip })
        }
      },
      changePort() {
        console.log("Port Changed in component: ", this);
        var newPort = this.get('port');
        //If it is a number
        if (!isNaN(parseInt(newPort))) {
          this.set({ port: newPort })
          editor.socket.emit('config', {
            server: { port: 4000, host: config.ip },
            client: { port: newPort, host: this.get('ip') }
          });
        } else {
          alert("Your port is incorrect");
          this.set({ port: this._previousAttributes.port })
        }
      },

      changeMessage() {
        console.log("Message Changed in Component:", this)
        var newMessage = this.get("message")
        this.set({ message: newMessage })
      },
      changeMax() {
        console.log("Max Changed in Component: ", this)
        var newMax = this.get('max');
        if (!isNaN(parseInt(newMax))) {
          this.set({ max: newMax })
        } else {
          alert("Your max is incorrect. It should be an integer value");
          this.set({ max: this._previousAttributes.max })
        }
      },
      changeToggle() {
        console.log("Toggle Changed in Component: ", this)
        var newToggle = this.get('toggle');
      },

      validateIPaddress(ipaddress) {
        if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ipaddress)) {
          return (true)
        }
        return (false)
      }

    },
      // The second argument of .extend are static methods and we'll put inside our
      // isComponent() method. As you're putting a new Component type on top of the stack,
      // not declaring isComponent() might probably break stuff, especially if you extend
      // the default one.
      {
        isComponent: function (el) {
          if (el.tagName == 'BUTTON') {
            //type text gives you text edit capabilities
            console.log("IS MEGA BUTTOON")
            return { type: 'button' };
          }
        },
      }),
    view: dView.extend({
      // Bind events
      events: {
        // If you want to bind the event to children elements
        // 'click .someChildrenClass': 'methodName',
        //     dblclick: 'onActive',
        //     click: 'initResize',
        //     error: 'onError',
        //     dragstart: 'noDrag',
        //     mousedown: 'noDrag'
        click: 'handleClick',
        //mouseup: 'release',
      },
      handleClick: function (e) {
        console.log("Click Event Owner: ", this);
        var message = this.model.get("message");
        var ip = this.model.get("ip");
        var port = this.model.get("port");
        if (this.model.get("toggle")) {
          if (this.model.get("value")) {
            console.log("Push");
            this.model.addClass("toggle");
            editor.socket.emit('message', editor.ip, ip, port, message, "f", this.model.get("max"));
          } else {
            console.log("Unpush");
            this.model.removeClass("toggle");
            editor.socket.emit('message', editor.ip, ip, port, message, "f", 0.000);
          }
          this.model.set({value : !this.model.get("value")})
        }
        else {
          console.log("HTML: ", this.model.toHTML())
          editor.socket.emit('message', editor.ip, ip, port,  message, "f", this.model.get("max"));
          setTimeout(function () { editor.socket.emit('message', editor.ip,  ip, port, message, "f", 0.000); }, 250);
        }
        //this.model.set('style', {color: this.randomHex()}); // <- Affects the final HTML code
        //this.el.style.backgroundColor = this.randomHex(); // <- Doesn't affect the final HTML code
        // Tip: updating the model will reflect the changes to the view, so, in this case,
        // if you put the model change after the DOM one this will override the backgroundColor
        // change made before
      },
      release: function (e) {
        console.log('Release Event Owner: ', this);
        var message = this.model.get("message");
        //editor.socket.emit('message', this.model.get("ip"), this.model.get("port"), message, "f", 0.000);
      },
      // The render() should return 'this'
      render: function () {
        // Extend the original render method
        dView.prototype.render.apply(this, arguments);
        return this;
      },
    }),
  });

  //Add Block to Manager
  editor.BlockManager.add('button', {
    label: 'Button',
    attributes: { class: 'fa fa-square' },
    category: 'Basic',
    content: {
      type: 'button', // OSCAR component
      //script: "alert('Hi'); console.log('the element', this)",
    }
  })
}


},{}],2:[function(require,module,exports){
var localIPpromise = require('binternalip');

var editor = grapesjs.init({
 // domComponents: { storeWrapper: 1 },
  // dragMode: 'absolute',
  height: '100%',
  container: '#gjs',
  fromElement: true,
  allowScripts: 1,
  canvas: { styles: ['assets/css/toggle.css', 'node_modules/bootstrap/dist/css/bootstrap.min.css'] },
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
    type: 'local',          // Type of the storage
    //type: null,          // Type of the storage
    autosave: true,         // Store data automatically
    autoload: true,         // Autoload stored data on init
    stepsBeforeSave: 0,     // If autosave enabled, indicates how many changes are necessary before store method is triggered
    //Enable/Disable components model (JSON format)
    storeComponents: 1,
    //Enable/Disable styles model (JSON format)
    storeStyles: 1,
    //Enable/Disable saving HTML template
    storeHtml: 1,
    //Enable/Disable saving CSS template
    storeCss: 1,
  },
  // TO READ: this plugin loads default blocks
  plugins: [oscar_socket, oscar_ip, oscar_button, oscar_slider, 'gjs-preset-webpage', 'grapesjs-custom-code', 'grapesjs-parser-postcss', 'grapesjs-touch'],
  pluginsOpts: {
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

// Get DomComponents module
var comps = editor.DomComponents;
// Get the model and the view from the default Component type
var dType = comps.getType('default');
var dModel = dType.model;
var dView = dType.view;

//EVENT WHEN THE EDITOR IS LOADED
editor.on('load', function (edit) {
  console.log('Model was loaded, Editor:', edit);
  jQuery.get( "dom", function(data, textStatus, jqXHR){
    // alert('status: ' + textStatus + ', data:' + data);
    editor.setComponents(data);
  })

});
//Event is trigger for every loaded component
editor.on('storage:load', function (editor) {
  jQuery.get("/dom", function(data, textStatus, jqXHR){
    //alert('status: ' + textStatus + ', data:' + data);
    
  })
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

//Preview was Clicked
editor.on('run:core:preview', () => {
  console.log("Preview was pressed")
  console.log("JS: ", editor.getJs())
  var code = editor.getHtml() + '<style>' + editor.getCss() + '</style>' + '<script>'+ editor.getJs() +'</script>';
  editor.DomComponents = comps;
  //var code = editor.getWrapper();
  //editor.socket.emit('code', code);
  //console.log("Code: ",  editor.getHtml() + '<style>'+editor.getCss()+'</style>')
}
);

//Turn OFF editable mode on Preview
editor.on('run:preview', () => {
  // Execute a callback on all inner components starting from the root
  console.log("Run Preview Mode")
	editor.DomComponents.getWrapper().onAll(comp => 
		comp.set({ editable: false, draggable: false })
	);
});
//Turn OFF editable mode on Preview
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

localIPpromise.then((ipAddr) => {
  var button = pn.getButton('devices-c', 'ipButton');
  console.log("Promise solved: ", ipAddr)
  button.set("label", "IP: " + ipAddr);
  editor.ip = ipAddr;
});
localIPpromise.catch(error => { 
  console.log("Error: ", error);
  editor.ip = "localhost"
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




},{"binternalip":5}],3:[function(require,module,exports){
function oscar_slider(editor) {
  var comps = editor.DomComponents;
  var dType = comps.getType('default');
  var dModel = dType.model;
  var dView = dType.view;

  //SLIDER type
  comps.addType('input', {
    // Define the Model
    model: dModel.extend({
      defaults: Object.assign({}, dModel.prototype.defaults, {
        // Can't drop other elements inside it
        droppable: false,
        resizable: true,
        editable: true,
        // // Traits (Settings)
        ip: 'localhost',
        port: 10000,
        message: '/slider1',
        min: 0,
        max: 100,
        value: 0,
        orient: "horizontal",
        orientation: false,
        invert: false,
        traits: [
          {
            type: 'text',
            label: 'Ip',
            name: 'ip',
            changeProp: 1,
          },
          {
            type: 'text',
            label: 'Port',
            name: 'port',
            changeProp: 1,
          },
          {
            type: 'text',
            label: 'Message',
            name: 'message',
            changeProp: 1,
          },
          {
            type: 'text',
            label: 'Min',
            name: 'min',
            changeProp: 1,
          },
          {
            type: 'text',
            label: 'Max',
            name: 'max',
            changeProp: 1,
          },
          {
            type: 'text',
            label: 'Value',
            name: 'value',
            changeProp: 1,
          },
          {
            type: 'select',
            label: 'Orientation',
            name: 'orientation',
            options:[
              { id: 'horizontal', name: 'Horizontal'},
              { id: 'vertical', name: 'Vertical'},
            ],
            changeProp: 1,
          },
          {
            type: 'checkbox',
            label: 'Invert',
            name: 'invert',
            changeProp: 1,
          },

        ],
      }),
      init() {
        this.on('change:ip', this.changeIP);
        this.on('change:port', this.changePort);
        this.on('change:message', this.changeMessage);
        this.on('change:max', this.changeMax);
        this.on('change:min', this.changeMin);
        this.on('change:value', this.changeValue);
        this.on('change:invert', this.changeInvert);
        this.on('change:orientation', this.changeOrientation);
      },
      changeIP() {
        console.log("IP Changed in component: ", this)
        var newIP = this.get('ip');
        if (newIP == 'localhost' || this.validateIPaddress(newIP)) {
          this.set({ ip: newIP })
          editor.socket.emit('config', {
            server: { port: 4000, host: config.ip },
            client: { port: this.get('port'), host: newIP }
          });
        } else {
          alert("Your IP is incorrect");
          this.set({ ip: this._previousAttributes.ip })
        }
      },
      changePort() {
        console.log("Port Changed in component: ", this);
        var newPort = this.get('port');
        //If it is a number
        if (!isNaN(parseInt(newPort))) {
          this.set({ port: newPort })
          editor.socket.emit('config', {
            server: { port: 4000, host: config.ip },
            client: { port: newPort, host: this.get('ip') }
          });
        } else {
          alert("Your port is incorrect");
          this.set({ port: this._previousAttributes.port })
        }
      },

      changeMessage() {
        console.log("Message Changed in Component:", this)
        var newMessage = this.get("message")
        this.set({ message: newMessage })
      },
      changeMin() {
        console.log("Min Changed in Component: ", this)
        var newMin = this.get('min');
        if (!isNaN(newMin)) {
          this.set({ min: newMin })
          this.addAttributes({ 'min': newMin });
        } else {
          alert("Your min is incorrect. It should be a number");
          this.set({ min: this._previousAttributes.min })
        }
      },
      changeMax() {
        console.log("Max Changed in Component: ", this)
        var newMax = this.get('max');
        if (!isNaN(newMax)) {
          this.set({ max: newMax })
          this.addAttributes({'max': newMax });
        } else {
          alert("Your max is incorrect. It must be a number");
          this.set({ max: this._previousAttributes.max })
        }
      },
      changeValue(){
        console.log("Value Changed in Component: ", this)
        var newValue = parseFloat(this.get('value'));
        if (newValue >= this.get("min") && newValue <= this.get("max")) {
          this.getEl().value = newValue;
        }
        else{
          alert("Your value must be a number, between the ranges")
          this.set({ value: this._previousAttributes.value })
        }
      },
      changeOrientation() {
        var newOrient = this.get('orientation');
        console.log("Orientation Changed in Component: ", this, newOrient)
        if (newOrient == "vertical") {
          this.set({orient : "vertical"})
        }
        else if(newOrient == "horizontal"){
          this.set({orient : "horizontal"})
        }
        this.addAttributes({'orient': this.get("orient") });
      },
      changeInvert(){
        console.log("Invert Changed in Component: ", this)
        var newInvert = this.get('invert')
      },
      validateIPaddress(ipaddress) {
        if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ipaddress)) {
          return (true)
        }
        return (false)
      }

    },
      // The second argument of .extend are static methods and we'll put inside our
      // isComponent() method. As you're putting a new Component type on top of the stack,
      // not declaring isComponent() might probably break stuff, especially if you extend
      // the default one.
      {
        isComponent: function (el) {
          if (el.tagName == 'INPUT') {
            //type text gives you text edit capabilities
            return { type: 'input' };
          }
        },
      }),
    view: dView.extend({
      // Bind events
      events: {
        // If you want to bind the event to children elements
        // 'click .someChildrenClass': 'methodName',
        //     dblclick: 'onActive',
        //     click: 'initResize',
        //     error: 'onError',
        //     dragstart: 'noDrag',
        //     mousedown: 'noDrag'
        //input: 'changeValue',
        input: 'changeValue',
      },

      changeValue: function (e) {
        console.log("e:", e);
        console.log("This: ", this);
        var message = this.model.get("message");
        var invert = this.model.get("invert");
        var inputValue = parseFloat(this.el.value);
        var finalValue;
        var ip = this.model.get("ip");
        var port = this.model.get("port");
        if(!invert){
          finalValue = inputValue;
        }else{
          finalValue = parseFloat(this.model.get("max")) - inputValue + parseFloat(this.model.get("min"))
        }
        console.log("Value: ", finalValue);
        this.model.set({value : finalValue})
        editor.socket.emit('message', editor.ip, ip, port, message, "f", parseFloat(finalValue));
  
      },
      // The render() should return 'this'
      render: function () {
        // Extend the original render method
        dView.prototype.render.apply(this, arguments);
        return this;
      },
    }),
  });
  //Slider finished
  editor.BlockManager.add('slider', {
    label: 'Slider',
    attributes: { class: 'fa fa-sliders' },
    category: 'Basic',
    content: `<input type="range" step="0.01" orient="horizontal">`
  })
}


},{}],4:[function(require,module,exports){
function oscar_socket(editor){//Client is going to connect to Server
var ipServer = "";
    jQuery.get("/ipserver", function(data, textStatus, jqXHR){
        ipServer = data; 
    })
editor.socket = io.connect('http://' + ipServer + ':8081', { port: 8081, rememberTransport: false });
console.log("Client connected to: ", ipServer);
}
},{}],5:[function(require,module,exports){
(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define("binternalip", [], factory);
	else if(typeof exports === 'object')
		exports["binternalip"] = factory();
	else
		root["binternalip"] = factory();
})(typeof self !== 'undefined' ? self : this, function() {
return /******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// define getter function for harmony exports
/******/ 	__webpack_require__.d = function(exports, name, getter) {
/******/ 		if(!__webpack_require__.o(exports, name)) {
/******/ 			Object.defineProperty(exports, name, { enumerable: true, get: getter });
/******/ 		}
/******/ 	};
/******/
/******/ 	// define __esModule on exports
/******/ 	__webpack_require__.r = function(exports) {
/******/ 		if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 		}
/******/ 		Object.defineProperty(exports, '__esModule', { value: true });
/******/ 	};
/******/
/******/ 	// create a fake namespace object
/******/ 	// mode & 1: value is a module id, require it
/******/ 	// mode & 2: merge all properties of value into the ns
/******/ 	// mode & 4: return value when already ns object
/******/ 	// mode & 8|1: behave like require
/******/ 	__webpack_require__.t = function(value, mode) {
/******/ 		if(mode & 1) value = __webpack_require__(value);
/******/ 		if(mode & 8) return value;
/******/ 		if((mode & 4) && typeof value === 'object' && value && value.__esModule) return value;
/******/ 		var ns = Object.create(null);
/******/ 		__webpack_require__.r(ns);
/******/ 		Object.defineProperty(ns, 'default', { enumerable: true, value: value });
/******/ 		if(mode & 2 && typeof value != 'string') for(var key in value) __webpack_require__.d(ns, key, function(key) { return value[key]; }.bind(null, key));
/******/ 		return ns;
/******/ 	};
/******/
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};
/******/
/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = "./src/index.js");
/******/ })
/************************************************************************/
/******/ ({

/***/ "./src/index.js":
/*!**********************!*\
  !*** ./src/index.js ***!
  \**********************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";


Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
// compatibility for Firefox and chrome
// canisue: https://caniuse.com/#search=RTCPeerConnection
window.RTCPeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
var getMyIPAddr = new Promise(function (resolve, reject) {
  try {
    var pc = new RTCPeerConnection({
      iceServers: []
    });

    var noop = function noop() {}; // create a bogus data channel


    pc.createDataChannel(''); // create offer and set local description

    pc.createOffer(pc.setLocalDescription.bind(pc), noop);

    pc.onicecandidate = function (ice) {
      if (ice && ice.candidate && ice.candidate.candidate) {
        // eslint-disable-next-line max-len
        var myIP = /([0-9]{1,3}(\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(:[a-f0-9]{1,4}){7})/.exec(ice.candidate.candidate)[1] || '';
        pc.onicecandidate = noop;
        resolve(myIP);
      }
    };
  } catch {
    resolve('');
  }
});
var _default = getMyIPAddr;
exports.default = _default;
module.exports = exports["default"];

/***/ })

/******/ });
});

},{}]},{},[4,1,3,2]);
