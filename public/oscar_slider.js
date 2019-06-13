function oscar_slider(editor){
  var comps = editor.DomComponents;
  var dType = comps.getType('default');
  var dModel = dType.model;
  var dView = dType.view;
  editor.BlockManager.add('sliderHorizontal', {
    label: 'Horizontal Slider',
    attributes: { class:'fa fa-arrows-h' },
    category: 'Basic',
    content: `<input style="transform: rotate(0deg);" type="range" step="0.01" orient="horizontal">` 
  })
  editor.BlockManager.add('sliderVertical', {
    label: 'Vertical Slider',
    attributes: { class:'fa fa-arrows-v' },
    category: 'Basic',
    content: `<input style="transform: rotate(0deg);" type="range" step="0.01" orient="vertical">` 
  })
//SLIDER
// The `input` will be the Component type ID
comps.addType('input', {
    // Define the Model
    model: dModel.extend({
      defaults: Object.assign({}, dModel.prototype.defaults, {
        // Can't drop other elements inside it
        droppable: false,
        resizable: true,
        editable: true,
        // // Traits (Settings)
        ip : 'localhost',
        port: 10000,
        message: '/slider1',
        min: '0',
        max: '100',
        invert: false,
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
        {type: 'text',
        label: 'Min',
        name: 'min',
        changeProp: 1,},
        {type: 'text',
        label: 'Max',
        name: 'max',
        changeProp: 1,},
        {type: 'checkbox',
        label: 'Invert',
        name: 'invert',
        changeProp: 1,}
      ],
        }),
      init() {
          console.log('init: ', this);    	
          //this.view.ip = "";
          //this.view.port = "";
          //this.view.message = "";
          // this.listenTo(this, 'change:port', this.changePort);
          // this.listenTo(this, 'change:ip', this.changeIP);
          // this.listenTo(this, 'change:message', this.changeMessage);
          // this.listenTo(this, 'change:min', this.changeMin);
          // this.listenTo(this, 'change:max', this.changeMax);
          // editor.socket.emit('config', {            
          //   server: { port: 4000,  host: config.ip},
          //   client: { port: this.attributes.port, host: this.attributes.ip}
          // });
      },
      changeIP() {
          console.log("IP Changed")
          var newIP = this.changed.ip;
          if(newIP == 'localhost' || this.validateIPaddress(newIP)){
              console.log("Is correct");
              this.attributes.ip = newIP;
              editor.socket.emit('config', {
                server: { port: 4000,  host: config.ip},
                client: { port: this.attributes.port, host: newIP}
            });
  
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
              // this.socket.emit('config', {
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
      changeMin() {
        console.log("This changemin: ", this);
        var mini = this.changed.min;
        if(!isNaN(mini)){
          this.attributes.min = mini;
          this.setAttributes({'min': mini, 'max': this.attributes.max, 'type': 'range', 'step': "0.01"});
          //this.setAttribute('min', min);

        }else{
          alert("Min should be a number");
        }
      },
      changeMax() {
        console.log('Max Changed')
        console.log('This: ', this)
        var maxi = this.changed.max;
        if(!isNaN(maxi)){
          this.attributes.max = maxi;
          this.setAttributes({'min': this.attributes.min, 'max': maxi , 'type': 'range', 'step': "0.01"});
        }else{
          alert("Max should be a number");
        }
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
            if(el.tagName == 'INPUT'){
          //type text gives you text edit capabilities
                return {type: 'input'};
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
  
      changeValue: function(e){
        console.log("e:" , e);
        console.log("This: ", this);
        console.log("Value: ", this.el.value);
        var inputValue = this.el.value;
        var id = this.model.attributes.ip + "" + this.model.attributes.port
        //this.model.socket.emit('message', id, [this.model.attributes.message].concat(parseInt(inputValue)));
        editor.socket.emit('message', id, [this.model.attributes.message].concat(parseFloat(inputValue)));
  
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
}

