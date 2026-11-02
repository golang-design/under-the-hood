/*
 * gc-barrier: which write barrier stops the mutator from hiding an object
 * (book §13.2).
 *
 * The two scenarios are the two ways of hiding an object listed in the
 * comment at the top of runtime/mbarrier.go (Go 1.26):
 *   1. move the sole pointer from the heap onto a stack that has already
 *      been scanned (black), then delete it from the heap;
 *   2. move the sole pointer from a stack that has not been scanned yet
 *      (grey) into a black heap object, then drop it from the stack.
 * Stacks are scanned concurrently, one at a time, and never rescanned, as in
 * Go since 1.8; stack writes have no barrier. Barriers:
 *   none      *slot = ptr
 *   Dijkstra  shade(ptr); *slot = ptr          (insertion)
 *   Yuasa     shade(*slot); *slot = ptr        (deletion)
 *   hybrid    shade(*slot); shade(ptr); *slot = ptr
 * The hybrid barrier is drawn as Go implements it, without the "if current
 * stack is grey" condition of the design (mbarrier.go, wbBufFlush1 in
 * mwbbuf.go); both forms behave the same in these two scenarios. Go records
 * the two pointers in the per-P wbBuf and shades them when the buffer is
 * flushed, at the latest when marking finishes; the figure shades them at
 * once. Shading turns a white object grey; scanning a grey object turns it
 * black. Only the hybrid barrier keeps the object in both scenarios; the
 * others need a stop-the-world stack rescan (Dijkstra, Go 1.5 to 1.7) or a
 * stop-the-world scan of all stacks at the start (Yuasa).
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace)";
  function tw(s, fs) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? fs : fs * 0.56; return w; }

  var BARRIERS = {
    none: { label: L("无屏障", "No barrier"), code: ["*slot = ptr"], old: false, nu: false },
    dijkstra: { label: L("Dijkstra 插入屏障", "Dijkstra insertion"), code: ["shade(ptr)", "*slot = ptr"], old: false, nu: true },
    yuasa: { label: L("Yuasa 删除屏障", "Yuasa deletion"), code: ["shade(*slot)", "*slot = ptr"], old: true, nu: false },
    hybrid: { label: L("混合写屏障（Go）", "Hybrid barrier (Go)"), code: ["shade(*slot)", "shade(ptr)", "*slot = ptr"], old: true, nu: true },
  };

  // Build the frames of one run. Each frame is a full state plus narration.
  function run(scn, bk) {
    var b = BARRIERS[bk], frames = [];
    var col = { A: "black", B: "grey", C: "white", S: scn === 1 ? "black" : "grey" };
    var edges = scn === 1 ? { "B>C": 1 } : { "S>C": 1 };
    function snap(f) {
      f.col = JSON.parse(JSON.stringify(col)); f.edges = JSON.parse(JSON.stringify(edges));
      frames.push(f);
    }
    function shade(o) { if (o && col[o] === "white") { col[o] = "grey"; return true; } return false; }

    if (scn === 1) {
      snap({ step: 0, text: L("G 的栈已经扫描过（黑色）。A 已扫描（黑），B 在灰色队列中，C 尚未访问（白），只能经由 B.f 到达。",
        "G's stack has been scanned (black). A is scanned (black), B is queued (grey), and C is unvisited (white), reachable only through B.f.") });
      edges["S>C"] = 1;
      snap({ step: 1, added: "S>C", text: L("赋值器执行 x = B.f，把 C 的指针复制到栈上。栈上的写入没有写屏障，回收器看不到这次写入。",
        "The mutator runs x = B.f, copying C's pointer onto its stack. Stack writes have no barrier, so the collector does not see it.") });
      var s1 = b.old ? shade("C") : false;
      delete edges["B>C"];
      snap({ step: 2, code: true, slot: "B.f", oldv: "C", newv: "nil", shaded: s1 ? "C" : null, removed: "B>C",
        text: b.old ? L("赋值器执行 B.f = nil。屏障置灰被覆盖的旧值 C" + (b.nu ? "；新值是 nil，无须置灰" : "") + "。",
          "The mutator runs B.f = nil. The barrier shades the overwritten value C" + (b.nu ? "; the new value is nil" : "") + ".")
          : b.nu ? L("赋值器执行 B.f = nil。Dijkstra 屏障只置灰新值，而新值是 nil；从堆中摘下的 C 没有被置灰。",
            "The mutator runs B.f = nil. A Dijkstra barrier shades only the new value, which is nil; C, unlinked from the heap, stays white.")
          : L("赋值器执行 B.f = nil，没有任何屏障。", "The mutator runs B.f = nil with no barrier.") });
      col.B = "black";
      snap({ step: 3, scanned: "B", text: L("回收器扫描 B：B.f 已是 nil，B 变黑，没有发现新的对象。", "The collector scans B: B.f is nil now, so B turns black and yields nothing.") });
    } else {
      snap({ step: 0, text: L("G 的栈尚未扫描（灰色），其中的 x 指向 C。C 是白色的，只有这个栈引用它。A 已扫描（黑），B 在灰色队列中。",
        "G's stack has not been scanned (grey); its x points to C. C is white and only this stack refers to it. A is scanned (black), B is queued (grey).") });
      var s2 = b.nu ? shade("C") : false;
      edges["A>C"] = 1;
      snap({ step: 1, code: true, slot: "A.f", oldv: "nil", newv: "C", shaded: s2 ? "C" : null, added: "A>C",
        text: b.nu ? L("赋值器执行 A.f = x，把 C 写入黑色的 A。屏障置灰新值 C" + (b.old ? "；旧值是 nil。设计文档的版本只在当前栈为灰色时置灰新值，这里栈正是灰色" : "") + "。",
          "The mutator runs A.f = x, storing C into black A. The barrier shades the new value C" + (b.old ? "; the old value is nil. The design shades the new value only while the stack is grey, which it is here" : "") + ".")
          : b.old ? L("赋值器执行 A.f = x。Yuasa 屏障只置灰旧值，而旧值是 nil；黑色的 A 现在指向白色的 C。",
            "The mutator runs A.f = x. A Yuasa barrier shades only the old value, which is nil; black A now points to white C.")
          : L("赋值器执行 A.f = x，没有任何屏障。黑色的 A 现在指向白色的 C。", "The mutator runs A.f = x with no barrier. Black A now points to white C.") });
      delete edges["S>C"];
      snap({ step: 2, removed: "S>C", text: L("赋值器执行 x = nil。栈上的写入没有屏障，C 在栈上的最后一个指针消失了。",
        "The mutator runs x = nil. Stack writes have no barrier, and C's last pointer on the stack is gone.") });
      col.S = "black";
      snap({ step: 3, scanned: "S", text: L("回收器暂停 G，扫描它的栈：x 已是 nil，栈变黑，没有发现新的对象。此后不再重扫这个栈。",
        "The collector pauses G and scans its stack: x is nil, so the stack turns black and yields nothing. It will not be rescanned.") });
    }
    // drain the grey objects
    var drained = [];
    ["B", "C"].forEach(function (o) { if (col[o] === "grey") { col[o] = "black"; drained.push(o); } });
    snap({ step: 4, scanned: drained.join(","), text: drained.length
      ? L("回收器扫描剩余的灰色对象 " + drained.join("、") + "，它们变黑。", "The collector scans the remaining grey objects " + drained.join(", ") + "; they turn black.")
      : L("没有灰色对象了。", "No grey objects are left.") });
    var lost = col.C === "white";
    var why;
    if (!lost) why = L("C 是黑色的，保留下来。" + (bk === "hybrid" ? "混合写屏障在两种情形下都守住了 C，既不需要重扫栈，也不需要在标记开始时一次扫描全部栈。"
        : bk === "yuasa" ? "删除屏障在 C 被摘下时将其置灰。可切换到另一种情形对照。" : "插入屏障在 C 写入黑色对象时将其置灰。可切换到另一种情形对照。"),
      "C is black and survives. " + (bk === "hybrid" ? "The hybrid barrier saves C in both scenarios, with no stack rescan and no scan of all stacks at the start."
        : bk === "yuasa" ? "The deletion barrier shaded C when it was unlinked. Try the other scenario." : "The insertion barrier shaded C when it was stored into a black object. Try the other scenario."));
    else if (bk === "dijkstra") why = L("C 仍被黑色的栈引用，却是白色的，清扫时会被回收。要救回它，只能在标记终止时停止一切、重扫所有的栈，这正是 Go 1.5 至 1.7 的做法。",
      "C is still referenced from the black stack yet white, so it would be swept. Only a stop-the-world rescan of all stacks at mark termination can save it, which is what Go 1.5 to 1.7 did.");
    else if (bk === "yuasa") why = L("C 仍被黑色的 A 引用，却是白色的，清扫时会被回收。Yuasa 屏障要求在标记开始时停止一切、一次扫描全部的栈，C 才会在被藏起之前得到标记。",
      "C is still referenced from black A yet white, so it would be swept. A Yuasa barrier needs a stop-the-world scan of all stacks when marking starts, so that C is marked before it can be hidden.");
    else why = L("C 仍然可达，却是白色的，清扫时会被回收，留下一个悬垂指针。", "C is still reachable yet white, so it would be swept, leaving a dangling pointer.");
    snap({ step: 5, verdict: lost ? "lost" : "ok", text: L("标记结束。", "Marking ends. ") + why });
    return frames;
  }

  V.register("gc-barrier", function (host) {
    var p = V.panel(host, { title: L("写屏障：赋值器能否把对象藏起来", "Write barriers: can the mutator hide an object?") });
    var root = V.svg("svg", { viewBox: "0 0 720 278", role: "img",
      "aria-label": L("goroutine 栈与堆对象 A、B、C 的三色状态", "Tricolor state of a goroutine stack and heap objects A, B, C") }, p.stage);
    var defs = V.svg("defs", null, root);
    ["ink", "c2"].forEach(function (k) {
      var m = V.svg("marker", { id: "wb-arrow-" + k, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
      V.svg("path", { d: "M0,0 L10,5 L0,10 z", style: "fill:" + (k === "c2" ? "var(--viz-c2)" : "var(--viz-muted)") }, m);
    });
    var g = V.svg("g", null, root);
    var scn = 1, bk = "hybrid", frames, k = 0;

    function clear() { while (g.firstChild) g.removeChild(g.firstChild); }
    function text(x, y, s, st, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: st || "font-size:12px", text: s }, g);
    }
    function paint(c) {
      return c === "black" ? { fill: "var(--viz-ink)", op: 1, stroke: "var(--viz-ink)", txt: "var(--viz-fill)" }
        : c === "grey" ? { fill: "var(--viz-muted)", op: 0.45, stroke: "var(--viz-muted)", txt: "var(--viz-ink)" }
        : { fill: "var(--viz-fill)", op: 1, stroke: "var(--viz-ink)", txt: "var(--viz-ink)" };
    }
    function colName(c) { return { black: L("黑", "black"), grey: L("灰", "grey"), white: L("白", "white") }[c]; }

    var STEPS = {
      1: [L("初始状态", "Start"), "x = B.f", "B.f = nil", L("扫描 B", "scan B"), L("扫描其余灰色对象", "scan the rest"), L("标记结束", "marking ends")],
      2: [L("初始状态", "Start"), "A.f = x", "x = nil", L("扫描 G 的栈", "scan G's stack"), L("扫描其余灰色对象", "scan the rest"), L("标记结束", "marking ends")],
    };
    function stepKind(i) {
      if (i === 0 || i === 5) return "";
      if (scn === 1) return i === 1 ? L("栈", "stack") : i === 2 ? L("堆", "heap") : L("回收器", "GC");
      return i === 1 ? L("堆", "heap") : i === 2 ? L("栈", "stack") : L("回收器", "GC");
    }

    function drawLeft(f) {
      var b = BARRIERS[bk], x = 8, y = 18;
      text(x, y, b.label, "font-size:12px;font-weight:600");
      V.svg("rect", { x: x, y: y + 8, width: 228, height: 24 + b.code.length * 17, rx: 5, style: "fill:var(--viz-fill);stroke:var(--viz-line)" }, g);
      text(x + 10, y + 24, "writePointer(slot, ptr):", "font-size:11px;fill:var(--viz-muted);" + MONO);
      b.code.forEach(function (c, i) {
        var hot = f.code;
        text(x + 22, y + 41 + i * 17, c, "font-size:11.5px;" + MONO + (hot ? ";fill:var(--viz-c1);font-weight:700" : ""));
      });
      var by = y + 38 + b.code.length * 17;
      if (f.code) text(x, by + 12, "slot = &" + f.slot + L("，", "; ") + "*slot = " + f.oldv + L("，", "; ") + "ptr = " + f.newv, "font-size:10.5px;fill:var(--viz-c1);" + MONO);
      // step list
      var sy = by + 36;
      text(x, sy, L("步骤", "Steps"), "font-size:12px;font-weight:600");
      STEPS[scn].forEach(function (s, i) {
        var yy = sy + 19 + i * 17, cur = i === f.step, done = i < f.step;
        text(x + 2, yy, (cur ? "▶ " : "   ") + i + ". " + s, "font-size:11px;" + (i >= 1 && i <= 2 ? MONO + ";" : "") +
          (cur ? "font-weight:700" : done ? "" : "fill:var(--viz-muted)"));
        var kd = stepKind(i);
        if (kd) text(x + 226, yy, kd, "font-size:10px;fill:var(--viz-muted)", "end");
      });
    }

    var POS = { A: [520, 62], B: [520, 186], C: [652, 124] };
    var SX = 286, SY = 72, SW = 128, SH = 104;
    function edge(id, f) {
      var removed = f.removed === id, added = f.added === id;
      var d;
      if (id === "S>C") d = "M" + (SX + SW - 18) + "," + (SY + 66) + " C" + 560 + "," + (SY + 66) + " " + 600 + "," + 140 + " " + (POS.C[0] - 25) + "," + (POS.C[1] + 6);
      else {
        var a = POS[id[0]], c = POS.C, dx = c[0] - a[0], dy = c[1] - a[1], len = Math.sqrt(dx * dx + dy * dy);
        d = "M" + (a[0] + dx / len * 24) + "," + (a[1] + dy / len * 24) + " L" + (c[0] - dx / len * 26) + "," + (c[1] - dy / len * 26);
      }
      V.svg("path", { d: d, "marker-end": "url(#wb-arrow-" + (added ? "c2" : "ink") + ")",
        style: "fill:none;stroke-width:" + (added ? 2 : 1.4) + ";stroke:" + (added ? "var(--viz-c2)" : "var(--viz-muted)") +
          (removed ? ";stroke-dasharray:4 4;stroke-opacity:.5" : "") }, g);
    }
    function drawGraph(f) {
      // edges first
      Object.keys(f.edges).forEach(function (id) { edge(id, f); });
      if (f.removed) edge(f.removed, f);
      // edge labels
      if (f.edges["B>C"] || f.removed === "B>C") text(590, 168, "B.f", "font-size:10.5px;fill:var(--viz-muted);" + MONO);
      if (f.edges["A>C"] || f.removed === "A>C") text(590, 84, "A.f", "font-size:10.5px;fill:var(--viz-muted);" + MONO);
      // stack box
      var sp = paint(f.col.S);
      V.svg("rect", { x: SX, y: SY, width: SW, height: SH, rx: 6, style: "fill:var(--viz-fill);stroke:" + sp.stroke + ";stroke-width:1.5" }, g);
      V.svg("rect", { x: SX, y: SY, width: SW, height: 26, rx: 6, style: "fill:" + sp.fill + ";fill-opacity:" + sp.op + ";stroke:" + sp.stroke + ";stroke-width:1.5" }, g);
      text(SX + SW / 2, SY + 17, L("G 的栈（" + colName(f.col.S) + "）", "G's stack (" + colName(f.col.S) + ")"), "font-size:11.5px;font-weight:600;fill:" + sp.txt, "middle");
      var slotHot = f.edges["S>C"];
      V.svg("rect", { x: SX + 16, y: SY + 52, width: SW - 32, height: 28, rx: 4, style: "fill:var(--viz-fill);stroke:var(--viz-line)" }, g);
      text(SX + 26, SY + 71, "x", "font-size:12px;font-weight:600;" + MONO);
      text(SX + SW - 26, SY + 71, slotHot ? "→ C" : "nil", "font-size:11.5px;" + MONO + (slotHot ? "" : ";fill:var(--viz-muted)"), "end");
      if (f.scanned && f.scanned.indexOf("S") >= 0) text(SX + SW / 2, SY + SH + 16, L("刚刚扫描", "just scanned"), "font-size:10.5px;fill:var(--viz-c1)", "middle");
      // heap objects
      text(470, 18, L("堆", "Heap"), "font-size:12px;font-weight:600");
      ["A", "B", "C"].forEach(function (o) {
        var q = POS[o], pc = paint(f.col[o]);
        if (f.shaded === o) V.svg("circle", { cx: q[0], cy: q[1], r: 30, style: "fill:none;stroke:var(--viz-c1);stroke-width:2.5" }, g);
        if (f.verdict && o === "C") V.svg("circle", { cx: q[0], cy: q[1], r: 30,
          style: "fill:none;stroke:" + (f.verdict === "lost" ? "var(--viz-c2)" : "var(--viz-c3)") + ";stroke-width:2.5" + (f.verdict === "lost" ? ";stroke-dasharray:5 3" : "") }, g);
        V.svg("circle", { cx: q[0], cy: q[1], r: 22, style: "fill:" + pc.fill + ";fill-opacity:" + pc.op + ";stroke:" + pc.stroke + ";stroke-width:1.5" }, g);
        text(q[0], q[1] + 5, o, "font-size:14px;font-weight:700;fill:" + pc.txt, "middle");
        var tag = colName(f.col[o]);
        if (f.shaded === o) tag += L("，刚被置灰", ", just shaded");
        else if (f.scanned && f.scanned.split(",").indexOf(o) >= 0) tag += L("，刚扫描", ", just scanned");
        text(q[0], q[1] + (o === "A" ? -36 : 42), tag, "font-size:10.5px;fill:" + (f.shaded === o ? "var(--viz-c1)" : "var(--viz-muted)"), "middle");
      });
      if (f.verdict) text(652, 196, f.verdict === "lost" ? L("漏标：可达却将被清扫", "lost: reachable, yet swept") : L("已标记，安全", "marked: safe"),
        "font-size:11.5px;font-weight:700;fill:" + (f.verdict === "lost" ? "var(--viz-c2)" : "var(--viz-c3)"), "middle");
      // legend
      var lx = 8, ly = 271;
      [["white", L("白：未访问", "white: unvisited")], ["grey", L("灰：待扫描", "grey: to scan")], ["black", L("黑：已扫描", "black: scanned")]].forEach(function (it) {
        var pc = paint(it[0]);
        V.svg("circle", { cx: lx + 6, cy: ly - 4, r: 6, style: "fill:" + pc.fill + ";fill-opacity:" + pc.op + ";stroke:" + pc.stroke }, g);
        text(lx + 16, ly, it[1], "font-size:10.5px;fill:var(--viz-muted)");
        lx += 16 + tw(it[1], 10.5) + 18;
      });
      V.svg("circle", { cx: lx + 6, cy: ly - 4, r: 6, style: "fill:none;stroke:var(--viz-c1);stroke-width:2" }, g);
      text(lx + 16, ly, L("被屏障置灰", "shaded by the barrier"), "font-size:10.5px;fill:var(--viz-muted)");
    }

    function draw() {
      clear();
      var f = frames[k];
      drawLeft(f); drawGraph(f);
      p.note.textContent = f.text;
      stepBtn.disabled = k >= frames.length - 1;
    }
    function rebuild() { frames = run(scn, bk); k = 0; draw(); }

    var stepBtn = V.button(p.bar, L("下一步", "Step"), function () { if (k < frames.length - 1) { k++; draw(); } });
    V.button(p.bar, L("显示结果", "Show result"), function () { k = frames.length - 1; draw(); });
    V.button(p.bar, L("重新开始", "Restart"), function () { k = 0; draw(); });
    var s1 = V.select(p.bar, L("情形", "Scenario"), [
      { value: "1", label: L("1：从堆移到已扫描的栈", "1: heap to a scanned stack") },
      { value: "2", label: L("2：从未扫描的栈移入黑色对象", "2: unscanned stack to a black object") },
    ], "1", function (v) { scn = +v; rebuild(); });
    var s2 = V.select(p.bar, L("屏障", "Barrier"), Object.keys(BARRIERS).map(function (id) {
      return { value: id, label: BARRIERS[id].label };
    }), bk, function (v) { bk = v; rebuild(); });
    [s1, s2].forEach(function (s) { s.parentNode.style.color = "var(--viz-ink)"; });

    rebuild();
  });
})();
