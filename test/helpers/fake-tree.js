"use strict";

/**
 * A fake element that can have children, for a widget that builds the
 * elements inside itself (ownsChildren in lib/widgets/index.js).
 *
 * fakeElement in fake-dom.js is a leaf, which is all a button or a slider
 * needs. This wraps it, so everything a test already does with a fake
 * element -- fire, wipe, snapshot -- works on the root and on every node the
 * widget creates. Deliberately there is no innerHTML here: a widget that
 * reached for it would find nothing, and its test would fail.
 */

const { fakeElement } = require("./fake-dom");

function fakeNode(doc, tag) {
  const node = fakeElement();
  node.tagName = String(tag || "div").toUpperCase();
  node.ownerDocument = doc;
  node.children = [];
  node.parentNode = null;
  node.textContent = "";
  node.appendChild = function (child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = node;
    node.children.push(child);
    return child;
  };
  node.removeChild = function (child) {
    node.children = node.children.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  };
  return node;
}

/** A document that only knows how to make elements, and counts what it made. */
function fakeDocument() {
  const doc = {
    created: [],
    createElement(tag) {
      const node = fakeNode(doc, tag);
      doc.created.push(node);
      return node;
    },
  };
  return doc;
}

/** A root element in a document of its own, as a canvas iframe's would be. */
function fakeRoot(tag) {
  return fakeNode(fakeDocument(), tag);
}

module.exports = { fakeRoot, fakeDocument };
