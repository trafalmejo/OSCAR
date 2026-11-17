// A release to the Microsoft Store without Partner Center: the two .appx
// packages a tag builds (one per CPU) put in place of the ones the Store
// has, with this version's "What's new", and sent to certification.
//
//   node scripts/store-submit.js release-builds/*.appx     submit
//   node scripts/store-submit.js --check                   sign in and say what the Store has; change nothing
//
// It is what was done by hand for 2.1.2 and 2.2.0, through Microsoft's
// Store submission API: the new submission starts as a copy of the last
// published one, so the listing, the price, the age rating and everything
// else stay as they are; only the packages and the release notes change.
// A package passes certification before anyone gets it, and then the Store
// publishes it by itself, as the submissions made by hand were set to.
//
// It signs in as a Microsoft Entra application that Partner Center knows
// (Account settings, with the Manager role), from three values in the
// environment: MS_STORE_TENANT_ID, MS_STORE_CLIENT_ID, MS_STORE_CLIENT_SECRET.
// The release workflow has them as secrets; nothing of them is in the repo.
// Run from the maintainer's computer, values not in the environment are
// read from ../secrets/microsoft-store/store.env, a folder outside the repo.
//
// The notes are build/store/whats-new.txt, written for each release.
//
// No dependency. The API wants the packages inside one ZIP in Azure Blob
// Storage, so this writes the ZIP itself (stored, not compressed: an .appx
// is compressed already) and sends it in blocks.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_ID = "9N73N8MS31JV"; // OSCAR: OSC, MIDI & DMX Control
const API = "https://manage.devcenter.microsoft.com/v1.0/my/applications/" + APP_ID;
const RESOURCE = "https://manage.devcenter.microsoft.com";
const NOTES_FILE = path.join(__dirname, "..", "build", "store", "whats-new.txt");
const NOTES_MAX = 1500; // Partner Center's limit for "What's new in this version"
const BLOCK = 8 * 1024 * 1024;
const ZIP_MAX = 0xffffffff; // beyond this a ZIP needs the 64-bit format, which is not written here

// ---------------------------------------------------------------- what is sent

/**
 * The submission's packages after this release: every one the Store has is
 * marked to go, and the new files are added to come. Entries already on
 * their way out stay as they are.
 */
function packagesFor(existing, fileNames) {
  const kept = (existing || []).map((pkg) => (pkg.fileStatus === "PendingDelete" ? pkg : Object.assign({}, pkg, { fileStatus: "PendingDelete" })));
  const added = fileNames.map((fileName) => ({ fileName, fileStatus: "PendingUpload", minimumDirectXVersion: "None", minimumSystemRam: "None" }));
  return kept.concat(added);
}

/** The same notes on every language the listing has. */
function withNotes(listings, notes) {
  const out = {};
  for (const lang of Object.keys(listings || {})) {
    const listing = listings[lang] || {};
    out[lang] = Object.assign({}, listing, { baseListing: Object.assign({}, listing.baseListing, { releaseNotes: notes }) });
  }
  return out;
}

function readNotes(text) {
  const notes = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!notes) throw new Error("build/store/whats-new.txt is empty: write what this version brings");
  if (notes.length > NOTES_MAX) throw new Error("whats-new.txt is " + notes.length + " characters; the Store takes " + NOTES_MAX);
  return notes;
}

/** The version a package's file name states, to refuse sending last time's files. */
function versionOf(fileName) {
  const found = /-(\d+\.\d+\.\d+)-win-/.exec(fileName);
  return found ? found[1] : null;
}

// ---------------------------------------------------------------- the ZIP

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer, seed) {
  let c = (seed === undefined ? 0 : seed) ^ 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function crcOfFile(file) {
  const fd = fs.openSync(file, "r");
  const chunk = Buffer.alloc(1024 * 1024);
  let crc = 0;
  try {
    for (;;) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!read) break;
      crc = crc32(chunk.subarray(0, read), crc);
    }
  } finally {
    fs.closeSync(fd);
  }
  return crc;
}

/**
 * Write a ZIP holding the files at its root, stored as they are. Read a
 * megabyte at a time, so two packages of 180 MB cost no memory.
 */
