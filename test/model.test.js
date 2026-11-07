"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const M = require("../src/model.js");

const example = fs.readFileSync(path.join(__dirname, "../examples/bookmarks.md"), "utf8");

test("round-trips the example file exactly", () => {
  assert.equal(M.serialize(M.parse(example).model), example);
});

test("parses folders, entries, descriptions and tags", () => {
  const { model, warnings } = M.parse(example);
  assert.deepEqual(warnings, []);
  assert.equal(model.title, "Example bookmarks");
  assert.equal(model.root.entries[0].name, "GitHub");
  const testing = M.findFolder(model, ["Development", "JavaScript", "Testing"]);
  assert.equal(testing.entries[0].url, "https://nodejs.org/api/test.html");
  assert.deepEqual(testing.entries[0].tags, ["js", "node", "testing"]);
  const spain = M.findFolder(model, ["Travel", "Spain"]).entries[0];
  assert.equal(spain.description, "Official guide\nMulti-line descriptions continue\non indented lines like these.");
  const wiki = M.allEntries(model).find((x) => x.entry.name.startsWith("Wikipedia: "));
  assert.equal(wiki.entry.url, "https://en.wikipedia.org/wiki/Markdown_(disambiguation)");
});

test("normalizes loose input into the canonical form", () => {
  const messy = "# A\n* [x](https://x.io) - desc\n    tags: a, #b\n### Deep\n- [y](https://y.io)\n# A\n- [z](https://z.io)\n";
  const { model, warnings } = M.parse(messy);
  assert.equal(warnings.length, 2); // skipped level, duplicate folder merged
  assert.equal(M.serialize(model),
    "# A\n\n- [x](https://x.io) — desc\n  tags: #a #b\n- [z](https://z.io)\n\n## Deep\n\n- [y](https://y.io)\n");
});

test("escapes brackets in names and keeps unknown lines as notes", () => {
  const model = M.emptyModel("T");
  M.addEntry(model, [], { name: "a [b] c", url: "https://a.b" });
  const md = M.serialize(model);
  assert.match(md, /\[a \\\[b\\\] c\]/);
  assert.equal(M.parse(md).model.root.entries[0].name, "a [b] c");
  const withNote = "# F\n\nSome free text\n- [a](https://a.io)\n";
  const p = M.parse(withNote);
  assert.equal(p.warnings.length, 1);
  assert.equal(M.serialize(p.model), "# F\n\nSome free text\n\n- [a](https://a.io)\n");
});

test("add, update, move and delete entries", () => {
  const { model } = M.parse(example);
  const e = M.addEntry(model, ["New", "Sub"], { url: "https://n.io", name: " New  one ", tags: "#x, y x" });
  assert.equal(e.name, "New one");
  assert.deepEqual(e.tags, ["x", "y"]);
  assert.ok(M.findFolder(model, ["New", "Sub"]));
  M.updateEntry(model, e.id, { description: "d" }, ["Reading"]);
  assert.equal(M.locate(model, e.id).path.join("/"), "Reading");
  assert.equal(M.locate(model, e.id).entry.description, "d");
  M.updateEntry(model, e.id, {}, []);
  assert.equal(M.locate(model, e.id).path.length, 0);
  assert.ok(M.deleteEntry(model, e.id));
  assert.equal(M.locate(model, e.id), null);
});

test("folder rename merges, move refuses cycles, delete removes contents", () => {
  const { model } = M.parse(example);
  const before = M.allEntries(model).length;
  M.renameFolder(model, ["Reading"], "Development");
  assert.equal(M.findFolder(model, ["Reading"]), null);
  assert.ok(M.findFolder(model, ["Development", "Polish"]));
  assert.equal(M.allEntries(model).length, before);
  assert.equal(M.moveFolder(model, ["Development"], ["Development", "JavaScript"]), null);
  M.moveFolder(model, ["Travel", "Spain"], []);
  assert.ok(M.findFolder(model, ["Spain"]));
  M.deleteFolder(model, ["Development"]);
  assert.equal(M.findFolder(model, ["Development"]), null);
});

test("refuses folders deeper than Markdown headings allow", () => {
  const model = M.emptyModel();
  M.addFolder(model, ["1", "2", "3", "4", "5", "6"]);
  assert.throws(() => M.addFolder(model, ["1", "2", "3", "4", "5", "6", "7"]));
  M.addFolder(model, ["a", "b"]);
  assert.throws(() => M.moveFolder(model, ["a"], ["1", "2", "3", "4", "5"]));
});

test("validate reports bad and duplicate URLs", () => {
  const { errors, warnings } = M.validate("- [a](notaurl)\n- [b](https://b.io)\n# F\n- [c](https://b.io)\n");
  assert.equal(errors.length, 1);
  assert.match(warnings[0], /duplicate URL/);
});

test("front matter: title is read, other fields are kept as written", () => {
  const src = "---\ncreated: 2026-11-07T14:08:10+0100\ntags:\n  - daily_note\nweek: 45 \nday: Saturday\ntitle: 'It''s mine'\n---\n\n# A\n\n- [x](https://x.io)\n";
  const { model, warnings } = M.parse(src);
  assert.deepEqual(warnings, []);
  assert.equal(model.title, "It's mine");
  assert.equal(M.serialize(model), src);
  assert.equal(M.allEntries(model).length, 1);
  model.title = "Work: links";
  const out = M.serialize(model);
  assert.match(out, /\nday: Saturday\ntitle: "Work: links"\n---\n/);
  assert.equal(M.parse(out).model.title, "Work: links");
});

test("front matter: the old <!-- title --> comment is read and written as front matter", () => {
  const { model } = M.parse("<!-- title: Old style -->\n\n- [x](https://x.io)\n");
  assert.equal(model.title, "Old style");
  assert.equal(M.serialize(model), "---\ntitle: Old style\n---\n\n- [x](https://x.io)\n");
});

test("front matter: a lone --- without a closing line is not front matter", () => {
  const { model } = M.parse("---\n- [x](https://x.io)\n");
  assert.equal(model.meta.length, 0);
  assert.equal(M.allEntries(model).length, 1);
});

test("createdNow formats local time with its offset", () => {
  assert.match(M.createdNow(new Date(2026, 10, 7, 14, 8, 10)), /^2026-11-07T14:08:10[+-]\d{4}$/);
});
