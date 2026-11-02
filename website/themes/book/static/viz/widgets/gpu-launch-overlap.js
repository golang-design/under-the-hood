/*
 * gpu-launch-overlap: where launch overhead goes when a GPU program
 * synchronizes after every kernel, once per timestep, or launches a captured
 * CUDA Graph (book §18.1.3).
 *
 * All timings are Alan Gray's measurements in "Getting Started with CUDA
 * Graphs" (NVIDIA Technical Blog, 2019; Tesla V100, CUDA 10.1), which the
 * chapter cites: a 2.9 µs kernel launched 20 times per timestep averages
 *   9.6 µs per kernel when the stream is synchronized after every launch,
 *   3.8 µs when it is synchronized once at the end of the timestep,
 *   3.4 µs when the 20 kernels are captured into a graph and launched with one
 *          cudaGraphLaunch (graph creation and instantiation: about 400 µs,
 *          once, which the figure does not draw).
 * The GPU lane is drawn to scale from these averages: each kernel takes
 * 2.9 µs and the rest of its average is idle time before it. The CPU lane
 * only shows how many CUDA API calls are made and in what order (a launch is
 * a tick; a cudaStreamSynchronize is a bar that lasts until the GPU is done);
 * the time a launch call itself takes is not drawn, because the source does
 * not give it. Call counts per timestep follow Gray's code: 20 launches + 20
 * synchronizations, 20 + 1, and 1 graph launch + 1 synchronization.
 *
 * The 16 ns per cgo crossing in the closing note is the chapter's own
 * measurement (§15.6.6, Apple M5 Pro, Go 1.26.10), quoted only as a
 * magnitude, as §18.1.2 does.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;

  var KERNEL = 2.9, N = 20, TMAX = 200; // µs
  var MODES = [
    { id: "each", per: 9.6, name: L("逐条同步", "Sync each"), calls: 40 },
    { id: "once", per: 3.8, name: L("末尾同步一次", "Sync once"), calls: 21 },
    { id: "graph", per: 3.4, name: "CUDA Graph", calls: 2 },
  ];
  function fmt(x) { return (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, ""); }

  V.register("gpu-launch-overlap", function (host) {
    var p = V.panel(host, { title: L("逐条同步、末尾同步与 CUDA Graph：一个时间步中的 20 个 kernel",
      "Sync each, sync once, or a CUDA Graph: one timestep of 20 kernels") });
    var W = 720, H = 252;
    var root = V.svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": L("三种提交方式下 CPU 与 GPU 的时间线", "CPU and GPU timelines for three ways of submitting work") }, p.stage);
    var g = V.svg("g", null, root);

    var X0 = 186, X1 = 708, S = (X1 - X0) / TMAX;
    function x(t) { return X0 + t * S; }
    function tw(s, px) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? px : px * 0.56; return w; }
    function rect(x1, y, w, h, st) { return V.svg("rect", { x: x1, y: y, width: Math.max(0, w), height: h, style: st }, g); }
    function text(x1, y, s, st) { return V.svg("text", { x: x1, y: y, style: st || "font-size:12px", text: s }, g); }

    var t = TMAX, timer = null;

    function draw() {
      while (g.firstChild) g.removeChild(g.firstChild);
      // Legend, right-aligned.
      var items = [["tick", L("API 调用", "API call")], ["sync", L("等待同步", "waiting in sync")],
        ["kern", L("kernel 执行", "kernel running")], ["idle", L("GPU 空闲", "GPU idle")]];
      var lx = W - 8;
      for (var i = items.length - 1; i >= 0; i--) {
        lx -= tw(items[i][1], 11);
        text(lx, 15, items[i][1], "font-size:11px;fill:var(--viz-muted)");
        lx -= 16;
        var k = items[i][0];
        if (k === "tick") V.svg("path", { d: "M" + (lx + 6) + ",5 l4,0 l-2,6 z M" + (lx + 8) + ",11 l0,6",
          style: "fill:var(--viz-ink);stroke:var(--viz-ink);stroke-width:1.2" }, g);
        else if (k === "sync") rect(lx, 8, 12, 8, "fill:var(--viz-c4);fill-opacity:.35;stroke:var(--viz-c4)");
        else if (k === "kern") rect(lx, 6, 12, 12, "fill:var(--viz-c1);fill-opacity:.85");
        else rect(lx, 6, 12, 12, "fill:var(--viz-c2);fill-opacity:.3");
        lx -= 14;
      }

      MODES.forEach(function (m, mi) {
        var y0 = 32 + mi * 62, cy = y0 + 2, gy = y0 + 22, total = N * m.per, gap = m.per - KERNEL;
        // Left column: name and the mode's measured numbers.
        text(8, y0 + 12, m.name, "font-size:12px;font-weight:600");
        text(8, y0 + 28, L(fmt(m.per) + " µs/kernel，共 " + fmt(total) + " µs", fmt(m.per) + " µs/kernel, " + fmt(total) + " µs total"),
          "font-size:11px;fill:var(--viz-muted)");
        text(8, y0 + 43, L("API 调用 " + m.calls + " 次", m.calls + " API calls"), "font-size:11px;fill:var(--viz-muted)");
        text(X0 - 6, cy + 12, "CPU", "font-size:10px;fill:var(--viz-muted);text-anchor:end");
        text(X0 - 6, gy + 13, "GPU", "font-size:10px;fill:var(--viz-muted);text-anchor:end");
        // GPU lane baseline.
        V.svg("line", { x1: X0, y1: gy + 18, x2: x(TMAX), y2: gy + 18, style: "stroke:var(--viz-line)" }, g);
        // GPU: idle gap, then the kernel, for each of the 20 kernels.
        for (var k = 0; k < N; k++) {
          var a = k * m.per, s = a + gap, e = (k + 1) * m.per;
          if (t > a) rect(x(a), gy, (Math.min(t, s) - a) * S, 18, "fill:var(--viz-c2);fill-opacity:.3");
          if (t > s) rect(x(s), gy, (Math.min(t, e) - s) * S, 18, "fill:var(--viz-c1);fill-opacity:.85");
        }
        // CPU: launch ticks and synchronization bars.
        function tick(at) {
          if (t < at) return;
          V.svg("path", { d: "M" + (x(at) - 2) + "," + cy + " l4,0 l-2,6 z M" + x(at) + "," + (cy + 6) + " l0,10",
            style: "fill:var(--viz-ink);stroke:var(--viz-ink);stroke-width:1.2" }, g);
        }
        function sync(from, to) {
          if (t <= from) return;
          rect(x(from), cy + 6, (Math.min(t, to) - from) * S, 10, "fill:var(--viz-c4);fill-opacity:.35;stroke:var(--viz-c4);stroke-width:.8");
        }
        if (m.id === "each") for (k = 0; k < N; k++) { sync(k * m.per, (k + 1) * m.per); tick(k * m.per); }
        else if (m.id === "once") { sync((N - 1) * m.per, total); for (k = 0; k < N; k++) tick(k * m.per); }
        else { sync(0, total); tick(0); }
        // Finish marker.
        if (t >= total) {
          V.svg("line", { x1: x(total), y1: cy - 2, x2: x(total), y2: gy + 22,
            style: "stroke:var(--viz-c3);stroke-width:1.5" }, g);
          var lbl = L("完成", "done");
          if (x(total) + 4 + tw(lbl, 11) < W) text(x(total) + 4, cy + 12, lbl, "font-size:11px;fill:var(--viz-c3)");
        }
      });

      // Time axis.
      var ay = 222;
      V.svg("line", { x1: X0, y1: ay, x2: x(TMAX), y2: ay, style: "stroke:var(--viz-line)" }, g);
      for (var tt = 0; tt <= TMAX; tt += 20) {
        V.svg("line", { x1: x(tt), y1: ay, x2: x(tt), y2: ay + 4, style: "stroke:var(--viz-line)" }, g);
        text(x(tt), ay + 16, String(tt), "font-size:10px;text-anchor:middle;fill:var(--viz-muted)");
      }
      text(8, ay + 16, L("时间（µs）", "time (µs)"), "font-size:11px;fill:var(--viz-muted)");
      if (t < TMAX) V.svg("line", { x1: x(t), y1: 26, x2: x(t), y2: ay,
        style: "stroke:var(--viz-ink);stroke-width:1;stroke-dasharray:4 3;stroke-opacity:.6" }, g);
    }

    function narrate() {
      if (t >= TMAX) {
        p.note.textContent = L(
          "同样是 20 个 2.9 µs 的 kernel。逐条同步时，每次提交与等待的开销都完整地暴露出来，GPU 约七成时间空闲，共用 192 µs；" +
          "只在末尾同步一次，提交与计算相互重叠，共用 76 µs；改用 CUDA Graph，CPU 每个时间步只发起 2 次调用，共用 68 µs。" +
          "图的创建与实例化约需 400 µs，只在第一个时间步发生一次，图中未画出。若这些调用经 cgo 发出，按 15.6.6 的测量每次跨界约 16 ns，" +
          "40 次合计不到 1 µs：开销主要来自 kernel 的启动，而不是 cgo。点「自动播放」从头观察。",
          "The same 20 kernels of 2.9 µs each. Synchronizing after every launch exposes every submission and wait: the GPU is " +
          "idle about 70% of the time, and the timestep takes 192 µs. Synchronizing once at the end lets submission overlap " +
          "with execution: 76 µs. A CUDA Graph needs only 2 calls from the CPU per timestep: 68 µs. Creating and instantiating " +
          "the graph takes about 400 µs, once, in the first timestep; it is not drawn. If these calls went through cgo, each " +
          "crossing would cost about 16 ns (15.6.6), under 1 µs for all 40: the overhead comes from launching kernels, not " +
          "from cgo. Press Play to watch from the start.");
        return;
      }
      var parts = MODES.map(function (m) {
        var done = Math.min(N, Math.floor(t / m.per + 1e-9));
        var sp = /[A-Za-z]$/.test(m.name) ? " " : ""; // a space between Latin and CJK
        return done >= N ? L(m.name + sp + "已在 " + fmt(N * m.per) + " µs 完成", m.name + " finished at " + fmt(N * m.per) + " µs")
          : L(m.name + sp + "完成 " + done + " 个", m.name + " " + done + " done");
      });
      p.note.textContent = L("t = " + fmt(t) + " µs：" + parts.join("，") + "。", "t = " + fmt(t) + " µs: " + parts.join("; ") + ".");
    }

    function render() { draw(); narrate(); }
    function stop() { if (timer) { cancelAnimationFrame(timer); timer = null; } playBtn.textContent = L("自动播放", "Play"); }
    var last = 0;
    function frame(now) {
      if (!host.isConnected) { stop(); return; }
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
      t = Math.min(TMAX, t + dt * 25); // 25 µs of GPU time per second
      render();
      if (t >= TMAX) { stop(); return; }
      timer = requestAnimationFrame(frame);
    }

    var playBtn = V.button(p.bar, L("自动播放", "Play"), function () {
      if (timer) { stop(); return; }
      if (t >= TMAX) t = 0;
      playBtn.textContent = L("暂停", "Pause");
      last = 0; timer = requestAnimationFrame(frame);
    });
    V.button(p.bar, L("前进 10 µs", "Step 10 µs"), function () {
      stop();
      t = t >= TMAX ? 10 : Math.min(TMAX, Math.floor(t / 10 + 1e-9) * 10 + 10);
      render();
    });
    V.button(p.bar, L("显示全部", "Show all"), function () { stop(); t = TMAX; render(); });

    render();
  });
})();