function writeZip(target, files) {
  const out = fs.openSync(target, "w");
  const central = [];
  let offset = 0;
  const put = (buffer) => {
    fs.writeSync(out, buffer);
    offset += buffer.length;
  };
  try {
    for (const file of files) {
      const name = Buffer.from(path.basename(file), "utf8");
      const size = fs.statSync(file).size;
      const crc = crcOfFile(file);
      if (size > ZIP_MAX || offset + size > ZIP_MAX) throw new Error("The packages are too large for this ZIP writer (4 GB)");
      const at = offset;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // version needed
      local.writeUInt16LE(0x0800, 6); // names are UTF-8
      local.writeUInt16LE(0, 8); // stored
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(size, 18);
      local.writeUInt32LE(size, 22);
      local.writeUInt16LE(name.length, 26);
      put(local);
      put(name);
      const fd = fs.openSync(file, "r");
      const chunk = Buffer.alloc(1024 * 1024);
      try {
        for (;;) {
          const read = fs.readSync(fd, chunk, 0, chunk.length, null);
          if (!read) break;
          put(chunk.subarray(0, read));
        }
      } finally {
        fs.closeSync(fd);
      }
      central.push({ name, size, crc, at });
    }
    const start = offset;
    for (const entry of central) {
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50, 0);
      record.writeUInt16LE(20, 4);
      record.writeUInt16LE(20, 6);
      record.writeUInt16LE(0x0800, 8);
      record.writeUInt32LE(entry.crc, 16);
      record.writeUInt32LE(entry.size, 20);
      record.writeUInt32LE(entry.size, 24);
      record.writeUInt16LE(entry.name.length, 28);
      record.writeUInt32LE(entry.at, 42);
      put(record);
      put(entry.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - start, 12);
    end.writeUInt32LE(start, 16);
    put(end);
  } finally {
    fs.closeSync(out);
  }
  return offset;
}

// ---------------------------------------------------------------- the requests

/** One request to the Store; Microsoft's own words when it refuses. */
async function call(method, url, token, body) {
  const headers = { Authorization: "Bearer " + token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    /* not JSON: the text is the message */
  }
  if (!res.ok) throw new Error(method + " " + url.replace(API, "…") + " answered " + res.status + ": " + ((data && (data.message || data.code)) || text.slice(0, 300)));
  return data;
}

