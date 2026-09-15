/**
 * OSC button: sends `max` to ip:port/message when pressed.
 *
 * Momentary buttons send `max` then 0 about 250ms later. Toggle buttons
 * alternate between `max` and 0 on each press.
 */
function oscar_button(editor, options) {
  var ipserver = (options && options.ipserver) || "localhost";

  var DEFAULT_LABEL = "Insert here your text";

  var IPV4 =
    /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/;

  function send(component, value) {
    if (!editor.sendOSC) return;
    editor.sendOSC(component.get("ip"), component.get("port"), component.get("message"), value);
  }

  editor.DomComponents.addType("oscar-button", {
    isComponent: function (el) {
      if (el.tagName === "BUTTON") return { type: "oscar-button" };
    },

    model: {
      defaults: {
        tagName: "button",
        attributes: { name: "button_oscar" },
        // The label is plain text inside the button, not a child element. A
        // child element intercepted every click and drag: grabbing a button by
        // its label tore the label out, and clicking selected the text rather
        // than the button and its OSC settings. The Label field edits it.
        label: DEFAULT_LABEL,
        components: DEFAULT_LABEL,
        droppable: false,
        resizable: true,
        editable: true,
        ip: ipserver,
        port: 7000,
        message: "/push1",
        max: "1",
        toggle: false,
        value: false,
        traits: [
          { type: "text", label: "Label", name: "label", changeProp: true },
          { type: "text", label: "Ip", name: "ip", changeProp: true },
          { type: "text", label: "Port", name: "port", changeProp: true },
          { type: "text", label: "Message", name: "message", changeProp: true },
          { type: "text", label: "Max", name: "max", changeProp: true },
          { type: "checkbox", label: "Toggle Button", name: "toggle", changeProp: true },
        ],
      },

      init: function () {
        var text = this.components()
          .map(function (c) {
            return c.get("type") === "textnode" ? c.get("content") : "";
          })
          .join("");
        var label = this.get("label");

        if (label && label !== DEFAULT_LABEL && label !== text) {
          // A label came from a saved project or from whoever created the
          // component; it wins over whatever text the markup happens to carry.
          this.components(label);
        } else if (text && text !== label) {
          // A button imported from HTML brings its own text; show that in the
          // Label field rather than the default.
          this.set({ label: text }, { silent: true });
        }

        this.on("change:label", this.applyLabel);
        this.on("change:ip", this.checkIP);
        this.on("change:port", this.checkPort);
        this.on("change:max", this.checkMax);
      },

      applyLabel: function () {
        this.components(String(this.get("label") || ""));
      },

      checkIP: function () {
        var ip = this.get("ip");
        if (ip === "localhost" || IPV4.test(ip)) return;
        alert("That IP address isn't valid: " + ip);
        this.set({ ip: this.previous("ip") });
      },

      checkPort: function () {
        if (!isNaN(parseInt(this.get("port"), 10))) return;
        alert("The port has to be a number");
        this.set({ port: this.previous("port") });
      },

      checkMax: function () {
        if (!isNaN(parseFloat(this.get("max")))) return;
        alert("Max has to be a number");
        this.set({ max: this.previous("max") });
      },
    },

    view: {
      events: {
        touchstart: "handlePress",
        click: "handlePress",
      },

      handlePress: function (e) {
        // A touch fires touchstart and then a synthetic click; only act once.
        e.preventDefault();

        var model = this.model;
        var max = parseFloat(model.get("max"));

        if (model.get("toggle")) {
          var on = !model.get("value");
          model.set({ value: on });
          on ? model.addClass("toggle") : model.removeClass("toggle");
          send(model, on ? max : 0);
          return;
        }

        send(model, max);
        setTimeout(function () {
          send(model, 0);
        }, 250);
      },
    },
  });

  editor.BlockManager.add("oscar-button", {
    label: "Button",
    // GrapesJS 0.21+ no longer ships Font Awesome, so icons are inline SVG.
    media:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" d="M5,3H19A2,2 0 0,1 21,5V19A2,2 0 0,1 19,21H5A2,2 0 0,1 3,19V5A2,2 0 0,1 5,3Z"/></svg>',
    category: "OSC",
    content: { type: "oscar-button" },
  });
}
