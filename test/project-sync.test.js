"use strict";

// Saving as you edit (lib/project-sync.js), driven with a stand-in for OSCAR,
// for the editor and for the clock, so that every path can be read off:
// what is sent and when, what is kept until it is confirmed, and what is
// never written over.

const test = require("node:test");
const assert = require("node:assert");

const { createProjectSync, SAVE_AFTER, SETTLE_AFTER, RETRY_FIRST } = require("../lib/project-sync");
const { createOpenProject } = require("../lib/open-project");

function fakeStorage(initial) {
  const held = Object.assign({}, initial);
  return {
    held,
    getItem: (key) => (key in held ? held[key] : null),
    setItem: (key, value) => {
      held[key] = String(value);
    },
    removeItem: (key) => {
      delete held[key];
    },
  };
}

/** OSCAR's projects, as the routes answer for them. */
function fakeOscar() {
  const projects = new Map(); // id -> { id, name, rev, data }
  const calls = [];
  let down = false;
  let n = 0;
  const answer = (status, body) => Promise.resolve({ ok: status < 400, status, body });
  const reach = (what, run) => {
    calls.push(what);
    return down ? Promise.reject(new TypeError("fetch failed")) : run();
  };
  return {
    projects,
    calls,
    setDown: (value) => {
      down = value;
    },
    api: {
      read: (id) => reach("read " + id, () => (projects.has(id) ? answer(200, JSON.parse(JSON.stringify(projects.get(id)))) : answer(404, { error: "That project is not in OSCAR." }))),
      create: (body) =>
        reach("create" + (body.id ? " " + body.id : ""), () => {
          const id = body.id && !projects.has(body.id) ? body.id : body.id && body.ifExists === "replace" ? body.id : "p-made" + String(++n).padStart(8, "0");
          const rev = projects.has(id) ? projects.get(id).rev + 1 : 1;
          projects.set(id, { id, name: body.name, rev, data: JSON.parse(JSON.stringify(body.data)) });
          return answer(200, { id, name: body.name, rev });
        }),
      write: (id, body) =>
        reach("write " + id + (Number.isInteger(body.baseRev) ? " from " + body.baseRev : " over"), () => {
          const held = projects.get(id);
          if (!held) return answer(404, { error: "That project is not in OSCAR." });
          if (Number.isInteger(body.baseRev) && body.baseRev !== held.rev) return answer(409, { conflict: true, rev: held.rev, name: held.name, error: "changed somewhere else" });
          const next = { id, name: body.name || held.name, rev: held.rev + 1, data: body.data !== undefined ? JSON.parse(JSON.stringify(body.data)) : held.data };
          projects.set(id, next);
          return answer(200, { id, name: next.name, rev: next.rev });
        }),
      copy: (id) =>
        reach("copy " + id, () => {
          const held = projects.get(id);
          if (!held) return answer(404, {});
          const made = "p-copy" + String(++n).padStart(8, "0");
          projects.set(made, { id: made, name: "Copy of " + held.name, rev: 1, data: held.data });
          return answer(200, { id: made, name: "Copy of " + held.name, rev: 1 });
        }),
    },
  };
}

