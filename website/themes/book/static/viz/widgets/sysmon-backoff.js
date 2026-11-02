/*
 * sysmon-backoff: how sysmon's adaptive sleep sets the time a goroutine that
 * never yields actually runs before it is preempted (book §9.8.3, §9.4.2).
 *
 * From src/runtime/proc.go in Go 1.26:
 *   sysmon   idle == 0: delay = 20 µs; idle > 50: delay *= 2; capped at
 *            10 ms; usleep(delay); then retake(now); idle = 0 if retake
 *            returned nonzero (it counts only Ps taken from system calls),
 *            else idle++.
 *   retake   for a running P: if pp.schedtick differs from the value sysmon
 *            recorded, record it and schedwhen = now; else if
 *            schedwhen + forcePreemptNS (10 ms) <= now, preemptone(pp).
 *   execute  starts a new time slice (schedtick++) unless inheritTime.
 * So a slice must be seen by two rounds at least 10 ms apart. The figure
 * assumes: the P is always busy (short goroutines before G starts, so sysmon
 * never enters deep sleep); G is the only runnable goroutine afterwards, so
 * after each preemption it starts a new slice at once; sleeps take exactly
 * their nominal time and a round's work takes none. Retakes from system
 * calls are scripted by the scenario rather than simulated.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace);font-variant-ligatures:none";
  var END = 60000, FORCE = 10000; // µs

  function simulate(start, scen) {
    var rounds = [], t = 0, idle = 0, delay = 0, nextRetake = scen === "once" ? 30000 : scen === "often" ? 5000 : Infinity;
    var tick = 0, seenTick = -1, schedwhen = 0, sliceStart = start, slices = [], cur = null;
    // schedtick: before start, short goroutines change it every round
    while (t < END) {
      if (idle === 0) delay = 20; else if (idle > 50) delay *= 2;
      if (delay > 10000) delay = 10000;
      t += delay;
      if (t > END) break;
      var r = { t: t, delay: delay, idle: idle };
      var running = t >= start;
      var pTick = running ? tick : -2 - rounds.length; // a fresh tick each round before G starts
      if (running && cur == null) { cur = { a: sliceStart, seen: null, end: null }; }
      if (pTick !== seenTick) {
        seenTick = pTick; schedwhen = t;
        if (running && cur.seen == null) { cur.seen = t; r.seen = true; }
      } else if (schedwhen + FORCE <= t) {
        r.preempt = true;
        cur.end = t; slices.push(cur);
        tick++; cur = { a: t, seen: null, end: null }; // G starts a new slice right away
      }
      var n = 0;
      if (t >= nextRetake) { n = 1; r.retake = true; nextRetake = scen === "often" ? nextRetake + 5000 : Infinity; while (nextRetake <= t) nextRetake += 5000; }
      idle = n ? 0 : idle + 1;
      rounds.push(r);
    }
    if (cur) { cur.end = null; slices.push(cur); }
    return { rounds: rounds, slices: slices };
  }

  function fmt(us) { return (Math.round(us / 10) / 100).toFixed(2) + " ms"; }

  V.register("sysmon-backoff", function (host) {
    var p = V.panel(host, { title: L("从不让出的 goroutine 能运行多久：sysmon 的退避与两次采样", "How long a goroutine that never yields keeps running: sysmon's backoff and two samples") });
    var root = V.svg("svg", { viewBox: "0 0 720 274", role: "img",
      "aria-label": L("sysmon 每一轮醒来的时刻、休眠时长，以及 P 上时间片被抢占的时刻", "When sysmon wakes, how long it sleeps, and when the time slices on a P are preempted") }, p.stage);
    var g = V.svg("g", null, root);

    var start = 3000, scen = "none", sim;
    var X0 = 132, X1 = 708;
    function x(t) { return X0 + (X1 - X0) * t / END; }
    function text(x1, y, s, st, anchor) {
      return V.svg("text", { x: x1, y: y, "text-anchor": anchor || "start", style: st || "font-size:12px", text: s }, g);
    }
    function tw(s) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 11 : 6.2; return w; }

    function draw() {
      while (g.firstChild) g.removeChild(g.firstChild);
      // legend
      var items = [["var(--viz-c1)", L("G 的时间片", "G's time slice"), "rect"], ["var(--viz-c4)", L("记下新的 schedtick", "new schedtick recorded"), "dot"],
        ["var(--viz-c2)", L("请求抢占", "preemption requested"), "tri"], ["var(--viz-c3)", L("从系统调用取回 P", "P retaken from a syscall"), "dia"]];
      var lx = 712;
      for (var li = items.length - 1; li >= 0; li--) {
        var it = items[li];
        if (it[0] === "var(--viz-c3)" && scen === "none") continue;
        lx -= tw(it[1]) + 18;
        var cx = lx + 6, cy = 12;
        if (it[2] === "rect") V.svg("rect", { x: lx, y: 6, width: 12, height: 12, rx: 2, style: "fill:" + it[0] + ";fill-opacity:.25;stroke:" + it[0] }, g);
        else if (it[2] === "dot") V.svg("circle", { cx: cx, cy: cy, r: 4, style: "fill:" + it[0] }, g);
        else if (it[2] === "tri") V.svg("path", { d: "M" + (cx - 5) + "," + (cy - 4) + " L" + (cx + 5) + "," + (cy - 4) + " L" + cx + "," + (cy + 5) + " z", style: "fill:" + it[0] }, g);
        else V.svg("path", { d: "M" + cx + "," + (cy - 5) + " L" + (cx + 5) + "," + cy + " L" + cx + "," + (cy + 5) + " L" + (cx - 5) + "," + cy + " z", style: "fill:" + it[0] }, g);
        text(lx + 16, 16, it[1], "font-size:11px;fill:var(--viz-muted)");
        lx -= 10;
      }
      // sysmon wake-ups as one path
      var SY = 34, SH = 16, d = "";
      sim.rounds.forEach(function (r) { var xx = x(r.t).toFixed(2); d += "M" + xx + "," + SY + "v" + SH; });
      text(8, SY + 12, L("sysmon 醒来", "sysmon wakes"), "font-size:11px;font-weight:600");
      V.svg("path", { d: d, style: "stroke:var(--viz-ink);stroke-width:0.9;stroke-opacity:.55" }, g);
      sim.rounds.forEach(function (r) {
        if (!r.retake) return;
        var cx = x(r.t), cy = SY - 4;
        V.svg("path", { d: "M" + cx + "," + (cy - 5) + " L" + (cx + 5) + "," + cy + " L" + cx + "," + (cy + 5) + " L" + (cx - 5) + "," + cy + " z", style: "fill:var(--viz-c3)" }, g);
      });
      // sleep length, log scale from 20 µs to 10 ms
      var DY = 62, DH = 44;
      function ly(us) { return DY + DH - DH * Math.log(us / 20) / Math.log(10000 / 20); }
      text(8, DY + 12, L("休眠时长", "sleep length"), "font-size:11px;font-weight:600");
      [[20, "20 µs"], [1000, "1 ms"], [10000, "10 ms"]].forEach(function (q) {
        V.svg("line", { x1: X0, y1: ly(q[0]), x2: X1, y2: ly(q[0]), style: "stroke:var(--viz-line);stroke-dasharray:2 3" }, g);
        text(X0 - 4, ly(q[0]) + 3.5, q[1], "font-size:9.5px;fill:var(--viz-muted)", "end");
      });
      var sd = "", prevT = 0;
      sim.rounds.forEach(function (r, i) {
        var y = ly(r.delay).toFixed(2);
        sd += (i ? "L" : "M") + x(prevT).toFixed(2) + "," + y + "L" + x(r.t).toFixed(2) + "," + y;
        prevT = r.t;
      });
      V.svg("path", { d: sd, style: "fill:none;stroke:var(--viz-c4);stroke-width:1.6" }, g);
      // the P
      var PY = 124, PH = 22;
      text(8, PY + 15, "P", "font-size:12px;font-weight:600");
      V.svg("rect", { x: x(0), y: PY + 6, width: Math.max(0, x(start) - x(0)), height: PH - 12, rx: 2,
        style: "fill:var(--viz-muted);fill-opacity:.18;stroke:none" }, g);
      if (x(start) - x(0) > 70) text((x(0) + x(start)) / 2, PY + PH + 13, L("其他短时间片", "other short slices"), "font-size:10px;fill:var(--viz-muted)", "middle");
      sim.slices.forEach(function (s, i) {
        var b = s.end == null ? END : s.end;
        V.svg("rect", { x: x(s.a) + 0.5, y: PY, width: Math.max(1, x(b) - x(s.a) - 1), height: PH, rx: 3,
          style: "fill:var(--viz-c1);fill-opacity:" + (i % 2 ? 0.14 : 0.26) + ";stroke:var(--viz-c1);stroke-width:1" }, g);
        if (s.end != null && x(b) - x(s.a) > 46) text((x(s.a) + x(b)) / 2, PY + PH + 13, fmt(b - s.a), "font-size:11px;" + MONO, "middle");
        if (s.seen != null) V.svg("circle", { cx: x(s.seen), cy: PY + PH / 2, r: 3.5, style: "fill:var(--viz-c4);stroke:var(--viz-fill);stroke-width:1" }, g);
        if (s.end != null) {
          var cx = x(s.end), cy = PY - 6;
          V.svg("path", { d: "M" + (cx - 5) + "," + (cy - 5) + " L" + (cx + 5) + "," + (cy - 5) + " L" + cx + "," + (cy + 4) + " z", style: "fill:var(--viz-c2)" }, g);
        }
      });
      // G starts
      V.svg("line", { x1: x(start), y1: PY - 2, x2: x(start), y2: PY + PH + 2, style: "stroke:var(--viz-ink);stroke-width:1.4" }, g);
      // axis
      var ay = 174;
      V.svg("line", { x1: X0, y1: ay, x2: X1, y2: ay, style: "stroke:var(--viz-line)" }, g);
      for (var t = 0; t <= END; t += 10000) {
        V.svg("line", { x1: x(t), y1: ay, x2: x(t), y2: ay + 4, style: "stroke:var(--viz-line)" }, g);
        text(x(t), ay + 16, (t / 1000) + " ms", "font-size:10px;fill:var(--viz-muted)", "middle");
      }
      // summary lines
      var s0 = sim.slices[0];
      var y0 = 212;
      if (s0) {
        text(8, y0, L("G 从 " + fmt(start) + " 开始运行；sysmon 在 " + fmt(s0.seen) + " 第一次看到它的 schedtick，", "G starts at " + fmt(start) + "; sysmon first sees its schedtick at " + fmt(s0.seen) + ",") , "font-size:12px");
        text(8, y0 + 18, s0.end != null
          ? L("在 " + fmt(s0.end) + " 请求抢占：第一个时间片长 " + fmt(s0.end - s0.a) + "。", "and requests preemption at " + fmt(s0.end) + ": the first slice lasts " + fmt(s0.end - s0.a) + ".")
          : L("到图的末尾仍未满 10 ms。", "and 10 ms have not passed by the end of the figure."), "font-size:12px");
        var later = sim.slices.slice(1).filter(function (s) { return s.end != null; }).map(function (s) { return fmt(s.end - s.a); });
        if (later.length) text(8, y0 + 36, L("此后各片：", "Later slices: ") + later.join(L("、", ", ")) + L("。", "."), "font-size:12px");
      }
      text(8, 268, L("按名义休眠时长计算，未计入操作系统的睡眠误差与每一轮的工作时间。", "Nominal sleep lengths; the OS's sleep slack and each round's own work are ignored."),
        "font-size:10.5px;fill:var(--viz-muted)");
    }

    function explain() {
      var s0 = sim.slices[0], later = sim.slices.slice(1).filter(function (s) { return s.end != null; });
      var msg = "";
      if (scen === "none")
        msg = L("没有 P 从系统调用中被取回，sysmon 先以 20 µs 的间隔醒来 51 轮，再翻倍 8 轮，约 11 ms 后稳定在每 10 ms 一轮。",
          "No P is ever retaken from a system call, so sysmon wakes every 20 µs for 51 rounds, doubles for 8 rounds, and after about 11 ms settles at one round every 10 ms. ");
      else if (scen === "once")
        msg = L("30 ms 之后的那一轮取回了一个 P，idle 归零，sysmon 重新从 20 µs 开始退避。",
          "The first round after 30 ms retakes a P, so idle drops to 0 and sysmon starts backing off from 20 µs again. ");
      else
        msg = L("每隔 5 ms 就有一轮取回 P，idle 一再归零，sysmon 的间隔始终不超过几毫秒。",
          "A round retakes a P every 5 ms, so idle keeps dropping to 0 and sysmon's interval never grows past a few milliseconds. ");
      if (s0 && s0.end != null) {
        msg += L("时间片要在相隔至少 10 ms 的两轮中都被看到，才会被判定超时，所以 G 的第一个时间片长 " + fmt(s0.end - s0.a) + "。",
          "A slice is judged too long only after two rounds at least 10 ms apart have seen it, so G's first slice lasts " + fmt(s0.end - s0.a) + ". ");
        if (scen === "none" && later.length)
          msg += L("之后的时间片都是 20 ms：新的时间片恰好从抢占的那一轮开始，要到下一轮才被记下。拖动滑块改变 G 开始的时刻，第一个时间片在 10 ms 与 20 ms 之间变化。",
            "Every later slice lasts 20 ms: a new slice begins at the very round that preempted the old one and is recorded only one round later. Drag the slider to move G's start; the first slice varies between 10 ms and 20 ms.");
        else if (scen === "often" && later.length)
          msg += L("此后各片也都只略长于 10 ms。", "Later slices also last just over 10 ms.");
      }
      p.note.textContent = msg;
    }

    function update() { sim = simulate(start, scen); draw(); explain(); }

    var sl = V.slider(p.bar, L("G 开始运行于", "G starts at"), 0, 300, start / 100, function (v) { start = v * 100; out.textContent = fmt(start); update(); });
    sl.setAttribute("aria-label", L("G 开始运行的时刻", "When G starts running"));
    var out = V.el("span", { style: "font-size:12px;color:var(--viz-ink);min-width:4.5em;" + MONO, "aria-live": "off", text: fmt(start) }, p.bar);
    V.select(p.bar, L("系统调用", "System calls"), [
      { value: "none", label: L("没有 P 被取回", "no P retaken") },
      { value: "once", label: L("30 ms 时取回一个 P", "one P retaken at 30 ms") },
      { value: "often", label: L("每 5 ms 取回一个 P", "a P retaken every 5 ms") },
    ], "none", function (v) { scen = v; update(); });

    update();
  });
})();
