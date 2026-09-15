"use strict";

/**
 * Naming the serial port as somewhere a widget can send.
 *
 * A widget says where it sends with an IP and a port. A board on a USB cable
 * has neither, so the word `serial` stands in the IP field and the server
 * routes the message down the cable instead of onto the network.
 *
 * Kept in its own file, away from lib/serial.js: the validators in
 * lib/widgets/ run inside the browser bundle, and lib/serial.js reaches for a
 * native serial module that has no business being browserified.
 */

const SERIAL_HOST = "serial";

/** Is this widget aimed at the board on the cable rather than the network? */
function isSerialTarget(ip) {
  return String(ip == null ? "" : ip).trim().toLowerCase() === SERIAL_HOST;
}

module.exports = { SERIAL_HOST, isSerialTarget };
