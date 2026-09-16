"use strict";

/**
 * Widget state travelling between the devices on one surface.
 *
 * The wiring is driven with stand-in sockets first, so that who is told what
 * can be read off a list; then the same rules are run through two real
 * widgets, and finally through a real socket.io server, which is the one
 * place `broadcast` means what socket.io says it means.
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { SharedState } = require("../lib/shared-state");
const { join, reset, sharedSync } = require("../lib/shared-sync");
const { slider } = require("../lib/widgets/slider");
const { button } = require("../lib/widgets/button");
const { mount } = require("./helpers/widgets");

/**
 * A server's worth of connected devices. Each socket records what the server
 * sent it, and `say` is the device sending the server something.
 */
function fakeRoom() {
  const sockets = [];
  const roomHandlers = {};
  const io = {
    sockets,
    on(event, fn) {
      (roomHandlers[event] = roomHandlers[event] || []).push(fn);
    },
    emit(event, payload) {
      for (const socket of sockets) socket.emit(event, payload);
    },
    /** A device connects, as socket.io would announce it. */
    connect() {
      const handlers = {};
      const socket = {
        received: [],
        emit(event, payload) {
          // socket.io serialises what it sends; a copy keeps a test from
          // seeing a reference the wire would never carry.
          this.received.push({ event, payload: JSON.parse(JSON.stringify(payload)) });
        },
        on(event, fn) {
          (handlers[event] = handlers[event] || []).push(fn);
        },
        say(event, payload) {
          for (const fn of handlers[event] || []) fn(payload);
        },
        broadcast: {
          emit(event, payload) {
            for (const other of sockets) if (other !== socket) other.emit(event, payload);
          },
        },
        /** Everything this device was sent after it was handed the snapshot. */
        told() {
          return this.received.slice(1);
        },
      };
      sockets.push(socket);
      for (const fn of roomHandlers.connection || []) fn(socket);
      return socket;
    },
  };
  return io;
}

test("a device is handed everything on connect, and empty is still an answer", () => {
  const store = new SharedState();
  store.apply("w1", { on: true });
  const room = fakeRoom();
  const a = room.connect();
  join(store, a);
  assert.deepStrictEqual(a.received, [{ event: "state:all", payload: { w1: { on: true } } }]);

  const b = room.connect();
  join(new SharedState(), b);
  assert.deepStrictEqual(b.received, [{ event: "state:all", payload: {} }]);
});

test("A sets: only B is told, never A", () => {
  const store = new SharedState();
  const room = fakeRoom();
  const a = room.connect();
  const b = room.connect();
  join(store, a);
  join(store, b);

  a.say("state:set", { id: "w1", state: { value: 40 } });
  assert.deepStrictEqual(b.told(), [{ event: "state:changed", payload: { id: "w1", state: { value: 40 } } }]);
  assert.deepStrictEqual(a.told(), [], "the sender already knows");
  assert.deepStrictEqual(store.get("w1"), { value: 40 });
});

test("B echoes the same value back: nothing is broadcast to anyone", () => {
  // The ping-pong guard. Without it A would be told 40, say 40 back, B would
  // be told 40, say 40 back, for as long as the socket stayed up.
  const store = new SharedState();
  const room = fakeRoom();
  const a = room.connect();
  const b = room.connect();
  join(store, a);
  join(store, b);

  a.say("state:set", { id: "w1", state: { value: 40 } });
  b.say("state:set", { id: "w1", state: { value: 40 } });
  assert.deepStrictEqual(a.told(), []);
  assert.strictEqual(b.told().length, 1, "only the first change");

  // A real change from B goes back the other way, once.
  b.say("state:set", { id: "w1", state: { value: 41 } });
  assert.deepStrictEqual(a.told(), [{ event: "state:changed", payload: { id: "w1", state: { value: 41 } } }]);
  assert.strictEqual(b.told().length, 1);
});

test("a late joiner receives the snapshot, and is then told changes like everyone else", () => {
  const store = new SharedState();
  const room = fakeRoom();
  const a = room.connect();
  join(store, a);
  a.say("state:set", { id: "w1", state: { on: true } });
  a.say("state:set", { id: "pad", state: { x: 1, y: 2 } });

  const late = room.connect();
  join(store, late);
  assert.deepStrictEqual(late.received, [
    { event: "state:all", payload: { w1: { on: true }, pad: { x: 1, y: 2 } } },
  ]);

  a.say("state:set", { id: "w1", state: { on: false } });
  assert.deepStrictEqual(late.told(), [{ event: "state:changed", payload: { id: "w1", state: { on: false } } }]);
});

