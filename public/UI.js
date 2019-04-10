 var socketId = 0;
 var editor = grapesjs.init({
 	height: '100%',
 	showOffsets: 1,
 	noticeOnUnload: 0,
 	storageManager: { autoload: 0 },
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
// styleManager : {	
// 	sectors: [{
// 		name: 'General',
// 		open: false,
// 		buildProps: ['float', 'display', 'position', 'top', 'right', 'left', 'bottom']
// 	},{
// 		name: 'Flex',
// 		open: false,
// 		buildProps: ['flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'order', 'flex-basis', 'flex-grow', 'flex-shrink', 'align-self']
// 	},{
// 		name: 'Dimension',
// 		open: false,
// 		buildProps: ['width', 'height', 'max-width', 'min-height', 'margin', 'padding'],
// 	},{
// 		name: 'Typography',
// 		open: false,
// 		buildProps: ['font-family', 'font-size', 'font-weight', 'letter-spacing', 'color', 'line-height', 'text-shadow'],
// 	},{
// 		name: 'Decorations',
// 		open: false,
// 		buildProps: ['border-radius-c', 'background-color', 'border-radius', 'border', 'box-shadow', 'background'],
// 	},{
// 		name: 'Extra',
// 		open: false,
// 		buildProps: ['transition', 'perspective', 'transform'],
// 	}
// 	],
// },
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
  	},
  }
});

 // editor.BlockManager.add('testBlock', {
 // 	label: 'Block',
 // 	attributes: { class:'gjs-fonts gjs-f-b1' },
 // 	content: `<div style="padding-top:50px; padding-bottom:50px; text-align:center">Test block</div>`
 // })
 editor.BlockManager.add('testButton', {
 	label: 'Button',
 	attributes: { class:'gjs-fonts gjs-f-b1'},
 	category: 'Basic',
 	content: '<button type="button">Click Me!</button>'
 })
 // editor.BlockManager.add('testImage', {
 // 	label: 'Image',
 // 	attributes: { class:'gjs-fonts gjs-f-b1' },
 // 	content: { type: 'image' }
 // })
 // editor.BlockManager.add('testScript', {
 // 	label: 'Script',
 // 	attributes: { class:'gjs-fonts gjs-f-b1' },
 // 	content: { type: 'script' }
 // })
 // editor.BlockManager.add('testVideo', {
 // 	label: 'Video',
 // 	attributes: { class:'gjs-fonts gjs-f-b2' },
 // 	content: { type: 'video' }
 // })
 // editor.BlockManager.add('testSlider', {
 // 	label: 'Slider',
 // 	attributes: { class:'gjs-fonts gjs-f-b2' },
 // 	content: `<input type="range" min="1" max="100" value="50">` 
 // })
//  editor.BlockManager.add('testInput', {
// 	label: 'Input',
// 	attributes: { 
// 		class:'gjs-fonts gjs-f-b2',
// 		title: "testInput" },
// 		category: 'Basic',
// 		content:  '<input type="text" name="fname">'
// 	})
// editor.BlockManager.add('test-block', {
// 	label: 'Test RED block',
// 	attributes: {class: 'fa fa-text'},
// 	content: {
// 		script: "alert('Hi'); console.log('the element', this)",
//     // Add some style just to make the component visible
//     style: {
//     	width: '100px',
//     	height: '100px',
//     	'background-color': 'red',
//     }
// }
// });


  //to open the asset manager
  //editor.runCommand('open-assets');
  // editor.runCommand('open-assets', {
  // target: editor.getSelected()
  // });
  // Get DomComponents module
  var comps = editor.DomComponents;
// Get the model and the view from the default Component type
var defaultType = comps.getType('default');
var defaultModel = defaultType.model;
var defaultView = defaultType.view;

