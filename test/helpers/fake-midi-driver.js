"use strict";

/**
 * A driver for the MIDI worker's tests: the shape loadDriver() returns, with
 * strings for hardware. Loaded INSIDE the forked worker by env
 * (OSCAR_MIDI_TEST_DRIVER), so everything it does has to show from outside:
 *
 *   - it lists one output, "Fake Out", and one input, "Fake In";
 *   - a message sent to the output is echoed back through the open input,
 *     so the parent can watch its own send arrive without hardware;
 *   - sending to the port name "die" aborts the process, which is the
 *     native crash this whole arrangement exists for.
 */

function lister(names) {
  const list = function () {
    return names.slice();
  };
  list.close = function () {};
  return list;
}

let deliver = null;

module.exports = {
  supported: true,
  outputs: lister(["Fake Out"]),
  inputs: lister(["Fake In"]),
  openOutput(wanted) {
    if (String(wanted).toLowerCase().indexOf("die") !== -1) process.abort();
    return {
      name: "Fake Out",
      send(bytes) {
        // Echo: what went out comes back in, as proof of the round trip.
        if (deliver) setImmediate(() => deliver && deliver(bytes));
        return true;
      },
      close() {},
    };
  },
  openInput(name, onMessage) {
    if (name !== "Fake In") return null;
    deliver = (bytes) => onMessage(bytes);
    return { name: "Fake In", close: () => (deliver = null) };
  },
  close() {},
};
