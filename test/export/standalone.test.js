"use strict";

/**
 * The standalone adapter: the widgets running on an exported page.
 *
 * Driven with the same fake element the widget tests use, a stand-in for the
 * bridge public/src/oscar_socket.js builds, and a document that is a list of
 * elements. No browser and no bundler.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { WIDGETS } = require("../../lib/widgets");
const { exportAttributes, CONFIG_ATTR, WIDGET_SELECTOR } = require("../../lib/export/config");
const { fakeElement } = require("../helpers/fake-dom");
const standalone = require("../../public/src/adapters/standalone");

const byName = (name) => WIDGETS.find((w) => w.name === name);

/** An element as the export wrote it: the widget's settings on it, and its id. */
function exported(name, overrides, id) {
  const widget = byName(name);
  const config = Object.assign({}, widget.defaults, overrides);
  const el = fakeElement();
  const attributes = exportAttributes(name, (key) => config[key]);
  for (const key of Object.keys(attributes)) el.setAttribute(key, attributes[key]);
  if (id !== null) el.setAttribute("id", id || "w1");
  return el;
}

function fakeDocument(elements) {
  const body = { children: [], appendChild: (el) => body.children.push(el) };
  return {
    body,
    createElement: () => fakeElement(),
    querySelectorAll(selector) {
      assert.strictEqual(selector, WIDGET_SELECTOR);
      return elements;
    },
  };
}

/** What oscar_socket() builds, recording instead of emitting. */
function fakeBridge(options) {
  const handlers = {};
  let oscListeners = [];
  const sharedListeners = {};
  const bridge = {
    osc: [],
    dmx: [],
    shared: [],
    socket: {
      connected: true,
      on(event, fn) {
        (handlers[event] = handlers[event] || []).push(fn);
      },
      fire(event) {
        if (event === "connect") this.connected = true;
        if (event === "disconnect") this.connected = false;
        for (const fn of handlers[event] || []) fn();
      },
    },
    sendOSC: (ip, port, address, args) => bridge.osc.push({ ip, port, address, args }),
    sendDMX: (request) => bridge.dmx.push(request),
    onOscIn(fn) {
      oscListeners.push(fn);
      return () => {
        oscListeners = oscListeners.filter((other) => other !== fn);
      };
    },
    hears: (address, args) => oscListeners.slice().forEach((fn) => fn({ address, args })),
    oscListenerCount: () => oscListeners.length,
  };
  if (!options || options.surface !== false) {
    bridge.shareState = (id, state, how) => bridge.shared.push({ id, state, how });
    bridge.onSharedState = (id, fn) => {
      (sharedListeners[id] = sharedListeners[id] || []).push(fn);
      return () => {
        sharedListeners[id] = sharedListeners[id].filter((other) => other !== fn);
      };
    };
    bridge.othersShow = (id, state) => (sharedListeners[id] || []).slice().forEach((fn) => fn(state));
  }
  return bridge;
}

function quietly(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
}

// ---- every widget, without being listed -------------------------------------

test("every registered widget runs on an exported page", () => {
  const elements = WIDGETS.map((widget, i) => exported(widget.name, {}, "w" + i));
  const bridge = fakeBridge();
  const wired = standalone.attachAll(fakeDocument(elements), bridge);
  assert.strictEqual(wired.attached, WIDGETS.length);
  assert.strictEqual(wired.inert, 0);

  // And lets go of the bridge again: a listener left behind is a leak per page.
  wired.detach();
  assert.strictEqual(bridge.oscListenerCount(), 0);
});

// ---- sending -----------------------------------------------------------------

test("a press goes where the project said, not where the defaults point", () => {
  const el = exported("oscar-button", { ip: "10.0.0.7", port: 9001, message: "/go", valueOn: "1", argType: "i" });
  const bridge = fakeBridge();
  standalone.attachAll(fakeDocument([el]), bridge);

  el.fire("pointerdown");
  assert.deepStrictEqual(bridge.osc, [{ ip: "10.0.0.7", port: 9001, address: "/go", args: [{ type: "i", value: 1 }] }]);
});

