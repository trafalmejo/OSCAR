"use strict";

/**
 * Keeping the project on the canvas saved in OSCAR as it is edited.
 *
 * A project lives in OSCAR, on the computer OSCAR runs on (lib/projects.js),
 * under one title; there is no Save to press. This is the part that makes
 * that true from the editor's side, and it is kept apart from the editor so
 * that every path through it can be driven by a test with no browser:
 *
 *   - a change is sent a moment after the last one of a burst, one save at
 *     a time, and a change that arrives while one is on its way is sent
 *     after it;
 *   - nothing is forgotten until OSCAR has answered that it holds it: the
 *     canvas stays in the browser as it always did, and the pointer beside
 *     it (lib/open-project.js) says "dirty" from the first change until the
 *     save that covers it is confirmed. A browser closed in between sends
 *     what it has the next time it opens;
 *   - a save that fails is tried again, slower each time, and says so;
 *   - a project that was written somewhere else since this window last saw
 *     it is never written over without asking (the revision, lib/projects.js);
 *   - a canvas that is nobody yet -- a template just opened, a first launch
 *     -- becomes a project at its first change, so one that was only looked
 *     at leaves nothing behind.
 *
 * What it is told of (deps):
 *   pointer    lib/open-project.js: get(), set()
 *   api        { read(id), create(body), write(id, body), copy(id) }, each a
 *              promise of { ok, status, body }; rejected when OSCAR cannot
 *              be reached at all
 *   getData()  the project on the canvas, tidied as it would be saved
 *   loadData(data)   put a project on the canvas
 *   isEmpty()  whether the canvas holds nothing at all
 *   onStatus(status, detail)   "new" | "saving" | "saved" | "unsaved" | "conflict"
 *   onName(name)     the title changed
 *   conflict({ name })   ask the person; a promise of "mine" or "theirs"
 *   keepOpened(id, data)   remember a project as it was when opened, for Revert
 *   grapesjs   the editor library's version, recorded in what is saved
 *   setTimer, clearTimer   setTimeout's shape; a test hands in its own
 */

const SAVE_AFTER = 1200;
const SETTLE_AFTER = 400;
const RETRY_FIRST = 3000;
const RETRY_MAX = 15000;

