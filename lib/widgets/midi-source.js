"use strict";

const { followMidi } = require("./midi-in");
const { isListening, inputWanted } = require("../midi/spec");

/**
 * MIDI's Data in, for one widget: subscribe `fn` to the states a controller
 * puts it in. Returns an unsubscribe function, or null where it cannot apply.
 *
 * The state reaches the widget by the door another device's state comes
 * through (`adopt`), which shuts send and share: what came in is not sent out.
 * It is recorded for a device that joins later, marked as heard so nobody is
 * told, since every page heard the same message (lib/shared-sync.js).
 */
function midiSource(host, definition, id, read, showing, adopt, onSettings) {
  if (!host.onMidiIn || !definition || !definition.fields.some(function (f) { return f.key === "midiListen"; })) return null;
  return function (fn) {
    var key = id || "w" + ++midiKeys;
    var follow = followMidi(definition, read, showing);
    var want = function () {
      if (!host.wantMidi) return;
      var config = read();
      var listening = config.enabled && isListening(config);
      host.wantMidi(key, listening ? inputWanted(config.midiInPort) : null);
    };
    want();
    var stopSettings = onSettings ? onSettings(want) : null;
    var stop = host.onMidiIn(function (heard, port, first) {
      var state = follow(heard, port, first);
      if (!state) return;
      adopt(function () {
        fn(state);
      });
      if (id && host.shareState) host.shareState(id, state, { heard: true });
    });
    return function () {
      stop();
      if (stopSettings) stopSettings();
      if (host.wantMidi) host.wantMidi(key, null);
    };
  };
}
var midiKeys = 0;

module.exports = { midiSource: midiSource };
