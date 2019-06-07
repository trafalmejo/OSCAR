
 var editor = grapesjs.init({
  //domComponents: { storeWrapper: 1 },
  height: '100%', 
 	container: '#gjs',
 	fromElement: true,
  allowScripts: 1,
  //canvas: {styles:['assets/css/noscript.css','assets/css/main.css','https://www.w3schools.com/w3css/4/w3.css', 'https://fonts.googleapis.com/css?family=Raleway']},
  panels: {
    // options

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
     	src:  'http://placehold.it/350x250/78c5d6/fff/image1.jpg',
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
   traitManager:{

   },
   //Persistance
     // Default configurations
   storageManager: {
    id: 'gjs-',             // Prefix identifier that will be used on parameters
    type: 'local',          // Type of the storage
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
  //gjs-aviary
  //aviaryOpts: [false],
  plugins: [oscar_button, oscar_slider,'gjs-preset-webpage', 'grapesjs-custom-code', 'grapesjs-parser-postcss', 'grapesjs-touch', 'grapesjs-tooltip'],
  pluginsOpts: {
  	'gjs-preset-webpage': {
  		blocks: [],
  		formsOpts: false,
  		navbarOpts: false,
      countdownOpts: false,
      showStylesOnChange: true,
      modalImportTitle: 'Import Template',
      modalImportLabel: '<div style="margin-bottom: 10px; font-size: 13px;">Paste here your HTML/CSS and click Import</div>',
      modalImportContent: function(editor) {
        return editor.getHtml() + '<style>'+editor.getCss()+'</style>'
      }
    },
    'grapesjs-tooltip': {}
  }
});
window.editor = editor;

editor.socket = io.connect('http://'+config.ip+':8081', { port: 8081, rememberTransport: false });

  //to open the asset manager
  //editor.runCommand('open-assets');
  // editor.runCommand('open-assets', {
  // target: editor.getSelected()
  // });
  // Get DomComponents module
  var comps = editor.DomComponents;
  // Get the model and the view from the default Component type
  var dType = comps.getType('default');
  var dModel = dType.model;
  var dView = dType.view;
  
//EVENT WHEN THE EDITOR IS LOADED
editor.on('load', function(edit){
  console.log('Model was loaded');
  console.log('Model loaded:', edit);
  console.log('Editor: ', editor);
  //edit.socket = io.connect('http://'+config.ip+':8081', { port: 8081, rememberTransport: false });

});
//Event is trigger for every loaded component
editor.on('storage:load', function(object){
  // console.log('Loaded Object: ', object);
  // console.log('Loaded Components: ', object.components);
  // console.log('Typeof: ', typeof(object.components));

  var jsonObject= JSON.parse(object.components);
  console.log('Loaded Object: ', jsonObject);
  console.log('Js:', editor.getHtml());
  //LOOP OVER ALL COMPONENTS
  editor.DomComponents.getWrapper().onAll(component => {
    if (component.is('button')) {
     // do something
     //component.init()
     console.log('GetView: ', component.getView())
     console.log('Componenent loaded: ', component);
     console.log('Port:', component.port)
     if (typeof component.ip === 'undefined') {
      // color is undefined
      component.ip = 'localhost';
    }
     if (typeof component.port === 'undefined') {
      // color is undefined
      component.port = 10000;
    }
    console.log('Port loaded: ', component.port)
       editor.socket.emit('config', {
       server: { port: 4000,  host: config.ip},
       client: { port: component.port, host: component.ip}
     });
    }
   })

});
editor.on('component:add', function(model){
	//console.log('added ', model.prototype.defaults);
	//console.log(this);
	//TO READ:WE WANT TO CHECK IF THE CLIENT ALREADY EXISTS
	// boolean clientExist = false;
	// for (var i = 0; i < oscClient.length; i++) {
	// 	if(oscClient[i])
  // }
	if(model.attributes.type == "button" || model.attributes.type == "input"){
      //TO READ: WE WANT TO CHECK ITS PROPERTIES / TRAITS
      var viewTemp = model.getView()
 console.log('GetView Added: ', viewTemp)
	console.log('Model: ',model);
	console.log('Traits: ',model.attributes.traits);
  console.log('Type: ', model.attributes.type);
		console.log("It is a Button or Input:", this);
		if(true){
			//console.log("emitting config: " , model.attributes.port);
			//model.socket.emit('config', {
      editor.socket.emit('config', {
        server: { port: 4000,  host: config.ip},
				client: { port: model.attributes.port, host: model.attributes.ip}
			});
		}
	}
});
editor.on('component:remove', function(model){
	//console.log('added ', model.prototype.defaults);
	//console.log(this);
	if(model.attributes.attributes.type == "button"){
		console.log("You removed a button");
		var id = model.attributes.ip + "" + model.attributes.port
		console.log('socket id: ', id);
		console.log('model: ', model);
		//model.socket.emit('disconnectme', id);
    editor.socket.emit('disconnectme', id);

		//model.view.socket.disconnect(id);
		//model.view.socket.disconnect(true);
	}
});
//UPDATE TRAITS
editor.on("component:update", function(component) {
  // console.log("Component Update", component);
  // console.log('ip: ', component.changed.ip);
  var newIP = component.changed.ip;
  if (typeof newIP !== 'undefined'){
  //   console.log("href changed!", component);
  if(newIP == 'localhost' || validateIPaddress(newIP)){
    console.log("Is correct");
    component.attributes.ip = newIP;
    editor.socket.emit('config', {            
      server: { port: 4000,  host: config.ip},
      client: { port: component.attributes.port, host: component.attributes.ip}
    });
  }else{
    console.log('IP: ', component)
    alert("Your IP is incorrect: " + component.attributes.ip);
    var trait = component.getTrait('ip');
    trait.view.$input[0].value = component._previousAttributes.ip;
    component.attributes.ip = component._previousAttributes.ip;
  }
  }
  var newPort = component.changed.port;
   if(typeof newPort !== 'undefined'){
    console.log("Port Changed: ", newPort);
    if(!isNaN(parseInt(newPort))){
      console.log("Is correct");
      component.attributes.port = newPort;
      editor.socket.emit('config', {            
        server: { port: 4000,  host: config.ip},
        client: { port: component.attributes.port, host: component.attributes.ip}
      });
    }else{
      alert("Your port is incorrect");
      var trait = component.getTrait('port');
      trait.view.$input[0].value = component._previousAttributes.port;
      component.attributes.port = component._previousAttributes.port;
    }
   }
   var newMin = component.changed.min;
   if(typeof newMin !== 'undefined'){
    console.log("Min Changed: ", newMin);
    if(!isNaN(parseInt(newMin))){
      console.log("Is correct");
      component.attributes.min = newMin;
      console.log('orient: ', component)
      component.setAttributes({'min': newMin, 'max': component.attributes.max, 'type': 'range', 'step': '0.1', 'orient': component.view.attr.orient});
    }else{
      alert("Your min is incorrect");
      var trait = component.getTrait('min');
      trait.view.$input[0].value = component._previousAttributes.min;
      component.attributes.min = component._previousAttributes.min;
    }
   }
   var newMax = component.changed.max;
   if(typeof newMax !== 'undefined'){
    console.log("Min Changed: ", newMax);
    if(!isNaN(parseInt(newMax))){
      console.log("Is correct");
      component.attributes.max = newMax;
      component.setAttributes({'min': component.attributes.min, 'max': newMax , 'type': 'range', 'step': '0.1', 'orient': component.view.attr.orient});

    }else{
      alert("Your max is incorrect");
      var trait = component.getTrait('max');
      trait.view.$input[0].value = component._previousAttributes.max;
      component.attributes.max = component._previousAttributes.max;
    }
   }
})


//VALIDATE IP
function validateIPaddress(ipaddress) 
{
  if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ipaddress)) {
    return (true)
  }
  return (false)
}
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

