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
        editor.socket.emit('message', ip, port, message, "f", parseFloat(finalValue));
  
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

