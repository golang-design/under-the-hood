/*
 * alloc-tiny: how the tiny allocator packs noscan objects smaller than
 * 16 bytes into 16-byte blocks (book §12.6).
 *
 * The rules are runtime/malloc.go mallocgcTiny in Go 1.26 on a 64-bit
 * platform (the 32-bit special case for 12-byte objects does not apply):
 *   - align c.tinyoffset by the request size: to 8 if size&7 == 0, else to 4
 *     if size&3 == 0, else to 2 if size&1 == 0;
 *   - if off+size <= maxTinySize (16) and c.tiny != 0, the object goes into
 *     the current block at off and tinyoffset becomes off+size;
 *   - otherwise a new 16-byte block is taken from size class 2 (tinySpanClass)
 *     and zeroed; the object is placed at its start; the new block becomes
 *     the current one only if size < c.tinyoffset or c.tiny == 0, i.e. if it
 *     has more room left than the old block (race detector off).
 *   - mcache.releaseAll (runtime/mcache.go) clears c.tiny and c.tinyoffset at
 *     mark termination; existing blocks are ordinary 16-byte objects.
 * "Allocated alone" uses the size classes of internal/runtime/gc: requests up
 * to 8 bytes take an 8-byte slot, 9 to 15 bytes a 16-byte slot.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace)";
  var BLOCK = 16, ROWS = 5;

  var PRESETS = [
    { id: "s3", label: L("3 字节 × 6", "3 bytes × 6"), seq: [3, 3, 3, 3, 3, 3] },
    { id: "s4", label: L("4 字节 × 5", "4 bytes × 5"), seq: [4, 4, 4, 4, 4] },
    { id: "s12", label: L("12 字节 × 3", "12 bytes × 3"), seq: [12, 12, 12] },
    { id: "s1222", label: "12, 2, 2, 12", seq: [12, 2, 2, 12] },
    { id: "s18", label: "1, 8, 4, 2", seq: [1, 8, 4, 2] },
    { id: "s6122", label: "6, 12, 3, 2", seq: [6, 12, 3, 2] },
  ];

  function alignOf(n) { return (n & 7) === 0 ? 8 : (n & 3) === 0 ? 4 : (n & 1) === 0 ? 2 : 1; }
  function up(x, a) { return Math.ceil(x / a) * a; }
  function alone(n) { return n <= 8 ? 8 : 16; }
  function tw(s, fs) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? fs : fs * 0.56; return w; }

  V.register("alloc-tiny", function (host) {
    var p = V.panel(host, { title: L("微对象分配器：把小于 16 字节的对象并入同一个块", "The tiny allocator: packing objects under 16 bytes into one block") });
    var root = V.svg("svg", { viewBox: "0 0 720 280", role: "img",
      "aria-label": L("16 字节的块及其中的微对象", "16-byte blocks and the tiny objects in them") }, p.stage);
    var g = V.svg("g", null, root);

    var st;
    function reset() {
      st = { blocks: [], objs: [], cur: -1, off: 0, log: [], last: null };
    }

    // One call of mallocgcTiny. Returns a record for the log and the note.
    function alloc(n) {
      var k = st.objs.length + 1, a = alignOf(n), old = st.off, off = up(old, a), r = { k: k, n: n, a: a, old: old, off: off };
      if (off + n <= BLOCK && st.cur >= 0) {
        var b = st.blocks[st.cur];
        for (var i = old; i < off; i++) b.cells[i] = "pad";
        for (var j = off; j < off + n; j++) b.cells[j] = k;
        st.off = off + n;
        r.kind = "fit"; r.block = st.cur;
      } else {
        var nb = { id: st.blocks.length + 1, cells: [] };
        for (var c = 0; c < BLOCK; c++) nb.cells.push(c < n ? k : null);
        st.blocks.push(nb);
        r.kind = "new"; r.block = st.blocks.length - 1; r.hadCur = st.cur >= 0; r.oldOff = st.off;
        if (n < st.off || st.cur < 0) { st.cur = r.block; st.off = n; r.replace = true; }
      }
      st.objs.push({ k: k, n: n, block: r.block });
      st.last = r; st.log.push(r);
      return r;
    }

    function clear() { while (g.firstChild) g.removeChild(g.firstChild); }
    function text(x, y, s, style, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: style || "font-size:12px", text: s }, g);
    }
    function objColor(k) { return k % 2 ? "var(--viz-c1)" : "var(--viz-c4)"; }

    var CX = 62, CW = 20, RH = 28, RY = 46;
    function drawBlocks() {
      text(8, 18, L("16 字节的块（每格 1 字节）", "16-byte blocks (one cell per byte)"), "font-size:12px;font-weight:600");
      [0, 4, 8, 12, 16].forEach(function (o) {
        text(CX + o * CW, 36, String(o), "font-size:10px;fill:var(--viz-muted);" + MONO, "middle");
      });
      var first = Math.max(0, st.blocks.length - ROWS);
      if (!st.blocks.length) text(CX, RY + 20, L("（还没有块，c.tiny 为 0）", "(no block yet; c.tiny is 0)"), "font-size:12px;fill:var(--viz-muted)");
      for (var bi = first; bi < st.blocks.length; bi++) {
        var b = st.blocks[bi], y = RY + (bi - first) * (RH + 8), isCur = bi === st.cur;
        text(8, y + 19, L("块 ", "block ") + b.id, "font-size:11.5px;" + (isCur ? "font-weight:700" : "fill:var(--viz-muted)"));
        var c = 0;
        while (c < BLOCK) {
          var v = b.cells[c], e = c + 1;
          while (e < BLOCK && b.cells[e] === v) e++;
          var x = CX + c * CW, w = (e - c) * CW;
          if (typeof v === "number") {
            var col = objColor(v), now = st.last && st.last.k === v;
            V.svg("rect", { x: x + 1, y: y, width: w - 2, height: RH, rx: 3,
              style: "fill:" + col + ";fill-opacity:" + (now ? 0.32 : 0.16) + ";stroke:" + col + ";stroke-width:" + (now ? 2 : 1) }, g);
            var lab = "#" + v + (w >= 60 ? " · " + (e - c) + "B" : "");
            if (tw(lab, 11) + 4 <= w) text(x + w / 2, y + 19, lab, "font-size:11px;" + MONO, "middle");
          } else {
            for (var q = c; q < e; q++) {
              V.svg("rect", { x: CX + q * CW + 1, y: y, width: CW - 2, height: RH, rx: 3,
                style: v === "pad" ? "fill:var(--viz-c2);fill-opacity:.14;stroke:var(--viz-c2);stroke-dasharray:3 2"
                  : "fill:var(--viz-fill);stroke:var(--viz-line)" }, g);
            }
          }
          c = e;
        }
        if (isCur) {
          var ox = CX + st.off * CW;
          V.svg("line", { x1: ox, y1: y - 5, x2: ox, y2: y + RH + 5, style: "stroke:var(--viz-c1);stroke-width:2" }, g);
          text(CX + BLOCK * CW + 8, y + 13, L("← c.tiny", "← c.tiny"), "font-size:11px;font-weight:600;fill:var(--viz-c1);" + MONO);
          text(CX + BLOCK * CW + 8, y + 27, "tinyoffset=" + st.off, "font-size:10.5px;fill:var(--viz-c1);" + MONO);
        }
      }
      if (first > 0) text(8, RY + ROWS * (RH + 8) + 6, L("（另有 " + first + " 个更早的块）", "(" + first + " earlier " + (first === 1 ? "block" : "blocks") + " not shown)"), "font-size:11px;fill:var(--viz-muted)");
      // legend
      var ly = 272, lx = 8;
      [["var(--viz-c1)", 0.16, "", L("微对象（编号）", "tiny object (number)")], ["var(--viz-c2)", 0.14, ";stroke-dasharray:3 2", L("对齐留下的空隙", "alignment gap")],
        ["var(--viz-line)", 1, "", L("空闲", "free")]].forEach(function (it) {
        V.svg("rect", { x: lx, y: ly - 10, width: 12, height: 12, rx: 2,
          style: "fill:" + (it[1] === 1 ? "var(--viz-fill)" : it[0]) + ";fill-opacity:" + it[1] + ";stroke:" + it[0] + it[2] }, g);
        text(lx + 17, ly, it[3], "font-size:11px;fill:var(--viz-muted)");
        lx += 17 + tw(it[3], 11) + 18;
      });
    }

    function logLine(r) {
      if (r.kind === "fit") return L("#" + r.k + "：" + r.n + " 字节 → 块 " + st.blocks[r.block].id + "，偏移 " + r.off,
        "#" + r.k + ": " + r.n + " B → block " + st.blocks[r.block].id + " at " + r.off);
      return L("#" + r.k + "：" + r.n + " 字节 → 新块 " + st.blocks[r.block].id + (r.replace ? "，成为当前块" : "，旧块仍为当前块"),
        "#" + r.k + ": " + r.n + " B → new block " + st.blocks[r.block].id + (r.replace ? " (current)" : " (old one stays)"));
    }
    function drawSide() {
      var x = 494;
      text(x, 18, L("分配记录", "Allocations"), "font-size:12px;font-weight:600");
      var shown = st.log.slice(-8);
      if (!shown.length) text(x, 40, L("（尚无）", "(none yet)"), "font-size:11.5px;fill:var(--viz-muted)");
      shown.forEach(function (r, i) {
        var s = r.kind === "gc" ? L("—— 一轮回收结束，清空 c.tiny", "— end of a GC cycle: c.tiny cleared") : logLine(r);
        text(x, 40 + i * 18, s, "font-size:10.5px;" + (r === st.last ? "font-weight:600" : "fill:var(--viz-muted)"));
      });
      // totals
      var N = st.objs.length, req = 0, sep = 0;
      st.objs.forEach(function (o) { req += o.n; sep += alone(o.n); });
      var y = 196, used = st.blocks.length * BLOCK;
      text(x, y, L("合计", "Totals"), "font-size:12px;font-weight:600");
      if (!N) return;
      text(x, y + 20, L(N + " 个对象共请求 " + req + " 字节", N + (N === 1 ? " object" : " objects") + ", " + req + " bytes requested"), "font-size:11.5px");
      text(x, y + 38, L("占用 " + st.blocks.length + " 个块，" + used + " 字节，平均每个 " + (used / N).toFixed(1) + " 字节",
        st.blocks.length + (st.blocks.length === 1 ? " block" : " blocks") + ", " + used + " bytes, " + (used / N).toFixed(1) + " each"), "font-size:11.5px");
      text(x, y + 56, L("各自单独分配：" + sep + " 字节", "Allocated alone: " + sep + " bytes"), "font-size:11.5px;fill:var(--viz-muted)");
    }

    function narrate() {
      var r = st.last;
      if (!r) {
        p.note.textContent = L("选定大小后按「分配」，或在「示例」中选择一组请求。每个请求都按 mallocgcTiny 的规则处理。",
          "Pick a size and press Allocate, or choose a sequence under Examples. Each request follows mallocgcTiny.");
        return;
      }
      if (r.kind === "gc") {
        p.note.textContent = L("标记终止时，releaseAll 清空 c.tiny 与 tinyoffset。已有的块是普通的 16 字节对象，其中的微对象存活多久，块就存活多久；下一个微对象从新块开始。",
          "At mark termination releaseAll clears c.tiny and tinyoffset. Existing blocks are ordinary 16-byte objects that live as long as any object in them; the next tiny object starts a new block.");
        return;
      }
      var al = r.a === 1 ? L("大小是奇数，不需对齐", "an odd size needs no alignment")
        : L("大小是 " + r.a + " 的倍数，偏移对齐到 " + r.a, "a multiple of " + r.a + " aligns the offset to " + r.a);
      var shift = r.off !== r.old ? L("（" + r.old + " → " + r.off + "）", " (" + r.old + " → " + r.off + ")") : "";
      var s = L("请求 " + r.n + " 字节：" + al + shift + "。", "Request " + r.n + " bytes: " + al + shift + ". ");
      if (r.kind === "fit") {
        s += L(r.off + " + " + r.n + " = " + (r.off + r.n) + " ≤ 16，放入当前块，tinyoffset 变为 " + (r.off + r.n) + "。不取新槽位，也不清零。",
          r.off + " + " + r.n + " = " + (r.off + r.n) + " ≤ 16, so it goes into the current block and tinyoffset becomes " + (r.off + r.n) + ". No new slot, no zeroing.");
      } else if (!r.hadCur) {
        s += L("当前没有块（c.tiny 为 0），从 2 号尺寸类取一个 16 字节的槽位，整块清零，对象放在开头，这个块成为当前块。",
          "There is no current block (c.tiny is 0), so a 16-byte slot is taken from size class 2 and zeroed; the object goes at its start and the block becomes current.");
      } else {
        s += L(r.off + " + " + r.n + " = " + (r.off + r.n) + " > 16，当前块容不下。取一个新块，对象放在开头。",
          r.off + " + " + r.n + " = " + (r.off + r.n) + " > 16 does not fit, so a new block is taken and the object goes at its start. ");
        s += r.replace
          ? L("新块剩余 " + (16 - r.n) + " 字节，多于旧块的 " + (16 - r.oldOff) + " 字节（" + r.n + " < " + r.oldOff + "），新块成为当前块。",
            "The new block has " + (16 - r.n) + " bytes left, more than the old block's " + (16 - r.oldOff) + " (" + r.n + " < " + r.oldOff + "), so it becomes current.")
          : L("新块剩余 " + (16 - r.n) + " 字节，不多于旧块的 " + (16 - r.oldOff) + " 字节（" + r.n + " < " + r.oldOff + " 不成立），旧块仍是当前块。",
            "The new block has " + (16 - r.n) + " bytes left, no more than the old block's " + (16 - r.oldOff) + " (" + r.n + " < " + r.oldOff + " is false), so the old block stays current.");
      }
      p.note.textContent = s;
    }

    function draw() { clear(); drawBlocks(); drawSide(); narrate(); }

    var size = 3;
    var sizeSel = V.select(p.bar, L("大小", "Size"), [], "", function (v) { size = +v; });
    for (var i = 1; i < 16; i++) V.el("option", { value: String(i), text: L(i + " 字节", i + (i === 1 ? " byte" : " bytes")) }, sizeSel);
    sizeSel.value = String(size);
    sizeSel.parentNode.style.color = "var(--viz-ink)";
    V.button(p.bar, L("分配", "Allocate"), function () { alloc(size); draw(); });
    V.button(p.bar, L("一轮回收结束", "End of GC cycle"), function () {
      st.cur = -1; st.off = 0; st.last = { kind: "gc" }; st.log.push(st.last); draw();
    });
    V.button(p.bar, L("清空", "Clear"), function () { reset(); draw(); });
    var pre = V.select(p.bar, L("示例", "Examples"), [{ value: "", label: L("请选择", "pick one") }].concat(PRESETS.map(function (q) {
      return { value: q.id, label: q.label };
    })), "", function (id) {
      var q = PRESETS.filter(function (x) { return x.id === id; })[0];
      pre.value = "";
      if (!q) return;
      reset(); q.seq.forEach(alloc); draw();
    });
    pre.parentNode.style.color = "var(--viz-ink)";

    reset();
    PRESETS[3].seq.forEach(alloc);
    draw();
  });
})();
