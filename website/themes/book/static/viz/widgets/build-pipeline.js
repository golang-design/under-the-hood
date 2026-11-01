/*
 * build-pipeline: one small function through the Go compiler (book §3.2).
 *
 * `larger` from the text, compiled with go1.26.10 for darwin/arm64. The type
 * annotations, the inlining cost (-gcflags=-m=2), the IR after walk and every
 * SSA stage are taken from a real `GOSSAFUNC=larger+ go build` run, trimmed
 * (positions and dead values removed). The syntax-tree stage is a simplified
 * rendering of what cmd/compile/internal/syntax builds.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;

  var GROUPS = [
    L("源码", "Source"), L("读懂源码", "Parse"), L("检查类型", "Type-check"),
    L("内联、逃逸", "Inline, escape"), L("改写", "Walk"), L("优化", "Optimize"), L("机器码", "Codegen"),
  ];

  // Each line: [text, highlight?]. Highlighted lines are what this step added or changed.
  var STEPS = [
    { g: 0, lines: [
        ["func larger(a, b int) int {"], ["\tm := a"], ["\tif b > a {"], ["\t\tm = b"], ["\t}"], ["\treturn m"], ["}"]],
      note: L("这是源码，一段文本。m 被赋值了两次：一次在开头，一次在 if 里面。",
        "The source is just text. m is assigned twice: once at the top, once inside the if.") },
    { g: 1, lines: [
        [L("函数 larger", "func larger")],
        [L("├─ 参数 a, b int；结果 int", "├─ params a, b int; result int")],
        [L("└─ 函数体", "└─ body")],
        [L("   ├─ 赋值   m := a", "   ├─ assign   m := a"), 1],
        [L("   ├─ if     条件 b > a", "   ├─ if       cond b > a"), 1],
        [L("   │  └─ 赋值 m = b", "   │  └─ assign m = b"), 1],
        [L("   └─ 返回   m", "   └─ return   m"), 1]],
      note: L("文本被切成词，再按语法组成一棵树。每个节点都记着它在源码里的行号，报错时用得上。",
        "The text is split into tokens and arranged into a tree by the grammar. Every node remembers its source position for error messages.") },
    { g: 2, lines: [
        ["a, b   int"], ["m      int", 1], ["b > a  bool", 1], ["m = b  int = int  ✓", 1], ["return m  int  ✓", 1]],
      note: L("类型检查弄清每个名字和表达式的类型：m 的类型由 a 推出是 int，b > a 是 bool，赋值和返回的类型都对得上。",
        "Type checking works out every type: m is int because a is, b > a is bool, and the assignment and return types match.") },
    { g: 3, lines: [
        ["$ go build -gcflags=-m=2"], ["can inline larger with cost 14 as:", 1],
        ["  func(int, int) int { m := a; if b > a { m = b }; return m }"], [""],
        [L("a、b、m：没有被取地址，不逃逸，不用放到堆上", "a, b, m: never addressed, do not escape, need no heap allocation"), 1]],
      note: L("成本 14，远低于 80 的预算，所以 main 里的 larger(3, 5) 会被内联。三个变量都没被取过地址，逃逸分析判定它们不逃逸。",
        "Cost 14 is well under the budget of 80, so the call larger(3, 5) in main is inlined. No variable has its address taken, so none escapes.") },
    { g: 4, lines: [
        ["DCL m"], ["AS  m = a"], ["IF  b > a"], ["    AS m = b"], ["RETURN"], ["    AS ~r0 = m", 1]],
      note: L("这个函数里没有 go 语句、channel 或 map，walk 几乎不用改写，只把 return m 拆成「先赋给返回值 ~r0，再返回」。",
        "No go statements, channels or maps here, so walk changes little: return m becomes \"assign to the result ~r0, then return\".") },
    { g: 5, lines: [
        ["b1:"], ["    v7  = Arg <int> {a}"], ["    v8  = Arg <int> {b}"], ["    v10 = Less64 <bool> v7 v8"],
        ["    If v10 -> b3 b2"], ["b2: <- b1 b3"], ["    v12 = Phi <int> v7 v11  (m)", 1], ["    v14 = MakeResult v12 v13"], ["    Ret v14"],
        ["b3: <- b1"], ["    v11 = Copy <int> v8  (m)", 1], ["    Plain -> b2"]],
      note: L("换成 SSA：每赋值一次就是一个新名字。m 变成了 v7、v11 和汇合处的 v12；v12 = Phi(v7, v11) 表示「从 b1 直接来就取 v7，经过 b3 来就取 v11」。v14 只是把结果包装起来交给 Ret。",
        "Now in SSA form: every assignment gets a new name. m becomes v7, v11 and, where the paths meet, v12 = Phi(v7, v11): v7 if we came straight from b1, v11 if through b3. v14 just packages the result for Ret.") },
    { g: 5, lines: [
        ["b1:"], ["    v7  = ArgIntReg <int> {a}"], ["    v8  = ArgIntReg <int> {b}"], ["    v10 = Less64 <bool> v7 v8"],
        ["    v12 = CondSelect <int> v8 v7 v10", 1], ["    v14 = MakeResult v12 v1"], ["    Ret v14"]],
      note: L("优化发现两条路只是为了选出一个值，把跳转换成「按条件二选一」，三段代码合成了一段。参数也改成了从寄存器传入。",
        "An optimization pass sees that the branch only picks a value and replaces it with a conditional select; three blocks become one. Arguments now arrive in registers.") },
    { g: 6, lines: [
        ["b1:"], ["    v7  = ArgIntReg <int> {a}"], ["    v8  = ArgIntReg <int> {b}"],
        ["    v9  = CMP <flags> v8 v7", 1], ["    v12 = CSEL <int> [GreaterThan] v8 v7 v9", 1], ["    v14 = MakeResult v12 v1"], ["    Ret v14"]],
      note: L("lower 把通用的操作换成 arm64 的指令：比较换成 CMP，二选一换成 CSEL。从这里开始，代码只适用于这一种 CPU。",
        "The lower pass rewrites generic operations into arm64 instructions: the comparison becomes CMP, the select becomes CSEL. From here on the code is specific to this CPU.") },
    { g: 6, lines: [
        ["b1:"], ["    v7  = ArgIntReg <int> {a}  : R0", 1], ["    v8  = ArgIntReg <int> {b}  : R1", 1],
        ["    v9  = CMP <flags> v8 v7"], ["    v12 = CSEL <int> [GreaterThan] v8 v7 v9  : R0", 1], ["    v14 = MakeResult v12 v1"], ["    Ret v14"]],
      note: L("regalloc 给每个值分配寄存器：a 在 R0，b 在 R1，结果放回 R0，正是 Go 调用约定里返回值的位置。",
        "regalloc assigns registers: a in R0, b in R1, and the result back in R0, where Go's calling convention expects the return value.") },
    { g: 6, lines: [
        ["CMP   R0, R1", 1], ["CSEL  GT, R1, R0, R0", 1], ["RET", 1]],
      note: L("最后生成三条机器指令，没有跳转。larger 一共经过了 54 趟处理。",
        "The result is three machine instructions with no branch. larger went through 54 passes in total.") },
  ];

  V.register("build-pipeline", function (host) {
    var p = V.panel(host, { title: L("一个函数走过编译器", "One function through the compiler") });
    var root = V.svg("svg", { viewBox: "0 0 720 300", role: "img",
      "aria-label": L("larger 函数在编译器各道工序中的样子", "The function larger at each compiler stage") }, p.stage);
    var gChips = V.svg("g", null, root), gCode = V.svg("g", null, root);
    var i = 0;

    function draw() {
      [gChips, gCode].forEach(function (g) { while (g.firstChild) g.removeChild(g.firstChild); });
      var s = STEPS[i], cw = 720 / GROUPS.length;
      GROUPS.forEach(function (name, k) {
        var x = k * cw + 3, cur = k === s.g, done = k < s.g;
        var c = cur ? "var(--viz-c1)" : done ? "var(--viz-c3)" : "var(--viz-line)";
        V.svg("rect", { x: x, y: 6, width: cw - 6, height: 30, rx: 5,
          style: "fill:" + (cur || done ? c : "var(--viz-fill)") + ";fill-opacity:" + (cur || done ? 0.15 : 1) +
            ";stroke:" + c + ";stroke-width:" + (cur ? 2 : 1.1) }, gChips);
        V.svg("text", { x: x + (cw - 6) / 2, y: 25, "text-anchor": "middle",
          style: "font-size:12px;" + (cur ? "font-weight:600" : "fill:var(--viz-muted)"), text: name }, gChips);
        if (k < GROUPS.length - 1) V.svg("text", { x: (k + 1) * cw, y: 25, "text-anchor": "middle",
          style: "font-size:11px;fill:var(--viz-muted)", text: "›" }, gChips);
      });
      V.svg("rect", { x: 3, y: 48, width: 714, height: 246, rx: 6,
        style: "fill:var(--viz-fill);stroke:var(--viz-line)" }, gCode);
      V.svg("text", { x: 703, y: 66, "text-anchor": "end", style: "font-size:11px;fill:var(--viz-muted)",
        text: L("第 ", "step ") + (i + 1) + " / " + STEPS.length }, gCode);
      s.lines.forEach(function (ln, k) {
        var y = 72 + k * 19;
        if (ln[1]) V.svg("rect", { x: 10, y: y - 13, width: 4, height: 17, style: "fill:var(--viz-c1)" }, gCode);
        V.svg("text", { x: 22, y: y, "xml:space": "preserve",
          style: "font-size:12.5px;font-family:var(--font-mono,monospace);white-space:pre;" +
            (ln[1] ? "fill:var(--viz-c1);font-weight:600" : ""), text: ln[0].replace(/\t/g, "    ") }, gCode);
      });
      p.note.textContent = s.note;
      prev.disabled = i === 0; next.disabled = i === STEPS.length - 1;
    }

    var prev = V.button(p.bar, L("上一步", "Back"), function () { if (i > 0) { i--; draw(); } });
    var next = V.button(p.bar, L("下一步", "Step"), function () { if (i < STEPS.length - 1) { i++; draw(); } });
    V.button(p.bar, L("重置", "Reset"), function () { i = 0; draw(); });
    draw();
  });
})();
