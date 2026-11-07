#!/usr/bin/env node
// bookmarks CLI: serve (edit in the browser), build (static HTML for GitHub Pages),
// validate, import / export browser bookmark files.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { execFile } = require("child_process");
const Model = require("../src/model.js");
const Netscape = require("../src/netscape.js");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

const USAGE = `Usage:
  bookmarks serve [file.md] [--port 4180] [--host 127.0.0.1] [--open]
      Serve the page with editing; saves go straight to file.md.
  bookmarks build [file.md] [-o dist/index.html]
      Write a single self-contained, read-only HTML file (for GitHub Pages).
  bookmarks validate [file.md]
      Check the file; exits 1 on errors.
  bookmarks import <browser-export.html> [--into file.md] [--under "Folder/Sub"]
      Merge a browser bookmarks export into file.md (duplicate URLs are skipped).
  bookmarks export [file.md] [-o bookmarks.html]
      Write a browser-importable bookmarks HTML file.

file.md defaults to ./bookmarks.md.`;

// ---- argument parsing -------------------------------------------------------

function parseArgs(argv) {
  const flags = {}, rest = [];
  const alias = { o: "out", p: "port" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = /^--?([\w-]+)(?:=(.*))?$/.exec(a);
    if (!m) { rest.push(a); continue; }
    const key = alias[m[1]] || m[1];
    if (m[2] !== undefined) flags[key] = m[2];
    else if (["open", "help"].includes(key)) flags[key] = true;
    else flags[key] = argv[++i];
  }
  return { flags, rest };
}

// ---- page rendering ---------------------------------------------------------

const read = (p) => fs.readFileSync(p, "utf8");
const scriptSafe = (s) => s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

function loadLocales() {
  const dir = path.join(SRC, "locales");
  const out = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    out[path.basename(f, ".json")] = JSON.parse(read(path.join(dir, f)));
  }
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// d3's package "exports" hide dist/, so find the package folder from its entry point.
function d3Path() {
  const entry = require.resolve("d3");
  const marker = `${path.sep}node_modules${path.sep}d3${path.sep}`;
  return path.join(entry.slice(0, entry.lastIndexOf(marker) + marker.length), "dist", "d3.min.js");
}

function renderHtml({ markdown, config, title }) {
  const d3 = read(d3Path());
  const scripts = [d3, ...["model.js", "i18n.js", "graph.js", "app.js"].map((f) => read(path.join(SRC, f)))];
  const data = { markdown, config, locales: loadLocales() };
  const parts = {
    "{{TITLE}}": escapeHtml(title || "Bookmarks"),
    "/*{{CSS}}*/": read(path.join(SRC, "style.css")),
    "/*{{DATA}}*/": "window.BOOKMARKS_DATA = " + JSON.stringify(data).replace(/</g, "\\u003c") + ";",
    "/*{{SCRIPTS}}*/": scripts.map(scriptSafe).join("\n;\n"),
  };
  // One pass, so text inside the inlined parts is never mistaken for a placeholder.
  return read(path.join(SRC, "template.html")).replace(/\{\{TITLE\}\}|\/\*\{\{(?:CSS|DATA|SCRIPTS)\}\}\*\//g, (m) => parts[m]);
}

function titleOf(markdown) {
  return Model.parse(markdown).model.title || "Bookmarks";
}

// ---- commands ---------------------------------------------------------------

function report({ errors, warnings }) {
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`error: ${e}`);
}

function validate(file) {
  const { model, errors, warnings } = Model.validate(read(file));
  report({ errors, warnings });
  const n = Model.allEntries(model).length;
  console.log(`${file}: ${n} bookmarks, ${Model.allFolders(model).length} folders, ${errors.length} errors, ${warnings.length} warnings`);
  return errors.length ? 1 : 0;
}

function build(file, out) {
  const markdown = read(file);
  report(Model.validate(markdown));
  out = out || path.join("dist", "index.html");
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, renderHtml({ markdown, title: titleOf(markdown), config: { readOnly: true, fileName: path.basename(file) } }));
  console.log(`wrote ${out}`);
  return 0;
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function importCmd(src, flags) {
  if (!src) { console.error(USAGE); return 2; }
  const into = flags.into || "bookmarks.md";
  const existing = fs.existsSync(into) ? Model.parse(read(into)).model : Model.emptyModel("Bookmarks");
  const { model: imported, skipped } = Netscape.parse(read(src));
  const { added, duplicates } = Netscape.merge(existing, imported, Model.splitPath(flags.under));
  writeAtomic(into, Model.serialize(existing));
  console.log(`${into}: added ${added}, skipped ${duplicates} duplicates` + (skipped ? ` and ${skipped} bookmarklets/special links` : ""));
  return 0;
}

function exportCmd(file, out) {
  out = out || "bookmarks.html";
  fs.writeFileSync(out, Netscape.serialize(Model.parse(read(file)).model));
  console.log(`wrote ${out} (import it in your browser's bookmark manager)`);
  return 0;
}

