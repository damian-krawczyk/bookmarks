// The page: folder tree, tag cloud, bookmark list, search, graph, editor.
// Data comes inlined (window.BOOKMARKS_DATA). Under `bookmarks serve`, edits are
// saved by sending the whole re-serialized Markdown back to the server.
(function () {
  "use strict";

  const Model = window.BookmarksModel;
  const DATA = window.BOOKMARKS_DATA;
  const config = DATA.config || {};
  const readOnly = !!config.readOnly;
  const i18n = window.I18n.create(DATA.locales, "en");
  const t = i18n.t;
  const $ = (sel) => document.querySelector(sel);

  // ---- per-browser preferences (may be unavailable, e.g. private mode) ----
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bm-" + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem("bm-" + k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
  };
  // The theme is stored as a bare string so the inline <head> script can read it.
  const themeStore = {
    get() { try { return localStorage.getItem("bm-theme") || "auto"; } catch (_) { return "auto"; } },
    set(v) { try { localStorage.setItem("bm-theme", v); } catch (_) { /* ignore */ } },
  };

  const state = {
    model: Model.parse(DATA.markdown).model,
    version: config.version || null,
    folder: store.get("folder", null), // selected folder path, null = all
    query: "",
    view: store.get("view", "list"),
    collapsed: new Set(store.get("collapsed", [])),
    theme: themeStore.get(),
    editing: null, // { id, url } of the entry in the editor, or null for a new one
  };
  if (state.folder && !Model.findFolder(state.model, state.folder)) state.folder = null;

  // ---- text helpers ----
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const foldChar = (c) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace("ł", "l");
  const fold = (s) => [...String(s ?? "")].map(foldChar).join("");

  // Wrap the parts of `text` that match any term (accent- and case-insensitive) in <mark>.
  function highlight(text, terms) {
    text = String(text ?? "");
    if (!terms.length || !text) return esc(text);
    let folded = "";
    const map = []; // index in folded → index in text
    let i = 0;
    for (const ch of text) {
      const f = foldChar(ch);
      for (let k = 0; k < f.length; k++) map.push(i);
      folded += f;
      i += ch.length;
    }
    map.push(text.length);
    const marks = new Array(text.length + 1).fill(0);
    for (const term of terms) {
      if (!term) continue;
      let at = folded.indexOf(term);
      while (at >= 0) {
        marks[map[at]]++;
        marks[map[at + term.length]]--;
        at = folded.indexOf(term, at + term.length);
      }
    }
    let out = "", depth = 0, open = false;
    for (let j = 0; j < text.length; j++) {
      depth += marks[j];
      if (depth > 0 && !open) { out += "<mark>"; open = true; }
      if (depth <= 0 && open) { out += "</mark>"; open = false; }
      out += esc(text[j]);
    }
    return out + (open ? "</mark>" : "");
  }

  function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return url; }
  }

  const pathKey = (p) => (p || []).join("/");
  const samePath = (a, b) => pathKey(a) === pathKey(b);
  const within = (path, folder) => !folder || pathKey(path) === pathKey(folder) || pathKey(path).startsWith(pathKey(folder) + "/");

  // ---- search ----
  function parseQuery(q) {
    const tags = [], words = [];
    for (const raw of q.trim().split(/\s+/).filter(Boolean)) {
      if (raw.startsWith("#") && raw.length > 1) tags.push(fold(raw.slice(1)));
      else words.push(fold(raw));
    }
    return { tags, words };
  }

  function filtered() {
    const { tags, words } = parseQuery(state.query);
    return Model.allEntries(state.model).filter(({ entry, path }) => {
      if (!within(path, state.folder)) return false;
      const etags = entry.tags.map(fold);
      if (!tags.every((tg) => etags.some((x) => x === tg || x.startsWith(tg)))) return false;
      if (!words.length) return true;
      const hay = fold([entry.name, entry.url, entry.description, entry.tags.join(" "), path.join(" ")].join(" \u0000 "));
      return words.every((w) => hay.includes(w));
    });
  }

  // ---- rendering ----
  function render() {
    document.body.classList.toggle("readonly", readOnly);
    if (state.folder && !Model.findFolder(state.model, state.folder)) state.folder = null;
    const title = state.model.title || t("app.title");
    $("#title").textContent = title;
    document.title = title;
    renderTree();
    renderTags();
    const shown = filtered();
    renderCrumbs(shown);
    $("#view-list").setAttribute("aria-pressed", state.view === "list");
    $("#view-graph").setAttribute("aria-pressed", state.view === "graph");
    $("#list").hidden = state.view !== "list";
    $("#graph").hidden = state.view !== "graph";
    if (state.view === "list") renderList(shown);
    else renderGraph(shown);
  }

  function renderCrumbs(shown) {
    const parts = [`<button data-path="">${esc(t("tree.all"))}</button>`];
    (state.folder || []).forEach((name, i) => {
      parts.push(`<span class="sep">/</span><button data-path="${esc(pathKey(state.folder.slice(0, i + 1)))}">${esc(name)}</button>`);
    });
    $("#crumbs").innerHTML = parts.join("");
    const total = Model.countEntries(state.folder ? Model.findFolder(state.model, state.folder) || state.model.root : state.model.root);
    $("#count").textContent = shown.length === total
      ? t("count.bookmarks", { count: total })
      : t("count.shown", { shown: shown.length, total: t("count.bookmarks", { count: total }) });
  }

  function renderTree() {
    const total = Model.countEntries(state.model.root);
    const row = (path, name, count, hasKids, depth) => {
      const key = pathKey(path);
      const open = !state.collapsed.has(key);
      const sel = path.length ? !!state.folder && samePath(path, state.folder) : !state.folder;
      const acts = readOnly ? "" : `<span class="acts">
          ${path.length < Model.MAX_DEPTH ? `<button data-act="sub" title="${esc(t("action.newSubfolder"))}" aria-label="${esc(t("action.newSubfolder"))}">+</button>` : ""}
          ${path.length ? `<button data-act="rename" title="${esc(t("action.rename"))}" aria-label="${esc(t("action.rename"))}">✎</button>
          <button data-act="delete" title="${esc(t("action.deleteFolder"))}" aria-label="${esc(t("action.deleteFolder"))}">🗑</button>` : ""}
        </span>`;
      return `<div class="tree-row${sel ? " selected" : ""}" data-path="${esc(key)}" tabindex="0" role="treeitem"
          ${hasKids ? `aria-expanded="${open}"` : ""} ${!readOnly && path.length ? 'draggable="true"' : ""}>
        <button class="chev${hasKids ? (open ? " open" : "") : " none"}" data-act="toggle" tabindex="-1" aria-hidden="true">▶</button>
        <span class="name">${esc(name)}</span><span class="cnt">${count}</span>${acts}</div>`;
    };
    const walk = (folder, path) => {
      if (!folder.folders.length) return "";
      return "<ul role=\"group\">" + folder.folders.map((f) => {
        const p = path.concat(f.name);
        const open = !state.collapsed.has(pathKey(p));
        return `<li>${row(p, f.name, Model.countEntries(f), f.folders.length > 0)}${open ? walk(f, p) : ""}</li>`;
      }).join("") + "</ul>";
    };
    $("#tree").innerHTML = `<ul role="tree"><li>${row([], t("tree.all"), total, false)}</li></ul>${walk(state.model.root, [])}`;
  }

  function renderTags() {
    const counts = Model.tagCounts(state.model);
    const active = new Set(parseQuery(state.query).tags);
    $("#tags").innerHTML = counts.length
      ? counts.map(([tag, n]) => `<button class="tag${active.has(fold(tag)) ? " active" : ""}" data-tag="${esc(tag)}">#${esc(tag)} <span class="n">${n}</span></button>`).join("")
      : `<span class="empty-note">${esc(t("tree.noTags"))}</span>`;
  }

  function letterColor(s) {
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `hsl(${h} 55% 50%)`;
  }

  function renderList(shown) {
    const { tags, words } = parseQuery(state.query);
    const terms = words;
    const tagTerms = tags;
    const list = $("#list");
    if (!shown.length) {
      list.innerHTML = `<div class="list-empty">${esc(state.query ? t("list.noMatches", { query: state.query }) : t("list.empty"))}</div>`;
      return;
    }
    list.innerHTML = shown.map(({ entry, path }) => {
      const domain = domainOf(entry.url);
      const tagHtml = entry.tags.map((tg) => {
        const on = tagTerms.some((x) => fold(tg).startsWith(x));
        return `<button class="tag${on ? " active" : ""}" data-tag="${esc(tg)}">#${highlight(tg, terms)}</button>`;
      }).join("");
      const folder = path.length ? `<button class="folder" data-path="${esc(pathKey(path))}">📁 ${highlight(path.join(" / "), terms)}</button>` : "";
      const tools = readOnly ? "" : `<div class="tools">
          <button data-act="edit" data-id="${entry.id}">${esc(t("action.edit"))}</button>
          <button data-act="delete" data-id="${entry.id}" class="danger" aria-label="${esc(t("action.delete"))}">✕</button></div>`;
      return `<article class="card" data-id="${entry.id}" ${readOnly ? "" : 'draggable="true"'}>
        <div class="head"><span class="fav" style="color:${letterColor(domain)}">${esc((domain[0] || "?").toUpperCase())}</span>
          <a class="name" href="${esc(entry.url)}" target="_blank" rel="noopener noreferrer" title="${esc(entry.url)}">${highlight(entry.name, terms)}</a></div>
        <div class="domain" title="${esc(entry.url)}">${highlight(entry.url, terms)}</div>
        ${entry.description ? `<div class="desc">${highlight(entry.description, terms)}</div>` : ""}
        ${tagHtml || folder ? `<div class="meta">${tagHtml}${folder}</div>` : ""}
        ${tools}
      </article>`;
    }).join("");
  }

  let graph = null;
  let graphEnter = true; // the next graph render is the view being opened: animate it in
  function renderGraph(shown) {
    if (!window.d3) return;
    if (!graph) {
      graph = window.GraphView.create($("#graph"), {
        t,
        onOpen: (e) => window.open(e.url, "_blank", "noopener"),
        onFolder: (p) => { selectFolder(p.length ? p : null); setView("list"); },
        onTag: (tag) => { setQuery("#" + tag); setView("list"); },
        onEdit: (e) => openEditor(e),
      });
    }
    graph.update(state.model.title || t("app.title"), shown, { enter: graphEnter });
    graphEnter = false;
  }

  // ---- actions ----
  function selectFolder(path) {
    state.folder = path && path.length ? path : null;
    store.set("folder", state.folder);
    // Open the ancestors so the selection is visible in the tree.
    (path || []).forEach((_, i) => state.collapsed.delete(pathKey(path.slice(0, i))));
    store.set("collapsed", [...state.collapsed]);
    document.body.classList.remove("side-open");
    render();
  }

  function setQuery(q) {
    state.query = q;
    $("#search").value = q;
    render();
  }

  function toggleTag(tag) {
    const { tags } = parseQuery(state.query);
    const f = fold(tag);
    const parts = state.query.trim().split(/\s+/).filter(Boolean);
    const next = tags.includes(f) ? parts.filter((p) => !(p.startsWith("#") && fold(p.slice(1)) === f)) : parts.concat("#" + tag);
    setQuery(next.join(" ") + (next.length ? " " : ""));
  }

  function setView(v) {
    if (v === "graph" && state.view !== "graph") graphEnter = true;
    state.view = v;
    store.set("view", v);
    if (v !== "graph" && graph) graph.stop();
    render();
  }

  const THEMES = ["auto", "light", "dark"];
  function applyTheme() {
    if (state.theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = state.theme;
    const icon = { auto: "◐", light: "☀", dark: "☾" }[state.theme];
    const btn = $("#theme-btn");
    btn.textContent = icon;
    btn.title = t("theme." + state.theme);
    btn.setAttribute("aria-label", t("theme." + state.theme));
  }

  // "Built 7 Nov 2026, 15:24 · commit a901fb6" in the sidebar footer.
  function renderBuildInfo() {
    const b = config.build || {};
    const parts = [];
    const when = b.time ? new Date(b.time) : null;
    if (when && !isNaN(when)) {
      let text;
      try { text = new Intl.DateTimeFormat(i18n.lang, { dateStyle: "medium", timeStyle: "short" }).format(when); } catch (_) { text = when.toLocaleString(); }
      parts.push(esc(t("footer.built", { date: text })));
    }
    if (b.commit) {
      const hashHtml = b.commitUrl && /^https:\/\//.test(b.commitUrl)
        ? `<a href="${esc(b.commitUrl)}" target="_blank" rel="noopener noreferrer">${esc(b.commit)}</a>`
        : `<code>${esc(b.commit)}</code>`;
      parts.push(`${esc(t("footer.commit"))} ${hashHtml}`);
    }
    $("#build-info").innerHTML = parts.join(" · ");
  }

  function applyLanguage() {
    document.documentElement.lang = i18n.lang;
    i18n.apply(document);
    applyTheme();
    renderBuildInfo();
    if (graph) graph.labels();
    render();
  }

  let toastTimer = null;
  function toast(msg, isError) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), isError ? 5000 : 1800);
  }

  // ---- saving (serve mode) ----
  const api = (path, opts = {}) => fetch(path, Object.assign({}, opts, { headers: Object.assign({ "X-Bookmarks": "1" }, opts.headers || {}) }));

  async function reload() {
    const res = await api("/api/bookmarks", { cache: "no-store" });
    if (!res.ok) throw new Error(res.statusText);
    state.version = res.headers.get("ETag");
    state.model = Model.parse(await res.text()).model;
    if (state.folder && !Model.findFolder(state.model, state.folder)) state.folder = null;
    render();
  }

  let saving = Promise.resolve();
  // Apply `change` to the model, then write the file. On failure, reload what's on disk.
  function commit(change) {
    if (readOnly) return Promise.resolve(false);
    try { change(state.model); } catch (e) { toast(e.message, true); return Promise.resolve(false); }
    render();
    const text = Model.serialize(state.model);
    saving = saving.then(async () => {
      try {
        const res = await api("/api/bookmarks", {
          method: "PUT",
          headers: Object.assign({ "Content-Type": "text/markdown; charset=utf-8" }, state.version ? { "If-Match": state.version } : {}),
          body: text,
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) { state.version = body.version; toast(t("status.saved")); return true; }
        if (res.status === 409) { await reload(); toast(t("error.conflict"), true); return false; }
        await reload();
        toast(t("error.save", { message: body.error || res.statusText }), true);
        return false;
      } catch (_) {
        toast(t("error.offline"), true);
        return false;
      }
    });
    return saving;
  }

  // Live updates: the file changed on disk, or another tab saved.
  function listen() {
    if (readOnly || !window.EventSource) return;
    const es = new EventSource("/events");
    es.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.version && msg.version !== state.version) {
        // Saves are serialized; wait for ours so we don't treat our own write as foreign.
        saving.then(() => { if (msg.version !== state.version) reload().catch(() => {}); });
      }
    };
  }

  // ---- editor ----
  const form = $("#editor-form");
  const dialog = $("#editor");

  function folderOptions() {
    $("#folder-list").innerHTML = Model.allFolders(state.model).map(({ path }) => `<option value="${esc(path.join("/"))}">`).join("");
  }

  function openEditor(entry, preset = {}) {
    if (readOnly) return;
    const loc = entry && Model.locate(state.model, entry.id);
    state.editing = loc ? { id: entry.id, url: entry.url } : null;
    $("#editor-title").textContent = t(loc ? "dialog.edit" : "dialog.add");
    form.url.value = loc ? entry.url : preset.url || "";
    form.name.value = loc ? entry.name : preset.name || "";
    form.description.value = loc ? entry.description : preset.description || "";
    form.tags.value = loc ? entry.tags.join(" ") : preset.tags || "";
    form.folder.value = pathKey(loc ? loc.path : preset.folder || state.folder || []);
    $("#editor-delete").hidden = !loc;
    $("#editor-error").textContent = "";
    folderOptions();
    checkDuplicate();
    suggestTags();
    if (!dialog.open) dialog.showModal();
    (form.url.value ? form.name : form.url).focus();
  }

  function checkDuplicate() {
    const url = form.url.value.trim();
    const other = url && Model.allEntries(state.model).find(({ entry }) => entry.url === url && (!state.editing || entry.id !== state.editing.id));
    $("#url-note").textContent = other ? t("status.duplicate", { folder: other.path.join(" / ") || t("list.topLevel") }) : "";
  }

  function suggestTags() {
    const val = form.tags.value;
    const current = Model.parseTags(val);
    const last = /[\s,]$/.test(val) || !val ? "" : fold(val.split(/[\s,]+/).pop().replace(/^#/, ""));
    const all = Model.tagCounts(state.model).map(([tg]) => tg).filter((tg) => !current.includes(tg) || fold(tg) === last);
    const matches = all.filter((tg) => !last || (fold(tg).startsWith(last) && fold(tg) !== last)).slice(0, 12);
    $("#tag-suggest").innerHTML = matches.map((tg) => `<button type="button" class="tag" data-tag="${esc(tg)}">#${esc(tg)}</button>`).join("");
  }

  function normalizeUrl(u) {
    u = u.trim();
    if (u && !/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
    return u;
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const url = normalizeUrl(form.url.value);
    if (!Model.validUrl(url)) { $("#editor-error").textContent = t("error.url"); form.url.focus(); return; }
    const fields = { url, name: form.name.value, description: form.description.value, tags: form.tags.value };
    const path = Model.splitPath(form.folder.value);
    if (path.length > Model.MAX_DEPTH) { $("#editor-error").textContent = t("error.depth", { max: Model.MAX_DEPTH }); form.folder.focus(); return; }
    const ed = state.editing;
    dialog.close();
    const ok = await commit((m) => {
        // After a reload ids change; fall back to finding the entry by its URL.
        let id = ed && ed.id;
        if (ed && !Model.locate(m, id)) {
          const hit = Model.allEntries(m).find(({ entry }) => entry.url === ed.url);
          id = hit && hit.entry.id;
        }
        if (id) Model.updateEntry(m, id, fields, path);
        else Model.addEntry(m, path, fields);
      });
    if (new URLSearchParams(location.search).has("popup") && ok) setTimeout(() => window.close(), 400);
  });

  // Themed replacements for prompt() and confirm(), which browsers draw unstyled.
  // ask({ message, value }) → the text, or null; ask({ message, danger: true }) → true/false.
  function ask({ message, value, okLabel, danger }) {
    const box = $("#ask"), input = $("#ask-input"), ok = $("#ask-ok");
    const isPrompt = value !== undefined;
    $("#ask-message").textContent = message;
    input.hidden = !isPrompt;
    input.value = isPrompt ? value : "";
    ok.textContent = okLabel || t("action.ok");
    ok.classList.toggle("danger", !!danger);
    box.returnValue = "";
    box.showModal();
    (isPrompt ? input : ok).focus();
    if (isPrompt) input.select();
    return new Promise((resolve) => {
      box.addEventListener("close", () => {
        const accepted = box.returnValue === "ok";
        resolve(isPrompt ? (accepted ? input.value : null) : accepted);
      }, { once: true });
    });
  }
  $("#ask-form").addEventListener("submit", (ev) => { ev.preventDefault(); $("#ask").close("ok"); });
  $("#ask-cancel").addEventListener("click", () => $("#ask").close("cancel"));
  const confirmDelete = (message) => ask({ message, okLabel: t("action.delete"), danger: true });

  $("#editor-cancel").addEventListener("click", () => dialog.close());
  $("#editor-delete").addEventListener("click", async () => {
    const ed = state.editing;
    if (!ed) return;
    const loc = Model.locate(state.model, ed.id);
    if (loc && await confirmDelete(t("confirm.deleteBookmark", { name: loc.entry.name }))) {
      commit((m) => Model.deleteEntry(m, ed.id));
      dialog.close();
    }
  });
  dialog.addEventListener("close", () => { state.editing = null; });
  form.url.addEventListener("input", checkDuplicate);
  form.url.addEventListener("blur", () => {
    if (form.url.value.trim()) form.url.value = normalizeUrl(form.url.value);
    checkDuplicate();
    if (!form.name.value.trim() && form.url.value) fetchTitle(false);
  });
  form.tags.addEventListener("input", suggestTags);
  $("#tag-suggest").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-tag]");
    if (!b) return;
    const parts = form.tags.value.split(/[\s,]+/).filter(Boolean);
    if (!/[\s,]$/.test(form.tags.value) && parts.length) parts.pop();
    parts.push(b.dataset.tag);
    form.tags.value = parts.join(" ") + " ";
    form.tags.focus();
    suggestTags();
  });

  async function fetchTitle(force) {
    const url = normalizeUrl(form.url.value);
    if (!Model.validUrl(url)) return;
    const btn = $("#fetch-title");
    btn.disabled = true;
    try {
      const res = await api("/api/title?url=" + encodeURIComponent(url));
      const { title, description } = await res.json();
      if (title && (force || !form.name.value.trim())) form.name.value = title;
      if (description && (force || !form.description.value.trim())) form.description.value = description;
    } catch (_) { /* offline: leave it */ }
    btn.disabled = false;
  }
  $("#fetch-title").addEventListener("click", () => fetchTitle(true));

  // ---- folder actions ----
  async function folderAction(act, path) {
    if (act === "sub") {
      const name = Model.cleanFolderName(await ask({ message: t("prompt.folderName"), value: "" }) || "");
      if (!name) return;
      const p = path.concat(name);
      commit((m) => Model.addFolder(m, p)).then(() => selectFolder(p));
    } else if (act === "rename") {
      const old = path[path.length - 1];
      const name = Model.cleanFolderName(await ask({ message: t("prompt.renameFolder", { name: old }), value: old }) || "");
      if (!name || name === old) return;
      const p = path.slice(0, -1).concat(name);
      if (state.folder && within(state.folder, path)) state.folder = p.concat(state.folder.slice(path.length));
      commit((m) => Model.renameFolder(m, path, name));
    } else if (act === "delete") {
      const f = Model.findFolder(state.model, path);
      const count = f ? Model.countEntries(f) : 0;
      if (!await confirmDelete(t("confirm.deleteFolder", { name: path[path.length - 1], count }))) return;
      if (within(state.folder || [], path) && state.folder) state.folder = null;
      commit((m) => Model.deleteFolder(m, path));
    }
  }

  // ---- events ----
  $("#tree").addEventListener("click", (ev) => {
    const r = ev.target.closest(".tree-row");
    if (!r) return;
    const path = Model.splitPath(r.dataset.path);
    const act = ev.target.closest("[data-act]");
    if (act && act.dataset.act === "toggle") {
      const k = pathKey(path);
      state.collapsed.has(k) ? state.collapsed.delete(k) : state.collapsed.add(k);
      store.set("collapsed", [...state.collapsed]);
      renderTree();
      return;
    }
    if (act) { folderAction(act.dataset.act, path); return; }
    selectFolder(path.length ? path : null);
  });
  $("#tree").addEventListener("keydown", (ev) => {
    const r = ev.target.closest(".tree-row");
    if (!r) return;
    const rows = [...document.querySelectorAll("#tree .tree-row")];
    const i = rows.indexOf(r);
    const path = Model.splitPath(r.dataset.path);
    const k = pathKey(path);
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectFolder(path.length ? path : null); focusRow(k); }
    else if (ev.key === "ArrowDown" && rows[i + 1]) { ev.preventDefault(); rows[i + 1].focus(); }
    else if (ev.key === "ArrowUp" && rows[i - 1]) { ev.preventDefault(); rows[i - 1].focus(); }
    else if (ev.key === "ArrowRight" && state.collapsed.has(k)) { state.collapsed.delete(k); store.set("collapsed", [...state.collapsed]); renderTree(); focusRow(k); }
    else if (ev.key === "ArrowLeft" && path.length && !state.collapsed.has(k) && r.hasAttribute("aria-expanded")) { state.collapsed.add(k); store.set("collapsed", [...state.collapsed]); renderTree(); focusRow(k); }
  });
  const focusRow = (k) => { const el = [...document.querySelectorAll("#tree .tree-row")].find((x) => x.dataset.path === k); if (el) el.focus(); };

  // Drag a card or a folder onto a folder in the tree to move it there.
  let dragged = null;
  document.addEventListener("dragstart", (ev) => {
    if (readOnly) return;
    const card = ev.target.closest && ev.target.closest(".card");
    const row = ev.target.closest && ev.target.closest(".tree-row");
    if (card) { dragged = { id: card.dataset.id }; card.classList.add("dragging"); }
    else if (row && row.dataset.path) dragged = { path: Model.splitPath(row.dataset.path) };
    else return;
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", card ? (Model.locate(state.model, card.dataset.id) || {}).entry?.url || "" : row.dataset.path);
  });
  document.addEventListener("dragend", () => {
    dragged = null;
    document.querySelectorAll(".dragging, .drop").forEach((el) => el.classList.remove("dragging", "drop"));
  });
  $("#tree").addEventListener("dragover", (ev) => {
    const r = ev.target.closest(".tree-row");
    if (!dragged || !r) return;
    if (dragged.path && within(Model.splitPath(r.dataset.path), dragged.path)) return;
    ev.preventDefault();
    document.querySelectorAll(".drop").forEach((el) => el !== r && el.classList.remove("drop"));
    r.classList.add("drop");
  });
  $("#tree").addEventListener("dragleave", (ev) => {
    const r = ev.target.closest(".tree-row");
    if (r && !r.contains(ev.relatedTarget)) r.classList.remove("drop");
  });
  $("#tree").addEventListener("drop", (ev) => {
    const r = ev.target.closest(".tree-row");
    if (!dragged || !r) return;
    ev.preventDefault();
    const dest = Model.splitPath(r.dataset.path);
    const d = dragged;
    if (d.id) commit((m) => Model.updateEntry(m, d.id, {}, dest));
    else if (d.path) {
      if (state.folder && within(state.folder, d.path)) state.folder = dest.concat(state.folder.slice(d.path.length - 1));
      commit((m) => Model.moveFolder(m, d.path, dest));
    }
  });

  $("#list").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.tag) toggleTag(b.dataset.tag);
    else if (b.dataset.path !== undefined && b.classList.contains("folder")) selectFolder(Model.splitPath(b.dataset.path));
    else if (b.dataset.act === "edit") openEditor((Model.locate(state.model, b.dataset.id) || {}).entry);
    else if (b.dataset.act === "delete") {
      const loc = Model.locate(state.model, b.dataset.id);
      if (loc) confirmDelete(t("confirm.deleteBookmark", { name: loc.entry.name })).then((yes) => yes && commit((m) => Model.deleteEntry(m, b.dataset.id)));
    }
  });
  $("#tags").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-tag]");
    if (b) toggleTag(b.dataset.tag);
  });
  $("#crumbs").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (b) selectFolder(b.dataset.path ? Model.splitPath(b.dataset.path) : null);
  });

  let searchTimer = null;
  $("#search").addEventListener("input", (ev) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = ev.target.value; render(); }, state.view === "graph" ? 200 : 60);
  });
  $("#search").addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { setQuery(""); ev.target.blur(); }
    if (ev.key === "Enter") {
      const first = document.querySelector("#list .card a.name");
      if (first && state.view === "list") window.open(first.href, "_blank", "noopener");
    }
  });
  $("#view-list").addEventListener("click", () => setView("list"));
  $("#view-graph").addEventListener("click", () => setView("graph"));
  $("#add-btn").addEventListener("click", () => openEditor(null));
  $("#new-folder").addEventListener("click", () => folderAction("sub", state.folder || []));
  $("#theme-btn").addEventListener("click", () => {
    state.theme = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
    themeStore.set(state.theme);
    applyTheme();
  });
  $("#menu-btn").addEventListener("click", () => document.body.classList.toggle("side-open"));
  $("#scrim").addEventListener("click", () => document.body.classList.remove("side-open"));

  const langSel = $("#lang");
  langSel.innerHTML = i18n.languages().map((l) => `<option value="${esc(l.code)}">${esc(l.name)}</option>`).join("");
  langSel.addEventListener("change", () => {
    store.set("lang", langSel.value);
    i18n.setLang(langSel.value);
    applyLanguage();
  });

  document.addEventListener("keydown", (ev) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || dialog.open || $("#ask").open;
    if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "/") { ev.preventDefault(); $("#search").focus(); }
    else if (ev.key === "n" && !readOnly) { ev.preventDefault(); openEditor(null); }
    else if (ev.key === "g") setView(state.view === "list" ? "graph" : "list");
  });

  // ---- start ----
  if (!readOnly) {
    // Bookmarklet: opens this page in a small window with the current page prefilled.
    const code = `(function(){window.open('${location.origin}/?popup=1&add='+encodeURIComponent(location.href)+'&name='+encodeURIComponent(document.title),'bookmarks','width=580,height=680')})()`;
    $("#bookmarklet").href = "javascript:" + code;
    $("#bookmarklet").addEventListener("click", (ev) => ev.preventDefault());
  }

  i18n.setLang(store.get("lang", null) || i18n.pick(navigator.languages || [navigator.language]));
  langSel.value = i18n.lang;
  applyLanguage();
  listen();

  // ?add=<url>&name=<title>: open the editor prefilled (used by the bookmarklet).
  const params = new URLSearchParams(location.search);
  if (!readOnly && params.has("add")) {
    const url = params.get("add");
    const existing = Model.allEntries(state.model).find(({ entry }) => entry.url === url);
    openEditor(existing ? existing.entry : null, { url, name: params.get("name") || "" });
    if (!params.has("popup")) history.replaceState(null, "", location.pathname);
  }
})();
