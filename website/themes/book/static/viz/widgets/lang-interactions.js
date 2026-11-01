/*
 * lang-interactions: why fewer language features matter (book §1.1).
 *
 * Twelve familiar Go features sit on a ring; every pair is joined by a line,
 * because any two features that meet in one program need a rule for how they
 * combine. The reader can add or remove features and watch the number of
 * pairs grow, and step through real Go rules that exist for particular pairs
 * (each one checked against Go 1.26).
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;

  var F = [
    ["goroutine", "goroutine"], ["nil", "nil"], ["channel", "channel"], ["map", "map"],
    ["select", "select"], ["defer", "defer"], ["panic", "panic"], ["闭包", "closures"],
    ["for 循环", "for loops"], ["接口", "interfaces"], ["方法", "methods"], ["泛型", "generics"],
  ];
  // Real rules for particular pairs: [i, j, zh, en].
  var RULES = [
    [7, 8, "Go 1.22 之前，整个循环只有一个循环变量，循环体里的闭包捕获的都是它；Go 1.22 起每轮迭代一个新变量。",
      "Before Go 1.22 a loop had a single loop variable, and closures in the body all captured it; since Go 1.22 each iteration gets a new one."],
    [9, 1, "接口变量里装着一个值为 nil 的指针时，接口变量本身不等于 nil。",
      "An interface holding a nil pointer is itself not nil."],
    [5, 6, "panic 之后，已经登记的 defer 照常执行；recover 只有在被 defer 的函数里直接调用才起作用。",
      "After a panic, deferred calls still run; recover only works when called directly by a deferred function."],
    [10, 11, "方法不能有自己的类型参数，Go 1.26 仍是如此。",
      "Methods cannot have their own type parameters, still true in Go 1.26."],
    [4, 1, "select 里 channel 为 nil 的 case 永远不会被选中，可以用来临时关掉一个分支。",
      "A select case on a nil channel is never chosen, which can switch a branch off."],
    [2, 1, "向 nil channel 发送或从中接收，会永远等下去。",
      "Sending to or receiving from a nil channel blocks forever."],
    [0, 3, "几个 goroutine 同时写一个 map，运行时报 concurrent map writes 并退出，recover 拦不住。",
      "Concurrent writes to a map from several goroutines make the runtime stop with \"concurrent map writes\"; recover cannot catch it."],
    [0, 6, "任何一个 goroutine 里没被 recover 的 panic，都会让整个程序退出。",
      "An unrecovered panic in any goroutine ends the whole program."],
    [8, 5, "循环体里的 defer 要等整个函数返回时才执行，不是每轮结束时。",
      "A defer inside a loop runs when the function returns, not at the end of each iteration."],
    [8, 3, "用 for range 遍历 map，次序不固定，运行时每次都会打乱。",
      "Ranging over a map visits keys in no fixed order; the runtime shuffles it each time."],
    [9, 10, "方法的接收者写成指针 *T 时，只有 *T 满足接口，T 的值不满足。",
      "If a method has a pointer receiver *T, only *T satisfies the interface, not a T value."],
    [9, 11, "写了 int | string 这种类型列表的接口只能用作约束，不能用来声明普通变量。",
      "An interface with a type list such as int | string can only be a constraint, not the type of an ordinary variable."],
  ];
  var MAX = F.length, MIN = 2;
  function pairs(n) { return n * (n - 1) / 2; }
  function combos(n) { return Math.pow(2, n) - n - 1; }

  V.register("lang-interactions", function (host) {
    var p = V.panel(host, { title: L("特性越多，两两之间的规则越多", "More features, more rules between them") });
    var root = V.svg("svg", { viewBox: "0 0 720 306", role: "img",
      "aria-label": L("特性两两相连的图与对数的变化", "Features joined pairwise, and how the count grows") }, p.stage);
    var g = V.svg("g", null, root);
    var n = MAX, rule = -1; // rule: index into RULES, -1 for none

    function tw(s) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 12 : 6.6; return w; }
    function text(x, y, s, st) { return V.svg("text", { x: x, y: y, style: st || "font-size:12px", text: s }, g); }
    function pos(i) {
      var a = 2 * Math.PI * i / n;
      return { x: 190 + 145 * Math.sin(a), y: 153 - 120 * Math.cos(a) };
    }

    function draw() {
      while (g.firstChild) g.removeChild(g.firstChild);
      var hot = rule >= 0 ? RULES[rule] : null;
      // every pair
      for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
        var a = pos(i), b = pos(j);
        var isHot = hot && ((hot[0] === i && hot[1] === j) || (hot[0] === j && hot[1] === i));
        if (isHot) continue;
        V.svg("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          style: "stroke:var(--viz-line);stroke-width:1" }, g);
      }
      if (hot) {
        var h1 = pos(hot[0]), h2 = pos(hot[1]);
        V.svg("line", { x1: h1.x, y1: h1.y, x2: h2.x, y2: h2.y, style: "stroke:var(--viz-c2);stroke-width:3" }, g);
      }
      // feature labels
      for (var k = 0; k < n; k++) {
        var q = pos(k), lab = L(F[k][0], F[k][1]), w = tw(lab) + 14;
        var on = hot && (hot[0] === k || hot[1] === k);
        V.svg("rect", { x: q.x - w / 2, y: q.y - 11, width: w, height: 22, rx: 5,
          style: on ? "fill:var(--viz-c2);fill-opacity:.18;stroke:var(--viz-c2);stroke-width:1.6"
            : "fill:var(--viz-fill);stroke:var(--viz-line);stroke-width:1.2" }, g);
        text(q.x, q.y + 4, lab, "font-size:12px;text-anchor:middle;font-family:var(--font-mono,monospace)");
      }
      // counts
      var x0 = 410;
      text(x0, 34, L("特性：" + n + " 个", "Features: " + n), "font-size:14px;font-weight:600");
      text(x0, 60, L("两两搭配：" + pairs(n) + " 对", "Pairs: " + pairs(n)), "font-size:14px;font-weight:600;fill:var(--viz-c1)");
      text(x0, 84, L("两个及以上特性的组合：" + combos(n) + " 种", "Combinations of two or more: " + combos(n)), "font-size:12px");
      if (n > MIN) {
        text(x0, 106, L("比 " + (n - 1) + " 个特性时多 " + (n - 1) + " 对，", (n - 1) + " more pairs than with " + (n - 1) + " features,"),
          "font-size:12px;fill:var(--viz-muted)");
        text(x0, 122, L("组合的数目约翻一倍。", "and about twice as many combinations."), "font-size:12px;fill:var(--viz-muted)");
      }
      // bar chart of pairs for 2..MAX
      var by = 286, bh = 120, slot = 300 / (MAX - MIN + 1);
      text(x0, 150, L("两两搭配的对数（横轴：特性个数）", "Pairs (x axis: number of features)"), "font-size:11px;fill:var(--viz-muted)");
      for (var m = MIN; m <= MAX; m++) {
        var hgt = Math.max(1, pairs(m) / pairs(MAX) * bh), bx = x0 + (m - MIN) * slot;
        var cur = m === n;
        V.svg("rect", { x: bx + 3, y: by - hgt, width: slot - 8, height: hgt, rx: 2,
          style: cur ? "fill:var(--viz-c1);fill-opacity:.3;stroke:var(--viz-c1)" : "fill:var(--viz-line);stroke:none" }, g);
        text(bx + slot / 2 - 1, by + 14, String(m), "font-size:10px;text-anchor:middle;fill:var(--viz-muted)");
        if (cur) text(bx + slot / 2 - 1, by - hgt - 5, String(pairs(m)), "font-size:11px;text-anchor:middle");
      }
    }

    function available() {
      var out = [];
      RULES.forEach(function (r, i) { if (r[0] < n && r[1] < n) out.push(i); });
      return out;
    }
    function noteCount() {
      p.note.textContent = L(n + " 个特性两两之间有 " + pairs(n) + " 对搭配，每一对都可能需要一条规则。点「下一条规则」看几对 Go 里真实存在的规则。",
        n + " features make " + pairs(n) + " pairs, and each pair may need a rule. Press Next rule to see some rules that really exist in Go.");
    }
    function setN(v) {
      n = Math.max(MIN, Math.min(MAX, v));
      if (rule >= 0 && (RULES[rule][0] >= n || RULES[rule][1] >= n)) rule = -1;
      lessBtn.disabled = n <= MIN; moreBtn.disabled = n >= MAX;
      draw(); noteCount();
    }
    var lessBtn = V.button(p.bar, L("少一个特性", "One fewer"), function () { setN(n - 1); });
    var moreBtn = V.button(p.bar, L("多一个特性", "One more"), function () { setN(n + 1); });
    V.button(p.bar, L("下一条规则", "Next rule"), function () {
      var av = available();
      if (!av.length) {
        rule = -1; draw();
        p.note.textContent = L("图里这几个特性之间没有收录例子，多加几个特性再试。", "No example among these features yet; add a few more.");
        return;
      }
      var k = av.indexOf(rule);
      rule = av[(k + 1) % av.length];
      draw();
      var r = RULES[rule];
      p.note.textContent = L(F[r[0]][0] + " × " + F[r[1]][0] + "：", F[r[0]][1] + " × " + F[r[1]][1] + ": ") + L(r[2], r[3]);
    });
    V.button(p.bar, L("重置", "Reset"), function () { rule = -1; setN(MAX); });

    setN(MAX);
  });
})();
