"use strict";

/**
 * Just enough of an element and a host to drive a widget from Node.
 *
 * The widgets deliberately speak plain DOM rather than an editor's API, which
 * is what makes this possible: no browser, no GrapesJS, no bundler.
 */

function fakeElement(rect) {
  const listeners = {};
  return {
    style: {
      properties: {},
      setProperty(name, value) {
        this.properties[name] = value;
      },
    },
    classList: {
      names: new Set(),
      add(name) {
        this.names.add(name);
      },
      remove(name) {
        this.names.delete(name);
      },
      contains(name) {
        return this.names.has(name);
      },
    },
    attributes: {},
    value: "",
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    setPointerCapture() {},
    getBoundingClientRect() {
      return rect || { left: 0, top: 0, width: 100, height: 100 };
    },
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    /** Deliver an event, as a browser would. */
    fire(type, event) {
      const e = Object.assign({ preventDefault() {}, pointerId: 1 }, event);
      for (const fn of listeners[type] || []) fn(e);
    },
    listenerCount(type) {
      return (listeners[type] || []).length;
    },
  };
}

/**
 * The `ctx` an adapter would supply, recording what the widget sent so a test
 * can assert on the wire traffic rather than on internals.
 */
function fakeContext(config) {
  const changes = {};
  let oscListeners = [];
  let sharedListeners = [];

  return {
    config,
    sent: [],
    /** Every state this widget published to the other devices. */
    shared: [],
    get(key) {
      return this.config[key];
    },
    set(key, value) {
      this.config[key] = value;
    },
    send(message) {
      // Matching the adapter: null means stay silent, and is not recorded.
      if (message) this.sent.push(message);
    },
    setClass(name, on) {
      this.classes = this.classes || {};
      this.classes[name] = on;
    },
    onChange(keys, fn) {
      for (const key of keys) (changes[key] = changes[key] || []).push(fn);
      return () => {};
    },
    /** Pretend someone edited a setting in the panel. */
    edit(key, value) {
      this.config[key] = value;
      for (const fn of changes[key] || []) fn();
    },

    onOsc(fn) {
      oscListeners.push(fn);
      return () => {
        oscListeners = oscListeners.filter((other) => other !== fn);
      };
    },

    share(state) {
      this.shared.push(state);
    },

    onShared(fn) {
      sharedListeners.push(fn);
      return () => {
        sharedListeners = sharedListeners.filter((other) => other !== fn);
      };
    },

    /** Pretend an OSC message arrived from the target software. */
    receive(address, args) {
      for (const fn of oscListeners.slice()) fn({ address, args });
    },

    /** Pretend another device published a state for this widget. */
    remote(state) {
      for (const fn of sharedListeners.slice()) fn(state);
    },
  };
}

module.exports = { fakeElement, fakeContext };
