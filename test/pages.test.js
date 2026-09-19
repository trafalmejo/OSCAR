"use strict";

/**
 * Multiple pages: what the editor and the tablet share
 * (public/src/pages.js), driven with stand-ins for editor.Pages, a
 * component tree and a document. The file touches neither `window` nor
 * GrapesJS when it loads, which is what makes this possible.
 */

const test = require("node:test");
const assert = require("node:assert");

const pages = require("../public/src/pages");

/** Enough of editor.Pages: an ordered list, a selection, and its events. */
function fakePages(names) {
  let counter = 0;
  const make = (name) => {
    const id = "p" + ++counter;
    return { getId: () => id, getName: () => name };
  };
  const all = names.map(make);
  const api = {
    selected: all[0] || null,
    selections: 0,
    getAll: () => all.slice(),
    getSelected: () => api.selected,
    get: (id) => all.find((page) => page.getId() === id),
    select(page) {
      api.selected = page;
      api.selections++;
    },
    remove(page) {
      all.splice(all.indexOf(page), 1);
    },
  };
  return api;
}

/** A component that records every set, with children for onAll to walk. */
function fakeComponent(props, children) {
  const component = {
    props: Object.assign({}, props),
    sets: [],
    children: children || [],
    get: (key) => component.props[key],
    set(values, options) {
      component.sets.push({ values: Object.assign({}, values), options });
      Object.assign(component.props, values);
    },
    onAll(fn) {
      fn(component);
      component.children.forEach((child) => child.onAll(fn));
    },
  };
  return component;
}

function fakeDocument() {
  return {
    createElement(tag) {
      return {
        tag,
        attributes: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
      };
    },
  };
}

function fakeBar() {
  const bar = {
    hidden: true,
    children: [],
    get firstChild() {
      return bar.children[0] || null;
    },
    removeChild(child) {
      bar.children.splice(bar.children.indexOf(child), 1);
    },
    appendChild(child) {
      bar.children.push(child);
    },
  };
  return bar;
}

function fakeBody() {
  const names = new Set();
  return {
    classList: {
      contains: (name) => names.has(name),
      toggle(name, on) {
        if (on) names.add(name);
        else names.delete(name);
      },
    },
  };
}

function fakeEditor(names) {
  const handlers = {};
  return {
    Pages: fakePages(names),
    refreshed: 0,
    refresh() {
      this.refreshed++;
    },
    on(events, fn) {
      events.split(" ").forEach((event) => (handlers[event] = handlers[event] || []).push(fn));
    },
    trigger(event) {
      (handlers[event] || []).forEach((fn) => fn());
    },
  };
}

// ---- labels ----------------------------------------------------------------

test("a page GrapesJS saved without a name is listed by its position", () => {
  const list = fakePages(["", "Movers", undefined]);
  assert.deepStrictEqual(pages.pageEntries(list), [
    { id: "p1", label: "Page 1", current: true },
    { id: "p2", label: "Movers", current: false },
    { id: "p3", label: "Page 3", current: false },
  ]);
});

// ---- staying on a page across a push ---------------------------------------

test("a push mid-show re-selects the page the operator was on", () => {
  const list = fakePages(["A", "B", "C"]);
  // loadProjectData has just opened page one; the operator was on p3.
  assert.strictEqual(pages.reselect(list, "p3"), true);
  assert.strictEqual(pages.currentPageId(list), "p3");
});

test("a page deleted by the push is not looked for: the first page stands", () => {
  const list = fakePages(["A", "B"]);
  assert.strictEqual(pages.reselect(list, "gone"), false);
  assert.strictEqual(pages.reselect(list, null), false, "the very first load was on no page");
  assert.strictEqual(pages.currentPageId(list), "p1");
  assert.strictEqual(list.selections, 0);
});

test("re-selecting the page already showing selects nothing", () => {
  // Pages.select rebuilds the canvas; doing it for nothing would make every
  // push flash on a single-page surface.
  const list = fakePages(["A", "B"]);
  assert.strictEqual(pages.reselect(list, "p1"), true);
  assert.strictEqual(list.selections, 0);
});

// ---- the page-by-page lock -------------------------------------------------

const LOCK = { draggable: false, selectable: false };

test("the lock reaches every component under the root and passes its options on", () => {
  const child = fakeComponent({ draggable: true, selectable: true });
  const root = fakeComponent({ draggable: true, selectable: false }, [child]);
  const lock = pages.createLock(LOCK, { avoidStore: true });

  lock.lock(root);
  assert.deepStrictEqual(child.props, LOCK);
  assert.deepStrictEqual(root.props, LOCK);
  assert.deepStrictEqual(child.sets[0].options, { avoidStore: true }, "locking must never count as an edit");
  assert.strictEqual(lock.size, 2);
});

