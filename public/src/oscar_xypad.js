/**
 * OSC XY pad: drag anywhere in the square to send two values at once.
 *
 * Sends one message carrying both values by default (`/pad 0.3 0.7`), which is
 * what most software expects for a position. It can send two separate messages
 * instead, for targets that want one value per address.
 */
function oscar_xypad(editor, options) {
  var ipserver = (options && options.ipserver) || "localhost";

  var IPV4 =
    /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/;

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function round(value) {
    return Math.round(value * 1000) / 1000;
  }

  editor.DomComponents.addType("oscar-xypad", {
    isComponent: function (el) {
      if (el.classList && el.classList.contains("oscar-xypad")) {
        return { type: "oscar-xypad" };
      }
    },

    model: {
      defaults: {
        tagName: "div",
        // The handle is drawn by CSS on this element, not by a child. A child
        // would swallow the drag, the way a button's label used to.
        attributes: { class: "oscar-xypad" },
        components: "",
        droppable: false,
        resizable: true,
        editable: false,

        ip: ipserver,
        port: 7000,
        message: "/pad",
        minX: 0,
        maxX: 100,
        minY: 0,
        maxY: 100,
        x: 0,
        y: 0,
        invertX: false,
        invertY: false,
        // "one" -> /pad 0.3 0.7      "two" -> /pad/x 0.3 and /pad/y 0.7
        sendMode: "one",

        traits: [
          { type: "text", label: "Ip", name: "ip", changeProp: true },
          { type: "text", label: "Port", name: "port", changeProp: true },
          { type: "text", label: "Message", name: "message", changeProp: true },
          {
            type: "select",
            label: "Send",
            name: "sendMode",
            options: [
              { id: "one", name: "One message, two values" },
              { id: "two", name: "Two messages (/x and /y)" },
            ],
            changeProp: true,
          },
          { type: "text", label: "Min X", name: "minX", changeProp: true },
          { type: "text", label: "Max X", name: "maxX", changeProp: true },
          { type: "text", label: "Min Y", name: "minY", changeProp: true },
          { type: "text", label: "Max Y", name: "maxY", changeProp: true },
          { type: "checkbox", label: "Invert X", name: "invertX", changeProp: true },
          { type: "checkbox", label: "Invert Y", name: "invertY", changeProp: true },
        ],
      },

      init: function () {
        this.on("change:ip", this.checkIP);
        this.on("change:port", this.checkPort);
        this.on("change:minX change:maxX change:minY change:maxY", this.checkRanges);
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

      checkRanges: function () {
        var names = ["minX", "maxX", "minY", "maxY"];
        for (var i = 0; i < names.length; i++) {
          if (isNaN(parseFloat(this.get(names[i])))) {
            alert("Ranges have to be numbers");
            this.set(names[i], this.previous(names[i]));
            return;
          }
        }
      },
    },

    view: {
      events: {
        pointerdown: "startDrag",
      },

      onRender: function () {
        this.placeHandle();
      },

      /** Put the handle where the stored values say, after a load. */
      placeHandle: function () {
        var model = this.model;
        var fx = this.fraction(model.get("x"), model.get("minX"), model.get("maxX"));
        var fy = this.fraction(model.get("y"), model.get("minY"), model.get("maxY"));

        var left = model.get("invertX") ? 1 - fx : fx;
        // Screen coordinates run downward; a control surface reads upward.
        var top = model.get("invertY") ? fy : 1 - fy;

        this.el.style.setProperty("--oscar-x", (left * 100).toFixed(2) + "%");
        this.el.style.setProperty("--oscar-y", (top * 100).toFixed(2) + "%");
      },

      fraction: function (value, min, max) {
        var lo = parseFloat(min);
        var hi = parseFloat(max);
        var v = parseFloat(value);
        if (isNaN(lo) || isNaN(hi) || isNaN(v) || hi === lo) return 0;
        return clamp((v - lo) / (hi - lo), 0, 1);
      },

      startDrag: function (e) {
        e.preventDefault();
        // Capture keeps the drag alive if the finger or pointer leaves the pad,
        // so a value can be held at the very edge.
        try {
          this.el.setPointerCapture(e.pointerId);
        } catch (err) {
          /* older engines manage without it */
        }

        this.dragging = true;
        this.bindDrag();
        this.track(e);
      },

      bindDrag: function () {
        if (this.boundDrag) return;
        var view = this;
        this.boundDrag = {
          move: function (e) {
            if (view.dragging) view.track(e);
          },
          end: function (e) {
            if (!view.dragging) return;
            view.dragging = false;
            view.track(e, true);
          },
        };
        this.el.addEventListener("pointermove", this.boundDrag.move);
        this.el.addEventListener("pointerup", this.boundDrag.end);
        this.el.addEventListener("pointercancel", this.boundDrag.end);
      },

      removed: function () {
        if (!this.boundDrag) return;
        this.el.removeEventListener("pointermove", this.boundDrag.move);
        this.el.removeEventListener("pointerup", this.boundDrag.end);
        this.el.removeEventListener("pointercancel", this.boundDrag.end);
        this.boundDrag = null;
      },

      /** Work out the values under the pointer and schedule them. */
      track: function (e, final) {
        var model = this.model;
        var rect = this.el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        var px = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        var py = clamp((e.clientY - rect.top) / rect.height, 0, 1);

        var fx = model.get("invertX") ? 1 - px : px;
        var fy = model.get("invertY") ? py : 1 - py;

        var minX = parseFloat(model.get("minX"));
        var maxX = parseFloat(model.get("maxX"));
        var minY = parseFloat(model.get("minY"));
        var maxY = parseFloat(model.get("maxY"));

        var x = round(minX + (maxX - minX) * fx);
        var y = round(minY + (maxY - minY) * fy);

        this.el.style.setProperty("--oscar-x", (px * 100).toFixed(2) + "%");
        this.el.style.setProperty("--oscar-y", (py * 100).toFixed(2) + "%");

        model.set({ x: x, y: y }, { fromView: true });

        this.pending = { x: x, y: y };
        if (final) {
          // The last position must be exact: whatever is downstream ends up
          // wherever the operator let go, not one frame short of it.
          this.flush();
        } else {
          this.schedule();
        }
      },

      // A drag fires far more often than anything needs; one send per frame is
      // plenty and keeps a busy surface from flooding the network.
      schedule: function () {
        if (this.frame) return;
        var view = this;
        this.frame = requestAnimationFrame(function () {
          view.frame = null;
          view.flush();
        });
      },

      flush: function () {
        if (this.frame) {
          cancelAnimationFrame(this.frame);
          this.frame = null;
        }
        if (!this.pending || !editor.sendOSC) return;

        var model = this.model;
        var ip = model.get("ip");
        var port = model.get("port");
        var address = model.get("message");
        var values = this.pending;
        this.pending = null;

        if (model.get("sendMode") === "two") {
          editor.sendOSC(ip, port, address + "/x", values.x);
          editor.sendOSC(ip, port, address + "/y", values.y);
          return;
        }
        editor.sendOSC(ip, port, address, [values.x, values.y]);
      },
    },
  });

  editor.BlockManager.add("oscar-xypad", {
    label: "XY Pad",
    media:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" d="M3,3H21A2,2 0 0,1 23,5V19A2,2 0 0,1 21,21H3A2,2 0 0,1 1,19V5A2,2 0 0,1 3,3M3,5V19H21V5H3M15,9A2,2 0 0,1 17,11A2,2 0 0,1 15,13A2,2 0 0,1 13,11A2,2 0 0,1 15,9Z"/></svg>',
    category: "OSC",
    content: { type: "oscar-xypad" },
  });
}
