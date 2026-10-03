"use strict";

// Two windows, for two questions. Publish is the project on the canvas, on a
// card: who can open it, the one code for the address that goes with that,
// and one button that says what it does. Running is OSCAR, the server: every
// interface it serves in the background, whichever project is open, with the
// devices on each. And the places an extension adds to: a section under the
// card, and a further answer to who can open an interface.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

// ---- the card: the project on the canvas -----------------------------------------------

test("the window opens on the project on the canvas: its title, and nothing to fill in", () => {
  const markup = read("public/partials/export.ejs");
  const publish = markup.slice(markup.indexOf('id="export-panel"'), markup.indexOf('id="running-panel"'));
  const card = publish.indexOf('id="publish-card"');
  const extras = publish.indexOf('id="publish-extras"');
  assert.ok(card !== -1 && extras !== -1 && card < extras, "the card, then an extension's box");
  assert.ok(!/id="published-list"/.test(publish), "and nothing else: what OSCAR is running is not this window's business");
  assert.ok(!/<input[^>]*id="export-name"/.test(markup), "no name or address field: the project has its title, and the address is made from it");
  assert.ok(!/class="oscar-export-lead"/.test(publish.slice(0, publish.indexOf('id="download-panel"'))), "no paragraphs above the button");
  assert.match(markup, /id="publish-help"[\s\S]{0,200}data-tooltip="OSCAR has to keep running:/, "the explanations are behind the question mark, the one that matters first");

  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /if \(titleBox\) titleBox\.textContent = now\.name \|\| "Untitled";/);
  assert.match(dialog, /title: "Publish",/);
  assert.match(dialog, /class: "modal-login modal-publish"/);
});

test("one button, which says what it does: Publish, Publish changes, or none when there is nothing to send", () => {
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /publishButton\.textContent = mine \? "Publish changes" : "Publish";/);
  assert.match(dialog, /publishButton\.style\.display = mine && !stale \? "none" : "";/, "up to date: no button at all");
  assert.match(dialog, /stateLine\.textContent = !mine \? "" : stale \? "Changes not published" : "Up to date";/);
  assert.ok(!/"Update"/.test(dialog), "the word Update is gone");
  assert.ok(!/"outdated"/.test(dialog), "and so is the mark a row wore");
});

test("nobody is asked for an address: it is made from the title, with a number when that is taken", () => {
  const { addressFor } = require("../lib/published-address");
  assert.strictEqual(addressFor("Lobby visitors", []), "lobby-visitors");
  assert.strictEqual(addressFor("Lobby visitors", ["lobby-visitors"]), "lobby-visitors-2");
  assert.strictEqual(addressFor("Lobby visitors", ["lobby-visitors", "lobby-visitors-2"]), "lobby-visitors-3");
  assert.strictEqual(addressFor("Untitled", []), "untitled");
  assert.strictEqual(addressFor("  ¡¡¡  ", []), "interface", "a title with nothing an address can hold");
  assert.strictEqual(addressFor("Preview", ["preview"]), "preview-2", "a name OSCAR uses itself is taken like any other");
  assert.ok(addressFor("x".repeat(200), []).length <= 56);
  assert.match(addressFor("Été à la Plage, 2026!", []), /^[a-z0-9][a-z0-9-]*$/);

  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /address: mine \? mine\.id : addressFor\(now\.name \|\| "Untitled", taken\),/, "a project that is live keeps the address it has");
  assert.match(dialog, /\.concat\(RESERVED, tried \|\| \[\]\);/);
  // An address somebody took a moment ago is not replaced: the next number is tried.
  assert.match(dialog, /if \(answer\.confirm\) \{\s*if \(\(tried \|\| \[\]\)\.length >= 5\) throw new Error\("No free address could be found for this project\."\);\s*return publish\(\(tried \|\| \[\]\)\.concat\(as\.address\)\);/);
  assert.ok(!/replace: /.test(dialog), "and nothing that is live is ever replaced by a project that is not its own");
  assert.match(dialog, /"Not published yet\. It will open at \/show\/" \+ addressFor\(now\.name, taken\)/, "said before the button is pressed");
});

