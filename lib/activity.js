"use strict";

/**
 * Who a network-log row is on behalf of, and the words it uses.
 *
 * Every outgoing row says where the move came from, because debugging a show
 * is telling those apart: a hand on the editor's canvas, a device on OSCAR's
 * own network, a visitor's phone through the relay, a schedule, or a bridge
 * passing on what came in.
 *
 *   canvas    the editor
 *   local     a page on OSCAR's network: a published surface, /preview, or
 *             an exported file opened on a computer
 *   internet  a phone reaching a public surface through the relay (Pro)
 *   schedule  a schedule firing (Pro)
 *   bridge    a widget whose Send when passes on what it hears
 *
 * A page says what it is when it connects (oscar_socket.js, `from`). That is
 * a label and nothing more: a page could claim to be anything, and all it
 * would change is a word in a log. Nothing is sent differently for it, and
 * "internet" cannot be claimed at all -- only the relay's own path, which
 * never touches these sockets, sets it.
 */

const ORIGINS = ["canvas", "local", "internet", "schedule", "bridge"];

// A published surface's id: what published.js makes of a name.
const SURFACE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** "::ffff:192.168.1.20" -> "192.168.1.20": the address people know. */
function deviceOf(address) {
  const text = typeof address === "string" ? address : "";
  return text.replace(/^::ffff:/, "") || undefined;
}

/**
 * What a socket connection sends on behalf of, from its handshake's `from`
 * and its peer address.
 *
 * @returns {{ origin: string, surface?: string, device?: string }}
 */
function socketOrigin(from, address) {
  const said = typeof from === "string" ? from : "";
  if (said === "canvas") return { origin: "canvas" };
  const device = deviceOf(address);
  if (said === "preview") return { origin: "local", surface: "preview", device };
  if (said.indexOf("show:") === 0 && SURFACE_ID.test(said.slice(5))) return { origin: "local", surface: said.slice(5), device };
  return { origin: "local", device };
}

/** The same words the editor's log always used for MIDI: "cc 7 ch 1". */
function midiWords(request) {
  const first = request && Array.isArray(request.messages) && request.messages[0];
  if (!first || !first.length) return "midi";
  const kinds = { 128: "note off", 144: "note on", 160: "aftertouch", 176: "cc", 192: "program", 224: "bend" };
  const kind = kinds[first[0] & 0xf0] || "midi";
  return kind + (first.length > 1 ? " " + first[1] : "") + " ch " + ((first[0] & 0x0f) + 1) + (request.port ? " · " + request.port : "");
}

/** A MIDI message heard, in the log's words: "cc 7 ch 1 · nanoKONTROL2". */
function heardMidiWords(heard, port) {
  const said = [heard && heard.type, heard && heard.number !== undefined ? heard.number : null, heard && heard.channel ? "ch " + heard.channel : null]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ");
  return said + (port ? " · " + port : "");
}

/** "ch 12 · u 1", or "frame" for a request that names no channel. */
function dmxWords(request) {
  if (!request || request.channel === undefined) return "frame";
  return "ch " + request.channel + (request.universe ? " · u " + request.universe : "");
}

module.exports = { ORIGINS, socketOrigin, deviceOf, midiWords, heardMidiWords, dmxWords };
