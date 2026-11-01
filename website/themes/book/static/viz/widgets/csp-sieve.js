/*
 * csp-sieve: the concurrent prime sieve as a growing pipeline (book §1.3).
 *
 * A generator goroutine sends 2, 3, 4, ... down a channel. Each number walks
 * through the filters built so far; filter p drops multiples of p. A number
 * that reaches main is prime, and main starts a new filter goroutine for it
 * at the end of the pipeline. So the pipeline's shape is decided at run time,
 * which is what first-class channels make possible.
 *
 * Each step sends one number. The default view shows the finished state for
 * 2..30; Step replays from the beginning.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MAXN = 30;

  // Precompute the whole run: for each n, which filter dropped it (or prime).
  function run() {
    var primes = [], steps = [];
    for (var n = 2; n <= MAXN; n++) {
      var by = -1;
      for (var i = 0; i < primes.length; i++) if (n % primes[i] === 0) { by = i; break; }
      steps.push({ n: n, by: by, passed: by < 0 ? primes.length : by, nf: primes.length });
      if (by < 0) primes.push(n);
    }
    return { primes: primes, steps: steps };
  }
  var R = run();

  V.register("csp-sieve", function (host) {
    var p = V.panel(host, { title: L("并发素数筛：每个素数一个过滤器 goroutine", "Concurrent prime sieve: one filter goroutine per prime") });
    var root = V.svg("svg", { viewBox: "0 0 720 278", role: "img",
      "aria-label": L("素数筛流水线", "Prime sieve pipeline") }, p.stage);
    var defs = V.svg("defs", null, root);
    var mk = V.svg("marker", { id: "cs-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5,
      markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
    V.svg("path", { d: "M0,0 L10,5 L0,10 z", style: "fill:var(--viz-muted)" }, mk);
    var g = V.svg("g", null, root);

    // k = numbers sent so far; full = overview of the finished run (no token)
    var k = R.steps.length, full = true, timer = null;
    var PY = 74, PH = 30, GW = 58, FW = 44, GAP = 14, MW = 50;

    function text(x, y, s, st) { return V.svg("text", { x: x, y: y, style: st || "font-size:12px", text: s }, g); }
    function link(x1, x2) {
      V.svg("path", { d: "M" + x1 + "," + (PY + PH / 2) + " L" + (x2 - 1) + "," + (PY + PH / 2),
        "marker-end": "url(#cs-arrow)", style: "fill:none;stroke:var(--viz-muted);stroke-width:1.2" }, g);
    }

    function draw() {
      while (g.firstChild) g.removeChild(g.firstChild);
      var cur = !full && k > 0 ? R.steps[k - 1] : null;
      var nf = 0, sends = 0, out = [];
      for (var i = 0; i < k; i++) {
        var s = R.steps[i];
        sends += 1 + s.passed;
        if (s.by < 0) { nf++; out.push(s.n); }
      }
      var filters = R.primes.slice(0, nf);
      // header: printed primes and counters
      text(8, 18, L("main 已打印：", "main printed: ") + (out.length ? out.join(" ") : L("（无）", "(none)")), "font-size:12px");
      text(712, 18, L("goroutine " + (nf + 2) + " 个，channel " + (nf + 1) + " 条，累计传递 " + sends + " 次",
        (nf + 2) + " goroutines, " + (nf + 1) + " channels, " + sends + " sends so far"),
        "font-size:12px;text-anchor:end;fill:var(--viz-muted)");
      // pipeline
      var x = 8, gx = x;
      V.svg("rect", { x: gx, y: PY, width: GW, height: PH, rx: 5, style: cur
        ? "fill:var(--viz-c1);fill-opacity:.14;stroke:var(--viz-c1);stroke-width:1.2"
        : "fill:var(--viz-fill);stroke:var(--viz-line);stroke-width:1.2" }, g);
      text(gx + GW / 2, PY + 19, L("生成器", "gen"), "font-size:12px;text-anchor:middle");
      x += GW;
      var fx = [];
      filters.forEach(function (pr, i) {
        link(x, x + GAP); x += GAP; fx.push(x);
        var c = "var(--viz-line)", op = 1, fill = "var(--viz-fill)";
        if (cur) {
          if (cur.by === i) { c = "var(--viz-c2)"; fill = c; op = 0.2; }
          else if (i < cur.passed) { c = "var(--viz-c1)"; fill = c; op = 0.14; }
          if (cur.by < 0 && i === nf - 1) { c = "var(--viz-c3)"; fill = c; op = 0.18; }
        }
        V.svg("rect", { x: x, y: PY, width: FW, height: PH, rx: 5,
          style: "fill:" + fill + ";fill-opacity:" + op + ";stroke:" + c + ";stroke-width:1.2" }, g);
        text(x + FW / 2, PY + 20, String(pr), "font-size:13px;font-weight:600;text-anchor:middle;font-family:var(--font-mono,monospace)");
        x += FW;
      });
      link(x, x + GAP); x += GAP;
      var mx = x, mc = cur && cur.by < 0 ? "var(--viz-c3)" : "var(--viz-line)";
      V.svg("rect", { x: mx, y: PY, width: MW, height: PH, rx: 5,
        style: "fill:" + (cur && cur.by < 0 ? mc : "var(--viz-fill)") + ";fill-opacity:" + (cur && cur.by < 0 ? 0.18 : 1) + ";stroke:" + mc + ";stroke-width:1.2" }, g);
      text(mx + MW / 2, PY + 19, "main", "font-size:12px;text-anchor:middle;font-family:var(--font-mono,monospace)");
      // current number: a token above where it stopped
      if (cur) {
        var tx = cur.by >= 0 ? fx[cur.by] + FW / 2 : mx + MW / 2;
        var tc = cur.by >= 0 ? "var(--viz-c2)" : "var(--viz-c3)";
        V.svg("circle", { cx: tx, cy: PY - 26, r: 12, style: "fill:var(--viz-fill);stroke:" + tc + ";stroke-width:1.6" }, g);
        text(tx, PY - 22, String(cur.n), "font-size:12px;font-weight:600;text-anchor:middle;font-family:var(--font-mono,monospace)");
        if (cur.by < 0 && nf) { // the new filter that main just started
          var nx = fx[nf - 1];
          text(nx + FW / 2, PY + PH + 14, L("新建", "new"), "font-size:11px;text-anchor:middle;fill:var(--viz-c3)");
        }
      }
      // numbers dropped by each filter, two per row
      var dropY = PY + PH + 30;
      if (nf) text(8, dropY + 9, L("被丢弃的数", "dropped"), "font-size:11px;fill:var(--viz-muted)");
      filters.forEach(function (pr, i) {
        var col = [];
        for (var j = 0; j < k; j++) if (R.steps[j].by === i) col.push(R.steps[j].n);
        col.forEach(function (n, j) {
          var last = cur && cur.n === n;
          text(fx[i] + (j % 2 ? FW - 2 : 2), dropY + 9 + Math.floor(j / 2) * 15, String(n),
            "font-size:11px;font-family:var(--font-mono,monospace);text-anchor:" + (j % 2 ? "end" : "start") +
            (last ? ";fill:var(--viz-c2);font-weight:700" : ";fill:var(--viz-muted)"));
        });
      });
      text(8, 254, L("每个方框是一个 goroutine，每条箭头是一条无缓冲 channel。",
        "Each box is a goroutine; each arrow is an unbuffered channel."), "font-size:11px;fill:var(--viz-muted)");
      text(8, 270, L("数从左往右走，被第一个能整除它的过滤器丢弃；走到 main 的就是素数。",
        "A number is dropped by the first filter that divides it; whatever reaches main is prime."), "font-size:11px;fill:var(--viz-muted)");
    }

    function narrate() {
      if (k === 0) { p.note.textContent = L("流水线上只有生成器和 main。点「下一步」送出第一个数。", "Only the generator and main. Press Step to send the first number."); return; }
      var s = R.steps[k - 1], ps = R.primes.slice(0, s.nf);
      if (full) {
        p.note.textContent = L("2 到 " + MAXN + " 都处理完：" + R.primes.length + " 个素数，就有 " + R.primes.length + " 个过滤器 goroutine。流水线的长度不是写在程序里的，是运行时随着找到的素数一节一节接上去的。点「下一步」从头重放。",
          "All of 2.." + MAXN + " done: " + R.primes.length + " primes, so " + R.primes.length + " filter goroutines. The pipeline's length is not written in the program; it grows at run time, one filter per prime found. Press Step to replay.");
        return;
      }
      if (s.by >= 0) {
        var passed = ps.slice(0, s.by);
        p.note.textContent = L(s.n + (passed.length ? " 通过过滤器 " + passed.join("、") + "，" : " ") + "被过滤器 " + ps[s.by] + " 丢弃（" + s.n + " = " + ps[s.by] + " × " + s.n / ps[s.by] + "）。",
          s.n + (passed.length ? " passes filter" + (passed.length > 1 ? "s " : " ") + passed.join(", ") + " and" : "") + " is dropped by filter " + ps[s.by] + " (" + s.n + " = " + ps[s.by] + " × " + s.n / ps[s.by] + ").");
      } else {
        p.note.textContent = L(s.n + (ps.length ? " 通过全部 " + ps.length + " 个过滤器（" + ps.join("、") + "）" : " 前面还没有过滤器") + "，到达 main，是素数。main 打印它，并启动 filter(" + s.n + ") 接在流水线末端。",
          s.n + (ps.length ? " passes all " + ps.length + " filter" + (ps.length > 1 ? "s" : "") + " (" + ps.join(", ") + ")" : " meets no filter yet") + " and reaches main, so it is prime. main prints it and starts filter(" + s.n + ") at the end of the pipeline.");
      }
    }

    function stop() { if (timer) { clearInterval(timer); timer = null; } playBtn.textContent = L("自动播放", "Play"); }
    function step() {
      if (full || k >= R.steps.length) { full = false; k = 0; }
      k++;
      draw(); narrate();
      return k < R.steps.length;
    }
    V.button(p.bar, L("下一步", "Step"), function () { stop(); step(); });
    var playBtn = V.button(p.bar, L("自动播放", "Play"), function () {
      if (timer) { stop(); return; }
      playBtn.textContent = L("暂停", "Pause");
      timer = setInterval(function () {
        if (!host.isConnected) { stop(); return; }
        if (!step()) stop();
      }, 800);
    });
    V.button(p.bar, L("重新开始", "Restart"), function () { stop(); k = 0; full = false; draw(); narrate(); });
    V.button(p.bar, L("显示全部", "Show all"), function () { stop(); k = R.steps.length; full = true; draw(); narrate(); });

    draw(); narrate();
  });
})();
