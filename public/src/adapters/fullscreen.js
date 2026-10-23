/**
 * Full screen on a phone or tablet.
 *
 * A browser's address bar and toolbar take a fifth of a phone's screen, and
 * a swipe meant for a fader can scroll the page or go back a page. The page
 * can ask to fill the screen, but only from a tap -- no browser lets a page
 * do it on its own -- so a small button offers it, bottom left, on a screen
 * that is touched. It is not shown where it has nothing to offer: a laptop
 * (F11, and a window that is not in the way), a page already in full screen,
 * or one opened from the home screen, which has no browser around it to
 * hide. Safari on an iPhone allows no page full screen at all and the
 * button stays away there too: on an iPhone, Add to Home Screen is the way,
 * and the manifest a served page carries (lib/published.js) makes that
 * open without a browser.
 *
 * Styled inline, like the status banner, so no stylesheet can move it; it
 * sits in a corner and dims after a while rather than going, so a control
 * underneath stays reachable and the button stays findable.
 *
 * @param {Document} doc
 * @param {Window} [win]
 * @param {{ setTimeout?: Function }} [deps] for the tests
 * @returns {{ element: Element, remove: () => void }|null} nothing where it is not offered
 */

var BUTTON_STYLE = [
  "position:fixed",
  "left:8px",
  "bottom:8px",
  "z-index:2147483646",
  "margin:0",
  "padding:6px 12px",
  "border:0",
  "border-radius:999px",
  "background:rgba(0,0,0,.55)",
  "color:#fff",
  "font:600 12px/1.4 Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
  "cursor:pointer",
  "-webkit-tap-highlight-color:transparent",
  "transition:opacity .4s",
].join(";");

/** After this long untouched the button dims; it never goes. */
var RESTING_MS = 6000;

function matches(win, query) {
  if (!win || typeof win.matchMedia !== "function") return false;
  var list = win.matchMedia(query);
  return !!(list && list.matches);
}

/** Opened from the home screen: there is no browser around the page to hide. */
function isStandalone(win) {
  if (win && win.navigator && win.navigator.standalone === true) return true;
  return matches(win, "(display-mode: standalone)") || matches(win, "(display-mode: fullscreen)");
}

function inFullscreen(doc) {
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

function offerFullscreen(doc, win, deps) {
  if (!doc || !doc.body || typeof doc.createElement !== "function") return null;
  var root = doc.documentElement;
  var request = root && (root.requestFullscreen || root.webkitRequestFullscreen);
  if (typeof request !== "function") return null;
  if (!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled)) return null;
  if (!matches(win, "(pointer: coarse)") || isStandalone(win)) return null;
  var later = (deps && deps.setTimeout) || function (fn, ms) { return setTimeout(fn, ms); };

  var button = doc.createElement("button");
  button.setAttribute("type", "button");
  button.setAttribute("data-oscar-fullscreen", "");
  button.setAttribute("aria-label", "Full screen");
  button.textContent = "Full screen";

  function place() {
    var hidden = inFullscreen(doc);
    button.setAttribute("style", BUTTON_STYLE + ";opacity:" + (hidden ? "0" : "1") + (hidden ? ";display:none" : ""));
  }
  function rest() {
    if (!inFullscreen(doc)) button.setAttribute("style", BUTTON_STYLE + ";opacity:.45");
  }
  place();
  var resting = later(rest, RESTING_MS);
  if (resting && typeof resting.unref === "function") resting.unref();

  function tapped(event) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    try {
      var asked = request.call(root);
      if (asked && typeof asked.catch === "function") asked.catch(function () {});
    } catch (err) {
      // Refused: the button stays, and the next tap may do better.
    }
  }
  button.addEventListener("click", tapped);
  var changes = ["fullscreenchange", "webkitfullscreenchange"];
  if (typeof doc.addEventListener === "function") {
    changes.forEach(function (event) {
      doc.addEventListener(event, place);
    });
  }
  doc.body.appendChild(button);

  return {
    element: button,
    remove: function () {
      if (typeof doc.removeEventListener === "function") {
        changes.forEach(function (event) {
          doc.removeEventListener(event, place);
        });
      }
      if (button.parentNode && typeof button.parentNode.removeChild === "function") button.parentNode.removeChild(button);
    },
  };
}

module.exports = { offerFullscreen: offerFullscreen, isStandalone: isStandalone, RESTING_MS: RESTING_MS };