test("coming back to a locked page does not record the lock as what to restore", () => {
  const onOne = fakeComponent({ draggable: true, selectable: true });
  const onTwo = fakeComponent({ draggable: "custom", selectable: true });
  const pageOne = fakeComponent({ draggable: false, selectable: true }, [onOne]);
  const pageTwo = fakeComponent({ draggable: true, selectable: true }, [onTwo]);
  const lock = pages.createLock(LOCK, { avoidStore: true });

  lock.lock(pageOne); // preview starts
  lock.lock(pageTwo); // switch
  lock.lock(pageOne); // and back: already locked, must not be re-recorded
  lock.release();

  assert.deepStrictEqual(onOne.props, { draggable: true, selectable: true });
  assert.deepStrictEqual(onTwo.props, { draggable: "custom", selectable: true });
  assert.deepStrictEqual(pageOne.props, { draggable: false, selectable: true }, "what was off before stays off");
  assert.strictEqual(lock.size, 0);
});

test("a component added to a page after it was locked is locked on the next pass", () => {
  const root = fakeComponent({ draggable: true, selectable: true });
  const lock = pages.createLock(LOCK);
  lock.lock(root);

  const late = fakeComponent({ draggable: true, selectable: true });
  root.children.push(late);
  lock.lock(root);
  assert.deepStrictEqual(late.props, LOCK);

  lock.release();
  assert.deepStrictEqual(late.props, { draggable: true, selectable: true });
});

test("a released lock can be taken again, and nothing to lock is not an error", () => {
  const root = fakeComponent({ draggable: true, selectable: true });
  const lock = pages.createLock(LOCK);
  lock.lock(root);
  lock.release();
  lock.lock(root);
  lock.release();
  assert.deepStrictEqual(root.props, { draggable: true, selectable: true });
  assert.doesNotThrow(() => lock.lock(undefined));
  assert.doesNotThrow(() => lock.release());
});

// ---- the tabs --------------------------------------------------------------

test("a single page gets no bar at all", () => {
  const bar = fakeBar();
  bar.hidden = false;
  bar.children.push({ stale: true });

  const up = pages.renderTabs(fakeDocument(), bar, [{ id: "p1", label: "Page 1", current: true }], () => {});
  assert.strictEqual(up, false);
  assert.strictEqual(bar.hidden, true);
  assert.strictEqual(bar.children.length, 0, "tabs from a project that had more pages are cleared");
});

test("tabs carry the name as text, mark the current page, and only another page can be picked", () => {
  const bar = fakeBar();
  const picked = [];
  const entries = [
    { id: "p1", label: "<b>Wash</b>", current: true },
    { id: "p2", label: "Movers", current: false },
  ];

  assert.strictEqual(pages.renderTabs(fakeDocument(), bar, entries, (id) => picked.push(id)), true);
  assert.strictEqual(bar.hidden, false);
  assert.strictEqual(bar.children.length, 2);

  const [wash, movers] = bar.children;
  assert.strictEqual(wash.tag, "button");
  assert.strictEqual(wash.textContent, "<b>Wash</b>", "a name is what someone typed: text, never markup");
  assert.strictEqual(wash.innerHTML, undefined);
  assert.strictEqual(wash.attributes["aria-pressed"], "true");
  assert.strictEqual(movers.attributes["aria-pressed"], "false");
  assert.ok(/oscar-page-tab-current/.test(wash.className));
  assert.ok(!/oscar-page-tab-current/.test(movers.className));

  wash.onclick();
  assert.deepStrictEqual(picked, [], "tapping the page already showing rebuilds nothing");
  movers.onclick();
  assert.deepStrictEqual(picked, ["p2"]);
});

test("the bar is drawn only while shown, shortens the canvas through a body class, and follows the pages", () => {
  const editor = fakeEditor(["A", "B"]);
  const bar = fakeBar();
  const body = fakeBody();
  const switched = [];
  const tabs = pages.pageTabs(editor, {
    bar,
    body,
    document: fakeDocument(),
    onSwitch: (page) => switched.push(page.getId()),
  });

  // The editor outside preview: pages change, no bar.
  editor.trigger("page:add");
  assert.strictEqual(bar.hidden, true);
  assert.strictEqual(body.classList.contains("oscar-has-pages"), false);

  tabs.show();
  assert.strictEqual(bar.hidden, false);
  assert.strictEqual(body.classList.contains("oscar-has-pages"), true);
  assert.strictEqual(editor.refreshed, 1, "the canvas is told the room it has changed");

  // A tap selects the page; GrapesJS's page:select redraws the bar.
  bar.children[1].onclick();
  assert.strictEqual(editor.Pages.getSelected().getId(), "p2");
  assert.deepStrictEqual(switched, ["p2"]);
  editor.trigger("page:select");
  assert.strictEqual(bar.children[1].attributes["aria-pressed"], "true");
  assert.strictEqual(editor.refreshed, 1, "redrawing the same bar does not resize anything");

  // A push that leaves one page takes the bar, and the room, away.
  editor.Pages.remove(editor.Pages.get("p1"));
  editor.trigger("page:remove");
  assert.strictEqual(bar.hidden, true);
  assert.strictEqual(body.classList.contains("oscar-has-pages"), false);
  assert.strictEqual(editor.refreshed, 2);

  tabs.hide();
  assert.strictEqual(bar.hidden, true);
});

