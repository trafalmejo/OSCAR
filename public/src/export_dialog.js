/**
 * "Publish" in the editor: turning the project on the canvas into a page
 * phones open, and looking after every such page this OSCAR serves.
 *
 * What the toolbar had before is GrapesJS's own export-template command, a
 * modal of markup to copy out -- labelled "See code", because that is all it
 * is. It cannot produce a working interface: the settings that say where a
 * widget sends are not in the markup, and nothing on the page would read
 * them if they were.
 *
 * This asks the adapter for markup with those settings written in, and the
 * OSCAR server to wrap it around the standalone runtime (POST /publish).
 *
 * The window is the project on the canvas, on a card at the top -- who can
 * open it, the one code for the address that goes with that, and one button
 * that says what it does -- and under it, in a short list, whatever else
 * this OSCAR has live.
 *
 * Not named oscar_*.js: requiring "./oscar_<name>" is how an entry point used
 * to pull in one widget's file, and test/widgets.test.js refuses that pattern
 * in the entry points so nobody wires a widget by hand again.
 */

var { exportSnapshot } = require("./adapters/grapesjs");
var { surfaceAddress, addressFor } = require("../../lib/published-address");
var { surfaceStamp } = require("../../lib/export/stamp");
var features = require("../../lib/features");
// Draws the code for a published surface's address. Bundled, like everything
// else here: OSCAR runs at venues with no internet.
var qrcode = require("qrcode-generator");

var DEFAULT_NAME = "my-interface";

// Addresses OSCAR uses itself (lib/published.js): never offered for a project.
var RESERVED = ["preview"];

/** A filename someone can find again, from whatever they typed. */
function fileStem(name) {
  var stem = String(name == null ? "" : name)
    .trim()
    .toLowerCase()
    .replace(/\.html?$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return stem || DEFAULT_NAME;
}

/**
 * Hand a blob to the browser as a download. The object URL is released a
 * moment later rather than at once: revoking it in the same frame as the
 * click races the download in Safari, and the file arrives empty.
 */
function download(blob, filename) {
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 1000);
}

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className) {
  var node = el("button", className || "o-btn", label);
  node.type = "button";
  return node;
}

/**
 * @param {object} editor the GrapesJS editor
 * @param {object} options
 *        host, port: what the editor was started with, offered for a download
 *        only if the server cannot be asked again
 *        project(): { id, name } -- which project the canvas is (lib/open-project.js)
 *        beforeOpen(): a promise; the canvas is made a project before the window opens
 *        newId(): an id for a canvas that had none
 *        source(name, id): the project on the canvas, as a file would hold it
 *        openProject({ id, name, data }): Edit -- put that project on the canvas
 */
