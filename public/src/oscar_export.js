/**
 * "Export" in the editor: turning the canvas into one file that works.
 *
 * What used to be here was GrapesJS's own export-template command, which opens
 * a modal of markup to copy out -- relabelled "See code", because that is all
 * it is. It cannot produce a working interface and never could: the settings
 * that say where a widget sends are not in the markup, and nothing on the page
 * would read them if they were.
 *
 * This asks the adapter for markup with those settings written in, and asks the
 * OSCAR server to wrap it around the standalone runtime. The server does the
 * wrapping because it is the side that can read the runtime bundle and the
 * socket.io client off disk, and knows its own address.
 */

var { exportSnapshot } = require("./adapters/grapesjs");

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
 * Hand a blob to the browser as a download.
 *
 * The object URL is released on the next tick rather than immediately: revoking
 * it in the same frame as the click races the download in Safari and the file
 * arrives empty.
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
 * @param {object} editor - the GrapesJS editor
 * @param {{ host: string, port: number, projectName?: () => string }} options
 */
function install(editor, options) {
  var container = document.getElementById("export-panel");
  if (!container) return;

  var nameField = document.getElementById("export-name");
  var hostField = document.getElementById("export-host");
  var portField = document.getElementById("export-port");
  var errorBox = document.getElementById("export-error");
  var button = document.getElementById("export-button");

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = message ? "block" : "none";
  }

  function open() {
    showError("");
    nameField.value = fileStem((options.projectName && options.projectName()) || "");
    // Prefilled with the address OSCAR reports for itself, which is the one a
    // tablet on the same Wi-Fi can reach -- not localhost, which would only
    // ever work on this computer.
    hostField.value = options.host || window.location.hostname || "localhost";
    portField.value = options.port || 8081;

    container.style.display = "block";
    editor.Modal.open({
      title: "Export your interface",
      content: container,
      attributes: { class: "modal-login" },
    });
  }

  button.onclick = function () {
    var host = (hostField.value || "").trim();
    var port = Number(portField.value);
    var stem = fileStem(nameField.value);

    if (!host) return showError("Say where OSCAR can be reached.");
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return showError("The bridge port is a whole number between 1 and 65535.");
    }

    showError("");
    button.disabled = true;

    var snapshot = exportSnapshot(editor);

    fetch("/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: nameField.value.trim() || DEFAULT_NAME,
        fileName: stem,
        html: snapshot.html,
        css: snapshot.css,
        connection: { host: host, port: port },
      }),
    })
      .then(function (res) {
        if (res.ok) return res.blob();
        return res.json().then(
          function (body) {
            throw new Error((body && body.error) || "The export failed.");
          },
          function () {
            throw new Error("The export failed.");
          }
        );
      })
      .then(function (blob) {
        download(blob, stem + ".html");
        editor.Modal.close();
      })
      .catch(function (err) {
        showError(err.message || "Could not reach the OSCAR server.");
      })
      .then(function () {
        button.disabled = false;
      });
  };

  editor.Commands.add("oscar-export", open);
}

module.exports = { install: install, fileStem: fileStem };
