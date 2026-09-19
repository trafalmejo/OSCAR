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

/** The files the server left as links, from its response header. */
function linkedAssets(res) {
  try {
    var list = JSON.parse(decodeURIComponent(res.headers.get("X-Oscar-Linked-Assets") || "[]"));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

/**
 * @param {object} editor the GrapesJS editor
 * @param {{ host: string, port: number, projectName?: () => string }} options
 *        host and port are what the editor was started with, used only if
 *        the server cannot be asked again
 */
function install(editor, options) {
  var container = document.getElementById("export-panel");
  if (!container) return;

  var publishButton = document.getElementById("publish-button");
  var resultBox = document.getElementById("publish-result");
  var qrBox = document.getElementById("publish-qr");
  var statusLine = document.getElementById("publish-status");
  var link = document.getElementById("publish-link");
  var publishedBox = document.getElementById("published-box");
  var publishedList = document.getElementById("published-list");
  // The address other devices reach OSCAR on, as GET /connection last said.
  var lanHost = "";

  /** Where a published surface is opened from another device. */
  function addressOf(path) {
    return surfaceAddress(lanHost || window.location.hostname, window.location.port || 80, path);
  }

  function showPublished(path, replaced) {
    var address = addressOf(path);
    statusLine.textContent = replaced ? "Published again, at the same address:" : "Published. Open it at:";
    link.textContent = address;
    link.href = address;
    // Drawn by the library from an address OSCAR built; nothing a person typed
    // reaches it except the name, which has been reduced to a-z, 0-9 and "-".
    var code = qrcode(0, "M");
    code.addData(address);
    code.make();
    qrBox.innerHTML = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    resultBox.style.display = "flex";
  }

  function refreshPublished() {
    return fetch("/published")
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .then(function (pages) {
        publishedList.textContent = "";
        (Array.isArray(pages) ? pages : []).forEach(function (page) {
          var row = document.createElement("li");
          var open = document.createElement("a");
          open.className = "o-link";
          open.target = "_blank";
          open.rel = "noopener";
          open.href = addressOf(page.path);
          open.textContent = addressOf(page.path);
          row.appendChild(open);

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

          var remove = document.createElement("button");
          remove.type = "button";
          remove.className = "o-btn";
          remove.textContent = "Unpublish";
          remove.setAttribute("aria-label", "Unpublish " + page.id);
          remove.onclick = function () {
            remove.disabled = true;
            fetch("/published/" + encodeURIComponent(page.id), { method: "DELETE" }).then(function () {
              if (link.href === addressOf(page.path)) resultBox.style.display = "none";
              refreshPublished();
            });
          };
          row.appendChild(remove);
          publishedList.appendChild(row);
        });
        publishedBox.style.display = publishedList.children.length ? "block" : "none";
      })
      .catch(function () {
        publishedBox.style.display = "none";
      });
  }

  var nameField = document.getElementById("export-name");
  var hostField = document.getElementById("export-host");
  var portField = document.getElementById("export-port");
  var errorBox = document.getElementById("export-error");
  var noteBox = document.getElementById("export-note");
  var pagesBox = document.getElementById("export-pages");
  var pageCount = document.getElementById("export-page-count");
  var button = document.getElementById("export-button");

  function say(box, message) {
    box.textContent = message;
    box.style.display = message ? "block" : "none";
  }

  function open() {
    say(errorBox, "");
    say(noteBox, "");
    nameField.value = fileStem((options.projectName && options.projectName()) || "");

    var pages = editor.Pages.getAll().length;
    pageCount.textContent = String(pages);
    pagesBox.style.display = pages > 1 ? "block" : "none";

    // Asked for now rather than remembered from when the editor loaded: a
    // laptop that has changed network since then has a new address, and the
    // file is about to have this one baked into it. The address OSCAR reports
    // is the one a tablet on the same Wi-Fi can reach -- not localhost, which
    // would only ever work on this computer.
    hostField.value = options.host || window.location.hostname || "";
    portField.value = options.port || "";
    fetch("/connection")
      .then(function (res) {
        return res.json();
      })
      .then(function (conn) {
        if (conn && conn.address) {
          hostField.value = conn.address;
          lanHost = conn.address;
        }
        if (conn && conn.socketPort) portField.value = conn.socketPort;
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
      attributes: { class: "modal-login" },
    });
  }

  /**
   * What both buttons send: the same surface, built the same way. Null if
   * something is missing.
   *
   * Only a downloaded file has to be told where OSCAR is. A published page is
   * served by OSCAR and finds it by the address it was opened at, so
   * publishing asks for nothing and the server bakes in its own address.
   */
  function request(needsAddress) {
    var host = (hostField.value || "").trim();
    var port = (portField.value || "").trim();

    say(errorBox, "");
    say(noteBox, "");
    if (needsAddress) {
      // The server checks both properly; this only saves a round trip.
      if (!host) return say(errorBox, "Say where OSCAR can be reached."), null;
      if (!port) return say(errorBox, "Say which port OSCAR's bridge is on."), null;
    }

    var snapshot = exportSnapshot(editor);
    return {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: (nameField.value || "").trim() || DEFAULT_NAME,
        fileName: fileStem(nameField.value),
        html: snapshot.html,
        css: snapshot.css,
        connection: needsAddress ? { host: host, port: port } : undefined,
      }),
    };
  }

  publishButton.onclick = function () {
    var body = request(false);
    if (!body) return;
    publishButton.disabled = true;

    fetch("/publish", body)
      .then(function (res) {
        return res.json().then(function (answer) {
          if (!res.ok) throw new Error((answer && answer.error) || "The surface could not be published.");
          return answer;
        });
      })
      .then(function (answer) {
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
  };

  button.onclick = function () {
    var stem = fileStem(nameField.value);
    var body = request(true);
    if (!body) return;
    button.disabled = true;

    fetch("/export", body)
      .then(function (res) {
        if (res.ok) {
          return res.blob().then(function (blob) {
            return { blob: blob, linked: linkedAssets(res) };
          });
        }
        return res.json().then(
          function (body) {
            throw new Error((body && body.error) || "The export failed.");
          },
          function () {
            throw new Error("The export failed.");
          }
        );
      })
      .then(function (result) {
        download(result.blob, stem + ".html");
        if (!result.linked.length) return editor.Modal.close();
        // The one case where the file is not the whole story, so the dialog
        // stays up to say it.
        say(
          noteBox,
          "Downloaded. Too large to embed, so these stay as links and have to be " +
            "kept next to the file: " + result.linked.join(", ")
        );
      })
      .catch(function (err) {
        say(errorBox, (err && err.message) || "Could not reach the OSCAR server.");
      })
      .then(function () {
        button.disabled = false;
      });
  };

  editor.Commands.add("oscar-export", open);
}

module.exports = { install: install, fileStem: fileStem };