function install(editor, options) {
  var container = document.getElementById("export-panel");
  if (!container) return;

  var publishButton = document.getElementById("publish-button");
  var titleBox = document.getElementById("publish-title");
  var cardAccess = document.getElementById("publish-card-access");
  var cardWhere = document.getElementById("publish-card-where");
  var stateLine = document.getElementById("publish-state");
  var publishedBox = document.getElementById("published-box");
  var publishedList = document.getElementById("published-list");
  var extrasBox = document.getElementById("publish-extras");
  var errorBox = document.getElementById("export-error");
  var noteBox = document.getElementById("export-note");
  var pagesBox = document.getElementById("export-pages");
  var pageCount = document.getElementById("export-page-count");
  // The canvas's stamp against its published copy's (lib/export/stamp.js):
  // the card says "Changes not published", and the toolbar's Publish button
  // wears a dot meanwhile.
  var canvasStamp = null; // worked out at most once per wave of edits

  // What an extension adds to the dialog (addSection below): each gets a box
  // of its own in #publish-extras and is asked to draw whenever the dialog
  // opens or what is published changes.
  var sections = [];
  var latest = null; // the id of the surface published from this dialog, most recently
  var known = []; // the published surfaces, as GET /published last said
  var titles = {}; // project id -> what that project is called now, as GET /projects last said
  var shown = null; // the row whose code is open, by surface id
  // Who can open an interface is one setting. OSCAR itself knows two
  // answers: off, and this network. An extension may add further ones
  // (addAccessLevel below): where the interface is reachable beyond it.
  var levels = [];
  var levelMaps = {}; // level id -> { surface id: true } as its read() last said, or null: not on offer now
  // The address other devices reach OSCAR on, and its bridge port, as GET
  // /connection last said; what a download is told unless it is changed.
  var lanHost = "";
  var lanPort = "";

  /** Where a published surface is opened from another device. */
  function addressOf(path) {
    return surfaceAddress(lanHost || window.location.hostname, window.location.port || 80, path);
  }

  function say(box, message) {
    box.textContent = message;
    box.style.display = message ? "block" : "none";
  }

  /**
   * Ask every section to draw itself. A section that throws loses only its
   * own box; the dialog and the other sections go on.
   */
  function drawSections() {
    sections.forEach(function (section) {
      try {
        section.draw(section.box, {
          surfaces: known.map(function (page) {
            return { id: page.id, name: titleOf(page), path: page.path, address: addressOf(page.path) };
          }),
          latest: latest,
          refresh: refreshPublished,
          show: showAddress,
          onUnpublish: function (guard) {
            section.guard = guard;
          },
        });
      } catch (err) {
        console.error("A section of the Publish dialog failed:", err);
      }
    });
  }

  /**
   * An address used to be shown on request, in a box of its own with a QR
   * button beside every link. Each interface now shows the one code for
   * where it is opened, without being asked, so there is nothing to do here;
   * the function stays so that a section written for the old dialog still runs.
   */
  function showAddress() {}

  /** Which project the canvas is: { id, name }, id null for a canvas that is nobody yet. */
  function project() {
    var now = options.project ? options.project() : null;
    return { id: (now && now.id) || null, name: (now && now.name) || "" };
  }

  /**
   * The live interface that is this canvas's own: the one published from the
   * project it is, whatever either is called now. Not matched by name -- a
   * name is reused for different designs, and a wrong match would let
   * Publish changes replace a running show with another one.
   */
  function publishedMine() {
    var id = project().id;
    if (!id) return null;
    for (var i = 0; i < known.length; i++) {
      if (known[i].project === id) return known[i];
    }
    return null;
  }

  /** What an interface is called: its project's title as it is now, else as it was published. */
  function titleOf(page) {
    return (page.project && titles[page.project]) || page.name || page.id;
  }

  function staleNow() {
    var mine = publishedMine();
    if (!mine || !mine.stamp || canvasStamp === null) return false;
    return mine.stamp !== canvasStamp;
  }

  /**
   * The Publish button in the toolbar, found by its class. (It was once found
   * by its tooltip, which paintStale changes: after the first dot it was
   * never found again, and the dot could not be taken off.)
   */
  function toolbarButton() {
    return document.querySelector(".gjs-pn-options .oscar-publish-btn");
  }

  /**
   * The foot of the card: one button, which says what it does. Publish for
   * a project that is not live; Publish changes when the canvas is ahead of
   * what phones see; and no button at all when there is nothing to send.
   */
  function paintFoot() {
    var mine = publishedMine();
    var stale = staleNow();
    if (stateLine) {
      stateLine.textContent = !mine ? "" : stale ? "Changes not published" : "Up to date";
      stateLine.setAttribute("data-state", !mine ? "none" : stale ? "grace" : "valid");
    }
    publishButton.textContent = mine ? "Publish changes" : "Publish";
    publishButton.style.display = mine && !stale ? "none" : "";
  }

  function paintStale() {
    paintFoot();
    var bar = toolbarButton();
    if (!bar) return;
    var stale = staleNow();
    bar.classList.toggle("oscar-publish-stale", stale);
    bar.setAttribute("data-tooltip", stale ? "Publish your interface · the published copy is older than your canvas" : "Publish your interface");
  }

  /** Work the canvas's stamp out afresh; heavier than a click, so debounced below. */
  function restamp() {
    try {
      canvasStamp = surfaceStamp(exportSnapshot(editor).html);
    } catch (err) {
      canvasStamp = null;
    }
    paintStale();
  }

  // Any edit may change the stamp; one reading two seconds after the last
  // edit of a burst is fresh enough for a dot.
  var restampWait = null;
  editor.on("update", function () {
    if (restampWait) clearTimeout(restampWait);
    restampWait = setTimeout(restamp, 2000);
  });

  // The dot must not wait for the dialog to have been opened once: what is
  // published is read soon after the editor is up, into the same list the
  // dialog uses, and the canvas stamped against it.
  setTimeout(function () {
    refreshPublished().then(restamp);
  }, 3000);

  // ---- who can open it ----------------------------------------------------

  /** The extension level a surface is at, out of what the levels last said, or null. */
  function levelAt(id) {
    for (var i = 0; i < levels.length; i++) {
      var map = levelMaps[levels[i].id];
      if (map && map[id]) return levels[i];
    }
    return null;
  }

  function postAccess(id, access) {
    return fetch("/published/" + encodeURIComponent(id) + "/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access: access }),
    }).then(function (res) {
      return res.json().then(function (answer) {
        if (!res.ok) throw new Error((answer && answer.error) || "That could not be changed.");
        return answer;
      });
    });
  }

  /**
   * One setting, three kinds of step. Leaving an extension's level is asked
   * of that level first; off and network are OSCAR's own; and an extension's
   * level is chosen with the interface open to the network, which it builds
   * on. Whatever fails is said, and the window is drawn again as things stand.
   */
  function changeAccess(page, at, to, select) {
    say(errorBox, "");
    select.disabled = true;
    var chain = Promise.resolve();
    if (at && at.id !== to) {
      chain = chain.then(function () {
        return at.leave(page.id);
      });
    }
    if (to === "off" || to === "network") {
      if (page.access !== to) {
        chain = chain.then(function () {
          return postAccess(page.id, to);
        });
      }
    } else {
      var level = levels.filter(function (other) {
        return other.id === to;
      })[0];
      if (page.access === "off") {
        chain = chain.then(function () {
          return postAccess(page.id, "network");
        });
      }
      chain = chain.then(function () {
        return level.choose(page.id);
      });
    }
    chain
      .catch(function (err) {
        say(errorBox, (err && err.message) || "That could not be changed.");
      })
      .then(refreshPublished);
  }

  /** Who can open it: one setting, the interface's own. */
  function accessSelect(page, at) {
    var isOff = page.access === "off";
    var access = el("select", "o-input oscar-published-access");
    access.setAttribute("aria-label", "Who can open " + titleOf(page));
    [{ id: "off", label: "Off" }, { id: "network", label: "This network" }]
      .concat(
        levels
          .filter(function (level) {
            return levelMaps[level.id];
          })
          .map(function (level) {
            return { id: level.id, label: typeof level.label === "function" ? level.label() : level.label };
          })
      )
      .forEach(function (choice) {
        var option = el("option", "", choice.label);
        option.value = choice.id;
        access.appendChild(option);
      });
    access.value = isOff ? "off" : at ? at.id : "network";
    access.onclick = function (event) {
      // On a row, a click anywhere else opens its code; not this one.
      event.stopPropagation();
    };
    access.onchange = function () {
      changeAccess(page, at, access.value, access);
    };
    return access;
  }

  // ---- where it is opened: the one code, the link, Copy ---------------------

  function qrOf(address) {
    // Drawn by the library from an address OSCAR or an extension built;
    // nothing a person typed reaches it except a title, reduced to a-z, 0-9 and "-".
    var code = qrcode(0, "M");
    code.addData(address);
    code.make();
    var box = el("div", "oscar-publish-qr");
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", "QR code for " + address);
    box.innerHTML = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    return box;
  }

  function linkTo(address) {
    var link = el("a", "o-link oscar-publish-link", address);
    link.href = address;
    link.target = "_blank";
    link.rel = "noopener";
    return link;
  }

  /**
   * Where an interface is opened, as it stands: one code, for the address
   * that goes with who can open it. An extension's level leads with its own
   * address (anyone with the link); the local one then stays as text beside
   * it, for a tablet on the same Wi-Fi. Off has neither.
   */
  function whereBlock(page, at) {
    var where = el("div", "oscar-publish-spot");
    if (page.access === "off") {
      where.appendChild(el("p", "oscar-publish-off", "No device can open it. Its schedules and bridges still run."));
      return where;
    }
    var local = addressOf(page.path);
    var lead = null;
    try {
      lead = at && typeof at.link === "function" ? at.link(page.id) : null;
    } catch (err) {
      console.error("An access level of the Publish dialog failed:", err);
    }
    var address = (lead && lead.address) || local;

    where.appendChild(qrOf(address));
    var lines = el("div", "oscar-publish-lines");

    var first = el("div", "oscar-publish-line");
    first.appendChild(linkTo(address));
    var copy = button("Copy", "o-btn oscar-publish-copy");
    copy.onclick = function (event) {
      event.stopPropagation();
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(address).then(function () {
        copy.textContent = "Copied";
        setTimeout(function () {
          copy.textContent = "Copy";
        }, 1500);
      });
    };
    first.appendChild(copy);
    lines.appendChild(first);

    if (lead && lead.state && lead.state.text) {
      var state = el("span", "oscar-published-state", lead.state.text);
      state.setAttribute("data-state", lead.state.tone || "none");
      if (lead.state.title) state.title = lead.state.title;
      var second = el("div", "oscar-publish-line");
      second.appendChild(state);
      lines.appendChild(second);
    }

    if (lead && lead.address) {
      var third = el("div", "oscar-publish-line oscar-publish-local");
      third.appendChild(document.createTextNode("On this Wi-Fi: "));
      third.appendChild(linkTo(local));
      lines.appendChild(third);
    } else {
      lines.appendChild(el("div", "oscar-publish-line oscar-publish-local", "Scan it with a phone on this network, or type the address."));
    }

    // An extension's own part: what it has to say beyond its address.
    levels.forEach(function (level) {
      if (!levelMaps[level.id] || typeof level.draw !== "function") return;
      var box = el("span", "oscar-published-level");
      try {
        level.draw(box, { id: page.id, name: titleOf(page), path: page.path, address: local, access: page.access }, {
          active: !!at && at.id === level.id,
          show: showAddress,
          refresh: refreshPublished,
        });
      } catch (err) {
        console.error("An access level of the Publish dialog failed:", err);
      }
      lines.appendChild(box);
    });

    where.appendChild(lines);
    return where;
  }

  // ---- what else can be done with one: Download, Take down ------------------

  /** A small menu under a "..." button: built, placed, closed by a click away. */
  function moreMenu(anchor, items) {
    var open = document.querySelector(".oscar-open-menu");
    if (open) open.remove();
    var at = anchor.getBoundingClientRect();
    var menu = el("div", "oscar-open-menu");
    menu.style.top = Math.round(at.bottom + 4) + "px";
    menu.style.left = Math.round(Math.max(8, at.right - 200)) + "px";
    items.forEach(function (item) {
      var row = button(item.label, "oscar-open-menu-item");
      row.onclick = function () {
        menu.remove();
        item.run();
      };
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    var away = function (event) {
      if (menu.contains(event.target)) return;
      menu.remove();
      document.removeEventListener("pointerdown", away, true);
    };
    setTimeout(function () {
      document.addEventListener("pointerdown", away, true);
    }, 0);
  }

  function moreButton(page) {
    var more = button("⋯", "o-btn oscar-published-more");
    more.setAttribute("aria-label", "More for " + titleOf(page));
    more.onclick = function (event) {
      event.stopPropagation();
      moreMenu(more, [
        {
          label: "Download as a file…",
          run: function () {
            openDownload(page.id);
          },
        },
        {
          label: "Take down",
          run: function () {
            takeDown(page);
          },
        },
      ]);
    };
    return more;
  }

  /**
   * Take an interface down: stop serving it, and its schedules and bridges
   * with it. A section may have a reason to think twice (it is open to
   * anyone with the link, say), and something to do first.
   */
  function takeDown(page) {
    var warnings = sections
      .map(function (section) {
        return typeof section.guard === "function" ? section.guard(page.id) : null;
      })
      .filter(Boolean);
    var unpublish = function () {
      fetch("/published/" + encodeURIComponent(page.id), { method: "DELETE" }).then(function () {
        refreshPublished();
      });
    };
    if (!warnings.length) return unpublish();
    var reasons = warnings.map(function (w) {
      return w.reason;
    });
    var proceed = function () {
      Promise.all(
        warnings.map(function (w) {
          return typeof w.first === "function" ? w.first() : null;
        })
      ).then(unpublish, function (err) {
        say(errorBox, (err && err.message) || "That could not be done.");
      });
    };
    if (window.$ && typeof window.$.confirm === "function") {
      window.$.confirm({
        title: "Still on the internet",
        content: reasons.join(" "),
        // Room for the long button; the theme keeps it on a narrow window.
        boxWidth: "560px",
        useBootstrap: false,
        buttons: {
          confirm: { text: "Take it off the internet and take it down", btnClass: "btn-red", action: proceed },
          cancel: { text: "Keep it live" },
        },
      });
    } else if (window.confirm(reasons.join(" ") + " Take it off the internet and take it down?")) {
      proceed();
    }
  }

  /** Edit: fetch the project a live interface was published from, and hand it to the editor. */
  function openForEdit(page) {
    say(errorBox, "");
    fetch("/published/" + encodeURIComponent(page.id) + "/project")
      .then(function (res) {
        return res.json().then(function (answer) {
          if (!res.ok) throw new Error((answer && answer.error) || "That project could not be opened.");
          return answer;
        });
      })
      .then(function (answer) {
        options.openProject(answer);
      })
      .catch(function (err) {
        say(errorBox, (err && err.message) || "Could not reach the OSCAR server.");
      });
  }

  // ---- the card: the project on the canvas -----------------------------------

  function drawCard() {
    var mine = publishedMine();
    var now = project();
    if (titleBox) titleBox.textContent = now.name || "Untitled";
    cardAccess.textContent = "";
    cardWhere.textContent = "";
    if (mine) {
      var at = mine.access === "off" ? null : levelAt(mine.id);
      cardAccess.appendChild(accessSelect(mine, at));
      cardAccess.appendChild(moreButton(mine));
      cardWhere.appendChild(whereBlock(mine, at));
    } else {
      // Not live yet. No address to choose: it is made from the title.
      var taken = known
        .map(function (page) {
          return page.id;
        })
        .concat(RESERVED);
      cardWhere.appendChild(
        el("p", "oscar-publish-off", "Not published yet. It will open at /show/" + addressFor(now.name, taken) + ", for phones and tablets on this network.")
      );
    }
    paintFoot();
  }

  // ---- the list: whatever else is live on this OSCAR -------------------------

  function drawRows() {
    publishedList.textContent = "";
    var mine = publishedMine();
    known.forEach(function (page) {
      if (mine && page.id === mine.id) return; // on the card above
      var isOff = page.access === "off";
      // The extension level this interface is at, if any: it outranks "network".
      var at = isOff ? null : levelAt(page.id);
      var row = el("li");

      // A green dot first: this row is not a file, it is being served
      // right now -- the same green, and the same breath, as the LIVE
      // pill in the top bar.
      var live = document.createElement("span");
      live.className = "oscar-published-live";
      live.title = "Live: OSCAR is serving this surface right now.";
      if (isOff) {
        // Grey and still: the page is kept, and nobody can open it.
        live.className = "oscar-published-live oscar-published-off";
        live.title = "Off: no device can open this interface. Its schedules and bridges still run.";
      }
      row.appendChild(live);

      var name = el("span", "oscar-published-name", titleOf(page));
      name.title = "/show/" + page.id;
      row.appendChild(name);
      if (!page.editable) {
        var bare = el("span", "oscar-published-note", "no project copy to edit");
        bare.title = "Published before OSCAR kept a copy of the project beside each interface. It runs as it is, and can be taken down.";
        row.appendChild(bare);
      }

      row.appendChild(accessSelect(page, at));

      // Edit: the project this was published from, back on the canvas.
      if (page.editable && options.openProject) {
        var editIt = button("Edit");
        editIt.setAttribute("aria-label", "Edit " + titleOf(page));
        editIt.onclick = function (event) {
          event.stopPropagation();
          openForEdit(page);
        };
        row.appendChild(editIt);
      }
      row.appendChild(moreButton(page));

      // Click a row to see its code: the same block the card shows, under it.
      row.classList.add("oscar-published-row");
      row.tabIndex = 0;
      row.setAttribute("aria-expanded", String(shown === page.id));
      var toggle = function () {
        shown = shown === page.id ? null : page.id;
        drawRows();
      };
      row.onclick = toggle;
      row.onkeydown = function (event) {
        if (event.target !== row) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      };
      if (shown === page.id) {
        var open = whereBlock(page, at);
        open.onclick = function (event) {
          event.stopPropagation();
        };
        row.appendChild(open);
      }
      publishedList.appendChild(row);
    });
    publishedBox.style.display = publishedList.children.length ? "block" : "none";
  }

  function refreshPublished() {
    return Promise.all([
      fetch("/published").then(function (res) {
        return res.ok ? res.json() : [];
      }),
      // What each project is called now: an interface is shown under its
      // project's title, not the one it had the day it was published.
      fetch("/projects")
        .then(function (res) {
          return res.ok ? res.json() : [];
        })
        .catch(function () {
          return [];
        }),
    ])
      .then(function (answers) {
        // Each level says which surfaces are at it. One that fails, or has
        // nothing to offer now, is left out of this drawing and no more.
        return Promise.all(
          levels.map(function (level) {
            return Promise.resolve()
              .then(function () {
                return level.read();
              })
              .then(
                function (map) {
                  levelMaps[level.id] = map && typeof map === "object" ? map : null;
                },
                function () {
                  levelMaps[level.id] = null;
                }
              );
          })
        ).then(function () {
          return answers;
        });
      })
      .then(function (answers) {
        known = Array.isArray(answers[0]) ? answers[0] : [];
        titles = {};
        (Array.isArray(answers[1]) ? answers[1] : []).forEach(function (row) {
          if (row && !row.template && row.id) titles[row.id] = row.name;
        });
        drawCard();
        drawRows();
        paintStale();
        drawSections();
      })
      .catch(function () {
        known = [];
        drawCard();
        drawRows();
        drawSections();
      });
  }

  // ---- a published surface as a file -------------------------------------
  // Its own window, in place of the dialog, which comes back when it closes.
  var downloadPanel = document.getElementById("download-panel");
  var hostField = document.getElementById("download-host");
  var portField = document.getElementById("download-port");
  var downloadError = document.getElementById("download-error");
  var downloadButton = document.getElementById("download-button");
  var downloading = null; // the id of the surface the window is about
  var returning = false; // whether the dialog comes back when the modal closes

  function openDownload(id) {
    downloading = id;
    say(downloadError, "");
    hostField.value = lanHost || options.host || window.location.hostname || "";
    portField.value = lanPort || options.port || "";
    returning = true;
    downloadPanel.style.display = "block";
    editor.Modal.open({
      title: "Download " + id + " as a file",
      content: downloadPanel,
      attributes: { class: "modal-login" },
    });
  }

  editor.on("modal:close", function () {
    if (!returning) return;
    returning = false;
    // A tick later: the modal is still closing, and would close the dialog with it.
    setTimeout(function () {
      open();
    }, 0);
  });

  downloadButton.onclick = function () {
    var host = (hostField.value || "").trim();
    var port = (portField.value || "").trim();
    say(downloadError, "");
    // The server checks both properly; this only saves a round trip.
    if (!host) return say(downloadError, "Say where OSCAR can be reached.");
    if (!port) return say(downloadError, "Say which port OSCAR's bridge is on.");
    var id = downloading;
    downloadButton.disabled = true;
    fetch("/published/" + encodeURIComponent(id) + "/file?host=" + encodeURIComponent(host) + "&port=" + encodeURIComponent(port))
      .then(function (res) {
        if (res.ok) return res.blob();
        return res.json().then(
          function (body) {
            throw new Error((body && body.error) || "The download failed.");
          },
          function () {
            throw new Error("The download failed.");
          }
        );
      })
      .then(function (blob) {
        download(blob, id + ".html");
        editor.Modal.close();
      })
      .catch(function (err) {
        say(downloadError, (err && err.message) || "Could not reach the OSCAR server.");
      })
      .then(function () {
        downloadButton.disabled = false;
      });
  };

  function open() {
    say(errorBox, "");
    say(noteBox, "");
    latest = null;
    restamp();

    // A project saved while Pages was on may still hold several; with the
    // feature off only the first is ever shown, so there is nothing to say.
    var pages = features.PAGES ? editor.Pages.getAll().length : 1;
    pageCount.textContent = String(pages);
    pagesBox.style.display = pages > 1 ? "block" : "none";

    // Asked for now rather than remembered from when the editor loaded: a
    // laptop that has changed network since then has a new address. The
    // address OSCAR reports is the one a tablet on the same Wi-Fi can reach
    // -- not localhost, which would only ever work on this computer.
    fetch("/connection")
      .then(function (res) {
        return res.json();
      })
      .then(function (conn) {
        if (conn && conn.address) lanHost = conn.address;
        if (conn && conn.socketPort) lanPort = String(conn.socketPort);
      })
      .catch(function () {
        /* the values from startup stand */
      })
      .then(refreshPublished);

    drawCard();
    container.style.display = "block";
    editor.Modal.open({
      title: "Publish",
      content: container,
      attributes: { class: "modal-login modal-publish" },
    });
  }

  /**
   * What publishing sends: the surface, its settings written in, and the
   * project it was made from -- which project it is, and the project itself,
   * kept beside the page so the interface can be edited later. A published
   * page is served by OSCAR and finds it by the address it was opened at, so
   * nothing about where OSCAR is goes with it; the server bakes in its own.
   *
   * `as` is who the canvas is published as: { id, name, address }.
   */
  function request(as) {
    say(errorBox, "");
    say(noteBox, "");
    var snapshot = exportSnapshot(editor);
    return {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: as.name,
        fileName: as.address,
        html: snapshot.html,
        css: snapshot.css,
        project: { id: as.id, name: as.name },
        source: options.source ? options.source(as.name, as.id) : undefined,
      }),
    };
  }

  /**
   * Publish the canvas. A project that is live keeps the address it has;
   * one that is not is given one made from its title, with a number when
   * that is taken. Nobody is asked for an address, and nothing that is
   * already live is ever replaced by a project that is not its own.
   */
  function publish(tried) {
    var now = project();
    var mine = publishedMine();
    var taken = known
      .map(function (page) {
        return page.id;
      })
      .concat(RESERVED, tried || []);
    var as = {
      id: now.id || (options.newId ? options.newId() : null),
      name: now.name || "Untitled",
      address: mine ? mine.id : addressFor(now.name || "Untitled", taken),
    };
    publishButton.disabled = true;

    fetch("/publish", request(as))
      .then(function (res) {
        return res.json().then(function (answer) {
          if (!res.ok) throw new Error((answer && answer.error) || "The surface could not be published.");
          return answer;
        });
      })
      .then(function (answer) {
        // Somebody published at that address a moment ago: the next number, not their page.
        if (answer.confirm) {
          if ((tried || []).length >= 5) throw new Error("No free address could be found for this project.");
          return publish((tried || []).concat(as.address));
        }
        latest = answer.id;
        if (answer.linked && answer.linked.length) {
          say(noteBox, "Too large to embed, so these are loaded from OSCAR as the page opens: " + answer.linked.join(", "));
        }
        return refreshPublished();
      })
      .catch(function (err) {
        say(errorBox, (err && err.message) || "Could not reach the OSCAR server.");
      })
      .then(function () {
        publishButton.disabled = false;
      });
  }

  publishButton.onclick = function () {
    publish();
  };

  // The canvas is made a project first, when it is nobody yet: what is
  // published has to belong to one. If that cannot be done -- OSCAR is not
  // answering -- the window opens all the same and says what it can.
  editor.Commands.add("oscar-export", function () {
    if (!options.beforeOpen) return open();
    Promise.resolve()
      .then(options.beforeOpen)
      .then(open, open);
  });

  return {
    /**
     * Let an extension add to the dialog. `draw(box, view)` is called with a
     * box of the extension's own, under the list of what is live, every time
     * the dialog opens and every time what is published changes. `view` is
     * { surfaces: [{ id, name, path, address }], latest: the id just
     * published from here or null, refresh(), show(address, status),
     * onUnpublish(guard) }: guard(id) is asked before an interface is taken
     * down and answers null, or { reason, first() } -- a reason to think
     * twice, put to the person, and what to do first if they go on (first
     * returns a promise). show() does nothing now: each interface shows its
     * own code. Drawing again replaces what the box held; the extension
     * keeps any state it needs.
     */
    addSection: function (draw) {
      if (typeof draw !== "function") throw new Error("A section of the Publish dialog is a draw function");
      var box = document.createElement("div");
      box.className = "oscar-publish-section";
      if (extrasBox) extrasBox.appendChild(box);
      sections.push({ draw: draw, box: box });
    },

    /**
     * Let an extension add an answer to "who can open it", after OSCAR's own
     * Off and This network: somewhere an interface is reachable beyond the
     * local network. `level` is:
     *
     *   id       a short word, not "off" or "network"
     *   label    what the setting calls it; a string, or a function giving one
     *   read()   a promise of { surfaceId: true } for the interfaces at this
     *            level now, or of null when the level is not on offer at all
     *   choose(surfaceId)  put the interface at this level; a promise, rejected
     *            with an Error whose message is for the person when it cannot be
     *   leave(surfaceId)   take it off this level; a promise
     *   link(surfaceId)    optional: where an interface at this level is
     *            opened, { address, state: { text, tone, title } }, or null.
     *            Its address is the one the interface's code is drawn for;
     *            tone is "valid", "grace" or "invalid"
     *   draw(box, surface, view)  optional: anything more the level has to
     *            say about an interface, beside where it is opened. surface
     *            is { id, name, path, address, access }; view is { active,
     *            show(address, status), refresh() }
     *
     * An interface at an extension's level is open to the network as well,
     * and switching it Off leaves the level first.
     */
    addAccessLevel: function (level) {
      if (!level || typeof level.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(level.id) || level.id === "off" || level.id === "network") {
        throw new Error("An access level has an id of its own");
      }
      if (typeof level.read !== "function" || typeof level.choose !== "function" || typeof level.leave !== "function") {
        throw new Error("An access level reads, is chosen and is left");
      }
      levels = levels
        .filter(function (other) {
          return other.id !== level.id;
        })
        .concat([level]);
    },
  };
}

module.exports = { install: install, fileStem: fileStem };
