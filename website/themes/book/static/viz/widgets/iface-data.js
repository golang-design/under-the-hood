/*
 * iface-data: where the data word of an interface value points, and when
 * converting a value to an interface allocates (book §4.2.1).
 *
 * The checks run in the order of Go 1.26's compiler and runtime:
 *
 *   cmd/compile/internal/walk/convert.go  dataWord:
 *     1. types.IsDirectIface (pointer-shaped): the value is the data word;
 *     2. zero size: &zerobase;
 *     3. bool or single-byte integer: &staticuint64s[v];
 *     4. a read-only global: constants and static composite literals,
 *        which walk/order.go (addrTemp) has moved to read-only data;
 *     5. the conversion does not escape and the type is <= 1024 bytes:
 *        a stack temporary;
 *     6. otherwise a runtime call chosen by dataWordFuncName.
 *   runtime/iface.go  convT16/32/64: &staticuint64s[v] if v < 256, else
 *     mallocgc; convTstring: &zeroVal for "", else mallocgc(16);
 *     convTslice: &zeroVal for a nil backing array, else mallocgc(24);
 *     convT / convTnoptr: always mallocgc(size).
 *
 * Every preset was checked with Go 1.26.10: testing.AllocsPerRun for both
 * the escaping (sink = x) and non-escaping (use(x)) form, and the
 * -gcflags=-d=escapedebug=1 "convert:" diagnostics for steps 2 to 5.
 * The type word (a *_type for any, an *itab for a non-empty interface) is
 * a constant address in both forms.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace)";

  // kind: ptr | zero | byte | const | int | float | string | slice | struct
  var PRESETS = [
    { id: "ptr", type: "*T", kind: "ptr", size: 8, decl: "p := &T{1, 2}", v: "p" },
    { id: "nilptr", type: "*T", kind: "ptr", nil: true, size: 8, decl: "var p *T", c: ["nil", "nil"], v: "p" },
    { id: "empty", type: "struct{}", kind: "zero", size: 0, decl: "var e struct{}", v: "e" },
    { id: "byte", type: "byte", kind: "byte", size: 1, val: 210, decl: "b := readByte()", c: ["运行时得到 210", "210 at run time"], v: "b" },
    { id: "const", type: "int", kind: "const", size: 8, decl: null, v: "7000" },
    { id: "int7", type: "int", kind: "int", size: 8, val: 7, decl: "n := readInt()", c: ["运行时得到 7", "7 at run time"], v: "n" },
    { id: "int7000", type: "int", kind: "int", size: 8, val: 7000, decl: "n := readInt()", c: ["运行时得到 7000", "7000 at run time"], v: "n" },
    { id: "float", type: "float64", kind: "float", size: 8, val: 7, decl: "x := readFloat()", c: ["运行时得到 7.0", "7.0 at run time"], v: "x" },
    { id: "str", type: "string", kind: "string", size: 16, val: "go", decl: "s := readString()", c: ["运行时得到 \"go\"", "\"go\" at run time"], v: "s" },
    { id: "estr", type: "string", kind: "string", size: 16, val: "", decl: "s := readString()", c: ["运行时得到 \"\"", "\"\" at run time"], v: "s" },
    { id: "nilslice", type: "[]int", kind: "slice", size: 24, nil: true, decl: "xs := readInts()", c: ["运行时得到 nil", "nil at run time"], v: "xs" },
    { id: "point", type: "Point", kind: "struct", size: 16, decl: "pt := Point{x, y}", c: ["x、y 是运行时的 float64", "x, y: float64s known at run time"], v: "pt" },
    { id: "arr", type: "[200]int", kind: "struct", size: 1600, decl: "var a [200]int", c: ["1600 字节", "1600 bytes"], v: "a" },
  ];

  // Run the checks. Returns the rows with their outcome and the target.
  function decide(pr, esc) {
    var rows = [], tgt = null, alloc = 0;
    function row(q, yes, why) { rows.push({ q: q, yes: yes, why: why }); return yes; }
    if (row(L("指针形状的类型？", "Pointer-shaped type?"), pr.kind === "ptr")) {
      tgt = pr.nil ? { at: "nil" } : { at: "heapobj" }; return { rows: rows, tgt: tgt, alloc: 0 };
    }
    if (row(L("大小为 0？", "Size 0?"), pr.size === 0)) { tgt = { at: "zerobase" }; return { rows: rows, tgt: tgt, alloc: 0 }; }
    if (row(L("bool 或单字节整数？", "bool or one-byte integer?"), pr.kind === "byte")) {
      tgt = { at: "static", idx: pr.val }; return { rows: rows, tgt: tgt, alloc: 0 };
    }
    if (row(L("常量或静态字面量？", "Constant or static literal?"), pr.kind === "const")) {
      tgt = { at: "stmp" }; return { rows: rows, tgt: tgt, alloc: 0 };
    }
    if (row(L("不逃逸，且不超过 1024 字节？", "Does not escape, ≤ 1024 bytes?"), !esc && pr.size <= 1024,
      esc ? "esc" : pr.size > 1024 ? "big" : null)) {
      tgt = { at: "stack" }; return { rows: rows, tgt: tgt, alloc: 0 };
    }
    // runtime call
    var fn, q, yes;
    if (pr.kind === "int" || pr.kind === "float") {
      fn = "convT64"; var bits = pr.kind === "float" ? 0x401c000000000000 : pr.val;
      q = pr.kind === "float" ? L("convT64：位模式 < 256？", "convT64: bit pattern < 256?") : L("convT64：值 < 256？", "convT64: value < 256?");
      yes = bits < 256;
      tgt = yes ? { at: "static", idx: pr.val } : { at: "heap", n: 8 };
    } else if (pr.kind === "string") {
      fn = "convTstring"; q = L("convTstring：空字符串？", "convTstring: empty string?"); yes = pr.val === "";
      tgt = yes ? { at: "zeroval" } : { at: "heap", n: 16 };
    } else if (pr.kind === "slice") {
      fn = "convTslice"; q = L("convTslice：底层数组为 nil？", "convTslice: nil backing array?"); yes = !!pr.nil;
      tgt = yes ? { at: "zeroval" } : { at: "heap", n: 24 };
    } else {
      fn = "convTnoptr"; q = L("convTnoptr：总是分配", "convTnoptr: always allocates"); yes = false;
      tgt = { at: "heap", n: pr.size };
    }
    rows.push({ q: q, yes: yes, rt: true, fn: fn });
    if (tgt.at === "heap") alloc = 1;
    return { rows: rows, tgt: tgt, alloc: alloc, fn: fn };
  }

  V.register("iface-data", function (host) {
    var p = V.panel(host, { title: L("接口值的数据字：指向哪里，何时分配", "The data word of an interface value: where it points, when it allocates") });
    var root = V.svg("svg", { viewBox: "0 0 720 314", role: "img",
      "aria-label": L("把一个值赋给 any 时，编译器依次检查的条件，以及两个字分别指向的内存", "The checks made when a value is converted to any, and the memory each word points to") }, p.stage);
    var defs = V.svg("defs", null, root);
    ["c1", "muted"].forEach(function (c) {
      var m = V.svg("marker", { id: "ifd-arrow-" + c, viewBox: "0 0 10 10", refX: 9, refY: 5,
        markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
      V.svg("path", { d: "M0,0 L10,5 L0,10 z", style: "fill:var(--viz-" + c + ")" }, m);
    });
    var g = V.svg("g", null, root);
    var pr = PRESETS[6], esc = true;

    function txt(x, y, s, style, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: style || "", text: s }, g);
    }
    function box(x, y, w, h, opt) {
      opt = opt || {};
      return V.svg("rect", { x: x, y: y, width: w, height: h, rx: opt.rx == null ? 5 : opt.rx,
        style: "fill:" + (opt.fill || "var(--viz-fill)") + ";fill-opacity:" + (opt.fop == null ? 1 : opt.fop) +
          ";stroke:" + (opt.stroke || "var(--viz-line)") + ";stroke-width:" + (opt.sw || 1) + (opt.dash ? ";stroke-dasharray:" + opt.dash : "") }, g);
    }
    function arrow(x1, y1, x2, y2, c, bend) {
      var mx = (x1 + x2) / 2 + (bend || 0), my = (y1 + y2) / 2;
      V.svg("path", { d: "M" + x1 + "," + y1 + " Q" + mx + "," + my + " " + x2 + "," + y2, "marker-end": "url(#ifd-arrow-" + c + ")",
        style: "fill:none;stroke:var(--viz-" + c + ");stroke-width:" + (c === "c1" ? 1.8 : 1.2) }, g);
    }

    function draw() {
      while (g.firstChild) g.removeChild(g.firstChild);
      var d = decide(pr, esc);
      // code
      var use = esc ? "sink = " + pr.v : "use(" + pr.v + ")";
      var cm = esc ? L("// sink 是 any 类型的包级变量：结果逃逸", "// sink is a package-level any: the result escapes")
        : L("// use 只读取参数，不保留它：结果不逃逸", "// use reads its argument but keeps nothing: no escape");
      var decl = pr.decl;
      if (decl) {
        txt(8, 18, decl, "font-size:12.5px;" + MONO);
        if (pr.c) txt(8 + (decl.length + 2) * 7.6, 18, "// " + L(pr.c[0], pr.c[1]), "font-size:12.5px;fill:var(--viz-muted);" + MONO);
      }
      txt(8, decl ? 36 : 18, use, "font-size:12.5px;" + MONO);
      txt(8 + (use.length + 2) * 7.6, decl ? 36 : 18, cm, "font-size:12.5px;fill:var(--viz-muted);" + MONO);

      // decision ladder
      var y0 = 72, rh = 34;
      txt(8, y0 - 8, L("编译器与运行时依次检查", "Checks, in order"), "font-size:12px;font-weight:600");
      var all = [L("指针形状的类型？", "Pointer-shaped type?"), L("大小为 0？", "Size 0?"), L("bool 或单字节整数？", "bool or one-byte integer?"),
        L("常量或静态字面量？", "Constant or static literal?"), L("不逃逸，且不超过 1024 字节？", "Does not escape, ≤ 1024 bytes?"), L("调用运行时函数", "Call the runtime")];
      for (var i = 0; i < 6; i++) {
        var r = d.rows[i], y = y0 + i * rh, last = r && i === d.rows.length - 1;
        var c = !r ? "var(--viz-line)" : last ? (d.alloc ? "var(--viz-c2)" : "var(--viz-c3)") : "var(--viz-muted)";
        box(8, y, 330, rh - 6, { fill: last ? c : "var(--viz-fill)", fop: last ? 0.12 : 1, stroke: c, sw: last ? 1.6 : 1 });
        txt(18, y + 18, (i + 1) + ". " + (r ? r.q : all[i]), "font-size:12px;" + (r ? "" : "fill:var(--viz-muted);opacity:.55") + (r && r.rt ? ";" + MONO + ";font-size:11.5px" : ""));
        if (r) {
          var ans = r.rt ? (r.fn === "convTnoptr" ? L("分配", "allocate") : r.yes ? L("是", "yes") : L("否，分配", "no: allocate"))
            : r.yes ? L("是", "yes") : r.why === "esc" ? L("否，逃逸", "no, escapes") : r.why === "big" ? L("否，太大", "no, too big") : L("否", "no");
          txt(330, y + 18, ans, "font-size:11.5px;font-weight:" + (last ? 700 : 400) + ";fill:" + (last ? c : "var(--viz-muted)"), "end");
        }
      }

      // the interface value: two stacked words
      var ex = 372, ew = 92, ty = 112, wh = 38;
      txt(ex, ty - 10, L("any 值（两个字）", "The any value"), "font-size:12px;font-weight:600");
      [["type", L("类型字", "type word"), "_type"], ["data", L("数据字", "data word"), d.tgt.at === "nil" ? "nil" : "data"]].forEach(function (w, i) {
        var yy = ty + i * wh, isNil = w[0] === "data" && d.tgt.at === "nil";
        box(ex, yy, ew, wh, { rx: 3, stroke: "var(--viz-ink)", fill: isNil ? "var(--viz-c2)" : "var(--viz-fill)", fop: isNil ? 0.12 : 1 });
        txt(ex + ew / 2, yy + 15, w[1], "font-size:10.5px;fill:var(--viz-muted)", "middle");
        txt(ex + ew / 2, yy + 31, w[2], "font-size:12.5px;" + MONO + (isNil ? ";fill:var(--viz-c2);font-weight:700" : ""), "middle");
      });

      // memory regions, stacked on the right
      var RX = 500, RW = 212, T = {};
      function region(y, h, label) {
        box(RX, y, RW, h, { fill: "var(--viz-c4)", fop: 0.04, stroke: "var(--viz-line)", dash: "4 3" });
        txt(RX + 8, y + 14, label, "font-size:11px;fill:var(--viz-muted)");
      }
      function item(key, y, label, sub, hotColor) {
        var hot = d.tgt.at === key || (key === "heap" && d.tgt.at === "heapobj"), c = hotColor || "var(--viz-c1)";
        box(RX + 8, y, RW - 16, 22, { rx: 4, fill: hot ? c : "var(--viz-fill)", fop: hot ? 0.14 : 1, stroke: hot ? c : "var(--viz-line)", sw: hot ? 1.8 : 1 });
        txt(RX + 15, y + 15, label, "font-size:11px;" + MONO + (hot ? ";font-weight:700" : ""));
        if (sub) txt(RX + RW - 15, y + 15, sub, "font-size:9.5px;fill:var(--viz-muted)", "end");
        T[key] = { x: RX + 8, y: y + 11 };
      }
      region(58, 158, L("只读数据（随可执行文件加载）", "Read-only data (part of the binary)"));
      item("desc", 80, L("类型描述符 ", "descriptor ") + pr.type, null);
      item("static", 106, d.tgt.at === "static" ? "staticuint64s[" + d.tgt.idx + "]" : "staticuint64s", L("预置 0–255", "preset 0–255"));
      item("zeroval", 132, "zeroVal", L("全零字节", "all-zero bytes"));
      item("zerobase", 158, "zerobase", L("零大小的值", "zero-size values"));
      item("stmp", 184, ".stmp", L("只读的常量副本", "read-only constant"));
      region(222, 34, "");
      var stHot = d.tgt.at === "stack";
      item("stack", 228, L("栈：", "stack: ") + (stHot ? L("临时变量 " + pr.size + " 字节", pr.size + "-byte temporary") : L("未使用", "unused")), null);
      region(262, 34, "");
      var hl = d.tgt.at === "heap" ? L("堆：新分配 " + d.tgt.n + " 字节", "heap: " + d.tgt.n + " new bytes")
        : d.tgt.at === "heapobj" ? L("堆：p 指向的 T 对象", "heap: the T that p points to") : L("堆：未使用", "heap: unused");
      item("heap", 268, hl, d.tgt.at === "heap" ? "mallocgc" : null, d.tgt.at === "heap" ? "var(--viz-c2)" : null);

      // arrows: type word to its descriptor, data word to its target
      function link(y1, to, c) {
        var x1 = ex + ew, x2 = to.x - 2, mx = (x1 + x2) / 2;
        V.svg("path", { d: "M" + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + to.y + " " + x2 + "," + to.y,
          "marker-end": "url(#ifd-arrow-" + c + ")", style: "fill:none;stroke:var(--viz-" + c + ");stroke-width:" + (c === "c1" ? 1.8 : 1.2) }, g);
      }
      link(ty + wh / 2, T.desc, "muted");
      if (d.tgt.at !== "nil") link(ty + wh * 1.5, T[d.tgt.at === "heapobj" ? "heap" : d.tgt.at], "c1");

      // summary
      var nil = d.tgt.at === "nil";
      txt(8, 306, L("这次转换引起的分配：", "Allocations by the conversion: ") + d.alloc + (d.alloc ? L("（堆上 " + d.tgt.n + " 字节）", " (" + d.tgt.n + " bytes on the heap)") : ""),
        "font-size:12.5px;font-weight:600;fill:" + (d.alloc ? "var(--viz-c2)" : "var(--viz-c3)"));
      txt(372, 306, "any(" + pr.v + ") == nil  →  false", "font-size:12px;" + MONO + (nil ? ";fill:var(--viz-c2);font-weight:700" : ";fill:var(--viz-muted)"));

      narrate(d);
    }

    function narrate(d) {
      var s, v = pr.v, t = pr.type;
      var at = d.tgt.at, last = d.rows.length;
      var lead = last === 2 ? L("第 1 项检查不满足。", "The first check fails. ")
        : last > 2 ? L("前 " + (last - 1) + " 项检查都不满足。", "The first " + (last - 1) + " checks fail. ") : "";
      if (at === "heapobj") s = L(t + " 是指针形状的类型：指针本身就放进数据字，不复制所指的对象，也不分配。",
        t + " is pointer-shaped: the pointer itself goes into the data word; nothing is copied and nothing is allocated.");
      else if (at === "nil") s = L("指针放进数据字，这里它是 nil；但类型字已经指向 *T 的类型描述符，两个字不全为 nil，所以接口值不等于 nil（4.2.2）。",
        "The pointer goes into the data word, and here it is nil. But the type word already points to the descriptor of *T, so not both words are nil and the interface value is not nil (4.2.2).");
      else if (at === "zerobase") s = L(lead + "struct{} 不占内存，数据字指向运行时的变量 zerobase；零大小的分配返回的也是这个地址。",
        lead + "struct{} occupies no memory, so the data word points to the runtime variable zerobase, the same address that zero-size allocations return.");
      else if (at === "static" && pr.kind === "byte") s = L(lead + "单字节的值只有 256 种，数据字直接指向只读数组 staticuint64s 的第 " + pr.val + " 项，不分配。",
        lead + "A one-byte value has only 256 possibilities, so the data word points to element " + pr.val + " of the read-only array staticuint64s; nothing is allocated.");
      else if (at === "stmp") s = L(lead + "7000 是常量，编译器把它作为一个只读的静态变量放进可执行文件，数据字指向它，不分配。",
        lead + "7000 is a constant, so the compiler stores it as a read-only static variable in the binary and the data word points to it; nothing is allocated.");
      else if (at === "stack") s = L(lead + "结果不逃逸，编译器在栈上放一个 " + t + " 类型的临时变量，把值复制进去，数据字指向它，不分配。",
        lead + "The result does not escape, so the compiler copies the value into a stack temporary of type " + t + " and the data word points to it; nothing is allocated.");
      else {
        var why = esc ? L("结果逃逸，不能放在栈上，", "The result escapes and cannot use a stack temporary, ")
          : L("结果虽不逃逸，但 " + pr.size + " 字节超过了栈上临时变量的上限 1024 字节，", "The result does not escape, but " + pr.size + " bytes exceed the 1024-byte limit for a stack temporary, ");
        var call = L("于是调用运行时的 " + d.fn + "。", "so the compiler calls runtime." + d.fn + ". ");
        var tail;
        if (pr.kind === "int") tail = d.alloc ? L(pr.val + " 不小于 256，只好用 mallocgc 分配 8 字节存放它。", pr.val + " is not below 256, so mallocgc allocates 8 bytes to hold it.")
          : L(pr.val + " 小于 256，数据字指向 staticuint64s 的第 " + pr.val + " 项，不分配。", pr.val + " is below 256, so the data word points to element " + pr.val + " of staticuint64s; nothing is allocated.");
        else if (pr.kind === "float") tail = L("它按 8 字节的位模式判断：7.0 的位模式是 0x401C000000000000，远大于 256，所以要分配 8 字节。只有 0.0 等极少数浮点数能用上静态数组。",
          "It tests the 8-byte bit pattern: 7.0 is 0x401C000000000000, far above 256, so 8 bytes are allocated. Only a few floats, such as 0.0, can use the static array.");
        else if (pr.kind === "string") tail = d.alloc ? L("非空字符串要分配 16 字节，存放字符串的头部（指针与长度）；字节本身不复制。", "A non-empty string needs 16 new bytes for its header (pointer and length); the bytes themselves are not copied.")
          : L("空字符串的头部全为零，数据字指向只读的 zeroVal，不分配。", "The header of an empty string is all zeros, so the data word points to the read-only zeroVal; nothing is allocated.");
        else if (pr.kind === "slice") tail = L("nil 切片的头部全为零，数据字指向只读的 zeroVal，不分配。", "A nil slice header is all zeros, so the data word points to the read-only zeroVal; nothing is allocated.");
        else tail = L("它总是用 mallocgc 分配 " + pr.size + " 字节，把值复制过去。", "It always allocates " + pr.size + " bytes with mallocgc and copies the value.");
        s = lead + why + call + tail;
      }
      p.note.textContent = s;
    }

    V.select(p.bar, L("值", "Value"), PRESETS.map(function (q) {
      var lab = q.kind === "const" ? L("常量 7000", "constant 7000")
        : q.id === "nilptr" ? L("*T（nil）", "*T (nil)")
        : q.id === "estr" ? L("string（空串）", "string (empty)")
        : q.id === "nilslice" ? L("[]int（nil）", "[]int (nil)")
        : q.type + (q.val != null ? " " + (q.kind === "float" ? "7.0" : typeof q.val === "string" ? JSON.stringify(q.val) : q.val) : "");
      return { value: q.id, label: lab };
    }), pr.id, function (id) { pr = PRESETS.filter(function (q) { return q.id === id; })[0]; draw(); });
    var escBtn = V.button(p.bar, "", function () { esc = !esc; label(); draw(); });
    function label() {
      escBtn.textContent = esc ? L("改为不逃逸：use(x)", "Make it not escape: use(x)") : L("改为逃逸：sink = x", "Make it escape: sink = x");
    }
    label();
    draw();
  });
})();