test("a change is broadcast as the widget's whole state, so one axis moving carries the other", () => {
  const store = new SharedState();
  const room = fakeRoom();
  const a = room.connect();
  const b = room.connect();
  join(store, a);
  join(store, b);
  a.say("state:set", { id: "pad", state: { x: 1, y: 2 } });
  a.say("state:set", { id: "pad", state: { x: 1, y: 3 } });
  assert.deepStrictEqual(b.told().map((m) => m.payload.state), [{ x: 1, y: 2 }, { x: 1, y: 3 }]);
});

test("a new layout empties the record and tells every device so", () => {
  const store = new SharedState();
  const room = fakeRoom();
  const a = room.connect();
  const b = room.connect();
  join(store, a);
  join(store, b);
  a.say("state:set", { id: "w1", state: { on: true } });

  reset(store, room);
  assert.deepStrictEqual(store.snapshot(), {});
  assert.deepStrictEqual(a.told(), [{ event: "state:all", payload: {} }]);
  assert.deepStrictEqual(b.told().pop(), { event: "state:all", payload: {} });

  // A widget with the old id turning up again starts from nothing.
  const late = room.connect();
  join(store, late);
  assert.deepStrictEqual(late.received, [{ event: "state:all", payload: {} }]);
});

test("garbage from a device changes nothing, tells nobody, and does not throw", () => {
  const store = new SharedState();
  const room = fakeRoom();
  const a = room.connect();
  const b = room.connect();
  join(store, a);
  join(store, b);
  for (const junk of [null, undefined, 7, "x", [], {}, { id: 1 }, { id: "w1" }, { id: "w1", state: [1] }, { state: { on: true } }]) {
    assert.doesNotThrow(() => a.say("state:set", junk), JSON.stringify(junk));
  }
  assert.deepStrictEqual(b.told(), []);
  assert.strictEqual(store.size, 0);
});

test("sharedSync wires every device that connects, and reset reaches them all", () => {
  const room = fakeRoom();
  const sync = sharedSync(room);
  const a = room.connect();
  const b = room.connect();
  a.say("state:set", { id: "w1", state: { value: 1 } });
  assert.deepStrictEqual(sync.store.get("w1"), { value: 1 });
  assert.strictEqual(b.told().length, 1);
  sync.reset();
  assert.strictEqual(sync.store.size, 0);
  assert.deepStrictEqual(a.told(), [{ event: "state:all", payload: {} }]);
});

// --- two real widgets, one record --------------------------------------------

/**
 * A widget mounted on a device: its ctx.share goes to the server as
 * state:set, and what the server sends back is delivered to it, through the
 * fake host's gate, which throws on a send or a share made in answer.
 */
function device(room, store, widget, overrides) {
  const socket = room.connect();
  const mounted = mount(widget, Object.assign({ listen: true }, overrides));
  const id = "w1";
  const share = mounted.ctx.share.bind(mounted.ctx);
  mounted.ctx.share = (state) => {
    share(state);
    socket.say("state:set", { id, state });
  };
  // What the server pushes at this device is delivered the way the socket
  // plugin would deliver it: the snapshot on connect included.
  const emit = socket.emit.bind(socket);
  socket.emit = (event, payload) => {
    emit(event, payload);
    if (event === "state:changed" && payload.id === id) mounted.ctx.receiveShared(payload.state);
    if (event === "state:all" && payload[id]) mounted.ctx.receiveShared(payload[id]);
  };
  join(store, socket);
  return Object.assign(mounted, { socket });
}

test("a hand on A moves B, and B does not send or share anything in answer", () => {
  const store = new SharedState();
  const room = fakeRoom();
  const a = device(room, store, slider);
  const b = device(room, store, slider);

  a.el.value = "70";
  a.el.fire("input");
  assert.strictEqual(a.ctx.sent.length, 1, "A put it on the wire");
  assert.strictEqual(b.el.value, "70", "B's thumb followed");
  assert.deepStrictEqual(b.ctx.sent, [], "B did not send it again");
  assert.deepStrictEqual(b.ctx.shared, [], "B did not share it again");
  assert.deepStrictEqual(a.socket.told(), [], "and nothing came back to A");
});

