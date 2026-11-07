// Graph view: folders, bookmarks and tags as dots joined by lines, laid out by
// a d3 force simulation so related things cluster. Hover a dot to highlight its
// neighbours, click for details, double-click to open (bookmark) or go to it.
// Zooming in spreads the dots apart (as in Obsidian and project3): dots grow by
// k^0.4 on screen and names by k^0.2, lines stay thin. Opening the view, the dots
// spread out from the middle into place (not with reduced motion).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GraphView = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // nodes/links for the entries shown (with their folders up to the root, and their tags).
  function buildGraph(title, shown) {
    const nodes = new Map();
    const links = [];
    const add = (id, kind, label, extra) => {
      if (!nodes.has(id)) nodes.set(id, Object.assign({ id, kind, label }, extra));
      return nodes.get(id);
    };
    const link = (a, b) => links.push({ source: a, target: b, key: a + "→" + b });
    add("root", "root", title, { path: [] });
    const seenLink = new Set();
    const linkOnce = (a, b) => { const k = a + "→" + b; if (!seenLink.has(k)) { seenLink.add(k); link(a, b); } };
    for (const { entry, path } of shown) {
      let parent = "root";
      path.forEach((name, i) => {
        const p = path.slice(0, i + 1);
        const id = "f:" + p.join("/");
        add(id, "folder", name, { path: p });
        linkOnce(parent, id);
        parent = id;
      });
      add("b:" + entry.id, "bookmark", entry.name, { entry, path });
      linkOnce(parent, "b:" + entry.id);
      for (const t of entry.tags) {
        add("t:" + t, "tag", "#" + t, { tag: t });
        linkOnce("b:" + entry.id, "t:" + t);
      }
    }
    return { nodes: [...nodes.values()], links };
  }

  const RADIUS = { root: 11, folder: 8, tag: 6, bookmark: 4.5 };

  const f = (v) => +v.toFixed(2);
  const reducedMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  function create(container, { t, onOpen, onFolder, onTag, onEdit }) {
    const d3 = window.d3;
    container.innerHTML = "";
    const svg = d3.select(container).append("svg");
    const layer = svg.append("g");
    const linkG = layer.append("g");
    const nodeG = layer.append("g");
    const legend = d3.select(container).append("div").attr("class", "g-legend");
    const fitBtn = d3.select(container).append("button").attr("class", "g-fit").attr("type", "button").text("⤢")
      .on("click", () => fit(true));
    const hint = d3.select(container).append("div").attr("class", "g-hint");
    const panel = d3.select(container).append("div").attr("class", "g-panel").attr("hidden", true);

    let positions = new Map(); // keep the layout steady between updates
    let sim = null;
    let selected = null;
    let current = { nodes: [], links: [] };
    let neighbours = new Map();
    let entering = null; // the opening animation's timer

    // gs: how much smaller than the zoom the dots are drawn (dots grow by k^0.4 on screen);
    // gt: the same for names (k^0.2). Lines follow gs through --gs; names inside a dot's
    // group are already scaled by gs, so they get --tl = gt / gs.
    let zoomK = 1, gs = 1;
    const zoom = d3.zoom().scaleExtent([0.1, 8]).on("zoom", (ev) => {
      layer.attr("transform", ev.transform);
      if (Math.abs(ev.transform.k - zoomK) > 0.01) {
        zoomK = ev.transform.k;
        gs = zoomK > 1 ? zoomK ** -0.6 : 1;
        const gt = zoomK > 1 ? zoomK ** -0.8 : 1;
        svg.style("--gs", f(gs)).style("--tl", f(gt / gs));
        container.classList.toggle("zoomed", zoomK > 1.15);
        draw();
      }
    });
    svg.call(zoom).on("dblclick.zoom", null);
    svg.on("click", (ev) => { if (ev.target === svg.node()) select(null); });

    function labels() {
      legend.html(["root", "folder", "bookmark", "tag"].slice(1)
        .map((k) => `<span><i style="background:var(--g-${k})"></i>${t("graph." + k)}</span>`).join(""));
      hint.text(t("graph.hint"));
      fitBtn.attr("title", t("graph.fit")).attr("aria-label", t("graph.fit"));
      if (selected) showPanel(selected);
    }

    function shape(sel) {
      sel.each(function (d) {
        const g = d3.select(this);
        const r = RADIUS[d.kind];
        if (d.kind === "folder") g.append("rect").attr("class", "shape").attr("x", -r).attr("y", -r).attr("width", 2 * r).attr("height", 2 * r).attr("rx", 2.5);
        else if (d.kind === "tag") g.append("path").attr("class", "shape").attr("d", `M0,${-r * 1.25}L${r * 1.15},0L0,${r * 1.25}L${-r * 1.15},0Z`);
        else g.append("circle").attr("class", "shape").attr("r", r);
        g.append("text").attr("x", r + 4).attr("y", 4).text(d.label.length > 40 ? d.label.slice(0, 39) + "…" : d.label);
      });
    }

    let links = linkG.selectAll("line"), nodes = nodeG.selectAll("g.g-node");
    function draw() {
      links.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
      nodes.attr("transform", (d) => `translate(${f(d.x)},${f(d.y)})` + (gs < 1 ? ` scale(${f(gs)})` : ""));
      for (const n of current.nodes) positions.set(n.id, { x: n.x, y: n.y });
    }

    // update(title, shown, { enter }): enter = the view was just opened, so animate it in.
    function update(title, shown, opts = {}) {
      const graph = buildGraph(title, shown);
      const byId = new Map(graph.nodes.map((n) => [n.id, n]));
      let known = 0;
      for (const n of graph.nodes) {
        const p = positions.get(n.id);
        if (p) { Object.assign(n, { x: p.x, y: p.y, vx: 0, vy: 0 }); known++; }
      }
      // New dots start next to what they hang from, not at a random spot.
      for (const l of graph.links) {
        const s = byId.get(l.source), tg = byId.get(l.target);
        if (s.x !== undefined && tg.x === undefined) Object.assign(tg, { x: s.x + (Math.random() - 0.5) * 30, y: s.y + (Math.random() - 0.5) * 30 });
      }
      const fresh = known === 0;
      const same = known === graph.nodes.length && graph.nodes.length === current.nodes.length;
      current = graph;
      neighbours = new Map(graph.nodes.map((n) => [n.id, new Set()]));
      for (const l of graph.links) { neighbours.get(l.source).add(l.target); neighbours.get(l.target).add(l.source); }

      links = linkG.selectAll("line").data(graph.links, (d) => d.key)
        .join("line").attr("class", "g-link");
      nodes = nodeG.selectAll("g.g-node").data(graph.nodes, (d) => d.id)
        .join((enter) => enter.append("g").call(shape))
        .attr("class", (d) => `g-node ${d.kind}`)
        .on("mouseenter", (ev, d) => highlight(d))
        .on("mouseleave", () => highlight(selected))
        .on("click", (ev, d) => { ev.stopPropagation(); select(d); })
        .on("dblclick", (ev, d) => { ev.stopPropagation(); activate(d); })
        .call(d3.drag()
          .on("start", (ev, d) => { if (!ev.active) sim.alphaTarget(0.2).restart(); d.fx = d.x; d.fy = d.y; })
          .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
          .on("end", (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
      nodes.select("text").text((d) => (d.label.length > 40 ? d.label.slice(0, 39) + "…" : d.label));

      if (sim) sim.stop();
      if (entering) { entering.stop(); entering = null; }
      sim = d3.forceSimulation(graph.nodes)
        .force("link", d3.forceLink(graph.links).id((d) => d.id)
          .distance((l) => (l.target.kind === "tag" ? 60 : l.target.kind === "bookmark" ? 34 : 70))
          .strength((l) => (l.target.kind === "tag" ? 0.25 : 0.8)))
        .force("charge", d3.forceManyBody().strength((d) => (d.kind === "bookmark" ? -40 : -160)))
        .force("x", d3.forceX(0).strength(0.04))
        .force("y", d3.forceY(0).strength(0.04))
        .force("collide", d3.forceCollide((d) => RADIUS[d.kind] + 3))
        .alpha(fresh ? 1 : same ? 0.05 : 0.3)
        .alphaDecay(0.03)
        .on("tick", draw);
      // The first time (and when opening the view): laid out before it's shown, so nothing
      // flies in from a corner, then fitted to the window.
      if (fresh || opts.enter) {
        sim.stop();
        if (!fresh && known < graph.nodes.length) sim.alpha(0.5);
        // Dots that are new since last time (e.g. the search changed in the list) settle first too.
        if (known < graph.nodes.length) for (let i = 0; i < 300 && sim.alpha() > 0.02; i++) sim.tick();
        draw();
        fit(false);
        if (opts.enter && !reducedMotion()) enterAnimation();
        else sim.alpha(0.02).restart();
      }
      if (selected) selected = graph.nodes.find((n) => n.id === selected.id) || null;
      select(selected);
      labels();
    }

    // Every dot starts bunched up in the middle and spreads out to its place, the ones near the
    // middle first, over about a second; then the forces take over again, gently.
    const ENTER_MS = 1100, STAGGER = 0.35;
    function enterAnimation() {
      const ns = current.nodes;
      if (!ns.length) return;
      const cx = d3.mean(ns, (n) => n.x), cy = d3.mean(ns, (n) => n.y);
      const far = d3.max(ns, (n) => Math.hypot(n.x - cx, n.y - cy)) || 1;
      const moves = ns.map((n) => {
        const a = Math.random() * 2 * Math.PI, j = 6 + Math.random() * 10;
        return { n, x: n.x, y: n.y, x0: cx + (n.x - cx) * 0.08 + Math.cos(a) * j, y0: cy + (n.y - cy) * 0.08 + Math.sin(a) * j,
          delay: (Math.hypot(n.x - cx, n.y - cy) / far) * STAGGER };
      });
      const place = (p) => {
        for (const m of moves) {
          const e = d3.easeCubicOut(Math.max(0, Math.min(1, (p - m.delay) / (1 - STAGGER))));
          m.n.x = m.x0 + (m.x - m.x0) * e;
          m.n.y = m.y0 + (m.y - m.y0) * e;
        }
        draw();
      };
      place(0);
      entering = d3.timer((elapsed) => {
        const p = Math.min(1, elapsed / ENTER_MS);
        place(p);
        if (p === 1) { entering.stop(); entering = null; sim.alpha(0.06).restart(); }
      });
    }

    // The whole graph in view (the ⤢ button, and when the view opens).
    function fit(animate) {
      const ns = current.nodes;
      if (!ns.length) return;
      const w = container.clientWidth || 800, h = container.clientHeight || 600;
      const xs = ns.map((n) => n.x), ys = ns.map((n) => n.y);
      const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + 120, y0 = Math.min(...ys) - 30, y1 = Math.max(...ys) + 30;
      const k = Math.max(0.1, Math.min(2, 0.95 * Math.min(w / (x1 - x0), h / (y1 - y0))));
      const tr = d3.zoomIdentity.translate(w / 2 - (k * (x0 + x1)) / 2, h / 2 - (k * (y0 + y1)) / 2).scale(k);
      if (animate && !reducedMotion()) svg.transition().duration(400).call(zoom.transform, tr);
      else svg.call(zoom.transform, tr);
    }

    function highlight(d) {
      const near = d ? neighbours.get(d.id) || new Set() : null;
      nodeG.selectAll("g.g-node")
        .classed("dim", (n) => !!d && n.id !== d.id && !near.has(n.id))
        .classed("hl", (n) => !!d && near.has(n.id))
        .classed("sel", (n) => !!selected && n.id === selected.id);
      linkG.selectAll("line")
        .classed("hl", (l) => !!d && (l.source.id === d.id || l.target.id === d.id))
        .classed("dim", (l) => !!d && l.source.id !== d.id && l.target.id !== d.id);
    }

    function select(d) {
      selected = d;
      highlight(d);
      if (d) showPanel(d);
      else panel.attr("hidden", true);
    }

    function activate(d) {
      if (d.kind === "bookmark") onOpen(d.entry);
      else if (d.kind === "folder" || d.kind === "root") onFolder(d.path);
      else if (d.kind === "tag") onTag(d.tag);
    }

    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

    function showPanel(d) {
      const kind = d.kind === "root" ? t("tree.all") : t("graph." + d.kind);
      let html = `<button class="close" data-act="close" aria-label="×">×</button><div class="kind">${esc(kind)}</div><h3>${esc(d.label)}</h3>`;
      if (d.kind === "bookmark") {
        html += `<div class="url"><a href="${esc(d.entry.url)}" target="_blank" rel="noopener noreferrer">${esc(d.entry.url)}</a></div>`;
        if (d.entry.description) html += `<p>${esc(d.entry.description)}</p>`;
        html += `<p><button data-act="open">${esc(t("action.open"))}</button> <button class="edit-only" data-act="edit">${esc(t("action.edit"))}</button></p>`;
      } else {
        html += `<p><button data-act="go">${esc(t("view.list"))} →</button></p>`;
      }
      const near = [...(neighbours.get(d.id) || [])].map((id) => current.nodes.find((n) => n.id === id)).filter(Boolean);
      if (near.length) {
        html += `<div class="kind">${esc(t("graph.links"))} (${near.length})</div><ul>` +
          near.slice(0, 200).map((n) => `<li><button data-id="${esc(n.id)}">${esc(n.label)}</button></li>`).join("") + "</ul>";
      }
      panel.html(html).attr("hidden", null);
      panel.selectAll("button").on("click", function (ev) {
        ev.stopPropagation();
        const act = this.dataset.act, id = this.dataset.id;
        if (act === "close") select(null);
        else if (act === "open") onOpen(d.entry);
        else if (act === "edit") onEdit(d.entry);
        else if (act === "go") activate(d);
        else if (id) {
          const n = current.nodes.find((x) => x.id === id);
          if (n) { select(n); centerOn(n); }
        }
      });
    }

    // Pan (not zoom) so a node is in the middle.
    function centerOn(n) {
      svg.transition().duration(reducedMotion() ? 0 : 350).call(zoom.translateTo, n.x, n.y, [container.clientWidth / 2, container.clientHeight / 2]);
    }

    return {
      update, labels, fit,
      stop: () => { if (sim) sim.stop(); if (entering) { entering.stop(); entering = null; } },
    };
  }

  return { create, buildGraph };
});