/** The maintainer's own file of NAME=value lines, when there is one; the environment wins. */
function withLocalValues(env, file) {
  const out = Object.assign({}, env);
  let text = "";
  try {
    text = fs.readFileSync(file || path.join(__dirname, "..", "..", "secrets", "microsoft-store", "store.env"), "utf8");
  } catch (err) {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const found = /^(MS_STORE_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (found && found[2] && !out[found[1]]) out[found[1]] = found[2];
  }
  return out;
}

async function accessToken(env) {
  for (const name of ["MS_STORE_TENANT_ID", "MS_STORE_CLIENT_ID", "MS_STORE_CLIENT_SECRET"]) {
    if (!env[name]) throw new Error(name + " is not set");
  }
  const res = await fetch("https://login.microsoftonline.com/" + encodeURIComponent(env.MS_STORE_TENANT_ID) + "/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.MS_STORE_CLIENT_ID, client_secret: env.MS_STORE_CLIENT_SECRET, resource: RESOURCE }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error("Microsoft gave no token: " + (data.error_description || data.error || res.status).toString().split("\n")[0]);
  return data.access_token;
}

/** The ZIP to the storage address the submission came with, a block at a time. */
async function uploadBlocks(sasUrl, file, say) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, "r");
  const ids = [];
  const join = sasUrl.includes("?") ? "&" : "?";
  try {
    for (let at = 0, n = 0; at < size; at += BLOCK, n++) {
      const chunk = Buffer.alloc(Math.min(BLOCK, size - at));
      fs.readSync(fd, chunk, 0, chunk.length, at);
      const id = Buffer.from("block-" + String(n).padStart(6, "0")).toString("base64");
      const res = await fetch(sasUrl + join + "comp=block&blockid=" + encodeURIComponent(id), { method: "PUT", body: chunk });
      if (!res.ok) throw new Error("The upload was refused at " + Math.round(at / 1048576) + " MB: " + res.status + " " + (await res.text()).slice(0, 200));
      ids.push(id);
      if (say && n % 8 === 7) say(Math.round(((at + chunk.length) / size) * 100) + "% uploaded");
    }
  } finally {
    fs.closeSync(fd);
  }
  const list = '<?xml version="1.0" encoding="utf-8"?><BlockList>' + ids.map((id) => "<Latest>" + id + "</Latest>").join("") + "</BlockList>";
  const res = await fetch(sasUrl + join + "comp=blocklist", { method: "PUT", headers: { "Content-Type": "application/xml" }, body: list });
  if (!res.ok) throw new Error("The upload could not be closed: " + res.status + " " + (await res.text()).slice(0, 200));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(argv, env) {
  const check = argv.includes("--check");
  const files = argv.filter((arg) => !arg.startsWith("--")).map((f) => path.resolve(f));
  const version = require("../package.json").version;

  const token = await accessToken(withLocalValues(env));
  const app = await call("GET", API, token);
  const pending = app.pendingApplicationSubmission;
  console.log("Signed in. " + (app.primaryName || APP_ID) + ": " + (pending ? "a submission is in progress (" + pending.id + ")" : "no submission in progress") + ".");
  if (check) {
    const last = app.lastPublishedApplicationSubmission;
    if (last) {
      const published = await call("GET", API + "/submissions/" + last.id, token);
      console.log("Published: " + (published.applicationPackages || []).map((p) => p.fileName + " " + (p.version || "")).join(", "));
    }
    console.log("Check only: nothing changed.");
    return;
  }

  if (!files.length) throw new Error("Name the .appx files to send");
  for (const file of files) {
    if (!/\.(appx|msix)$/i.test(file) || !fs.existsSync(file)) throw new Error("Not a package: " + file);
    if (versionOf(path.basename(file)) !== version) throw new Error(path.basename(file) + " is not version " + version + ", which package.json states");
  }
  const notes = readNotes(fs.readFileSync(NOTES_FILE, "utf8"));

  // One submission at a time: one left unfinished, by hand or by a run that
  // failed, is dropped, since a new one cannot be made beside it. One that
  // is already with Microsoft (in certification) is not ours to drop.
  if (pending) {
    const state = await call("GET", API + "/submissions/" + pending.id + "/status", token);
    if (state.status !== "PendingCommit" && state.status !== "CommitFailed") throw new Error("Submission " + pending.id + " is " + state.status + ": wait for it, or cancel it in Partner Center");
    await call("DELETE", API + "/submissions/" + pending.id, token);
    console.log("Dropped the unfinished submission " + pending.id + ".");
  }

  const submission = await call("POST", API + "/submissions", token);
  console.log("Submission " + submission.id + " made from the published one.");
  submission.applicationPackages = packagesFor(submission.applicationPackages, files.map((f) => path.basename(f)));
  submission.listings = withNotes(submission.listings, notes);
  await call("PUT", API + "/submissions/" + submission.id, token, submission);

  const zip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oscar-store-")), "packages.zip");
  try {
    const size = writeZip(zip, files);
    console.log("Uploading " + files.length + " packages, " + Math.round(size / 1048576) + " MB.");
    await uploadBlocks(submission.fileUploadUrl, zip, (line) => console.log("  " + line));
  } finally {
    fs.rmSync(path.dirname(zip), { recursive: true, force: true });
  }

  await call("POST", API + "/submissions/" + submission.id + "/commit", token);
  // Committed is not accepted: the Store reads the packages first, and says
  // within minutes if it will not have them.
  for (let i = 0; i < 60; i++) {
    await wait(20000);
    const state = await call("GET", API + "/submissions/" + submission.id + "/status", token);
    if (state.status === "CommitStarted") continue;
    const details = state.statusDetails || {};
    for (const warning of details.warnings || []) console.log("  note: " + warning.code + " " + warning.details);
    if (/Failed$/.test(state.status)) {
      throw new Error("The Store refused the submission (" + state.status + "): " + (details.errors || []).map((e) => e.code + " " + e.details).join("; "));
    }
    console.log("Submission " + submission.id + " is with the Store: " + state.status + ". It publishes by itself once certified; Partner Center and the account's email say when.");
    return;
  }
  throw new Error("The Store had not answered after 20 minutes; Partner Center shows where submission " + submission.id + " stands");
}

module.exports = { withLocalValues, packagesFor, withNotes, readNotes, versionOf, writeZip, crc32, NOTES_MAX, NOTES_FILE };

if (require.main === module) {
  main(process.argv.slice(2), process.env).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
