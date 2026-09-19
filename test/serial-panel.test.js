"use strict";

/**
 * The editor's Serial panel, run against just enough of a document.
 *
 * public/src/oscar_serial.js is a plain browser script outside the bundle, so
 * nothing else loads it under test. What matters most is the build that
 * cannot do serial at all (Windows on ARM): the panel has to say so and
 * switch itself off, not throw and take the editor's toolbar with it.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "public", "src", "oscar_serial.js"), "utf8");
const IDS = ["serial-panel", "serial-status", "serial-port", "serial-bitrate", "serial-refresh", "serial-connect", "serial-disconnect"];

function element() {
  const el = {
    children: [],
    attributes: {},
    disabled: false,
    textContent: "",
    offsetParent: null,
    _value: "",
    classList: { toggle() {} },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    appendChild(child) {
      this.children.push(child);
    },
    removeChild(child) {
      this.children.splice(this.children.indexOf(child), 1);
    },
    get firstChild() {
      return this.children[0] || null;
    },
  };
  // A select only takes a value one of its options has, as in a browser.
  Object.defineProperty(el, "value", {
    get() {
      return this._value;
    },
    set(v) {
      const has = this.children.some((child) => child._value === String(v));
      this._value = this.children.length && !has ? "" : String(v);
    },
  });
  return el;
}

function mountPanel(answers) {
  const els = {};
  IDS.forEach((id) => (els[id] = element()));
  const requests = [];
  const alerts = [];
  const buttons = [];
  const context = {
    document: {
      getElementById: (id) => els[id] || null,
      createElement: () => element(),
      querySelector: () => null,
    },
    fetch(url, options) {
      requests.push({ url, options: options || null });
      const answer = answers.shift();
      return Promise.resolve({ ok: answer.status < 400, json: () => Promise.resolve(answer.body) });
    },
    setInterval() {},
    JSON,
    Number,
    String,
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
  context.oscar_serial({
    panels: { addButton: (panel, button) => buttons.push({ panel, button }) },
    openModal() {},
    alert: (text) => alerts.push(text),
  });
  return { els, requests, alerts, buttons };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("the panel adds its toolbar button and lists the ports it is told about", async () => {
  const panel = mountPanel([
    {
      status: 200,
      body: {
        supported: true,
        state: "idle",
        path: null,
        bitrate: 115200,
        sent: 0,
        dropped: 0,
        error: null,
        ports: [{ path: "COM3", label: "Arduino Uno (COM3)" }],
      },
    },
    {
      status: 200,
      body: { supported: true, state: "opening", path: "COM3", bitrate: 115200, sent: 0, dropped: 0, error: null, ports: [] },
    },
  ]);
  await settle();

  assert.strictEqual(panel.buttons.length, 1);
  assert.strictEqual(panel.buttons[0].panel, "options");
  assert.strictEqual(panel.els["serial-status"].textContent, "Not connected.");
  assert.strictEqual(panel.els["serial-port"].children[0].textContent, "Arduino Uno (COM3)");
  assert.strictEqual(panel.els["serial-port"].value, "COM3");
  assert.strictEqual(panel.els["serial-bitrate"].value, "115200");
  assert.strictEqual(panel.els["serial-connect"].disabled, false);
  assert.strictEqual(panel.els["serial-disconnect"].disabled, true);

  panel.els["serial-connect"].onclick();
  await settle();
  const sent = panel.requests[1];
  assert.strictEqual(sent.options.method, "POST");
  // The rate goes as a number: the server refuses what it cannot read rather
  // than guessing, and a select's value is a string.
  assert.deepStrictEqual(JSON.parse(sent.options.body), { action: "connect", path: "COM3", bitrate: 115200 });
  assert.strictEqual(panel.els["serial-status"].attributes["data-state"], "opening");
  // The chosen port stays listed while it is not there.
  assert.strictEqual(panel.els["serial-port"].children[0].textContent, "COM3 (not found)");
  assert.strictEqual(panel.els["serial-disconnect"].disabled, false);
  assert.deepStrictEqual(panel.alerts, []);
});

test("a build with no serial driver says so and switches the panel off", async () => {
  const reason = "No serial support in this build of OSCAR.";
  const panel = mountPanel([
    {
      status: 200,
      body: { supported: false, reason, state: "idle", path: null, bitrate: 115200, sent: 0, dropped: 0, error: null, ports: [] },
    },
  ]);
  await settle();

  assert.strictEqual(panel.els["serial-status"].textContent, reason);
  assert.strictEqual(panel.els["serial-status"].attributes["data-state"], "unsupported");
  ["serial-port", "serial-bitrate", "serial-refresh", "serial-connect", "serial-disconnect"].forEach((id) => {
    assert.strictEqual(panel.els[id].disabled, true, id + " is switched off");
  });
});

test("a locked OSCAR's refusal is shown as the reason, not painted as a status", async () => {
  const panel = mountPanel([{ status: 403, body: { error: "OSCAR is locked." } }]);
  await settle();
  assert.strictEqual(panel.els["serial-status"].textContent, "OSCAR is locked.");
  assert.strictEqual(panel.els["serial-connect"].disabled, true);
});

test("a complaint from the server reaches the person who pressed Connect", async () => {
  const idle = { supported: true, state: "idle", path: null, bitrate: 115200, sent: 0, dropped: 0, error: null, ports: [] };
  const panel = mountPanel([
    { status: 200, body: idle },
    { status: 400, body: Object.assign({}, idle, { error: "Pick a serial port first." }) },
  ]);
  await settle();
  panel.els["serial-connect"].onclick();
  await settle();
  assert.deepStrictEqual(panel.alerts, ["Pick a serial port first."]);
});
