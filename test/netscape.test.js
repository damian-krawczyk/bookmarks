"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/model.js");
const N = require("../src/netscape.js");

const CHROME = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://a.io/" ADD_DATE="1">A &amp; B</A>
        <DT><H3>Dev</H3>
        <DL><p>
            <DT><A HREF="https://mdn.io/" TAGS="docs,web">MDN</A>
            <DD>Web docs
            <DT><A HREF="javascript:alert(1)">Bookmarklet</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://top.io/">Top</A>
</DL><p>`;

test("imports a Chrome/Firefox export", () => {
  const { model, skipped } = N.parse(CHROME);
  assert.equal(skipped, 1);
  assert.equal(model.root.entries[0].name, "Top");
  const bar = M.findFolder(model, ["Bookmarks bar"]);
  assert.equal(bar.entries[0].name, "A & B");
  const mdn = M.findFolder(model, ["Bookmarks bar", "Dev"]).entries[0];
  assert.deepEqual(mdn.tags, ["docs", "web"]);
  assert.equal(mdn.description, "Web docs");
});

test("merges without duplicates, optionally under a folder", () => {
  const dest = M.parse("- [Top](https://top.io/)\n").model;
  const r = N.merge(dest, N.parse(CHROME).model, ["Imported"]);
  assert.deepEqual(r, { added: 2, duplicates: 1 });
  assert.ok(M.findFolder(dest, ["Imported", "Bookmarks bar", "Dev"]));
});

test("export → import keeps everything", () => {
  const src = M.parse("- [x <y>](https://x.io/?a=1&b=2) — d\n  tags: #t\n# F\n## G\n- [g](https://g.io)\n").model;
  const back = N.parse(N.serialize(src)).model;
  const strip = (m) => M.allEntries(m).map(({ entry, path }) => [path.join("/"), entry.name, entry.url, entry.description, entry.tags]);
  assert.deepEqual(strip(back), strip(src));
});
