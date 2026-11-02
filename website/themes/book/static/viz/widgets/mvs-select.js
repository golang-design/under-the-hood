/*
 * mvs-select: Minimal Version Selection on the module graph from the Go
 * modules reference (book §17.3).
 *
 * The algorithms are those of src/cmd/go/internal/mvs/mvs.go in Go 1.26,
 * transcribed step for step:
 *   buildList   visit every module version reachable from the target once,
 *               and let Graph.Require (graph.go) raise the selected version
 *               of each required path to the maximum seen; the optional
 *               upgrade hook prepends the upgraded version to a module's
 *               requirements, which is how Upgrade and UpgradeAll add edges;
 *   UpgradeAll  upgrade hook = latest version of every visited path;
 *   Upgrade     upgrade hook = the requested versions; the target's own
 *               requirements are kept (override), so no edge is removed;
 *   Downgrade   the add/exclude recursion over BuildList(target)[1:],
 *               walking each excluded version back with Previous, then a
 *               final buildList over the downgraded requirements;
 *   Req         Algorithm R: reverse postorder, keeping only versions not
 *               already implied, with the given base paths listed first.
 * The real buildList runs up to ten goroutines over a par.Work queue, so
 * its visiting order varies; here the queue is first-in first-out. The
 * result does not depend on the order, which is the point of MVS.
 *
 * The core was checked against every build/upgrade/downgrade/req case in
 * mvs_test.go. The graph is the one drawn in the reference manual
 * (go.dev/ref/mod#minimal-version-selection). Recreated with local replace
 * directives (main module at go 1.16, so the graph is not pruned), Go
 * 1.26.10 gives the same build lists and go.mod requirements for
 * `go get example.com/b@v1.3.0`, `go get example.com/c@v1.3.0` and
 * `go get example.com/c@none`. In 1.26, `go get` edits requirements through
 * modload.editRequirements rather than calling mvs.Upgrade/Downgrade
 * directly; the outcomes agree on this graph. The base paths given to Req
 * are the main module's direct requirements plus the module named in the
 * operation, as `go get` keeps the latter in go.mod.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;

  // ---- core (mvs.go and graph.go) -------------------------------------
  // A module version is {p: path, v: version}. "none" is the special
  // version meaning "not required"; the target's version compares highest.
  function key(m) { return m.p + " " + m.v; }
  function mod(p, v) { return { p: p, v: v }; }

  // reqs: { graph: {key: [module]}, max(p, v1, v2) }
  function Reqs(graph, max) {
    var byPath = {};
    Object.keys(graph).forEach(function (k) {
      var i = k.indexOf(" "), p = k.slice(0, i), v = k.slice(i + 1);
      (byPath[p] = byPath[p] || []).push(v);
    });
    return {
      max: max,
      required: function (m) { var r = graph[key(m)]; return r === undefined ? null : r; },
      // latest known version of the path (reqsMap.Upgrade in mvs_test.go)
      upgrade: function (m) {
        var u = "none";
        (byPath[m.p] || []).forEach(function (v) { if (!/\.hidden$/.test(v) && max(m.p, u, v) === v) u = v; });
        return u === "none" ? null : mod(m.p, u);
      },
      // version immediately before m (reqsMap.Previous)
      previous: function (m) {
        var best = null;
        (byPath[m.p] || []).forEach(function (v) {
          if (/\.hidden$/.test(v)) return;
          if (max(m.p, v, m.v) === m.v && v !== m.v && (best === null || max(m.p, best, v) === v)) best = v;
        });
        return mod(m.p, best === null ? "none" : best);
      },
      versions: function (p) { return (byPath[p] || []).slice(); },
    };
  }

  function buildList(targets, reqs, upgrade, override, trace) {
    var max = reqs.max;
    function cmp(p, v1, v2) {
      if (max(p, v1, v2) !== v1) return -1;
      if (max(p, v2, v1) !== v2) return 1;
      return 0;
    }
    function required(m) { return override && key(m) === key(override.target) ? override.list : reqs.required(m); }
    var selected = {}, reachable = {}, required_ = {}, queue = [], added = {};
    function sel(p) { return selected[p] === undefined ? "none" : selected[p]; }
    targets.forEach(function (t) {
      reachable[key(t)] = true;
      if (cmp(t.p, sel(t.p), t.v) < 0) selected[t.p] = t.v;
      if (!added[key(t)]) { added[key(t)] = true; queue.push(t); }
    });
    while (queue.length) {
      var m = queue.shift(), req = [], err = false;
      if (m.v !== "none") {
        var r = required(m);
        if (r === null) err = true; else req = r.slice();
      }
      var u = m, up = null;
      if (upgrade) { var t = upgrade(m); if (t) u = t; }
      if (key(u) !== key(m)) { up = u; req = [u].concat(req); }
      var changed = [];
      // Graph.Require
      required_[key(m)] = req;
      req.forEach(function (dep) {
        reachable[key(dep)] = true;
        if (cmp(dep.p, sel(dep.p), dep.v) < 0) { changed.push({ p: dep.p, from: sel(dep.p), to: dep.v }); selected[dep.p] = dep.v; }
      });
      req.forEach(function (dep) { if (!added[key(dep)]) { added[key(dep)] = true; queue.push(dep); } });
      if (trace) trace.push({ k: "visit", m: m, req: req, up: up, err: err, changed: changed,
        sel: Object.assign({}, selected), queue: queue.slice() });
    }
    // Graph.BuildList: targets first, then the rest sorted by path
    var list = [], seen = {};
    targets.forEach(function (t) {
      if (seen[t.p]) return;
      seen[t.p] = true;
      if (sel(t.p) !== "none") list.push(mod(t.p, sel(t.p)));
    });
    var rest = Object.keys(selected).filter(function (p) { return !seen[p]; }).sort();
    rest.forEach(function (p) { list.push(mod(p, selected[p])); });
    return { list: list, reachable: reachable, required: required_ };
  }

  function upgradeAll(target, reqs, trace) {
    return buildList([target], reqs, function (m) {
      if (m.p === target.p) return target;
      return reqs.upgrade(m);
    }, null, trace);
  }

  function upgradeTo(target, reqs, ups, trace) {
    var list = (reqs.required(target) || []).slice(), inList = {}, to = {};
    list.forEach(function (m) { inList[m.p] = true; });
    ups.forEach(function (u) {
      if (!inList[u.p]) list.push(mod(u.p, "none"));
      to[u.p] = to[u.p] === undefined ? u.v : reqs.max(u.p, to[u.p], u.v);
    });
    return buildList([target], reqs, function (m) {
      return to[m.p] !== undefined ? mod(m.p, to[m.p]) : m;
    }, { target: target, list: list }, trace);
  }

  // Downgrade. dtrace receives the add/exclude/previous events; trace the
  // final traversal.
  function downgrade(target, reqs, downs, dtrace, trace) {
    var max = reqs.max;
    var list = buildList([target], reqs).list.slice(1);
    var mx = {};
    list.forEach(function (r) { mx[r.p] = r.v; });
    downs.forEach(function (d) {
      if (mx[d.p] === undefined || max(d.p, mx[d.p], d.v) !== d.v) mx[d.p] = d.v;
    });
    var added = {}, rdeps = {}, excluded = {};
    function exclude(m, why) {
      if (excluded[key(m)]) return;
      excluded[key(m)] = why || true;
      (rdeps[key(m)] || []).forEach(function (p) { exclude(p, { dep: m }); });
    }
    function add(m) {
      if (added[key(m)]) return;
      added[key(m)] = true;
      if (mx[m.p] !== undefined && max(m.p, m.v, mx[m.p]) !== mx[m.p]) { exclude(m, { above: mx[m.p] }); return; }
      var rl = reqs.required(m);
      if (rl === null) { exclude(m, { missing: true }); return; }
      for (var i = 0; i < rl.length; i++) {
        var r = rl[i];
        add(r);
        if (excluded[key(r)]) { exclude(m, { dep: r }); return; }
        (rdeps[key(r)] = rdeps[key(r)] || []).push(m);
      }
    }
    var downgraded = [target];
    list.forEach(function (r0) {
      var r = r0, tried = [];
      add(r);
      while (excluded[key(r)]) {
        tried.push({ m: r, why: excluded[key(r)] });
        var p = reqs.previous(r), v = mx[r.p];
        if (max(r.p, v, r.v) !== v && max(r.p, p.v, v) !== p.v) p = mod(p.p, v);
        if (p.v === "none") { r = null; break; }
        add(p);
        r = p;
      }
      if (dtrace) dtrace.push({ k: "check", from: r0, tried: tried, to: r, excluded: Object.assign({}, excluded) });
      if (r) downgraded.push(r);
    });
    var actual = buildList([target], reqs, null, { target: target, list: downgraded.slice(1) }).list;
    var av = {};
    actual.forEach(function (m) { av[m.p] = m.v; });
    var down2 = [];
    list.forEach(function (m) { if (av[m.p] !== undefined) down2.push(mod(m.p, av[m.p])); });
    var res = buildList([target], reqs, null, { target: target, list: down2 }, trace);
    res.excluded = excluded;
    res.override = down2;
    return res;
  }

  // Algorithm R. reqOf(m) returns m's requirements (main's are not used).
  function req(main, base, list, reqOf) {
    var mx = {};
    list.forEach(function (m) { mx[m.p] = m.v; });
    var post = [], cache = {};
    cache[key(main)] = [];
    function walk(m) {
      if (cache[key(m)] !== undefined) return;
      var r = reqOf(m) || [];
      cache[key(m)] = r;
      r.forEach(walk);
      post.push(m);
    }
    list.forEach(walk);
    var have = {};
    function walk2(m) {
      if (have[key(m)]) return;
      have[key(m)] = true;
      (cache[key(m)] || []).forEach(walk2);
    }
    var min = [], hb = {};
    base.forEach(function (p) {
      if (hb[p]) return;
      var m = mod(p, mx[p]);
      min.push(m); walk2(m); hb[p] = true;
    });
    for (var i = post.length - 1; i >= 0; i--) {
      var m = post[i];
      if (mx[m.p] !== m.v) continue;
      if (!have[key(m)]) { min.push(m); walk2(m); }
    }
    min.sort(function (a, b) { return a.p < b.p ? -1 : a.p > b.p ? 1 : 0; });
    return min;
  }
  // ---- end core -------------------------------------------------------

  // The reference manual's graph. Version strings here are single-digit
  // minor versions, so string comparison orders them; "" is the main
  // module, which compares above every version.
  function maxv(p, a, b) {
    if (a === "none" || b === "") return b;
    if (b === "none" || a === "") return a;
    return a < b ? b : a;
  }
  var R = function (s) { return s ? s.split(" ").map(function (t) { return mod(t[0], t.slice(1)); }) : []; };
  var GRAPH = {
    "A 1.1": R("C1.1"), "A 1.2": R("C1.3"),
    "B 1.1": R(""), "B 1.2": R("C1.4"), "B 1.3": R("E1.1"),
    "C 1.1": R("D1.1"), "C 1.2": R("D1.1"), "C 1.3": R("D1.2"), "C 1.4": R("D1.2"),
    "D 1.1": R(""), "D 1.2": R(""), "D 1.3": R(""),
    "E 1.1": R("F1.1"), "F 1.1": R("E1.1"),
  };
  var MAIN = mod("main", "");
  var MAINREQ = R("A1.2 B1.2");
  var DIRECT = ["A", "B"];

  var OPS = [
    { id: "build", zh: "构造构建列表", en: "Compute the build list" },
    { id: "upall", zh: "全部升级到最新", en: "Upgrade all to latest" },
    { id: "upB", zh: "升级 B 到 1.3", en: "Upgrade B to 1.3", target: mod("B", "1.3") },
    { id: "downC", zh: "降级 C 到 1.3", en: "Downgrade C to 1.3", target: mod("C", "1.3") },
    { id: "rmC", zh: "移除 C（@none）", en: "Remove C (@none)", target: mod("C", "none") },
  ];
  var MONO = "font-family:var(--font-mono,monospace)";

  // Layout: each module's versions sit in one dashed group, as in the
  // reference manual's figures.
  var BW = 46, BH = 22, GAP = 14, PAD = 6;
  var GROUPS = { A: [10, 62], B: [196, 62], C: [10, 132], E: [318, 132], D: [70, 202], F: [318, 202] };
  var VERS = {};
  Object.keys(GRAPH).forEach(function (k) { var p = k[0]; (VERS[p] = VERS[p] || []).push(k.slice(2)); });
  var MAINBOX = { x: 186, y: 10, w: 64, h: BH };
  function box(m) {
    if (m.p === "main") return MAINBOX;
    var g = GROUPS[m.p], i = VERS[m.p].indexOf(m.v);
    return { x: g[0] + PAD + i * (BW + GAP), y: g[1] + PAD, w: BW, h: BH };
  }
  function name(m) { return m.p === "main" ? L("主模块", "main module") : m.p + " " + m.v; }
  function names(list) {
    var a = list.map(name);
    if (V.lang !== "en" || a.length < 2) return a.join("、");
    return a.slice(0, -1).join(", ") + (a.length > 2 ? "," : "") + " and " + a[a.length - 1];
  }

  function plan(op) {
    var g = Object.assign({}, GRAPH); g[key(MAIN)] = MAINREQ;
    var reqs = Reqs(g, maxv), steps = [], t = [], d = [], res, base = DIRECT.slice();
    var orig = buildList([MAIN], reqs).list;
    if (op.id === "build") res = buildList([MAIN], reqs, null, null, t);
    else if (op.id === "upall") res = upgradeAll(MAIN, reqs, t);
    else if (op.id === "upB") res = upgradeTo(MAIN, reqs, [op.target], t);
    else { res = downgrade(MAIN, reqs, [op.target], d, t); base.push(op.target.p); }
    if (d.length) {
      steps.push({ k: "start", sel: selOf(orig) });
      d.forEach(function (e) { steps.push({ k: "check", e: e }); });
    }
    var mainReq = op.id === "downC" || op.id === "rmC" ? res.override : MAINREQ;
    t.forEach(function (e, i) { steps.push({ k: "visit", e: e, i: i, mainReq: mainReq }); });
    var list = res.list, have = {};
    list.forEach(function (m) { have[m.p] = true; });
    var b = base.filter(function (p) { return have[p]; });
    var gomod = req(MAIN, b, list, function (m) { return reqs.required(m); });
    // For each indirect requirement, what would MVS pick without it?
    var why = gomod.filter(function (m) { return b.indexOf(m.p) < 0; }).map(function (m) {
      var g2 = Object.assign({}, GRAPH);
      g2[key(MAIN)] = gomod.filter(function (x) { return x !== m; });
      var bl = buildList([MAIN], Reqs(g2, maxv)).list, v = "none";
      bl.forEach(function (x) { if (x.p === m.p) v = x.v; });
      return { m: m, without: v };
    });
    var named = op.target && b.indexOf(op.target.p) >= 0 && DIRECT.indexOf(op.target.p) < 0 ? op.target.p : null;
    steps.push({ k: "result", list: list, gomod: gomod, why: why, named: named, mainReq: mainReq, visits: t });
    return { steps: steps, res: res, orig: orig, op: op, visits: t, checks: d };
  }
  function selOf(list) { var s = {}; list.forEach(function (m) { s[m.p] = m.v; }); return s; }

  V.register("mvs-select", function (host) {
    var p = V.panel(host, { title: L("最小版本选择：遍历、升级与降级", "Minimal version selection: traversal, upgrade and downgrade") });
    var root = V.svg("svg", { viewBox: "0 0 720 300", role: "img",
      "aria-label": L("模块版本图与构建列表", "Module version graph and build list") }, p.stage);
    var defs = V.svg("defs", null, root);
    [["line", "var(--viz-line)"], ["act", "var(--viz-muted)"], ["up", "var(--viz-c4)"]].forEach(function (a) {
      var mk = V.svg("marker", { id: "mvs-arrow-" + a[0], viewBox: "0 0 10 10", refX: 9, refY: 5,
        markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
      V.svg("path", { d: "M0,0 L10,5 L0,10 z", style: "fill:" + a[1] }, mk);
    });
    var gG = V.svg("g", null, root), gE = V.svg("g", null, root), gN = V.svg("g", null, root), gP = V.svg("g", null, root);

    var op = OPS[0], P, k = 0, timer = null;

    function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }
    function txt(g, x, y, s, style, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: style || "font-size:12px", text: s }, g);
    }
    function arrow(a, b, kind, dx) {
      var A = box(a), B = box(b), d;
      dx = dx || 0;
      if (kind === "up") { // same group, left to right
        d = "M" + (A.x + A.w) + "," + (A.y + A.h / 2) + " L" + (B.x - 1) + "," + (B.y + B.h / 2);
      } else if (B.y < A.y) { // F 1.1 -> E 1.1 points up
        d = "M" + (A.x + A.w / 2 + dx) + "," + A.y + " L" + (B.x + B.w / 2 + dx) + "," + (B.y + B.h + 1);
      } else {
        d = "M" + (A.x + A.w / 2 + dx) + "," + (A.y + A.h) + " L" + (B.x + B.w / 2 + dx) + "," + (B.y - 1);
      }
      if (a.p === "main" && b.p !== "A" && b.p !== "B") {
        // into the C or D row: run down the gap between the A and B
        // groups (and between C 1.3 and C 1.4) instead of across boxes
        var sx = A.x + A.w / 2 - 6, cx = B.x + B.w / 2;
        d = B.y < 180
          ? "M" + sx + "," + (A.y + A.h) + " C170,70 " + cx + ",100 " + cx + "," + (B.y - 1)
          : "M" + (sx + 10) + "," + (A.y + A.h) + " Q190,50 190,110 L190,168 Q190,192 " + (cx + 14) + "," + (B.y - 1);
      }
      var st = kind === "up" ? "stroke:var(--viz-c4);stroke-width:1.6;stroke-dasharray:4 2"
        : kind === "act" ? "stroke:var(--viz-muted);stroke-width:1.3"
        : kind === "gone" ? "stroke:var(--viz-muted);stroke-width:1;stroke-dasharray:2 3;opacity:.7"
        : "stroke:var(--viz-line);stroke-width:1";
      V.svg("path", { d: d, "marker-end": "url(#mvs-arrow-" + (kind === "up" ? "up" : kind === "act" ? "act" : "line") + ")",
        style: "fill:none;" + st }, gE);
    }

    // What the graph shows at step k.
    function state() {
      var s = { loaded: {}, sel: {}, cur: null, ups: [], excl: {}, mainReq: MAINREQ, phase: "idle", changed: {} };
      var st = k > 0 ? P.steps[k - 1] : null;
      if (!st) return s;
      s.phase = st.k;
      if (st.k === "start") { s.sel = st.sel; return s; }
      if (st.k === "check") {
        s.sel = selOf(P.orig); s.excl = st.e.excluded; s.cur = st.e.to; s.from = st.e.from;
        return s;
      }
      if (P.checks.length) s.excl = P.res.excluded;
      var upto = st.k === "visit" ? st.i : P.visits.length - 1;
      for (var i = 0; i <= upto; i++) {
        var e = P.visits[i];
        s.loaded[key(e.m)] = true;
        if (e.up) s.ups.push([e.m, e.up]);
      }
      s.mainReq = st.mainReq;
      if (st.k === "visit") {
        s.sel = st.e.sel; s.cur = st.e.m;
        st.e.changed.forEach(function (c) { s.changed[c.p] = c; });
      } else s.sel = selOf(st.list);
      return s;
    }

    function drawGraph(s) {
      clear(gG); clear(gE); clear(gN);
      Object.keys(GROUPS).forEach(function (pth) {
        var g = GROUPS[pth], n = VERS[pth].length;
        V.svg("rect", { x: g[0], y: g[1], width: n * BW + (n - 1) * GAP + 2 * PAD, height: BH + 2 * PAD, rx: 5,
          style: "fill:none;stroke:var(--viz-line);stroke-dasharray:3 3" }, gG);
      });
      // requirement edges; the ones read in this traversal are darker
      var replaced = s.mainReq !== MAINREQ;
      MAINREQ.forEach(function (r) {
        var still = s.mainReq.some(function (x) { return key(x) === key(r); });
        arrow(MAIN, r, still ? (s.loaded[key(MAIN)] || s.phase === "start" || s.phase === "check" ? "act" : "line") : "gone");
      });
      if (replaced) s.mainReq.forEach(function (r) {
        if (!MAINREQ.some(function (x) { return key(x) === key(r); })) arrow(MAIN, r, s.loaded[key(MAIN)] ? "act" : "line");
      });
      Object.keys(GRAPH).forEach(function (k0) {
        var m = mod(k0[0], k0.slice(2));
        GRAPH[k0].forEach(function (r) {
          var cyc = (m.p === "E" && r.p === "F") ? -6 : (m.p === "F" && r.p === "E") ? 6 : 0;
          arrow(m, r, s.loaded[k0] ? "act" : "line", cyc);
        });
      });
      s.ups.forEach(function (u) { arrow(u[0], u[1], "up"); });
      // version boxes
      var all = [MAIN].concat(Object.keys(GRAPH).map(function (k0) { return mod(k0[0], k0.slice(2)); }));
      all.forEach(function (m) {
        var b = box(m), kk = key(m), loaded = s.loaded[kk], ex = s.excl[kk];
        var isSel = m.p !== "main" && s.sel[m.p] === m.v && !ex, cur = s.cur && key(s.cur) === kk;
        var fill = ex ? "var(--viz-c2)" : loaded ? "var(--viz-c1)" : "var(--viz-fill)";
        var op_ = ex ? 0.12 : loaded ? 0.16 : 1;
        var stroke = isSel ? "var(--viz-c3)" : ex ? "var(--viz-c2)" : loaded ? "var(--viz-c1)" : "var(--viz-line)";
        if (cur) V.svg("rect", { x: b.x - 3, y: b.y - 3, width: b.w + 6, height: b.h + 6, rx: 6,
          style: "fill:none;stroke:var(--viz-c1);stroke-width:2" }, gN);
        V.svg("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 4,
          style: "fill:" + fill + ";fill-opacity:" + op_ + ";stroke:" + stroke + ";stroke-width:" + (isSel ? 2.4 : 1.1) }, gN);
        txt(gN, b.x + b.w / 2, b.y + 15, m.p === "main" ? "main" : m.p + " " + m.v,
          "font-size:12px;" + (isSel ? "font-weight:700;" : "") + (ex ? "fill:var(--viz-muted);" : ""), "middle");
        if (ex) V.svg("line", { x1: b.x + 4, y1: b.y + b.h - 4, x2: b.x + b.w - 4, y2: b.y + 4,
          style: "stroke:var(--viz-c2);stroke-width:2" }, gN);
      });
      // legend
      var items = [
        ["var(--viz-c1)", 0.16, "var(--viz-c1)", 1.1, L("已读取 go.mod", "go.mod read")],
        ["var(--viz-fill)", 1, "var(--viz-c3)", 2.4, L("所选版本", "selected version")],
        ["var(--viz-c2)", 0.12, "var(--viz-c2)", 1.1, L("已排除", "excluded")],
      ];
      var lx = 10, ly = 262;
      items.forEach(function (it, i) {
        V.svg("rect", { x: lx, y: ly - 10, width: 18, height: 12, rx: 3,
          style: "fill:" + it[0] + ";fill-opacity:" + it[1] + ";stroke:" + it[2] + ";stroke-width:" + it[3] }, gN);
        if (i === 2) V.svg("line", { x1: lx + 3, y1: ly, x2: lx + 15, y2: ly - 8, style: "stroke:var(--viz-c2);stroke-width:1.6" }, gN);
        txt(gN, lx + 24, ly, it[4], "font-size:11px;fill:var(--viz-muted)");
        lx += 24 + tw(it[4]) + 16;
      });
      V.svg("path", { d: "M" + lx + "," + (ly - 4) + " L" + (lx + 20) + "," + (ly - 4), "marker-end": "url(#mvs-arrow-up)",
        style: "stroke:var(--viz-c4);stroke-width:1.6;stroke-dasharray:4 2;fill:none" }, gN);
      txt(gN, lx + 26, ly, L("升级边", "upgrade edge"), "font-size:11px;fill:var(--viz-muted)");
      txt(gN, 10, 284, L("每条边表示一个 require：要求的是最低版本。", "Each edge is a require line: a minimum version."),
        "font-size:11px;fill:var(--viz-muted)");
    }
    function tw(s) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 11 : 6; return w; }

    var X = 420;
    function drawPanel(s) {
      clear(gP);
      var st = k > 0 ? P.steps[k - 1] : null, y = 20;
      function head(t) { txt(gP, X, y, t, "font-size:12px;font-weight:600"); y += 20; }
      if (P.checks.length && (!st || st.k === "start" || st.k === "check")) {
        var t = P.op.target;
        head(L("降级：", "Downgrade: ") + (t.v === "none" ? L("移除 " + t.p, "remove " + t.p) : t.p + " ≤ " + t.v));
        txt(gP, X, y, L("逐个检查原构建列表中的版本", "Check each version in the old build list"), "font-size:11px;fill:var(--viz-muted)");
        y += 20;
        var done = st && st.k === "check" ? P.checks.indexOf(st.e) : -1;
        P.checks.forEach(function (e, i) {
          var shown = i <= done;
          txt(gP, X, y, name(e.from), "font-size:12px;" + MONO + (shown ? "" : ";fill:var(--viz-muted)"));
          if (shown) {
            var kept = e.tried.length === 0, gone = !e.to;
            txt(gP, X + 56, y, "→", "font-size:12px;fill:var(--viz-muted)");
            txt(gP, X + 76, y, gone ? L("删去", "dropped") : name(e.to),
              "font-size:12px;" + MONO + ";fill:" + (kept ? "var(--viz-c3)" : "var(--viz-c2)"));
            txt(gP, 712, y, kept ? L("保留", "kept") : gone ? L("无可用的旧版本", "no older version fits") : L("改用旧版本", "older version"),
              "font-size:11px;fill:var(--viz-muted)", "end");
          }
          y += 20;
        });
        return;
      }
      if (!st || st.k === "visit") {
        head(L("待访问", "To visit"));
        var q = st ? st.e.queue : [MAIN], line = "", lines = [];
        q.forEach(function (m) {
          var piece = (line ? "  " : "") + name(m);
          if (tw(line + piece) > 280 && line) { lines.push(line); line = name(m); } else line += piece;
        });
        lines.push(line || L("（空）", "(empty)"));
        lines.slice(0, 2).forEach(function (l) { txt(gP, X, y, l, "font-size:12px;" + MONO); y += 17; });
        y += 10;
      } else {
        head(L("构建列表", "Build list"));
        txt(gP, X, y, names(st.list.slice(1)), "font-size:12px;" + MONO + ";font-weight:600");
        y += 27;
      }
      if (!st || st.k === "visit") {
        head(L("所选版本（各模块见过的最高版本）", "Selected (highest seen per module)"));
        ["A", "B", "C", "D", "E", "F"].forEach(function (pth, i) {
          var cx = X + (i % 3) * 98, cy = y + Math.floor(i / 3) * 20, v = s.sel[pth], c = s.changed[pth];
          txt(gP, cx, cy, pth, "font-size:12px;font-weight:600");
          txt(gP, cx + 14, cy, c ? (c.from === "none" ? "" : c.from + " → ") + c.to : v || "—",
            "font-size:12px;" + MONO + ";fill:" + (c ? "var(--viz-c1)" : v ? "var(--viz-ink)" : "var(--viz-muted)") + (c ? ";font-weight:600" : ""));
        });
        return;
      }
      head(L("写回 go.mod（算法 R）", "Written to go.mod (Algorithm R)"));
      txt(gP, X, y, "require (", "font-size:12px;" + MONO); y += 17;
      st.gomod.forEach(function (m) {
        var ind = DIRECT.indexOf(m.p) < 0;
        txt(gP, X + 18, y, m.p + " " + m.v + (ind ? " // indirect" : ""),
          "font-size:12px;" + MONO + (ind ? ";fill:var(--viz-c4)" : "")); y += 17;
      });
      txt(gP, X, y, ")", "font-size:12px;" + MONO);
    }

    function narrate(s) {
      var st = k > 0 ? P.steps[k - 1] : null, t;
      if (!st) {
        t = P.checks.length
          ? L("降级先在原构建列表上划去不合要求的版本，再重新遍历。按「下一步」开始。",
              "A downgrade first strikes out versions that no longer fit, then traverses again. Press Step to begin.")
          : L("从主模块出发，沿 require 边访问每一个可达的版本。按「下一步」开始。",
              "Starting from the main module, visit every version reachable along require edges. Press Step to begin.");
      } else if (st.k === "start") {
        t = L("原构建列表是 " + names(P.orig.slice(1)) + "。下面逐个检查其中的版本。",
          "The old build list is " + names(P.orig.slice(1)) + ". Next, check each of its versions.");
      } else if (st.k === "check") {
        var e = st.e, tgt = P.op.target, ex = e.excluded, parts = [], rm = tgt.v === "none";
        // why a version is out: above the limit, or it needs one that is
        var clause = function (x) {
          var w = x.why;
          if (w.above !== undefined) return rm ? L(x.m.p + " 要被移除", x.m.p + " is being removed")
            : L("它高于上限 " + w.above, "it is above the limit of " + w.above);
          var dw = ex[key(w.dep)], dep = name(w.dep);
          if (dw && dw.above !== undefined) return rm
            ? L("它要求的 " + dep + " 要被移除", "it requires " + dep + ", which is being removed")
            : L("它要求的 " + dep + " 高于上限 " + dw.above, "it requires " + dep + ", which is above the limit of " + dw.above);
          return L("它要求的 " + dep + " 已被排除", "it requires " + dep + ", which is excluded");
        };
        if (!e.tried.length) parts.push(L("检查 " + name(e.from) + "：它本身和它要求的版本都没有被排除，保留。",
          "Check " + name(e.from) + ": neither it nor anything it requires is excluded, so it is kept."));
        else {
          parts.push(L("检查 " + name(e.from) + "：" + clause(e.tried[0]) + "，因此 " + name(e.from) + " 被排除。",
            "Check " + name(e.from) + ": " + clause(e.tried[0]) + ", so " + name(e.from) + " is excluded."));
          var more = e.tried.slice(1);
          if (more.length > 1 && more.every(function (x) { return x.why.above !== undefined; }))
            parts.push(L("更早的 " + names(more.map(function (x) { return x.m; })) + " 同样被排除。",
              "The earlier " + names(more.map(function (x) { return x.m; })) + " are excluded as well."));
          else more.forEach(function (x) {
            parts.push(L("前一个版本 " + name(x.m) + " 同样被排除：" + clause(x) + "。",
              "The previous version, " + name(x.m) + ", is excluded too: " + clause(x) + "."));
          });
          parts.push(e.to ? L("改用前一个版本 " + name(e.to) + "，保留。", "The previous version, " + name(e.to) + ", is kept.")
            : L(e.from.p + " 没有可用的更早版本，这条要求被删去。", e.from.p + " has no earlier version that fits, so the requirement is dropped."));
        }
        t = parts.join(L("", " "));
      } else if (st.k === "visit") {
        var v = st.e, m = v.m, bits = [];
        if (m.p === "main") bits.push(L(P.checks.length ? "按降级后的要求重新遍历。主模块现在要求 " + names(v.req) + "。"
          : "主模块要求 " + names(v.req) + "。", P.checks.length ? "Traverse again with the downgraded requirements. The main module now requires " + names(v.req) + "."
          : "The main module requires " + names(v.req) + "."));
        else {
          var own = v.up ? v.req.slice(1) : v.req;
          bits.push(L("读取 " + name(m) + " 的 go.mod：" + (own.length ? "要求 " + names(own) + "。" : "没有要求。"),
            "Read the go.mod of " + name(m) + ": " + (own.length ? "it requires " + names(own) + "." : "no requirements.")));
          if (v.up) bits.push(L("升级目标是 " + name(v.up) + "，于是在它的要求前加上 " + name(v.up) + "（升级边），原有的边都保留。",
            "Its upgrade is " + name(v.up) + ", so " + name(v.up) + " is prepended to its requirements (an upgrade edge); no existing edge is removed."));
          var selNow = v.sel[m.p];
          if (selNow !== m.v && maxv(m.p, selNow, m.v) === selNow)
            bits.push(L(m.p + " 已有更高的 " + selNow + "，" + name(m) + " 不会被选中，但它的要求照样计入。",
              m.p + " already has the higher " + selNow + ", so " + name(m) + " will not be selected, but its requirements still count."));
        }
        if (v.changed.length) bits.push(L("所选版本：", "Selected: ") + v.changed.map(function (c) {
          return c.from === "none" ? c.p + " " + c.to : c.p + " " + c.from + " → " + c.to;
        }).join(L("，", ", ")) + L("。", "."));
        t = bits.join(L("", " "));
      } else {
        t = L("遍历结束，每个模块取见过的最高版本：" + names(st.list.slice(1)) + "。",
          "The traversal is done; each module gets the highest version seen: " + names(st.list.slice(1)) + ".");
        t += L("写回 go.mod 时，算法 R 只保留无法由其他要求推出的那些", " Algorithm R writes back only the requirements that no other requirement implies");
        if (st.why.length) t += L("；" + st.why.map(function (w) {
          return name(w.m) + " 是间接要求，删去它 " + w.m.p + (w.without === "none" ? " 就不再出现" : " 只会选到 " + w.without);
        }).join("；") + "。", "; " + st.why.map(function (w) {
          return name(w.m) + " is indirect, and without it " + w.m.p + (w.without === "none" ? " would drop out" : " would only get " + w.without);
        }).join("; ") + ".");
        else t += L("。", ".");
        if (P.checks.length && st.why.some(function (w) { return w.without === "none"; }))
          t += L("降级为原构建列表中的每个模块都确定一个版本，不只是主模块直接要求的那些，所以没有模块再要求的版本也会留下。",
            " A downgrade settles a version for every module in the old build list, not only the main module's direct requirements, so a version nothing else requires anymore can stay.");
        if (st.named) t += L(st.named + " 是这次操作点名的模块，与 go get 一样留在 go.mod 中。",
          " " + st.named + " is the module named in the operation, so it stays in go.mod, as go get does.");
        if (P.op.id === "build") t += L("实际实现最多以 10 个 goroutine 并行遍历，访问次序不固定，结果与次序无关。",
          " The real implementation traverses with up to 10 goroutines, so the order varies; the result does not.");
      }
      p.note.textContent = t;
    }

    function draw() {
      var s = state();
      drawGraph(s); drawPanel(s); narrate(s);
      stepBtn.disabled = k >= P.steps.length;
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } playBtn.textContent = L("自动播放", "Play"); }
    function reset() { stop(); P = plan(op); k = 0; draw(); }

    var stepBtn = V.button(p.bar, L("下一步", "Step"), function () { stop(); if (k < P.steps.length) { k++; draw(); } });
    var playBtn = V.button(p.bar, L("自动播放", "Play"), function () {
      if (timer) { stop(); return; }
      if (k >= P.steps.length) k = 0;
      playBtn.textContent = L("暂停", "Pause");
      timer = setInterval(function () {
        if (!host.isConnected) { stop(); return; }
        if (k < P.steps.length) { k++; draw(); }
        if (k >= P.steps.length) stop();
      }, 1200);
    });
    V.button(p.bar, L("结果", "Result"), function () { stop(); k = P.steps.length; draw(); });
    V.button(p.bar, L("从头", "Restart"), function () { stop(); k = 0; draw(); });
    V.select(p.bar, L("操作", "Operation"), OPS.map(function (o) { return { value: o.id, label: L(o.zh, o.en) }; }), op.id,
      function (id) { op = OPS.filter(function (o) { return o.id === id; })[0]; reset(); });

    reset();
  });
})();