/** A clock that only moves when told to. */
function fakeClock() {
  let timers = [];
  let at = 0;
  return {
    setTimer: (fn, ms) => {
      const timer = { fn, due: at + ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timers = timers.filter((other) => other !== timer);
    },
    /** Let `ms` pass, running what falls due, and whatever those start. */
    async pass(ms) {
      // What was just started may set its timer a few promise turns from now.
      await settle();
      const until = at + ms;
      for (;;) {
        const next = timers.filter((t) => t.due <= until).sort((a, b) => a.due - b.due)[0];
        if (!next) break;
        timers = timers.filter((t) => t !== next);
        at = next.due;
        next.fn();
        await settle();
      }
      at = until;
      await settle();
    },
    waiting: () => timers.length,
  };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const canvasOf = (text) => ({ pages: [{ name: "Page 1", frames: [{ component: { type: "wrapper", components: text ? [{ type: "text", content: text }] : [] } }] }] });

function setUp(options = {}) {
  const storage = fakeStorage(options.storage);
  const pointer = createOpenProject(storage);
  const oscar = options.oscar || fakeOscar();
  const clock = fakeClock();
  const editor = { data: canvasOf(options.canvas === undefined ? "" : options.canvas) };
  const seen = { status: [], names: [], asked: [], opened: [] };
  let answerConflict = options.conflict || "mine";
  const sync = createProjectSync({
    pointer,
    api: oscar.api,
    getData: () => JSON.parse(JSON.stringify(editor.data)),
    loadData: (data) => {
      editor.data = JSON.parse(JSON.stringify(data));
    },
    isEmpty: () => editor.data.pages[0].frames[0].component.components.length === 0,
    onStatus: (status) => seen.status.push(status),
    onName: (name) => seen.names.push(name),
    conflict: (info) => {
      seen.asked.push(info.name);
      return answerConflict === "nothing" ? new Promise(() => {}) : Promise.resolve(answerConflict);
    },
    keepOpened: (id, data) => seen.opened.push([id, JSON.stringify(data)]),
    grapesjs: "0.22",
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  /** The person types: the canvas changes, and the editor says so. */
  const type = (text) => {
    editor.data = canvasOf(text);
    sync.changed();
  };
  return { sync, pointer, storage, oscar, clock, editor, seen, type, setConflict: (v) => (answerConflict = v) };
}

// ---- a canvas that is nobody yet ----------------------------------------------------

test("a canvas that was only looked at leaves nothing behind; its first change makes it a project", async () => {
  const s = setUp();
  await s.sync.start();
  assert.strictEqual(s.sync.status(), "new");
  assert.deepStrictEqual(s.oscar.calls, [], "an empty first launch asks OSCAR nothing");

  // The editor says "changed" while it settles; nothing actually did.
  s.sync.changed();
  await s.clock.pass(SAVE_AFTER);
  assert.deepStrictEqual(s.oscar.calls, []);
  assert.strictEqual(s.pointer.get().dirty, false);

  s.type("hello");
  assert.strictEqual(s.pointer.get().dirty, true, "dirty from the first change");
  assert.deepStrictEqual(s.oscar.calls, [], "and sent a moment after, not at once");
  await s.clock.pass(SAVE_AFTER);
  assert.deepStrictEqual(s.oscar.calls, ["create"]);
  const now = s.pointer.get();
  assert.deepStrictEqual([now.id, now.name, now.rev, now.dirty, now.fresh], ["p-made00000001", "Untitled", 1, false, false]);
  assert.deepStrictEqual(s.oscar.projects.get(now.id).data, canvasOf("hello"));
  assert.strictEqual(s.sync.status(), "saved");
});

test("a template is nobody until changed, and is named after itself when it is", async () => {
  const s = setUp();
  await s.sync.start();
  const begun = s.sync.begin("Boombox", () => (s.editor.data = canvasOf("a boombox")));
  await s.clock.pass(SETTLE_AFTER);
  await begun;
  assert.deepStrictEqual([s.pointer.get().name, s.pointer.get().fresh, s.sync.status()], ["Boombox", true, "new"]);
  assert.deepStrictEqual(s.oscar.calls, []);

  // A reload: still nobody, still nothing asked of OSCAR.
  const again = setUp({ storage: s.storage.held, canvas: "a boombox", oscar: s.oscar });
  await again.sync.start();
  assert.deepStrictEqual(again.oscar.calls, [], "a template that was only looked at is not taken for work from before");

  again.type("a louder boombox");
  await again.clock.pass(SAVE_AFTER);
  assert.strictEqual(again.oscar.projects.get(again.pointer.get().id).name, "Boombox");
});

test("a canvas from before projects lived in OSCAR is carried over as the editor opens", async () => {
  // Work on the canvas, and nothing beside it saying who it is.
  const s = setUp({ canvas: "the show I built last month" });
  await s.sync.start();
  assert.deepStrictEqual(s.oscar.calls, ["create"]);
  const now = s.pointer.get();
  assert.strictEqual(s.oscar.projects.get(now.id).name, "Untitled");
  assert.deepStrictEqual(s.oscar.projects.get(now.id).data, canvasOf("the show I built last month"));

  // One this browser already knew by id (it was published, or opened from a file): the same id, and its name.
  const known = setUp({ canvas: "lobby", storage: { "oscarProject.open": JSON.stringify({ id: "p-known0000001", name: "Lobby visitors" }) } });
  await known.sync.start();
  assert.deepStrictEqual(known.oscar.calls, ["read p-known0000001", "write p-known0000001 from 0", "create p-known0000001"]);
  assert.deepStrictEqual([known.oscar.projects.get("p-known0000001").name, known.pointer.get().rev], ["Lobby visitors", 1]);
});

// ---- saving as you edit --------------------------------------------------------------

test("a burst of changes is one save, a moment after the last; a change during a save goes after it", async () => {
  const s = setUp();
  await s.sync.start();
  s.type("a");
  await s.clock.pass(SAVE_AFTER - 1);
  s.type("ab");
  await s.clock.pass(SAVE_AFTER - 1);
  s.type("abc");
  assert.deepStrictEqual(s.oscar.calls, [], "the burst is still going");
  await s.clock.pass(SAVE_AFTER);
  assert.deepStrictEqual(s.oscar.calls, ["create"]);
  const id = s.pointer.get().id;

  // Typed between the save leaving and its answer arriving.
  s.oscar.calls.length = 0;
  s.type("abcd");
  const flushing = s.sync.flush();
  s.type("abcde");
  await flushing;
  await s.clock.pass(SAVE_AFTER);
  assert.deepStrictEqual(s.oscar.calls, ["write " + id + " from 1", "write " + id + " from 2"]);
  assert.deepStrictEqual(s.oscar.projects.get(id).data, canvasOf("abcde"), "nothing typed is left behind");
  assert.deepStrictEqual([s.pointer.get().rev, s.pointer.get().dirty, s.sync.status()], [3, false, "saved"]);
});

test("nothing is forgotten until OSCAR says it holds it: a save that fails is tried again, and says so", async () => {
  const s = setUp();
  await s.sync.start();
  s.oscar.setDown(true);
  s.type("written with the server off");
  await s.clock.pass(SAVE_AFTER);
  assert.strictEqual(s.sync.status(), "unsaved");
  assert.strictEqual(s.pointer.get().dirty, true, "still owed");
  assert.strictEqual(s.oscar.projects.size, 0);

  // Still off at the first retry; back for the second, which waits longer.
  await s.clock.pass(RETRY_FIRST);
  assert.strictEqual(s.sync.status(), "unsaved");
  s.oscar.setDown(false);
  await s.clock.pass(RETRY_FIRST * 2);
  assert.strictEqual(s.sync.status(), "saved");
  assert.deepStrictEqual(s.oscar.projects.get(s.pointer.get().id).data, canvasOf("written with the server off"));
  assert.strictEqual(s.pointer.get().dirty, false);
});

test("a browser closed before its save went through sends it the next time it opens", async () => {
  const oscar = fakeOscar();
  const first = setUp({ oscar });
  await first.sync.start();
  first.type("one");
  await first.clock.pass(SAVE_AFTER);
  const id = first.pointer.get().id;
  first.type("two, and then the laptop lid closed");
  // No time passes: the save never left. The canvas and the pointer are what the browser kept.

  const next = setUp({ oscar, storage: first.storage.held, canvas: "two, and then the laptop lid closed" });
  assert.strictEqual(next.pointer.get().dirty, true);
  await next.sync.start();
  assert.deepStrictEqual(oscar.projects.get(id).data, canvasOf("two, and then the laptop lid closed"));
  assert.deepStrictEqual([next.pointer.get().rev, next.pointer.get().dirty], [2, false]);
});

// ---- two windows, two devices --------------------------------------------------------

test("a project changed somewhere else is taken as it is there, when nothing here is unsaved", async () => {
  const oscar = fakeOscar();
  oscar.projects.set("p-lobby0000001", { id: "p-lobby0000001", name: "Lobby", rev: 5, data: canvasOf("edited on the other laptop") });
  const s = setUp({ oscar, canvas: "as this browser last saw it", storage: { "oscarProject.open": JSON.stringify({ id: "p-lobby0000001", name: "Lobby", rev: 3 }) } });
  const starting = s.sync.start();
  await s.clock.pass(SETTLE_AFTER);
  await starting;
  assert.deepStrictEqual(s.editor.data, canvasOf("edited on the other laptop"));
  assert.deepStrictEqual([s.pointer.get().rev, s.sync.status()], [5, "saved"]);
  assert.deepStrictEqual(oscar.calls, ["read p-lobby0000001"], "taken, not written");
  // Loading it was not the person editing it.
  s.sync.changed();
  await s.clock.pass(SAVE_AFTER);
  assert.deepStrictEqual(oscar.calls, ["read p-lobby0000001"]);
});

test("a project changed somewhere else is never written over without asking", async () => {
  const oscar = fakeOscar();
  oscar.projects.set("p-lobby0000001", { id: "p-lobby0000001", name: "Lobby", rev: 2, data: canvasOf("theirs") });

  // Keep mine: written over, knowingly.
  const mine = setUp({ oscar, canvas: "start", conflict: "mine", storage: { "oscarProject.open": JSON.stringify({ id: "p-lobby0000001", name: "Lobby", rev: 1 }) } });
  mine.type("mine");
  await mine.clock.pass(SAVE_AFTER);
  assert.deepStrictEqual(mine.seen.asked, ["Lobby"]);
  assert.deepStrictEqual(oscar.calls, ["write p-lobby0000001 from 1", "write p-lobby0000001 over"]);
  assert.deepStrictEqual([oscar.projects.get("p-lobby0000001").data, mine.pointer.get().rev], [canvasOf("mine"), 3]);

  // Take theirs: this window's version is dropped, and nothing is written.
  oscar.calls.length = 0;
  oscar.projects.set("p-lobby0000001", { id: "p-lobby0000001", name: "Lobby", rev: 9, data: canvasOf("theirs again") });
  const theirs = setUp({ oscar, canvas: "start", conflict: "theirs", storage: { "oscarProject.open": JSON.stringify({ id: "p-lobby0000001", name: "Lobby", rev: 3 }) } });
  theirs.type("mine, soon dropped");
  await theirs.clock.pass(SAVE_AFTER);
  await theirs.clock.pass(SETTLE_AFTER);
  assert.deepStrictEqual(oscar.calls, ["write p-lobby0000001 from 3", "read p-lobby0000001"]);
  assert.deepStrictEqual(theirs.editor.data, canvasOf("theirs again"));
  assert.deepStrictEqual([theirs.pointer.get().rev, theirs.pointer.get().dirty], [9, false]);

  // No answer: nothing is written, and it says so.
  oscar.calls.length = 0;
  const waiting = setUp({ oscar, canvas: "start", conflict: "nothing", storage: { "oscarProject.open": JSON.stringify({ id: "p-lobby0000001", name: "Lobby", rev: 3 }) } });
  waiting.type("mine, waiting");
  await waiting.clock.pass(SAVE_AFTER);
  assert.strictEqual(waiting.sync.status(), "conflict");
  assert.deepStrictEqual(oscar.projects.get("p-lobby0000001").data, canvasOf("theirs again"));
  assert.strictEqual(waiting.pointer.get().dirty, true);
});

test("a project deleted somewhere else while it was being edited here is made again, as who it was", async () => {
  const s = setUp();
  await s.sync.start();
  s.type("one");
  await s.clock.pass(SAVE_AFTER);
  const id = s.pointer.get().id;
  s.oscar.projects.delete(id);
  s.type("two");
  await s.clock.pass(SAVE_AFTER);
  assert.deepStrictEqual(s.oscar.projects.get(id).data, canvasOf("two"));
  assert.strictEqual(s.sync.status(), "saved");
});

// ---- its title, and other projects ---------------------------------------------------

test("renaming says the new title to OSCAR at once, and names a canvas that is nobody yet without making it one", async () => {
  const s = setUp();
  await s.sync.start();
  await s.sync.rename("Lobby visitors");
  assert.deepStrictEqual(s.oscar.calls, [], "nobody yet: only named");
  assert.strictEqual(s.pointer.get().name, "Lobby visitors");

  s.type("content");
  await s.clock.pass(SAVE_AFTER);
  const id = s.pointer.get().id;
  assert.strictEqual(s.oscar.projects.get(id).name, "Lobby visitors");

  await s.sync.rename("  Main hall  ");
  assert.deepStrictEqual([s.oscar.projects.get(id).name, s.oscar.projects.get(id).rev], ["Main hall", 2]);
  assert.deepStrictEqual(s.oscar.projects.get(id).data, canvasOf("content"), "the content is as it was");
  assert.deepStrictEqual(s.seen.names.slice(-1), ["Main hall"]);
  await s.sync.rename("");
  await s.sync.rename("Main hall");
  assert.strictEqual(s.oscar.projects.get(id).rev, 2, "an empty title, or the same one, changes nothing");
});

test("opening another project saves this one first, and loading it is not an edit", async () => {
  const s = setUp();
  s.oscar.projects.set("p-other0000001", { id: "p-other0000001", name: "Bar", rev: 4, data: canvasOf("the bar") });
  await s.sync.start();
  s.type("lobby, not yet saved");
  const opening = s.sync.open("p-other0000001");
  await s.clock.pass(SETTLE_AFTER);
  await opening;
  const lobby = [...s.oscar.projects.values()].find((p) => p.name === "Untitled");
  assert.deepStrictEqual(lobby.data, canvasOf("lobby, not yet saved"), "what was on the canvas reached OSCAR before it left");
  assert.deepStrictEqual(s.editor.data, canvasOf("the bar"));
  assert.deepStrictEqual([s.pointer.get().id, s.pointer.get().name, s.pointer.get().rev], ["p-other0000001", "Bar", 4]);
  assert.deepStrictEqual(s.seen.opened.slice(-1)[0][0], "p-other0000001", "kept as it was when opened, for Revert");

  s.sync.changed();
  await s.clock.pass(SAVE_AFTER);
  assert.strictEqual(s.oscar.projects.get("p-other0000001").rev, 4);

  await assert.rejects(s.sync.open("p-nosuch000001"), /not in OSCAR/);
});

test("publishing needs a project to belong to: a canvas that is nobody becomes one when asked, changed or not", async () => {
  const s = setUp();
  await s.sync.start();
  const begun = s.sync.begin("Boombox", () => (s.editor.data = canvasOf("a boombox")));
  await s.clock.pass(SETTLE_AFTER);
  await begun;
  await s.sync.materialise();
  const now = s.pointer.get();
  assert.deepStrictEqual([s.oscar.projects.get(now.id).name, now.rev, now.fresh], ["Boombox", 1, false]);
  await s.sync.materialise();
  assert.strictEqual(s.oscar.projects.get(now.id).rev, 1, "already one: nothing more to do");
});

test("reverting puts an earlier version in the same project and saves it; a copy is another project, opened in its place", async () => {
  const s = setUp();
  await s.sync.start();
  s.type("version two");
  await s.clock.pass(SAVE_AFTER);
  const id = s.pointer.get().id;

  const reverting = s.sync.replaceWith(canvasOf("version one"));
  await s.clock.pass(SETTLE_AFTER);
  await reverting;
  assert.deepStrictEqual([s.oscar.projects.get(id).data, s.oscar.projects.get(id).rev], [canvasOf("version one"), 2]);
  assert.strictEqual(s.pointer.get().id, id, "the same project");

  const copying = s.sync.copy();
  await s.clock.pass(SETTLE_AFTER);
  await copying;
  const copy = s.pointer.get();
  assert.notStrictEqual(copy.id, id);
  assert.deepStrictEqual([copy.name, s.editor.data], ["Copy of Untitled", canvasOf("version one")]);
});

test("a project that was deleted is not saved back: its canvas is dropped, and an answer still on its way changes nothing", async () => {
  const s = setUp();
  await s.sync.start();
  s.type("soon deleted");
  await s.clock.pass(SAVE_AFTER);
  const id = s.pointer.get().id;

  // Typed, not yet sent, and then the project is deleted from the list.
  s.type("soon deleted, with one more change");
  s.oscar.projects.delete(id);
  const begun = s.sync.begin("", () => (s.editor.data = canvasOf("")), { discard: true });
  await s.clock.pass(SAVE_AFTER + SETTLE_AFTER);
  await begun;
  assert.strictEqual(s.oscar.projects.size, 0, "nothing brought it back");
  assert.deepStrictEqual([s.pointer.get().id, s.pointer.get().fresh, s.sync.status()], [null, true, "new"]);
});

test("a file brought in over the open project is shown as it is now, without the old canvas being saved over it", async () => {
  const s = setUp();
  await s.sync.start();
  s.type("the old version");
  await s.clock.pass(SAVE_AFTER);
  const id = s.pointer.get().id;
  s.type("the old version, edited and not yet sent");
  // Replaced on purpose, from a file.
  s.oscar.projects.set(id, { id, name: "From the file", rev: 7, data: canvasOf("what the file held") });
  const reloading = s.sync.reload();
  await s.clock.pass(SAVE_AFTER + SETTLE_AFTER);
  await reloading;
  assert.deepStrictEqual(s.editor.data, canvasOf("what the file held"));
  assert.deepStrictEqual([s.oscar.projects.get(id).rev, s.pointer.get().rev, s.pointer.get().name], [7, 7, "From the file"]);
});
