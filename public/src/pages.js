/**
 * Multiple pages: what the editor and the control surface have in common.
 *
 * A surface can hold more than one page -- a page per fixture group, or per
 * scene. The designer manages them in the editor; whoever drives the show
 * switches between them with a row of tabs. Both entry points require this
 * file, so the tabs the designer sees while previewing are the ones the
 * tablet draws.
 *
 * Nothing here touches `window` or GrapesJS when it is loaded: every function
 * is handed what it works on, which is what lets test/pages.test.js run it
 * under plain Node.
 */

var projectFormat = require("../../lib/project-format");
var features = require("../../lib/features");

/**
 * The pages as a list of { id, label, current }.
 *
 * The label comes from lib/project-format.js, the same function that names
 * pages in a file: GrapesJS drops an empty page name when it saves, so page
 * one routinely has none, and a tab has to print something.
 */
function pageEntries(pages) {
  var selected = pages.getSelected();
  var selectedId = selected ? selected.getId() : null;
  return pages.getAll().map(function (page, index) {
    return {
      id: page.getId(),
      label: projectFormat.pageLabel(page.getName(), index),
      current: page.getId() === selectedId,
    };
  });
}

/**
 * Is `name` already the label of a page other than the one at `except`?
 *
 * Compared as the tabs print them, so "Page 2" typed by hand meets the
 * "Page 2" an unnamed second page is shown as.
 */
function nameTaken(labels, name, except) {
  var wanted = String(name).trim();
  return labels.some(function (label, index) {
    return index !== except && label === wanted;
  });
}

/**
 * The name for a page added without one: the first "Page N", counting up
 * from its position, that no tab already carries. By position alone, deleting
 * "Page 1" of two and adding a page made a second "Page 2".
 */
function freePageName(labels) {
  var index = labels.length;
  while (nameTaken(labels, projectFormat.defaultPageName(index))) index++;
  return projectFormat.defaultPageName(index);
}

/** The id of the page on the canvas, or null before there is one. */
function currentPageId(pages) {
  var selected = pages.getSelected();
  return selected ? selected.getId() : null;
}

/**
 * Go back to the page someone was on, if the project still has it.
 *
 * A push mid-show reloads the whole project, and GrapesJS opens a loaded
 * project on its first page. Whoever is driving page three must not be thrown
 * back to page one with a cue coming. Page ids are saved in the project, so
 * the same page carries the same id across pushes; one that was deleted in
 * the meantime is simply not there, and the first page is the honest answer.
 *
 * @returns true when the page was found and is now selected
 */
function reselect(pages, id) {
  if (!id) return false;
  var page = pages.get(id);
  if (!page) return false;
  if (currentPageId(pages) !== id) pages.select(page);
  return true;
}

/**
 * A lock that can be taken page by page and undone in one go.
 *
 * GrapesJS only builds the components of the page on the canvas, and
 * Pages.select brings the next page in untouched: whatever locked the first
 * page has not locked this one. So the lock is applied again on every switch.
 * Coming back to a page already locked must not record its locked values as
 * "what it was before", or undoing the lock would restore the lock; each
 * component is therefore remembered the first time it is touched and never
 * again.
 *
 * `options` is passed to component.set -- the editor passes avoidStore, so
 * locking never counts as an edit.
 */
function createLock(props, options) {
  var keys = Object.keys(props);
  // A Map, not a WeakMap: release() has to walk it.
  var touched = new Map();

  return {
    /** Lock every component under `root` that is not locked already. */
    lock: function (root) {
      if (!root || typeof root.onAll !== "function") return;
      root.onAll(function (component) {
        if (!touched.has(component)) {
          var previous = {};
          keys.forEach(function (key) {
            previous[key] = component.get(key);
          });
          touched.set(component, previous);
        }
        component.set(props, options);
      });
    },

    /** Put every component this lock touched back as it was found. */
    release: function () {
      touched.forEach(function (previous, component) {
        component.set(previous, options);
      });
      touched.clear();
    },

    get size() {
      return touched.size;
    },
  };
}

/**
 * Let go of every control a finger is on, before the page under it goes.
 *
 * Turning the page destroys the views of the page that was showing. A
 * momentary button held with one finger while another taps a tab has sent
 * its ON; its element is gone before the finger comes up, so the pointerup
 * lands nowhere and OFF never reaches the rig -- the fixture stays on, and
 * every tablet draws the button lit. The widgets already have a word for
 * "the hand is gone": a drag that loses the window counts as released
 * (the ctx contract in lib/widgets/index.js), which every widget that can be
 * held listens for as `blur` on its window. So that is what is said here,
 * while the widgets are still attached and can still send.
 *
 * `windows` is every window a widget may be listening on: the page's own
 * and the canvas frame's. One that is missing, or cannot dispatch, is
 * skipped -- a page turn must not fail on it.
 */
