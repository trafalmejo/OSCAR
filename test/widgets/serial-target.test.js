"use strict";

const test = require("node:test");
const assert = require("node:assert");

const WIDGETS = require("../../lib/widgets/registry");
const { checkIp, checkPort, connection } = require("../../lib/widgets/fields");
const { outgoing } = require("../../lib/widgets/outgoing");
const { buildMessage } = require("../../lib/osc-message");
const { mount } = require("../helpers/widgets");

// Serial is routing, and routing is shared: these run over every registered
// widget so one added later gets the cable without knowing it exists.
const senders = WIDGETS.filter((w) => w.sends);

test("the Ip check takes the cable, and still refuses what is not an address", () => {
  for (const value of ["serial", "Serial", " SERIAL "]) assert.strictEqual(checkIp(value), null, value);
  assert.strictEqual(checkIp("localhost"), null);
  assert.strictEqual(checkIp("192.168.0.9"), null);
  for (const value of ["serial port", "COM3", "", "300.1.1.1", null]) assert.ok(checkIp(value), String(value));
});

test("a widget on the cable is not nagged about a port nothing reads", () => {
  assert.strictEqual(checkPort("", { ip: "serial" }), null);
  assert.strictEqual(checkPort("  ", { ip: " Serial" }), null);
  assert.strictEqual(checkPort(null, { ip: "SERIAL" }), null);
  assert.strictEqual(checkPort(undefined, { ip: "serial" }), null);
  assert.strictEqual(checkPort(7000, { ip: "serial" }), null);
  assert.match(checkPort("", { ip: "localhost" }), /between 1 and 65535/);
  assert.match(checkPort(0), /between 1 and 65535/);
  assert.strictEqual(checkPort(7000, { ip: "localhost" }), null);
});

test("a port nothing reads is still not stored as nonsense", () => {
  // It is kept in the project, and is the port the widget sends to the day
  // its Ip is changed to a network address -- by hand in the file, unchecked.
  for (const value of ["abc", 99999, -1, 0, "0", 1.5, "70 00", true, {}, []]) {
    assert.match(checkPort(value, { ip: "serial" }), /empty/, JSON.stringify(value));
  }
});

test("leaving the cable for the network needs a port first", () => {
  // The port check does not re-run when Ip changes, so without this a widget
  // could be pointed at the network with a port the server silently refuses.
  assert.match(checkIp("192.168.0.9", { ip: "192.168.0.9", port: "" }), /Port/);
  assert.strictEqual(checkIp("192.168.0.9", { ip: "192.168.0.9", port: 7000 }), null);
  assert.strictEqual(checkIp("serial", { ip: "serial", port: "" }), null);
});

test("the Ip field says the cable is an option", () => {
  const ip = connection().find((f) => f.key === "ip");
  assert.match(ip.placeholder, /serial/);
});

test("every sending widget accepts the cable through its own checks", () => {
  assert.ok(senders.length >= 7);
  for (const widget of senders) {
    assert.strictEqual(widget.checks.ip("serial", Object.assign({}, widget.defaults, { ip: "serial" })), null, widget.name);
    assert.strictEqual(widget.checks.port("", Object.assign({}, widget.defaults, { ip: "serial" })), null, widget.name);
  }
});

test("every sending widget aimed at the cable sends there, port or no port", () => {
  let sent = 0;
  for (const widget of senders) {
    const { el, ctx } = mount(widget, {
      ip: " Serial",
      port: "",
      rect: { left: 0, top: 0, width: 100, height: 100 },
    });
    el.value = "100";
    for (const type of ["pointerdown", "input", "change", "pointerup", "click"]) {
      el.fire(type, { clientX: 100, clientY: 0, key: "Enter" });
    }
    for (const message of ctx.sent) {
      if (!("address" in message)) continue;
      sent++;
      assert.strictEqual(message.ip, "serial", widget.name + " names the cable in its one spelling");
      // What the server does with it: the message alone has to be sendable.
      assert.ok(buildMessage(message.address, message.args), widget.name);
    }
  }
  assert.ok(sent >= 5, "the gestures above reached most widgets (" + sent + ")");
});

test("serial and DMX are independent: Output both sends OSC to the cable and levels to the node", () => {
  const message = outgoing(
    { enabled: true, oscEnabled: true, dmxEnabled: true, ip: "serial", port: "", message: "/led", argType: "f",
      dmxProtocol: "artnet", dmxHost: "", dmxUniverse: 1, dmxChannel: 1, dmxCount: 1 },
    0.5,
    0.5
  );
  assert.strictEqual(message.ip, "serial");
  assert.deepStrictEqual(message.dmx.levels, [128]);
});

test("a disabled widget is as silent on the cable as anywhere", () => {
  assert.strictEqual(outgoing({ enabled: false, ip: "serial", message: "/led", argType: "f" }, 1), null);
});

test("an address on the network is passed through untouched", () => {
  const message = outgoing({ enabled: true, ip: "192.168.0.9", port: 7000, message: "/led", argType: "f" }, 1);
  assert.strictEqual(message.ip, "192.168.0.9");
  assert.strictEqual(message.port, 7000);
});
