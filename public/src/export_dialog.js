/**
 * "Export" in the editor: turning the canvas into one file that works.
 *
 * What the toolbar had before is GrapesJS's own export-template command, a
 * modal of markup to copy out -- labelled "See code", because that is all it
 * is. It cannot produce a working interface: the settings that say where a
 * widget sends are not in the markup, and nothing on the page would read
 * them if they were.
 *
 * This asks the adapter for markup with those settings written in, and the
 * OSCAR server to wrap it around the standalone runtime (POST /export).
 *
 * Not named oscar_*.js: requiring "./oscar_<name>" is how an entry point used
 * to pull in one widget's file, and test/widgets.test.js refuses that pattern
 * in the entry points so nobody wires a widget by hand again.
 */

var { exportSnapshot } = require("./adapters/grapesjs");
var { surfaceAddress } = require("../../lib/published-address");
var { surfaceStamp } = require("../../lib/export/stamp");
var features = require("../../lib/features");
// Draws the code for a published surface's address. Bundled, like everything
// else here: OSCAR runs at venues with no internet.
var qrcode = require("qrcode-generator");

var DEFAULT_NAME = "my-interface";

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

/**
 * @param {object} editor the GrapesJS editor
 * @param {object} options
 *        host, port: what the editor was started with, offered for a download
 *        only if the server cannot be asked again
 *        project(): { id, name } -- which project the canvas is (lib/open-project.js)
 *        adopt({ id, name }): the canvas was published as this project; remember it
 *        newId(): an id for a canvas that had none
 *        source(name, id): the project on the canvas, as a file would hold it
 *        openProject({ id, name, data }): Edit -- put that project on the canvas
 */
