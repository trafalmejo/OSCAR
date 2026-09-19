"use strict";

/**
 * Assembling the single file an exported interface ships as.
 *
 * One file, not a folder or a zip: the reports behind this feature are people
 * asking where the exported files are supposed to go. A folder of index.html
 * plus scripts answers that with another question, and gets rearranged and
 * re-zipped until a relative path breaks and the page silently stops sending.
 * A single .html opens by double-clicking it, survives being moved, and can
 * be dropped on any static host.
 *
 * Pure string assembly: the caller supplies the runtime, the socket.io client
 * and a way to read assets (lib/export/index.js does), so nothing here
 * touches a disk or a network.
 */

/** Undoes the browser's default page margin, as the editor's canvas does. */
const { NAME_ATTR, CONFIG_ATTR, embedAssets } = require("./config");

const RESET_CSS = "html, body { margin: 0; padding: 0; }";

/**
 * References to files, as they appear in markup and in stylesheets.
 *
 * Deliberately narrow: `src`/`poster` attributes and `url()`. An `href` is
 * left alone -- on a link it is somewhere to go, not something to embed --
 * and so are srcset and @import, rather than half-handled.
 */
const REFERENCE_ATTRIBUTES = ["src", "poster"];
/**
 * One opening tag, quoted values skipped whole so a `>` inside one does not
 * end it, and then one attribute at a time, value and all. Walking the
 * attributes rather than searching the markup for `src=` is what keeps text
 * that merely looks like a reference -- title="paste src='a.png' here" -- from
 * being rewritten into kilobytes of base64: the title's value is consumed as
 * the title's value and never looked inside. It also reads an unquoted
 * src=a.png, which would otherwise stay a relative link that breaks the
 * moment the file leaves this machine.
 */
