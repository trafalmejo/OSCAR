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
            server: { port: 4000, host:  config.ip },
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