test("a value adopted from incoming OSC is shared once, and dies on the unchanged-value guard on the way back", () => {
  // Both devices hear the rig (the server relays every OSC message to every
  // browser), so both adopt and both share. The first share is news and
  // reaches the other device, which adopts it and shares nothing; the
  // second share says what the record already holds, and stops there.
  const store = new SharedState();
  const room = fakeRoom();
  const a = device(room, store, slider);
  const b = device(room, store, slider);

  a.ctx.receive("/slider1", [35]);
  b.ctx.receive("/slider1", [35]);

  assert.deepStrictEqual(a.ctx.shared, [{ value: 35 }], "A shared what the rig said, once");
  assert.deepStrictEqual(b.ctx.shared, [{ value: 35 }], "B too");
  assert.deepStrictEqual(store.get("w1"), { value: 35 });
  assert.strictEqual(b.socket.told().length, 1, "B was told A's share");
  assert.deepStrictEqual(a.socket.told(), [], "B's identical share was no news");
  assert.deepStrictEqual(a.ctx.sent.concat(b.ctx.sent), [], "and nothing went to the rig");
  assert.strictEqual(a.el.value, "35");
  assert.strictEqual(b.el.value, "35");
});

test("a toggle pressed on A is on at B, so B's next press sends the OFF edge", () => {
  const store = new SharedState();
  const room = fakeRoom();
  const a = device(room, store, button, { mode: "toggle", argType: "i" });
  const b = device(room, store, button, { mode: "toggle", argType: "i" });

  a.el.fire("click");
  assert.deepStrictEqual(a.ctx.sent.map((m) => m.args[0].value), [1]);
  assert.strictEqual(b.ctx.classes.toggle, true, "B lit up");
  assert.deepStrictEqual(b.ctx.sent, []);

  b.el.fire("click");
  assert.deepStrictEqual(b.ctx.sent.map((m) => m.args[0].value), [0], "the opposite edge, not ON again");
  assert.strictEqual(a.ctx.classes.toggle, false, "and A followed");
  assert.deepStrictEqual(store.get("w1"), { on: false });
});

test("a device joining late starts where the others are", () => {
  const store = new SharedState();
  const room = fakeRoom();
  const a = device(room, store, slider);
  a.el.value = "22";
  a.el.fire("input");

  const late = device(room, store, slider);
  assert.strictEqual(late.el.value, "22");
  assert.strictEqual(late.ctx.config.value, 22);
  assert.deepStrictEqual(late.ctx.shared, [], "adopted, not re-shared");
});

// --- the real thing -----------------------------------------------------------

// socket.io-client is a browser library, installed with the rest of them
// under public/; the server side does not depend on it.
let ioClient = null;
try {
  ioClient = require(path.join(__dirname, "..", "public", "node_modules", "socket.io-client"));
} catch (err) {
  ioClient = null;
}

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

/** Resolve with the next `event`, or with null if none arrives in time. */
function within(socket, event, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve(null);
    }, ms);
    function onEvent(payload) {
      clearTimeout(timer);
      resolve(payload);
    }
    socket.once(event, onEvent);
  });
}

test("over a real socket.io server: A sets, only B hears; B echoes, nobody hears; C joins late and is caught up", {
  skip: !ioClient && "browser libraries not installed (run npm install)",
}, async (t) => {
  const { Server } = require("socket.io");
  const io = new Server(0, { cors: { origin: "*" } });
  const sync = sharedSync(io);
  const port = io.httpServer.address().port;
  const clients = [];
  const connect = async () => {
    const client = ioClient("http://127.0.0.1:" + port, { transports: ["websocket"], forceNew: true });
    clients.push(client);
    const all = await once(client, "state:all");
    return { client, all };
  };
  t.after(async () => {
    for (const client of clients) client.close();
    await new Promise((resolve) => io.close(resolve));
  });

  const a = await connect();
  const b = await connect();
  assert.deepStrictEqual(a.all, {});
  assert.deepStrictEqual(b.all, {});

  const bHears = within(b.client, "state:changed", 2000);
  const aHears = within(a.client, "state:changed", 300);
  a.client.emit("state:set", { id: "w1", state: { value: 40 } });
  assert.deepStrictEqual(await bHears, { id: "w1", state: { value: 40 } });
  assert.strictEqual(await aHears, null, "the sender is never echoed to");

  const aQuiet = within(a.client, "state:changed", 300);
  const bQuiet = within(b.client, "state:changed", 300);
  b.client.emit("state:set", { id: "w1", state: { value: 40 } });
  assert.strictEqual(await aQuiet, null, "an echo is no news");
  assert.strictEqual(await bQuiet, null);

  const c = await connect();
  assert.deepStrictEqual(c.all, { w1: { value: 40 } }, "the late joiner is caught up");

  const everyone = [a, b, c].map((d) => within(d.client, "state:all", 2000));
  sync.reset();
  assert.deepStrictEqual(await Promise.all(everyone), [{}, {}, {}], "a new layout clears every device");
});
