/*
 * bench-ramp: how a benchmark's iteration count grows toward -benchtime,
 * with b.N and with B.Loop (book §16.5.1, §16.5.2).
 *
 * Follows src/testing/benchmark.go in Go 1.26:
 *   predictN     n = goalns*prevIters/prevns (prevns 0 -> 1), n += n/5,
 *                n = min(n, 100*last), n = max(n, last+1),
 *                n = min(n, maxBenchPredictIters = 1e9).
 *   b.N          run1 calls runN(1); launch then loops
 *                  for n := 1; !failed && b.duration < d && n < 1e9; {
 *                    last := n; n = predictN(d, b.N, b.duration, last); runN(n) }
 *                and every runN calls runtime.GC, resets the timer and calls
 *                the whole benchmark function again. The result is the
 *                last round's N and duration.
 *   B.Loop       the first Loop call (inside run1's single call) sets
 *                loop.n = 1 and resets the timer; each time loop.i reaches
 *                loop.n, stopOrScaleBLoop stops if Elapsed() >= d, else sets
 *                loop.n = predictN(d, loop.n, Elapsed(), loop.n) and goes on
 *                while the target grew. Elapsed is cumulative, so the earlier
 *                iterations count toward the result; launch sees loop.n > 0
 *                and does not call the function again.
 * Each iteration is modelled as costing exactly the chosen time; integer
 * arithmetic uses BigInt to match int64. Wall time adds the setup before the
 * loop (after which a b.N benchmark calls ResetTimer) but not the time spent
 * in runtime.GC or ReadMemStats.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace)";
  var MAX = 1000000000n;

  function predictN(goal, prevIters, prevns, last) {
    if (prevns === 0n) prevns = 1n;
    var n = goal * prevIters / prevns, tag = "ext";
    n += n / 5n;
    if (n > 100n * last) { n = 100n * last; tag = "cap"; }
    if (n < last + 1n) { n = last + 1n; tag = "plus1"; }
    if (n > MAX) { n = MAX; tag = "max"; }
    return { n: n, tag: tag };
  }
  function viaN(c, d) {
    var rows = [{ n: 1n, t: c, tag: "first" }], dur = c, bN = 1n, n = 1n;
    while (dur < d && n < MAX) {
      var p = predictN(d, bN, dur, n);
      n = p.n; dur = n * c; bN = n;
      rows.push({ n: n, t: dur, tag: p.tag });
    }
    return rows;
  }
  function viaLoop(c, d) {
    var rows = [{ n: 1n, t: c, tag: "first" }], ln = 1n, t = c;
    while (t < d) {
      var p = predictN(d, ln, t, ln);
      if (!(ln < p.n)) break;
      ln = p.n; t = ln * c;
      rows.push({ n: ln, t: t, tag: p.tag });
    }
    return rows;
  }

  function fmtT(ns) {
    var x = Number(ns);
    function f(v, u) { return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1).replace(/\.0$/, "") : v.toFixed(2).replace(/\.?0+$/, "")) + " " + u; }
    if (x < 1e3) return f(x, "ns");
    if (x < 1e6) return f(x / 1e3, "µs");
    if (x < 1e9) return f(x / 1e6, "ms");
    return f(x / 1e9, "s");
  }

  V.register("bench-ramp", function (host) {
    var p = V.panel(host, { title: L("基准的迭代次数：b.N 与 B.Loop 如何逼近 -benchtime", "Benchmark iterations: how b.N and B.Loop ramp up to -benchtime") });
    var root = V.svg("svg", { viewBox: "0 0 720 300", role: "img",
      "aria-label": L("两种写法每一轮的迭代次数与计时", "Iteration count and timed duration of each round in both forms") }, p.stage);
    var g = V.svg("g", null, root);
    var cost = 63n, goal = 1000000000n, setup = 0n;
    var BX = 336, BW = 300, DEC = 10; // bar area: 1 ns .. 10 s on a log axis

    function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
    function txt(x, y, s, style, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: style || "font-size:12px", text: s }, g);
    }
    function bx(ns) { var v = Math.log10(Math.max(1, Number(ns))); return BX + Math.min(1, v / DEC) * BW; }
    function tagText(t) {
      return {
        first: L("首轮固定为 1", "first round: 1"),
        ext: L("外推，再加 20%", "extrapolated +20%"),
        cap: L("上限：上轮的 100 倍", "cap: 100× last"),
        plus1: L("下限：上轮加 1", "floor: last + 1"),
        max: L("上限：10 亿次", "cap: 1e9"),
      }[t];
    }

    function table(A) {
      txt(8, 16, L("每一轮的次数与计时", "Count and timed duration of each round"), "font-size:12.5px;font-weight:600");
      [0, 3, 6, 9].forEach(function (e) {
        txt(BX + e / DEC * BW, 16, ["1 ns", "1 µs", "1 ms", "1 s"][e / 3], "font-size:10.5px;fill:var(--viz-muted)", "middle");
      });
      var top = 24, rh = 18;
      [0, 3, 6, 9].forEach(function (e) {
        var x = BX + e / DEC * BW;
        V.svg("line", { x1: x, y1: top, x2: x, y2: top + A.length * rh, style: "stroke:var(--viz-line);stroke-width:1" }, g);
      });
      var gx = bx(goal);
      V.svg("line", { x1: gx, y1: top - 2, x2: gx, y2: top + 6 * rh + 4, style: "stroke:var(--viz-c2);stroke-width:1.5;stroke-dasharray:4 3" }, g);
      txt(gx + 4, top + 6 * rh + 12, "-benchtime", "font-size:10.5px;fill:var(--viz-c2);" + MONO);
      A.forEach(function (r, i) {
        var y = top + i * rh + rh / 2, last = i === A.length - 1;
        txt(8, y + 4, L("第 " + (i + 1) + " 轮", "round " + (i + 1)), "font-size:11.5px;fill:var(--viz-muted)");
        txt(176, y + 4, String(r.n), "font-size:12px;" + MONO + (last ? ";font-weight:600" : ""), "end");
        txt(188, y + 4, tagText(r.tag), "font-size:11px;fill:" + (r.tag === "cap" || r.tag === "max" ? "var(--viz-c3)" : "var(--viz-muted)"));
        V.svg("rect", { x: BX, y: y - 5.5, width: Math.max(1.5, bx(r.t) - BX), height: 11, rx: 2,
          style: "fill:var(--viz-" + (last ? "c1" : "c4") + ");fill-opacity:" + (last ? 0.85 : 0.55) }, g);
        txt(714, y + 4, fmtT(r.t), "font-size:11.5px;" + MONO + (last ? ";font-weight:600" : ""), "end");
      });
      return top + 6 * rh;
    }

    // wall-clock timelines on a linear axis
    var TX = 74, TW = 636;
    function timeline(y, name, segs, scale, sum) {
      txt(8, y + 12, name, "font-size:12px;font-weight:600;" + MONO);
      var x = TX;
      segs.forEach(function (sg) {
        var w = Number(sg.ns) * scale;
        if (w >= 0.4) {
          var fill = sg.setup ? "fill:var(--viz-c3);fill-opacity:.45" : sg.last ? "fill:var(--viz-c1);fill-opacity:.85"
            : "fill:var(--viz-c4);fill-opacity:" + (sg.k % 2 ? 0.4 : 0.7);
          V.svg("rect", { x: x, y: y, width: Math.max(0.8, w), height: 17, style: fill + ";stroke:var(--viz-fill);stroke-width:" + (w > 3 ? 0.8 : 0) }, g);
          if (!sg.setup && w > 16) txt(x + w / 2, y + 12.5, String(sg.k + 1), "font-size:10.5px;fill:" + (sg.last ? "var(--viz-fill)" : "var(--viz-ink)"), "middle");
        }
        x += w;
      });
      txt(TX, y + 31, sum, "font-size:11.5px");
    }

    function draw() {
      clear(g);
      var A = viaN(cost, goal), B = viaLoop(cost, goal);
      var lastA = A[A.length - 1], lastB = B[B.length - 1];
      var segA = [], segB = [], wallA = 0n, wallB = setup, prev = 0n;
      A.forEach(function (r, i) {
        if (setup) segA.push({ ns: setup, setup: true });
        segA.push({ ns: r.t, k: i, last: i === A.length - 1 });
        wallA += setup + r.t;
      });
      if (setup) segB.push({ ns: setup, setup: true });
      B.forEach(function (r, i) {
        segB.push({ ns: (r.n - prev) * cost, k: i, last: i === B.length - 1 });
        prev = r.n;
      });
      wallB += lastB.t;
      var y = table(A) + 20;
      txt(8, y, L("墙钟时间线（线性）", "Wall-clock timeline (linear)"), "font-size:12.5px;font-weight:600");
      var mx = wallA > wallB ? wallA : wallB, scale = TW / Number(mx);
      // linear ticks
      var step = Math.pow(10, Math.floor(Math.log10(Number(mx)))), n = Number(mx) / step;
      if (n < 2) step /= 5; else if (n < 5) step /= 2;
      for (var t = 0; t <= Number(mx) * 1.0001; t += step) {
        var tx = TX + t * scale;
        V.svg("line", { x1: tx, y1: y + 22, x2: tx, y2: y + 112, style: "stroke:var(--viz-line);stroke-width:1" }, g);
        txt(tx, y + 16, t === 0 ? "0" : fmtT(t), "font-size:10.5px;fill:var(--viz-muted)", t === 0 ? "start" : "middle");
      }
      var nsA = lastA.t / lastA.n, nsB = lastB.t / lastB.n;
      timeline(y + 26, "b.N", segA, scale,
        L("调用基准函数 " + A.length + " 次，每轮从头再跑；报告最后一轮：N = " + lastA.n + "，" + nsA + " ns/op；共约 " + fmtT(wallA),
          A.length + (A.length > 1 ? " calls, each round from scratch" : " call") + "; reports the last round: N = " + lastA.n + ", " + nsA + " ns/op; about " + fmtT(wallA)));
      timeline(y + 74, "B.Loop", segB, scale,
        L("调用 1 次，每轮在已跑的迭代上接着跑：N = " + lastB.n + "，" + nsB + " ns/op；共约 " + fmtT(wallB),
          "1 call, each round continues from the iterations already run: N = " + lastB.n + ", " + nsB + " ns/op; about " + fmtT(wallB)));
      // legend
      var ly = y + 134, lx = TX;
      [["fill:var(--viz-c4);fill-opacity:.7", L("各轮迭代（数字为轮次）", "iterations of each round (numbered)")],
       ["fill:var(--viz-c1);fill-opacity:.85", L("最后一轮", "last round")],
       ["fill:var(--viz-c3);fill-opacity:.45", L("循环前的准备", "setup before the loop")]].forEach(function (it) {
        V.svg("rect", { x: lx, y: ly - 10, width: 16, height: 12, rx: 2, style: it[0] }, g);
        txt(lx + 22, ly, it[1], "font-size:11px;fill:var(--viz-muted)");
        var w = 0; for (var i = 0; i < it[1].length; i++) w += it[1].charCodeAt(i) > 0x2e80 ? 11 : 5.8;
        lx += 22 + w + 22;
      });
      narrate(A, wallA, wallB);
    }

    function narrate(A, wallA, wallB) {
      var s = [];
      var nsA = A.map(function (r) { return String(r.n); }).join(" ");
      s.push(L("每次迭代 " + fmtT(cost) + "，-benchtime 为 " + fmtT(goal) + "，各轮次数依次为 [" + nsA + "]。" +
        "在每次迭代耗时恒定的模型里，两种写法逐轮的次数相同，区别在于 b.N 写法每轮从头再跑，B.Loop 在已跑过的迭代上接着跑。",
        "Each iteration takes " + fmtT(cost) + " and -benchtime is " + fmtT(goal) + "; the rounds run [" + nsA + "]. " +
        "With a constant cost per iteration both forms go through the same counts; b.N reruns each round from scratch, while B.Loop continues from the iterations already run."));
      var capped = A.filter(function (r) { return r.tag === "cap"; }).length;
      if (capped) s.push(L("其中 " + capped + " 轮由「100 倍」的上限决定：上一轮太短，线性外推给出的次数超过了上限。",
        " " + capped + (capped > 1 ? " rounds are" : " round is") + " set by the 100× cap: the previous round was so short that extrapolation went past it."));
      if (A.some(function (r) { return r.tag === "plus1"; })) s.push(L("一次迭代就占去目标时间的相当部分时，外推只多出零头，下限「上轮加 1」使次数仍然增长。",
        " When one iteration is a large part of the goal, extrapolation adds almost nothing, and the floor of last + 1 keeps the count growing."));
      if (A.some(function (r) { return r.tag === "max"; })) s.push(L("次数到达 10 亿次的上限后，即使计时仍不足也不再增加。",
        " Once the count reaches the 1e9 cap it grows no further, even if the time is still short of the goal."));
      if (A.length === 1) s.push(L("第一轮就达到了目标时间，测量到此为止。", " The first round already reaches the goal, so measurement stops there."));
      var pct = Number(wallB * 1000n / wallA) / 10;
      if (pct < 95) s.push(L("B.Loop 的墙钟时间是 b.N 写法的 " + pct.toFixed(0) + "%。", " B.Loop's wall time is " + pct.toFixed(0) + "% of the b.N form's."));
      else if (A.length > 1) s.push(L("增长很快时，此前各轮加起来也只是最后一轮的零头，两种写法的墙钟时间相差无几。",
        " With fast growth all earlier rounds together are a small fraction of the last one, so both forms take about the same wall time."));
      if (setup > 0n) s.push(L("准备工作在 b.N 写法中重复了 " + A.length + " 次（每次之后调用 ResetTimer，排除在计时之外），在 B.Loop 写法中只做一次。",
        " The setup runs " + A.length + (A.length > 1 ? " times" : " time") + " with b.N (each followed by ResetTimer, so it is not timed) and once with B.Loop."));
      s.push(L("每轮之前的 runtime.GC() 与计时器读取内存统计的时间未画入。", " The runtime.GC() before each round and the timer's memory-statistics reads are not drawn."));
      p.note.textContent = s.join("");
    }

    var lab = V.el("span", { class: "viz-readout", style: "min-width:6.5em;display:inline-block;" + MONO }, null);
    var sl = V.slider(p.bar, L("每次迭代", "Per iteration"), 0, 90, 18, function (v) {
      cost = BigInt(Math.max(1, Math.round(Math.pow(10, v / 10))));
      lab.textContent = fmtT(cost); draw();
    });
    sl.parentNode.appendChild(lab);
    lab.textContent = fmtT(cost);
    V.select(p.bar, "-benchtime", [
      { value: "100000000", label: "100ms" }, { value: "1000000000", label: L("1s（默认）", "1s (default)") }, { value: "5000000000", label: "5s" },
    ], "1000000000", function (v) { goal = BigInt(v); draw(); });
    V.select(p.bar, L("循环前的准备", "Setup before the loop"), [
      { value: "0", label: L("无", "none") }, { value: "10000000", label: "10 ms" }, { value: "200000000", label: "200 ms" },
    ], "0", function (v) { setup = BigInt(v); draw(); });
    draw();
  });
})();