test("nothing is said while the bridge is away, so nothing is replayed when it returns", () => {
  const el = exported("oscar-slider", {});
  const bridge = fakeBridge();
  standalone.attachAll(fakeDocument([el]), bridge);

  bridge.socket.fire("disconnect");
  for (const value of ["10", "20", "30"]) {
    el.value = value;
    el.fire("input");
  }
  assert.deepStrictEqual(bridge.osc, [], "socket.io would have queued all three");
  assert.deepStrictEqual(bridge.shared, [], "nor are the other tablets told of a move the rig never got");

  bridge.socket.fire("connect");
  assert.deepStrictEqual(bridge.osc, []);

  el.value = "40";
  el.fire("input");
  assert.strictEqual(bridge.osc.length, 1);
  assert.strictEqual(bridge.osc[0].args[0].value, 40);
});

test("a bridge that has not answered yet counts as away", () => {
  const el = exported("oscar-button", {});
  const bridge = fakeBridge();
  bridge.socket.connected = undefined;
  standalone.attachAll(fakeDocument([el]), bridge);
  el.fire("pointerdown");
  assert.deepStrictEqual(bridge.osc, []);
});

test("the DMX half goes out as dmx, stamped with the widget's id in the project", () => {
  const bridge = fakeBridge();
  const ctx = standalone.contextFor(fakeElement(), {}, bridge, "fader7");
  const dmx = { protocol: "artnet", host: "10.0.0.9", universe: 0, channel: 1, levels: [255] };

  ctx.send({ dmx });
  assert.deepStrictEqual(bridge.dmx, [Object.assign({ source: "fader7" }, dmx)]);
  assert.deepStrictEqual(bridge.osc, [], "a DMX-only message has no OSC half to send");

  ctx.send({ ip: "10.0.0.7", port: 9001, address: "/x", args: [1], dmx });
  assert.strictEqual(bridge.osc.length, 1);
  assert.strictEqual(bridge.dmx.length, 2);
});

test("a slider set to DMX drives its channel from an exported page", () => {
  const el = exported("oscar-slider", { transport: "dmx", dmxHost: "10.0.0.9", min: 0, max: 100 }, "fader7");
  const bridge = fakeBridge();
  standalone.attachAll(fakeDocument([el]), bridge);

  el.value = "100";
  el.fire("input");
  assert.deepStrictEqual(bridge.osc, []);
  assert.strictEqual(bridge.dmx.length, 1);
  assert.strictEqual(bridge.dmx[0].source, "fader7");
  assert.deepStrictEqual(bridge.dmx[0].levels, [255]);
});

test("a control with no id makes no DMX claim, and says so", () => {
  const bridge = fakeBridge();
  const ctx = standalone.contextFor(fakeElement(), {}, bridge, null);
  quietly(() => ctx.send({ dmx: { protocol: "artnet", host: "x", universe: 0, channel: 1, levels: [1] } }));
  assert.deepStrictEqual(bridge.dmx, []);
  assert.strictEqual(ctx.share, undefined, "and has no name to share under");
  assert.strictEqual(ctx.onShared, undefined);
});

test("null means stay silent", () => {
  const bridge = fakeBridge();
  standalone.contextFor(fakeElement(), {}, bridge, "w1").send(null);
  assert.deepStrictEqual(bridge.osc, []);
});

// ---- receiving ---------------------------------------------------------------

test("a listening fader follows the rig, and answers with nothing", () => {
  const el = exported("oscar-slider", { listen: true, message: "/master", min: 0, max: 100 });
  const bridge = fakeBridge();
  standalone.attachAll(fakeDocument([el]), bridge);

  bridge.hears("/master", [42]);
  assert.strictEqual(el.value, "42");
  assert.deepStrictEqual(bridge.osc, []);
  // Recorded for a device joining later, flagged so nobody is told twice.
  assert.strictEqual(bridge.shared.length, 1);
  assert.strictEqual(bridge.shared[0].how.heard, true);

  bridge.hears("/master", [null]);
  bridge.hears("/master", [""]);
  assert.strictEqual(el.value, "42", "an unreadable value is ignored, never read as 0");

  bridge.hears("/other", [7]);
  assert.strictEqual(el.value, "42");
});

