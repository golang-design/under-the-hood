/*
 * alloc-sizeclass: where a heap allocation of a given size goes, and what it
 * costs (book §12.1).
 *
 * Everything follows Go 1.26 on a 64-bit platform:
 *   - path selection: runtime/malloc.go mallocgc (generic path; the
 *     size-specialized experiment is off by default). size 0 returns
 *     &zerobase; size <= maxSmallSize-MallocHeaderSize (32760) is small;
 *     noscan and size < maxTinySize (16) is tiny; scan and heapBitsInSpan
 *     (size <= 512, runtime/mbitmap.go) has no header; other scan objects get
 *     an 8-byte malloc header added *before* the size-class lookup
 *     (mallocgcSmallScanHeader); the rest is large.
 *   - lookup: SizeToSizeClass8[divRoundUp(size, 8)] for size <= 1016, else
 *     SizeToSizeClass128[divRoundUp(size-1024, 128)] in unsigned arithmetic,
 *     so 1017..1024 wrap to index 0. Both tables are rebuilt here the way
 *     _mkmalloc/mksizeclasses.go builds them from SizeClassToSize
 *     (internal/runtime/gc/sizeclasses.go), and give identical entries.
 *   - slots per span: runtime/mheap.go initSpan with GreenTeaGC (on by
 *     default): reserve sizeof(spanInlineMarkBits) = 128 bytes when
 *     16 <= elemsize <= 512 (gcUsesSpanInlineMarkBits), plus nbytes/8/8 bytes
 *     of heap bits for scan spans with elemsize <= 512; nelems =
 *     (nbytes - reserve) / elemsize.
 *   - large objects: mcache.allocLarge rounds up to whole 8 KiB pages.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace)";

  var SIZE = [0, 8, 16, 24, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240, 256, 288, 320, 352,
    384, 416, 448, 480, 512, 576, 640, 704, 768, 896, 1024, 1152, 1280, 1408, 1536, 1792, 2048, 2304, 2688, 3072,
    3200, 3456, 4096, 4864, 5376, 6144, 6528, 6784, 6912, 8192, 9472, 9728, 10240, 10880, 12288, 13568, 14336,
    16384, 18432, 19072, 20480, 21760, 24576, 27264, 28672, 32768];
  var NPAGES = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 2, 1, 2, 1, 2, 1, 3, 2, 3, 1, 3, 2, 3, 4, 5, 6, 1, 7, 6, 5, 4, 3, 5, 7, 2, 9, 7, 5, 8, 3, 10, 7, 4];
  var PAGE = 8192, HDR = 8, TINY = 16, SMALLMAX = 32768 - HDR, NOHDR = 512;

  // mksizeclasses.go: each table entry is the class of the largest size in its bucket.
  function classFor(n) { for (var c = 1; c < SIZE.length; c++) if (SIZE[c] >= n) return c; return -1; }
  var T8 = [], T128 = [];
  for (var i = 0; i <= 1024 / 8; i++) T8.push(i === 0 ? 0 : classFor(i * 8));
  for (var j = 0; j <= (32768 - 1024) / 128; j++) T128.push(classFor(1024 + j * 128));

  function lookup(n) {
    if (n <= 1024 - 8) { var a = Math.ceil(n / 8); return { table: "SizeToSizeClass8", idx: a, cls: T8[a], expr: "⌈" + n + "/8⌉" }; }
    var b = n <= 1024 ? 0 : Math.ceil((n - 1024) / 128);
    return { table: "SizeToSizeClass128", idx: b, cls: T128[b], expr: "⌈(" + n + "−1024)/128⌉", wrap: n < 1024 };
  }

  function plan(n, scan) {
    if (n === 0) return { path: "zero" };
    if (n > SMALLMAX) {
      var np = Math.ceil(n / PAGE);
      return { path: "large", npages: np, elem: np * PAGE, nbytes: np * PAGE, nelems: 1, reserve: 0 };
    }
    var path = !scan ? (n < TINY ? "tiny" : "noscan") : (n <= NOHDR ? "scan" : "header");
    var req = path === "header" ? n + HDR : n;
    var lk = lookup(path === "tiny" ? TINY : req), c = lk.cls, s = SIZE[c], nb = NPAGES[c] * PAGE;
    var spanScan = path === "scan" || path === "header";
    var inline = s >= 16 && s <= NOHDR ? 128 : 0, bits = spanScan && s <= NOHDR ? nb / 8 / 8 : 0;
    return { path: path, req: req, lk: lk, cls: c, elem: s, npages: NPAGES[c], nbytes: nb, inline: inline, bits: bits,
      reserve: inline + bits, nelems: Math.floor((nb - inline - bits) / s), table: Math.floor(nb / s) };
  }

  var PATHS = [
    { id: "zero", t: L("零大小", "zero-size"), c: L("0 字节", "0 B") },
    { id: "tiny", t: L("微对象", "tiny"), c: L("无指针，< 16 字节", "noscan, < 16 B") },
    { id: "noscan", t: L("小对象，无指针", "small, noscan"), c: L("16 至 32760 字节", "16 B to 32760 B") },
    { id: "scan", t: L("小对象，含指针", "small, scan"), c: L("≤ 512 字节", "≤ 512 B") },
    { id: "header", t: L("含指针，带分配头", "scan, with header"), c: L("513 至 32760 字节", "513 B to 32760 B") },
    { id: "large", t: L("大对象", "large"), c: L("> 32760 字节", "> 32760 B") },
  ];
  var FN = { zero: "&zerobase", tiny: "mallocgcTiny", noscan: "mallocgcSmallNoscan", scan: "mallocgcSmallScanNoHeader",
    header: "mallocgcSmallScanHeader", large: "mallocgcLarge" };
  var PRESETS = [1, 12, 33, 100, 512, 513, 1020, 1025, 5000, 32760, 32761, 33000, 0];

  function B(n) { return L(n + " 字节", n + (n === 1 ? " byte" : " bytes")); }
  function pct(a, b) { return (100 * a / b).toFixed(1) + "%"; }
  function tw(s, fs) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? fs : fs * 0.56; return w; }
  function twMono(s, fs) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? fs : fs * 0.62; return w; }

  V.register("alloc-sizeclass", function (host) {
    var p = V.panel(host, { title: L("一次堆分配：路径、尺寸类与浪费", "One heap allocation: path, size class and waste") });
    var root = V.svg("svg", { viewBox: "0 0 720 310", role: "img",
      "aria-label": L("请求大小如何映射到分配路径、尺寸类与 span", "How a request size maps to an allocation path, a size class and a span") }, p.stage);
    var g = V.svg("g", null, root);
    var n = 33, scan = false;

    function clear() { while (g.firstChild) g.removeChild(g.firstChild); }
    function text(x, y, s, st, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: st || "font-size:12px", text: s }, g);
    }
    function box(x, y, w, h, color, op, extra) {
      return V.svg("rect", { x: x, y: y, width: Math.max(w, 0), height: h, rx: 3,
        style: "fill:" + color + ";fill-opacity:" + op + ";stroke:" + color + ";stroke-width:1" + (extra || "") }, g);
    }
    // A label for a bar segment: centred inside if it fits, otherwise placed beside or omitted.
    function seglabel(x, w, y, s, color) {
      if (tw(s, 11) + 8 <= w) text(x + w / 2, y, s, "font-size:11px;fill:" + (color || "var(--viz-ink)"), "middle");
    }

    var X0 = 8, W = 704;
    function pageTicks(np, pw, y, h) {
      for (var i = 1; i < np; i++) {
        V.svg("line", { x1: X0 + i * pw, y1: y - 4, x2: X0 + i * pw, y2: y + 6, style: "stroke:var(--viz-muted);stroke-width:1.2" }, g);
        V.svg("line", { x1: X0 + i * pw, y1: y + h - 6, x2: X0 + i * pw, y2: y + h + 4, style: "stroke:var(--viz-muted);stroke-width:1.2" }, g);
      }
    }
    function drawChips(pl) {
      var cw = (W - 5 * 6) / 6;
      PATHS.forEach(function (q, k) {
        var x = X0 + k * (cw + 6), on = q.id === pl.path, col = on ? "var(--viz-c1)" : "var(--viz-line)";
        V.svg("rect", { x: x, y: 6, width: cw, height: 40, rx: 5,
          style: "fill:" + (on ? "var(--viz-c1)" : "var(--viz-fill)") + ";fill-opacity:" + (on ? 0.14 : 1) +
            ";stroke:" + col + ";stroke-width:" + (on ? 2 : 1) }, g);
        text(x + cw / 2, 23, q.t, "font-size:11.5px;font-weight:" + (on ? 700 : 500) + (on ? "" : ";fill:var(--viz-muted)"), "middle");
        text(x + cw / 2, 38, q.c, "font-size:10px;fill:var(--viz-muted)", "middle");
      });
    }

    function drawLookup(pl) {
      var y = 68, s;
      text(X0, y, FN[pl.path], "font-size:12px;font-weight:600;" + MONO);
      if (pl.path === "zero") s = L("不分配内存，所有零大小的值共用同一个地址", "allocates nothing; every zero-sized value shares one address");
      else if (pl.path === "large") s = "⌈" + n + "/8192⌉ = " + pl.npages + L(" 页，独占一个 span", (pl.npages === 1 ? " page" : " pages") + ", a span of its own");
      else if (pl.path === "tiny") s = L("并入一个 16 字节的块，块本身取自 2 号尺寸类", "packed into a 16-byte block taken from size class 2");
      else {
        var lk = pl.lk;
        s = (pl.path === "header" ? n + " + 8 = " + pl.req + "  →  " : "") + lk.table + "[" + lk.expr + " = " + lk.idx + "] = " +
          L(pl.cls + " 号类", "class " + pl.cls) + "  →  " + B(pl.elem);
      }
      text(X0, y + 18, s, "font-size:12px;" + (pl.path === "zero" || pl.path === "tiny" ? "fill:var(--viz-muted)" : MONO));
      if (pl.lk && pl.lk.wrap) text(X0, y + 34, L("n − 1024 为负，在无符号运算中回绕，向上取整得到下标 0，即 1024 字节的 32 号类。",
        "n − 1024 is negative and wraps in unsigned arithmetic; rounding up gives index 0, the 1024-byte class 32."), "font-size:11px;fill:var(--viz-muted)");
    }

    // Upper bar: one slot (or the pages of a large object, or the tiny block).
    function drawSlot(pl) {
      var y = 138, h = 26;
      var head = pl.path === "large" ? L("对象占用的页", "Pages taken by the object")
        : pl.path === "tiny" ? L("一个 16 字节的块", "One 16-byte block") : L("一个槽位", "One slot");
      text(X0, y - 8, head, "font-size:12px;font-weight:600");
      if (pl.path === "zero") { text(X0, y + 18, L("（无）", "(none)"), "font-size:12px;fill:var(--viz-muted)"); return; }
      var total = pl.path === "tiny" ? TINY : pl.elem, k = W / total, x = X0;
      var parts = [];
      if (pl.path === "header") parts.push({ b: HDR, c: "var(--viz-c4)", s: L("分配头 8", "header 8") });
      parts.push({ b: n, c: "var(--viz-c1)", s: L("对象 ", "object ") + n });
      var rest = total - n - (pl.path === "header" ? HDR : 0);
      if (rest > 0) parts.push(pl.path === "tiny"
        ? { b: rest, c: "var(--viz-c3)", s: L("留给后续微对象 ", "free for later tiny objects ") + rest, dash: true }
        : { b: rest, c: "var(--viz-c2)", s: L("取整浪费 ", "round-up waste ") + rest });
      parts.forEach(function (q) {
        var w = q.b * k;
        box(x, y, w, h, q.c, q.dash ? 0.06 : 0.2, q.dash ? ";stroke-dasharray:4 3" : "");
        seglabel(x, w, y + 17, q.s);
        x += w;
      });
      if (pl.path === "large") pageTicks(pl.npages, PAGE * k, y, h);
      // caption under the bar
      var cap;
      if (pl.path === "tiny") cap = L("块中已用的部分之后还能放入别的微对象，块内对象全部不可达后整块才被回收（12.6）。",
        "Later tiny objects fill the rest; the block is freed only when all objects in it are unreachable (12.6).");
      else {
        var waste = total - n;
        if (waste === 0) cap = L("槽位 " + total + " 字节，与请求的大小相同，没有取整浪费。", "slot " + total + " bytes, the same as the request: no round-up waste.");
        else cap = (pl.path === "large" ? L("共 " + pl.npages + " 页 " + total + " 字节，", pl.npages + (pl.npages === 1 ? " page" : " pages") + ", " + total + " bytes; ")
          : L("槽位 " + total + " 字节，", "slot " + total + " bytes; ")) +
          L("为这次请求多占 " + waste + " 字节（" + pct(waste, total) + "）" + (pl.path === "header" ? "，其中 8 字节是分配头。" : "。"),
            waste + " bytes beyond the request (" + pct(waste, total) + ")" + (pl.path === "header" ? ", 8 of them the header." : "."));
      }
      text(X0, y + h + 17, cap, "font-size:11.5px;fill:var(--viz-muted)");
    }

    // Lower bar: the whole span.
    function drawSpan(pl) {
      var y = 226, h = 26;
      if (pl.path === "zero") return;
      var head = pl.path === "large" ? L("span：" + pl.npages + " 页，1 个对象", "Span: " + pl.npages + (pl.npages === 1 ? " page" : " pages") + ", 1 object")
        : L("span：" + pl.npages + " 页（" + pl.nbytes + " 字节），" + pl.nelems + " 个槽位",
          "Span: " + pl.npages + (pl.npages === 1 ? " page" : " pages") + " (" + pl.nbytes + " bytes), " + pl.nelems + " slots");
      text(X0, y - 8, head + (pl.path === "tiny" ? L("（2 号类，无指针）", " (class 2, noscan)") : ""), "font-size:12px;font-weight:600");
      var k = W / pl.nbytes, used = pl.nelems * pl.elem, tail = pl.nbytes - used - pl.reserve;
      // slots
      box(X0, y, used * k, h, "var(--viz-c1)", pl.path === "large" ? 0.25 : 0.12);
      var sw = pl.elem * k;
      if (sw >= 3) for (var i = 1; i < pl.nelems; i++)
        V.svg("line", { x1: X0 + i * sw, y1: y, x2: X0 + i * sw, y2: y + h, style: "stroke:var(--viz-c1);stroke-opacity:.45;stroke-width:" + (sw >= 8 ? 1 : 0.5) }, g);
      if (pl.path === "large") pageTicks(pl.npages, PAGE * k, y, h);
      else box(X0, y, sw, h, "var(--viz-c1)", 0.35);
      var x = X0 + used * k;
      if (tail > 0) { box(x, y, tail * k, h, "var(--viz-c2)", 0.22); x += tail * k; }
      if (pl.inline) { box(x, y, pl.inline * k, h, "var(--viz-c4)", 0.25); x += pl.inline * k; }
      if (pl.bits) { box(x, y, pl.bits * k, h, "var(--viz-c4)", 0.45); x += pl.bits * k; }
      // legend line under the span
      var items = [[ "var(--viz-c1)", 0.3, pl.path === "large" ? L("对象所在的页", "object pages") : L("槽位（第一个加深）", "slots (first one darker)") ]];
      if (tail > 0) items.push(["var(--viz-c2)", 0.22, L("尾部浪费 " + tail, "tail waste " + tail)]);
      if (pl.inline) items.push(["var(--viz-c4)", 0.25, L("内联标记位 128", "inline mark bits 128")]);
      if (pl.bits) items.push(["var(--viz-c4)", 0.45, L("堆位图 " + pl.bits, "heap bits " + pl.bits)]);
      var lx = X0;
      items.forEach(function (it) {
        box(lx, y + h + 8, 11, 11, it[0], it[1]);
        text(lx + 16, y + h + 18, it[2], "font-size:11px;fill:var(--viz-muted)");
        lx += 16 + tw(it[2], 11) + 18;
      });
      if (pl.path !== "large") {
        var line = pl.table === pl.nelems
          ? L("与 12.1.3 表中的对象数相同：span 末尾没有预留。", "Same as the object count in the table of 12.1.3: nothing is reserved.")
          : L("12.1.3 表中按整个 span 计为 " + pl.table + " 个；Go 1.26 在末尾预留 " + pl.reserve + " 字节，实际 " + pl.nelems + " 个。",
            "The table in 12.1.3 counts " + pl.table + " over the whole span; Go 1.26 reserves " + pl.reserve + " bytes at the end, leaving " + pl.nelems + ".");
        text(X0, y + h + 40, line, "font-size:11.5px;fill:var(--viz-muted)");
      }
    }

    function narrate(pl) {
      var what = scan ? L("含指针", "with pointers") : L("不含指针", "without pointers"), s;
      if (pl.path === "zero") s = L("大小为 0 的请求直接返回 zerobase 的地址，含不含指针都一样。",
        "A zero-sized request returns the address of zerobase, with or without pointers.");
      else if (pl.path === "tiny") s = L(n + " 字节、不含指针，小于 16 字节，交给微对象分配器：几个这样的对象合用一个 16 字节的块。",
        n + " bytes without pointers is under 16 bytes, so it goes to the tiny allocator: several such objects share one 16-byte block.");
      else if (pl.path === "large") s = L(n + " 字节超过 32760，" + (scan ? "虽含指针也不加分配头（类型记在 span 上），" : "") + "按整页分配 " + pl.npages + " 页，多占 " + (pl.elem - n) + " 字节。",
        n + " bytes is over 32760, so it is " + (scan ? "allocated without a header (the type is kept in the span) and " : "") + "rounded up to " + pl.npages + (pl.npages === 1 ? " page" : " pages") + ", " + (pl.elem - n) + " bytes more than asked.");
      else {
        var lead = pl.path === "header" ? L(n + " 字节、含指针，超过 512 字节，先加 8 字节的分配头，按 " + pl.req + " 字节查表，",
          n + " bytes with pointers is over 512, so an 8-byte header is added and " + pl.req + " bytes is looked up: ")
          : L(n + " 字节、" + what + "，", n + " bytes " + what + ": ");
        var w = pl.elem - n;
        s = lead + L("落入 " + pl.cls + " 号类（" + pl.elem + " 字节），" + (w ? "多占 " + w + " 字节。" : "恰好填满槽位。"),
          "class " + pl.cls + " (" + pl.elem + " bytes), " + (w ? w + " bytes more than asked." : "which it fills exactly."));
        if (pl.path === "scan") s += L("指针信息记在 span 末尾的堆位图中。", " Its pointer bits live in the heap bitmap at the end of the span.");
        if (pl.path === "header") {
          var alt = plan(n, false);
          s += alt.cls !== pl.cls
            ? L("同样大小的对象若不含指针，只需 " + alt.elem + " 字节的 " + alt.cls + " 号类：分配头使它升入更大的尺寸类。",
              " Without pointers the same size would take class " + alt.cls + " (" + alt.elem + " bytes): the header pushed it up a class.")
            : L("分配头没有改变它的尺寸类。", " The header does not change its size class.");
        }
      }
      p.note.textContent = s;
    }

    function draw() {
      clear();
      var pl = plan(n, scan);
      drawChips(pl); drawLookup(pl); drawSlot(pl); drawSpan(pl); narrate(pl);
      if (+input.value !== n) input.value = n;
    }

    // controls: a number field, a pointer toggle and presets
    // .viz-slider text uses a fixed colour that is too dark on the dark theme; follow the ink instead.
    var lab = V.el("label", { class: "viz-slider", style: "color:var(--viz-ink)" }, p.bar);
    V.el("span", { text: L("请求大小（字节）", "Request size (bytes)") }, lab);
    var input = V.el("input", { class: "viz-select", type: "number", min: 0, max: 100000, step: 1, value: n,
      style: "width:6.5em", "aria-label": L("请求大小（字节）", "Request size (bytes)") }, lab);
    input.addEventListener("input", function () {
      var v = Math.floor(+input.value);
      if (!isFinite(v) || v < 0) return;
      n = Math.min(v, 100000); draw();
    });
    // The state is in the label too: the dark theme's button style hides .is-on.
    var ptrBtn = V.button(p.bar, "", function () { scan = !scan; ptrLabel(); draw(); });
    function ptrLabel() {
      ptrBtn.textContent = scan ? L("含指针：是", "Pointers: yes") : L("含指针：否", "Pointers: no");
      ptrBtn.classList.toggle("is-on", scan); ptrBtn.setAttribute("aria-pressed", String(scan));
    }
    ptrLabel();
    var pre = V.select(p.bar, L("示例", "Examples"), [{ value: "", label: L("请选择", "pick one") }].concat(PRESETS.map(function (v) {
      return { value: String(v), label: String(v) };
    })), "", function (v) { if (v !== "") { n = +v; draw(); } pre.value = ""; });
    pre.parentNode.style.color = "var(--viz-ink)";

    draw();
  });
})();
