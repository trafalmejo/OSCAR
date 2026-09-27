"use strict";

// The LIVE pill: the editor's top bar says OSCAR is serving published
// surfaces in the background. The server side is surfaces' onActivity --
// "in" as it consumes OSC or MIDI for a published surface, "out" as it
// sends on one's behalf -- and the events server.js turns that into. The
// editor side is a button between the screen sizes and the network info.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { byName } = require("../lib/widgets");
const { createSurfaces } = require("../lib/surfaces");
const { PublishedStore } = require("../lib/published");
const { SharedState } = require("../lib/shared-state");
const { exportAttributes } = require("../lib/export/config");

function tag(name, id, settings) {
  const definition = byName[name];
  const config = Object.assign({}, definition.defaults, settings);
  const attributes = Object.assign({ id }, exportAttributes(name, (key) => config[key]));
  const text = Object.entries(attributes)
    .map(([k, v]) => k + '="' + String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"')
    .join(" ");
  return "<" + definition.tag + " " + text + "></" + definition.tag + ">";
}

async function venue(widgets) {
  const published = new PublishedStore(fs.mkdtempSync(path.join(os.tmpdir(), "oscar-live-")));
  await published.save("Stage", "<body>" + widgets.join("") + "</body>");
  const store = new SharedState();
  const activity = [];
  const surfaces = createSurfaces({
    published,
    sendOSC: () => {},
    sendDMX: () => {},
    sendMIDI: () => {},
    shared: { store },
    io: { emit: () => {} },
    onActivity: (dir) => activity.push(dir),
  });
  return { surfaces, store, activity };
}

const osc = (address, ...values) => ({ address, args: values.map((value) => ({ type: "f", value })) });

test("consuming OSC for a published widget says IN; a message nobody follows says nothing", async () => {
  const { surfaces, store, activity } = await venue([tag("oscar-slider", "s1", { enabled: true, listen: true, message: "/level", min: 0, max: 1 })]);
  store.onChange(() => {});

  await surfaces.hearOsc(osc("/level", 0.7));
  assert.deepStrictEqual(activity, [{ dir: "in", protocol: "osc", what: "/level", surface: "stage", n: 1 }], "one event, saying what was consumed and for whom");

  await surfaces.hearOsc(osc("/nothing/here", 1));
  assert.strictEqual(activity.length, 1, "a message that moved nothing lights nothing");
});

test("a drive on a published surface's behalf says OUT, and a bridge says both", async () => {
  const { surfaces, activity } = await venue([tag("oscar-slider", "s2", { enabled: true, message: "/dim", min: 0, max: 1 })]);

  const driven = await surfaces.drive("stage", "s2", { value: 0.5 });
  assert.strictEqual(driven.ok, true);
  assert.deepStrictEqual(
    activity.map((e) => [e.dir, e.protocol, e.surface]),
    [["out", "osc", "stage"]],
    "the send was the server's, for the surface, named per protocol"
  );

  const bridged = await venue([tag("oscar-slider", "s3", { enabled: true, listen: true, message: "/dim", min: 0, max: 1, oscSendWhen: "data" })]);
  await bridged.surfaces.hearOsc(osc("/dim", 0.9));
  assert.deepStrictEqual(
    bridged.activity.map((e) => [e.dir, e.protocol]),
    [["out", "osc"], ["in", "osc"]],
    "what came in went back out: both lights"
  );
  assert.strictEqual(bridged.activity[0].origin, "bridge", "and the send says it was a bridge's");
});

test("a drive says whose move it was when its caller says: a visitor's phone and a schedule apart", async () => {
  const { surfaces, activity } = await venue([tag("oscar-slider", "s6", { enabled: true, message: "/dim", min: 0, max: 1 })]);
  await surfaces.drive("stage", "s6", { value: 0.2 }, { origin: "internet" });
  await surfaces.drive("stage", "s6", { value: 0.3 }, { origin: "schedule" });
  await surfaces.drive("stage", "s6", { value: 0.4 });
  assert.deepStrictEqual(
    activity.map((e) => e.origin),
    ["internet", "schedule", undefined],
    "a caller that says nothing (an older extension) gets no label rather than a wrong one"
  );
});

test("MIDI consumed for a published widget says IN with the message spelled out", async () => {
  const { surfaces, store, activity } = await venue([tag("oscar-slider", "s5", { enabled: true, midiListen: true, midiType: "cc", midiChannel: 1, midiNumber: 7, min: 0, max: 1 })]);
  store.onChange(() => {});
  await surfaces.hearMidi({ type: "cc", channel: 1, number: 7, unit: 0.5 }, "nanoKONTROL2", true);
  assert.deepStrictEqual(activity, [{ dir: "in", protocol: "midi", what: "cc 7 ch 1 · nanoKONTROL2", surface: "stage", n: 1 }]);
});

test("a widget switched off is driven silently: shown, not sent, and no OUT", async () => {
  const { surfaces, activity } = await venue([tag("oscar-slider", "s4", { enabled: false, message: "/dim", min: 0, max: 1 })]);
  await surfaces.drive("stage", "s4", { value: 0.5 });
  assert.deepStrictEqual(activity, [], "nothing reached the rig, so nothing lights");
});

// ---- the wiring, read from the sources -----------------------------------

// Read with line endings normalised: a git checkout on Windows rewrites
// these files with CRLF, and the multiline assertions anchor on \n.
const readSource = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8").replace(/\r\n/g, "\n");
const serverSource = readSource("server.js");
const editorSource = readSource("public", "src", "oscar_editor.js");
const themeSource = readSource("public", "css", "oscar_theme.css");
const routesSource = readSource("routes", "index.js");

test("the server throttles the flickers, keeps the log, and announces the roster's changes", () => {
  assert.match(serverSource, /io\.emit\("live:activity", \{ dir: event\.dir \}\)/, "the activity event");
  assert.match(serverSource, /at - activityAt\[event\.dir\] >= 200/, "throttled per direction");
  assert.match(serverSource, /onActivity: tellActivity/, "handed to the surfaces");
  assert.match(serverSource, /io\.emit\("live:log", entry\)/, "the log rows flow to every editor");
  assert.match(serverSource, /held\.n \+= event\.n \|\| 1;/, "repeats coalesce into one row with a count");
  assert.match(serverSource, /const key = \[event\.dir, event\.protocol, event\.what, event\.surface \|\| "", event\.origin \|\| "", event\.device \|\| ""\]\.join\("\|"\);/, "but a tablet and a visitor's phone never share a row");
  assert.match(serverSource, /origin: event\.origin, device: event\.device, n: event\.n \|\| 1/, "the row carries whose move it was");
  assert.match(serverSource, /liveLog\.splice\(0, liveLog\.length - LIVE_LOG_KEEP\)/, "the backlog is capped");
  assert.match(serverSource, /surfaces\.onPublished\(\(id\) => \{\n  io\.emit\("published:changed"\);/, "publishing recounts the pill");
  assert.match(serverSource, /onPublishedChanged: \(\) => io\.emit\("published:changed"\)/, "unpublishing does too");
  assert.match(routesSource, /if \(onPublishedChanged\) onPublishedChanged\(\);/, "from the route that unpublishes");
  assert.match(routesSource, /router\.get\("\/live\/log", editorOnly/, "the backlog behind a freshly opened window");
});

test("the pill sits between the screen sizes and the network info, split into its two doors", () => {
  const pill = editorSource.indexOf('id: "oscar-live-pill"');
  const ip = editorSource.indexOf('id: "ipButton"');
  assert.ok(pill !== -1 && ip !== -1 && pill < ip, "added before ipButton, which is what renders it in the gap");
  // Disabled to GrapesJS on purpose: a command toggles the button active,
  // and re-rendering it wiped the count and hid the pill (the bug where it
  // vanished after the publish window closed).
  const button = editorSource.slice(pill, editorSource.indexOf("});", pill));
  assert.match(button, /command: null/, "no command to toggle");
  assert.match(button, /disable: true/, "no active state to re-render on");
  assert.match(button, /data-zone="publish"/, "the LIVE half");
  assert.match(button, /data-zone="log"/, "the lights half");
  assert.match(editorSource, /editor\.runCommand\("oscar-export"\)/, "LIVE opens the publish window");
  assert.match(editorSource, /else openLiveLog\(\);/, "the lights open the network log");
  assert.match(editorSource, /editor\.socket\.on\("live:activity"/, "the flickers arrive by socket");
  assert.match(editorSource, /editor\.socket\.on\("live:log"/, "the log listens all along");
  assert.match(editorSource, /editor\.socket\.on\("published:changed", refreshLive\)/, "the count follows the roster");
  // Always present: with nothing published it goes quiet instead of away,
  // so the place to look never moves.
  assert.match(themeSource, /\.gjs-pn-btn\.oscar-live-btn \{\n  display: inline-flex;/, "shown whether or not anything is published");
  assert.match(themeSource, /:not\(\.oscar-live-on\) \.oscar-live-word \{\n  text-decoration: line-through;/, "LIVE struck through at zero");
  assert.match(editorSource, /Nothing is published: OSCAR serves no surfaces in the background\./, "the quiet pill says why");
  assert.match(themeSource, /border: 1px solid rgba\(47, 191, 95, 0\.55\)/, "the pill is green");
});

test("the log window says the address first, then the traffic, filtered by direction and protocol", () => {
  assert.match(editorSource, /head\.textContent = "Server IP: " \+ ipServer \+ \(oscInPort \? " · Listening Port: " \+ oscInPort : ""\)/, "the address on top");
  for (const key of ['"in", "Incoming"', '"out", "Outgoing"', '"osc", "OSC"', '"midi", "MIDI"', '"dmx", "DMX"']) {
    assert.ok(editorSource.indexOf("[" + key + "]") !== -1, "a filter for " + key);
  }
  assert.match(editorSource, /if \(!logFilters\[row\.dir\] \|\| !logFilters\[row\.protocol\]\) continue;/, "rows obey the filters");
  assert.match(editorSource, /where\.className = "oscar-log-surface"/, "each row names its surface, incoming included");
  assert.match(editorSource, /fetch\("\/live\/log"\)/, "opened onto the backlog, not an empty page");
});

test("the log floats so the faders stay usable under it: that is what it is for", () => {
  assert.match(editorSource, /title\.textContent = "Network log"/, "its own window, with its own title bar");
  assert.ok(editorSource.indexOf("modal.open({ title: \"Network log\"") === -1, "not a modal: a modal blocks the very canvas being debugged");
  assert.match(editorSource, /bar\.addEventListener\("pointerdown"/, "dragged by the title bar");
  // The moves are heard by the window and the canvas iframe is shielded for
  // the drag's duration: an iframe eats pointer moves, which left the drag
  // sticking the moment the pointer crossed the canvas.
  assert.match(editorSource, /window\.addEventListener\("pointermove"/, "the drag follows the pointer everywhere");
  assert.match(editorSource, /document\.body\.classList\.add\("oscar-log-dragging"\)/, "the shield goes up");
  assert.match(themeSource, /body\.oscar-log-dragging iframe \{\n  pointer-events: none;/, "and the canvas cannot eat the moves");
  assert.match(editorSource, /if \(logOpen\(\)\) \{\n        logBox\.style\.display = "none";/, "the lights toggle it");
  assert.match(editorSource, /window\.innerWidth - at\.width\) \/ 2/, "opened in the middle of the screen, then dragged from there");
  assert.match(themeSource, /\.oscar-live-log \{\n  position: fixed;/, "floating over the editor");
  assert.match(themeSource, /width: 820px;/, "wide enough to read");
  assert.match(themeSource, /height: 420px;/, "a fixed height, not one that grows with every row");
});

test("every send over a socket is logged by the server, saying whose it was", () => {
  assert.match(serverSource, /const from = socketOrigin\(socket\.handshake\.query && socket\.handshake\.query\.from, socket\.handshake\.address\);/, "each connection says who it is");
  assert.match(serverSource, /sendOSC\(msg\.ip, msg\.port, msg\.address, msg\.args\);\n      logOut\("osc", msg\.address\);/, "OSC from a page or the canvas is logged");
  assert.match(serverSource, /sendOSC\(ip, port, address, \[\{ type, value \}\]\);\n      logOut\("osc", address\);/, "so is the old single-value form");
  assert.match(serverSource, /sendDMX\(request\);\n      logOut\("dmx", dmxWords\(request\)\);/, "DMX");
  assert.match(serverSource, /if \(sendMIDI\(request\) !== false\) logOut\("midi", midiWords\(request\)\);/, "MIDI, when it actually went out");
  assert.match(serverSource, /if \(event\.origin !== "canvas" && at - activityAt\[event\.dir\] >= 200\)/, "the canvas is logged but does not flash the background lights");
});

test("each page says who it is when it connects", () => {
  const socketSource = readSource("public", "src", "oscar_socket.js");
  const previewSource = readSource("public", "src", "oscar_preview.js");
  const runtimeSource = readSource("public", "src", "oscar_runtime.js");
  assert.match(socketSource, /if \(options && typeof options\.from === "string"\) connectOptions\.query = \{ from: options\.from \};/, "the handshake carries it");
  assert.match(editorSource, /oscar_socket: \{ ipserver: ipServer, socketPort: socketPort, from: "canvas" \}/, "the editor is the canvas");
  assert.match(previewSource, /surface: true, from: "preview" \}/, "the preview is itself");
  assert.match(runtimeSource, /surface: true, from: pageFrom\(window\.location\) \}/, "a published page names its surface");
  assert.match(runtimeSource, /return match \? "show:" \+ match\[1\] : "file";/, "from its /show/ address, or is a file");
  assert.doesNotMatch(runtimeSource, /relaySocket\(url\), surface: true, from/, "a phone through the relay says nothing: the relay's path is what makes it internet");
});

test("Clear hides what is listed so far, in this window only, by the server's clock", () => {
  assert.match(editorSource, /clear\.textContent = "Clear";/, "a Clear button");
  assert.match(editorSource, /clear\.addEventListener\("click", clearLog\);/, "that clears");
  assert.match(editorSource, /if \(logRows\[i\]\.at > clearedThrough\) clearedThrough = logRows\[i\]\.at;/, "up to the newest row's own time, not this device's clock");
  assert.match(editorSource, /if \(row\.at <= clearedThrough\) continue;/, "so the backlog fetched on reopening stays cleared too");
  assert.ok(!/fetch\("\/live\/log", \{ method: "DELETE"/.test(editorSource), "the server's log, shared with other editors and assistants, is left whole");
  assert.match(editorSource, /"Cleared at " \+ clearedAtWords \+ "\. Waiting for new messages\."/, "an empty log says why it is empty");
  assert.match(editorSource, /if \(close\.contains\(event\.target\) \|\| clear\.contains\(event\.target\)\) return;/, "pressing it does not start a drag");
});

test("the log labels whose move each row was, and filters by it", () => {
  for (const key of ['["canvas", "Canvas"]', '["local", "Local"]', '["internet", "Internet"]', '["schedule", "Schedule"]', '["bridge", "Bridge"]']) {
    assert.ok(editorSource.indexOf(key) !== -1, "a filter for " + key);
  }
  assert.match(editorSource, /if \(row\.origin && logFilters\[row\.origin\] === false\) continue;/, "rows obey them; a row without an origin always shows");
  assert.match(editorSource, /origin\.className = "oscar-log-chip oscar-log-origin oscar-log-origin-" \+ row\.origin;/, "a chip per origin");
  assert.match(editorSource, /ORIGIN_HINTS\[row\.origin\] \+ \(row\.device \? " \(" \+ row\.device \+ "\)" : ""\)/, "which tablet, on hover");
  assert.ok(editorSource.indexOf("logCanvas(") === -1, "the page no longer keeps rows of its own that the backlog would wipe");
  assert.match(themeSource, /\.oscar-log-origin-internet \{/, "internet stands apart from local");
});