//FIXES MODAL FOR IMPORT HTML CODE
editor.on('run:gjs-open-import-webpage', () =>
  editor.once('modal:close', () => {
    const { Commands } = editor;
    if (Commands.isActive('gjs-open-import-webpage')) {
      Commands.stop('gjs-open-import-webpage');
    }
  }),
);

//     // Add and beautify tooltips

      var pn = editor.Panels;
      var modal = editor.Modal;
      var commands = editor.Commands;


            // Add info command
            var mdlClass = 'gjs-mdl-dialog-sm';
            var infoContainer = document.getElementById('info-panel');
            commands.add('open-info', function() {
              var mdlDialog = document.querySelector('.gjs-mdl-dialog');
              mdlDialog.className += ' ' + mdlClass;
              infoContainer.style.display = 'block';
              modal.setTitle('About this demo');
              modal.setContent(infoContainer);
              modal.open();
              modal.getModel().once('change:open', function() {
                mdlDialog.className = mdlDialog.className.replace(mdlClass, '');
              })
            });
            
      pn.addButton('options', {
        id: 'open-info',
        className: 'fa fa-question-circle',
        command: function() { editor.runCommand('open-info') },
        attributes: {
          'title': 'About',
          'data-tooltip-pos': 'bottom',
        },
      });

      console.log("Panels: ", editor.Panels.getPanels());

      console.log("Button for tooltp: ", pn.getButton('options', 'export-template', 'Export'));
     // Add and beautify tooltips
      [['sw-visibility', 'Show Borders'], ['preview', 'Preview'], ['fullscreen', 'Fullscreen'],
       ['export-template', 'Export'], ['undo', 'Undo'], ['redo', 'Redo'],
       ['gjs-open-import-webpage', 'Import'], ['canvas-clear', 'Clear canvas', 'open-info', 'About']]
      .forEach(function(item) {
        pn.getButton('options', item[0]).set('attributes', {title: item[1], 'data-tooltip-pos': 'bottom'});
      });
      [['open-sm', 'Style Manager'],['open-tm', 'Settings'], ['open-layers', 'Layers'], ['open-blocks', 'Blocks']]
      .forEach(function(item) {
        pn.getButton('views', item[0]).set('attributes', {title: item[1], 'data-tooltip-pos': 'bottom'});
      });
      var titles = document.querySelectorAll('*[title]');

      for (var i = 0; i < titles.length; i++) {
        var el = titles[i];
        var title = el.getAttribute('title');
        title = title ? title.trim(): '';
        if(!title)
          break;
        el.setAttribute('data-tooltip', title);
        el.setAttribute('title', '');
      }

//console.log('All commands: ', commands.getAll());
