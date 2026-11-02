/*
 * gc-pacer: the heap goal and the trigger under GOGC and GOMEMLIMIT
 * (book §13.3).
 *
 * The arithmetic is runtime/mgcpacer.go in Go 1.26:
 *   - commit: gcPercentHeapGoal = heapMarked + (heapMarked + lastStackScan +
 *     globalsScan) * GOGC/100, at least heapMinimum = 4 MiB * GOGC/100
 *     (setGCPercent); GOGC=off makes it infinite. runway = consMark *
 *     (1-0.25)/0.25 * (lastHeapScan + lastStackScan + globalsScan).
 *   - memoryLimitHeapGoal: goal = limit - nonHeap (heapMarked if nonHeap
 *     reaches the limit); headroom = max(goal/100*3, 1 MiB); goal -= headroom;
 *     never below heapMarked.
 *   - heapGoalInternal: the smaller of the two goals.
 *   - trigger: goal - runway, clamped to [heapMarked + (goal-heapMarked)/64*45,
 *     heapMarked + (goal-heapMarked)/64*61], where the upper bound becomes
 *     goal - defaultHeapMinimum (4 MiB, not scaled by GOGC) when that is
 *     higher; trigger = goal if heapMarked >= goal.
 * Model assumptions, stated in the figure: stacks plus globals scan 1 MiB;
 * the whole live heap is scannable (lastHeapScan = heapMarked); non-heap
 * memory (mappedReady - heapFree - heapAlloc) is 8 MiB; heapFree is zero, so
 * in steady state mappedReady stays under the limit and the overage term is
 * zero; the sweep is done when commit runs (no sweepDistMinTrigger). The
 * sawtooth assumes a steady state in which marking ends exactly at the goal
 * and heapLive drops back to heapMarked.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MiB = 1 << 20, ROOTS = 1 * MiB, NONHEAP = 8 * MiB, HEAPMIN = 4 * MiB;
  var LIVE = [1, 2, 4, 8, 16, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096];
  var LIMITS = [0, 32, 64, 100, 128, 192, 256, 512, 1024, 2048, 4096, 8192];

  function compute(H, p, limit, cm) {
    var r = { H: H, p: p, limit: limit, cm: cm };
    // gcPercent goal
    if (p < 0) { r.gcGoal = Infinity; r.heapMin = 0; }
    else {
      r.heapMin = Math.floor(HEAPMIN * p / 100);
      r.gcGoal = H + Math.floor((H + ROOTS) * p / 100);
      if (r.gcGoal < r.heapMin) { r.gcGoal = r.heapMin; r.floored = true; }
    }
    // memory-limit goal
    if (!limit) r.limGoal = Infinity;
    else if (NONHEAP >= limit) r.limGoal = H;
    else {
      var g = limit - NONHEAP, head = Math.max(Math.floor(g / 100) * 3, MiB);
      r.headroom = head;
      g = (g < head || g - head < head) ? head : g - head;
      if (g < H) { g = H; r.limFloor = true; }
      r.limGoal = g;
    }
    r.byLimit = r.limGoal < r.gcGoal;
    r.goal = Math.min(r.gcGoal, r.limGoal);
    if (!isFinite(r.goal)) return r;
    // trigger
    r.runway = cm * 3 * (H + ROOTS);
    if (H >= r.goal) { r.lower = r.upper = r.trigger = r.goal; r.raw = r.goal; r.spiral = true; return r; }
    var d = Math.floor((r.goal - H) / 64);
    r.lower = d * 45 + H;
    r.upper = d * 61 + H;
    if (r.goal > HEAPMIN && r.goal - HEAPMIN > r.upper) { r.upper = r.goal - HEAPMIN; r.upperIsMin = true; }
    r.upper = Math.max(r.upper, r.lower);
    r.raw = r.runway > r.goal ? r.lower : r.goal - r.runway;
    r.trigger = Math.min(Math.max(r.raw, r.lower), r.upper);
    r.clamp = r.raw < r.lower ? "low" : r.raw > r.upper ? "high" : "";
    return r;
  }

  function fmt(b) {
    if (!isFinite(b)) return "∞";
    var m = b / MiB;
    return m >= 1000 ? (m / 1024).toFixed(2) + " GiB" : m.toFixed(1) + " MiB";
  }
  function limLabel(v) { return v >= 1024 ? v / 1024 + " GiB" : v + " MiB"; }
  function tw(s, fs) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? fs : fs * 0.56; return w; }

  V.register("gc-pacer", function (host) {
    var p = V.panel(host, { title: L("调步器：堆目标与触发点", "The pacer: heap goal and trigger") });
    var root = V.svg("svg", { viewBox: "0 0 720 330", role: "img",
      "aria-label": L("堆的锯齿曲线、堆目标、触发点与内存限制", "Heap sawtooth with heap goal, trigger and memory limit") }, p.stage);
    var g = V.svg("g", null, root);
    var H = 64 * MiB, gogc = 100, limit = 0, cm = 0.05;

    function clear() { while (g.firstChild) g.removeChild(g.firstChild); }
    function text(x, y, s, st, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: st || "font-size:12px", text: s }, g);
    }
    function line(x1, y1, x2, y2, st) { return V.svg("line", { x1: x1, y1: y1, x2: x2, y2: y2, style: st }, g); }

    // ---- sawtooth --------------------------------------------------------
    var CX0 = 52, CX1 = 448, CY0 = 22, CY1 = 196;
    function niceStep(max) {
      var raw = max / 4, e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
      return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
    }
    function drawChart(r) {
      var finite = isFinite(r.goal);
      var topB = Math.max(finite ? NONHEAP + r.goal : NONHEAP + 3 * r.H, r.limit || 0) * 1.08;
      var U = topB >= 1536 * MiB ? 1024 * MiB : MiB, top = topB / U;
      var step = niceStep(top), ymax = Math.ceil(top / step) * step;
      function Y(b) { return CY1 - (b / U) / ymax * (CY1 - CY0); }
      // axes and grid
      for (var v = 0; v <= ymax + 1e-9; v += step) {
        var yy = Y(v * U);
        line(CX0, yy, CX1, yy, "stroke:var(--viz-line);stroke-opacity:.5");
        text(CX0 - 6, yy + 4, String(+v.toFixed(2)), "font-size:10px;fill:var(--viz-muted)", "end");
      }
      text(CX0 - 44, CY0 - 10, U > MiB ? L("内存（GiB）", "Memory (GiB)") : L("内存（MiB）", "Memory (MiB)"), "font-size:10.5px;fill:var(--viz-muted)");
      text(CX1, CY1 + 15, L("时间（分配速率不变）→", "time (constant allocation rate) →"), "font-size:10.5px;fill:var(--viz-muted)", "end");
      // non-heap band
      V.svg("rect", { x: CX0, y: Y(NONHEAP), width: CX1 - CX0, height: CY1 - Y(NONHEAP),
        style: "fill:var(--viz-muted);fill-opacity:.18" }, g);
      // teeth: the window is 4 * (H + roots) bytes of allocation
      var win = 4 * (r.H + ROOTS), base = NONHEAP;
      function X(a) { return CX0 + a / win * (CX1 - CX0); }
      if (!finite) {
        var y2 = Y(Math.min(base + r.H + win, ymax * U));
        V.svg("path", { d: "M" + CX0 + "," + Y(base + r.H) + " L" + CX1 + "," + y2 + " L" + CX1 + "," + Y(base) + " L" + CX0 + "," + Y(base) + "z",
          style: "fill:var(--viz-c1);fill-opacity:.14;stroke:none" }, g);
        line(CX0, Y(base + r.H), CX1, y2, "stroke:var(--viz-c1);stroke-width:1.6");
        text((CX0 + CX1) / 2, Y(base + r.H) - 12, L("堆的增长不会触发回收", "heap growth never triggers a cycle"), "font-size:11.5px;fill:var(--viz-c1)", "middle");
      } else {
        var cyc = r.goal - r.H, n = win / cyc;
        if (n > 60) {
          var yb = Y(base + r.H), ht = Math.max(yb - Y(base + r.goal), 3);
          V.svg("rect", { x: CX0, y: yb - ht, width: CX1 - CX0, height: ht, style: "fill:var(--viz-c2);fill-opacity:.45" }, g);
          V.svg("rect", { x: CX0, y: yb, width: CX1 - CX0, height: Y(base) - yb, style: "fill:var(--viz-c1);fill-opacity:.12" }, g);
          text((CX0 + CX1) / 2, (yb + Y(base)) / 2 + 4, r.spiral ? L("回收接连不断", "cycles run back to back") : L("回收几乎一刻不停", "the collector almost never stops"),
            "font-size:11.5px;font-weight:600;fill:var(--viz-c2)", "middle");
        } else {
          var d = "", a0 = 0;
          while (a0 < win) {
            var aT = a0 + (r.trigger - r.H), aG = a0 + cyc;
            // marking phase band
            V.svg("rect", { x: X(aT), y: CY0, width: Math.max(X(Math.min(aG, win)) - X(Math.min(aT, win)), 0), height: CY1 - CY0,
              style: "fill:var(--viz-c2);fill-opacity:.07" }, g);
            d += (a0 === 0 ? "M" : "L") + X(a0) + "," + Y(base + r.H);
            var aE = Math.min(aG, win), hE = r.H + (aE - a0);
            d += " L" + X(aE) + "," + Y(base + hE);
            if (aG <= win) d += " L" + X(aG) + "," + Y(base + r.H);
            a0 = aG;
          }
          V.svg("path", { d: d + " L" + CX1 + "," + Y(base) + " L" + CX0 + "," + Y(base) + "z", style: "fill:var(--viz-c1);fill-opacity:.12;stroke:none" }, g);
          V.svg("path", { d: d, style: "fill:none;stroke:var(--viz-c1);stroke-width:1.6" }, g);
        }
        // level markers at the right edge
        var marks = [[r.goal, L("目标", "goal"), "var(--viz-ink)"], [r.trigger, L("触发", "trigger"), "var(--viz-c2)"], [r.H, L("存活", "live"), "var(--viz-muted)"]];
        var lastY = -99;
        marks.forEach(function (m) {
          var yy = Y(base + m[0]), ty = Math.max(yy + 4, lastY + 11);
          line(CX1 - 6, yy, CX1 + 2, yy, "stroke:" + m[2] + ";stroke-width:1.5");
          text(CX1 + 5, ty, m[1], "font-size:10px;fill:" + m[2]);
          lastY = ty;
        });
      }
      if (r.limit) {
        var ly = Y(r.limit);
        line(CX0, ly, CX1, ly, "stroke:var(--viz-c2);stroke-width:1.5;stroke-dasharray:6 4");
        text(CX0 + 6, ly - 5, "GOMEMLIMIT " + limLabel(r.limit / MiB), "font-size:10.5px;font-weight:600;fill:var(--viz-c2)");
      }
      line(CX0, CY0, CX0, CY1, "stroke:var(--viz-line)");
      line(CX0, CY1, CX1, CY1, "stroke:var(--viz-line)");
    }

    // ---- computation table ----------------------------------------------
    function drawTable(r) {
      var x = 486, xv = 712, y = 20;
      function row(lab, val, st, sub) {
        text(x, y, lab, "font-size:11.5px;" + (st || ""));
        text(xv, y, val, "font-size:11.5px;font-family:var(--font-mono,monospace);" + (st || ""), "end");
        y += 17;
        if (sub) { text(x + 8, y - 3, sub, "font-size:10px;fill:var(--viz-muted)"); y += 13; }
      }
      var bold = "font-weight:700";
      row(L("GOGC 目标", "GOGC goal"), r.p < 0 ? L("∞（off）", "∞ (off)") : fmt(r.gcGoal), r.byLimit ? "fill:var(--viz-muted)" : "",
        r.p < 0 ? null : (r.floored ? L("取下限 4 MiB × GOGC/100", "floor 4 MiB × GOGC/100 applies") : L("存活 + (存活 + 根)×" + r.p + "%", "live + (live + roots) × " + r.p + "%")));
      row(L("限制目标", "Limit goal"), r.limit ? fmt(r.limGoal) : L("未设置", "not set"), r.byLimit ? "" : "fill:var(--viz-muted)",
        r.limit ? (r.limFloor || NONHEAP >= r.limit ? L("已压到存活堆", "pressed down to the live heap") : L("扣除非堆开销与余量 " + fmt(r.headroom), "minus non-heap and headroom " + fmt(r.headroom))) : null);
      row(L("堆目标（较小者）", "Heap goal (smaller)"), fmt(r.goal), bold);
      y += 6;
      if (!isFinite(r.goal)) {
        text(x, y, L("没有堆目标，也就没有触发点。", "No heap goal, so no trigger."), "font-size:11.5px;fill:var(--viz-muted)");
        return;
      }
      row(L("提前量", "Runway"), fmt(r.runway), "", L("cons/mark × 3 × 扫描量", "cons/mark × 3 × scan work"));
      row(L("目标 − 提前量", "Goal − runway"), r.spiral ? "—" : r.runway > r.goal ? "< 0" : fmt(r.goal - r.runway), "fill:var(--viz-muted)");
      row(L("触发点", "Trigger"), fmt(r.trigger), bold + ";fill:var(--viz-c2)",
        r.spiral ? L("目标不高于存活堆", "goal at the live heap") : r.clamp === "low" ? L("被下界抬高", "raised to the lower bound")
          : r.clamp === "high" ? L("被上界压低", "lowered to the upper bound") : L("在允许范围之内", "within the bounds"));
      row(L("两轮之间可分配", "Allocation per cycle"), fmt(r.goal - r.H), "");
    }

    // ---- trigger ruler ---------------------------------------------------
    function drawRuler(r) {
      var y = 262, x0 = 60, x1 = 660;
      text(8, y - 26, L("触发点的允许范围（从存活堆到目标）", "Where the trigger may sit (from the live heap to the goal)"), "font-size:12px;font-weight:600");
      if (!isFinite(r.goal) || r.spiral) {
        text(8, y + 4, !isFinite(r.goal) ? L("（无）", "(none)") : L("目标已等于存活堆：堆一达到存活堆就触发，回收接连不断。", "The goal equals the live heap: every cycle triggers at once, back to back."),
          "font-size:11.5px;fill:var(--viz-muted)");
        return;
      }
      function X(b) { return x0 + (b - r.H) / (r.goal - r.H) * (x1 - x0); }
      line(x0, y, x1, y, "stroke:var(--viz-line);stroke-width:6;stroke-linecap:round");
      V.svg("rect", { x: X(r.lower), y: y - 7, width: Math.max(X(r.upper) - X(r.lower), 2), height: 14, rx: 3,
        style: "fill:var(--viz-c3);fill-opacity:.25;stroke:var(--viz-c3)" }, g);
      text(x0, y + 24, L("存活 ", "live ") + fmt(r.H), "font-size:10.5px;fill:var(--viz-muted)", "middle");
      text(x1, y + 24, L("目标 ", "goal ") + fmt(r.goal), "font-size:10.5px;fill:var(--viz-muted)", "middle");
      text(X(r.lower), y - 12, "45/64", "font-size:10px;fill:var(--viz-c3)", "end");
      text(X(r.upper), y - 12, r.upperIsMin ? L("目标 − 4 MiB", "goal − 4 MiB") : "61/64", "font-size:10px;fill:var(--viz-c3)", "start");
      // raw goal - runway, may lie outside
      var rawX = Math.max(x0 - 30, Math.min(x1 + 30, r.runway > r.goal ? x0 - 30 : X(r.raw)));
      V.svg("path", { d: "M" + rawX + "," + (y + 9) + " l-5,9 h10 z", style: "fill:none;stroke:var(--viz-muted);stroke-width:1.3" }, g);
      if (r.clamp) {
        line(rawX, y + 13, X(r.trigger), y + 13, "stroke:var(--viz-muted);stroke-dasharray:2 2");
      }
      var tx = X(r.trigger);
      line(tx, y - 10, tx, y + 10, "stroke:var(--viz-c2);stroke-width:3");
      var lab = L("触发 ", "trigger ") + fmt(r.trigger);
      var anchor = tx > x1 - 60 ? "end" : tx < x0 + 60 ? "start" : "middle";
      text(tx, y + 38, lab, "font-size:11px;font-weight:600;fill:var(--viz-c2)", anchor);
    }

    function legend() {
      var y = 316, x = 8;
      [["var(--viz-muted)", 0.25, L("非堆开销 8 MiB", "non-heap 8 MiB")], ["var(--viz-c1)", 0.2, L("堆", "heap")],
        ["var(--viz-c2)", 0.12, L("标记阶段", "marking")], ["var(--viz-c3)", 0.25, L("触发点的允许范围", "allowed trigger range")]].forEach(function (it) {
        V.svg("rect", { x: x, y: y - 10, width: 12, height: 12, rx: 2, style: "fill:" + it[0] + ";fill-opacity:" + it[1] + ";stroke:" + it[0] }, g);
        text(x + 17, y, it[2], "font-size:10.5px;fill:var(--viz-muted)");
        x += 17 + tw(it[2], 10.5) + 16;
      });
      text(712, y, L("假设：栈与全局变量共 1 MiB，存活堆全部含指针", "Assumed: stacks and globals 1 MiB, all live heap scannable"), "font-size:10.5px;fill:var(--viz-muted)", "end");
    }

    function narrate(r) {
      var s;
      if (!isFinite(r.goal)) s = L("GOGC=off 且没有内存限制：堆目标为无穷大，堆的增长不会触发回收，只有 runtime.GC() 能开始一轮回收；两分钟的定时触发此时也不起作用。",
        "GOGC=off with no memory limit: the heap goal is infinite, so heap growth never starts a cycle; only runtime.GC() does, and the two-minute timer is off too.");
      else if (r.spiral) s = L("按内存限制算出的目标已不高于存活堆，目标只能取存活堆本身，回收接连不断。CPU 限制器把回收的 CPU 占用限制在约 50%，堆因此可能越过限制。",
        "The goal derived from the memory limit is no higher than the live heap, so the goal is the live heap itself and cycles run back to back. The CPU limiter caps GC at about 50% of the CPU, so the heap may go over the limit.");
      else {
        var per = fmt(r.goal - r.H);
        if (r.byLimit) s = L("内存限制生效：" + limLabel(r.limit / MiB) + " 扣除非堆开销 8 MiB 与余量 " + fmt(r.headroom) + "，得到 " + fmt(r.limGoal) +
            (r.p < 0 ? "。" : "，小于 GOGC 给出的 " + fmt(r.gcGoal) + "。") + "每两轮回收之间只能分配 " + per + "。",
          "The memory limit binds: " + limLabel(r.limit / MiB) + " minus 8 MiB of non-heap memory and " + fmt(r.headroom) + " of headroom gives " + fmt(r.limGoal) +
            (r.p < 0 ? ". " : ", below the GOGC goal of " + fmt(r.gcGoal) + ". ") + "Only " + per + " can be allocated between cycles.");
        else s = r.floored ? L("存活堆很小，按比例算出的目标低于下限 4 MiB × GOGC/100，目标取 " + fmt(r.goal) + "。", "The live heap is small: the proportional goal is below the 4 MiB × GOGC/100 floor, so the goal is " + fmt(r.goal) + ".")
          : L("GOGC=" + r.p + "：目标 = 存活堆 + (存活堆 + 根) × " + r.p + "% = " + fmt(r.goal) + "，每两轮回收之间可分配 " + per + "。",
            "GOGC=" + r.p + ": goal = live + (live + roots) × " + r.p + "% = " + fmt(r.goal) + ", so " + per + " can be allocated between cycles.");
        if (r.clamp === "low") s += L("提前量 " + fmt(r.runway) + " 过大，触发点被抬到 45/64 处：宁可标记期间多用 CPU，也不过早开始。", " The runway of " + fmt(r.runway) + " is too large, so the trigger is raised to 45/64: better to spend more CPU while marking than to start too early.");
        else if (r.clamp === "high") s += L("提前量只有 " + fmt(r.runway) + "，触发点被压到" + (r.upperIsMin ? "目标 − 4 MiB" : " 61/64 ") + "处，标记开始时总留有余地。", " The runway is only " + fmt(r.runway) + ", so the trigger is lowered to " + (r.upperIsMin ? "goal − 4 MiB" : "61/64") + ", leaving some room when marking starts.");
        else s += L("触发点 = 目标 − 提前量 = " + fmt(r.trigger) + "，在允许范围之内。", " Trigger = goal − runway = " + fmt(r.trigger) + ", within the bounds.");
      }
      p.note.textContent = s;
    }

    function draw() {
      clear();
      var r = compute(H, gogc, limit * MiB, cm);
      drawChart(r); drawTable(r); drawRuler(r); legend(); narrate(r);
    }

    var hs = V.slider(p.bar, "", 0, LIVE.length - 1, LIVE.indexOf(64), function (i) { H = LIVE[i] * MiB; hlab(); draw(); });
    var hspan = hs.parentNode.firstChild;
    hs.parentNode.style.color = "var(--viz-ink)";
    hs.setAttribute("aria-label", L("存活堆", "Live heap"));
    function hlab() { hspan.textContent = L("存活堆 ", "Live heap ") + fmt(H).replace(".0 ", " "); }
    hlab();
    var sel = [
      V.select(p.bar, "GOGC", [-1, 25, 50, 100, 200, 400].map(function (v) { return { value: String(v), label: v < 0 ? "off" : String(v) }; }), "100",
        function (v) { gogc = +v; draw(); }),
      V.select(p.bar, "GOMEMLIMIT", LIMITS.map(function (v) { return { value: String(v), label: v ? limLabel(v) : "off" }; }), "0",
        function (v) { limit = +v; draw(); }),
      V.select(p.bar, "cons/mark", [0.01, 0.03, 0.05, 0.1, 0.2].map(function (v) { return { value: String(v), label: String(v) }; }), "0.05",
        function (v) { cm = +v; draw(); }),
    ];
    sel.forEach(function (s) { s.parentNode.style.color = "var(--viz-ink)"; });

    draw();
  });
})();
