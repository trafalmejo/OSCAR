"use strict";

/**
 * The styles a surface can wear, and what switching between them involves.
 *
 * A style is a set of token values (--osc-*) in public/assets/css/styles/<id>.css,
 * light and dark, converted from a tweakcn preset. The widgets in toggle.css
 * draw only from those tokens, so a style never touches a widget rule.
 *
 * A surface records its choice as two attributes on its body, which travel with
 * the project to the preview and every tablet:
 *   data-osc-style="<id>"   data-osc-appearance="light" | "dark"
 *
 * Adding a style: its file in styles/, one entry below, and the font package
 * if it needs one that is not bundled yet.
 */

const STYLES = [
  { id: "default", label: "Default", fonts: [] },
  { id: "amber-minimal", label: "Amber Minimal", fonts: ["inter"] },
  { id: "cyberpunk", label: "Cyberpunk", fonts: ["outfit"] },
  { id: "supabase", label: "Supabase", fonts: ["outfit"] },
  { id: "tangerine", label: "Tangerine", fonts: ["inter"] },
];

const APPEARANCES = ["light", "dark"];

const DEFAULT_STYLE = "default";
const DEFAULT_APPEARANCE = "light";

const STYLE_ATTRIBUTE = "data-osc-style";
const APPEARANCE_ATTRIBUTE = "data-osc-appearance";

function isStyle(id) {
  return STYLES.some((style) => style.id === id);
}

function isAppearance(value) {
  return APPEARANCES.indexOf(value) !== -1;
}

/**
 * What the canvas has to load, in order: fonts, then every style's tokens,
 * then the widgets that draw with them. Fonts are bundled locally -- OSCAR
 * runs at venues with no internet.
 */
function canvasStylesheets() {
  const fonts = [];
  STYLES.forEach((style) => {
    style.fonts.forEach((font) => {
      if (fonts.indexOf(font) === -1) fonts.push(font);
    });
  });

  return fonts
    .map((font) => "node_modules/@fontsource-variable/" + font + "/index.css")
    .concat(STYLES.map((style) => "assets/css/styles/" + style.id + ".css"))
    .concat(["assets/css/toggle.css"]);
}

/**
 * The surface itself follows the style: its background, text colour and font.
 *
 * This cannot live in a layer like everything else. The canvas paints its body
 * white with an unlayered rule of its own, and a layered rule always loses to
 * that. So it is given to GrapesJS as protectedCss, which comes after that
 * rule; an edit made to the Body in the Style Manager is an id rule and still
 * wins over it. The first two rules are GrapesJS's own default protectedCss,
 * kept because setting the option replaces them.
 */
const SURFACE_CSS =
  "* { box-sizing: border-box; } body { margin: 0; } " +
  // The style attributes live on GrapesJS's wrapper element, which is what gets
  // saved; they are copied onto the body too (see copyToBody), so both paint.
  "body, [data-osc-style] { background-color: var(--osc-background); color: var(--osc-foreground); " +
  "font-family: var(--osc-font); letter-spacing: var(--osc-letter-spacing); }";

/**
 * The properties that make up how a widget looks, as opposed to where it is.
 *
 * "Reset to style" removes these from a widget's own styling so it follows the
 * surface's style again, and leaves position, size and spacing alone: undoing
 * someone's layout to reset a colour would be a nasty surprise.
 */
const APPEARANCE_PROPERTY = /^(background|color$|border|outline|box-shadow|text-shadow|font|letter-spacing|line-height|text-|opacity$|--osc-)/;

function isAppearanceProperty(name) {
  return APPEARANCE_PROPERTY.test(String(name));
}

/** A widget's own styling with the appearance taken out and the layout kept. */
function withoutAppearance(style) {
  const kept = {};
  Object.keys(style || {}).forEach((name) => {
    if (!isAppearanceProperty(name)) kept[name] = style[name];
  });
  return kept;
}

/**
 * Copy a surface's style from its saved attributes onto another element --
 * the canvas body. GrapesJS keeps the attributes on its wrapper element and
 * never saves the body, so the body has to be told again whenever the canvas
 * loads, a project loads, or the style changes. A surface with no style takes
 * the attributes off, so the body falls back to the default style.
 */
function copyToBody(attributes, body) {
  [STYLE_ATTRIBUTE, APPEARANCE_ATTRIBUTE].forEach((name) => {
    const value = attributes && attributes[name];
    if (value) body.setAttribute(name, value);
    else body.removeAttribute(name);
  });
}

/**
 * Which components get "Reset to style": OSCAR's widgets, and the surface
 * itself (GrapesJS's wrapper, shown as Body), whose background follows the
 * style the same way a widget's colours do.
 */
function offersReset(type) {
  return type === "wrapper" || /^oscar-/.test(String(type || ""));
}

module.exports = {
  copyToBody,
  offersReset,
  STYLES,
  APPEARANCES,
  DEFAULT_STYLE,
  DEFAULT_APPEARANCE,
  STYLE_ATTRIBUTE,
  APPEARANCE_ATTRIBUTE,
  SURFACE_CSS,
  isStyle,
  isAppearance,
  canvasStylesheets,
  isAppearanceProperty,
  withoutAppearance,
};