test("an interface shows the one code for where it is opened, without being asked; Off has none", () => {
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /var address = \(lead && lead\.address\) \|\| local;\s*where\.appendChild\(qrOf\(address\)\);/, "one code: an extension's address when it leads, else the local one");
  assert.ok(!/textContent = "QR"/.test(dialog) && !/button\("QR"/.test(dialog), "no QR button anywhere");
  assert.match(dialog, /navigator\.clipboard\.writeText\(address\)/, "Copy copies that same address");
  assert.match(dialog, /third\.appendChild\(document\.createTextNode\("On this Wi-Fi: "\)\);\s*third\.appendChild\(linkTo\(local\)\);/, "the local address stays as text when another leads");
  assert.match(dialog, /if \(page\.access === "off"\) \{\s*where\.appendChild\(el\("p", "oscar-publish-off", "No device can open it\. Its schedules and bridges still run\."\)\);\s*return where;/);
  // The old box for an address, shown on request, is gone; a section written for it still runs.
  assert.match(dialog, /function showAddress\(\) \{\}/);
  const markup = read("public/partials/export.ejs");
  assert.ok(!/id="publish-result"|id="publish-copy"|id="publish-qr"/.test(markup));
});

// ---- Running: what OSCAR is serving ---------------------------------------------------------

test("Running is a window of its own, opened from the bar: every interface OSCAR serves, the open project's among them", () => {
  const markup = read("public/partials/export.ejs");
  const running = markup.slice(markup.indexOf('id="running-panel"'));
  assert.ok(markup.indexOf('id="running-panel"') !== -1 && /id="published-list"/.test(running), "the list lives here now");
  assert.match(running, /OSCAR serves these in the background, whether or not their projects are\s+open here\./);
  assert.match(running, /id="running-empty"[^>]*>Nothing is running\. Publish a project and it appears here\./);

  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /editor\.Commands\.add\("oscar-running", openRunning\);/);
  assert.match(dialog, /title: "Running on this OSCAR",/);
  assert.match(dialog, /var isMine = !!mine && page\.id === mine\.id;/, "the open project's interface is a row like any other");
  assert.match(dialog, /var here = el\("span", "oscar-published-note", "open in the editor"\);/, "and says which it is");
  assert.match(dialog, /if \(page\.editable && !isMine && options\.openProject\) \{/, "with no Edit: it is on the canvas already");
  assert.match(dialog, /if \(which === "running"\) openRunning\(\);\s*else open\(\);/, "a download gives back the window it was asked from");
});

test("each interface says how many devices are on it: per interface, never one total", () => {
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /var here = Number\(page\.devices\) \|\| 0;\s*var there = lead && Number\(lead\.devices\) > 0 \? Number\(lead\.devices\) : 0;/, "those on this network, and those an extension's level brings");
  assert.match(dialog, /n === 0 \? "No devices connected" : n === 1 \? "1 device connected" : n \+ " devices connected"/);
  assert.match(dialog, /el\("span", "oscar-published-note oscar-running-devices", on\.n === 1 \? "1 device" : on\.n \+ " devices"\)/, "on its row");
  assert.match(dialog, /var count = el\("span", "oscar-publish-devices", on\.words\);/, "and beside its code, on the card too");
  // Kept current while either window is open: the server says when a device comes or goes.
  assert.match(dialog, /refresh: function \(\) \{\s*if \(isOpen\(\)\) refreshPublished\(\);/);
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /editor\.socket\.on\("running:changed", function \(\) \{\s*if \(publishDialog\) publishDialog\.refresh\(\);/);
  const server = read("server.js");
  assert.match(server, /if \(from\.surface && from\.surface !== "preview"\) \{\s*devicesOn\.set\(from\.surface, \(devicesOn\.get\(from\.surface\) \|\| 0\) \+ 1\);/, "counted as each page connects, by what it says it shows");
  assert.match(server, /else devicesOn\.delete\(from\.surface\);\s*tellRunning\(\);/, "and as it goes");
  assert.match(server, /runningTold = setTimeout\(\(\) => \{\s*runningTold = null;\s*io\.emit\("running:changed"\);\s*\}, 300\);/, "a hall of phones arriving is one redraw, not fifty");
  assert.match(read("routes/index.js"), /devices: devicesOn \? devicesOn\(page\.id\) : 0,/);
});

test("a message passing through an interface lights its row", () => {
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /row\.setAttribute\("data-surface", page\.id\);/);
  assert.match(dialog, /light\.classList\.add\("oscar-running-active"\);/);
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /publishDialog\.activity\(\(row\.surfaces \|\| \[\]\)\.concat\(row\.surface \? \[row\.surface\] : \[\]\)\);/, "what came in and was followed, and what went out for it");
  assert.match(read("public/css/oscar_export.css"), /\.oscar-published-live\.oscar-running-active \{/);
});

test("each interface is a row: its project's title as it is now, who can open it, Edit, and a menu for the rest", () => {
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /return \(page\.project && titles\[page\.project\]\) \|\| page\.name \|\| page\.id;/, "the title it has now, not the one it had the day it was published");
  assert.match(dialog, /if \(row && !row\.template && row\.id\) titles\[row\.id\] = row\.name;/);
  const name = dialog.indexOf('var name = el("span", "oscar-published-name", titleOf(page));');
  const access = dialog.indexOf("row.appendChild(accessSelect(page, at));");
  const edit = dialog.indexOf('var editIt = button("Edit");');
  const more = dialog.indexOf("row.appendChild(moreButton(page));");
  assert.ok(name !== -1 && name < access && access < edit && edit < more, "name, who can open it, Edit, the menu");
  assert.match(dialog, /"no project copy to edit"/, "which says so");
  // Download and Take down are under the menu, for the card's interface and for a row's alike.
  assert.match(dialog, /label: "Download as a file(…|\\u2026)",\s*run: function \(\) \{\s*openDownload\(page\.id\);/);
  assert.match(dialog, /label: "Take down",\s*run: function \(\) \{\s*takeDown\(page\);/);
  assert.match(dialog, /cardAccess\.appendChild\(moreButton\(mine\)\);/);
});

test("clicking a row shows its code under it; its controls are not that click", () => {
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /shown = shown === page\.id \? null : page\.id;\s*drawRows\(\);/);
  assert.match(dialog, /if \(shown === page\.id\) \{\s*var open = whereBlock\(page, at\);/, "the same block the card shows");
  assert.match(dialog, /row\.setAttribute\("aria-expanded", String\(shown === page\.id\)\);/);
  assert.match(dialog, /if \(event\.key === "Enter" \|\| event\.key === " "\) \{\s*event\.preventDefault\(\);\s*toggle\(\);/, "by keyboard too");
  // The setting, Edit and the menu each stop the click from reaching the row.
  assert.ok((dialog.match(/event\.stopPropagation\(\);/g) || []).length >= 5);
});

test("each row wears a green live dot: served, not stored; grey and still when it is off", () => {
  const dialog = read("public/src/export_dialog.js");
  const at = dialog.indexOf('live.className = "oscar-published-live"');
  const name = dialog.indexOf('var name = el("span", "oscar-published-name"');
  assert.ok(at !== -1 && name !== -1 && at < name, "the dot comes before the name");
  assert.match(dialog, /live\.title = "Published: OSCAR is serving this interface right now\."/, "and says what it means");
  assert.match(dialog, /live\.className = "oscar-published-live oscar-published-off";/);
  const css = read("public/css/oscar_export.css");
  assert.match(css, /\.oscar-published-list \.oscar-published-live \{/, "with the pill's green and breath");
  assert.match(css, /animation: oscar-live-breathe/, "the same breath as the LIVE pill");
  assert.match(css, /\.oscar-published-live\.oscar-published-off \{[^}]*animation: none;/, "no green, no breath");
});

test("before an interface is taken down, a section may give a reason to think twice, and something to do first", () => {
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /onUnpublish: function \(guard\) \{\s*section\.guard = guard;/);
  assert.match(dialog, /section\.guard\(page\.id\)/);
  assert.match(dialog, /if \(!warnings\.length\) return unpublish\(\);/, "with no reason, no question");
  assert.match(dialog, /text: "Take it off the internet and take it down"/);
  assert.match(dialog, /text: "Keep it published"/);
  assert.match(dialog, /typeof w\.first === "function" \? w\.first\(\) : null/);
});

test("a file is downloaded through a window of its own that gives the dialog back", () => {
  const markup = read("public/partials/export.ejs");
  assert.ok(markup.indexOf('id="download-panel"') !== -1 && markup.indexOf('id="download-host"') !== -1);
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /fetch\("\/published\/" \+ encodeURIComponent\(id\) \+ "\/file\?host=/);
  assert.match(dialog, /editor\.on\("modal:close", function \(\) \{\s*if \(!returning\) return;/);
  assert.ok(!/exportSnapshot\(editor, /.test(dialog), "publishing is the first page, and nothing else is asked");
});

// ---- who can open it -----------------------------------------------------------------------

test("who can open it is one setting: Off and This network are OSCAR's own", () => {
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /\[\{ id: "off", label: "Off" \}, \{ id: "network", label: "This network" \}\]/);
  assert.match(dialog, /access\.value = isOff \? "off" : at \? at\.id : "network";/, "an extension's level outranks the network; off outranks both");
  assert.match(dialog, /fetch\("\/published\/" \+ encodeURIComponent\(id\) \+ "\/access", \{/);
  const css = read("public/css/oscar_export.css");
  assert.match(css, /\.oscar-publish-columns \{[^}]*grid-template-columns: 1fr;/, "one list, the whole width");
});

test("an extension adds a further answer to who can open it, says where such an interface is opened, and may say more", () => {
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /addAccessLevel: function \(level\) \{/);
  assert.match(dialog, /level\.id === "off" \|\| level\.id === "network"\) \{\s*throw new Error\("An access level has an id of its own"\);/, "OSCAR's own two cannot be taken");
  assert.match(dialog, /typeof level\.read !== "function" \|\| typeof level\.choose !== "function" \|\| typeof level\.leave !== "function"/);
  // Asked where each interface stands before anything is drawn; one that fails is left out, no more.
  assert.match(dialog, /levelMaps\[level\.id\] = map && typeof map === "object" \? map : null;/);
  assert.match(dialog, /function \(\) \{\s*levelMaps\[level\.id\] = null;\s*\}/);
  // The steps of a change: leave the level it is at, then OSCAR's own word, or the network and then the level.
  assert.match(dialog, /if \(at && at\.id !== to\) \{\s*chain = chain\.then\(function \(\) \{\s*return at\.leave\(page\.id\);/);
  assert.match(dialog, /if \(page\.access === "off"\) \{\s*chain = chain\.then\(function \(\) \{\s*return postAccess\(page\.id, "network"\);/);
  assert.match(dialog, /return level\.choose\(page\.id\);/);
  assert.match(dialog, /\.then\(refreshPublished\);/, "and the window is drawn again as things stand, whatever happened");
  // Its address leads; what else it has to say sits beside; a level that throws loses only that.
  assert.match(dialog, /return at && typeof at\.link === "function" \? at\.link\(page\.id\) : null;/);
  assert.strictEqual((dialog.match(/console\.error\("An access level of the Publish dialog failed:", err\);/g) || []).length, 2);

  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /addAccessLevel: function \(level\) \{\s*if \(publishDialog\) publishDialog\.addAccessLevel\(level\);/);
});

// ---- an extension's section, and About -------------------------------------------------------

test("an extension is handed publishDialog.addSection, and a section is drawn whenever what is published is read again", () => {
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /var publishDialog = oscarExport\.install\(editor, \{/);
  assert.match(editor, /publishDialog: \{\s*addSection: function \(draw\) \{\s*if \(publishDialog\) publishDialog\.addSection\(draw\);/);

  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /addSection: function \(draw\) \{/);
  assert.match(dialog, /if \(typeof draw !== "function"\) throw/);
  // Drawn after a fresh list, on success and on failure alike, so a section never shows a stale list.
  assert.strictEqual((dialog.match(/drawSections\(\);/g) || []).length, 2);
  // A section that throws loses only itself.
  assert.match(dialog, /try \{\s*section\.draw\(section\.box, \{[\s\S]*?\} catch \(err\) \{\s*console\.error\("A section of the Publish dialog failed:"/);
  // What it is told: the surfaces with their addresses, and which one was just published from here.
  assert.match(dialog, /surfaces: known\.map/);
  assert.match(dialog, /latest: latest,/);
  assert.match(dialog, /latest = answer\.id;/);
  assert.match(dialog, /show: showAddress,/, "show is still handed over, and does nothing: each interface shows its own code");
});

test("OSCAR itself draws nothing in that box", () => {
  const css = read("public/css/oscar_export.css");
  assert.match(css, /\.oscar-publish-section:empty \{\s*display: none;/);
  for (const file of ["public/src/oscar_editor.js", "public/src/export_dialog.js"]) {
    assert.ok(!/addSection\((?!draw)/.test(read(file)), file + " adds no section of its own");
  }
});

test("About has the same kind of place, ahead of OSCAR's own words, under File", () => {
  const markup = read("public/partials/about.ejs");
  assert.ok(markup.indexOf('id="about-extras"') < markup.indexOf('class="info-panel-label"'), "an extension speaks first");
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /aboutDialog: \{\s*addSection: function \(draw\) \{/);
  assert.ok(editor.indexOf('id: "open-info"') === -1, "no button of its own on the bar");
  assert.match(editor, /label: "About OSCAR",\s*run: function \(\) \{\s*editor\.runCommand\("oscar-about"\);/, "About is under File");
  assert.match(editor, /section\.draw\(section\.box\);[\s\S]*?catch \(err\) \{\s*console\.error\("A section of About failed:"/);
  assert.match(editor, /setModal\("About OSCAR", "info-panel"\)/);
  assert.ok(!/icon\("help"\)/.test(editor), "the question mark is retired");
});

test("the note about several pages is only for a project with Pages on", () => {
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /var pages = features\.PAGES \? editor\.Pages\.getAll\(\)\.length : 1;/);
  const showcase = read("public/templates/oscar-showcase.html");
  assert.ok(!/osh-feature-pages|A page per room/.test(showcase), "the Showcase does not advertise a feature that is off");
});

test("a level that cannot be chosen is on the list, greyed, and the setting says why", () => {
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /var why = typeof level\.disabled === "function" \? level\.disabled\(\) : "";/);
  assert.match(dialog, /if \(choice\.why\) \{\s*option\.disabled = true;[\s\S]{0,160}access\.title = choice\.why;/);
});

test("the projects window opens on your projects; the templates fold under one row", () => {
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /var sections = projectsTable\.sectionProjects\(projectRows, projectSort\.key, projectSort\.direction\);/);
  assert.match(editor, /sections\.projects\.concat\(sections\.drafts\)\.forEach\(drawRow\);/);
  assert.match(editor, /fold\.setAttribute\("aria-expanded", String\(showTemplates\)\);/);
  assert.match(editor, /"Templates \(" \+ sections\.templates\.length \+ "\)"/, "the row says how many are behind it");
  assert.match(editor, /templatesChosen = !showTemplates;\s*renderProjects\(\);/, "a click or Enter unfolds them, and it stays as left");
  assert.match(editor, /if \(showTemplates\) sections\.templates\.forEach\(drawRow\);/);
});
