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

// ---- words ------------------------------------------------------------------
// A row's `what` is what identifies the traffic -- an address, a MIDI control,
// a block of DMX channels -- and is what repeats are gathered by. Its
// `value` is what the latest of them carried, and `to` where it went.

const MIDI_KINDS = { 128: "note off", 144: "note on", 160: "aftertouch", 176: "cc", 192: "program", 208: "pressure", 224: "bend" };

/** Numbers as a person reads them: 0.5, 186.732, not 186.73228346456693. */
function plain(value) {
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : String(value);
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? value.slice(0, 40) + "…" : value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "?";
}

/** An OSC message's arguments, { type, value } or bare: "0.5 1 \"go\"". */
function oscValue(args) {
  const list = Array.isArray(args) ? args : args === undefined || args === null ? [] : [args];
  const said = list.slice(0, 8).map((arg) => plain(arg && typeof arg === "object" && "value" in arg ? arg.value : arg));
  return said.join(" ") + (list.length > 8 ? " …" : "");
}

/** A MIDI request going out: what, the value it carried, and the port. */
function midiOut(request) {
  const messages = (request && Array.isArray(request.messages) && request.messages) || [];
  const first = messages[0];
  if (!first || !first.length) return { what: "midi", value: "", to: (request && request.port) || "the first port" };
  const kind = MIDI_KINDS[first[0] & 0xf0];
  // Not a channel message OSCAR knows: the bytes, as they were.
  if (!kind) return { what: "bytes " + first.slice(0, 4).join(" "), value: "", to: request.port || "the first port" };
  const channel = " ch " + ((first[0] & 0x0f) + 1);
  let what;
  let value;
  if (kind === "bend") {
    what = "bend" + channel;
    value = String(((first[2] || 0) << 7) | (first[1] || 0));
  } else if (kind === "program" || kind === "pressure") {
    what = kind + channel;
    value = String(first[1]);
  } else {
    what = kind + " " + first[1] + channel;
    value = first.length > 2 ? String(first[2]) : "";
  }
  if (messages.length > 1) value += " (+" + (messages.length - 1) + " more)";
  return { what, value, to: request.port || "the first port" };
}

/** A MIDI message heard: { what, value }, the value in MIDI's own numbers. */
function midiIn(heard) {
  if (!heard) return { what: "midi", value: "" };
  const channel = heard.channel ? " ch " + heard.channel : "";
  const unit = typeof heard.unit === "number" ? heard.unit : 0;
  if (heard.type === "pitch") return { what: "bend" + channel, value: String(Math.round(unit * 16383)) };
  if (heard.type === "program") return { what: "program" + channel, value: String(heard.number) };
  return { what: heard.type + " " + heard.number + channel, value: String(Math.round(unit * 127)) };
}

const DMX_NAMES = { artnet: "Art-Net", sacn: "sACN", usbpro: "USB (Enttec Pro, DMXKing)", opendmx: "USB (Open DMX)" };

/** Where a DMX block or stream goes: "Art-Net 10.0.0.50", "sACN multicast". */
function dmxTo(protocol, host) {
  const name = DMX_NAMES[protocol] || String(protocol || "DMX");
  if (protocol === "usbpro" || protocol === "opendmx") return name + (host ? " " + host : "");
  return name + " " + (host || (protocol === "sacn" ? "multicast" : "broadcast"));
}

/** A checked DMX request: which channels, the levels set, and where. */
function dmxOut(request) {
  const levels = (request && request.levels) || [];
  const last = request.channel + levels.length - 1;
  const what = "u " + request.universe + " · ch " + request.channel + (levels.length > 1 ? "–" + last : "");
  const value = levels.slice(0, 8).join(" ") + (levels.length > 8 ? " …" : "");
  return { what, value, to: dmxTo(request.protocol, request.host) };
}

module.exports = { ORIGINS, socketOrigin, deviceOf, oscValue, midiOut, midiIn, dmxOut, dmxTo };
