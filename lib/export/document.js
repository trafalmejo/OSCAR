"use strict";

/**
 * Assembling the single file an exported interface ships as.
 *
 * One file, not a folder or a zip: every report behind this feature is someone
 * asking where the exported files are supposed to go ("Would I host this
 * locally?"). A folder of index.html plus a scripts directory answers that
 * question with another question, and gets rearranged, re-zipped and emailed
 * until a relative path breaks and the page silently stops sending. A single
 * .html opens by double-clicking it, survives being moved, and can be dropped
 * on any static host without a build step.
 *
 * Pure string assembly: the caller supplies the runtime, the socket.io client
 * and a way to read assets, so nothing here touches a disk or a network and all
 * of it can be tested from Node.
 */

const DEFAULT_SOCKET_PORT = 8081;

/**
 * Styling for the connection notice the runtime puts on the page.
 *
 * It sits over the top edge and disappears once the bridge answers, because an
 * exported surface is used during a show and nothing may permanently cover a
 * control. While it is disconnected it stays, because a page that looks fine
 * and sends nothing is exactly the complaint this export exists to fix.
 */
const RUNTIME_CSS = `
.oscar-status {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2147483647;
  padding: 10px 14px;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #fff;
  background: #b3261e;
  text-align: center;
  /* A notice must never eat a press meant for the control underneath it. */
  pointer-events: none;
  transition: opacity .3s;
}
.oscar-status-ok { background: #1a7f37; }
.oscar-status-hidden { opacity: 0; }
`;

/** Undoes the browser's default page margin, as the editor canvas does. */
const RESET_CSS = "html, body { margin: 0; padding: 0; }\n";

/**
 * References to files, as they appear in markup and in stylesheets.
 *
 * Deliberately narrow: `src`/`href` attributes and `url()`. srcset and
 * @import are left alone rather than half-handled.
 */
