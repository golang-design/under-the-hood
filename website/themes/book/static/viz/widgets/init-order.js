/*
 * init-order: Go's initialization order as a topological sort (book §3.6).
 *
 * Two scenes share one algorithm. Each step scans a fixed priority list
 * (import paths sorted lexically, or variables in declaration order) and
 * initializes the first entry whose dependencies are all done; earlier
 * entries that are still waiting are reported as skipped. This is Kahn's
 * algorithm with a "smallest first" tie-break, which is what the linker
 * (cmd/link/internal/ld/inittask.go) and the spec's variable rule do.
 *
 * A toggle adds one dependency that closes a cycle, so the reader can watch
 * the algorithm run out of candidates; Go reports that case at compile time.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;

  // Package graph, simplified from a real `GODEBUG=inittrace=1` run of a
  // program that imports os. Edges point from importer to imported package.
  // Only the transitive reduction is drawn (os also imports errors, sync,
  // syscall and time directly); readiness, and therefore the order, is the
  // same either way. Positions are hand-placed so no edge crosses a box.
  var PKGS = {
    nodes: ["errors", "internal/godebug", "io/fs", "main", "os", "sync", "syscall", "time"],
    deps: {
      "internal/godebug": ["sync"],
      "syscall": ["errors", "sync"],
      "time": ["syscall"],
      "io/fs": ["time"],
      "os": ["internal/godebug", "io/fs"],
      "main": ["os"],
    },
    pos: {
      "main": [250, 30], "os": [250, 82], "io/fs": [170, 134], "time": [170, 186],
      "syscall": [170, 238], "internal/godebug": [382, 238], "errors": [110, 290], "sync": [250, 290],
    },
    cycle: { from: "sync", to: "time", path: ["sync", "time", "syscall", "sync"] },
  };
  // The spec's example: var ( a = c + b; b = f(); c = f(); d = 3 ),
  // where f increments and returns d.
  var VARS = {
    nodes: ["a", "b", "c", "d"],
    deps: { a: ["b", "c"], b: ["d"], c: ["d"] },
    pos: { a: [215, 60], b: [130, 160], c: [300, 160], d: [215, 260] },
    cycle: { from: "d", to: "a", path: ["a", "b", "d", "a"] },
    code: { a: "a = c + b", b: "b = f()", c: "c = f()", d: "d = 3" },
  };

  V.register("init-order", function (host) {
    var p = V.panel(host, { title: L("初始化次序：按依赖做拓扑排序", "Initialization order as a topological sort") });
    var root = V.svg("svg", { viewBox: "0 0 720 334", role: "img",
      "aria-label": L("依赖图与初始化次序", "Dependency graph and initialization order") }, p.stage);
    var defs = V.svg("defs", null, root);
    ["line", "c2"].forEach(function (k) {
      var m = V.svg("marker", { id: "io-arrow-" + k, viewBox: "0 0 10 10", refX: 9, refY: 5,
        markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
      V.svg("path", { d: "M0,0 L10,5 L0,10 z",
        style: "fill:" + (k === "c2" ? "var(--viz-c2)" : "var(--viz-muted)") }, m);
    });
    var gEdges = V.svg("g", null, root), gNodes = V.svg("g", null, root), gSide = V.svg("g", null, root);

    var scene = "pkg", cyc = false, st, timer = null;

    function graph() {
      var g = scene === "pkg" ? PKGS : VARS, deps = {};
      g.nodes.forEach(function (n) { deps[n] = (g.deps[n] || []).slice(); });
      if (cyc) deps[g.cycle.from].push(g.cycle.to);
      return { nodes: g.nodes, deps: deps, g: g };
    }
    function reset() {
      stop();
      var G = graph();
      st = { G: G, done: {}, order: [], cur: null, skipped: [], stuck: false, vals: {} };
      layout();
      draw();
      p.note.textContent = scene === "pkg"
        ? L("右侧是按导入路径排序的待办表。每一步从上往下找第一个「导入的包都已初始化」的包。点「下一步」开始。",
            "On the right is the to-do list sorted by import path. Each step picks the first package whose imports are all initialized. Press Step to begin.")
        : L("同一个算法，排序依据换成声明次序：每一步选声明最靠前、且所依赖的变量都已就绪的那个。",
            "Same algorithm, ordered by declaration: each step picks the earliest declared variable whose dependencies are ready.");
      stepBtn.disabled = false; playBtn.disabled = false;
    }

    var pos = {};
    function layout() {
      var g = st.G.g;
      pos = {};
      g.nodes.forEach(function (n) {
        pos[n] = { x: g.pos[n][0], y: g.pos[n][1], w: Math.max(44, n.length * 7.4 + 18), h: 26 };
      });
    }

    function ready(n) {
      return st.G.deps[n].every(function (d) { return st.done[d]; });
    }
    function step() {
      if (st.stuck || st.order.length === st.G.nodes.length) return false;
      var skipped = [], pick = null;
      for (var i = 0; i < st.G.nodes.length; i++) {
        var n = st.G.nodes[i];
        if (st.done[n]) continue;
        if (ready(n)) { pick = n; break; }
        skipped.push(n);
      }
      st.skipped = skipped;
      if (!pick) {
        st.stuck = true; st.cur = null;
        var path = st.G.g.cycle.path, ring = path.join(" → ");
        st.skipped = path.slice(0, -1);
        p.note.textContent = scene === "pkg"
          ? L("没有包可以初始化了：" + ring + " 构成了环，环上每个包都在等下一个，其余的包又在等环上的包。Go 不允许导入环，编译时就会报 import cycle not allowed。",
              "Nothing can be initialized: " + ring + " is a cycle, each package waits for the next, and the rest wait for the cycle. Go forbids import cycles and reports \"import cycle not allowed\" at compile time.")
          : L("没有变量可以初始化了：" + ring + " 构成了环。编译器会报 initialization cycle。",
              "Nothing can be initialized: " + ring + " is a cycle. The compiler reports an initialization cycle.");
        draw(); return false;
      }
      st.done[pick] = true; st.order.push(pick); st.cur = pick;
      if (scene === "vars") {
        if (pick === "d") st.vals.d = 3;
        else if (pick === "a") st.vals.a = st.vals.b + st.vals.c;
        else { st.vals.d += 1; st.vals[pick] = st.vals.d; }
      }
      var why = skipped.length
        ? L("跳过 " + skipped.map(function (s) { return s + "（还在等 " + st.G.deps[s].filter(function (d) { return !st.done[d] || d === pick; }).join("、") + "）"; }).join("，") + "。",
            "Skip " + skipped.map(function (s) { return s + " (waiting for " + st.G.deps[s].filter(function (d) { return !st.done[d] || d === pick; }).join(", ") + ")"; }).join("; ") + ". ")
        : "";
      var deps = st.G.deps[pick];
      var what = scene === "pkg"
        ? L("初始化 " + pick + (deps.length ? "：它导入的 " + deps.join("、") + " 都已完成。" : "：它不导入其他包。"),
            "Initialize " + pick + (deps.length ? ": everything it imports (" + deps.join(", ") + ") is done." : ": it imports nothing."))
        : L("初始化 " + st.G.g.code[pick] + "，得到 " + pick + " = " + st.vals[pick] + (pick === "b" || pick === "c" ? "（f 把 d 加一后返回）" : "") + "。",
            "Initialize " + st.G.g.code[pick] + ", so " + pick + " = " + st.vals[pick] + (pick === "b" || pick === "c" ? " (f increments d and returns it)" : "") + ".");
      p.note.textContent = why + what + (st.order.length === st.G.nodes.length
        ? L("全部完成。", " All done.") : "");
      draw();
      return st.order.length < st.G.nodes.length;
    }

    function arrow(a, b, hot) {
      var pa = pos[a], pb = pos[b];
      var x1 = pa.x, y1 = pa.y + pa.h / 2, x2 = pb.x, y2 = pb.y - pb.h / 2;
      var up = pb.y <= pa.y; // the cycle edge points upward: route it around the side
      var d;
      if (up) {
        var side = Math.max(pa.x + pa.w / 2, pb.x + pb.w / 2) + 26;
        d = "M" + (pa.x + pa.w / 2) + "," + pa.y + " C" + side + "," + pa.y + " " + side + "," + pb.y + " " + (pb.x + pb.w / 2 + 2) + "," + pb.y;
      } else {
        var my = (y1 + y2) / 2;
        d = "M" + x1 + "," + y1 + " C" + x1 + "," + my + " " + x2 + "," + my + " " + x2 + "," + (y2 - 2);
      }
      V.svg("path", { d: d, "marker-end": "url(#io-arrow-" + (hot ? "c2" : "line") + ")",
        style: "fill:none;stroke-width:" + (hot ? 1.8 : 1.1) + ";stroke:" + (hot ? "var(--viz-c2)" : "var(--viz-line)") +
          (hot ? "" : ";stroke-opacity:.9") }, gEdges);
    }

    function draw() {
      [gEdges, gNodes, gSide].forEach(function (g) { while (g.firstChild) g.removeChild(g.firstChild); });
      var G = st.G;
      G.nodes.forEach(function (n) {
        G.deps[n].forEach(function (d) {
          var isCycle = cyc && n === G.g.cycle.from && d === G.g.cycle.to;
          arrow(n, d, isCycle);
        });
      });
      G.nodes.forEach(function (n) {
        var q = pos[n], done = st.done[n], cur = st.cur === n, skip = st.skipped.indexOf(n) >= 0;
        var c = cur ? "var(--viz-c1)" : done ? "var(--viz-c3)" : skip ? "var(--viz-c2)" : "var(--viz-line)";
        var fill = cur || done || skip ? c : "var(--viz-fill)";
        V.svg("rect", { x: q.x - q.w / 2, y: q.y - q.h / 2, width: q.w, height: q.h, rx: 6,
          style: "fill:" + fill + ";fill-opacity:" + (cur || done || skip ? 0.16 : 1) + ";stroke:" + c + ";stroke-width:" + (cur ? 2 : 1.2) }, gNodes);
        V.svg("text", { x: q.x, y: q.y + 4.5, "text-anchor": "middle",
          style: "font-size:12px;font-family:var(--font-mono,monospace)", text: n }, gNodes);
      });
      // Right side: the priority list and the resulting order.
      var x0 = 470;
      V.svg("text", { x: x0, y: 20, style: "font-size:12px;font-weight:600",
        text: scene === "pkg" ? L("待办表（按导入路径排序）", "To-do list (sorted by import path)") : L("待办表（按声明次序）", "To-do list (declaration order)") }, gSide);
      G.nodes.forEach(function (n, i) {
        var y = 42 + i * 24, done = st.done[n], cur = st.cur === n, skip = st.skipped.indexOf(n) >= 0;
        var tag = cur ? L("本步初始化", "now") : done ? L("已完成", "done")
          : skip ? (st.stuck ? L("在环上", "on the cycle") : L("跳过：依赖未就绪", "skip: waiting"))
          : st.stuck ? L("等待", "waiting") : "";
        var c = cur ? "var(--viz-c1)" : done ? "var(--viz-c3)" : skip ? "var(--viz-c2)" : "var(--viz-muted)";
        V.svg("circle", { cx: x0 + 6, cy: y - 4, r: 4.5,
          style: "fill:" + (done || cur || skip ? c : "none") + ";stroke:" + c }, gSide);
        V.svg("text", { x: x0 + 18, y: y, style: "font-size:12px;font-family:var(--font-mono,monospace)",
          text: scene === "vars" ? G.g.code[n] + (st.vals[n] != null && done ? "  → " + st.vals[n] : "") : n }, gSide);
        if (tag) V.svg("text", { x: 714, y: y, "text-anchor": "end", style: "font-size:11px;fill:" + c, text: tag }, gSide);
      });
      var oy = 52 + G.nodes.length * 24;
      V.svg("text", { x: x0, y: oy, style: "font-size:12px;font-weight:600", text: L("初始化次序", "Resulting order") }, gSide);
      var line = st.order.length ? st.order.join(" → ") : L("（尚未开始）", "(not started)");
      // wrap the order across lines so long package paths fit the column
      var words = st.order.length ? st.order : [line], row = "", ry = oy + 20, rows = 0;
      words.forEach(function (w, i) {
        var piece = (row ? " → " : "") + w;
        if ((row + piece).length * 6.6 > 245 && row) {
          V.svg("text", { x: x0, y: ry, style: "font-size:12px;font-family:var(--font-mono,monospace)", text: row + " →" }, gSide);
          ry += 18; row = w; rows++;
        } else row += piece;
      });
      if (row) V.svg("text", { x: x0, y: ry, style: "font-size:12px;font-family:var(--font-mono,monospace);fill:" + (st.stuck ? "var(--viz-c2)" : "var(--viz-ink)"),
        text: row + (st.stuck ? L("  ✗ 卡住", "  ✗ stuck") : "") }, gSide);
      if (scene === "vars") {
        V.svg("text", { x: 8, y: 324, style: "font-size:11px;fill:var(--viz-muted)",
          text: L("箭头 x → y 表示 x 的初始化表达式用到了 y（经由 f 间接用到 d 也算）。", "An arrow x → y means x's initializer uses y (b and c reach d through f).") }, gSide);
      } else {
        V.svg("text", { x: 8, y: 324, style: "font-size:11px;fill:var(--viz-muted)",
          text: L("箭头 x → y 表示 x 导入了 y。据一次真实运行简化，只画出决定次序所必需的边。", "An arrow x → y means x imports y. Simplified from a real run; only the edges that decide the order are drawn.") }, gSide);
      }
    }

    function stop() { if (timer) { clearInterval(timer); timer = null; } if (playBtn) playBtn.textContent = L("自动播放", "Play"); }

    var stepBtn = V.button(p.bar, L("下一步", "Step"), function () {
      stop();
      if (!step()) { stepBtn.disabled = true; playBtn.disabled = true; }
    });
    var playBtn = V.button(p.bar, L("自动播放", "Play"), function () {
      if (timer) { stop(); return; }
      playBtn.textContent = L("暂停", "Pause");
      timer = setInterval(function () {
        if (!host.isConnected) { stop(); return; }
        if (!step()) { stop(); stepBtn.disabled = true; playBtn.disabled = true; }
      }, 1100);
    });
    V.button(p.bar, L("重置", "Reset"), reset);
    var cycBtn = V.button(p.bar, "", function () {
      cyc = !cyc; cycBtn.classList.toggle("is-on", cyc); label(); reset();
    });
    function label() {
      var g = scene === "pkg" ? PKGS : VARS;
      cycBtn.textContent = (cyc ? L("去掉 ", "Remove ") : L("加上 ", "Add ")) + g.cycle.from + " → " + g.cycle.to + (cyc ? "" : L("（制造环）", " (make a cycle)"));
    }
    V.select(p.bar, L("场景", "Scene"), [
      { value: "pkg", label: L("包之间", "Between packages") },
      { value: "vars", label: L("包之内的变量", "Variables in a package") },
    ], "pkg", function (v) { scene = v; cyc = false; cycBtn.classList.remove("is-on"); label(); reset(); });

    label();
    reset();
  });
})();