test("a fader that is not listening stays put", () => {
  const el = exported("oscar-slider", { listen: false, message: "/master", value: 5 });
  const bridge = fakeBridge();
  standalone.attachAll(fakeDocument([el]), bridge);
  bridge.hears("/master", [42]);
  assert.strictEqual(el.value, "5");
});

test("send is refused for as long as an incoming message is being delivered", () => {
  const bridge = fakeBridge();
  const ctx = standalone.contextFor(fakeElement(), {}, bridge, "w1");
  const message = { ip: "10.0.0.7", port: 9001, address: "/echo", args: [1], dmx: { levels: [1] } };

  const stop = ctx.onOsc(() => quietly(() => ctx.send(message)));
  bridge.hears("/anything", [1]);
  assert.deepStrictEqual(bridge.osc, []);
  assert.deepStrictEqual(bridge.dmx, []);

  // A listener that throws must not leave the door shut behind it.
  const stopThrowing = ctx.onOsc(() => {
    throw new Error("boom");
  });
  assert.throws(() => bridge.hears("/anything", [1]));
  stopThrowing();
  stop();
  ctx.send(message);
  assert.strictEqual(bridge.osc.length, 1, "open again once delivery is over");
  assert.strictEqual(bridge.oscListenerCount(), 0);
});

test("another device's state is adopted without sending or sharing it back", () => {
  const bridge = fakeBridge();
  const ctx = standalone.contextFor(fakeElement(), {}, bridge, "w1");
  let seen = null;
  ctx.onShared((state) => {
    seen = state;
    quietly(() => {
      ctx.send({ ip: "x", port: 1, address: "/x", args: [1] });
      ctx.share({ value: 1 });
    });
  });
  bridge.othersShow("w1", { value: 9 });
  assert.deepStrictEqual(seen, { value: 9 });
  assert.deepStrictEqual(bridge.osc, []);
  assert.deepStrictEqual(bridge.shared, []);
});

test("two copies of the page agree: a hand shares, and the release travels with it", () => {
  const el = exported("oscar-slider", {}, "fader7");
  const bridge = fakeBridge();
  standalone.attachAll(fakeDocument([el]), bridge);

  el.value = "30";
  el.fire("input");
  assert.deepStrictEqual(bridge.shared, [{ id: "fader7", state: { value: 30 }, how: { heard: false, release: undefined } }]);

  bridge.othersShow("fader7", { value: 80 });
  assert.strictEqual(el.value, "80");
  assert.strictEqual(bridge.osc.length, 1, "only the hand's own move went out");

  const ctx = standalone.contextFor(fakeElement(), {}, bridge, "b1");
  ctx.share({ on: true }, { release: { on: false } });
  assert.deepStrictEqual(bridge.shared[1].how, { heard: false, release: { on: false } });
});

test("a bridge that is not a surface offers no sharing, and one that cannot receive no onOsc", () => {
  const bare = { socket: { connected: true }, sendOSC() {} };
  const ctx = standalone.contextFor(fakeElement(), {}, bare, "w1");
  assert.strictEqual(ctx.onOsc, undefined);
  assert.strictEqual(ctx.share, undefined);
  assert.strictEqual(ctx.onShared, undefined);
  assert.strictEqual(ctx.onRewrite, undefined, "nothing rewrites an exported element");
  assert.strictEqual(typeof ctx.onChange([], () => {}), "function", "widgets are owed an unsubscribe");
});

