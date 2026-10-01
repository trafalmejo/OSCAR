"use strict";

// The LIVE pill and its network log. The log records what crossed the wire
// (lib/wire-log.js, its own tests in wire-log.test.js): server.js writes a
// row where each message is read or sent, and surfaces.js says who follows
// what came in and whose a send is. The editor side is a button between the
// screen sizes and the network info, and a floating window.

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

/** A published surface, and what the surfaces send, with the meta they send it with. */
async function venue(widgets) {
  const published = new PublishedStore(fs.mkdtempSync(path.join(os.tmpdir(), "oscar-live-")));
  await published.save("Stage", "<body>" + widgets.join("") + "</body>");
  const store = new SharedState();
  const sent = [];
  const surfaces = createSurfaces({
    published,
    sendOSC: (ip, port, address, args, meta) => sent.push({ protocol: "osc", address, meta }),
    sendDMX: (request, meta) => sent.push({ protocol: "dmx", request, meta }),
    sendMIDI: (request, meta) => sent.push({ protocol: "midi", request, meta }),
    shared: { store },
    io: { emit: () => {} },
  });
  return { surfaces, store, sent };
}

const osc = (address, ...values) => ({ address, args: values.map((value) => ({ type: "f", value })) });

async function followers(surfaces, hear) {
  const said = [];
  await hear({ followedBy: (id) => said.push(id) });
  return said;
}

test("a published widget following a message is said, whether or not its value changed", async () => {
  const { surfaces, store } = await venue([tag("oscar-slider", "s1", { enabled: true, listen: true, message: "/level", min: 0, max: 1 })]);
  store.onChange(() => {});
  assert.deepStrictEqual(await followers(surfaces, (o) => surfaces.hearOsc(osc("/level", 0.7), o)), ["stage"]);
  // The same value again moves nothing, but the surface still follows it:
  // software that repeats itself is not "unfollowed".
  assert.deepStrictEqual(await followers(surfaces, (o) => surfaces.hearOsc(osc("/level", 0.7), o)), ["stage"]);
  assert.deepStrictEqual(await followers(surfaces, (o) => surfaces.hearOsc(osc("/nothing/here", 1), o)), [], "what nothing follows says nothing");
});

test("MIDI a published widget follows is said even with nobody watching the surface", async () => {
  const { surfaces } = await venue([tag("oscar-slider", "s5", { enabled: true, midiListen: true, midiType: "cc", midiChannel: 1, midiNumber: 7, min: 0, max: 1 })]);
  assert.strictEqual(surfaces.watched(), false, "no page open");
  assert.deepStrictEqual(await followers(surfaces, (o) => surfaces.hearMidi({ type: "cc", channel: 1, number: 7, unit: 0.5 }, "nanoKONTROL2", true, o)), ["stage"]);
});

test("a drive hands its sends whose they are: the surface, the control, and the caller's word", async () => {
  const { surfaces, sent } = await venue([tag("oscar-slider", "s6", { enabled: true, message: "/dim", min: 0, max: 1 })]);
  await surfaces.drive("stage", "s6", { value: 0.2 }, { origin: "internet" });
  await surfaces.drive("stage", "s6", { value: 0.3 }, { origin: "schedule" });
  await surfaces.drive("stage", "s6", { value: 0.4 });
  assert.deepStrictEqual(
    sent.map((s) => [s.protocol, s.address, s.meta.origin, s.meta.surface]),
    [["osc", "/dim", "internet", "stage"], ["osc", "/dim", "schedule", "stage"], ["osc", "/dim", undefined, "stage"]],
    "a caller that says nothing (an older extension) gets no label rather than a wrong one"
  );
  assert.ok(sent.every((s) => typeof s.meta.widget === "string" && s.meta.widget.length), "the control is named");
});

test("a bridge's send is marked a bridge's", async () => {
  const { surfaces, store, sent } = await venue([tag("oscar-slider", "s3", { enabled: true, listen: true, message: "/dim", min: 0, max: 1, oscSendWhen: "data" })]);
  store.onChange(() => {});
  await surfaces.hearOsc(osc("/dim", 0.9));
  assert.deepStrictEqual(sent.map((s) => [s.protocol, s.meta.origin]), [["osc", "bridge"]]);
});