// ---- a control held through a page turn --------------------------------------
const { button } = require("../lib/widgets/button");
const { mount, withWindow } = require("./helpers/widgets");

test("a tab lets go of a momentary button being held, while it can still send, before the page goes", () => {
  withWindow((win) => {
    // The fake window fires by type; a browser's dispatches an Event.
    win.dispatchEvent = (event) => win.fire(event.type);

    const held = mount(button, { message: "/p1/flash", argType: "i" });
    held.el.fire("pointerdown");
    assert.deepStrictEqual(held.ctx.sent.map((m) => m.args[0].value), [1]);

    const editor = fakeEditor(["A", "B"]);
    const sentBySelect = [];
    const select = editor.Pages.select;
    editor.Pages.select = (page) => {
      // What GrapesJS does to the page going out: the view, and the widget
      // with it, is gone before the finger comes up.
      sentBySelect.push(held.ctx.sent.map((m) => m.args[0].value));
      held.detach();
      select(page);
    };

    const bar = fakeBar();
    const tabs = pages.pageTabs(editor, { bar, body: fakeBody(), document: fakeDocument(), windows: () => [win] });
    tabs.show();
    bar.children[1].onclick();

    assert.deepStrictEqual(sentBySelect, [[1, 0]], "OFF was on the wire before the page was turned");
    assert.deepStrictEqual(held.ctx.shared[held.ctx.shared.length - 1], { on: false }, "and the other tablets were told");
    assert.strictEqual(editor.Pages.getSelected().getId(), "p2");

    // The pointerup that lands nowhere afterwards changes nothing.
    held.el.fire("pointerup");
    assert.strictEqual(held.ctx.sent.length, 2);
  });
});

test("letting go skips a window that is missing or cannot dispatch, and never throws", () => {
  const fired = [];
  const good = { Event: function (type) { this.type = type; }, dispatchEvent: (event) => fired.push(event.type) };
  const broken = {
    dispatchEvent() {
      throw new Error("detached frame");
    },
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(() => pages.releaseHeld([null, {}, broken, good]));
    assert.doesNotThrow(() => pages.releaseHeld(undefined));
  } finally {
    console.warn = warn;
  }
  assert.deepStrictEqual(fired, ["blur"]);
});

test("the windows widgets listen on are the page's own and the canvas frame's, each once", () => {
  const top = {};
  const frame = {};
  assert.deepStrictEqual(pages.widgetWindows({ Canvas: { getWindow: () => frame } }, top), [top, frame]);
  assert.deepStrictEqual(pages.widgetWindows({ Canvas: { getWindow: () => top } }, top), [top]);
  assert.deepStrictEqual(pages.widgetWindows({ Canvas: { getWindow: () => null } }, top), [top]);
  assert.deepStrictEqual(pages.widgetWindows({}, top), [top]);
});

// ---- names --------------------------------------------------------------------
test("a page added without a name never takes a name another tab carries", () => {
  assert.strictEqual(pages.freePageName(["Page 1"]), "Page 2");
  // "Page 1" of two was deleted: the one left is still called "Page 2".
  assert.strictEqual(pages.freePageName(["Page 2"]), "Page 3");
  assert.strictEqual(pages.freePageName(["Wash", "Page 2", "Page 4"]), "Page 5");
  assert.strictEqual(pages.freePageName([]), "Page 1");
});

test("a name is taken when another page is shown under it, and a page may keep its own", () => {
  assert.strictEqual(pages.nameTaken(["Wash", "Spots"], "Spots"), true);
  assert.strictEqual(pages.nameTaken(["Wash", "Spots"], "  Spots "), true, "as the tab would print it");
  assert.strictEqual(pages.nameTaken(["Wash", "Spots"], "Spots", 1), false, "renaming a page to its own name");
  assert.strictEqual(pages.nameTaken(["Wash", "Spots"], "Spots", 0), true);
  assert.strictEqual(pages.nameTaken(["Wash", "Spots"], "spots"), false, "a different tab to the eye");
});