test("set is the widget's scratch space and get reads it back", () => {
  const config = { value: 1 };
  const ctx = standalone.contextFor(fakeElement(), config, fakeBridge(), "w1");
  ctx.set("value", 2);
  assert.strictEqual(ctx.get("value"), 2);
  const el = fakeElement();
  const onEl = standalone.contextFor(el, config, fakeBridge(), "w1");
  onEl.setClass("toggle", true);
  assert.ok(el.classList.contains("toggle"));
  onEl.setClass("toggle", false);
  assert.ok(!el.classList.contains("toggle"));
});

// ---- inert, never default ------------------------------------------------------

test("a widget whose settings cannot be read is never attached", () => {
  for (const widget of WIDGETS) {
    const keys = Object.keys(widget.defaults);
    const partial = Object.assign({}, widget.defaults);
    delete partial[keys[0]];

    for (const damage of [undefined, "", "{broken", "[]", JSON.stringify(partial)]) {
      const el = exported(widget.name, {});
      if (damage === undefined) delete el.attributes[CONFIG_ATTR];
      else el.setAttribute(CONFIG_ATTR, damage);

      const bridge = fakeBridge();
      const wired = quietly(() => standalone.attachAll(fakeDocument([el]), bridge));
      assert.strictEqual(wired.attached, 0, widget.name);
      assert.strictEqual(wired.inert, 1, widget.name);
      assert.ok(el.attributes["data-oscar-inert"], "and says why on the element");

      // Nothing listens, so nothing can be sent: not to localhost:7000 either.
      for (const type of ["pointerdown", "pointerup", "click", "input", "change", "keydown", "pointermove"]) {
        assert.strictEqual(el.listenerCount(type), 0, widget.name + " still listens for " + type);
      }
      assert.strictEqual(bridge.oscListenerCount(), 0);
      assert.deepStrictEqual(bridge.osc, []);
    }
  }
});

test("one control that cannot start does not take the surface with it", () => {
  const good = exported("oscar-button", { message: "/go" }, "ok");
  const bad = exported("oscar-button", {}, "bad");
  bad.addEventListener = () => {
    throw new Error("no listeners today");
  };
  const bridge = fakeBridge();
  const wired = quietly(() => standalone.attachAll(fakeDocument([bad, good]), bridge));
  assert.strictEqual(wired.attached, 1);
  assert.strictEqual(wired.inert, 1);
  good.fire("pointerdown");
  assert.strictEqual(bridge.osc[0].address, "/go");
});

// ---- where OSCAR is ------------------------------------------------------------

test("the address comes from the file, or from the page's address, and from nowhere else", () => {
  const baked = { host: "192.168.0.5", port: 8081 };
  assert.deepStrictEqual(standalone.resolveEndpoint(baked, ""), { host: "192.168.0.5", port: 8081 });
  assert.deepStrictEqual(standalone.resolveEndpoint(baked, "?oscar-host=10.0.0.2"), { host: "10.0.0.2", port: 8081 });
  assert.deepStrictEqual(standalone.resolveEndpoint(baked, "?oscar-port=9091&x=1"), { host: "192.168.0.5", port: 9091 });
  assert.deepStrictEqual(standalone.resolveEndpoint(null, "?oscar-host=stage.local&oscar-port=9091"), {
    host: "stage.local",
    port: 9091,
  });

  // No third source: a page that guesses localhost may find somebody's OSCAR.
  for (const nothing of [undefined, null, {}, { host: "", port: "" }, { host: "x" }, { port: 8081 }, { host: "x", port: 0 }]) {
    assert.ok(standalone.resolveEndpoint(nothing, "").error, JSON.stringify(nothing));
  }
  // An override that cannot be read is refused, not skipped: whoever typed it
  // meant the page to go somewhere else.
  assert.match(standalone.resolveEndpoint(baked, "?oscar-host=").error, /oscar-host/);
  assert.match(standalone.resolveEndpoint(baked, "?oscar-host=http://x").error, /oscar-host/);
  assert.match(standalone.resolveEndpoint(baked, "?oscar-port=").error, /oscar-port/);
  assert.match(standalone.resolveEndpoint(baked, "?oscar-port=abc").error, /oscar-port/);
});