function install(editor, options) {
  var container = document.getElementById("export-panel");
  if (!container) return;

  var publishButton = document.getElementById("publish-button");
  var resultBox = document.getElementById("publish-result");
  var qrBox = document.getElementById("publish-qr");
  var statusLine = document.getElementById("publish-status");
  var link = document.getElementById("publish-link");
  var copyButton = document.getElementById("publish-copy");
  var mineBox = document.getElementById("publish-mine");
  var mineText = document.getElementById("publish-mine-text");
  var fieldBox = document.getElementById("publish-field");
  var fieldHint = document.getElementById("publish-field-hint");
  var publishedBox = document.getElementById("published-box");
  var publishedList = document.getElementById("published-list");
  var extrasBox = document.getElementById("publish-extras");
  // The canvas's stamp against each published copy's (lib/export/stamp.js):
  // the dialog says "older than your canvas" on the surface this canvas would
  // publish over, and the toolbar's Publish button wears a dot meanwhile.
  var canvasStamp = null; // worked out at most once per wave of edits

  // What an extension adds to the dialog (addSection below): each gets a box
  // of its own in #publish-extras and is asked to draw whenever the dialog
  // opens or what is published changes.
  var sections = [];
  var latest = null; // the id of the surface published from this dialog, most recently
  var known = []; // the published surfaces, as GET /published last said
  var staleMark = null; // the "outdated" mark on the row of this canvas's own interface
  // The address other devices reach OSCAR on, and its bridge port, as GET
  // /connection last said; what a download is told unless it is changed.
  var lanHost = "";
  var lanPort = "";

  /** Where a published surface is opened from another device. */
  function addressOf(path) {
    return surfaceAddress(lanHost || window.location.hostname, window.location.port || 80, path);
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
            return { id: page.id, name: page.name || page.id, path: page.path, address: addressOf(page.path) };
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
   * The one box for an address: its code, the link, and Copy. Both lists
   * below show their addresses here, a published surface's on the network
   * and, from an extension, wherever else it is reachable.
   */
  function showAddress(address, status) {
    statusLine.textContent = status;
    link.textContent = address;
    link.href = address;
    // Drawn by the library from an address OSCAR or an extension built;
    // nothing a person typed reaches it except a name, reduced to a-z, 0-9 and "-".
    var code = qrcode(0, "M");
    code.addData(address);
    code.make();
    qrBox.innerHTML = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    copyButton.textContent = "Copy the link";
    resultBox.style.display = "flex";
  }

  function showPublished(path, replaced) {
    showAddress(addressOf(path), replaced ? "Published again, at the same address:" : "Published. Open it at:");
  }

  /** Which project the canvas is: { id, name }, id null for a canvas that is nobody yet. */
  function project() {
    var now = options.project ? options.project() : null;
    return { id: (now && now.id) || null, name: (now && now.name) || "" };
  }

  /**
   * The live interface that is this canvas's own: the one published from the
   * project it is, whatever either is called now. Not matched by name -- a
   * name is reused for different designs, and a wrong match would let Update
   * replace a running show with another one.
   */
  function publishedMine() {
    var id = project().id;
    if (!id) return null;
    for (var i = 0; i < known.length; i++) {
      if (known[i].project === id) return known[i];
    }
    return null;
  }

  /** The address this canvas would publish at right now. */
  function currentStem() {
    var mine = publishedMine();
    if (mine) return mine.id;
    return fileStem(nameField && nameField.value ? nameField.value : project().name);
  }

  function staleNow() {
    var mine = publishedMine();
    if (!mine || !mine.stamp || canvasStamp === null) return false;
    return mine.stamp !== canvasStamp;
  }

  /**
   * The top of the window, for the project on the canvas: one that is live
   * already is updated at the address it has, in one click; one that is not
   * is asked where it should go.
   */
  function paintMine() {
    var mine = publishedMine();
    if (fieldBox) fieldBox.style.display = mine ? "none" : "";
    if (fieldHint) fieldHint.style.display = mine ? "none" : "";
    if (mineBox) mineBox.style.display = mine ? "" : "none";
    if (mine && mineText) {
      mineText.textContent =
        '"' + (mine.name || mine.id) + '" is live at /show/' + mine.id + (staleNow() ? ". The canvas has changes that are not live yet." : ". It is up to date.");
    }
    publishButton.textContent = mine ? "Update" : "Publish on the local network";
    if (staleMark) staleMark.style.display = staleNow() ? "" : "none";
  }

  /**
   * The Publish button in the toolbar, found by its class. (It was once found
   * by its tooltip, which paintStale changes: after the first dot it was
   * never found again, and the dot could not be taken off.)
   */
  function toolbarButton() {
    return document.querySelector(".gjs-pn-options .oscar-publish-btn");
  }

  function paintStale() {
    var button = toolbarButton();
    if (!button) return;
    var stale = staleNow();
    button.classList.toggle("oscar-publish-stale", stale);
    button.setAttribute(
      "data-tooltip",
      stale ? "Publish your interface \u00b7 the published copy is older than your canvas" : "Publish your interface"
    );
    paintMine();
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

  copyButton.onclick = function () {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(link.href).then(function () {
      copyButton.textContent = "Copied";
      setTimeout(function () {
        copyButton.textContent = "Copy the link";
      }, 1500);
    });
  };

  function refreshPublished() {
    return fetch("/published")
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .then(function (pages) {
        publishedList.textContent = "";
        staleMark = null;
        known = Array.isArray(pages) ? pages : [];
        known.forEach(function (page) {
          var row = document.createElement("li");

          // A green dot first: this row is not a file, it is being served
          // right now -- the same green, and the same breath, as the LIVE
          // pill in the top bar.
          var live = document.createElement("span");
          live.className = "oscar-published-live";
          live.title = "Live: OSCAR is serving this surface right now.";
          row.appendChild(live);

          var open = document.createElement("a");
          open.className = "o-link";
          open.target = "_blank";
          open.rel = "noopener";
          open.href = addressOf(page.path);
          // The project's name, when OSCAR was told it; the whole address is in the box above, from QR.
          open.textContent = page.name || page.id;
          open.title = addressOf(page.path);
          open.className = "o-link oscar-published-name";
          row.appendChild(open);

          var mine = publishedMine();
          var isMine = !!mine && mine.id === page.id;
          if (isMine) {
            var here = document.createElement("span");
            here.className = "oscar-published-state";
            here.setAttribute("data-state", "valid");
            here.textContent = "on the canvas";
            here.title = "This is the project open in the editor. Update sends your changes to it.";
            row.appendChild(here);
          }

          // Only the interface published from this project is judged against
          // the canvas. The mark is always there on its row, and shown or
          // hidden as the canvas changes (paintMine), with the dialog open.
          if (isMine) {
            var stale = document.createElement("span");
            stale.className = "oscar-published-state";
            stale.setAttribute("data-state", "grace");
            stale.textContent = "outdated";
            stale.title = "The canvas has changed since this was published. Update sends the changes.";
            stale.style.display = staleNow() ? "" : "none";
            staleMark = stale;
            row.appendChild(stale);
          }

          var qr = document.createElement("button");
          qr.type = "button";
          qr.className = "o-btn";
          qr.textContent = "QR";
          qr.setAttribute("aria-label", "Show the QR code for " + page.id);
          qr.onclick = function () {
            showPublished(page.path, false);
            statusLine.textContent = "Open it at:";
          };
          row.appendChild(qr);

          var file = document.createElement("button");
          file.type = "button";
          file.className = "o-btn";
          file.textContent = "Download";
          file.setAttribute("aria-label", "Download " + page.id + " as a file");
          file.onclick = function () {
            openDownload(page.id);
          };
          row.appendChild(file);

          // Edit: the project this was published from, back on the canvas.
          // Not for the one already there, nor for a page with no copy kept.
          if (page.editable && !isMine && options.openProject) {
            var editIt = document.createElement("button");
            editIt.type = "button";
            editIt.className = "o-btn";
            editIt.textContent = "Edit";
            editIt.setAttribute("aria-label", "Edit " + (page.name || page.id));
            editIt.onclick = function () {
              openForEdit(page);
            };
            row.appendChild(editIt);
          }

          var remove = document.createElement("button");
          remove.type = "button";
          remove.className = "o-btn";
          remove.textContent = "Take down";
          remove.title = "Stop serving this interface, and its schedules and bridges with it.";
          remove.setAttribute("aria-label", "Take down " + (page.name || page.id));
          remove.onclick = function () {
            // A section may have a reason to think twice (the surface is
            // public on the internet, say), and something to do first.
            var warnings = sections
              .map(function (section) {
                return typeof section.guard === "function" ? section.guard(page.id) : null;
              })
              .filter(Boolean);
            var unpublish = function () {
              remove.disabled = true;
              fetch("/published/" + encodeURIComponent(page.id), { method: "DELETE" }).then(function () {
                if (link.href === addressOf(page.path)) resultBox.style.display = "none";
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
          };
          row.appendChild(remove);
          publishedList.appendChild(row);
        });
        publishedBox.style.display = publishedList.children.length ? "block" : "none";
        paintStale();
        paintMine();
        drawSections();
      })
      .catch(function () {
        publishedBox.style.display = "none";
        known = [];
        drawSections();
      });
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

  var nameField = document.getElementById("export-name");
  var errorBox = document.getElementById("export-error");
  var noteBox = document.getElementById("export-note");
  var pagesBox = document.getElementById("export-pages");
  var pageCount = document.getElementById("export-page-count");

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
    setTimeout(open, 0);
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

  function say(box, message) {
    box.textContent = message;
    box.style.display = message ? "block" : "none";
  }

  function open() {
    say(errorBox, "");
    say(noteBox, "");
    latest = null;
    nameField.value = fileStem(project().name);
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
    resultBox.style.display = "none";

    container.style.display = "block";
    editor.Modal.open({
      title: "Publish your interface",
      content: container,
      // Wider than the other dialogs: two lists side by side, a row each.
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
  function request(as, replace) {
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
        replace: replace === true,
      }),
    };
  }

  /** Who the canvas is published as, worked out once per click. */
  function publishingAs() {
    var now = project();
    var mine = publishedMine();
    var typed = (nameField.value || "").trim();
    return {
      // A canvas that is nobody yet becomes somebody by being published.
      id: now.id || (options.newId ? options.newId() : null),
      name: now.name || (mine && mine.name) || typed || DEFAULT_NAME,
      // Its own address if it has one; otherwise what was typed.
      address: mine ? mine.id : fileStem(typed),
    };
  }

  function publish(as, replace) {
    publishButton.disabled = true;

    fetch("/publish", request(as, replace))
      .then(function (res) {
        return res.json().then(function (answer) {
          if (!res.ok) throw new Error((answer && answer.error) || "The surface could not be published.");
          return answer;
        });
      })
      .then(function (answer) {
        // The address is somebody's already: another project's, or a page
        // from before OSCAR kept track. Asked once, and sent again with the answer.
        if (answer.confirm) {
          var yes = function () {
            publish(as, true);
          };
          if (window.$ && typeof window.$.confirm === "function") {
            window.$.confirm({
              title: "Replace the interface?",
              content: answer.confirm + " Phones that have it open will get this one when they reload.",
              boxWidth: "520px",
              useBootstrap: false,
              buttons: { confirm: { text: "Replace it", btnClass: "btn-red", action: yes }, cancel: { text: "Cancel" } },
            });
          } else if (window.confirm(answer.confirm)) yes();
          return null;
        }
        // The canvas is this project from now on, across a reload too.
        if (options.adopt) options.adopt({ id: as.id, name: as.name });
        latest = answer.id;
        showPublished(answer.path, answer.replaced);
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
    publish(publishingAs(), false);
  };

  editor.Commands.add("oscar-export", open);

  return {
    /**
     * Let an extension add to the dialog. `draw(box, view)` is called with a
     * box of the extension's own, under the publish result and above the list
     * of what is published, every time the dialog opens and every time what is
     * published changes. `view` is { surfaces: [{ id, name, path, address }], latest:
     * the id just published from here or null, refresh(), show(address,
     * status), onUnpublish(guard) }: show puts an address in the dialog's own
     * box, with its code and Copy, as a published surface's is shown; guard(id)
     * is asked before a surface is unpublished and answers null, or { reason,
     * first() } -- a reason to think twice, put to the person, and what to do
     * first if they go on (first returns a promise). Drawing again replaces
     * what the box held; the extension keeps any state it needs.
     */
    addSection: function (draw) {
      if (typeof draw !== "function") throw new Error("A section of the Publish dialog is a draw function");
      var box = document.createElement("div");
      box.className = "oscar-publish-section";
      if (extrasBox) extrasBox.appendChild(box);
      sections.push({ draw: draw, box: box });
    },
  };
}

module.exports = { install: install, fileStem: fileStem };
