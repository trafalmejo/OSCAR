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
  assert.deepStrictEqual(activity, ["in"], "one flicker for the widget it moved");

  await surfaces.hearOsc(osc("/nothing/here", 1));
  assert.deepStrictEqual(activity, ["in"], "a message that moved nothing lights nothing");
});

test("a drive on a published surface's behalf says OUT, and a bridge says both", async () => {
  const { surfaces, activity } = await venue([tag("oscar-slider", "s2", { enabled: true, message: "/dim", min: 0, max: 1 })]);

  const driven = await surfaces.drive("stage", "s2", { value: 0.5 });
  assert.strictEqual(driven.ok, true);
  assert.deepStrictEqual(activity, ["out"], "the send was the server's, for the surface");

  activity.length = 0;
  const bridged = await venue([tag("oscar-slider", "s3", { enabled: true, listen: true, message: "/dim", min: 0, max: 1, oscSendWhen: "data" })]);
  await bridged.surfaces.hearOsc(osc("/dim", 0.9));
  assert.deepStrictEqual(bridged.activity, ["out", "in"], "what came in went back out: both lights");
});

test("a widget switched off is driven silently: shown, not sent, and no OUT", async () => {
  const { surfaces, activity } = await venue([tag("oscar-slider", "s4", { enabled: false, message: "/dim", min: 0, max: 1 })]);
  await surfaces.drive("stage", "s4", { value: 0.5 });
  assert.deepStrictEqual(activity, [], "nothing reached the rig, so nothing lights");
});

// ---- the wiring, read from the sources -----------------------------------

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const editorSource = fs.readFileSync(path.join(__dirname, "..", "public", "src", "oscar_editor.js"), "utf8");
const themeSource = fs.readFileSync(path.join(__dirname, "..", "public", "css", "oscar_theme.css"), "utf8");
const routesSource = fs.readFileSync(path.join(__dirname, "..", "routes", "index.js"), "utf8");

test("the server throttles the flickers and announces the roster's changes", () => {
  assert.match(serverSource, /io\.emit\("live:activity", \{ dir \}\)/, "the activity event");
  assert.match(serverSource, /at - activityAt\[dir\] < 200/, "throttled per direction");
  assert.match(serverSource, /onActivity: tellActivity/, "handed to the surfaces");
  assert.match(serverSource, /surfaces\.onPublished\(\(\) => io\.emit\("published:changed"\)\)/, "publishing recounts the pill");
  assert.match(serverSource, /onPublishedChanged: \(\) => io\.emit\("published:changed"\)/, "unpublishing does too");
  assert.match(routesSource, /if \(onPublishedChanged\) onPublishedChanged\(\);/, "from the route that unpublishes");
});

test("the pill sits between the screen sizes and the network info, and listens", () => {
  const pill = editorSource.indexOf('id: "oscar-live-pill"');
  const ip = editorSource.indexOf('id: "ipButton"');
  assert.ok(pill !== -1 && ip !== -1 && pill < ip, "added before ipButton, which is what renders it in the gap");
  assert.match(editorSource, /editor\.socket\.on\("live:activity"/, "the flickers arrive by socket");
  assert.match(editorSource, /editor\.socket\.on\("published:changed", refreshLive\)/, "the count follows the roster");
  assert.match(editorSource, /editor\.runCommand\("oscar-export"\)/, "clicking opens the publish window");
  assert.match(themeSource, /\.gjs-pn-btn\.oscar-live-btn \{\n  display: none;/, "hidden while nothing is published");
});
