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
    /**
     * What an editor does when it re-applies its copy of the element: every
     * attribute, class and inline property goes. Listeners and the value
     * property stay, as they do in a browser.
     */
    wipe() {
      this.attributes = {};
      this.classList.names.clear();
      this.style.properties = {};
    },
    /** Everything a widget may have written onto the element. */
    snapshot() {
      return JSON.stringify({
        attributes: this.attributes,
        classes: Array.from(this.classList.names).sort(),
        style: this.style.properties,
        value: this.value,
      });
    },
  };
}

/**
 * The `ctx` an adapter would supply, recording what the widget sent so a test
 * can assert on the wire traffic rather than on internals.
 *
 * It is stricter than the real host in one place: the adapter drops a send()
 * made while an incoming message is being delivered, this throws. A widget
 * that so much as walks its send path from its receive path is a loop waiting
 * for software that echoes its state, and a test should not be able to miss it.
 */
function fakeContext(config) {
  const changes = {};
  let rewrites = [];
  let listeners = [];
  let delivering = 0;
  return {
    config,
    sent: [],
    get(key) {
      return this.config[key];
    },
    set(key, value) {
      this.config[key] = value;
    },
    send(message) {
      if (delivering) {
        throw new Error("a widget answered an incoming OSC message by sending " + JSON.stringify(message));
      }
      // Matching the adapter: null means stay silent, and is not recorded.
      if (message) this.sent.push(message);
    },
    onOsc(fn) {
      listeners.push(fn);
      return () => {
        listeners = listeners.filter((f) => f !== fn);
      };
    },
    /** Pretend the rig sent a message; `args` are plain values. */
    receive(address, args) {
      delivering++;
      try {
        for (const fn of listeners.slice()) fn({ address, args: args || [] });
      } finally {
        delivering--;
      }
    },
    setClass(name, on) {
      this.classes = this.classes || {};
      this.classes[name] = on;
    },
    onChange(keys, fn) {
      for (const key of keys) (changes[key] = changes[key] || []).push(fn);
      return () => {
        for (const key of keys) changes[key] = (changes[key] || []).filter((f) => f !== fn);
      };
    },
    onRewrite(fn) {
      rewrites.push(fn);
      return () => {
        rewrites = rewrites.filter((f) => f !== fn);
      };
    },
    /** Pretend someone edited a setting in the panel. */
    edit(key, value) {
      this.config[key] = value;
      for (const fn of changes[key] || []) fn();
    },
    /** Pretend the host has just rewritten the element, classes included. */
    rewrite() {
      this.classes = {};
      for (const fn of rewrites) fn();
    },
    /** How many handlers the widget still has on the host. */
    listening() {
      let count = rewrites.length + listeners.length;
      for (const fns of Object.values(changes)) count += fns.length;
      return count;
    },
  };
}

module.exports = { fakeElement, fakeContext };
