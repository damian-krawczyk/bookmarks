"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { renderHtml } = require("../bin/bookmarks.js");

test("the built page inlines everything and escapes data safely", () => {
  const markdown = "- [</script><script>alert(1)</script>](https://x.io) — /*{{SCRIPTS}}*/\n";
  const html = renderHtml({ markdown, title: "<T>", config: { readOnly: true } });
  assert.match(html, /<title>&lt;T&gt;<\/title>/);
  assert.ok(!html.includes("</script><script>alert(1)"));
  assert.ok(!/\{\{(CSS|DATA|SCRIPTS|TITLE)\}\}\*\/<\/script>/.test(html.replace("/*{{SCRIPTS}}*/\\n", "")));
  assert.match(html, /window\.BOOKMARKS_DATA = /);
  assert.match(html, /d3js\.org/);
  assert.equal((html.match(/<script>/g) || []).length, 3);
});
