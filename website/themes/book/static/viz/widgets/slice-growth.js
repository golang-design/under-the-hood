/*
 * slice-growth: how append picks a new capacity (book §5.1.3).
 *
 * The simulation appends k elements at a time to a nil slice whose backing
 * array lives on the heap (a package-level variable, say) until it holds 4000
 * elements, and records every call to growslice. Each new capacity is
 * computed exactly as Go 1.26 does it:
 *
 *   runtime/slice.go  nextslicecap: newLen > 2*oldCap gives newLen; below
 *                     threshold 256 the capacity doubles; from 256 on the
 *                     loop adds (newcap + 3*256) >> 2 until newcap >= newLen.
 *   runtime/slice.go  growslice: bytes = newcap * elemsize, rounded by
 *                     roundupsize, then newcap = bytes / elemsize.
 *   runtime/msize.go  roundupsize: small requests round up to the smallest
 *                     size class; pointerful objects above 512 bytes add an
 *                     8-byte malloc header first (and subtract it after);
 *                     requests above 32768-8 bytes round up to 8 KiB pages.
 *   internal/runtime/gc/sizeclasses.go  SizeClassToSize (68 classes).
 *
 * The sequences match `go run` with Go 1.26.10 for every element type and
 * batch size offered here. A slice that does not escape starts from the
 * 32-byte stack buffer of §5.1.4 instead; that path is not shown.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace)";

  // internal/runtime/gc/sizeclasses.go, SizeClassToSize
  var CLASS = [0, 8, 16, 24, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240, 256, 288, 320,
    352, 384, 416, 448, 480, 512, 576, 640, 704, 768, 896, 1024, 1152, 1280, 1408, 1536, 1792, 2048, 2304, 2688,
    3072, 3200, 3456, 4096, 4864, 5376, 6144, 6528, 6784, 6912, 8192, 9472, 9728, 10240, 10880, 12288, 13568,
    14336, 16384, 18432, 19072, 20480, 21760, 24576, 27264, 28672, 32768];
  var MAX_SMALL = 32768, HDR = 8, MIN_HDR = 512, PAGE = 8192, THRESHOLD = 256, TARGET = 4000;

  var TYPES = {
    int: { name: "int", size: 8, ptr: false },
    byte: { name: "byte", size: 1, ptr: false },
    ptr: { name: "*T", size: 8, ptr: true },
    string: { name: "string", size: 16, ptr: true },
    arr3: { name: "[3]int", size: 24, ptr: false },
  };

  // roundupsize, with the pieces kept for the narration.
  function roundup(size, noscan) {
    var req = size, hdr = false;
    if (req <= MAX_SMALL - HDR) {
      if (!noscan && req > MIN_HDR) { req += HDR; hdr = true; }
      for (var i = 1; i < CLASS.length; i++) {
        if (CLASS[i] >= req) return { usable: CLASS[i] - (req - size), block: CLASS[i], cls: i, hdr: hdr, large: false };
      }
    }
    var r = Math.ceil(size / PAGE) * PAGE;
    return { usable: r, block: r, cls: 0, hdr: false, large: true };
  }
  function nextslicecap(newLen, oldCap) {
    var newcap = oldCap, doublecap = newcap + newcap;
    if (newLen > doublecap) return { cap: newLen, why: "need" };
    if (oldCap < THRESHOLD) return { cap: doublecap, why: "double" };
    var n = 0;
    do { newcap += (newcap + 3 * THRESHOLD) >> 2; n++; } while (newcap < newLen);
    return { cap: newcap, why: "smooth", iters: n };
  }
  function simulate(t, k) {
    var len = 0, cap = 0, ev = [];
    while (len < TARGET) {
      var newLen = len + k;
      if (newLen > cap) {
        var nx = nextslicecap(newLen, cap), bytes = nx.cap * t.size, r = roundup(bytes, !t.ptr);
        var newCap = Math.floor(r.usable / t.size);
        ev.push({ oldLen: len, newLen: newLen, oldCap: cap, next: nx, bytes: bytes, r: r, newCap: newCap });
        cap = newCap;
      }
      len = newLen;
    }
    return ev;
  }

  V.register("slice-growth", function (host) {
    var p = V.panel(host, { title: L("append 的扩容：倍增公式与尺寸类取整", "How append grows a slice: the formula and size classes") });
    var root = V.svg("svg", { viewBox: "0 0 720 318", role: "img",
      "aria-label": L("每次扩容的增长倍率与计算过程", "Growth factor of each reallocation and how it is computed") }, p.stage);
    var gChart = V.svg("g", null, root), gPipe = V.svg("g", null, root);
    var defs = V.svg("defs", null, root);
    var mk = V.svg("marker", { id: "sg-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5,
      markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
    V.svg("path", { d: "M0,0 L10,5 L0,10 z", style: "fill:var(--viz-muted)" }, mk);

    var tkey = "int", k = 1, ev, sel = null;
    var X0 = 64, X1 = 712, YT = 36, YB = 178, FMAX = 2.4, FMIN = 1.0;
    function y(f) { return YB - (Math.min(f, FMAX) - FMIN) / (FMAX - FMIN) * (YB - YT); }
    function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }
    function txt(g, x, yy, s, style, anchor) {
      return V.svg("text", { x: x, y: yy, "text-anchor": anchor || "start", style: style || "", text: s }, g);
    }
    function fmt(f) { return (Math.round(f * 100) / 100).toFixed(2) + "×"; }

    function drawChart() {
      clear(gChart);
      var n = ev.length, step = (X1 - X0) / n, bw = Math.min(24, step * 0.56);
      // axis, reference lines
      txt(gChart, 8, 14, L("增长倍率（新容量 ÷ 旧容量）", "Growth factor (new cap ÷ old cap)"), "font-size:11px;fill:var(--viz-muted)");
      [1.0, 1.25, 2.0].forEach(function (f) {
        V.svg("line", { x1: X0 - 6, y1: y(f), x2: X1, y2: y(f),
          style: "stroke:var(--viz-line);stroke-width:1" + (f === 1.0 ? "" : ";stroke-dasharray:4 3") }, gChart);
        txt(gChart, X0 - 10, y(f) + 4, f === 1.0 ? "1×" : f === 2.0 ? "2×" : "1.25×", "font-size:10.5px;fill:var(--viz-muted)", "end");
      });
      // the threshold: first reallocation whose old capacity is >= 256
      for (var t = 1; t < n; t++) if (ev[t].oldCap >= THRESHOLD && ev[t - 1].oldCap < THRESHOLD) {
        var tx = X0 + t * step;
        V.svg("line", { x1: tx, y1: YT - 4, x2: tx, y2: YB + 4, style: "stroke:var(--viz-c2);stroke-width:1;stroke-dasharray:2 3" }, gChart);
        txt(gChart, tx + 4, YT + 2, L("旧容量 ≥ 256", "old cap ≥ 256"), "font-size:10.5px;fill:var(--viz-c2)");
      }
      ev.forEach(function (e, i) {
        var cx = X0 + (i + 0.5) * step, hot = sel === i, dim = sel != null && !hot;
        var hit = V.svg("g", { style: "cursor:pointer" + (dim ? ";opacity:.45" : "") }, gChart);
        hit.addEventListener("click", function () { sel = i; draw(); });
        V.svg("rect", { x: cx - step / 2, y: YT - 10, width: step, height: YB - YT + 34, style: "fill:transparent" }, hit);
        if (e.oldCap === 0) {
          V.svg("circle", { cx: cx, cy: YB, r: 4, style: "fill:var(--viz-c1)" }, hit);
          txt(hit, cx, YB - 9, String(e.newCap), "font-size:10.5px;" + MONO, "middle");
        } else {
          var ff = e.next.cap / e.oldCap, fa = e.newCap / e.oldCap;
          V.svg("rect", { x: cx - bw / 2, y: y(ff), width: bw, height: YB - y(ff),
            style: "fill:var(--viz-c1);fill-opacity:" + (hot ? 0.45 : 0.28) + ";stroke:var(--viz-c1);stroke-width:" + (hot ? 1.6 : 1) }, hit);
          if (fa > ff + 1e-9) V.svg("rect", { x: cx - bw / 2, y: y(fa), width: bw, height: y(ff) - y(fa),
            style: "fill:var(--viz-c4);fill-opacity:" + (hot ? 0.55 : 0.35) + ";stroke:var(--viz-c4);stroke-width:1" }, hit);
          txt(hit, cx, y(fa) - 5, String(e.newCap), "font-size:10.5px;" + MONO + (hot ? ";font-weight:700" : ""), "middle");
        }
        txt(hit, cx, YB + 18, String(i + 1), "font-size:10px;fill:var(--viz-muted)", "middle");
      });
      txt(gChart, X0 - 10, YB + 18, L("第几次", "#"), "font-size:10px;fill:var(--viz-muted)", "end");
      // legend
      var lx = 452;
      V.svg("rect", { x: lx, y: 5, width: 11, height: 11, style: "fill:var(--viz-c1);fill-opacity:.28;stroke:var(--viz-c1)" }, gChart);
      txt(gChart, lx + 16, 14, L("公式给出", "from the formula"), "font-size:11px;fill:var(--viz-muted)");
      lx += L(80, 112);
      V.svg("rect", { x: lx, y: 5, width: 11, height: 11, style: "fill:var(--viz-c4);fill-opacity:.35;stroke:var(--viz-c4)" }, gChart);
      txt(gChart, lx + 16, 14, L("尺寸类取整多出", "extra from rounding"), "font-size:11px;fill:var(--viz-muted)");
    }

    function boxes(e, t) {
      var B = [];
      B.push({ h: L("旧容量", "old cap"), v: String(e.oldCap),
        s: L("要放下 " + e.newLen + " 个", "needs room for " + e.newLen) });
      var why = e.next.why === "need" ? L("超过 2 倍：取所需长度", "more than 2×: take newLen")
        : e.next.why === "double" ? L("小于 256：翻倍", "below 256: double")
        : L("≥ 256：+(newcap+768)/4" + (e.next.iters > 1 ? " × " + e.next.iters : ""), "≥ 256: +(newcap+768)/4" + (e.next.iters > 1 ? " × " + e.next.iters : ""));
      B.push({ h: "nextslicecap", v: String(e.next.cap), s: why });
      B.push({ h: L("字节数", "bytes"), v: String(e.bytes), s: e.next.cap + " × " + t.size + (t.size === 1 ? L(" 字节", " byte") : L(" 字节", " bytes")) });
      var r = e.r;
      B.push({ h: r.large ? L("按页取整", "page rounding") : L("尺寸类", "size class"), v: String(r.usable),
        s: r.large ? L("大对象：8 KB 的倍数", "large: multiple of 8 KiB")
          : r.hdr ? L(r.block + " − 8（分配头）", r.block + " − 8 (header)")
          : L("第 " + r.cls + " 类", "class " + r.cls) });
      B.push({ h: L("新容量", "new cap"), v: String(e.newCap), s: r.usable + " ÷ " + t.size });
      return B;
    }

    function drawPipe() {
      clear(gPipe);
      var t = TYPES[tkey], y0 = 228, bw = 124, gap = 19, x0 = 10;
      var e = sel != null ? ev[sel] : null;
      txt(gPipe, 8, y0 - 12, e ? L("第 " + (sel + 1) + " 次扩容的计算过程", "Reallocation #" + (sel + 1) + ", step by step")
        : L("计算过程（点「下一步」或点一根柱子）", "How each one is computed (press Step or click a bar)"), "font-size:12px;font-weight:600");
      var B = e ? boxes(e, t) : [
        { h: L("旧容量", "old cap") }, { h: "nextslicecap" }, { h: L("字节数", "bytes") },
        { h: L("尺寸类", "size class") }, { h: L("新容量", "new cap") }];
      B.forEach(function (b, i) {
        var x = x0 + i * (bw + gap), last = i === B.length - 1;
        V.svg("rect", { x: x, y: y0, width: bw, height: 64, rx: 6,
          style: "fill:" + (e && last ? "var(--viz-c3)" : "var(--viz-fill)") + ";fill-opacity:" + (e && last ? 0.14 : 1) +
            ";stroke:" + (e && last ? "var(--viz-c3)" : "var(--viz-line)") }, gPipe);
        txt(gPipe, x + bw / 2, y0 + 16, b.h, "font-size:11px;fill:var(--viz-muted)" + (i === 1 ? ";" + MONO : ""), "middle");
        txt(gPipe, x + bw / 2, y0 + 37, b.v || "–", "font-size:15px;font-weight:700;" + MONO, "middle");
        if (b.s) txt(gPipe, x + bw / 2, y0 + 55, b.s, "font-size:10px;fill:var(--viz-muted)", "middle");
        if (!last) V.svg("path", { d: "M" + (x + bw + 3) + "," + (y0 + 32) + " L" + (x + bw + gap - 3) + "," + (y0 + 32),
          "marker-end": "url(#sg-arrow)", style: "fill:none;stroke:var(--viz-muted);stroke-width:1.2" }, gPipe);
      });
      txt(gPipe, 8, 312, L("从 nil 切片开始，每次追加 " + k + " 个 " + t.name + "，直到 4000 个；底层数组在堆上。",
        "Start from a nil slice and append " + k + " " + t.name + (k === 1 ? "" : " values") + " at a time up to 4000; the backing array is on the heap."),
        "font-size:11px;fill:var(--viz-muted)");
    }

    function narrate() {
      var t = TYPES[tkey];
      if (sel == null) {
        var caps = ev.map(function (e) { return e.newCap; }).join(" ");
        p.note.textContent = L("共扩容 " + ev.length + " 次，容量依次为 " + caps + "。旧容量小于 256 时翻倍，此后倍率逐渐降向 1.25；柱子顶端的浅紫色部分是尺寸类取整多给的容量。",
          ev.length + " reallocations; the capacities are " + caps + ". Below an old capacity of 256 the slice doubles, then the factor falls toward 1.25; the light purple tops are capacity gained by rounding up to a size class.");
        return;
      }
      var e = ev[sel], r = e.r, s;
      var head = L("第 " + (sel + 1) + " 次扩容：追加后长度为 " + e.newLen + "，超出容量 " + e.oldCap + "。",
        "Reallocation #" + (sel + 1) + ": the new length " + e.newLen + " exceeds the capacity " + e.oldCap + ". ");
      var step1 = e.next.why === "need"
        ? L("所需长度超过旧容量的 2 倍，nextslicecap 直接取 " + e.next.cap + "。", "That is more than twice the old capacity, so nextslicecap takes " + e.next.cap + " directly. ")
        : e.next.why === "double" ? L("旧容量小于 256，翻倍得 " + e.next.cap + "。", "The old capacity is below 256, so it doubles to " + e.next.cap + ". ")
        : L("旧容量不小于 256，按公式 newcap += (newcap + 768) >> 2 " + (e.next.iters > 1 ? "累加 " + e.next.iters + " 轮" : "") + "得 " + e.next.cap + "。",
          "The old capacity is at least 256, so newcap += (newcap + 768) >> 2 " + (e.next.iters > 1 ? "runs " + e.next.iters + " times and " : "") + "gives " + e.next.cap + ". ");
      var step2;
      if (r.large) step2 = L(e.next.cap + " 个元素需 " + e.bytes + " 字节，超过小对象上限，按 8 KB 页取整为 " + r.usable + " 字节",
        e.next.cap + " elements need " + e.bytes + " bytes, above the small-object limit, so it rounds up to whole 8 KiB pages: " + r.usable + " bytes");
      else if (r.hdr) step2 = L(e.next.cap + " 个元素需 " + e.bytes + " 字节；元素含指针且对象超过 512 字节，分配器要在对象开头放 8 字节的分配头，" + (e.bytes + 8) + " 字节落入 " + r.block + " 字节的尺寸类，扣除分配头后可用 " + r.usable + " 字节",
        e.next.cap + " elements need " + e.bytes + " bytes; the elements hold pointers and the object exceeds 512 bytes, so the allocator puts an 8-byte malloc header in front. " + (e.bytes + 8) + " bytes fall into the " + r.block + "-byte size class, leaving " + r.usable + " usable bytes");
      else if (r.usable === e.bytes) step2 = L(e.next.cap + " 个元素需 " + e.bytes + " 字节，正好是一个尺寸类，不必取整",
        e.next.cap + " elements need " + e.bytes + " bytes, exactly a size class, so nothing is rounded");
      else step2 = L(e.next.cap + " 个元素需 " + e.bytes + " 字节，向上取整到 " + r.usable + " 字节的尺寸类",
        e.next.cap + " elements need " + e.bytes + " bytes, which round up to the " + r.usable + "-byte size class");
      s = head + step1 + step2 + L("，新容量为 " + r.usable + " ÷ " + t.size + " = " + e.newCap + "。", ", so the new capacity is " + r.usable + " ÷ " + t.size + " = " + e.newCap + ".");
      p.note.textContent = s;
    }

    function draw() { drawChart(); drawPipe(); narrate(); }
    function rebuild() { ev = simulate(TYPES[tkey], k); sel = null; draw(); }

    V.button(p.bar, L("下一步", "Step"), function () { sel = sel == null ? 0 : (sel + 1) % ev.length; draw(); });
    V.button(p.bar, L("上一步", "Back"), function () { sel = sel == null ? ev.length - 1 : (sel + ev.length - 1) % ev.length; draw(); });
    V.button(p.bar, L("总览", "Overview"), function () { sel = null; draw(); });
    V.select(p.bar, L("元素类型", "Element"), [
      { value: "int", label: L("int（8 字节）", "int (8 bytes)") },
      { value: "byte", label: L("byte（1 字节）", "byte (1 byte)") },
      { value: "ptr", label: L("*T（8 字节，指针）", "*T (8 bytes, pointer)") },
      { value: "string", label: L("string（16 字节，含指针）", "string (16 bytes, has a pointer)") },
      { value: "arr3", label: L("[3]int（24 字节）", "[3]int (24 bytes)") },
    ], tkey, function (v) { tkey = v; rebuild(); });
    V.select(p.bar, L("每次追加", "Append at a time"), [1, 5, 100].map(function (n) {
      return { value: String(n), label: L(n + " 个", String(n)) };
    }), "1", function (v) { k = +v; rebuild(); });

    rebuild();
  });
})();