function releaseHeld(windows) {
  (windows || []).forEach(function (win) {
    if (!win || typeof win.dispatchEvent !== "function") return;
    var EventType = win.Event || (typeof Event === "function" ? Event : null);
    if (!EventType) return;
    try {
      win.dispatchEvent(new EventType("blur"));
    } catch (err) {
      console.warn("Could not release the controls being held:", err && err.message);
    }
  });
}

/** The windows a widget of this editor may be listening on. */
function widgetWindows(editor, top) {
  var windows = top ? [top] : [];
  var frame = editor && editor.Canvas && typeof editor.Canvas.getWindow === "function" ? editor.Canvas.getWindow() : null;
  if (frame && frame !== top) windows.push(frame);
  return windows;
}

/**
 * Draw the tabs into `bar`, and report whether there are any.
 *
 * The bar lives outside the GrapesJS canvas on purpose. Anything inside the
 * canvas loses its events to the preview lock, and a tab drawn as a component
 * is one the next person to edit the project can drag away or delete.
 *
 * A single page gets no bar at all: it would only take room from the
 * controls, and there is nowhere to switch to.
 */
function renderTabs(doc, bar, entries, onPick) {
  while (bar.firstChild) bar.removeChild(bar.firstChild);

  if (entries.length < 2) {
    bar.hidden = true;
    return false;
  }

  entries.forEach(function (entry) {
    var tab = doc.createElement("button");
    tab.type = "button";
    tab.className = "oscar-page-tab" + (entry.current ? " oscar-page-tab-current" : "");
    // textContent, never innerHTML: a page name is whatever someone typed.
    tab.textContent = entry.label;
    tab.setAttribute("aria-pressed", entry.current ? "true" : "false");
    tab.onclick = function () {
      if (!entry.current) onPick(entry.id);
    };
    bar.appendChild(tab);
  });

  bar.hidden = false;
  return true;
}

/**
 * Keep a tab bar in step with the editor's pages.
 *
 *   var tabs = pageTabs(editor, { bar, body, onSwitch });
 *   tabs.show() / tabs.hide() / tabs.render()
 *
 * `body` carries the oscar-has-pages class while the bar is up; the
 * stylesheet shortens the editor by the bar's height on that class, rather
 * than letting the bar float over the bottom row of someone's controls.
 * `onSwitch` runs after every page change made through the tabs.
 * `windows`, a function returning the windows the widgets listen on, is how
 * a tab lets go of whatever is being held before the page goes (releaseHeld).
 */
function pageTabs(editor, options) {
  // Off with the feature (lib/features.js): the bar then never shows, and a
  // surface stays on the page it opened on. `enabled` is for the tests.
  var enabled = options.enabled === undefined ? features.PAGES : !!options.enabled;
  var bar = options.bar;
  var body = options.body;
  var doc = options.document || bar.ownerDocument;
  var showing = false;

  function pick(id) {
    var page = editor.Pages.get(id);
    if (!page) return;
    // Before the select, not after: by then the held widget is detached and
    // has nothing left to send its release with.
    if (options.windows) releaseHeld(options.windows());
    editor.Pages.select(page);
    // The page:select listener below redraws; onSwitch is for the caller's
    // own follow-up (locking the page that came in).
    if (options.onSwitch) options.onSwitch(page);
  }

  function render() {
    var up = showing && renderTabs(doc, bar, pageEntries(editor.Pages), pick);
    if (!showing) bar.hidden = true;
    var had = body.classList.contains("oscar-has-pages");
    body.classList.toggle("oscar-has-pages", !!up);
    // The canvas measures itself once; tell it the room it has changed.
    if (had !== !!up && typeof editor.refresh === "function") editor.refresh();
  }

  if (typeof editor.on === "function") {
    editor.on("page:select page:add page:remove page:update", render);
  }

  return {
    render: render,
    show: function () {
      showing = enabled;
      render();
    },
    hide: function () {
      showing = false;
      render();
    },
  };
}

module.exports = {
  pageEntries: pageEntries,
  currentPageId: currentPageId,
  reselect: reselect,
  createLock: createLock,
  nameTaken: nameTaken,
  freePageName: freePageName,
  releaseHeld: releaseHeld,
  widgetWindows: widgetWindows,
  renderTabs: renderTabs,
  pageTabs: pageTabs,
};
