/*
 * stack-resize: how a goroutine stack grows on calls and shrinks at GC
 * (book §14.3 to §14.5).
 *
 * Go 1.26 on linux/amd64 without the race detector (stackSystem = 0,
 * StackGuardMultiplier = 1):
 *   - runtime/stack.go: fixedStack = 2048, stackNosplit = 800,
 *     stackGuard = 800 + 0 + abi.StackSmall (128) = 928.
 *   - a new goroutine starts with a 2 KiB stack; newproc1 (proc.go) leaves
 *     32 bytes at the top and gostartcall pushes the return address into
 *     goexit, so the entry function starts at hi - 40. Each further call
 *     pushes an 8-byte return address.
 *   - prologue, cmd/internal/obj/x86/obj6.go stacksplit: a frame of at most
 *     StackSmall bytes calls morestack if SP <= stackguard0; a larger frame
 *     if SP - (framesize - StackSmall) <= stackguard0 (stackguard0 = lo +
 *     stackGuard). SP is the value at function entry.
 *   - newstack: newsize = 2*oldsize; needed = funcMaxSPDelta(f) + stackGuard
 *     (funcMaxSPDelta is taken to be the frame size); used = hi - sched.sp;
 *     double again while newsize - used < needed. copystack copies the used
 *     part to the top of the new stack.
 *   - shrinkstack, called from scanstack once per GC: stop if oldsize/2 <
 *     fixedStack; stop if hi - sched.sp + stackNosplit >= oldsize/4; otherwise
 *     copystack(gp, oldsize/2). The goroutine is taken to be stopped at the
 *     bottom of its innermost frame (the small gopark frames are ignored).
 * The figure stops at 1 MiB; the real limit is maxstacksize (1 GB on 64-bit).
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace)";
  var TOP = 32, RA = 8, SMALL = 128, NOSPLIT = 800, GUARD = 928, MIN = 2048, CAP = 1 << 20;
  var FRAMES = [64, 512, 2048, 8192, 32768];

  function kib(b) { return b >= 1024 && b % 1024 === 0 ? b / 1024 + " KiB" : b + L(" 字节", " B"); }
  function B(b) { return b + L(" 字节", " bytes"); }

  V.register("stack-resize", function (host) {
    var p = V.panel(host, { title: L("goroutine 栈的增长与收缩", "Growing and shrinking a goroutine stack") });
    var root = V.svg("svg", { viewBox: "0 0 720 290", role: "img",
      "aria-label": L("一个 goroutine 栈的帧、警戒线与历次大小", "Frames, guard and size history of one goroutine stack") }, p.stage);
    var g = V.svg("g", null, root);
    var st, F = 512;

    function usedNow() { return st.frames.reduce(function (a, f) { return a + f + RA; }, TOP); }
    function reset() {
      st = { size: MIN, frames: [64], hist: [], last: null, gen: 1 };
      st.hist.push({ size: MIN, used: usedNow(), kind: "start" });
    }
    function record(kind) { st.hist.push({ size: st.size, used: usedNow(), kind: kind }); if (st.hist.length > 40) st.hist.shift(); }

    function call() {
      var entry = usedNow() + RA, d = st.size - entry, fail = F <= SMALL ? d <= GUARD : d - F <= NOSPLIT;
      var e = { kind: "call", F: F, n: st.frames.length + 1, d: d };
      if (fail) {
        var ns = st.size * 2, loops = 0;
        while (ns - entry < F + GUARD) { ns *= 2; loops++; }
        if (ns > CAP) { st.last = { kind: "cap", F: F }; return; }
        e.kind = "grow"; e.old = st.size; e.size = ns; e.copied = entry; e.loops = loops;
        st.size = ns; st.gen++;
      }
      st.frames.push(F);
      st.last = e; record(e.kind);
    }
    function ret(all) {
      if (st.frames.length <= 1) return;
      var n = 0, b = 0;
      do { b += st.frames.pop() + RA; n++; } while (all && st.frames.length > 1);
      st.last = { kind: "ret", n: n, b: b }; record("ret");
    }
    function gc() {
      var old = st.size, used = usedNow() + NOSPLIT, e = { kind: "gc", old: old, used: used, sp: usedNow() };
      if (old / 2 < MIN) e.why = "min";
      else if (used >= old / 4) e.why = "busy";
      else { e.why = "shrink"; st.size = old / 2; st.gen++; }
      st.last = e; record(e.why === "shrink" ? "shrink" : "gc");
    }

    function clear() { while (g.firstChild) g.removeChild(g.firstChild); }
    function text(x, y, s, sty, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: sty || "font-size:12px", text: s }, g);
    }
    function line(x1, y1, x2, y2, sty) { return V.svg("line", { x1: x1, y1: y1, x2: x2, y2: y2, style: sty }, g); }

    // ---- the stack column: hi at the top, lo at the bottom ----------------
    var SX = 70, SW = 92, SY0 = 34, SY1 = 254;
    function drawStack() {
      var size = st.size, k = (SY1 - SY0) / size;
      function Y(dist) { return SY0 + dist * k; } // distance below hi
      text(SX + SW / 2, 18, L("栈 ", "stack ") + kib(size), "font-size:12px;font-weight:600", "middle");
      V.svg("rect", { x: SX, y: SY0, width: SW, height: SY1 - SY0, style: "fill:var(--viz-fill);stroke:var(--viz-ink);stroke-width:1.2" }, g);
      // guard zone
      V.svg("rect", { x: SX, y: Y(size - GUARD), width: SW, height: GUARD * k, style: "fill:var(--viz-c2);fill-opacity:.14" }, g);
      // top reserve and frames
      var y = SY0 + TOP * k;
      V.svg("rect", { x: SX, y: SY0, width: SW, height: TOP * k, style: "fill:var(--viz-muted);fill-opacity:.25" }, g);
      st.frames.forEach(function (f, i) {
        var h = (f + RA) * k, inner = i === st.frames.length - 1;
        V.svg("rect", { x: SX + 1, y: y, width: SW - 2, height: Math.max(h, 0.6),
          style: "fill:var(--viz-c1);fill-opacity:" + (inner ? 0.38 : i % 2 ? 0.16 : 0.24) + ";stroke:var(--viz-c1);stroke-opacity:" + (h > 3 ? 0.6 : 0) }, g);
        if (h >= 13) text(SX + SW / 2, y + h / 2 + 4, "f" + (i + 1) + (h >= 26 || f >= 1024 ? " · " + kib(f) : ""), "font-size:10.5px", "middle");
        y += h;
      });
      // SP arrow
      line(SX - 22, y, SX - 2, y, "stroke:var(--viz-ink);stroke-width:1.5");
      text(SX - 26, y + 4, "SP", "font-size:11px;font-weight:600;" + MONO, "end");
      // stackguard0 line
      var gy = Y(size - GUARD);
      line(SX - 6, gy, SX + SW + 6, gy, "stroke:var(--viz-c2);stroke-width:1.5");
      text(SX + SW + 10, gy + 4, L("警戒线", "stackguard0"), "font-size:10.5px;fill:var(--viz-c2)");
      text(SX + SW + 10, gy + 17, "lo + 928", "font-size:10px;fill:var(--viz-c2);" + MONO);
      // shrink threshold: shrink at GC if hi - SP + 800 < size/4
      if (size / 2 >= MIN) {
        var ty = Y(size / 4 - NOSPLIT);
        line(SX - 6, ty, SX + SW + 6, ty, "stroke:var(--viz-c3);stroke-width:1.5;stroke-dasharray:5 3");
        text(SX + SW + 10, ty + 4, L("收缩线", "shrink line"), "font-size:10.5px;fill:var(--viz-c3)");
        text(SX + SW + 10, ty + 17, L("SP 在此线之上时，", "if SP is above it,"), "font-size:10px;fill:var(--viz-c3)");
        text(SX + SW + 10, ty + 30, L("回收会把栈减半", "a GC halves the stack"), "font-size:10px;fill:var(--viz-c3)");
      }
      text(SX - 6, SY0 + 4, "hi", "font-size:10.5px;fill:var(--viz-muted);" + MONO, "end");
      text(SX - 6, SY1 + 4, "lo", "font-size:10.5px;fill:var(--viz-muted);" + MONO, "end");
      var u = usedNow();
      text(SX - 30, SY1 + 26, L("已用 ", "used ") + B(u) + L("，SP 距 lo ", ", SP to lo ") + B(size - u), "font-size:11px;fill:var(--viz-muted)");
    }

    // ---- history chart: stack size and used bytes, log2 scale ------------
    var HX0 = 330, HX1 = 700, HY0 = 30, HY1 = 236;
    function drawHist() {
      text(HX0 - 34, 18, L("历次操作后的大小（对数刻度）", "Size after each operation (log scale)"), "font-size:12px;font-weight:600");
      function Y(b) { return HY1 - (Math.log2(Math.max(b, 64)) - 6) / (20 - 6) * (HY1 - HY0); }
      [64, 256, 1024, 4096, 16384, 65536, 262144, 1048576].forEach(function (b) {
        var yy = Y(b);
        line(HX0, yy, HX1, yy, "stroke:var(--viz-line);stroke-opacity:.5");
        text(HX0 - 6, yy + 4, b >= 1024 ? (b >= 1048576 ? "1M" : b / 1024 + "K") : String(b), "font-size:10px;fill:var(--viz-muted)", "end");
      });
      line(HX0, Y(MIN), HX1, Y(MIN), "stroke:var(--viz-muted);stroke-dasharray:2 3");
      text(HX1, Y(MIN) + 12, "fixedStack 2K", "font-size:9.5px;fill:var(--viz-muted)", "end");
      var H = st.hist, n = H.length, dx = (HX1 - HX0) / Math.max(n, 12);
      function X(i) { return HX0 + (i + 0.5) * dx; }
      var ds = "", du = "";
      H.forEach(function (h, i) {
        ds += (i ? " L" + (X(i) - dx / 2) + "," + Y(H[i - 1].size) + " L" : "M") + (X(i) - dx / 2) + "," + Y(h.size) + " L" + (X(i) + dx / 2) + "," + Y(h.size);
        du += (i ? " L" : "M") + X(i) + "," + Y(h.used);
      });
      V.svg("path", { d: ds, style: "fill:none;stroke:var(--viz-c1);stroke-width:2" }, g);
      V.svg("path", { d: du, style: "fill:none;stroke:var(--viz-c4);stroke-width:1.4" }, g);
      H.forEach(function (h, i) {
        var x = X(i), y = Y(h.used);
        if (h.kind === "grow") V.svg("path", { d: "M" + x + "," + (Y(h.size) - 12) + " l-5,8 h10 z", style: "fill:var(--viz-c2)" }, g);
        if (h.kind === "shrink") V.svg("path", { d: "M" + x + "," + (Y(h.size) - 4) + " l-5,-8 h10 z", style: "fill:var(--viz-c3)" }, g);
        if (h.kind === "gc") V.svg("circle", { cx: x, cy: Y(h.size) - 8, r: 3.5, style: "fill:none;stroke:var(--viz-c3);stroke-width:1.3" }, g);
        V.svg("circle", { cx: x, cy: y, r: 2.3, style: "fill:var(--viz-c4)" }, g);
      });
      // legend
      var ly = 258, lx = HX0 - 34;
      [["line", "var(--viz-c1)", L("栈的大小", "stack size")], ["line", "var(--viz-c4)", L("已用", "used")],
        ["up", "var(--viz-c2)", L("增长", "grew")], ["down", "var(--viz-c3)", L("回收时收缩", "shrunk at GC")], ["ring", "var(--viz-c3)", L("回收时未收缩", "GC, kept")]].forEach(function (it) {
        if (it[0] === "line") line(lx, ly - 4, lx + 14, ly - 4, "stroke:" + it[1] + ";stroke-width:2");
        else if (it[0] === "up") V.svg("path", { d: "M" + (lx + 7) + "," + (ly - 9) + " l-5,8 h10 z", style: "fill:" + it[1] }, g);
        else if (it[0] === "down") V.svg("path", { d: "M" + (lx + 7) + "," + (ly + 1) + " l-5,-8 h10 z", style: "fill:" + it[1] }, g);
        else V.svg("circle", { cx: lx + 7, cy: ly - 4, r: 3.5, style: "fill:none;stroke:" + it[1] + ";stroke-width:1.3" }, g);
        text(lx + 19, ly, it[2], "font-size:10.5px;fill:var(--viz-muted)");
        lx += 19 + it[2].length * (V.lang === "en" ? 5.9 : 10.5) + 14;
      });
      text(HX0 - 34, 280, L("linux/amd64，未启用竞态检测；每帧另含 8 字节返回地址。", "linux/amd64 without the race detector; each frame also holds an 8-byte return address."),
        "font-size:10.5px;fill:var(--viz-muted)");
    }

    function narrate() {
      var e = st.last, s;
      if (!e) s = L("新 goroutine 的栈为 2 KiB，入口函数 f1 的帧已经建立。选定帧的大小后按「调用」加深调用链，再依次按「返回」与「回收」观察栈的变化。",
        "A new goroutine has a 2 KiB stack and its entry function f1 has set up its frame. Pick a frame size and press Call; then try Return and GC.");
      else if (e.kind === "call") {
        s = L("调用 f" + e.n + "（帧 " + B(e.F) + "）：", "Call f" + e.n + " (" + B(e.F) + " frame): ");
        s += e.F <= SMALL ? L("入口处 SP 距 lo " + B(e.d) + "，高于警戒线 lo + 928，检查通过。", "at entry SP is " + B(e.d) + " above lo, higher than lo + 928, so the check passes.")
          : L("建帧后 SP 距 lo 还有 " + B(e.d - e.F) + "，多于 800，检查通过。", "after the frame, SP would be " + B(e.d - e.F) + " above lo, more than 800, so the check passes.");
      } else if (e.kind === "grow") {
        s = L("调用 f" + e.n + "（帧 " + B(e.F) + "）：", "Call f" + e.n + " (" + B(e.F) + " frame): ");
        s += e.F <= SMALL ? L("入口处 SP 距 lo 只有 " + B(e.d) + "，不高于警戒线，", "at entry SP is only " + B(e.d) + " above lo, not above the guard, ")
          : e.d - e.F < 0 ? L("建帧后 SP 将越过 lo，", "the frame would take SP past lo, so ")
          : L("建帧后 SP 距 lo 只剩 " + B(e.d - e.F) + "，不足 800，", "after the frame SP would be only " + B(e.d - e.F) + " above lo, under 800, so ");
        s += L("检查失败，进入 morestack 与 newstack。新栈取旧栈的两倍 " + kib(e.old * 2) + (e.loops ? "，仍放不下这一帧（需 " + B(e.F + GUARD) + "），继续加倍到 " + kib(e.size) : "") +
          "。copystack 把已用的 " + B(e.copied) + "复制到新栈的高端，指向旧栈的指针都加上 new.hi − old.hi（14.4）；f" + e.n + " 重新执行序言，这次检查通过。",
          "the check fails and morestack calls newstack. The new stack is twice the old, " + kib(e.old * 2) + (e.loops ? ", still too small for this frame (it needs " + B(e.F + GUARD) + "), so it doubles again to " + kib(e.size) : "") +
          ". copystack copies the " + B(e.copied) + " in use to the top of the new stack and adds new.hi − old.hi to every pointer into the old one (14.4); f" + e.n + " reruns its prologue and passes.");
      } else if (e.kind === "ret") {
        s = L((e.n > 1 ? "返回 " + e.n + " 层" : "返回一层") + "，SP 回升 " + B(e.b) + "。栈的大小不变：只有回收扫描栈时才可能收缩。",
          (e.n > 1 ? "Return " + e.n + " levels" : "Return one level") + "; SP rises by " + B(e.b) + ". The stack keeps its size: only a GC scan can shrink it.");
      } else if (e.kind === "gc") {
        if (e.why === "min") s = L("回收扫描这个栈。它已是 2 KiB，减半就低于 fixedStack，保持不变。", "A GC scans the stack. It is 2 KiB already; half of that is below fixedStack, so it stays.");
        else {
          var cmp = e.sp + " + 800 = " + e.used;
          s = e.why === "busy"
            ? L("回收扫描这个栈：已用 " + cmp + " 字节，不小于 " + kib(e.old) + " 的四分之一（" + e.old / 4 + "），保持不变。",
              "A GC scans the stack: used " + cmp + " bytes is not below a quarter of " + kib(e.old) + " (" + e.old / 4 + "), so it stays.")
            : L("回收扫描这个栈：已用 " + cmp + " 字节，小于 " + kib(e.old) + " 的四分之一（" + e.old / 4 + "），copystack 把它移到 " + kib(e.old / 2) + " 的新栈。",
              "A GC scans the stack: used " + cmp + " bytes is below a quarter of " + kib(e.old) + " (" + e.old / 4 + "), so copystack moves it to a new " + kib(e.old / 2) + " stack.");
        }
      } else if (e.kind === "cap") {
        s = L("这个演示到 1 MiB 为止；真实的上限是 maxstacksize，64 位系统上为 1 GB。", "The figure stops at 1 MiB; the real limit is maxstacksize, 1 GB on 64-bit systems.");
      }
      p.note.textContent = s;
    }

    function draw() { clear(); drawStack(); drawHist(); narrate(); retBtn.disabled = retAll.disabled = st.frames.length <= 1; }

    var fsel = V.select(p.bar, L("帧大小", "Frame size"), FRAMES.map(function (f) { return { value: String(f), label: kib(f) }; }), String(F),
      function (v) { F = +v; });
    fsel.parentNode.style.color = "var(--viz-ink)";
    V.button(p.bar, L("调用", "Call"), function () { call(); draw(); });
    var retBtn = V.button(p.bar, L("返回", "Return"), function () { ret(false); draw(); });
    var retAll = V.button(p.bar, L("全部返回", "Return all"), function () { ret(true); draw(); });
    V.button(p.bar, L("回收", "GC"), function () { gc(); draw(); });
    V.button(p.bar, L("重置", "Reset"), function () { reset(); draw(); });

    reset();
    draw();
  });
})();
