/*
 * link-deadcode: the linker's dead-code elimination as reachability (book §3.4.3).
 *
 * The graph is the Duck program from the text, simplified from a real
 * `-ldflags=-dumpdep` run (linux/amd64, Go 1.26). The algorithm mirrors
 * cmd/link/internal/ld/deadcode.go: flood from the roots along relocations;
 * methods of types converted to an interface become candidates and are kept
 * only if a reached interface call has the same name and signature, or if a
 * function that looks up methods by a non-constant name (REFLECTMETHOD) was
 * reached, in which case every exported candidate is kept. Flood and method
 * checks alternate until nothing new is found. The real linker pops from a
 * heap ordered by symbol index; a FIFO is used here, the result is the same.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;

  var NODES = {
    entry:  { s: "_rt0_amd64_linux", x: 110, y: 24 },
    rt0go:  { s: "runtime.rt0_go", x: 110, y: 72 },
    rtmain: { s: "runtime.main", x: 110, y: 120 },
    main:   { s: "main.main", x: 110, y: 168 },
    newq:   { s: "main.newQuacker", x: 110, y: 226 },
    duck:   { s: "type:main.Duck", x: 110, y: 280 },
    quack:  { s: "main.Duck.Quack", x: 70, y: 334, method: "Quack", exported: true },
    swim:   { s: "main.Duck.Swim", x: 232, y: 334, method: "Swim", exported: true },
    icall:  { s: L("接口调用 Quack()", "iface call Quack()"), x: 340, y: 168, marker: true },
    refl:   { s: "reflect.Value.MethodByName", x: 340, y: 120, optional: true },
    fpl:    { s: "fmt.Fprintln", x: 340, y: 226 },
    unused: { s: "main.unused", x: 340, y: 280 },
  };
  var EDGES = [
    ["entry", "rt0go"], ["rt0go", "rtmain"], ["rtmain", "main"],
    ["main", "newq"], ["main", "fpl"], ["main", "icall", "marker"], ["main", "refl", "optional"],
    ["newq", "duck"], ["unused", "fpl"],
    ["duck", "quack", "method"], ["duck", "swim", "method"],
  ];

  function textW(s, px) {
    var w = 0;
    for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? px * 1.05 : px * 0.62;
    return w;
  }

  V.register("link-deadcode", function (host) {
    var p = V.panel(host, { title: L("死代码消除：从入口出发标记可达符号", "Dead-code elimination: mark what is reachable from the entry") });
    var root = V.svg("svg", { viewBox: "0 0 720 404", role: "img",
      "aria-label": L("符号引用图与标记过程", "Symbol reference graph and the marking process") }, p.stage);
    var defs = V.svg("defs", null, root);
    ["line", "c1"].forEach(function (k) {
      var m = V.svg("marker", { id: "ld-arrow-" + k, viewBox: "0 0 10 10", refX: 9, refY: 5,
        markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
      V.svg("path", { d: "M0,0 L10,5 L0,10 z",
        style: "fill:" + (k === "c1" ? "var(--viz-c1)" : "var(--viz-muted)") }, m);
    });
    var gEdges = V.svg("g", null, root), gNodes = V.svg("g", null, root), gSide = V.svg("g", null, root);

    var reflectOn = false, st, timer = null;
    var box = {};
    Object.keys(NODES).forEach(function (k) {
      var n = NODES[k];
      box[k] = { x: n.x, y: n.y, w: Math.max(70, textW(n.s, 12) + 20), h: 26 };
    });

    function present(k) { return !NODES[k].optional || reflectOn; }
    function out(k) {
      return EDGES.filter(function (e) {
        return e[0] === k && e[2] !== "method" && present(e[1]);
      }).map(function (e) { return e[1]; });
    }

    function reset() {
      stop();
      st = { marked: { entry: true }, queue: ["entry"], cur: null, phase: "flood",
        iface: false, reflectSeen: false, cand: [], decided: {}, done: false, hot: [] };
      draw();
      p.note.textContent = L(
        "起点是操作系统进入程序的地方 _rt0_amd64_linux（真实的起点还有 runtime.unreachableMethod 和初始化任务表，这里略去）。它已被标记，放进待处理的队列。点「下一步」开始。",
        "The starting point is where the OS enters the program, _rt0_amd64_linux (the real linker also starts from runtime.unreachableMethod and the init task list). It is marked and queued. Press Step to begin.");
      stepBtn.disabled = false; playBtn.disabled = false;
    }

    function names(ks) { return ks.map(function (k) { return NODES[k].s; }).join(L("、", ", ")); }

    function step() {
      if (st.done) return false;
      st.hot = [];
      if (st.phase === "flood" && st.queue.length) {
        var k = st.queue.shift(), added = [], extra = "";
        st.cur = k;
        out(k).forEach(function (t) {
          if (t === "icall") { st.iface = true; st.hot.push(t); return; }
          if (!st.marked[t]) { st.marked[t] = true; st.queue.push(t); added.push(t); }
          st.hot.push(t);
        });
        if (k === "main") {
          extra += L("main.main 里有一次接口调用，记下方法 Quack() string。",
            " main.main makes an interface call: record method Quack() string.");
          if (reflectOn) {
            st.reflectSeen = true;
            extra += L("它还按运行时才知道的名字调用 MethodByName，编译器给它打了记号：链接器从此放弃分析方法。",
              " It also calls MethodByName with a name known only at run time, so the compiler flagged it: the linker gives up on pruning methods.");
          }
        }
        if (k === "duck") {
          st.cand = ["quack", "swim"];
          extra += L("newQuacker 把 Duck 转换成了接口，于是 Duck 的方法 Quack、Swim 成为候选，先不标记。",
            " newQuacker converts Duck to an interface, so Duck's methods Quack and Swim become candidates, not yet marked.");
        }
        if (k === "fpl") {
          extra += L("（它引用的几百个符号这里略去。）", " (Its few hundred dependencies are omitted here.)");
        }
        p.note.textContent = L("处理 " + NODES[k].s + "：", "Process " + NODES[k].s + ": ") +
          (added.length ? L("标记并加入队列 " + names(added) + "。", "mark and queue " + names(added) + ". ")
                        : L("没有新的符号。", "nothing new. ")) + extra;
        draw();
        return true;
      }
      // Queue empty: check candidate methods against recorded interface calls and reflection.
      st.cur = null;
      var kept = [], wait = [];
      st.cand.forEach(function (k) {
        var n = NODES[k];
        var byIface = st.iface && n.method === "Quack";
        var byReflect = st.reflectSeen && n.exported;
        if (byIface || byReflect) {
          st.marked[k] = true; st.queue.push(k); kept.push(k); st.hot.push(k);
          st.decided[k] = byIface ? "iface" : "reflect";
        } else wait.push(k);
      });
      st.cand = wait;
      if (kept.length) {
        st.phase = "flood";
        p.note.textContent = L("待处理的队列空了，检查候选方法。", "The queue is empty; check the candidate methods. ") +
          kept.map(function (k) {
            return st.decided[k] === "iface"
              ? L(NODES[k].s + " 与被调用的接口方法 Quack() 同名同签名，保留。", NODES[k].s + " matches the called interface method Quack(), keep it. ")
              : L(NODES[k].s + " 是导出方法，而反射可能调用任何导出方法，保留。", NODES[k].s + " is exported and reflection may call any exported method, keep it. ");
          }).join("") +
          (wait.length ? L(names(wait) + " 没有匹配，继续等待。", names(wait) + " has no match, keep waiting. ") : "") +
          L("新标记的符号放回队列，再跑一轮。", "Newly marked symbols go back on the queue for another round.");
        draw();
        return true;
      }
      st.done = true;
      var dropped = Object.keys(NODES).filter(function (k) {
        return present(k) && !NODES[k].marker && !st.marked[k];
      });
      p.note.textContent = L("队列空了，也没有新的方法要保留，标记结束。没被标记的 " + names(dropped) +
          " 不写进可执行文件。" + (reflectOn ? "打开反射后 Swim 被保留，真实程序里这会波及所有类型的导出方法。" : ""),
        "The queue is empty and no more methods qualify, so marking ends. The unmarked symbols (" + names(dropped) +
          ") are left out of the executable." + (reflectOn ? " With reflection, Swim is kept; in a real program this applies to the exported methods of every such type." : ""));
      draw();
      return false;
    }

    function edgePts(a, b) {
      var A = box[a], B = box[b];
      function exit(P, dx, dy) {
        var tx = dx ? (P.w / 2) / Math.abs(dx) : Infinity, ty = dy ? (P.h / 2) / Math.abs(dy) : Infinity;
        var t = Math.min(tx, ty);
        return [P.x + dx * t, P.y + dy * t];
      }
      var dx = B.x - A.x, dy = B.y - A.y;
      var p1 = exit(A, dx, dy), p2 = exit(B, -dx, -dy);
      return { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] };
    }

    function draw() {
      [gEdges, gNodes, gSide].forEach(function (g) { while (g.firstChild) g.removeChild(g.firstChild); });
      EDGES.forEach(function (e) {
        if (!present(e[1])) return;
        var q = edgePts(e[0], e[1]);
        var hot = st.cur === e[0] && st.hot.indexOf(e[1]) >= 0 ||
          e[2] === "method" && st.hot.indexOf(e[1]) >= 0;
        var dash = e[2] === "method" ? "2 4" : e[2] === "marker" ? "5 3" : "";
        V.svg("line", { x1: q.x1, y1: q.y1, x2: q.x2, y2: q.y2,
          "marker-end": "url(#ld-arrow-" + (hot ? "c1" : "line") + ")",
          style: "stroke-width:" + (hot ? 1.8 : 1.1) + ";stroke:" + (hot ? "var(--viz-c1)" : "var(--viz-line)") +
            (dash ? ";stroke-dasharray:" + dash : "") }, gEdges);
      });
      V.svg("text", { x: 110, y: 314, "text-anchor": "middle", style: "font-size:10.5px;fill:var(--viz-muted)", text: L("方法", "methods") }, gEdges);

      Object.keys(NODES).forEach(function (k) {
        if (!present(k)) return;
        var n = NODES[k], b = box[k];
        var cur = st.cur === k, marked = !!st.marked[k];
        var cand = !st.done && st.cand.indexOf(k) >= 0;
        var dropped = st.done && !marked && !n.marker;
        var seen = n.marker && st.iface;
        var c = cur ? "var(--viz-c1)" : marked || seen ? "var(--viz-c3)" : cand ? "var(--viz-c4)"
          : dropped ? "var(--viz-c2)" : "var(--viz-line)";
        var tinted = cur || marked || seen || cand || dropped;
        V.svg("rect", { x: b.x - b.w / 2, y: b.y - b.h / 2, width: b.w, height: b.h, rx: 6,
          style: "fill:" + (tinted ? c : "var(--viz-fill)") + ";fill-opacity:" + (tinted ? 0.16 : 1) +
            ";stroke:" + c + ";stroke-width:" + (cur ? 2 : 1.2) +
            (n.marker || dropped || cand ? ";stroke-dasharray:4 3" : "") }, gNodes);
        V.svg("text", { x: b.x, y: b.y + 4.5, "text-anchor": "middle",
          style: "font-size:12px;font-family:var(--font-mono,monospace)" + (dropped ? ";text-decoration:line-through" : ""),
          text: n.s }, gNodes);
        var tag = k === "entry" ? L("起点", "start") : dropped ? L("丢弃", "dropped") : cand ? L("候选", "candidate") : "";
        if (tag) {
          var right = b.x + b.w / 2 + 6;
          V.svg("text", { x: right, y: b.y + 4, style: "font-size:11px;fill:" + c, text: tag }, gNodes);
        }
      });

      // Side panel.
      var x0 = 496, y = 22;
      function head(t) { V.svg("text", { x: x0, y: y, style: "font-size:12px;font-weight:600", text: t }, gSide); y += 19; }
      function line(t, col, mono) {
        V.svg("text", { x: x0 + 8, y: y, style: "font-size:11.5px;fill:" + (col || "var(--viz-ink)") +
          (mono ? ";font-family:var(--font-mono,monospace)" : ""), text: t }, gSide);
        y += 17;
      }
      head(L("待处理", "To process"));
      if (st.queue.length) st.queue.slice(0, 4).forEach(function (k) { line(NODES[k].s, null, true); });
      else line(L("（空）", "(empty)"), "var(--viz-muted)");
      if (st.queue.length > 4) line("…", "var(--viz-muted)");
      y += 8;
      head(L("被调用过的接口方法", "Interface methods called"));
      line(st.iface ? "Quack() string" : L("（无）", "(none)"), st.iface ? null : "var(--viz-muted)", st.iface);
      y += 8;
      head(L("按变量名查方法的反射", "Reflection by computed name"));
      line(st.reflectSeen ? L("见到了：保留全部导出方法", "seen: keep all exported methods")
        : L("未见到", "not seen"), st.reflectSeen ? "var(--viz-c2)" : "var(--viz-muted)");
      y += 8;
      head(L("已标记", "Marked"));
      var nm = Object.keys(st.marked).length, total = Object.keys(NODES).filter(function (k) { return present(k) && !NODES[k].marker; }).length;
      line(L(nm + " / " + total + " 个符号", nm + " of " + total + " symbols"));

      // Legend.
      var items = [["var(--viz-c1)", L("正在处理", "processing")], ["var(--viz-c3)", L("已标记，保留", "marked, kept")],
        ["var(--viz-c4)", L("候选方法", "candidate method")], ["var(--viz-c2)", L("未标记，丢弃", "unmarked, dropped")]];
      var lx = 8;
      items.forEach(function (it) {
        V.svg("rect", { x: lx, y: 364, width: 10, height: 10, rx: 2,
          style: "fill:" + it[0] + ";fill-opacity:.2;stroke:" + it[0] }, gSide);
        V.svg("text", { x: lx + 15, y: 373, style: "font-size:11px;fill:var(--viz-muted)", text: it[1] }, gSide);
        lx += 30 + textW(it[1], 11);
      });
      V.svg("text", { x: 8, y: 396, style: "font-size:11px;fill:var(--viz-muted)",
        text: L("实线：重定位（引用）；虚线：方法，只在被接口调用或反射用到时保留", "Solid: relocation (reference). Dotted: method, kept only if an interface call or reflection needs it.") }, gSide);
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
      }, 1300);
    });
    V.button(p.bar, L("重置", "Reset"), reset);
    var reflBtn = V.button(p.bar, "", function () {
      reflectOn = !reflectOn; reflBtn.classList.toggle("is-on", reflectOn); label(); reset();
    });
    function label() {
      reflBtn.textContent = reflectOn ? L("去掉反射调用", "Remove the reflect call")
        : L("加上 MethodByName(变量)", "Add MethodByName(variable)");
    }

    label();
    reset();
  });
})();
