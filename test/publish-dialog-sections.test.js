"use strict";

// The Publish dialog has a place for an extension to add to it, so that what
// else a published surface can become (reachable from the internet, say) is
// offered where publishing is, not in a dialog of the extension's own.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("the dialog keeps a box for extensions, after the list of what is published on the local network", () => {
  const markup = read("public/partials/export.ejs");
  const result = markup.indexOf('id="publish-result"');
  const extras = markup.indexOf('id="publish-extras"');
  const list = markup.indexOf('id="published-box"');
  assert.ok(result !== -1 && extras !== -1 && list !== -1);
  assert.ok(result < list && list < extras);
  assert.match(markup, /Publish on the local network/);
  assert.match(markup, /Published on the local network/);
  // Side by side, and the one box above serves both: code, link, Copy.
  const columns = markup.indexOf('class="oscar-publish-columns"');
  assert.ok(columns !== -1 && columns < list && extras < markup.indexOf("</div>", extras) );
  assert.ok(markup.indexOf('id="publish-copy"') !== -1 && markup.indexOf('id="publish-copy"') < columns);
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /show: showAddress,/, "a section can put an address in the box");
  assert.match(dialog, /navigator\.clipboard\.writeText\(link\.href\)/);
  // Each list opens with a line of about the same length, so their rows sit level.
  assert.match(markup, /class="oscar-published-lead"/);
  assert.match(dialog, /class: "modal-login modal-publish"/);
});

test("before a surface is unpublished, a section may give a reason to think twice, and something to do first", () => {
  const dialog = read("public/src/export_dialog.js");
  assert.match(dialog, /onUnpublish: function \(guard\) \{\s*section\.guard = guard;/);
  assert.match(dialog, /section\.guard\(page\.id\)/);
  assert.match(dialog, /if \(!warnings\.length\) return unpublish\(\);/, "with no reason, no question");
  assert.match(dialog, /text: "Take it off the internet and unpublish"/);
  assert.match(dialog, /text: "Keep it published"/);
  assert.match(dialog, /typeof w\.first === "function" \? w\.first\(\) : null/);
});

test("a file is downloaded from a published surface's own row, through a window of its own that gives the dialog back", () => {
  const markup = read("public/partials/export.ejs");
  assert.ok(!/export-advanced|export-host|id="export-page"/.test(markup), "nothing about a file at the bottom of the dialog");
  assert.ok(markup.indexOf('id="download-panel"') !== -1 && markup.indexOf('id="download-host"') !== -1);
  const dialog = read("public/src/export_dialog.js");
  // Between QR and Unpublish, on every row.
  const qr = dialog.indexOf('qr.textContent = "QR"');
  const file = dialog.indexOf('file.textContent = "Download"');
  const remove = dialog.indexOf('remove.textContent = "Unpublish"');
  assert.ok(qr < file && file < remove);
  assert.match(dialog, /fetch\("\/published\/" \+ encodeURIComponent\(id\) \+ "\/file\?host=/);
  assert.match(dialog, /editor\.on\("modal:close", function \(\) \{\s*if \(!returning\) return;/);
  assert.ok(!/exportSnapshot\(editor, /.test(dialog), "publishing is the first page, and nothing else is asked");
});

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
});

test("OSCAR itself draws nothing in that box", () => {
  const css = read("public/css/oscar_export.css");
  assert.match(css, /\.oscar-publish-section:empty \{\s*display: none;/);
  for (const file of ["public/src/oscar_editor.js", "public/src/export_dialog.js"]) {
    assert.ok(!/addSection\((?!draw)/.test(read(file)), file + " adds no section of its own");
  }
});

test("About has the same kind of place, ahead of OSCAR's own words, behind OSCAR's own mark", () => {
  const markup = read("public/partials/about.ejs");
  assert.ok(markup.indexOf('id="about-extras"') < markup.indexOf('class="info-panel-label"'), "an extension speaks first");
  const editor = read("public/src/oscar_editor.js");
  assert.match(editor, /aboutDialog: \{\s*addSection: function \(draw\) \{/);
  assert.match(editor, /id: "open-info",\s*label: icon\("jellyfish"\)/);
  assert.match(editor, /"open-info": "About Oscar"/);
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

test("each surface published on the local network wears a green live dot: served, not stored", () => {
  const dialog = read("public/src/export_dialog.js");
  const at = dialog.indexOf('live.className = "oscar-published-live"');
  const name = dialog.indexOf('open.className = "o-link oscar-published-name"');
  assert.ok(at !== -1 && name !== -1 && at < name, "the dot comes before the name");
  assert.match(dialog, /live\.title = "Live: OSCAR is serving this surface right now\."/, "and says what it means");
  const css = read("public/css/oscar_export.css");
  assert.match(css, /\.oscar-published-list \.oscar-published-live \{/, "with the pill's green and breath");
  assert.match(css, /animation: oscar-live-breathe/, "the same breath as the LIVE pill");
});
