"use strict";

/**
 * The UDP socket DMX leaves through.
 *
 * A plain dgram socket rather than one of the osc.js ports: Art-Net and sACN
 * are raw bytes, and an OSC port would try to read whatever came back as OSC.
 * Shaped like receiver() in lib/osc-in.js so that a port that cannot be bound
 * is reported and OSCAR carries on -- the editor, the tablets and OSC all work
 * without DMX, and a show that will not start is the worse failure.
 *
 * Options:
 *   port             0 for any free port (see lib/ports.js)
 *   localAddress     default 0.0.0.0
 *   dgram            the module, injectable for tests
 *   onReady(address) bound; `address` is what socket.address() returned
 *   onError(err)     could not bind, or the socket complained afterwards
 *
 * Returns { send(packet, port, host) -> Promise, close, socket }. `send`
 * rejects rather than throws, whatever state the socket is in, so a stream
 * can treat every failure the same way.
 */
function openDmxSocket(options) {
  const dgram = options.dgram || require("node:dgram");
  const socket = dgram.createSocket("udp4");
  const onError = options.onError || function () {};
  let bound = false;

  function close() {
    try {
      socket.close();
    } catch (err) {
      /* never bound, or already closed */
    }
  }

  // An EventEmitter with no error listener throws, which would turn a busy
  // port into a crash at startup.
  socket.on("error", function (err) {
    if (!bound) close();
    onError(err);
  });

  socket.bind(options.port, options.localAddress || "0.0.0.0", function () {
    bound = true;
    // Art-Net's default target is the broadcast address, and a UDP socket
    // refuses to send to one until told to allow it.
    try {
      socket.setBroadcast(true);
    } catch (err) {
      onError(err);
    }
    if (options.onReady) options.onReady(socket.address());
  });

  function send(packet, port, host) {
    return new Promise(function (resolve, reject) {
      try {
        socket.send(packet, port, host, function (err) {
          if (err) reject(err);
          else resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  return { send: send, close: close, socket: socket };
}

module.exports = { openDmxSocket };