test("a widget switched off is driven silently: shown, not sent", async () => {
  const { surfaces, sent } = await venue([tag("oscar-slider", "s4", { enabled: false, message: "/dim", min: 0, max: 1 })]);
  await surfaces.drive("stage", "s4", { value: 0.5 });
  assert.deepStrictEqual(sent, [], "nothing reached the rig, so nothing is logged");
});

// ---- the wiring, read from the sources -----------------------------------

// Read with line endings normalised: a git checkout on Windows rewrites
// these files with CRLF, and the multiline assertions anchor on \n.
const readSource = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8").replace(/\r\n/g, "\n");
const serverSource = readSource("server.js");
const editorSource = readSource("public", "src", "oscar_editor.js");
const themeSource = readSource("public", "css", "oscar_theme.css");
const routesSource = readSource("routes", "index.js");

test("the server writes the log where traffic crosses the wire", () => {
  assert.match(serverSource, /const wireLog = createWireLog\(\{\n  emit: \(row\) => tellEditors\("live:log", row\),\n  flash: \(dir\) => tellEditors\("live:activity", \{ dir \}\),\n\}\);/, "one log, telling the editors rows and lights");
  assert.match(serverSource, /tellEditors = \(event, payload\) => io\.emit\(event, payload\);/, "once the socket server exists");
  // Out: in the send functions, after the send, with where it went.
  assert.match(serverSource, /target\.send\(message, ip, Number\(port\)\);\n    log\(to\);/, "OSC once handed to the socket");
  assert.match(serverSource, /return log\(to, "malformed"\);/, "a refused OSC message is a dropped row");
  assert.match(serverSource, /return log\("serial", "the serial cable is not connected"\);/, "so is one the cable could not take");
  assert.match(serverSource, /dmx\.set\(request\.source, request\);\n[\s\S]{0,300}wireLog\.out\(Object\.assign\(\{ protocol: "dmx" \}, dmxOut\(request\), sentFor\(meta\)\)\);/, "a DMX level change, as set");
  assert.match(serverSource, /what: event === "open" \? "stream started" : "stream released"/, "the DMX stream's start and release");
  assert.match(serverSource, /sent === false \? \{ dropped: "not a MIDI message OSCAR can send" \} : \{\}/, "MIDI, marked when refused");
  // In: as each message is read, before anything acts on it.
  assert.match(serverSource, /const arrival = wireLog\.arrive\(\{ protocol: "osc", what: message\.address, value: oscValue\(message\.args\), device \}\);\n  io\.emit\("osc:in", tagged\);/, "OSC, with its sender");
  assert.match(serverSource, /const arrival = wireLog\.arrive\(Object\.assign\(\{ protocol: "midi", device: port \|\| undefined \}, midiIn\(heard\)\)\);/, "MIDI, with its port");
  assert.match(serverSource, /onUnread: \(packet, from\) => unreadOsc\(unreadWhat\(packet\), from, UNREAD_WHY\),\n  onUnreadable: \(err\) => unreadOsc\("\(not OSC\)", null, reason\(err\)\),/, "what OSCAR could not read, marked");
  assert.match(serverSource, /listenOn\(port, \(message, from\) => heardOsc\(message, null, from\), \(packet, from\) => unreadOsc\(unreadWhat\(packet\), from, UNREAD_WHY\)\);/, "on the sending ports too");
  assert.match(serverSource, /liveLog: \(\) => wireLog\.rows\(\),/, "the backlog is the log's");
  assert.ok(!/tellActivity|onActivity|logArrival/.test(serverSource), "nothing is logged anywhere else");
  assert.match(serverSource, /const surfaces = createSurfaces\(\{ published, sendOSC, sendDMX, sendMIDI, shared, io \}\);/);
  assert.match(serverSource, /surfaces\.onPublished\(\(id\) => \{\n  io\.emit\("published:changed"\);/, "publishing recounts the pill");
  assert.match(serverSource, /onPublishedChanged: \(\) => io\.emit\("published:changed"\)/, "unpublishing does too");
  assert.match(routesSource, /if \(onPublishedChanged\) onPublishedChanged\(\);/, "from the route that unpublishes");
  assert.match(routesSource, /router\.get\("\/live\/log", editorOnly/, "the backlog behind a freshly opened window");
  const oscIn = readSource("lib", "osc-in.js");
  assert.match(oscIn, /function onPacket\(packet, timeTag, info\)/, "osc.js hands the sender third");
});

test("every send over a socket carries whose it is to the send function", () => {
  assert.match(serverSource, /const from = socketOrigin\(socket\.handshake\.query && socket\.handshake\.query\.from, socket\.handshake\.address\);/, "each connection says who it is");
  assert.match(serverSource, /sendOSC\(msg\.ip, msg\.port, msg\.address, msg\.args, from\);/, "OSC from a page or the canvas");
  assert.match(serverSource, /sendOSC\(ip, port, address, \[\{ type, value \}\], from\);/, "the old single-value form");
  assert.match(serverSource, /sendDMX\(request, from\);/, "DMX");
  assert.match(serverSource, /sendMIDI\(request, from\);/, "MIDI");
});

test("two pills for OSCAR the server: RUNNING opens what it is serving, ACTIVITY the network log", () => {
  const pill = editorSource.slice(editorSource.indexOf('id: "oscar-live-pill"'));
  assert.match(pill, /data-zone="running" data-pill="running">[\s\S]{0,120}oscar-live-word">RUNNING</, "RUNNING, a count, the Running window");
  assert.match(pill, /data-zone="log" data-pill="server">'[\s\S]{0,80}ACTIVITY/, "ACTIVITY, the network log");
  assert.ok(!/LOCAL<|PUBLIC<|OSCAR SERVER/.test(pill.slice(0, 1200)), "LOCAL, PUBLIC and OSCAR SERVER are gone: words the rest of the app no longer uses");
  assert.match(editorSource, /if \(zone\.getAttribute\("data-zone"\) === "running"\) editor\.runCommand\("oscar-running"\);/);
  // Every interface OSCAR serves, the switched-off ones too: their schedules and bridges still run.
  assert.match(editorSource, /running = Array\.isArray\(rows\) \? rows : \[\];\s*paintRunning\(\);/);
  assert.match(editorSource, /in the background, whichever project is open here\./, "and says so: the editor and the server are one app, two things");
  assert.match(pill, /data-led="in">IN<span class="oscar-live-meter"><\/span>/, "with an IN meter");
  assert.match(pill, /data-led="out">OUT<span class="oscar-live-meter"><\/span>/, "and an OUT meter");
  assert.match(editorSource, /setPublicCount: function \(state\) \{\n      livePublic\.set\(state\);/, "an extension says what is public");
  assert.match(editorSource, /\(anyone \? " " \+ anyone \+ " open to anyone with the link\." : ""\)/, "which RUNNING says in its own words, not as a pill of its own");
  assert.match(editorSource, /if \(takeRow\(row\) && !row\.dropped\) countTraffic\(row\);/, "the meters count each row's messages once");
  assert.match(editorSource, /Math\.log\(1 \+ rates\[dir\]\) \/ Math\.log\(101\)/, "on a log scale: 100 a second fills it");
  assert.match(editorSource, /el\.classList\.toggle\("oscar-live-on", connected\);/, "ACTIVITY changes when the editor cannot reach OSCAR");
  assert.match(themeSource, /\.oscar-live-server:not\(\.oscar-live-on\) \{\n  border-color: #c98a1b;/, "to amber: that one is a problem");
  assert.ok(!/text-decoration: line-through/.test(themeSource.slice(themeSource.indexOf(".oscar-live-pill {"), themeSource.indexOf("@keyframes oscar-live-breathe"))), "nothing running is not an error: no word is struck through");
  // OSCAR Pro is private: its half is checked only where it sits next to this repo, never in CI.
  const proFile = path.join(__dirname, "..", "..", "oscar-pro", "public", "public.js");
  if (fs.existsSync(proFile)) assert.match(fs.readFileSync(proFile, "utf8"),/oscar\.setPublicCount\(\{/, "Pro tells it");
});

test("the pills sit on the bar's right, with OSCAR's things: split into their two doors", () => {
  const pill = editorSource.indexOf('id: "oscar-live-pill"');
  const ip = editorSource.indexOf('id: "ipButton"');
  assert.ok(pill !== -1 && ip !== -1 && pill < ip, "added before ipButton, which is what renders it in the gap");
  // Disabled to GrapesJS on purpose: a command toggles the button active,
  // and re-rendering it wiped the count and hid the pill (the bug where it
  // vanished after the publish window closed).
  const button = editorSource.slice(pill, editorSource.indexOf("});", pill));
  assert.match(button, /command: null/, "no command to toggle");
  assert.match(button, /disable: true/, "no active state to re-render on");
  assert.match(button, /data-zone="running"/, "the RUNNING half");
  assert.match(button, /data-zone="log"/, "the lights half");
  assert.match(editorSource, /editor\.runCommand\("oscar-running"\)/, "RUNNING opens the Running window");
  assert.match(editorSource, /else openLiveLog\(\);/, "the lights open the network log");
  assert.match(editorSource, /editor\.socket\.on\("live:activity"/, "the flickers arrive by socket");
  assert.match(editorSource, /editor\.socket\.on\("live:log"/, "the log listens all along");
  assert.match(editorSource, /editor\.socket\.on\("published:changed", function \(\) \{\s*refreshLive\(\);/, "the count follows the roster");
  // Always present: with nothing published it goes quiet instead of away,
  // so the place to look never moves.
  assert.match(themeSource, /\.gjs-pn-btn\.oscar-live-btn \{\n  display: inline-flex;/, "shown whether or not anything is published");
  assert.match(editorSource, /OSCAR is running nothing in the background\./, "the quiet pill says so");
  assert.match(themeSource, /border: 1px solid rgba\(47, 191, 95, 0\.55\)/, "the pill is green");
  assert.match(editorSource, /"What OSCAR is receiving and sending: IN " \+ rates\.in \+ "\/s, OUT " \+ rates\.out \+ "\/s\. Click for the network log\."/, "and ACTIVITY says its traffic");
});

test("the log window shows each row as it crossed the wire, and takes updates in place", () => {
  assert.match(editorSource, /head\.textContent = "Server IP: " \+ ipServer \+ \(oscInPort \? " · Listening Port: " \+ oscInPort : ""\)/, "the address on top");
  for (const key of ['"in", "Incoming"', '"out", "Outgoing"', '"osc", "OSC"', '"midi", "MIDI"', '"dmx", "DMX"', '"unfollowed", "Unfollowed"', '"dropped", "Dropped"']) {
    assert.ok(editorSource.indexOf("[" + key + "]") !== -1, "a filter for " + key);
  }
  assert.match(editorSource, /if \(!logFilters\[row\.dir\] \|\| !logFilters\[row\.protocol\]\) continue;/, "rows obey the filters");
  assert.match(editorSource, /if \(logRows\[i\]\.id === row\.id\) \{\n          logRows\[i\] = row;/, "an update replaces the row it is about");
  assert.match(editorSource, /while \(at > 0 && logRows\[at - 1\]\.at > row\.at\) at--;/, "a new row goes where its time says");
  assert.match(editorSource, /line\.appendChild\(span\("oscar-log-value", "= " \+ row\.value\)\);/, "what it carried");
  assert.match(editorSource, /line\.appendChild\(span\("oscar-log-from", "→ " \+ row\.to\)\);/, "where it went");
  assert.match(editorSource, /row\.device === "serial" \? "from the serial cable" : "from " \+ row\.device/, "who sent what came in");
  assert.match(editorSource, /\(row\.surfaces \|\| \[\]\)\.forEach\(function \(surface\) \{/, "every published surface that follows it");
  assert.match(editorSource, /span\("oscar-log-chip oscar-log-origin oscar-log-dropped", "Dropped"/, "what was refused, marked");
  assert.match(editorSource, /return row\.dir === "in" && !row\.dropped && !row\.canvas && !\(row\.surfaces && row\.surfaces\.length\);/, "unfollowed means nothing at all followed it");
  assert.match(editorSource, /fetch\("\/live\/log"\)/, "opened onto the backlog, not an empty page");
  assert.match(themeSource, /\.oscar-log-dropped \{/);
});

test("the log labels whose move each send was, and filters by it", () => {
  for (const key of ['["canvas", "Canvas"]', '["local", "Local"]', '["internet", "Internet"]', '["schedule", "Schedule"]', '["bridge", "Bridge"]']) {
    assert.ok(editorSource.indexOf(key) !== -1, "a filter for " + key);
  }
  assert.match(editorSource, /if \(row\.origin && logFilters\[row\.origin\] === false\) continue;/, "rows obey them; a row without an origin always shows");
  assert.match(editorSource, /ORIGIN_HINTS\[row\.origin\] \+ \(row\.device \? " \(" \+ row\.device \+ "\)" : ""\)/, "which tablet, on hover");
  assert.ok(editorSource.indexOf("logCanvas(") === -1, "the page keeps no rows of its own that the backlog would wipe");
  assert.match(themeSource, /\.oscar-log-origin-internet \{/, "internet stands apart from local");
});

test("the canvas says what it followed of what came in, and only the canvas is believed", () => {
  const incomingSource = readSource("lib", "widgets", "incoming.js");
  const midiSourceSource = readSource("lib", "widgets", "midi-source.js");
  const adapterSource = readSource("public", "src", "adapters", "grapesjs.js");
  assert.match(incomingSource, /if \(typeof ctx\.noteHeard === "function"\) ctx\.noteHeard\("osc", message\.address\);/, "an OSC widget that follows a message says so");
  assert.match(midiSourceSource, /if \(typeof host\.noteHeard === "function"\) host\.noteHeard\("midi", midiIn\(heard\)\.what, port\);/, "and a MIDI one, with its port");
  assert.match(adapterSource, /if \(typeof editor\.noteHeard === "function"\) editor\.noteHeard\(protocol, what, device\);/, "the canvas hands it to the editor");
  assert.match(editorSource, /if \(rows\.length\) editor\.socket\.emit\("canvas:heard", rows\);/, "gathered and told to the server");
  assert.match(serverSource, /if \(from\.origin !== "canvas" \|\| !Array\.isArray\(rows\)\) return;/, "which takes only the canvas's word");
  assert.match(serverSource, /wireLog\.canvasHeard\(row\.protocol, row\.what\.slice\(0, 200\), typeof row\.device === "string" \? row\.device\.slice\(0, 200\) : undefined\);/, "and writes it on the rows it is about");
});

test("a widget following a message tells its host, and one that does not stays quiet", () => {
  const { follow } = require("../lib/widgets/incoming");
  const noted = [];
  let deliver = null;
  const values = { enabled: true, listen: true, message: "/dim" };
  const ctx = { get: (k) => values[k], onOsc: (fn) => { deliver = fn; return () => {}; }, noteHeard: (p, w) => noted.push([p, w]) };
  const heard = [];
  follow(ctx, (v) => heard.push(v));
  deliver({ address: "/dim", args: [0.5] });
  deliver({ address: "/other", args: [1] });
  assert.deepStrictEqual(noted, [["osc", "/dim"]], "only what it followed");
  assert.strictEqual(heard.length, 1);
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
  assert.match(editorSource, /if \(close\.contains\(event\.target\) \|\| clear\.contains\(event\.target\) \|\| scrollLabel\.contains\(event\.target\)\) return;/, "pressing it does not start a drag");
});

test("auto-scroll keeps the newest in view, and off keeps what is being read still", () => {
  assert.match(editorSource, /scrollLabel\.appendChild\(document\.createTextNode\("Auto-scroll"\)\);/, "a switch in the title bar");
  assert.match(editorSource, /return localStorage\.getItem\(AUTOSCROLL_KEY\) !== "off";/, "on until turned off, remembered");
  assert.match(editorSource, /if \(autoScroll\) \{\n        logList\.scrollTop = 0;/, "the newest is at the top, so on is the top");
  assert.match(editorSource, /anchor = \{ key: logList\.children\[c\]\.getAttribute\("data-key"\), offset: at\.top - top \};/, "off, the first row in view is remembered");
  assert.match(editorSource, /line\.setAttribute\("data-key", String\(row\.id\)\);/, "by the row's own id");
  assert.match(editorSource, /logList\.scrollTop \+= again\.getBoundingClientRect\(\)\.top - logList\.getBoundingClientRect\(\)\.top - anchor\.offset;/, "and put back where it sat");
});
