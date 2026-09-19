"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { formatSize, sortProjects, nextSort, DEFAULT_SORT } = require("../lib/projects-table");

const names = (rows) => rows.map((r) => r.name);

test("sizes read at a glance, and unusable ones show blank rather than 0", () => {
  assert.strictEqual(formatSize(0), "0 B");
  assert.strictEqual(formatSize(512), "512 B");
  assert.strictEqual(formatSize(4440), "4 KB");
  assert.strictEqual(formatSize(3.5 * 1024 * 1024), "3.5 MB");
  for (const bad of [null, undefined, "", "4440", NaN, -1, Infinity]) {
    assert.strictEqual(formatSize(bad), "", JSON.stringify(bad));
  }
});

test("names sort A to Z ignoring case, and numbers inside names sort as numbers", () => {
  const rows = [{ name: "stage 10" }, { name: "Bar" }, { name: "stage 2" }, { name: "apple" }];
  assert.deepStrictEqual(names(sortProjects(rows, "name", "ascending")), ["apple", "Bar", "stage 2", "stage 10"]);
});

test("sizes sort by value, not as text", () => {
  const rows = [{ name: "a", size: 900 }, { name: "b", size: 10000 }, { name: "c", size: 20 }];
  assert.deepStrictEqual(names(sortProjects(rows, "size", "descending")), ["b", "a", "c"]);
});

test("ISO dates sort in time order", () => {
  const rows = [
    { name: "a", date: "2026-01-09" },
    { name: "b", date: "2026-09-15" },
    { name: "c", date: "2025-12-31" },
  ];
  assert.deepStrictEqual(names(sortProjects(rows, "date", "descending")), ["b", "a", "c"]);
});

test("a row missing the value goes last in both directions", () => {
  // A project with no date is not the newest one.
  const rows = [{ name: "none" }, { name: "old", date: "2020-01-01" }, { name: "new", date: "2026-01-01" }];
  assert.deepStrictEqual(names(sortProjects(rows, "date", "descending")), ["new", "old", "none"]);
  assert.deepStrictEqual(names(sortProjects(rows, "date", "ascending")), ["old", "new", "none"]);
});

test("equal values keep the order the server sent", () => {
  const rows = [{ name: "first", size: 1 }, { name: "second", size: 1 }, { name: "third", size: 1 }];
  assert.deepStrictEqual(names(sortProjects(rows, "size", "descending")), ["first", "second", "third"]);
});

test("sorting never changes the array it was given", () => {
  const rows = [{ name: "b" }, { name: "a" }];
  sortProjects(rows, "name", "ascending");
  assert.deepStrictEqual(names(rows), ["b", "a"]);
  assert.deepStrictEqual(sortProjects(null, "name", "ascending"), []);
});

test("a header flips its own column, and a new column starts where people look first", () => {
  assert.deepStrictEqual(nextSort({ key: "name", direction: "ascending" }, "name"), { key: "name", direction: "descending" });
  assert.deepStrictEqual(nextSort({ key: "name", direction: "descending" }, "name"), { key: "name", direction: "ascending" });
  assert.deepStrictEqual(nextSort(DEFAULT_SORT, "name"), { key: "name", direction: "ascending" });
  assert.deepStrictEqual(nextSort({ key: "name", direction: "ascending" }, "size"), { key: "size", direction: "descending" });
  assert.deepStrictEqual(DEFAULT_SORT, { key: "date", direction: "descending" });
});

test("templates stay on top whatever the sort, and only Load shows them", () => {
  const { orderProjects } = require("../lib/projects-table");
  const rows = [
    { _id: "b", name: "B", date: "2026-01-01" },
    { _id: "t", name: "Template", template: true },
    { _id: "a", name: "A", date: "2026-02-01" },
  ];
  assert.deepStrictEqual(names(orderProjects(rows, "name", "descending", true)), ["Template", "B", "A"]);
  assert.deepStrictEqual(names(orderProjects(rows, "date", "descending", true)), ["Template", "A", "B"]);
  assert.deepStrictEqual(names(orderProjects(rows, "name", "ascending", false)), ["A", "B"]);
  assert.deepStrictEqual(orderProjects(null, "name", "ascending", true), []);
});
