/*
 * escape-flow: how escape analysis solves the location graph (book §15.5.3).
 *
 * The solver is src/cmd/compile/internal/escape/solve.go in Go 1.26:
 *   walkAll  queues every location: allLocs pushed to the front one by one
 *            (so the last declared comes first), then the mutator, callee and
 *            heap pseudo-locations, so the heap is walked first. A location
 *            whose attributes change is queued again if it is not queued.
 *   walkOne  Bellman-Ford over the incoming edges with a FIFO queue. A
 *            location reached with derefs < 0 has its address flowing to the
 *            root: derefs is clamped to 0, and if outlives(root, l) the
 *            location escapes (and its own edges are not followed in this
 *            walk); otherwise it inherits attrPersists from the root. At
 *            derefs == 0 it inherits attrMutates/attrCalls. Sources that
 *            already escape are skipped.
 *   outlives the heap (any escaping location) outlives everything; a result
 *            parameter outlives everything; in the same function, a location
 *            declared at a smaller loop depth outlives a deeper one. (The
 *            closure rules do not arise in these programs.)
 * Locations come from graph.go: every name in fn.Dcl gets one up front with
 * attrPersists; the heap starts with all four attributes, the mutator with
 * attrMutates and the callee with attrCalls. Edges are those the assignment
 * walk (expr.go, stmt.go) records: "&" lowers derefs by one, "*" raises it,
 * and a value whose type has no pointers is sent to the blank location, so
 * no edge is recorded for it.
 *
 * Each program's escapes and the -m=2 flow paths (which name the walk root)
 * were checked with `go build -gcflags='-m=2 -l'` under Go 1.26.10.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace)";

  var ESC = 1, PERSISTS = 2, MUTATES = 4, CALLS = 8;

  // ---- scenes ---------------------------------------------------------
  // locs: fn.Dcl order. edges: [src, dst, derefs, code line]. pos: [x, y].
  var SCENES = {
    deref: {
      label: { zh: "取地址与解引用", en: "Address and dereference" },
      code: ["var sink *int", "", "func k() {", "\tvar w int", "\ty := &w", "\tr := &y", "\tz := *r", "\tsink = z", "}"],
      locs: [{ n: "w", d: 1 }, { n: "y", d: 1 }, { n: "r", d: 1 }, { n: "z", d: 1 }],
      edges: [["w", "y", -1, 4], ["y", "r", -1, 5], ["r", "z", 1, 6], ["z", "heap", 0, 7]],
      pos: { w: [360, 40], y: [360, 98], r: [360, 156], z: [360, 214], heap: [360, 272] },
    },
    loop: {
      label: { zh: "循环中的变量", en: "A variable in a loop" },
      code: ["func g() int {", "\tvar p *int", "\tfor i := 0; i < 3; i++ {", "\t\tv := i", "\t\tp = &v", "\t}", "\treturn *p", "}"],
      locs: [{ n: "~r0", d: 1, res: true }, { n: "p", d: 1 }, { n: "i", d: 1 }, { n: "v", d: 2 }],
      edges: [["v", "p", -1, 4]],
      pos: { v: [330, 70], p: [330, 170], i: [440, 70], "~r0": [440, 170], heap: [330, 272] },
      flat: { i: 2, "~r0": 6 },
      depths: { p: 1, v: 2 },
    },
    chain: {
      label: { zh: "逃逸继续传播", en: "Escape propagates" },
      code: ["var sink **int", "", "func h() {", "\tvar a int", "\tb := &a", "\tc := b", "\tpp := &c", "\tsink = pp", "}"],
      locs: [{ n: "a", d: 1 }, { n: "b", d: 1 }, { n: "c", d: 1 }, { n: "pp", d: 1 }],
      edges: [["a", "b", -1, 4], ["b", "c", 0, 5], ["c", "pp", -1, 6], ["pp", "heap", 0, 7]],
      pos: { a: [360, 40], b: [360, 98], c: [360, 156], pp: [360, 214], heap: [360, 272] },
    },
  };

  // ---- solver (solve.go) ----------------------------------------------
  // Runs walkAll to the fixed point and records one event per location
  // popped in walkOne.
  function solve(sc) {
    var locs = {}, all = [];
    function loc(n, depth, attrs, extra) {
      var l = { n: n, depth: depth, attrs: attrs, edges: [], derefs: 0, walkgen: 0, dst: null,
        queuedAll: false, queuedOne: 0, res: !!(extra && extra.res), pseudo: !!(extra && extra.pseudo) };
      locs[n] = l; return l;
    }
    var heap = loc("heap", 0, ESC | PERSISTS | MUTATES | CALLS, { pseudo: true });
    var mutator = loc("mutator", 0, MUTATES, { pseudo: true });
    var callee = loc("callee", 0, CALLS, { pseudo: true });
    sc.locs.forEach(function (d) { all.push(loc(d.n, d.d, PERSISTS, d)); });
    sc.edges.forEach(function (e) { locs[e[1]].edges.push({ src: locs[e[0]], derefs: e[2], line: e[3] }); });

    function outlives(l, other) {
      if (l.attrs & ESC) return "heap";
      if (l === mutator || l === callee) return false;
      if (l.res) return "result";
      if (l.depth < other.depth) return "loop";
      return false;
    }
    var todo = [], events = [], walkgen = 0;
    function enqueue(l) {
      if (!l.queuedAll) {
        l.queuedAll = true;
        if (l.attrs & ESC) todo.unshift(l); else todo.push(l);
        return true;
      }
      return false;
    }
    all.forEach(function (l) { todo.unshift(l); l.queuedAll = true; });
    [mutator, callee, heap].forEach(function (l) { todo.unshift(l); l.queuedAll = true; });

    while (todo.length) {
      var root = todo.shift();
      root.queuedAll = false;
      walkgen++;
      root.walkgen = walkgen; root.derefs = 0; root.dst = null;
      var q = [root], first = true;
      while (q.length) {
        var l = q.shift();
        l.queuedOne = 0;
        var derefs = l.derefs, newAttrs = 0, ev = { root: root, l: l, start: first, raw: derefs, relax: [], skip: [] };
        first = false;
        if (derefs < 0) {
          ev.addr = true;
          derefs = 0;
          var why = outlives(root, l);
          ev.outlives = why;
          if (why) newAttrs |= ESC | PERSISTS | MUTATES | CALLS;
          else if (root.attrs & PERSISTS) newAttrs |= PERSISTS;
        }
        if (derefs === 0) newAttrs |= root.attrs & (MUTATES | CALLS);
        var stop = false;
        if (newAttrs & ~l.attrs) {
          var wasEsc = l.attrs & ESC;
          l.attrs |= newAttrs;
          ev.requeued = enqueue(l);
          if ((l.attrs & ESC) && !wasEsc) {
            ev.escaped = true;
            var path = [], x = l;
            while (x && x !== root) { path.push(x); x = x.dst; }
            path.push(root);
            ev.path = path.map(function (p) { return p.n; });
          }
          if (l.attrs & ESC) stop = true;
        }
        ev.stop = stop;
        if (!stop) l.edges.forEach(function (e) {
          if (e.src.attrs & ESC) { ev.skip.push(e); return; }
          var d = derefs + e.derefs;
          if (e.src.walkgen !== walkgen || e.src.derefs > d) {
            e.src.walkgen = walkgen; e.src.derefs = d; e.src.dst = l;
            ev.relax.push({ e: e, d: d });
            if (e.src.queuedOne !== walkgen) { e.src.queuedOne = walkgen; q.push(e.src); }
          }
        });
        ev.queue = q.map(function (x) { return x.n; });
        ev.todo = todo.map(function (x) { return x.n; });
        ev.esc = all.filter(function (x) { return x.attrs & ESC; }).map(function (x) { return x.n; });
        ev.d = {};
        Object.keys(locs).forEach(function (n) { if (locs[n].walkgen === walkgen) ev.d[n] = locs[n].derefs; });
        events.push(ev);
      }
    }
    return { events: events, locs: locs };
  }

  V.register("escape-flow", function (host) {
    var p = V.panel(host, { title: L("逃逸分析：在位置图上求最小 derefs", "Escape analysis: minimal derefs on the location graph") });
    var root = V.svg("svg", { viewBox: "0 0 720 318", role: "img",
      "aria-label": L("位置图、源码与遍历队列", "Location graph, source code and walk queues") }, p.stage);
    var defs = V.svg("defs", null, root);
    [["line", "var(--viz-muted)"], ["hot", "var(--viz-c1)"]].forEach(function (a) {
      var mk = V.svg("marker", { id: "ef-arrow-" + a[0], viewBox: "0 0 10 10", refX: 9, refY: 5,
        markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
      V.svg("path", { d: "M0,0 L10,5 L0,10 z", style: "fill:" + a[1] }, mk);
    });
    var gC = V.svg("g", null, root), gG = V.svg("g", null, root), gP = V.svg("g", null, root);
    var scene = "deref", sc, R, k = 0;

    function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }
    function txt(g, x, y, s, style, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: style || "font-size:12px", text: s }, g);
    }
    function num(d) { return d < 0 ? "−" + (-d) : d > 0 ? "+" + d : "0"; }
    function nm(n) {
      return n === "heap" ? L("堆", "heap") : n === "callee" ? L("被调用的闭包", "called closure")
        : n === "mutator" ? L("被修改的内存", "mutated memory") : n;
    }
    function tw(s) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 11.5 : 6.6; return w; }
    function cur() { return k > 0 ? R.events[k - 1] : null; }

    function drawCode(ev) {
      clear(gC);
      var hot = {};
      if (ev) {
        ev.relax.forEach(function (r) { hot[r.e.line] = true; });
        if (ev.escaped) sc.edges.forEach(function (e) {
          for (var i = 0; i + 1 < ev.path.length; i++) if (e[0] === ev.path[i] && e[1] === ev.path[i + 1]) hot[e[3]] = true;
        });
      }
      txt(gC, 8, 16, L("源码", "Source"), "font-size:12px;font-weight:600");
      sc.code.forEach(function (line, i) {
        var y = 40 + i * 19;
        if (hot[i]) V.svg("rect", { x: 4, y: y - 13, width: 222, height: 18, rx: 3,
          style: "fill:var(--viz-c1);fill-opacity:.14" }, gC);
        txt(gC, 10, y, line.replace(/\t/g, "    "), "font-size:12px;white-space:pre;" + MONO);
      });
      var last = 40 + sc.code.length * 19 + 8;
      if (sc.flat) txt(gC, 8, last, L("int 不含指针：给 int 赋值不记边。", "An int holds no pointers, so"), "font-size:11px;fill:var(--viz-muted)");
      if (sc.flat && V.lang === "en") txt(gC, 8, last + 15, "assigning one records no edge.", "font-size:11px;fill:var(--viz-muted)");
    }

    var NW = 58, NH = 26;
    function drawGraph(ev) {
      clear(gG);
      var pos = sc.pos, d = ev ? ev.d : {}, esc = {};
      (ev ? ev.esc : []).forEach(function (n) { esc[n] = true; });
      var relaxed = {};
      if (ev) ev.relax.forEach(function (r) { relaxed[r.e.src.n + ">" + ev.l.n] = true; });
      sc.edges.forEach(function (e) {
        var a = pos[e[0]], b = pos[e[1]], hot = relaxed[e[0] + ">" + e[1]];
        V.svg("path", { d: "M" + a[0] + "," + (a[1] + NH / 2) + " L" + b[0] + "," + (b[1] - NH / 2 - 2),
          "marker-end": "url(#ef-arrow-" + (hot ? "hot" : "line") + ")",
          style: "fill:none;stroke:" + (hot ? "var(--viz-c1)" : "var(--viz-muted)") + ";stroke-width:" + (hot ? 2 : 1.2) }, gG);
        var my = (a[1] + b[1]) / 2 + 4;
        txt(gG, a[0] - 8, my, num(e[2]), "font-size:12px;font-weight:600;" + MONO + ";fill:" + (hot ? "var(--viz-c1)" : "var(--viz-muted)"), "end");
      });
      Object.keys(pos).forEach(function (n) {
        var q = pos[n], isRoot = ev && ev.root.n === n, isCur = ev && ev.l.n === n, isEsc = esc[n] || n === "heap";
        var flat = sc.flat && sc.flat[n] !== undefined;
        var stroke = isEsc ? "var(--viz-c2)" : isCur ? "var(--viz-c1)" : "var(--viz-line)";
        var fill = isCur ? "var(--viz-c1)" : isEsc ? "var(--viz-c2)" : "var(--viz-fill)";
        if (isRoot) V.svg("rect", { x: q[0] - NW / 2 - 4, y: q[1] - NH / 2 - 4, width: NW + 8, height: NH + 8, rx: 9,
          style: "fill:none;stroke:var(--viz-c1);stroke-width:2;stroke-dasharray:" + (isCur ? "none" : "5 3") }, gG);
        V.svg("rect", { x: q[0] - NW / 2, y: q[1] - NH / 2, width: NW, height: NH, rx: n === "heap" ? 13 : 5,
          style: "fill:" + fill + ";fill-opacity:" + (isCur ? 0.2 : isEsc ? 0.14 : 1) + ";stroke:" + stroke +
            ";stroke-width:" + (isEsc || isCur ? 1.8 : 1.1) + (flat ? ";stroke-dasharray:3 3" : "") }, gG);
        txt(gG, q[0], q[1] + 4.5, nm(n), "font-size:12.5px;" + (n === "heap" ? "" : MONO) + (flat ? ";fill:var(--viz-muted)" : ""), "middle");
        if (d[n] !== undefined && !(isRoot && n === "heap" && false))
          txt(gG, q[0] + NW / 2 + 8, q[1] + 4.5, "d=" + num(d[n]).replace("+", ""), "font-size:11.5px;" + MONO + ";fill:var(--viz-c1)");
        if (isEsc && n !== "heap") txt(gG, q[0] - NW / 2 - 8, q[1] - 6, L("逃逸", "escapes"), "font-size:10.5px;fill:var(--viz-c2)", "end");
        if (flat) txt(gG, q[0], q[1] + NH / 2 + 13, L("无指针", "no pointers"), "font-size:10.5px;fill:var(--viz-muted)", "middle");
        if (sc.depths && sc.depths[n]) txt(gG, q[0] - NW / 2 - 8, q[1] + 4.5, L("循环深度 ", "loop depth ") + sc.depths[n],
          "font-size:10.5px;fill:var(--viz-muted)", "end");
      });
    }

    var X = 492;
    function drawPanel(ev) {
      clear(gP);
      var y = 16;
      txt(gP, X, y, L("walkAll：待遍历的根", "walkAll: roots to walk"), "font-size:12px;font-weight:600"); y += 20;
      var rootNow = ev ? ev.root.n : null, rest = ev ? ev.todo : R.initial;
      if (rootNow) {
        txt(gP, X, y, L("当前：", "Now: ") + nm(rootNow), "font-size:12px;fill:var(--viz-c1);font-weight:600"); y += 18;
      }
      var line = "", lines = [];
      rest.forEach(function (n) {
        var piece = (line ? L("、", ", ") : "") + nm(n);
        // the first line also carries the "Next:" prefix
        var room = lines.length ? 205 : 205 - tw(L("之后：", "Next: "));
        if (tw(line + piece) > room && line) { lines.push(line + L("、", ",")); line = nm(n); } else line += piece;
      });
      lines.push(line || L("（空）", "(empty)"));
      lines.forEach(function (l, i) { txt(gP, X, y, (i === 0 ? L("之后：", "Next: ") : "") + l, "font-size:12px"); y += 17; });
      y += 12;
      txt(gP, X, y, L("walkOne：本次遍历的队列", "walkOne: queue of this walk"), "font-size:12px;font-weight:600"); y += 20;
      txt(gP, X, y, ev ? (ev.queue.length ? ev.queue.map(nm).join(L("、", ", ")) : L("（空）", "(empty)")) : "—", "font-size:12px;" + MONO); y += 30;
      txt(gP, X, y, L("分配在堆上", "Moved to heap"), "font-size:12px;font-weight:600"); y += 20;
      var esc = ev ? ev.esc : [];
      if (!esc.length) txt(gP, X, y, L("（尚无）", "(none yet)"), "font-size:12px;fill:var(--viz-muted)");
      esc.forEach(function (n) { txt(gP, X, y, "moved to heap: " + n, "font-size:12px;" + MONO + ";fill:var(--viz-c2)"); y += 17; });
      // legend
      var ly = 304, lx = 250;
      [["var(--viz-c1)", 0.2, "var(--viz-c1)", L("正在处理", "processing")],
       ["var(--viz-c2)", 0.14, "var(--viz-c2)", L("逃逸", "escapes")]].forEach(function (it) {
        V.svg("rect", { x: lx, y: ly - 10, width: 16, height: 12, rx: 3,
          style: "fill:" + it[0] + ";fill-opacity:" + it[1] + ";stroke:" + it[2] + ";stroke-width:1.4" }, gP);
        txt(gP, lx + 22, ly, it[3], "font-size:11px;fill:var(--viz-muted)"); lx += 22 + tw(it[3]) + 16;
      });
      V.svg("rect", { x: lx, y: ly - 11, width: 18, height: 14, rx: 4, style: "fill:none;stroke:var(--viz-c1);stroke-width:1.6;stroke-dasharray:4 2" }, gP);
      txt(gP, lx + 24, ly, L("当前根", "walk root"), "font-size:11px;fill:var(--viz-muted)"); lx += 24 + tw(L("当前根", "walk root")) + 16;
      txt(gP, lx, ly, L("d：到根的最小 derefs", "d: minimal derefs to the root"), "font-size:11px;fill:var(--viz-muted)");
    }

    function narrate(ev) {
      if (!ev) {
        p.note.textContent = L("每条边从被赋的值指向赋值目标，标注 derefs：取地址 −1，解引用 +1。按「下一步」开始，第一次遍历以堆为根。",
          "Each edge runs from the assigned value to the target and is labeled with derefs: −1 for an address, +1 for a dereference. Press Step to begin; the first walk is rooted at the heap.");
        return;
      }
      var l = ev.l.n, r = ev.root.n, s = [];
      if (ev.start) {
        if (r === "callee" || r === "mutator") s.push(L("以「" + nm(r) + "」为根：这是一个伪位置，本例中没有边流入它，遍历立即结束。",
          "Root: " + nm(r) + ". It is a pseudo-location; nothing flows into it here, so the walk ends at once."));
        else if (sc.flat && sc.flat[l] !== undefined) s.push(L("以 " + l + " 为根：" + (l === "~r0" ? "结果是 int" : l + " 是 int") + "，不含指针，没有边流入它，遍历立即结束。",
          "Root: " + l + ". " + (l === "~r0" ? "The result is an int" : l + " is an int") + ", which holds no pointers, so no edge flows into it and the walk ends at once."));
        else {
          s.push(L("以" + (r === "heap" ? "堆" : " " + r + " ") + "为根开始一次遍历，求每个位置到它的最小 derefs。",
            "Start a walk rooted at " + (r === "heap" ? "the heap" : r) + ": find each location's minimal derefs to it."));
          if (r !== "heap" && ev.root.attrs & ESC) s.push(L(r + " 已经逃逸，堆比一切位置存活得久，地址流入它的位置也要逃逸。",
            r + " already escapes, and the heap outlives everything, so any location whose address flows into it escapes too."));
          if (!ev.relax.length && !ev.skip.length) s.push(L("没有边流入 " + nm(r) + "，遍历结束。", "Nothing flows into " + nm(r) + ", so the walk ends."));
        }
      } else if (ev.addr) {
        s.push(L(l + " 的 derefs 为 −1：" + l + " 的地址流入了" + (r === "heap" ? "堆" : "根 " + r) + "。",
          l + " has derefs −1: its address flows into " + (r === "heap" ? "the heap" : "the root, " + r) + "."));
        if (ev.outlives === "heap") s.push(L((r === "heap" ? "堆" : r + " 已在堆上，它") + "比一切位置存活得久，" + l + " 必须分配在堆上。",
          (r === "heap" ? "The heap" : r + " is on the heap and") + " outlives everything, so " + l + " must be heap allocated."));
        else if (ev.outlives === "loop") s.push(L(r + " 声明在循环之外，" + l + " 声明在循环之内，每次迭代都是新的 " + l + "；" + r + " 比 " + l + " 存活得久，" + l + " 必须分配在堆上。",
          r + " is declared outside the loop and " + l + " inside it, so each iteration has a new " + l + "; " + r + " outlives " + l + ", which must be heap allocated."));
        else s.push(L("但 " + r + " 并不比 " + l + " 存活得久，" + l + " 可以留在栈上。derefs 截断为 0 后继续。",
          "But " + r + " does not outlive " + l + ", so " + l + " can stay on the stack. derefs is clamped to 0 and the walk goes on."));
      } else {
        s.push(L(l + " 的 derefs 为 " + num(ev.raw).replace("+", "") + "：" + (ev.raw === 0 ? l + " 的值流入根。" : "根中存的是从 " + l + " 出发解引用一次得到的值。"),
          l + " has derefs " + num(ev.raw).replace("+", "") + ": " + (ev.raw === 0 ? "its value flows into the root." : "the root holds what " + l + " points to.")));
      }
      if (ev.escaped) {
        // the same lines -m=2 prints: "flow: dst ← &src"
        var flows = ev.path.slice(0, -1).map(function (n, i) {
          var dst = ev.path[i + 1], dd = 0;
          sc.edges.forEach(function (e) { if (e[0] === n && e[1] === dst) dd = e[2]; });
          return (dst === "heap" ? "{heap}" : dst) + " ← " + (dd < 0 ? "&" : new Array(dd + 1).join("*")) + n;
        });
        s.push(L("以 -m=2 编译时，打印的推导路径是 " + flows.join("，") + "。", "With -m=2, the compiler prints this flow as " + flows.join(", ") + "."));
      }
      if (ev.escaped && ev.requeued) s.push(L(l + " 此前已作为根遍历过，属性改变后重新排在待遍历队列的最前面。",
        l + " was already walked as a root; now that its attributes changed it goes back to the front of the queue."));
      else if (ev.escaped) s.push(L("本次遍历不再沿 " + l + " 的边前进；轮到 " + l + " 作根时，这一结论会继续传下去。",
        "This walk does not follow " + l + "'s edges; when " + l + " is walked as a root, the fact propagates from there."));
      if (!ev.start || r === "heap" || (ev.root.attrs & ESC)) {
        if (ev.relax.length) s.push(L("沿流入的边：" + ev.relax.map(function (x) { return x.e.src.n + " 的 derefs 记为 " + num(x.d).replace("+", ""); }).join("，") + "。",
          "Along incoming edges: " + ev.relax.map(function (x) { return x.e.src.n + " gets derefs " + num(x.d).replace("+", ""); }).join(", ") + "."));
      } else if (ev.relax.length) s.push(L("沿流入的边：" + ev.relax.map(function (x) { return x.e.src.n + " 的 derefs 记为 " + num(x.d).replace("+", ""); }).join("，") + "。",
        "Along incoming edges: " + ev.relax.map(function (x) { return x.e.src.n + " gets derefs " + num(x.d).replace("+", ""); }).join(", ") + "."));
      if (ev.skip.length) s.push(L(ev.skip.map(function (e) { return e.src.n; }).join("、") + " 已经逃逸，不再沿它前进。",
        ev.skip.map(function (e) { return e.src.n; }).join(", ") + " already escapes, so the walk does not go through it."));
      if (k === R.events.length) s.push(L("所有位置都遍历过，属性不再变化，求解结束。", "Every location has been walked and no attribute changes, so the solver is done."));
      p.note.textContent = s.join(L("", " "));
    }

    function draw() {
      var ev = cur();
      drawCode(ev); drawGraph(ev); drawPanel(ev); narrate(ev);
      stepBtn.disabled = walkBtn.disabled = k >= R.events.length;
    }
    function reset() {
      sc = SCENES[scene]; R = solve(sc); k = 0;
      R.initial = ["heap", "callee", "mutator"].concat(sc.locs.slice().reverse().map(function (l) { return l.n; }));
      draw();
    }
    var stepBtn = V.button(p.bar, L("下一步", "Step"), function () { if (k < R.events.length) { k++; draw(); } });
    var walkBtn = V.button(p.bar, L("走完本次遍历", "Finish this walk"), function () {
      if (k >= R.events.length) return;
      k++;
      while (k < R.events.length && !R.events[k].start) k++;
      draw();
    });
    V.button(p.bar, L("全部", "All"), function () { k = R.events.length; draw(); });
    V.button(p.bar, L("从头", "Restart"), function () { k = 0; draw(); });
    V.select(p.bar, L("程序", "Program"), Object.keys(SCENES).map(function (id) {
      return { value: id, label: L(SCENES[id].label.zh, SCENES[id].label.en) };
    }), scene, function (v) { scene = v; reset(); });
    reset();
  });
})();
