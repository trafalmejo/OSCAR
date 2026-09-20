"use strict";

/**
 * The gate a MIDI request passes on its way in from a browser.
 *
 * As strict as lib/dmx/request.js, for the same reason: what arrives on the
 * socket was typed by nobody and may have come from anywhere on the network.
 * Only channel messages get through -- notes, controllers, programs, bends.
 * System exclusive can reprogram an instrument, and the real-time bytes can
 * stop a sequencer; no widget sends either, so neither is let past.
 */

const MAX_PORT_NAME = 200;
// A colour is three messages. Sixteen leaves room and is still not a flood.
const MAX_MESSAGES = 16;

/** How many bytes a channel message has, by the top four bits of its first. */
const LENGTHS = { 0x80: 3, 0x90: 3, 0xa0: 3, 0xb0: 3, 0xc0: 2, 0xd0: 2, 0xe0: 3 };

function isByte(value, max) {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

function readMessage(message) {
  if (!Array.isArray(message) || !isByte(message[0], 0xef) || message[0] < 0x80) return null;
  if (message.length !== LENGTHS[message[0] & 0xf0]) return null;
  for (let i = 1; i < message.length; i++) if (!isByte(message[i], 127)) return null;
  return message.slice();
}

/**
 * @param {*} input whatever came off the socket
 * @returns {{port: string, messages: number[][]} | null} null for anything that is not wholly right
 */
function buildRequest(input) {
  if (!input || typeof input !== "object") return null;
  const port = input.port === undefined || input.port === null ? "" : input.port;
  if (typeof port !== "string" || port.length > MAX_PORT_NAME) return null;
  if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > MAX_MESSAGES) return null;

  const messages = [];
  for (const message of input.messages) {
    const read = readMessage(message);
    // One bad message spoils the request: half a colour is another colour.
    if (!read) return null;
    messages.push(read);
  }
  return { port: port.trim(), messages: messages };
}

module.exports = { buildRequest: buildRequest, MAX_MESSAGES: MAX_MESSAGES };
