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
  mounted.ctx.share = (state, how) => {
    share(state, how);
    socket.say("state:set", Object.assign({ id, state }, how));
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

test("a value adopted from incoming OSC is recorded for late joiners, and no device is told what it heard itself", () => {
  // Both devices hear the rig (the server relays every OSC message to every
  // browser), so both adopt and both share it as heard. It used to be
  // broadcast like a hand's change: one redundant state:changed per device
  // per message of a fader stream.
  const store = new SharedState();
  const room = fakeRoom();
  const a = device(room, store, slider);
  const b = device(room, store, slider);

  a.ctx.receive("/slider1", [35]);
  b.ctx.receive("/slider1", [35]);

  assert.deepStrictEqual(a.ctx.shared, [{ value: 35 }]);
  assert.deepStrictEqual(a.ctx.sharedHow, [{ heard: true }]);
  assert.deepStrictEqual(store.get("w1"), { value: 35 }, "recorded");
  assert.deepStrictEqual(a.socket.told().concat(b.socket.told()), [], "and nobody was told");
  assert.deepStrictEqual(a.ctx.sent.concat(b.ctx.sent), [], "and nothing went to the rig");

  const c = device(room, store, slider);
  assert.strictEqual(c.el.value, "35", "a device joining later starts where the rig left the thumb");
});

test("a fader stream from the rig never pulls a thumb back to a value the rig has moved on from", () => {
  // A's share of 10 reaches the server after B has already taken 20 from
  // the rig. Broadcast, it stepped B's thumb back to 10 until A's 20 came.
  const store = new SharedState();
  const room = fakeRoom();
  const a = device(room, store, slider);
  const b = device(room, store, slider);
  const late = [];
  const share = a.ctx.share;
  a.ctx.share = (state, how) => late.push(() => share(state, how));

  a.ctx.receive("/slider1", [10]);
  b.ctx.receive("/slider1", [10]);
  b.ctx.receive("/slider1", [20]);
  late.shift()();

  assert.strictEqual(b.el.value, "20", "B stays where the rig put it");
  assert.deepStrictEqual(b.socket.told(), []);
});

test("a device that goes away mid-press lets go of its momentary button on every other device", () => {
  const store = new SharedState();
  const room = fakeRoom();
  const a = device(room, store, button, { mode: "momentary" });
  const b = device(room, store, button, { mode: "momentary" });

  a.el.fire("pointerdown");
  assert.strictEqual(b.ctx.classes.toggle, true, "lit on B while A's finger is down");

  a.socket.say("disconnect", "transport close");
  assert.deepStrictEqual(store.get("w1"), { on: false });
  assert.strictEqual(b.ctx.classes.toggle, false, "and dark once A is gone");
  assert.deepStrictEqual(b.ctx.sent, [], "B sent nothing either time");
});

test("a finger that came up before the device went away leaves nothing to undo, and neither does a toggle", () => {
  const store = new SharedState();
  const room = fakeRoom();
  const a = device(room, store, button, { mode: "momentary" });
  const b = device(room, store, button, { mode: "momentary" });
  a.el.fire("pointerdown");
  a.el.fire("pointerup");
  b.el.fire("pointerdown");
  a.socket.say("disconnect", "transport close");
  assert.deepStrictEqual(store.get("w1"), { on: true }, "B's press is not undone by A leaving");

  const store2 = new SharedState();
  const room2 = fakeRoom();
  const t = device(room2, store2, button, { mode: "toggle" });
  t.el.fire("click");
  t.socket.say("disconnect", "transport close");
  assert.deepStrictEqual(store2.get("w1"), { on: true }, "a toggle outlives the device that set it");
});

test("a release is not a way to park a payload on the server, nor to bring back a forgotten record", () => {
  const store = new SharedState();
  const room = fakeRoom();
  const a = room.connect();
  const b = room.connect();
  join(store, a);
  join(store, b);

  a.say("state:set", { id: "w1", state: { on: true }, release: { on: { deep: "x".repeat(1000) } } });
  a.say("state:set", { id: "w2", state: { on: true }, release: { on: false } });
  reset(store, room);
  a.say("disconnect");
  assert.strictEqual(store.size, 0, "w2 was forgotten with its layout and stays forgotten");
  assert.deepStrictEqual(
    b.told().filter((m) => m.event === "state:changed").map((m) => m.payload.id),
    ["w1", "w2"],
    "B heard the two presses and nothing after"
  );
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

// --- a widget on a page that is not showing ------------------------------------

test("state:sync hands the asking device everything again, writes nothing and tells nobody else", () => {
  const store = new SharedState();
  store.apply("w1", { value: 12 });
  const room = fakeRoom();
  const a = room.connect();
  const b = room.connect();
  join(store, a);
  join(store, b);

  a.say("state:sync");
  assert.deepStrictEqual(a.told(), [{ event: "state:all", payload: { w1: { value: 12 } } }]);
  assert.deepStrictEqual(b.told(), [], "one device turning a page is nobody else's business");
  assert.deepStrictEqual(store.snapshot(), { w1: { value: 12 } });

  // Whatever a page sends along with it is ignored, not applied.
  assert.doesNotThrow(() => a.say("state:sync", { w1: { value: 0 } }));
  assert.deepStrictEqual(store.get("w1"), { value: 12 });
});

test("a fader on a page that was not showing opens where the rig left it", () => {
  // The gap multiple pages opened. Tablet A shows the page with the fader and
  // hears the rig move it; that is recorded as `heard` and told to nobody.
  // Tablet B is on another page: GrapesJS has built no view for the fader, so
  // nothing on B is listening to the rig or to the server, and the snapshot B
  // was handed on connect predates the move. Turning to the page, B asks
  // again; without that its thumb sat at the project's default beside A's.
  const store = new SharedState();
  const room = fakeRoom();
  const a = device(room, store, slider);

  // B: connected, but the fader's page is not on its canvas.
  const bSocket = room.connect();
  join(store, bSocket);

  a.ctx.receive("/slider1", [64]);
  assert.deepStrictEqual(bSocket.told(), [], "B was told nothing, by design");

  // B turns the page: the widget attaches, and the page asks for everything.
  bSocket.say("state:sync");
  const answer = bSocket.told().pop();
  assert.strictEqual(answer.event, "state:all");

  const b = mount(slider, { listen: true });
  b.ctx.receiveShared(answer.payload.w1);
  assert.strictEqual(b.el.value, "64");
  assert.deepStrictEqual(b.ctx.sent, [], "opening a page sends nothing to the rig");
  assert.deepStrictEqual(b.ctx.shared, [], "and what was adopted is not shared back");
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

  // What the rig told everyone is recorded and passed to nobody.
  const heardQuiet = within(b.client, "state:changed", 300);
  a.client.emit("state:set", { id: "w1", state: { value: 55 }, heard: true });
  assert.strictEqual(await heardQuiet, null, "a heard value is not broadcast");
  assert.deepStrictEqual(sync.store.get("w1"), { value: 55 }, "but it is recorded");

  // A device that goes away mid-press lets go for everyone. The broadcast is
  // made from inside socket.io's own disconnect event, which is the one place
  // a stand-in cannot vouch for.
  const pressed = within(b.client, "state:changed", 2000);
  c.client.emit("state:set", { id: "btn", state: { on: true }, release: { on: false } });
  assert.deepStrictEqual(await pressed, { id: "btn", state: { on: true } });
  const letGo = within(b.client, "state:changed", 2000);
  c.client.close();
  assert.deepStrictEqual(await letGo, { id: "btn", state: { on: false } });

  const everyone = [a, b].map((d) => within(d.client, "state:all", 2000));
  sync.reset();
  assert.deepStrictEqual(await Promise.all(everyone), [{}, {}], "a new layout clears every device");
});