const OPENING_TAG = /<([a-zA-Z][^\s\/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTRIBUTE = /([^\s=\/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
/** Which widget a tag is, from its attributes: only ever written quoted. */
const WIDGET_NAME = new RegExp("(?:^|\\s)" + NAME_ATTR + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')");
const CSS_REFERENCE = /url\(\s*(["']?)([^"')]*)\1\s*\)/gi;

function unescapeHtml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Stop embedded text from closing the element it sits in.
 *
 * `</script>` inside a string literal ends the script as far as the HTML
 * parser is concerned, and the rest of the file becomes visible text. A
 * backslash before the slash means the same to a JavaScript or CSS string and
 * nothing outside one.
 */
function guardClosingTag(source, tag) {
  return source.replace(new RegExp("</(" + tag + ")", "gi"), "<\\/$1");
}

/** JSON safe inside a <script>: `<` covers both </script> and <!--. */
function embedJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function styleTag(css) {
  return css.trim() ? "<style>\n" + guardClosingTag(css, "style") + "\n</style>" : "";
}

function scriptTag(js) {
  return js.trim() ? "<script>\n" + guardClosingTag(js, "script") + "\n</script>" : "";
}

/** Replace what can be inlined in markup; leave the rest exactly as it was. */
function inlineHtmlAssets(html, readAsset) {
  if (!readAsset) return html;
  return html.replace(OPENING_TAG, function (tag, name, attributes) {
    const widget = WIDGET_NAME.exec(attributes);
    const rewritten = attributes.replace(ATTRIBUTE, function (match, attribute, double, single, bare) {
      // A widget's settings can name files too -- a media browser's
      // thumbnails -- and only the widget knows where in them.
      if (widget && attribute.toLowerCase() === CONFIG_ATTR) {
        const raw = double !== undefined ? double : single;
        const embedded = raw === undefined ? null : embedAssets(widget[1] || widget[2], unescapeHtml(raw), readAsset);
        return embedded === null ? match : attribute + '="' + escapeHtml(embedded) + '"';
      }
      if (REFERENCE_ATTRIBUTES.indexOf(attribute.toLowerCase()) === -1) return match;
      const reference = double !== undefined ? double : single !== undefined ? single : bare;
      if (reference === undefined) return match;
      const uri = readAsset(reference);
      if (!uri) return match;
      // The quote it came with is the quote it leaves with. This pass also
      // sees tag-like text inside an inline script, and <img src='a.png'>
      // sitting in a double-quoted JavaScript string stays valid only while
      // its own quotes stay single. A bare value gains quotes, which a data:
      // URI needs and holds neither kind of.
      const quote = single !== undefined ? "'" : '"';
      return attribute + "=" + quote + uri + quote;
    });
    return "<" + name + rewritten + ">";
  });
}

function inlineCssAssets(css, readAsset) {
  if (!readAsset) return css;
  return css.replace(CSS_REFERENCE, function (match, quote, reference) {
    const uri = readAsset(reference);
    // Quoted on the way out whatever it was on the way in: a data: URI holds
    // characters a bare url() does not allow.
    return uri ? 'url("' + uri + '")' : match;
  });
}

/**
 * What the file says about itself before a byte of markup.
 *
 * People open an exported file in a text editor when it does not work, so
 * the answer is written where they will be looking. `connection` has been
 * through readConnection (lib/export/connection.js), so it cannot close the
 * comment.
 */
function header(connection, oscarVersion, linked) {
  const at = connection.host + ":" + connection.port;
  const lines = [
    "An OSCAR control surface" + (oscarVersion ? ", exported by OSCAR " + oscarVersion : "") + ".",
    "",
    "THIS PAGE CANNOT SEND OSC OR DMX ON ITS OWN.",
    "",
    "A browser cannot open a UDP socket, so everything this page sends is",
    "relayed by OSCAR, and everything it follows is received by OSCAR for it.",
    "For the controls to do anything:",
    "",
    "  1. OSCAR must be running on " + connection.host + ".",
    "  2. The device showing this page must be able to reach " + at,
    "     (same network, not blocked by a firewall).",
    "",
    "The page says so on screen for as long as it cannot reach OSCAR.",
    "",
    "Moved OSCAR to another machine? There is no need to export again: open",
    "this page with ?oscar-host=ADDRESS&oscar-port=PORT on the end of its",
    "address, or edit window.OSCAR_EXPORT near the bottom of this file. PORT",
    "is OSCAR's bridge port (it is printed when OSCAR starts), not the port",
    "the editor is opened on.",
    "",
    "Each control carries its settings in its data-oscar-config attribute.",
    "A control whose settings cannot be read stays switched off; it never",
    "falls back to default settings.",
  ];
  if (linked && linked.length) {
    lines.push("", "Too large to embed, so these have to travel with this file:");
    for (const reference of linked) lines.push("  " + String(reference).replace(/--/g, "- -"));
  }
  return "<!--\n" + lines.map((line) => (line ? "  " + line : "")).join("\n") + "\n-->";
}

/**
 * Put the scripts inside the body the editor produced.
 *
 * getHtml() hands back the wrapper, which is a <body>, so the markup usually
 * already is the body. Wrapping it in another would nest two, and the browser
 * throws the inner one's attributes away -- the project's own id, and with it
 * every style rule written against it.
 */
function composeBody(markup, tail) {
  const body = markup.trim();
  if (/^<body[\s>]/i.test(body)) {
    // Searched for in the string that is then cut. Lowercasing a copy to find
    // it does not keep positions: U+0130, the Turkish capital dotted I, is
    // one unit long and two once lowercased, so every one on the canvas moved
    // the cut a character further into "</body>" and the first script -- the
    // one saying where OSCAR is -- was swallowed by the broken tag.
    let close = -1;
    const closing = /<\/body\s*>/gi;
    for (let found = closing.exec(body); found; found = closing.exec(body)) close = found.index;
    if (close === -1) return body + "\n" + tail;
    return body.slice(0, close) + "\n" + tail + "\n" + body.slice(close);
  }
  return "<body>\n" + body + "\n" + tail + "\n</body>";
}

/**
 * Build the whole document.
 *
 * @param {object} options
 * @param {string} options.title shown in the tab
 * @param {string} options.html the first page's markup, widgets' settings written in
 * @param {string} options.css the project's stylesheet
 * @param {{ host: string, port: number }} options.connection where OSCAR's
 *        bridge is, already validated
 * @param {string} options.runtime the standalone runtime bundle's source
 * @param {string} options.socketio the socket.io client's source
 * @param {string[]} [options.styles] widget stylesheets to inline
 * @param {string} [options.oscarVersion]
 * @param {Function} [options.readAsset] reference -> data: URI or null;
 *        its `linked` list, if it keeps one, is reported in the header
 */
function buildDocument(options) {
  const opts = options || {};
  const connection = opts.connection;
  const readAsset = typeof opts.readAsset === "function" ? opts.readAsset : null;
  const title = String(opts.title || "OSCAR interface");

  const styles = (opts.styles || []).map((style) => inlineCssAssets(String(style), readAsset));
  const projectCss = inlineCssAssets(String(opts.css || ""), readAsset);
  const markup = inlineHtmlAssets(String(opts.html || ""), readAsset);

  const baked = {
    host: connection.host,
    port: connection.port,
    oscar: opts.oscarVersion || null,
  };

  const tail = [
    // Not fetched from /connection: this page is opened from file:// or from
    // some other server, where that request is exactly what fails.
    scriptTag("window.OSCAR_EXPORT = " + embedJson(baked) + ";"),
    // The map is not in the file, and asking for it is a 404 in the console
    // of someone already looking for what is wrong.
    scriptTag(String(opts.socketio || "").replace(/\/\/# sourceMappingURL=\S*/g, "")),
    scriptTag(String(opts.runtime || "")),
  ]
    .filter(Boolean)
    .join("\n");

  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">',
    "<title>" + escapeHtml(title) + "</title>",
    styleTag([RESET_CSS].concat(styles).join("\n")),
    styleTag(projectCss),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    "<!doctype html>\n" +
    // Everything the markup was scanned for is known by now, so the header
    // can name what was left out.
    header(connection, opts.oscarVersion, readAsset && readAsset.linked) +
    '\n<html lang="en">\n<head>\n' +
    head +
    "\n</head>\n" +
    composeBody(markup, tail) +
    "\n</html>\n"
  );
}

module.exports = {
  buildDocument,
  composeBody,
  inlineHtmlAssets,
  inlineCssAssets,
  guardClosingTag,
  embedJson,
};
