"use strict";

/**
 * The window behind the MCP pill: AI assistants and this OSCAR.
 *
 * The pill used to be the switch itself, so one stray click closed the door,
 * and nothing in the app said how an assistant is connected in the first
 * place. The window holds the switch, the three ways to connect one (each
 * with what to copy), and what assistants have lately asked for -- the tool
 * and when, never what was in the request -- which is both the proof that a
 * connection works and the reassurance that an assistant only looked.
 *
 * What an assistant connects with is the helper on npm, `createwithoscar`
 * (createwithoscar/ in this repository), or the same thing packed for
 * Claude Desktop, which the website serves.
 */

/** What is copied for Claude Code. */
var CLAUDE_CODE = "claude mcp add oscar -- npx -y createwithoscar";

/** What is copied for every other app that speaks MCP: the same shape in nearly all of them. */
var OTHER_APPS = '{\n  "mcpServers": {\n    "oscar": {\n      "command": "npx",\n      "args": ["-y", "createwithoscar"]\n    }\n  }\n}';

/** The one-click file for Claude Desktop, and where the steps are written out. */
var BUNDLE_URL = "https://www.createwithoscar.site/assets/OSCAR.mcpb";
var HELP_URL = "https://www.createwithoscar.site/how-it-works#ai";

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(text, href, className) {
  var node = el("a", className, text);
  node.href = href;
  node.target = "_blank";
  node.rel = "noopener";
  return node;
}

/** "just now", "3 min ago", "2 h ago": how long since a request, said loosely. */
function ago(at, now) {
  var seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  var minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + " min ago";
  var hours = Math.round(minutes / 60);
  if (hours < 24) return hours + " h ago";
  return Math.round(hours / 24) + " d ago";
}

/** A line of something to copy, and its Copy button. */
function copyLine(text, block) {
  var row = el("div", "oscar-assist-copy");
  row.appendChild(el(block ? "pre" : "code", "oscar-assist-code", text));
  var copy = el("button", "o-btn oscar-publish-copy", "Copy");
  copy.type = "button";
  copy.onclick = function () {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(function () {
      copy.textContent = "Copied";
      setTimeout(function () {
        copy.textContent = "Copy";
      }, 1500);
    });
  };
  row.appendChild(copy);
  return row;
}

/**
 * @param {object} editor the GrapesJS editor
 * @param {object} options
 *   onState(on)  told when the switch is known or thrown, to paint the pill
 * @returns {{ open, refresh }}
 */