function createProjectSync(deps) {
  const setTimer = deps.setTimer || setTimeout;
  const clearTimer = deps.clearTimer || clearTimeout;
  const pointer = deps.pointer;
  const api = deps.api;

  let status = "new";
  let timer = null; // the save that is waiting for the burst to end
  let retryAfter = RETRY_FIRST;
  let saving = null; // the save on its way
  let again = false; // something changed while it was
  let lastSaved = null; // what OSCAR is known to hold, as text; null when not known
  let muted = 0; // loading a project is not the person editing it
  let renamed = false; // the title changed and OSCAR has not been told
  // Which canvas this is, counted: an answer to a save that was sent for a
  // canvas since replaced (another project opened, this one deleted) is not
  // this canvas's news, and must not put the old project's name back on it.
  let era = 0;

  function say(next, detail) {
    status = next;
    if (deps.onStatus) deps.onStatus(next, detail || "");
  }

  function text() {
    return JSON.stringify(deps.getData());
  }

  function keep(changes) {
    return pointer.set(Object.assign({}, pointer.get(), changes));
  }

  function wait(ms) {
    if (timer) clearTimer(timer);
    timer = setTimer(function () {
      timer = null;
      save();
    }, ms);
  }

  function failed(detail) {
    say("unsaved", detail);
    wait(retryAfter);
    retryAfter = Math.min(RETRY_MAX, retryAfter * 2);
  }

  /** OSCAR holds `sent` as revision `answer.rev`: whatever changed since is still to go. */
  function confirmed(answer, sent, sentIn) {
    if (sentIn !== era) return;
    lastSaved = sent;
    retryAfter = RETRY_FIRST;
    renamed = false;
    const ahead = text() !== sent;
    keep({ id: answer.id, name: answer.name, rev: answer.rev, dirty: ahead, fresh: false });
    if (deps.onName) deps.onName(answer.name);
    if (ahead) again = true;
    else say("saved");
  }

  /** Put a project on the canvas without that counting as a change by the person. */
  function show(data, then) {
    muted++;
    deps.loadData(data);
    // The editor goes on settling for a moment after a load (frames render,
    // components are given ids): what it holds then is the baseline, so that
    // settling is not taken for an edit and saved back.
    setTimer(function () {
      muted--;
      lastSaved = text();
      if (then) then();
    }, SETTLE_AFTER);
  }

  function opened(project) {
    era++;
    keep({ id: project.id, name: project.name, rev: project.rev, dirty: false, fresh: false });
    if (deps.keepOpened) deps.keepOpened(project.id, project.data);
    if (deps.onName) deps.onName(project.name);
    say("saved");
    return new Promise(function (resolve) {
      show(project.data, resolve);
    });
  }

  /** One round of saving. Resolves when it is over, whatever came of it; never rejects. */
  function attempt() {
    const now = pointer.get();
    const sent = text();
    const sentIn = era;

    // Nothing to send: what is here is what OSCAR holds, or a canvas that
    // was only looked at.
    if (sent === lastSaved && !renamed) {
      keep({ dirty: false });
      say(now.id ? "saved" : "new");
      return Promise.resolve();
    }

    say("saving");
    const data = JSON.parse(sent);
    const name = now.name || "Untitled";
    const request = now.id
      ? api.write(now.id, { data: data, name: name, baseRev: now.rev, grapesjs: deps.grapesjs })
      : api.create({ name: name, data: data, grapesjs: deps.grapesjs });

    return request
      .then(function (res) {
        if (res.ok) return confirmed(res.body, sent, sentIn);

        // It is not in OSCAR: deleted somewhere else, or a canvas from before
        // projects lived here that only this browser knew. It is made again,
        // as who it was.
        if (res.status === 404 && now.id) {
          return api.create({ id: now.id, name: name, data: data, grapesjs: deps.grapesjs, ifExists: "replace" }).then(function (made) {
            if (made.ok) return confirmed(made.body, sent, sentIn);
            failed((made.body && made.body.error) || "");
          });
        }

        // Written somewhere else since this window last saw it. Never over
        // the top without asking.
        if (res.status === 409 && res.body && res.body.conflict) {
          say("conflict", res.body.error || "");
          if (!deps.conflict) return undefined;
          return deps.conflict({ name: res.body.name || name }).then(
            function (choice) {
              if (choice === "theirs") return reopen(now.id);
              if (choice !== "mine") return undefined;
              say("saving");
              return api.write(now.id, { data: data, name: name, grapesjs: deps.grapesjs }).then(function (forced) {
                if (forced.ok) return confirmed(forced.body, sent, sentIn);
                failed((forced.body && forced.body.error) || "");
              });
            },
            function () {
              // No answer: it stays as it is, and the next change asks again.
            }
          );
        }

        failed((res.body && res.body.error) || "");
      })
      .catch(function () {
        failed("OSCAR could not be reached.");
      });
  }

  function save() {
    if (saving) {
      again = true;
      return saving;
    }
    saving = attempt().then(function () {
      saving = null;
      if (again) {
        again = false;
        return save();
      }
    });
    return saving;
  }

  function reopen(id) {
    return api.read(id).then(function (res) {
      if (!res.ok) throw new Error((res.body && res.body.error) || "That project could not be opened.");
      return opened(res.body);
    });
  }

  return {
    /** "new" | "saving" | "saved" | "unsaved" | "conflict" */
    status: function () {
      return status;
    },

    /**
     * As the editor opens: square what this browser holds with what OSCAR
     * holds. Resolves when that is done; never rejects.
     */
    start: function () {
      const now = pointer.get();

      if (!now.id) {
        // Nobody yet. A template or an empty canvas waits for its first
        // change; a canvas with work on it, from before projects lived in
        // OSCAR, becomes a project now.
        if (now.fresh || deps.isEmpty()) {
          lastSaved = text();
          keep({ dirty: false, fresh: true });
          say("new");
          return Promise.resolve();
        }
        return save();
      }

      return api
        .read(now.id)
        .then(function (res) {
          if (res.status === 404) return save(); // only this browser knew it: attempt() makes it
          if (!res.ok) return failed((res.body && res.body.error) || "");

          const theirs = res.body;
          if (now.dirty) {
            // Unsaved work here. Sent against the revision this browser last
            // saw: accepted if nobody wrote since, asked about if somebody did.
            lastSaved = null;
            return save();
          }
          if (theirs.rev !== now.rev) return opened(theirs); // changed elsewhere, nothing unsaved here
          // The same revision, and nothing unsaved: what is on the canvas is it.
          lastSaved = text();
          keep({ name: theirs.name });
          if (deps.keepOpened) deps.keepOpened(theirs.id, theirs.data);
          if (deps.onName) deps.onName(theirs.name);
          say("saved");
        })
        .catch(function () {
          failed("OSCAR could not be reached.");
        });
    },

    /** The person changed something. */
    changed: function () {
      if (muted) return;
      if (!pointer.get().dirty) keep({ dirty: true });
      // Said at once, not when the burst ends: "Saved" beside work that has
      // not been sent would be a small lie, a second long.
      if (status === "saved" || status === "new") say("saving");
      wait(SAVE_AFTER);
    },

    /** Save now, without waiting for the burst to end. Resolves when it is over. */
    flush: function () {
      if (timer) clearTimer(timer);
      timer = null;
      return save();
    },

    /** A new title. Said to OSCAR with the next save, which is now. */
    rename: function (name) {
      const title = String(name == null ? "" : name).trim().slice(0, 200);
      if (!title || title === pointer.get().name) return Promise.resolve();
      keep({ name: title });
      if (deps.onName) deps.onName(title);
      // A canvas that is nobody yet is only named; it becomes a project at its first change.
      if (!pointer.get().id) return Promise.resolve();
      renamed = true;
      return this.flush();
    },

    /** Open another project that is in OSCAR. What is on the canvas is saved first. */
    open: function (id) {
      return this.flush().then(function () {
        return reopen(id);
      });
    },

    /**
     * Show the open project as OSCAR holds it now, without first saving what
     * is on the canvas: for when it was replaced on purpose (a file brought
     * in over it), and the canvas is what is out of date.
     */
    reload: function () {
      if (timer) clearTimer(timer);
      timer = null;
      keep({ dirty: false });
      return reopen(pointer.get().id);
    },

    /**
     * A canvas that is nobody yet: a template, an empty start. `put` places
     * its content; it becomes a project at its first change. What was on the
     * canvas is saved first -- unless it is being discarded, because the
     * project it was has just been deleted.
     */
    begin: function (name, put, options) {
      const discard = !!(options && options.discard);
      if (discard) {
        if (timer) clearTimer(timer);
        timer = null;
        keep({ id: null, dirty: false });
      }
      return (discard ? Promise.resolve() : this.flush()).then(function () {
        era++;
        keep({ id: null, name: String(name || "").trim().slice(0, 200), rev: 0, dirty: false, fresh: true });
        if (deps.onName) deps.onName(pointer.get().name);
        say("new");
        return new Promise(function (resolve) {
          muted++;
          put();
          setTimer(function () {
            muted--;
            lastSaved = text();
            resolve();
          }, SETTLE_AFTER);
        });
      });
    },

    /** Make the canvas a project now, without waiting for a change: publishing needs one to belong to. */
    materialise: function () {
      if (pointer.get().id) return this.flush();
      lastSaved = null;
      return this.flush();
    },

    /** Put other content in the open project -- an earlier version of it -- and save that. */
    replaceWith: function (data) {
      const self = this;
      return new Promise(function (resolve) {
        show(data, resolve);
      }).then(function () {
        lastSaved = null;
        keep({ dirty: true });
        return self.flush();
      });
    },

    /** A second project like this one, opened in its place. */
    copy: function () {
      const self = this;
      return this.materialise().then(function () {
        return api.copy(pointer.get().id).then(function (res) {
          if (!res.ok) throw new Error((res.body && res.body.error) || "The project could not be copied.");
          return self.open(res.body.id);
        });
      });
    },
  };
}

module.exports = { createProjectSync, SAVE_AFTER, SETTLE_AFTER, RETRY_FIRST, RETRY_MAX };