function startPage(env) {
  const el = exported("oscar-button", { message: "/go" });
  const doc = fakeDocument([el]);
  const bridge = fakeBridge();
  bridge.socket.connected = false;
  const connects = [];
  const result = standalone.start(
    Object.assign(
      {
        document: doc,
        baked: { host: "192.168.0.5", port: 8081 },
        search: "",
        connect(host, port) {
          connects.push({ host, port });
          return bridge;
        },
      },
      env
    )
  );
  return { el, doc, bridge, connects, result, banner: doc.body.children[0] };
}

test("the page says it cannot reach OSCAR for as long as it cannot, and never eats a press", () => {
  const { el, bridge, connects, banner } = startPage();
  assert.deepStrictEqual(connects, [{ host: "192.168.0.5", port: 8081 }]);

  assert.strictEqual(banner.attributes["data-oscar-status"], "waiting");
  assert.match(banner.textContent, /192\.168\.0\.5:8081/);
  assert.match(banner.attributes.style, /pointer-events:none/);

  bridge.socket.fire("connect_error");
  assert.strictEqual(banner.attributes["data-oscar-status"], "offline");
  assert.match(banner.textContent, /send nothing until OSCAR is running/);
  assert.match(banner.textContent, /a browser cannot send OSC or DMX by itself/);
  assert.match(banner.attributes.style, /pointer-events:none/);
  assert.match(banner.attributes.style, /opacity:1/);

  el.fire("pointerdown");
  assert.deepStrictEqual(bridge.osc, []);
  el.fire("pointerup");

  bridge.socket.fire("connect");
  assert.strictEqual(banner.attributes["data-oscar-status"], "online");
  assert.match(banner.attributes.style, /pointer-events:none/);
  el.fire("pointerdown");
  assert.strictEqual(bridge.osc.length, 1);

  bridge.socket.fire("disconnect");
  assert.strictEqual(banner.attributes["data-oscar-status"], "offline");
  assert.match(banner.attributes.style, /opacity:1/, "back up at once, even if it was fading");
});

test("with nowhere to send, nothing is connected and nothing is attached", () => {
  const { el, connects, result, banner } = startPage({ baked: undefined });
  assert.ok(result.error);
  assert.deepStrictEqual(connects, []);
  assert.strictEqual(banner.attributes["data-oscar-status"], "offline");
  assert.match(banner.textContent, /does not say where OSCAR is/);
  assert.strictEqual(el.listenerCount("pointerdown"), 0);
});

test("a file without its socket.io client says so instead of looking alive", () => {
  const { el, result, banner } = startPage({ connect: null });
  assert.ok(result.error);
  assert.match(banner.textContent, /socket\.io/);
  assert.strictEqual(el.listenerCount("pointerdown"), 0);
});

test("the banner counts the controls that are switched off", () => {
  const broken = exported("oscar-button", {});
  broken.setAttribute(CONFIG_ATTR, "{broken");
  const doc = fakeDocument([broken]);
  const bridge = fakeBridge();
  quietly(() =>
    standalone.start({ document: doc, baked: { host: "x", port: 1 }, search: "", connect: () => bridge })
  );
  assert.match(doc.body.children[0].textContent, /1 control\(s\) on this page are switched off/);
});

// ---- the seam -------------------------------------------------------------------

test("the exported page's runtime knows no editor and asks no server where it is", () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const dir = path.join(__dirname, "..", "..", "public", "src");
  for (const file of ["adapters/standalone.js", "oscar_runtime.js"]) {
    const code = strip(fs.readFileSync(path.join(dir, file), "utf8"));
    assert.ok(!/grapesjs|DomComponents|BlockManager/i.test(code), file + " depends on the editor");
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|["'`]\/connection/.test(code), file + " asks a server where OSCAR is");
    // Not a widget list: what runs is whatever WIDGETS holds.
    for (const widget of WIDGETS) assert.ok(!code.includes(widget.name), file + " names " + widget.name);
  }
});
