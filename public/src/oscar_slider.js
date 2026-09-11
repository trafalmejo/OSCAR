/**
 * OSC slider: sends its value to ip:port/message as it moves.
 *
 * With `invert` on, the value sent is mirrored within [min, max] while the
 * thumb stays where the user put it.
 */
function oscar_slider(editor, options) {
  var ipserver = (options && options.ipserver) || "localhost";

  var IPV4 =
    /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/;

  editor.DomComponents.addType("oscar-slider", {
    // Only range inputs are sliders. Matching every <input> would turn the
    // text fields of any imported form into OSC controls.
    isComponent: function (el) {
      if (el.tagName === "INPUT" && el.getAttribute("type") === "range") {
        return { type: "oscar-slider" };
      }
    },

    model: {
      defaults: {
        tagName: "input",
        attributes: { type: "range", step: "0.01", min: "0", max: "100", orient: "horizontal" },
        droppable: false,
        resizable: true,
        editable: true,
        ip: ipserver,
        port: 7000,
        message: "/slider1",
        min: 0,
        max: 100,
        value: 0,
        orientation: "horizontal",
        invert: false,
        traits: [
          { type: "text", label: "Ip", name: "ip", changeProp: true },
          { type: "text", label: "Port", name: "port", changeProp: true },
          { type: "text", label: "Message", name: "message", changeProp: true },
          { type: "text", label: "Min", name: "min", changeProp: true },
          { type: "text", label: "Max", name: "max", changeProp: true },
          { type: "text", label: "Value", name: "value", changeProp: true },
          {
            type: "select",
            label: "Orientation",
            name: "orientation",
            options: [
              { id: "horizontal", name: "Horizontal" },
              { id: "vertical", name: "Vertical" },
            ],
            changeProp: true,
          },
          { type: "checkbox", label: "Invert", name: "invert", changeProp: true },
        ],
      },

      init: function () {
        this.on("change:ip", this.checkIP);
        this.on("change:port", this.checkPort);
        this.on("change:min change:max", this.checkRange);
        this.on("change:value", this.checkValue);
        this.on("change:orientation", this.applyOrientation);
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

      checkRange: function () {
        var min = parseFloat(this.get("min"));
        var max = parseFloat(this.get("max"));
        if (isNaN(min) || isNaN(max)) {
          alert("Min and max have to be numbers");
          this.set({ min: this.previous("min"), max: this.previous("max") });
          return;
        }
        this.addAttributes({ min: String(min), max: String(max) });
      },

      // Edits from the settings panel move the thumb. Values the view sets
      // while the user is dragging are flagged `fromView`, and must not be
      // written back -- with invert on, that would snap the thumb to the
      // mirrored position on every input event.
      checkValue: function (model, value, opts) {
        if (opts && opts.fromView) return;
        var v = parseFloat(value);
        var min = parseFloat(this.get("min"));
        var max = parseFloat(this.get("max"));
        if (isNaN(v) || v < min || v > max) {
          alert("The value has to be a number between min and max");
          this.set({ value: this.previous("value") });
          return;
        }
        var el = this.getEl();
        if (el) el.value = v;
      },

      applyOrientation: function () {
        this.addAttributes({ orient: this.get("orientation") });
      },
    },

    view: {
      events: {
        input: "handleInput",
      },

      // Put the thumb back where it was when the project was saved. Without
      // this every slider sits at the browser's default midpoint after a load,
      // while the value last sent to the rig was something else.
      onRender: function () {
        var model = this.model;
        var value = parseFloat(model.get("value"));
        if (isNaN(value)) return;
        var min = parseFloat(model.get("min"));
        var max = parseFloat(model.get("max"));
        this.el.value = model.get("invert") ? max - value + min : value;
      },

      handleInput: function () {
        var model = this.model;
        var raw = parseFloat(this.el.value);
        var min = parseFloat(model.get("min"));
        var max = parseFloat(model.get("max"));
        var value = model.get("invert") ? max - raw + min : raw;

        model.set({ value: value }, { fromView: true });

        if (!editor.socket) return;
        editor.socket.emit(
          "message",
          editor.ip,
          model.get("ip"),
          model.get("port"),
          model.get("message"),
          "f",
          value
        );
      },
    },
  });

  editor.BlockManager.add("oscar-slider", {
    label: "Slider",
    // GrapesJS 0.21+ no longer ships Font Awesome, so icons are inline SVG.
    media:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" d="M3,17V19H9V17H3M3,5V7H13V5H3M13,21V19H21V17H13V15H11V21H13M7,9V11H3V13H7V15H9V9H7M21,13V11H11V13H21M15,9H17V7H21V5H17V3H15V9Z"/></svg>',
    category: "OSC",
    content: { type: "oscar-slider" },
  });
}
