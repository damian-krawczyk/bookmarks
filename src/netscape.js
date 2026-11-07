// Browser bookmark files (the "Netscape bookmark file" HTML that Chrome, Firefox,
// Safari and Edge all export and import) ⇄ the bookmarks model.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./model.js"));
  else root.Netscape = factory(root.BookmarksModel);
})(typeof self !== "undefined" ? self : this, function (Model) {
  "use strict";

  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
  const decode = (s) =>
    String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  const encode = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const stripTags = (s) => decode(String(s).replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  const attr = (attrs, name) => {
    const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
    return m ? decode(m[2] ?? m[3] ?? m[4]) : "";
  };

  // Parse an exported file into a fresh model. Folders keep the browser's names
  // ("Bookmarks bar", "Other bookmarks"…); bookmarklets and javascript: links are skipped.
  function parse(html) {
    const model = Model.emptyModel();
    const tokens = /<DT>\s*<H3([^>]*)>([\s\S]*?)<\/H3>|<DT>\s*<A([^>]*)>([\s\S]*?)<\/A>|<DD>([^<]*)|<DL[^>]*>|<\/DL>/gi;
    const stack = [model.root];
    let pendingFolder = null;
    let last = null;
    let skipped = 0;
    let m;
    while ((m = tokens.exec(html))) {
      const tok = m[0].slice(0, 4).toUpperCase();
      if (m[1] !== undefined) {
        const name = Model.cleanFolderName(stripTags(m[2])) || "Untitled";
        const parent = stack[stack.length - 1];
        pendingFolder = parent.folders.find((f) => f.name === name) || null;
        if (!pendingFolder) parent.folders.push((pendingFolder = Model.newFolder(name)));
        last = null;
      } else if (m[3] !== undefined) {
        const url = attr(m[3], "HREF");
        if (!url || /^(javascript|place|data):/i.test(url)) { skipped++; last = null; continue; }
        const tags = Model.parseTags(attr(m[3], "TAGS").split(",").join(" "));
        last = { id: "n" + Math.random().toString(36).slice(2), name: stripTags(m[4]) || url, url, description: "", tags };
        stack[stack.length - 1].entries.push(last);
      } else if (m[5] !== undefined) {
        if (last) last.description = stripTags(m[5]);
      } else if (tok === "</DL") {
        if (stack.length > 1) stack.pop();
        last = null;
      } else {
        // <DL>: opens the folder just named (the very first <DL> is the root list).
        if (pendingFolder) stack.push(pendingFolder);
        pendingFolder = null;
        last = null;
      }
    }
    flattenTooDeep(model.root, 0);
    return { model, skipped };
  }

  // Markdown has 6 heading levels; deeper browser folders fold into their 6th-level ancestor.
  function flattenTooDeep(folder, depth) {
    for (const f of folder.folders) flattenTooDeep(f, depth + 1);
    if (depth === Model.MAX_DEPTH) {
      const collect = (x) => { for (const c of x.folders) { folder.entries.push(...c.entries); collect(c); } };
      collect(folder);
      folder.folders = [];
    }
  }

  // Merge `src` into `dest`, skipping URLs `dest` already has. `under` puts it all in a folder path.
  function merge(dest, src, under) {
    const have = new Set(Model.allEntries(dest).map((x) => x.entry.url));
    let added = 0, duplicates = 0;
    for (const { entry, path } of Model.allEntries(src)) {
      if (have.has(entry.url)) { duplicates++; continue; }
      have.add(entry.url);
      const target = (under || []).concat(path).slice(0, Model.MAX_DEPTH);
      Model.addEntry(dest, target, entry);
      added++;
    }
    return { added, duplicates };
  }

  function serialize(model) {
    const out = [
      "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
      "<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->",
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      `<TITLE>Bookmarks</TITLE>`,
      `<H1>${encode(model.title || "Bookmarks")}</H1>`,
    ];
    const walk = (folder, ind) => {
      out.push(`${ind}<DL><p>`);
      for (const e of folder.entries) {
        const tags = e.tags.length ? ` TAGS="${encode(e.tags.join(","))}"` : "";
        out.push(`${ind}    <DT><A HREF="${encode(e.url)}"${tags}>${encode(e.name)}</A>`);
        if (e.description) out.push(`${ind}    <DD>${encode(e.description.replace(/\n/g, " "))}`);
      }
      for (const f of folder.folders) {
        out.push(`${ind}    <DT><H3>${encode(f.name)}</H3>`);
        walk(f, ind + "    ");
      }
      out.push(`${ind}</DL><p>`);
    };
    walk(model.root, "");
    return out.join("\n") + "\n";
  }

  return { parse, merge, serialize, decode };
});
