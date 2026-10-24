/**
 * The phone, as a browser offers it: what `ctx.device` is on a page OSCAR
 * serves or exports (the ctx contract in lib/widgets/index.js).
 *
 *   motion.needsTap()      iPhones hand the sensors over only after a tap
 *   motion.ask()           the request that tap makes; resolves to allowed
 *   motion.watch(kind, fn) fn({ x, y, z }) as the sensor reports; returns stop.
 *                          The kinds: orientation, acceleration, gravity,
 *                          rotation (three values) and heading (one, x:
 *                          degrees from north)
 *   vibrate(ms)            Android browsers only; false where it cannot
 *   torch(on)              no browser can; false
 *
 * Honest about what a browser can do and no more: the OSCAR app replaces
 * the parts a phone's own code can do better (vibration on iOS, the torch)
 * and keeps the rest. No widget is named here: whatever asks for the phone
 * gets this.
 *
 * @param {Window} win
 * @returns {object|null} nothing without a window, as under a test
 */
function browserDevice(win) {
  if (!win || typeof win.addEventListener !== "function") return null;
  var nav = win.navigator || {};
  var MotionEvent = win.DeviceMotionEvent;
  var OrientationEvent = win.DeviceOrientationEvent;
  var hasMotion = typeof MotionEvent === "function" || typeof OrientationEvent === "function";
  // iOS 13+: the permission is asked for through the event class, from a tap.
  // Chromium on Android offers the same function but answers "granted" with
  // no tap and reports the sensors either way, so only Apple's engines ask.
  var apple = /iPhone|iPad|iPod|Macintosh/.test(String(nav.userAgent || ""));
  var asks = !!(apple && MotionEvent && typeof MotionEvent.requestPermission === "function");
  var granted = !asks;

  function readingOf(kind, event) {
    var source = null;
    if (kind === "heading") {
      // iOS says it outright; Android gives an absolute alpha, counted the other way round.
      var heading = typeof event.webkitCompassHeading === "number" ? event.webkitCompassHeading : event.absolute === true && typeof event.alpha === "number" ? (360 - event.alpha) % 360 : null;
      return typeof heading === "number" ? { x: heading } : null;
    }
    if (kind === "orientation") source = { x: event.alpha, y: event.beta, z: event.gamma };
    else if (kind === "acceleration") source = event.acceleration && { x: event.acceleration.x, y: event.acceleration.y, z: event.acceleration.z };
    else if (kind === "gravity") source = event.accelerationIncludingGravity && { x: event.accelerationIncludingGravity.x, y: event.accelerationIncludingGravity.y, z: event.accelerationIncludingGravity.z };
    else if (kind === "rotation") source = event.rotationRate && { x: event.rotationRate.alpha, y: event.rotationRate.beta, z: event.rotationRate.gamma };
    if (!source) return null;
    // A sensor the phone has not got reports nulls, which are not a reading.
    if (typeof source.x !== "number" || typeof source.y !== "number" || typeof source.z !== "number") return null;
    return source;
  }

  /** Android fires a separate absolute event for the compass; iOS puts the heading on the usual one. */
  function headingEvent() {
    return "ondeviceorientationabsolute" in win ? "deviceorientationabsolute" : "deviceorientation";
  }

  var motion = {
    needsTap: function () {
      return asks && !granted;
    },
    ask: function () {
      if (!asks) return Promise.resolve(true);
      var asked = [MotionEvent.requestPermission()];
      if (OrientationEvent && typeof OrientationEvent.requestPermission === "function") asked.push(OrientationEvent.requestPermission());
      return Promise.all(asked).then(
        function (answers) {
          granted = answers.every(function (answer) {
            return answer === "granted";
          });
          return granted;
        },
        function () {
          return false;
        }
      );
    },
    watch: function (kind, fn) {
      if (!hasMotion || typeof fn !== "function") return null;
      var type = kind === "orientation" ? "deviceorientation" : kind === "heading" ? headingEvent() : "devicemotion";
      var handler = function (event) {
        var reading = readingOf(kind, event);
        if (reading) fn(reading);
      };
      win.addEventListener(type, handler);
      return function () {
        win.removeEventListener(type, handler);
      };
    },
  };

  return {
    // Not the OSCAR app: the app's own device sets this true (oscar-app src/phone.js).
    app: false,
    motion: motion,
    vibrate: function (ms) {
      if (typeof nav.vibrate !== "function") return false;
      try {
        return !!nav.vibrate(ms);
      } catch (err) {
        return false;
      }
    },
    torch: function () {
      return false;
    },
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { browserDevice: browserDevice };