function install(editor, options) {
  var onState = (options && options.onState) || function () {};
  var state = { on: false, calls: [] };
  var panel = null;
  var parts = {};

  function build() {
    panel = el("div", "oscar-export oscar-assist");

    panel.appendChild(
      el(
        "p",
        "oscar-export-hint",
        "An AI assistant on this computer, such as Claude, can read this OSCAR and write an interface as a draft for you to check. It never sends anything to your rig, publishes, or changes a project."
      )
    );

    // The switch, which the pill itself used to be.
    var row = el("label", "oscar-assist-switch");
    parts.box = el("input");
    parts.box.type = "checkbox";
    parts.box.onchange = function () {
      set(parts.box.checked);
    };
    row.appendChild(parts.box);
    parts.says = el("span", null, "");
    row.appendChild(parts.says);
    panel.appendChild(row);

    // Two columns where there is room: how to connect, and what comes of it.
    var columns = el("div", "oscar-assist-columns");
    var left = el("div");
    var right = el("div");
    columns.appendChild(left);
    columns.appendChild(right);
    panel.appendChild(columns);

    left.appendChild(el("h4", "oscar-assist-head", "Connect one, once"));
    var ways = el("div", "oscar-assist-ways");

    var desktop = el("div", "oscar-assist-way");
    desktop.appendChild(el("strong", null, "Claude Desktop"));
    var get = el("p", "oscar-assist-note");
    get.appendChild(link("Download OSCAR.mcpb", BUNDLE_URL));
    get.appendChild(document.createTextNode(", double-click it, and choose Install."));
    desktop.appendChild(get);
    ways.appendChild(desktop);

    var code = el("div", "oscar-assist-way");
    code.appendChild(el("strong", null, "Claude Code"));
    code.appendChild(copyLine(CLAUDE_CODE, false));
    ways.appendChild(code);

    var others = el("div", "oscar-assist-way");
    others.appendChild(el("strong", null, "Cursor, VS Code, Windsurf, Codex, Gemini CLI and other MCP apps"));
    others.appendChild(el("p", "oscar-assist-note", "Add this server to the app's MCP settings."));
    others.appendChild(copyLine(OTHER_APPS, true));
    ways.appendChild(others);
    left.appendChild(ways);

    right.appendChild(el("h4", "oscar-assist-head", "Then ask"));
    var asks = el("ul", "oscar-assist-asks");
    asks.appendChild(el("li", null, "“Build me an OSCAR interface with four faders and a blackout button.”"));
    asks.appendChild(el("li", null, "“My OSCAR slider is not moving the light. Can you see why?”"));
    right.appendChild(asks);
    right.appendChild(el("p", "oscar-assist-note", "A draft appears under File → Open, marked Draft."));

    right.appendChild(el("h4", "oscar-assist-head", "What assistants lately asked for"));
    parts.calls = el("ul", "oscar-assist-calls");
    right.appendChild(parts.calls);
    parts.none = el("p", "oscar-assist-note", "Nothing since OSCAR started. A request shows here as it happens.");
    right.appendChild(parts.none);

    var foot = el("p", "oscar-assist-foot");
    foot.appendChild(link("How this works, step by step", HELP_URL));
    panel.appendChild(foot);
  }

  function draw() {
    if (!panel) return;
    parts.box.checked = state.on;
    parts.says.textContent = state.on
      ? "On: an assistant on this computer may connect."
      : "Off: no assistant can connect, whatever it was set up with.";
    panel.classList.toggle("oscar-assist-off", !state.on);

    var now = Date.now();
    parts.calls.textContent = "";
    // Newest first.
    state.calls
      .slice()
      .reverse()
      .slice(0, 8)
      .forEach(function (call) {
        var item = el("li");
        item.appendChild(el("span", "oscar-assist-call", call.title || call.tool));
        item.appendChild(el("span", "oscar-assist-when", ago(call.at, now)));
        parts.calls.appendChild(item);
      });
    parts.none.style.display = state.calls.length ? "none" : "";
  }

  function take(answer) {
    if (!answer) return;
    if (typeof answer.on === "boolean") state.on = answer.on;
    if (Array.isArray(answer.calls)) state.calls = answer.calls;
    onState(state.on);
    draw();
  }

  function refresh() {
    return fetch("/mcp-state")
      .then(function (res) {
        return res.json();
      })
      .then(take)
      .catch(function () {});
  }

  function set(on) {
    fetch("/mcp-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: !!on }),
    })
      .then(function (res) {
        return res.json();
      })
      .then(take)
      .catch(function () {
        // The switch did not move: show it where it stands.
        draw();
      });
  }

  function isOpen() {
    return !!(panel && panel.isConnected && editor.Modal.isOpen());
  }

  function open() {
    if (!panel) build();
    listen();
    draw();
    refresh();
    editor.Modal.open({
      title: "AI assistants",
      content: panel,
      attributes: { class: "modal-login modal-publish" },
    });
  }

  editor.Commands.add("oscar-assistants", open);

  // An assistant asked for something: the list is worth drawing again. The
  // socket may not be up when this is installed, so it is looked for again
  // each time the window opens.
  var listening = false;
  function listen() {
    if (listening || !editor.socket) return;
    listening = true;
    editor.socket.on("mcp:called", function () {
      if (isOpen()) refresh();
    });
  }
  listen();

  refresh();
  return { open: open, refresh: refresh };
}

module.exports = { install: install, ago: ago, CLAUDE_CODE: CLAUDE_CODE, OTHER_APPS: OTHER_APPS, BUNDLE_URL: BUNDLE_URL, HELP_URL: HELP_URL };
