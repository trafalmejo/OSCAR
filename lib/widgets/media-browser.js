"use strict";

const { field, enabled, oscFields, connectionChecks } = require("./fields");
const { outgoing, routing } = require("./outgoing");
const { follow } = require("./incoming");
const { share, onShared } = require("./shared");
const { refusal, checkArgType } = require("./typed");
const { ARG_TYPES, toArgs, toNumber } = require("../osc-args");

const TILE_CLASS = "oscar-media-tile";
const THUMB_CLASS = "oscar-media-thumb";
const LABEL_CLASS = "oscar-media-label";

/** On the tile that is picked. Styled in public/assets/css/toggle.css. */
const SELECTED_CLASS = "oscar-media-selected";

/** The custom property the grid reads its column count from. */
const COLUMNS_PROPERTY = "--oscar-media-columns";

const MAX_COLUMNS = 12;

/**
 * What a tile can send: a clip index or a clip name, which is how Resolume,
 * Millumin and QLab address a cue. Bool and "no argument" carry no identity
 * -- every tile would send the same message, and the grid would be a row of
 * identical buttons wearing different pictures.
 */
const ITEM_ARG_TYPES = ARG_TYPES.filter(function (type) {
  return type.id === "i" || type.id === "f" || type.id === "s";
});

/**
 * Turn the designer's one line into tiles.
 *
 *   Forest; Waves; Stars                     each sends its position: 1, 2, 3
 *   Forest|7; Waves|12                       label|value
 *   Forest|7|thumbs/forest.jpg; Waves|12     label|value|imageUrl
 *
 * Semicolons, because every setting in the panel is a single-line control and
 * a newline can never be typed into one; newlines are accepted as well, so a
 * project file written by hand or by a script can read the way a list should.
 * The price is that a label cannot hold ";" or "|".
 *
 * An omitted value is the tile's 1-based position among the tiles, which is
 * how a clip grid is addressed; the common case is the one with least typing.
 *
 * A data: URL holds semicolons of its own ("data:image/png;base64,..."), so
 * an image that starts with data: is not finished until its comma, and the
 * pieces the split made of it are put back together. Only pieces that can be
 * part of one, though: a piece with a "|" in it is the next item, and a data:
 * URL whose comma never comes is a typing mistake. It keeps what it had and
 * the items after it stay tiles -- safeImageUrl refuses it, so the panel says
 * what is wrong instead of the rest of the grid quietly vanishing.
 *
 * An entry with neither label nor image is dropped: it would draw an empty
 * square that launches something when touched.
 */
function parseItems(raw) {
  const pieces = String(raw === null || raw === undefined ? "" : raw).split(/[;\r\n]/);
  const items = [];
  for (let i = 0; i < pieces.length; i++) {
    let piece = pieces[i];
    if (unfinishedDataUrl(piece)) {
      let joined = piece;
      let end = i;
      while (unfinishedDataUrl(joined) && end + 1 < pieces.length && pieces[end + 1].indexOf("|") === -1) {
        joined += ";" + pieces[++end];
      }
      if (!unfinishedDataUrl(joined)) {
        piece = joined;
        i = end;
      }
    }

    const parts = piece.split("|").map(function (part) {
      return part.trim();
    });
    const label = parts[0] || "";
    const image = parts.length > 2 ? parts.slice(2).join("|").trim() : "";
    if (!label && !image) continue;
    const value = parts.length > 1 && parts[1] !== "" ? parts[1] : String(items.length + 1);
    items.push({ label: label, value: value, image: image });
  }
  return items;
}

function unfinishedDataUrl(piece) {
  const image = piece.split("|").slice(2).join("|").trim();
  return /^data:/i.test(image) && image.indexOf(",") === -1;
}

/**
 * The URL as it may be given to an <img>, or "" for one that may not.
 *
 * The URL is typed by a person, or arrives in a project someone else made,
 * and the surface runs on the machine that drives the rig. So this is an
 * allowlist and not a list of known-bad schemes: no scheme at all (a path
 * next to the page), http, https, or an image held in a data: URL. That
 * refuses javascript:, vbscript:, data:text/html and whatever scheme comes
 * next. Browsers skip tabs, newlines and other control characters when they
 * read a scheme, so "java\tscript:" is judged with them taken out.
 *
 * A data: URL with no comma has no image in it. It is refused so that the
 * panel names it; see parseItems for how one comes about.
 */
