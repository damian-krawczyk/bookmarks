// Bookmarks model: bookmarks.md ⇄ a tree of folders holding entries.
// Shared by the CLI/server (Node) and the page (browser), so both read and
// write the file the same way.
//
// Format:
//   <!-- title: My bookmarks -->
//   - [Loose link](https://example.com)          ← entries before any heading: root
//   # Dev                                        ← heading level = folder depth
//   ## JavaScript
//   - [MDN](https://developer.mozilla.org) — Web docs
//     tags: #docs #js
//     a second line of description
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BookmarksModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TITLE_RE = /^<!--\s*title:\s*(.*?)\s*-->\s*$/i;
  const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
  // - [name](url) — description   (name may contain \] ; url may contain parentheses)
  const ENTRY_RE = /^[-*+]\s+\[((?:\\.|[^\]\\])*)\]\((\S*?)\)(?:\s+[—–-]{1,2}\s+(.*))?\s*$/;
  const TAGS_RE = /^tags:\s*(.*)$/i;
  const MAX_DEPTH = 6;

  let nextId = 1;
  const newId = () => "b" + nextId++;

  function newFolder(name) {
    return { name, folders: [], entries: [], notes: [] };
  }

  function emptyModel(title) {
    return { title: title || "", root: newFolder("") };
  }

  // "#a, b  #c d" → ["a", "b", "c", "d"]; tags never contain spaces or commas.
  function parseTags(text) {
    const out = [];
    for (const raw of String(text || "").split(/[\s,]+/)) {
      const t = cleanTag(raw);
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  }

  function cleanTag(t) {
    return String(t || "").trim().replace(/^#+/, "").replace(/[\s,#]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function cleanFolderName(n) {
    return String(n || "").replace(/[\/\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  }

  const unescapeName = (s) => s.replace(/\\([\\\[\]])/g, "$1");
  const escapeName = (s) => String(s).replace(/[\\\[\]]/g, (c) => "\\" + c);
  const encodeUrl = (u) => String(u).trim().replace(/\s/g, "%20").replace(/[<>]/g, encodeURIComponent);

  function parse(text) {
    const model = emptyModel();
    const warnings = [];
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    let stack = [model.root]; // stack[d] = folder at depth d
    let last = null; // entry that indented lines continue

    lines.forEach((line, i) => {
      const n = i + 1;
      if (!line.trim()) return;
      let m;
      if (!model.title && (m = TITLE_RE.exec(line.trim()))) { model.title = m[1]; last = null; return; }
      if ((m = HEADING_RE.exec(line))) {
        const level = m[1].length;
        const name = cleanFolderName(m[2]);
        const parentDepth = Math.min(level - 1, stack.length - 1);
        if (parentDepth < level - 1) warnings.push({ line: n, message: `heading level ${level} skips a level` });
        const parent = stack[parentDepth];
        let folder = parent.folders.find((f) => f.name === name);
        if (folder) warnings.push({ line: n, message: `folder "${name}" appears twice; merged` });
        else parent.folders.push((folder = newFolder(name)));
        stack = stack.slice(0, parentDepth + 1).concat(folder);
        last = null;
        return;
      }
      if (/^\s/.test(line) && last) {
        const body = line.trim();
        if ((m = TAGS_RE.exec(body))) last.tags = last.tags.concat(parseTags(m[1]).filter((t) => !last.tags.includes(t)));
        else last.description = last.description ? last.description + "\n" + body : body;
        return;
      }
      if ((m = ENTRY_RE.exec(line))) {
        const entry = { id: newId(), name: unescapeName(m[1]).trim(), url: m[2], description: (m[3] || "").trim(), tags: [] };
        stack[stack.length - 1].entries.push(entry);
        last = entry;
        return;
      }
      stack[stack.length - 1].notes.push(line);
      warnings.push({ line: n, message: `not a bookmark, kept as a note: ${line.trim().slice(0, 60)}` });
      last = null;
    });
    return { model, warnings };
  }

  function serializeEntry(e) {
    const name = escapeName(e.name || e.url);
    const [first, ...rest] = String(e.description || "").split("\n").map((s) => s.trim()).filter((s, i) => s || i === 0);
    let out = `- [${name}](${encodeUrl(e.url)})` + (first ? ` — ${first}` : "") + "\n";
    if (e.tags && e.tags.length) out += `  tags: ${e.tags.map((t) => "#" + t).join(" ")}\n`;
    for (const r of rest) if (r) out += `  ${r}\n`;
    return out;
  }

  function serialize(model) {
    const blocks = [];
    if (model.title) blocks.push(`<!-- title: ${model.title} -->\n`);
    const body = (folder) => {
      let out = "";
      if (folder.notes.length) out += folder.notes.join("\n") + "\n";
      if (folder.notes.length && folder.entries.length) out += "\n";
      out += folder.entries.map(serializeEntry).join("");
      return out;
    };
    const rootBody = body(model.root);
    if (rootBody) blocks.push(rootBody);
    const walk = (folder, depth) => {
      for (const f of folder.folders) {
        const b = body(f);
        blocks.push(`${"#".repeat(Math.min(depth, MAX_DEPTH))} ${f.name}\n` + (b ? "\n" + b : ""));
        walk(f, depth + 1);
      }
    };
    walk(model.root, 1);
    return blocks.join("\n");
  }

  // ---- queries -------------------------------------------------------------

  function findFolder(model, path, create) {
    let f = model.root;
    if (create && (path || []).filter((p) => cleanFolderName(p)).length > MAX_DEPTH) {
      throw new Error(`folders can be nested at most ${MAX_DEPTH} levels deep (Markdown has 6 heading levels)`);
    }
    for (const raw of path || []) {
      const name = cleanFolderName(raw);
      if (!name) continue;
      let next = f.folders.find((c) => c.name === name);
      if (!next) {
        if (!create) return null;
        f.folders.push((next = newFolder(name)));
      }
      f = next;
    }
    return f;
  }

  // Every entry with the folder path it lives in, in file order.
  function allEntries(model) {
    const out = [];
    const walk = (folder, path) => {
      for (const e of folder.entries) out.push({ entry: e, path });
      for (const f of folder.folders) walk(f, path.concat(f.name));
    };
    walk(model.root, []);
    return out;
  }

  function allFolders(model) {
    const out = [];
    const walk = (folder, path) => {
      for (const f of folder.folders) {
        const p = path.concat(f.name);
        out.push({ folder: f, path: p });
        walk(f, p);
      }
    };
    walk(model.root, []);
    return out;
  }

  function locate(model, id) {
    const walk = (folder, path) => {
      const i = folder.entries.findIndex((e) => e.id === id);
      if (i >= 0) return { folder, index: i, entry: folder.entries[i], path };
      for (const f of folder.folders) {
        const r = walk(f, path.concat(f.name));
        if (r) return r;
      }
      return null;
    };
    return walk(model.root, []);
  }

  function countEntries(folder) {
    return folder.entries.length + folder.folders.reduce((s, f) => s + countEntries(f), 0);
  }

  // tag → number of entries, sorted by count then name.
  function tagCounts(model) {
    const m = new Map();
    for (const { entry } of allEntries(model)) for (const t of entry.tags) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  const splitPath = (s) => String(s || "").split("/").map(cleanFolderName).filter(Boolean);

  // ---- edits (mutate the model) -------------------------------------------

  function normalizeEntry(fields) {
    return {
      name: String(fields.name || "").replace(/\s+/g, " ").trim(),
      url: String(fields.url || "").trim(),
      description: String(fields.description || "").replace(/\r\n?/g, "\n").trim(),
      tags: Array.isArray(fields.tags) ? parseTags(fields.tags.join(" ")) : parseTags(fields.tags),
    };
  }

  function addEntry(model, path, fields) {
    const entry = Object.assign({ id: newId() }, normalizeEntry(fields));
    if (!entry.name) entry.name = entry.url;
    findFolder(model, path, true).entries.push(entry);
    return entry;
  }

  function updateEntry(model, id, fields, path) {
    const loc = locate(model, id);
    if (!loc) throw new Error(`no bookmark ${id}`);
    Object.assign(loc.entry, normalizeEntry(Object.assign({}, loc.entry, fields)));
    if (!loc.entry.name) loc.entry.name = loc.entry.url;
    if (path && path.join("/") !== loc.path.join("/")) {
      loc.folder.entries.splice(loc.index, 1);
      findFolder(model, path, true).entries.push(loc.entry);
    }
    return loc.entry;
  }

  function deleteEntry(model, id) {
    const loc = locate(model, id);
    if (!loc) return false;
    loc.folder.entries.splice(loc.index, 1);
    return true;
  }

  function addFolder(model, path) {
    return findFolder(model, path, true);
  }

  function parentOf(model, path) {
    return path.length > 1 ? findFolder(model, path.slice(0, -1)) : model.root;
  }

  // Rename a folder; if a sibling already has the new name, the two merge.
  function renameFolder(model, path, newName) {
    newName = cleanFolderName(newName);
    const parent = parentOf(model, path);
    const folder = findFolder(model, path);
    if (!folder || !parent || !newName || newName === folder.name) return folder;
    const other = parent.folders.find((f) => f.name === newName);
    if (other) {
      parent.folders.splice(parent.folders.indexOf(folder), 1);
      mergeInto(other, folder);
      return other;
    }
    folder.name = newName;
    return folder;
  }

  function mergeInto(target, src) {
    target.entries.push(...src.entries);
    target.notes.push(...src.notes);
    for (const f of src.folders) {
      const same = target.folders.find((t) => t.name === f.name);
      if (same) mergeInto(same, f);
      else target.folders.push(f);
    }
  }

  // Move a folder (with its contents) under another folder ([] = top level).
  function moveFolder(model, path, newParentPath) {
    const folder = findFolder(model, path);
    const parent = parentOf(model, path);
    if (!folder || !parent) return null;
    const dest = newParentPath.join("/");
    const self = path.join("/");
    if (dest === self || dest.startsWith(self + "/")) return null; // into itself
    if (newParentPath.join("/") === path.slice(0, -1).join("/")) return folder;
    if (newParentPath.length + 1 + folderDepth(folder) > MAX_DEPTH) {
      throw new Error(`folders can be nested at most ${MAX_DEPTH} levels deep (Markdown has 6 heading levels)`);
    }
    parent.folders.splice(parent.folders.indexOf(folder), 1);
    const target = findFolder(model, newParentPath, true);
    const same = target.folders.find((f) => f.name === folder.name);
    if (same) { mergeInto(same, folder); return same; }
    target.folders.push(folder);
    return folder;
  }

  // How many levels of subfolders a folder has below it (0 = none).
  function folderDepth(folder) {
    return folder.folders.reduce((m, f) => Math.max(m, 1 + folderDepth(f)), 0);
  }

  function deleteFolder(model, path) {
    const parent = parentOf(model, path);
    const folder = findFolder(model, path);
    if (!folder || !parent || folder === model.root) return false;
    parent.folders.splice(parent.folders.indexOf(folder), 1);
    return true;
  }

  // ---- validation ----------------------------------------------------------

  function validUrl(u) {
    try {
      const x = new URL(u);
      return /^[a-z][a-z0-9+.-]*:$/i.test(x.protocol);
    } catch (_) {
      return false;
    }
  }

  function validate(text) {
    const { model, warnings } = parse(text);
    const errors = [];
    const seen = new Map();
    for (const { entry, path } of allEntries(model)) {
      const where = path.length ? path.join(" / ") : "(top level)";
      if (!entry.url) errors.push(`"${entry.name}" in ${where}: missing URL`);
      else if (!validUrl(entry.url)) errors.push(`"${entry.name}" in ${where}: invalid URL ${entry.url}`);
      if (seen.has(entry.url)) warnings.push({ message: `duplicate URL ${entry.url} (in ${seen.get(entry.url)} and ${where})` });
      else seen.set(entry.url, where);
    }
    return { model, errors, warnings: warnings.map((w) => (w.line ? `line ${w.line}: ${w.message}` : w.message)) };
  }

  return {
    parse, serialize, serializeEntry, emptyModel, newFolder, parseTags, cleanTag, cleanFolderName, splitPath,
    findFolder, allEntries, allFolders, locate, countEntries, tagCounts,
    addEntry, updateEntry, deleteEntry, addFolder, renameFolder, moveFolder, deleteFolder,
    validate, validUrl, MAX_DEPTH,
  };
});
