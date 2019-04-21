
 var editor = grapesjs.init({
  //domComponents: { storeWrapper: 1 },
  height: '100%', 
 	container: '#gjs',
 	fromElement: true,
  canvas: {styles:['assets/css/noscript.css','assets/css/main.css','https://www.w3schools.com/w3css/4/w3.css', 'https://fonts.googleapis.com/css?family=Raleway']},
  assetManager: {
   assets: [
   'http://placehold.it/350x250/78c5d6/fff/image1.jpg',
     // Pass an object with your properties
     {
     	type: 'image',
     	src: 'https://i.ytimg.com/vi/UQTdBYbGJIU/maxresdefault.jpg',
     	height: 1920,
     	width: 1080
     },
     {
     	type: 'image',
     	src: 'http://placehold.it/350x250/459ba8/fff/image2.jpg',
     	height: 350,
     	width: 250
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
   //Persistance
     // Default configurations
   storageManager: {
    id: 'gjs-',             // Prefix identifier that will be used on parameters
    type: 'local',          // Type of the storage
    autosave: true,         // Store data automatically
    autoload: true,         // Autoload stored data on init
    stepsBeforeSave: 1,     // If autosave enabled, indicates how many changes are necessary before store method is triggered
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
  plugins: ['gjs-preset-webpage', 'grapesjs-touch'],
  pluginsOpts: {
  	'gjs-preset-webpage': {
  		blocks: [],
  		formsOpts: false,
  		navbarOpts: false,
      countdownOpts: false,
      showStylesOnChange: true,
  	},
  }
});

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

//EVENT WHEN THE EDITOR IS LOADER
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
  if(editor.socket == null){
    //CHECK IF THIS IS STILL CONNECTED SOMEWAY
    if(true){

      // editor.socket = io.connect('http://'+config.ip+':8081', { port: 8081, rememberTransport: false });
    }
  }

  var jsonObject= JSON.parse(object.components);
  console.log('Loaded Object: ', jsonObject);
  console.log('Js:', editor.getHtml());
  for (let i = 0; i < jsonObject.length; i++) {
    const component = jsonObject[i];
    if(component.type == "button" || component.type == "input"){
        console.log("emitting config: " , component.port);
        editor.socket.emit('config', {
          server: { port: 4000,  host: config.ip},
          client: { port: component.port, host: config.ip}
        });
    }
  }
});
editor.on('component:add', function(model){
	//console.log('added ', model.prototype.defaults);
	//console.log(this);
	//TO READ:WE WANT TO CHECK IF THE CLIENT ALREADY EXISTS
	// boolean clientExist = false;
	// for (var i = 0; i < oscClient.length; i++) {
	// 	if(oscClient[i])
	// }
	//TO READ: WE WANT TO CHECK ITS PROPERTIES / TRAITS
	console.log('Model: ',model);
	console.log('Traits: ',model.attributes.traits);
  console.log('Type: ', model.attributes.type);
	if(model.attributes.type == "button" || model.attributes.type == "input"){
		console.log("It is a Button or Input:", this);
		if(true){
			console.log("emitting config: " , model.attributes.port);
			//model.socket.emit('config', {
      editor.socket.emit('config', {
        server: { port: 4000,  host: config.ip},
				client: { port: model.attributes.port, host: config.ip}
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
//EXAMPLE OF SHORT FUNCTION
editor.on('block:drag:stop', model => console.log('dropped ', model))

