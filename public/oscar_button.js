//margin:auto to align on the center
//inline-block to increase size depending on their children
editor.BlockManager.add('button', {
  label: 'Button',
  attributes: { class:'fa fa-toggle-on'},
  category: 'Basic',
  content: '<button type="button" style="display:inline-block"><p style="margin: auto; display: inline-block;">Insert your text</p></button>'
})
//button starttext
// The `input` will be the Component type ID
comps.addType('button', {
  // Define the Model
  model: dModel.extend({
    defaults: Object.assign({}, dModel.prototype.defaults, {
    	style: {
    		width: '130px',
    		height: '50px',
    	},
      // Can't drop other elements inside it
      droppable: false,
      resizable: true,
      editable: true,
      // // Traits (Settings)
      ip : 'localhost',
      port: 10000,
      message: '/push1',
      toggle: false,
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
      changeProp: 1,},
      {
          // Can make it required for the form
          type: 'checkbox',
          label: 'Toggle Button',
          name: 'toggle',
        }],
      }),
    init() {
      console.log('init: ', this); 
      // this.attributes.traits.ip = this.attributes.ip;   	
      // this.attributes.traits.port = this.attributes.port;   	
      // this.attributes.traits.message = this.attributes.message;   	
      // this.attributes.traits.toggle = this.attributes.toggle;   	
    	//this.view.ip = "";
    	//this.view.port = "";
    	//this.view.message = "";
    	this.listenTo(this, 'change:port', this.changePort);
    	this.listenTo(this, 'change:ip', this.changeIP);
    	this.listenTo(this, 'change:message', this.changeMessage);
    	this.listenTo(this, 'change:toggle', this.changeToggle);
    },
    changeIP() {
    	console.log("IP Changed")
    	var newIP = this.changed.ip;
    	if(newIP == 'localhost' || this.validateIPaddress(newIP)){
    		console.log("Is correct");
        this.attributes.ip = newIP;
        this.attributes.traits.ip = newIP;
        editor.socket.emit('config', {            
          server: { port: 4000,  host: config.ip},
    			client: { port: this.attributes.port, host: newIP}
        });
        
    	}else{
    		console.log(this);
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
    		//this.socket.emit('config', {
        editor.socket.emit('config', {            
          server: { port: 4000,  host: config.ip},
    			client: { port: newPort, host: this.attributes.ip}
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
    changeToggle() {
    	console.log("Toggle Changed")
    	var toggleOption = this.changed.toggle;
    	this.attributes.toggle = newMessage;
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
        //type text gives you text edit capabilities
  			return {type: 'button'};
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

    // It doesn't make too much sense this method inside the component
    // but it's ok as an example
    randomHex: function() {
    	return '#' + Math.floor(Math.random()*16777216).toString(16);
    },
    handleClick: function(e) {
      console.log('Click');
      console.log("Click event owner: ", this);
      var id = this.model.attributes.ip + "" + this.model.attributes.port
      var message = this.model.attributes.message;
      editor.socket.emit('message', id, [this.model.attributes.message].concat(1));
      setTimeout(function(){editor.socket.emit('message', id, [message].concat(0));},250);
      //this.model.socket.emit('message', id, [this.model.attributes.message].concat(1));
      //this.model.set('style', {color: this.randomHex()}); // <- Affects the final HTML code
      //this.el.style.backgroundColor = this.randomHex(); // <- Doesn't affect the final HTML code
      // Tip: updating the model will reflect the changes to the view, so, in this case,
      // if you put the model change after the DOM one this will override the backgroundColor
      // change made before
    },
    release: function(e){
      console.log('Release');
      var id = this.model.attributes.ip + "" + this.model.attributes.port
      //this.model.socket.emit('message', id, [this.model.attributes.message].concat(0));
      editor.socket.emit('message', id, [this.model.attributes.message].concat(0));
      alert("RELEASED");

    },
    // The render() should return 'this'
    render: function () {
      // Extend the original render method
      dView.prototype.render.apply(this, arguments);
      return this;
    },
  }),

  // Define the View
  //view: defaultType.view,
});
//BUTTON finished
