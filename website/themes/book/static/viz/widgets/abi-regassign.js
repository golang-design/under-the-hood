/*
 * abi-regassign: how Go's register ABI (ABIInternal) assigns a function's
 * arguments and results on amd64 (book §2.3).
 *
 * The algorithm follows src/cmd/compile/abi-internal.md step by step:
 *   - each receiver/argument/result is assigned whole, to registers or to the
 *     stack sequence; zero-sized values go to the stack;
 *   - register assignment splits strings (ptr, len), interfaces (2 words),
 *     slices (ptr, len, cap), structs (field by field) and complex numbers
 *     (re, im); integers and pointers take the next integer register, floats
 *     the next float register; an array of length > 1 fails;
 *   - on failure the register indexes are restored, so later values can still
 *     use the registers that were tried;
 *   - results restart at the first register; the stack sequence gets a
 *     pointer-sized alignment after the arguments and after the results;
 *   - finally the caller reserves spill space for every register-assigned
 *     argument (not for results), followed by pointer alignment.
 * With zero registers the same algorithm gives ABI0 (everything on the stack).
 *
 * Every preset was checked against `GOOS=linux GOARCH=amd64 go build
 * -gcflags=-S` with Go 1.26: register use in the function bodies and call
 * sites, and the stack size printed as args=0x.. in the listing header.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var INT = ["AX", "BX", "CX", "DI", "SI", "R8", "R9", "R10", "R11"];
  var NF = 15; // X0 to X14
  var MONO = "font-family:var(--font-mono,monospace)";

  // ---- types (64-bit sizes and alignments, abi-internal.md "Memory layout")
  function al(x, a) { return Math.ceil(x / a) * a; }
  function prim(name, size, k) { return { k: k, name: name, size: size, align: size }; }
  var tInt = prim("int", 8, "int"), tU8 = prim("uint8", 1, "int"), tUptr = prim("uintptr", 8, "int"),
    tBool = prim("bool", 1, "int"), tF64 = prim("float64", 8, "float");
  var tStr = { k: "string", name: "string", size: 16, align: 8 };
  var tBytes = { k: "slice", name: "[]byte", size: 24, align: 8 };
  var tC128 = { k: "complex", name: "complex128", size: 16, align: 8 };
  var tAny = { k: "iface", name: "any", size: 16, align: 8, parts: ["type", "data"] };
  var tErr = { k: "iface", name: "error", size: 16, align: 8, parts: ["tab", "data"] };
  function tPtr(n) { return { k: "ptr", name: "*" + n, size: 8, align: 8 }; }
  function tArr(n, e) { return { k: "array", name: "[" + n + "]" + e.name, n: n, elem: e, size: n * e.size, align: e.align }; }
  function tStruct(name, fields) {
    var off = 0, a = 1;
    fields.forEach(function (f) { off = al(off, f.t.align) + f.t.size; a = Math.max(a, f.t.align); });
    return { k: "struct", name: name, fields: fields, size: al(off, a), align: a };
  }
  var tPoint = tStruct("Point", [{ n: "X", t: tF64 }, { n: "Y", t: tF64 }]);
  var tR1 = tStruct("struct{ x uintptr; y [2]uintptr }", [{ n: "x", t: tUptr }, { n: "y", t: tArr(2, tUptr) }]);
  function P(n, t) { return { n: n, t: t }; }

  var PRESETS = [
    { id: "many", name: "Many", params: "abcdefgh".split("").map(function (c) { return P(c, tInt); }).concat([P("s", tStr), P("t", tInt)]), results: [P("", tInt)] },
    { id: "add", name: "Add", params: [P("a", tInt), P("b", tInt)], results: [P("", tInt)] },
    { id: "mix", name: "Mix", params: [P("s", tStr), P("f", tF64), P("n", tInt)], results: [P("", tInt), P("", tF64)] },
    { id: "write", name: "Write", recv: P("f", tPtr("File")), params: [P("p", tBytes)], results: [P("n", tInt), P("err", tErr)] },
    { id: "dist", name: "Dist", params: [P("p", tPoint), P("q", tPoint)], results: [P("", tF64)] },
    { id: "abs", name: "Abs", params: [P("z", tC128)], results: [P("", tF64)] },
    { id: "arr", name: "Arr", params: [P("a", tArr(2, tInt)), P("b", tInt)], results: [P("", tInt)] },
    { id: "spec", name: "F", params: [P("a1", tU8), P("a2", tArr(2, tUptr)), P("a3", tU8)], results: [P("r1", tR1), P("r2", tStr)] },
  ];
  var ADDABLE = [
    { value: "int", t: tInt }, { value: "bool", t: tBool }, { value: "float64", t: tF64 },
    { value: "string", t: tStr }, { value: "[]byte", t: tBytes }, { value: "any", t: tAny },
    { value: "error", t: tErr }, { value: "Point", t: tPoint }, { value: "[2]int", t: tArr(2, tInt) },
  ];

  // ---- the assignment algorithm ----------------------------------------
  function reg(t, lab, st, out) {
    switch (t.k) {
      case "int": case "ptr":
        if (st.I >= st.NI) { st.why = st.why || "regs"; return false; }
        out.push({ f: "I", i: st.I++, lab: lab }); return true;
      case "float":
        if (st.F >= st.NFP) { st.why = st.why || "regs"; return false; }
        out.push({ f: "F", i: st.F++, lab: lab }); return true;
      case "complex": return reg(tF64, lab + ".re", st, out) && reg(tF64, lab + ".im", st, out);
      case "string": return reg(tUptr, lab + ".ptr", st, out) && reg(tInt, lab + ".len", st, out);
      case "slice": return reg(tUptr, lab + ".ptr", st, out) && reg(tInt, lab + ".len", st, out) && reg(tInt, lab + ".cap", st, out);
      case "iface": return reg(tUptr, lab + "." + t.parts[0], st, out) && reg(tUptr, lab + "." + t.parts[1], st, out);
      case "struct": return t.fields.every(function (f) { return reg(f.t, lab + "." + f.n, st, out); });
      case "array":
        if (t.n === 0) return true;
        if (t.n === 1) return reg(t.elem, lab + "[0]", st, out);
        st.why = "array"; return false;
    }
    return false;
  }
  function need(t) {
    switch (t.k) {
      case "int": case "ptr": return { i: 1, f: 0 };
      case "float": return { i: 0, f: 1 };
      case "complex": return { i: 0, f: 2 };
      case "string": case "iface": return { i: 2, f: 0 };
      case "slice": return { i: 3, f: 0 };
      case "array": return t.n === 1 ? need(t.elem) : { i: 0, f: 0 };
      case "struct": return t.fields.reduce(function (a, f) { var n = need(f.t); return { i: a.i + n.i, f: a.f + n.f }; }, { i: 0, f: 0 });
    }
    return { i: 0, f: 0 };
  }
  function push(S, t, name, role, v) {
    var off = al(S.off, t.align);
    var fld = { off: off, size: t.size, name: name, role: role, v: v };
    S.fields.push(fld); S.off = off + t.size;
    return fld;
  }
  function assign(v, phase, st, S) {
    var I = st.I, F = st.F, out = [];
    st.why = null;
    if (v.t.size === 0) return { kind: "stack", why: "zero", field: push(S, v.t, v.n, phase, v) };
    if (reg(v.t, v.n, st, out)) return { kind: "reg", parts: out };
    st.I = I; st.F = F;
    return { kind: "stack", why: st.NI === 0 ? "abi0" : st.why, tried: out, freeI: st.NI - I, freeF: st.NFP - F,
      field: push(S, v.t, v.n, phase, v) };
  }
  function build(sig, abi0) {
    var st = { I: 0, F: 0, NI: abi0 ? 0 : INT.length, NFP: abi0 ? 0 : NF }, S = { off: 0, fields: [] }, ev = [];
    var vals = (sig.recv ? [sig.recv] : []).concat(sig.params);
    vals.forEach(function (v) { var e = assign(v, "arg", st, S); e.v = v; e.phase = "arg"; ev.push(e); });
    S.off = al(S.off, 8); st.I = 0; st.F = 0;
    ev.push({ kind: "reset", phase: "res" });
    sig.results.forEach(function (r, i) {
      var v = { n: r.n || (i === 0 ? "ret" : "ret" + i), t: r.t };
      var e = assign(v, "res", st, S); e.v = v; e.phase = "res"; ev.push(e);
    });
    S.off = al(S.off, 8);
    var spill = [];
    ev.forEach(function (e) { if (e.phase === "arg" && e.kind === "reg") spill.push(push(S, e.v.t, e.v.n, "spill", e.v)); });
    S.off = al(S.off, 8);
    ev.push({ kind: "spill", phase: "spill", fields: spill, total: S.off });
    // record which event introduced each stack field
    ev.forEach(function (e, k) {
      if (e.field) e.field.ev = k;
      if (e.fields) e.fields.forEach(function (f) { f.ev = k; });
    });
    return { ev: ev, S: S };
  }

  // ---- signature text --------------------------------------------------
  function sigTokens(sig) {
    var toks = [{ s: "func " }];
    if (sig.recv) toks.push({ s: "(" }, { s: sig.recv.n, v: sig.recv }, { s: " " + sig.recv.t.name + ") " });
    toks.push({ s: sig.name + "(" });
    sig.params.forEach(function (p, i) {
      toks.push({ s: p.n, v: p });
      var next = sig.params[i + 1];
      if (next && next.t === p.t) toks.push({ s: ", " });
      else toks.push({ s: " " + p.t.name + (next ? ", " : "") });
    });
    toks.push({ s: ")" });
    var rs = sig.results, named = rs.some(function (r) { return r.n; });
    if (rs.length === 1 && !named) toks.push({ s: " " + rs[0].t.name });
    else if (rs.length) {
      toks.push({ s: " (" });
      rs.forEach(function (r, i) {
        toks.push({ s: (r.n ? r.n + " " : "") + r.t.name + (i < rs.length - 1 ? ", " : ""), res: i });
      });
      toks.push({ s: ")" });
    }
    return toks;
  }

  V.register("abi-regassign", function (host) {
    var p = V.panel(host, { title: L("寄存器 ABI：参数和返回值放在哪里（amd64）", "Register ABI: where arguments and results go (amd64)") });
    var root = V.svg("svg", { viewBox: "0 0 720 392", role: "img",
      "aria-label": L("参数逐个分配到寄存器或栈上", "Arguments assigned one by one to registers or the stack") }, p.stage);
    var gSig = V.svg("g", null, root), gReg = V.svg("g", null, root), gStack = V.svg("g", null, root);

    var preset = PRESETS[0], sig = clone(preset), abi0 = false, plan, k = 0, extra = 0;
    function clone(s) { return { name: s.name, recv: s.recv, params: s.params.slice(), results: s.results.slice() }; }

    function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }
    function txt(g, x, y, s, style, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: style || "", text: s }, g);
    }
    function cur() { return k > 0 ? plan.ev[k - 1] : null; }

    function drawSig() {
      clear(gSig);
      var toks = sigTokens(sig), e = cur(), line = 0, col = 0, maxc = 94, y0 = 20;
      var t = V.svg("text", { x: 8, y: y0, style: "font-size:12px;" + MONO }, gSig);
      toks.forEach(function (tk) {
        if (col + tk.s.length > maxc && col > 0) {
          line++; col = 4;
          t = V.svg("text", { x: 8 + 4 * 7.2, y: y0 + line * 17, style: "font-size:12px;" + MONO }, gSig);
        }
        var hot = e && e.v && (tk.v === e.v || (tk.res != null && e.phase === "res" && plan.ev.indexOf(e) === resIndex(tk.res)));
        V.svg("tspan", { text: tk.s, style: hot ? "fill:var(--viz-c1);font-weight:700" : "" }, t);
        col += tk.s.length;
      });
    }
    function resIndex(i) { // event index of result i
      var n = -1, idx = -1;
      plan.ev.forEach(function (e, j) { if (e.phase === "res" && e.kind !== "reset") { n++; if (n === i) idx = j; } });
      return idx;
    }

    // Register rows: args int / args float / results int / results float.
    var X0 = 96, RY = 56, RH = 32, RG = 8;
    function drawRegs() {
      clear(gReg);
      var occ = { arg: { I: {}, F: {} }, res: { I: {}, F: {} } }, e = cur(), tried = {};
      for (var j = 0; j < k; j++) {
        var ev = plan.ev[j];
        if (ev.kind === "reg") ev.parts.forEach(function (pt) { occ[ev.phase][pt.f][pt.i] = { lab: pt.lab, now: j === k - 1 }; });
      }
      if (e && e.kind === "stack" && e.tried) e.tried.forEach(function (pt) { tried[pt.f + pt.i] = pt.lab; });
      var rows = [
        { ph: "arg", f: "I", lab: L("参数 · 整数", "args · int") },
        { ph: "arg", f: "F", lab: L("参数 · 浮点", "args · float") },
        { ph: "res", f: "I", lab: L("返回值 · 整数", "results · int") },
        { ph: "res", f: "F", lab: L("返回值 · 浮点", "results · float") },
      ];
      rows.forEach(function (r, ri) {
        var y = RY + ri * (RH + RG) + (ri >= 2 ? 6 : 0);
        txt(gReg, 8, y + RH / 2 + 4, r.lab, "font-size:11.5px;fill:var(--viz-muted)");
        var n = r.f === "I" ? INT.length : NF, w = r.f === "I" ? 68 : 40.6, gap = r.f === "I" ? 2 : 0.8;
        for (var i = 0; i < n; i++) {
          var x = X0 + i * (w + gap), o = occ[r.ph][r.f][i];
          var tr = e && e.phase === r.ph && tried[r.f + i];
          var c = o ? (o.now ? "var(--viz-c1)" : "var(--viz-c3)") : tr ? "var(--viz-c2)" : "var(--viz-line)";
          V.svg("rect", { x: x, y: y, width: w, height: RH, rx: 4,
            style: "fill:" + (o || tr ? c : "var(--viz-fill)") + ";fill-opacity:" + (o || tr ? 0.16 : 1) +
              ";stroke:" + c + ";stroke-width:" + (o && o.now ? 2 : 1) + (tr && !o ? ";stroke-dasharray:4 3" : "") + (abi0 ? ";opacity:.45" : "") }, gReg);
          txt(gReg, x + 4, y + 10, r.f === "I" ? INT[i] : "X" + i, "font-size:9px;fill:var(--viz-muted);" + MONO);
          var s = o ? o.lab : tr ? tr : "";
          if (s) {
            var fs = r.f === "I" ? (s.length > 9 ? 9.5 : 11) : (s.length > 5 ? 8.5 : 10.5);
            txt(gReg, x + w / 2, y + 25, s, "font-size:" + fs + "px;" + MONO + (tr && !o ? ";fill:var(--viz-c2);text-decoration:line-through" : ""), "middle");
          }
        }
      });
      if (abi0) txt(gReg, 360, RY + 2 * (RH + RG) + 4.5, L("ABI0 不用寄存器传参，全部放在栈上", "ABI0 passes nothing in registers; everything is on the stack"),
        "font-size:12px;font-weight:600;fill:var(--viz-c2)", "middle");
    }

    function drawStack() {
      clear(gStack);
      var y0 = RY + 4 * (RH + RG) + 22;
      var done = k === plan.ev.length, fields = plan.S.fields.filter(function (f) { return f.ev < k; });
      var total = done ? plan.ev[plan.ev.length - 1].total : null;
      txt(gStack, 8, y0, L("栈上（由调用方准备，偏移从低到高）", "On the stack (prepared by the caller, low to high offsets)"), "font-size:12px;font-weight:600");
      if (total != null) txt(gStack, 712, y0, (abi0 ? L("共 " + total + " 字节（汇编 TEXT 行里写作 $…-" + total + "）", total + " bytes (written $…-" + total + " in an assembly TEXT line)")
        : L("共 " + total + " 字节（-S 输出里的 args=0x" + total.toString(16) + "）", total + " bytes (args=0x" + total.toString(16) + " in -S output)")),
        "font-size:11.5px;fill:var(--viz-muted)", "end");
      // rows, with padding rows for alignment gaps
      var rows = [], end = 0;
      fields.forEach(function (f) {
        if (f.off > end) rows.push({ off: end, size: f.off - end, pad: true });
        rows.push(f); end = f.off + f.size;
      });
      if (done && total > end) rows.push({ off: end, size: total - end, pad: true });
      if (!rows.length) { txt(gStack, 8, y0 + 22, L("（还没有）", "(nothing yet)"), "font-size:11.5px;fill:var(--viz-muted)"); return; }
      var per = 7, e = cur();
      rows.slice(0, 2 * per).forEach(function (r, i) {
        var col = Math.floor(i / per), x = 8 + col * 360, y = y0 + 22 + (i % per) * 18;
        var role = r.pad ? "pad" : r.role;
        var c = role === "spill" ? "var(--viz-c4)" : role === "pad" ? "var(--viz-muted)" : "var(--viz-c2)";
        var now = !r.pad && e && (r.ev === k - 1);
        V.svg("rect", { x: x, y: y - 11, width: 348, height: 15, rx: 3,
          style: "fill:" + c + ";fill-opacity:" + (r.pad ? 0.05 : 0.12) + ";stroke:" + (now ? "var(--viz-c1)" : "none") + ";stroke-width:1.5" }, gStack);
        txt(gStack, x + 6, y, "+" + r.off, "font-size:11px;" + MONO);
        txt(gStack, x + 48, y, r.pad ? L("补齐", "pad") : r.name, "font-size:11px;" + MONO + (r.pad ? ";fill:var(--viz-muted)" : ""));
        txt(gStack, x + 96, y, r.size + L(" 字节", r.size === 1 ? " byte" : " bytes"), "font-size:11px;fill:var(--viz-muted)");
        var tag = role === "arg" ? L("参数，调用方写好", "argument, set by caller")
          : role === "res" ? L("返回值，返回前写入", "result, set before return")
          : role === "spill" ? L("为寄存器参数预留，空着", "reserved for a register arg")
          : role === "pad" ? L("对齐到 8 字节", "align to 8 bytes") : L("零大小", "zero-sized");
        txt(gStack, x + 342, y, tag, "font-size:10.5px;fill:" + (r.pad ? "var(--viz-muted)" : c), "end");
      });
      if (rows.length > 2 * per) txt(gStack, 712, y0 + 22 + per * 18, L("……还有 " + (rows.length - 2 * per) + " 项", "… " + (rows.length - 2 * per) + " more"), "font-size:11px;fill:var(--viz-muted)", "end");
    }

    function regs(parts) {
      return parts.map(function (pt) { return pt.f === "I" ? INT[pt.i] : "X" + pt.i; }).join(L("、", ", "));
    }
    function kindZh(t) {
      return { string: "string，拆成指针和长度", slice: "切片，拆成指针、长度、容量", iface: "接口，拆成两个指针",
        struct: "结构体，按字段拆开", complex: "复数，拆成实部和虚部" }[t.k] || t.name;
    }
    function kindEn(t) {
      return { string: "a string, split into pointer and length", slice: "a slice, split into pointer, length and capacity",
        iface: "an interface, split into two pointers", struct: "a struct, split field by field", complex: "a complex number, split into real and imaginary parts" }[t.k] || "a " + t.name;
    }
    function narrate() {
      var e = cur();
      if (!e) {
        p.note.textContent = L("按「下一步」，按顺序为每个参数和返回值找位置。", "Press Step to place each argument and result in order.");
        return;
      }
      var v = e.v, s;
      if (e.kind === "reg") {
        s = L(v.n + " 是 " + kindZh(v.t) + "，放进 " + regs(e.parts) + "。",
          v.n + " is " + kindEn(v.t) + ": " + regs(e.parts) + ".");
      } else if (e.kind === "stack") {
        var off = "+" + e.field.off;
        if (e.why === "abi0") s = L("ABI0：" + v.n + " 放到栈上偏移 " + off + " 处。", "ABI0: " + v.n + " goes on the stack at offset " + off + ".");
        else if (e.why === "array") s = L(v.n + " 含有长度大于 1 的数组，整个放到栈上（偏移 " + off + "）" + (e.tried.length ? "，刚试着占用的 " + regs(e.tried) + " 退回去" : "") + "。",
          v.n + " contains an array longer than 1, so all of it goes on the stack (offset " + off + ")" + (e.tried.length ? "; the registers it tried (" + regs(e.tried) + ") are given back" : "") + ".");
        else if (e.why === "zero") s = L(v.n + " 大小为 0，放到栈上。", v.n + " has size 0 and goes on the stack.");
        else {
          var nd = need(v.t), what = nd.i > e.freeI ? L(nd.i + " 个整数寄存器，只剩 " + e.freeI + " 个", nd.i + " integer registers, only " + e.freeI + " left")
            : L(nd.f + " 个浮点寄存器，只剩 " + e.freeF + " 个", nd.f + " float registers, only " + e.freeF + " left");
          s = L(v.n + " 需要 " + what + "。它不拆成两半，整个放到栈上（偏移 " + off + "）" + (e.tried.length ? "；刚占用的 " + regs(e.tried) + " 退回去，留给后面的值" : "") + "。",
            v.n + " needs " + what + ". It is never split, so all of it goes on the stack (offset " + off + ")" + (e.tried.length ? "; " + regs(e.tried) + " are given back for later values" : "") + ".");
        }
      } else if (e.kind === "reset") {
        s = L("参数分完了。返回值用同样的规则，重新从 AX 和 X0 开始。", "Arguments are done. Results use the same rules, starting again from AX and X0.");
      } else {
        s = e.fields.length
          ? L("最后，调用方为每个放在寄存器里的参数在栈上留一个同样大小的空位，调用时不填。栈上一共 " + e.total + " 字节。",
            "Finally the caller reserves an equally sized slot on the stack for each register argument, left empty at the call. " + e.total + " bytes in total.")
          : L("没有参数放在寄存器里，不用预留空位。栈上一共 " + e.total + " 字节。", "No argument is in a register, so nothing is reserved. " + e.total + " bytes in total.");
      }
      p.note.textContent = s;
    }
    function draw() { drawSig(); drawRegs(); drawStack(); narrate(); stepBtn.disabled = k >= plan.ev.length; }
    function replan(toEnd) { plan = build(sig, abi0); k = toEnd ? plan.ev.length : 0; draw(); }

    var stepBtn = V.button(p.bar, L("下一步", "Step"), function () { if (k < plan.ev.length) { k++; draw(); } });
    V.button(p.bar, L("全部", "All"), function () { k = plan.ev.length; draw(); });
    V.button(p.bar, L("从头", "Restart"), function () { k = 0; draw(); });
    var abiBtn = V.button(p.bar, L("改用 ABI0", "Use ABI0"), function () {
      abi0 = !abi0; abiBtn.classList.toggle("is-on", abi0); replan(true);
    });
    V.select(p.bar, L("函数", "Function"), PRESETS.map(function (q) {
      return { value: q.id, label: q.name };
    }), preset.id, function (id) {
      preset = PRESETS.filter(function (q) { return q.id === id; })[0]; sig = clone(preset); extra = 0; replan(true);
    });
    var addSel = V.select(p.bar, L("加一个参数", "Add a parameter"),
      [{ value: "", label: L("选类型", "type") }].concat(ADDABLE.map(function (a) { return { value: a.value, label: a.value }; })), "",
      function (val) {
        var a = ADDABLE.filter(function (q) { return q.value === val; })[0];
        addSel.value = "";
        if (!a || sig.params.length >= 16) return;
        extra++; sig.params.push(P("x" + extra, a.t)); replan(true);
      });

    replan(true);
  });
})();
