"use strict";

/**
 * Naming the serial cable as somewhere a widget can send.
 *
 * A widget says where it sends with an Ip and a Port. A board on a USB cable
 * has neither, so the word `serial` stands in the Ip field and the server
 * routes the message down the cable instead of onto the network.
 *
 * Why the Ip field and not one more entry under Output: Output (the
 * transport select) only exists on widgets that can drive DMX, and a
 * definition with dmx: false is not allowed to carry it -- so a text input
 * could never have reached a board. Ip is on every widget that sends at all.
 * It is also the honest place for it: Output chooses WHAT goes on the wire
 * (OSC, DMX levels), and serial changes none of that. It is the same OSC
 * message with a different destination, which is what Ip has always meant.
 * "OSC to the board and DMX to the dimmer" falls out for free, where a
 * transport entry would have needed a serial+dmx combination as well.
 *
 * Kept in its own file, away from lib/serial.js: the validators in
 * lib/widgets/ run inside the browser bundle, and lib/serial.js reaches for a
 * native serial module that has no business being browserified.
 */

const SERIAL_HOST = "serial";

/**
 * Is this destination the board on the cable rather than the network?
 *
 * Forgiving about case and stray spaces on purpose: there is one reading of
 * the word and every gate uses it, so "Serial " can never be accepted by the
 * settings panel and then sent to the network by the server.
 */
function isSerialTarget(ip) {
  return typeof ip === "string" && ip.trim().toLowerCase() === SERIAL_HOST;
}

module.exports = { SERIAL_HOST, isSerialTarget };