function safeImageUrl(raw) {
  const url = String(raw === null || raw === undefined ? "" : raw).trim();
  if (!url) return "";
  const bare = url.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(bare);
  if (!scheme) return url;
  const name = scheme[1].toLowerCase();
  if (name === "http" || name === "https") return url;
  if (name === "data" && /^data:image\//i.test(bare) && bare.indexOf(",") !== -1) return url;
  return "";
}

/**
 * What a tile's value is once it is on the wire, as a key, or null for a
 * value the type cannot carry.
 *
 * Not the text the designer typed: "07" and "7" are one int, "1.4" and "1"
 * are one int because ints are rounded, and "1.0" and "1" are one float. The
 * rig only ever sees, and only ever echoes, the wire value.
 */
function wireKey(argType, value) {
  const args = toArgs(argType, value);
  if (!args || !args.length) return null;
  return args[0].type + ":" + String(args[0].value);
}

/** The number a tile puts on the wire, or null for a string or an unsendable one. */
function wireNumber(argType, value) {
  const args = toArgs(argType, value);
  if (!args || !args.length || typeof args[0].value !== "number") return null;
  return args[0].value;
}

/**
 * OSC media browser: a grid of thumbnails, and one tap picks one.
 *
 * The need it answers is an operator with a tablet choosing what plays in a
 * room -- browsing pictures, not remembering that the forest loop is clip 7.
 * A pick sends the tile's value to Message, which is the message a clip
 * launcher already listens for.
 *
 * It is a chooser and not a media library: it shows images the designer
 * points it at. It does not upload, store or play anything.
 *
 * A tile is picked on click and not on pointerdown, because the grid scrolls:
 * a finger that lands on a tile to push the list along must not launch
 * whatever it landed on, and a browser only raises click for a touch that
 * did not turn into a scroll. Picking the tile that is already picked sends
 * again -- relaunching a clip is a real instruction, not a repeat to swallow.
 *
 * With Listen on, a value arriving at Message moves the highlight to the tile
 * that sends it, and nothing goes out. A value no tile sends changes
 * nothing: the address may carry more than this grid knows about. The same
 * browser on another device is followed the same way, Listen or not:
 * { value }, the picked tile's value as text.
 *
 * The highlight is not a setting and is never saved: what is playing is the
 * rig's to say, and a project that reopened claiming clip 3 would be
 * guessing. A device that joins late is told by the others.
 */
const mediaBrowser = {
  name: "oscar-media-browser",
  tag: "div",
  attributes: { class: "oscar-media-browser" },
  // The tiles are built here from Items, never stored: see ownsChildren in
  // the adapter.
  ownsChildren: true,

  sends: true,
  receives: true,
  dmx: false,

  block: {
    label: "Media Browser",
    category: "IO Widgets",
    icon:
      '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" ' +
      'd="M3,3H11V11H3V3M13,3H21V11H13V3M3,13H11V21H3V13M13,13H21V21H13V13M15,15V19H19V15H15Z"/></svg>',
  },

  defaults: {
    enabled: true,
    oscEnabled: true,
    ip: "localhost",
    port: 7000,
    message: "/clip",
    listen: false,
    items: "Clip 1; Clip 2; Clip 3; Clip 4; Clip 5; Clip 6",
    columns: 3,
    showLabels: true,
    argType: "i",
  },

  fields: [enabled()]
    .concat(oscFields())
    .concat([
    field("items", "Items", "text", { placeholder: "Forest|7|thumbs/forest.jpg; Waves|12" }),
    field("columns", "Columns", "number", { min: 1, max: MAX_COLUMNS, step: 1 }),
    field("showLabels", "Show labels", "checkbox"),
    field("argType", "Argument type", "select", { section: "osc", options: ITEM_ARG_TYPES }),
  ]),

  checks: Object.assign({}, connectionChecks(), {
    items: checkItems,
    columns: checkColumns,
    argType: checkArgType(function (config) {
      return parseItems(config.items).map(function (item) {
        return item.value;
      });
    }),
  }),

  /**
   * Export: a thumbnail given as a path is a file next to OSCAR, and an
   * exported page leaves OSCAR behind. `read` hands back a data: URI for a
   * path it can embed, and the items line is rewritten around those. Returns
   * the settings that changed, or null when none did.
   */
  embed: function (config, read) {
    let embedded = false;
    const line = parseItems(config.items)
      .map(function (item) {
        const uri = item.image && safeImageUrl(item.image) ? read(item.image) : null;
        if (uri) embedded = true;
        const image = uri || item.image;
        return item.label + "|" + item.value + (image ? "|" + image : "");
      })
      .join("; ");
    return embedded ? { items: line } : null;
  },

  attach: function (el, ctx) {
    // The element's own document: the canvas is an iframe, and a node made
    // by the outer page belongs to the wrong tree. A host with no document
    // gets no tiles and a widget that still attaches and detaches.
    const doc = el.ownerDocument || null;

    /** Every tile on the element, as { node, item }; nothing else is ever touched. */
    let tiles = [];
    /** The picked tile's value, or null while nothing is picked. */
    let selected = null;

    function paint() {
      el.style.setProperty(COLUMNS_PROPERTY, String(columnsOf(ctx.get("columns"))));
      for (const tile of tiles) {
        const on = tile.item.value === selected;
        if (on) tile.node.classList.add(SELECTED_CLASS);
        else tile.node.classList.remove(SELECTED_CLASS);
        tile.node.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }

    function clear() {
      for (const tile of tiles) {
        tile.node.removeEventListener("click", tile.onClick);
        if (tile.node.parentNode === el) el.removeChild(tile.node);
      }
      tiles = [];
    }

    /**
     * Build the tiles from Items.
     *
     * With createElement, textContent and setAttribute, and never as a
     * string of markup: a label or a URL is typed by a person, or comes in a
     * project somebody else made, and markup assembled from it is a way to
     * run script on the machine that drives the rig.
     */
    function build() {
      clear();
      if (doc && typeof doc.createElement === "function") {
        const showLabels = ctx.get("showLabels") !== false;
        tiles = parseItems(ctx.get("items")).map(function (item) {
          return makeTile(item, showLabels);
        });
        for (const tile of tiles) el.appendChild(tile.node);
      }
      // A highlight on a value the new list does not offer is on nothing.
      if (selected !== null && !find(selected)) selected = null;
      paint();
    }

    function makeTile(item, showLabels) {
      const node = doc.createElement("button");
      // Inside a form, a bare button submits and reloads the surface mid-show.
      node.setAttribute("type", "button");
      node.setAttribute("class", TILE_CLASS);
      node.setAttribute("title", item.label || item.value);

      const url = safeImageUrl(item.image);
      let label = null;
      function addLabel() {
        if (label) return;
        label = doc.createElement("span");
        label.setAttribute("class", LABEL_CLASS);
        label.textContent = item.label || item.value;
        node.appendChild(label);
      }

      if (url) {
        const img = doc.createElement("img");
        img.setAttribute("class", THUMB_CLASS);
        img.setAttribute("alt", item.label);
        // A browser drags an image by default. In the editor that drag can be
        // dropped on the canvas as a new component, which is the tile leaving
        // the widget; on a tablet it is a ghost image under a scrolling finger.
        img.setAttribute("draggable", "false");
        // A thumbnail that did not load must not leave a blank tile nobody
        // can tell from its neighbour: the name takes its place.
        img.addEventListener("error", function () {
          if (img.parentNode === node) node.removeChild(img);
          addLabel();
        });
        img.setAttribute("src", url);
        node.appendChild(img);
      }
      // Labels can be switched off for a wall of pictures, but a tile with no
      // picture keeps its name, or it is a blank square.
      if (showLabels || !url) addLabel();

      const tile = {
        node: node,
        item: item,
        onClick: function () {
          pick(item);
        },
      };
      node.addEventListener("click", tile.onClick);
      return tile;
    }

    function find(value) {
      for (const tile of tiles) if (tile.item.value === value) return tile;
      return null;
    }

    /**
     * The tile a value from outside means. As text first, so the 3 an int
     * tile comes back as finds "Forest|3"; then as numbers, so a float rig
     * answering 3.0 to a tile written "3.00" still finds it. toNumber gives
     * null for anything unreadable, and null matches nothing -- a blank or a
     * word is never read as tile 0.
     */
    function match(value) {
      if (value === null || value === undefined || typeof value === "object" || typeof value === "boolean") return null;
      const text = String(value).trim();
      const exact = find(text);
      if (exact) return exact;
      const number = toNumber(value);
      if (number === null) return null;
      for (const tile of tiles) if (toNumber(tile.item.value) === number) return tile;
      // Last, against what the tile really sends: an int tile written "1.4"
      // sends 1, and the rig answering 1 means that tile.
      const argType = ctx.get("argType");
      for (const tile of tiles) if (wireNumber(argType, tile.item.value) === number) return tile;
      return null;
    }

    /** A hand picked this tile: the one path that sends. */
    function pick(item) {
      // A disabled browser is being laid out, and a highlight that moved
      // while nothing went out would show a clip that is not playing.
      if (!ctx.get("enabled")) return;
      // The same goes for a value the argument type cannot carry (the panel
      // refuses one; a project edited by hand can hold one). Nothing goes
      // out, so nothing is highlighted, here or on any other device.
      const message = outgoing(routing(ctx), item.value);
      if (!message) return;
      selected = item.value;
      paint();
      ctx.send(message);
      share(ctx, { value: item.value });
    }

    /** Show a pick made elsewhere. Through paint(), never pick(). */
    function take(value) {
      const tile = match(value);
      if (!tile) return false;
      selected = tile.item.value;
      paint();
      return true;
    }

    /** The rig said what is playing; every device heard it, so it is only recorded. */
    function adopt(values) {
      if (take(values[0])) share(ctx, { value: selected }, { heard: true });
    }

    /** Another device picked. Never shared again: it came from there. */
    function adoptShared(state) {
      if (state) take(state.value);
    }

    build();

    const stop = ctx.onChange(["items", "showLabels"], build);
    const stopColumns = ctx.onChange(["columns"], paint);
    // The column count sits on the element as an inline property, which the
    // host wipes whenever it rewrites the element.
    const stopRewrite = ctx.onRewrite ? ctx.onRewrite(paint) : null;
    const stopOsc = follow(ctx, adopt);
    const stopShared = onShared(ctx, adoptShared);

    return function detach() {
      clear();
      if (stop) stop();
      if (stopColumns) stopColumns();
      if (stopRewrite) stopRewrite();
      if (stopOsc) stopOsc();
      if (stopShared) stopShared();
    };
  },
};

/**
 * How many columns to draw. Anything unreadable falls back to the default
 * and is never read as 0: a grid of no columns is a widget that vanished.
 */
function columnsOf(value) {
  const number = toNumber(value);
  if (number === null) return mediaBrowser.defaults.columns;
  return Math.min(MAX_COLUMNS, Math.max(1, Math.round(number)));
}

/**
 * Every tile has to be sendable, and there has to be one.
 *
 * Two tiles may not send the same value: the value is all that comes back
 * from the rig or from another tablet, so the highlight could not tell them
 * apart. "The same" is judged on the wire, not as typed -- see wireKey. And an image URL that will be refused is said here, where the
 * designer typed it, not left as a tile that mysteriously has no picture.
 */
function checkItems(raw, config) {
  const items = parseItems(raw);
  if (!items.length) return "List the items like: Forest|7|thumbs/forest.jpg; Waves|12";
  const argType = (config && config.argType) || "i";
  const seen = {};
  for (const item of items) {
    const complaint = refusal(argType, item.value);
    if (complaint) return complaint;
    const key = wireKey(argType, item.value);
    if (seen[key]) return 'Two items send "' + seen[key].sent + '"; each item needs its own value';
    seen[key] = { sent: String(toArgs(argType, item.value)[0].value) };
    if (item.image && !safeImageUrl(item.image)) {
      return 'The image for "' + (item.label || item.value) + '" has to be a path, an http(s) address or a data:image URL';
    }
  }
  return null;
}

function checkColumns(value) {
  const number = toNumber(value);
  if (number === null || number !== Math.round(number) || number < 1 || number > MAX_COLUMNS) {
    return "Columns has to be a whole number from 1 to " + MAX_COLUMNS;
  }
  return null;
}

module.exports = {
  mediaBrowser,
  parseItems,
  safeImageUrl,
  ITEM_ARG_TYPES,
  TILE_CLASS,
  SELECTED_CLASS,
  COLUMNS_PROPERTY,
};
