"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const I18n = require("../src/i18n.js");

const dir = path.join(__dirname, "../src/locales");
const locales = Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
  .map((f) => [path.basename(f, ".json"), JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))]));

test("every language has the same keys as English", () => {
  const en = I18n.baseKeys(locales.en);
  for (const [code, dict] of Object.entries(locales)) {
    const keys = I18n.baseKeys(dict);
    assert.deepEqual([...en].filter((k) => !keys.has(k)), [], `${code} is missing keys`);
    assert.deepEqual([...keys].filter((k) => !en.has(k)), [], `${code} has extra keys`);
  }
});

test("every plural key has an .other form", () => {
  for (const [code, dict] of Object.entries(locales)) {
    for (const k of Object.keys(dict)) {
      const m = /^(.*)\.(zero|one|two|few|many)$/.exec(k);
      if (m) assert.ok(dict[`${m[1]}.other`], `${code}: ${m[1]}.other`);
    }
  }
});

test("translates with placeholders and plural rules", () => {
  const i = I18n.create(locales);
  i.setLang("pl");
  assert.equal(i.t("count.bookmarks", { count: 1 }), "1 zakładka");
  assert.equal(i.t("count.bookmarks", { count: 3 }), "3 zakładki");
  assert.equal(i.t("count.bookmarks", { count: 5 }), "5 zakładek");
  i.setLang("en");
  assert.equal(i.t("count.bookmarks", { count: 2 }), "2 bookmarks");
  assert.equal(i.t("list.noMatches", { query: "x" }), "Nothing matches “x”.");
  assert.equal(i.t("no.such.key"), "no.such.key");
});

test("picks the language from browser preferences", () => {
  const i = I18n.create(locales);
  assert.equal(i.pick(["es-MX", "en"]), "es");
  assert.equal(i.pick(["de-DE"]), "en");
  assert.equal(i.pick(["pl"]), "pl");
});