const HTML_REFERENCE = /\b(src|href)\s*=\s*(["'])([^"']*)\2/gi;
const CSS_REFERENCE = /url\(\s*(["']?)([^"')]*)\1\s*\)/gi;

/**
 * Build the whole document.
 *
 * @param {object} options
 * @param {string} options.title - shown in the tab
 * @param {string} options.html - the project markup, from the editor
 * @param {string} options.css - the project stylesheet, from the editor
 * @param {{ host: string, port: number|string }} options.connection - where
 *        OSCAR's OSC bridge is, baked in at export time
 * @param {string} options.runtime - the standalone runtime bundle's source
 * @param {string} options.socketio - the socket.io client's source
 * @param {string[]} [options.styles] - widget stylesheets to inline
 * @param {string} [options.oscarVersion] - recorded in the file's header
 * @param {(reference: string) => string|null} [options.readAsset] - turns a
 *        relative reference into a data: URI, or returns null to leave it
 * @returns {string} a complete HTML document
 */
function buildDocument(options) {
  const opts = options || {};
  const connection = normaliseConnection(opts.connection);
  const readAsset = typeof opts.readAsset === "function" ? opts.readAsset : null;

  const title = String(opts.title || "OSCAR interface");
  const styles = (opts.styles || []).map((style) => inlineCssAssets(String(style), readAsset));
  const projectCss = inlineCssAssets(String(opts.css || ""), readAsset);
  const markup = inlineHtmlAssets(String(opts.html || ""), readAsset);

  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">',
    "<title>" + escapeHtml(title) + "</title>",
    styleTag(RESET_CSS + styles.join("\n") + RUNTIME_CSS),
    styleTag(projectCss),
  ].join("\n    ");

  const tail = [
    scriptTag("window.OSCAR_EXPORT = " + embedJson(exportInfo(opts, connection, title)) + ";"),
    scriptTag(String(opts.socketio || "")),
    scriptTag(String(opts.runtime || "")),
  ].join("\n");

  return (
    "<!doctype html>\n" +
    '<html lang="en">\n' +
    "  <head>\n" +
    "    " +
    head +
    "\n  </head>\n" +
    header(connection, opts.oscarVersion) +
    composeBody(markup, tail) +
    "\n</html>\n"
  );
}

/**
 * What the file says about itself before a single byte of markup.
 *
 * People open an exported file in an editor when it does not work, so the
 * answer is written where they will be looking. The one thing everybody gets
 * wrong is that this page is not self-sufficient: a browser cannot open a UDP
 * socket, so OSC always leaves from the OSCAR process, never from here.
 */
function header(connection, oscarVersion) {
  return (
    "  <!--\n" +
    "    An OSCAR control surface" +
    (oscarVersion ? ", exported by OSCAR " + oscarVersion : "") +
    ".\n" +
    "\n" +
    "    THIS PAGE CANNOT SEND OSC ON ITS OWN.\n" +
    "\n" +
    "    Browsers have no way to open a UDP socket, so every message this page\n" +
    "    produces is relayed by OSCAR. For the controls to do anything:\n" +
    "\n" +
    "      1. OSCAR must be running on " +
    connection.host +
    ".\n" +
    "      2. This device must be able to reach " +
    connection.host +
    ":" +
    connection.port +
    " --\n" +
    "         same network, and not blocked by a firewall.\n" +
    "\n" +
    "    The page says so on screen when it cannot reach OSCAR.\n" +
    "\n" +
    "    Moved OSCAR to a different machine? You do not have to export again:\n" +
    "    open this page with ?oscar-host=ADDRESS&oscar-port=PORT on the end of\n" +
    "    the URL, or edit window.OSCAR_EXPORT at the bottom of this file.\n" +
    "\n" +
    "    Each control carries its own OSC target in its data-oscar-config\n" +
    "    attribute, and can be re-aimed by editing it here.\n" +
    "  -->\n"
  );
}

function exportInfo(opts, connection, title) {
  return {
    host: connection.host,
    port: connection.port,
    title: title,
    oscar: opts.oscarVersion || null,
    exportedAt: opts.exportedAt || new Date().toISOString(),
  };
}

/**
 * Where the bridge is.
 *
 * The port falls back to OSCAR's default rather than to 0: this addresses a
 * TCP socket, and 0 would mean "any free port", which reaches nothing.
 */
function normaliseConnection(connection) {
  const source = connection || {};
  const host = String(source.host == null ? "" : source.host).trim() || "localhost";
  const port = Number(source.port);
  return {
    host: host,
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_SOCKET_PORT,
  };
}

/**
 * Put the scripts inside the body the editor produced.
 *
 * getHtml() hands back the wrapper, which is a <body> element, so the markup
 * usually already is the body. Wrapping that in another one would nest two
 * bodies and the browser would throw the inner one's attributes away, taking
 * the project's own background and layout with them.
 */
function composeBody(markup, tail) {
  const body = markup.trim();

  if (/^<body[\s>]/i.test(body)) {
    const close = body.toLowerCase().lastIndexOf("</body>");
    if (close !== -1) {
      return body.slice(0, close) + "\n" + tail + "\n" + body.slice(close);
    }
    // An opening tag with no closing one: the browser closes it at the end of
    // the document anyway, so appending is right.
    return body + "\n" + tail;
  }

  return "  <body>\n" + body + "\n" + tail + "\n  </body>";
}

function styleTag(css) {
  if (!css.trim()) return "";
  return "<style>\n" + guardClosingTag(css, "style") + "\n</style>";
}

function scriptTag(js) {
  if (!js.trim()) return "";
  return "<script>\n" + guardClosingTag(js, "script") + "\n</script>";
}

/**
 * Stop embedded text from closing the element it sits in.
 *
 * `</script>` inside a string literal ends the script tag as far as the HTML
 * parser is concerned, and the rest of the file becomes visible text. A
 * backslash before the slash means the same thing to both JavaScript and CSS
 * string syntax, and nothing at all outside one -- where the sequence would be
 * a syntax error regardless.
 */
function guardClosingTag(source, tag) {
  return source.replace(new RegExp("</(" + tag + ")", "gi"), "<\\/$1");
}

/**
 * JSON safe to drop straight into a <script>.
 *
 * Escaping `<` covers `</script>` and `<!--`, both of which end a script
 * element early no matter where in the source they appear.
 */
function embedJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Replace what can be inlined in markup; leave the rest exactly as it was. */
function inlineHtmlAssets(html, readAsset) {
  if (!readAsset) return html;
  return html.replace(HTML_REFERENCE, function (match, attribute, quote, reference) {
    const uri = readAsset(reference);
    if (!uri) return match;
    return attribute + "=" + quote + uri + quote;
  });
}

function inlineCssAssets(css, readAsset) {
  if (!readAsset) return css;
  return css.replace(CSS_REFERENCE, function (match, quote, reference) {
    const uri = readAsset(reference);
    if (!uri) return match;
    // Quoted on the way out whatever it was on the way in: a data: URI holds
    // characters that are not valid in a bare url().
    return 'url("' + uri + '")';
  });
}

module.exports = {
  buildDocument,
  composeBody,
  normaliseConnection,
  inlineHtmlAssets,
  inlineCssAssets,
  guardClosingTag,
  RUNTIME_CSS,
  DEFAULT_SOCKET_PORT,
};