// ---- server -----------------------------------------------------------------

const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too large")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// The <title> of a page, for "Get the name from the page".
async function fetchTitle(url) {
  if (!Model.validUrl(url) || !/^https?:/i.test(url)) return { title: "", description: "" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (bookmarks)", Accept: "text/html" } });
    const text = (await res.text()).slice(0, 500000);
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)
      || /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i.exec(text);
    const desc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(text)
      || /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(text);
    const clean = (s) => Netscape.decode(String(s || "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
    return { title: clean(m && m[1]), description: clean(desc && desc[1]) };
  } catch (_) {
    return { title: "", description: "" };
  } finally {
    clearTimeout(timer);
  }
}

function serve(file, flags) {
  const abs = path.resolve(file);
  const host = flags.host || "127.0.0.1";
  const port = Number(flags.port || process.env.BOOKMARKS_PORT || 4180);
  const clients = new Set();
  let lastWritten = null; // hash of what we wrote, so our own saves don't echo as "changed"

  const current = () => read(abs);
  const send = (res, code, type, body, extra = {}) => res.writeHead(code, Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, extra)).end(body);
  const json = (res, code, obj) => send(res, code, "application/json; charset=utf-8", JSON.stringify(obj));
  const broadcast = (event) => { for (const c of clients) c.write(`data: ${JSON.stringify(event)}\n\n`); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    try {
      if (url.pathname === "/" && req.method === "GET") {
        const markdown = current();
        return send(res, 200, "text/html; charset=utf-8", renderHtml({
          markdown, title: titleOf(markdown),
          config: { readOnly: false, fileName: path.basename(abs), version: hash(markdown) },
        }));
      }
      if (url.pathname === "/api/bookmarks" && req.method === "GET") {
        const markdown = current();
        return send(res, 200, "text/markdown; charset=utf-8", markdown, { ETag: hash(markdown) });
      }
      if (url.pathname === "/api/bookmarks" && req.method === "PUT") {
        // Only accept writes from this page (blocks other sites posting to localhost).
        if (req.headers["x-bookmarks"] !== "1") return json(res, 403, { error: "forbidden" });
        const body = await readBody(req);
        const disk = current();
        const base = req.headers["if-match"];
        if (base && base !== hash(disk)) return json(res, 409, { error: "conflict", version: hash(disk) });
        const { errors } = Model.validate(body);
        if (errors.length) return json(res, 422, { error: errors.join("; ") });
        lastWritten = hash(body);
        writeAtomic(abs, body);
        broadcast({ type: "saved", version: lastWritten });
        return json(res, 200, { ok: true, version: lastWritten });
      }
      if (url.pathname === "/api/title" && req.method === "GET") {
        if (req.headers["x-bookmarks"] !== "1") return json(res, 403, { error: "forbidden" });
        return json(res, 200, await fetchTitle(url.searchParams.get("url") || ""));
      }
      if (url.pathname === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write(": hi\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      send(res, 404, "text/plain", "not found");
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  // Edits made outside the page (an editor, git pull) reach open pages.
  let timer = null;
  fs.watchFile(abs, { interval: 500 }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      let text;
      try { text = current(); } catch (_) { return; }
      const v = hash(text);
      if (v === lastWritten) return;
      lastWritten = v;
      console.log(`${file} changed on disk`);
      broadcast({ type: "changed", version: v });
    }, 150);
  });
  setInterval(() => { for (const c of clients) c.write(": ping\n\n"); }, 25000).unref();

  server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `port ${port} is in use; try --port ${port + 1}` : e.message);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const link = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}/`;
    console.log(`serving ${file} at ${link}  (Ctrl+C to stop)`);
    if (flags.open) {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
      execFile(cmd, [link], () => {});
    }
  });
  return null;
}

// ---- main -------------------------------------------------------------------

function main(argv) {
  const [cmd, ...args] = argv;
  const { flags, rest } = parseArgs(args);
  if (!cmd || flags.help || cmd === "help") { console.log(USAGE); return 0; }
  const file = rest[0] || "bookmarks.md";
  const needFile = ["serve", "build", "validate", "export"].includes(cmd);
  if (needFile && !fs.existsSync(file)) {
    if (cmd === "serve" && !rest[0]) {
      fs.writeFileSync(file, Model.serialize(Model.emptyModel("Bookmarks")));
      console.log(`created ${file}`);
    } else {
      console.error(`no such file: ${file}`);
      return 2;
    }
  }
  switch (cmd) {
    case "serve": return serve(file, flags);
    case "build": return build(file, flags.out);
    case "validate": return validate(file);
    case "import": return importCmd(rest[0], flags);
    case "export": return exportCmd(file, flags.out);
    default: console.error(USAGE); return 2;
  }
}

if (require.main === module) {
  const code = main(process.argv.slice(2));
  if (typeof code === "number") process.exitCode = code;
}

module.exports = { renderHtml, parseArgs, main };