//button start
// The `input` will be the Component type ID
comps.addType('button', {
  // Define the Model
  model: defaultModel.extend({
    // Extend default properties
    defaults: Object.assign({}, defaultModel.prototype.defaults, {
    	style: {
    		width: '130px',
    		height: '50px',
    	},
      // Can't drop other elements inside it
      droppable: false,
      resizable: true,
      editable: true,
      // Traits (Settings)
      ip : 'localhost',
      port: 8000,
      message: '/push1',
      traits: [ 
      {type: 'text',
      label: 'Ip',
      name: 'ip',
      changeProp: 1,}, 
      {type: 'text',
      label: 'Port',
      name: 'port',
      changeProp: 1,},      
      {type: 'text',
      label: 'Message',
      name: 'message',
      changeProp: 1,},{
          // Can make it required for the form
          type: 'checkbox',
          label: 'Push Button',
          name: 'required',
        }],
      }),
    init() {
    	console.log('init: ', this);    	
    	//this.view.ip = "";
    	//this.view.port = "";
    	//this.view.message = "";
    	this.listenTo(this, 'change:port', this.changePort);
    	this.listenTo(this, 'change:ip', this.changeIP);
    	this.listenTo(this, 'change:message', this.changeMessage);

    },
    removed(){},
    changeIP() {
    	console.log("IP Changed")
    	var newIP = this.changed.ip;
    	if(newIP == 'localhost' || this.validateIPaddress(newIP)){
    		console.log("Is correct");
    		this.attributes.ip = newIP;

    	}else{
    		console.log(this);
    		//NO WORK this.attributes.ip = "";
    		alert("Your IP is incorrect");
    	}

    },
    changePort() {
    	var newPort = this.changed.port;
    	console.log(this);
    	console.log("Port Changed", newPort);
    	if(!isNaN(parseInt(newPort))){
    		console.log("Is correct");
    		this.attributes.port = newPort;
    		this.socket.emit('config', {
    			server: { port: 4000,  host: config.ip},
    			client: { port: newPort, host: config.ip}
    		});
    	}else{
    		//NO WORK this.attributes.port = "";
    		alert("Your port is incorrect");
    	}

    },

    changeMessage() {
    	console.log("Message Changed")
    	var newMessage = this.changed.message;
    	this.attributes.message = newMessage;

    },
    validateIPaddress(ipaddress) 
    {
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
  	isComponent: function(el) {
  		if(el.tagName == 'BUTTON'){
  			return {type: 'button'};
  		}
  	},
  }),
  view: defaultType.view.extend({
    // Bind events
    events: {
      // If you want to bind the event to children elements
      // 'click .someChildrenClass': 'methodName',
//     dblclick: 'onActive',
//     click: 'initResize',
//     error: 'onError',
//     dragstart: 'noDrag',
// mousedown: 'noDrag'
mousedown: 'handleClick',
mouseup: 'release',

dblclick: function(){
        //TO READ send message
        //added();
        //alert('Hi!');
      },
    },
    release: function(e){
     var id = this.model.attributes.ip + "" + this.model.attributes.port
     this.model.socket.emit('message', id, [this.model.attributes.message].concat(0));
   },
    // It doesn't make too much sense this method inside the component
    // but it's ok as an example
    randomHex: function() {
    	return '#' + Math.floor(Math.random()*16777216).toString(16);
    },
    handleClick: function(e) {
    	console.log('this: ', this);
    	console.log('socket: ', this.socket);
    	var id = this.model.attributes.ip + "" + this.model.attributes.port
    	console.log('id: ', id);
    	this.model.socket.emit('message', id, [this.model.attributes.message].concat(1));

      //this.model.set('style', {color: this.randomHex()}); // <- Affects the final HTML code
      //this.el.style.backgroundColor = this.randomHex(); // <- Doesn't affect the final HTML code
      // Tip: updating the model will reflect the changes to the view, so, in this case,
      // if you put the model change after the DOM one this will override the backgroundColor
      // change made before
    },
    // The render() should return 'this'
    render: function () {
      // Extend the original render method
      defaultType.view.prototype.render.apply(this, arguments);
      this.el.placeholder = 'Text here'; // <- Doesn't affect the final HTML code
      return this;
    },
  }),

  // Define the View
  //view: defaultType.view,
});
//button finished


//editor.on('component:add', model => console.log('added ', model))
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
	console.log('This: ',this);
	console.log('Traits: ',model.attributes.traits);

	if(model.attributes.attributes.type == "button"){
		console.log("It is a Button:", this);
		model.socket = io.connect('http://'+config.ip+':8081', { port: 8081, rememberTransport: false });
		if(true){
			console.log("emitting config: " , model.attributes.port);
			model.socket.emit('config', {
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
		model.socket.emit('disconnectme', id);

		//model.view.socket.disconnect(id);
		//model.view.socket.disconnect(true);
	}
});
//EXAMPLE OF SHORT FUNCTION
editor.on('block:drag:stop', model => console.log('dropped ', model))

