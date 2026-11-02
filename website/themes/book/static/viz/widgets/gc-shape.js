/*
 * gc-shape: which type arguments share one body under GC shape stenciling
 * (book §8.1.3).
 *
 * The rule is shapify in src/cmd/compile/internal/noder/reader.go on
 * release-branch.go1.26: a type argument's shape is its underlying type,
 * except that a pointer used for a type parameter whose constraint is a basic
 * interface is shaped as *uint8 (pointerShaping := basic && targ.IsPtr() &&
 * !targ.Elem().NotInHeap()). "basic" is written by noder/writer.go as
 * tparam.Underlying().(*types2.Interface).IsMethodSet(): true for any and
 * fmt.Stringer, false for comparable and cmp.Ordered. Every instantiation
 * gets its own dictionary; one body is compiled per distinct shape.
 *
 * Every grouping and symbol name below was checked with Go 1.26.10:
 * GOOS=linux GOARCH=amd64 go build, then go tool nm, for the same Last
 * function under each of the four constraints and all twelve type arguments.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace)";

  // under: the underlying type as it appears in the shape's link name.
  var TYPES = [
    { id: "int", label: "int", dict: "int", under: "int", cmp: 1, ord: 1 },
    { id: "myint", label: "MyInt", dict: "main.MyInt", under: "int", cmp: 1, ord: 1 },
    { id: "int64", label: "int64", dict: "int64", under: "int64", cmp: 1, ord: 1 },
    { id: "dur", label: "time.Duration", dict: "time.Duration", under: "int64", cmp: 1, ord: 1, str: 1 },
    { id: "f64", label: "float64", dict: "float64", under: "float64", cmp: 1, ord: 1 },
    { id: "str", label: "string", dict: "string", under: "string", cmp: 1, ord: 1 },
    { id: "slice", label: "[]int", dict: "[]int", under: "[]int" },
    { id: "point", label: "Point", dict: "main.Point", under: "struct { X int; Y int }", cmp: 1 },
    { id: "node", label: "*Node", dict: "*main.Node", under: "*main.Node", cmp: 1, ptr: 1 },
    { id: "file", label: "*os.File", dict: "*os.File", under: "*os.File", cmp: 1, ptr: 1 },
    { id: "buf", label: "*bytes.Buffer", dict: "*bytes.Buffer", under: "*bytes.Buffer", cmp: 1, ptr: 1, str: 1 },
    { id: "sb", label: "*strings.Builder", dict: "*strings.Builder", under: "*strings.Builder", cmp: 1, ptr: 1, str: 1 },
  ];
  var CONS = {
    "any": { basic: true, ok: function () { return true; } },
    "comparable": { basic: false, ok: function (t) { return !!t.cmp; },
      why: function () { return L("切片不可比较", "slices are not comparable"); } },
    "cmp.Ordered": { basic: false, ok: function (t) { return !!t.ord; },
      why: function () { return L("不在 cmp.Ordered 的类型集中", "not in cmp.Ordered's type set"); } },
    "fmt.Stringer": { basic: true, ok: function (t) { return !!t.str; },
      why: function () { return L("没有 String 方法", "no String method"); } },
  };
  function shapeOf(t, c) { return CONS[c].basic && t.ptr ? "*uint8" : t.under; }

  V.register("gc-shape", function (host) {
    var p = V.panel(host, { title: L("GC 形状：哪些类型实参共用一份代码", "GC shapes: which type arguments share one body") });
    var root = V.svg("svg", { viewBox: "0 0 720 334", role: "group",
      "aria-label": L("类型实参、字典与形状实例", "Type arguments, dictionaries and shape instances") }, p.stage);
    var gHead = V.svg("g", null, root), gRows = V.svg("g", null, root), gShapes = V.svg("g", null, root);

    var cons = "any", on = {}, last = null;
    TYPES.forEach(function (t) { on[t.id] = true; });

    function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }
    function txt(g, x, y, s, style, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: style || "", text: s }, g);
    }
    var RY = 82, RH = 20, SX = 386;
    function rowY(i) { return RY + i * RH; }

    function groups() {
      var gs = [], by = {};
      TYPES.forEach(function (t, i) {
        if (!on[t.id] || !CONS[cons].ok(t)) return;
        var s = shapeOf(t, cons);
        if (!by[s]) { by[s] = { shape: s, rows: [], types: [] }; gs.push(by[s]); }
        by[s].rows.push(i); by[s].types.push(t);
      });
      return gs;
    }

    function draw() {
      clear(gHead); clear(gRows); clear(gShapes);
      var c = CONS[cons], gs = groups();
      txt(gHead, 8, 18, "func Last[T " + cons + "](s []T) T { return s[len(s)-1] }", "font-size:12px;font-weight:600;" + MONO);
      txt(gHead, 8, 38, c.basic
        ? L(cons + " 只含方法，是基本接口：指针类型实参一律以 *uint8 为形状，其余以底层类型为形状。",
          cons + " has only methods, so it is a basic interface: every pointer argument is shaped as *uint8, the rest by underlying type.")
        : L(cons + " 不是基本接口：每个类型实参都以底层类型为形状，指针也不例外。",
          cons + " is not a basic interface: every argument, pointers included, is shaped by its underlying type."),
        "font-size:11px;fill:var(--viz-muted)");
      txt(gHead, 8, 64, L("类型实参与各自的字典", "Type arguments and their dictionaries"), "font-size:11.5px;font-weight:600");
      txt(gHead, SX, 64, L("形状实例：每种形状编译一份函数体", "Shape instances: one body per shape"), "font-size:11.5px;font-weight:600");

      // rows
      var hotShape = last && on[last] && c.ok(TYPES.filter(function (t) { return t.id === last; })[0])
        ? shapeOf(TYPES.filter(function (t) { return t.id === last; })[0], cons) : null;
      TYPES.forEach(function (t, i) {
        var y = rowY(i), ok = c.ok(t), sel = on[t.id] && ok, hot = sel && shapeOf(t, cons) === hotShape;
        var g = V.svg("g", { role: "checkbox", tabindex: ok ? 0 : -1, "aria-checked": String(sel), "aria-disabled": String(!ok),
          "aria-label": t.label, style: ok ? "cursor:pointer" : "" }, gRows);
        V.svg("rect", { x: 4, y: y - 13, width: 342, height: 18, rx: 3,
          style: "fill:" + (hot ? "var(--viz-c1)" : "transparent") + ";fill-opacity:" + (hot ? 0.1 : 0) }, g);
        V.svg("rect", { x: 10, y: y - 9.5, width: 11, height: 11, rx: 2,
          style: "fill:" + (sel ? "var(--viz-c1)" : "none") + ";stroke:" + (ok ? "var(--viz-c1)" : "var(--viz-line)") }, g);
        if (sel) V.svg("path", { d: "M12.5," + (y - 4.5) + " l2.5,3 l4,-5.5", style: "fill:none;stroke:var(--viz-fill);stroke-width:1.6" }, g);
        txt(g, 28, y, t.label, "font-size:11px;" + MONO + (ok ? "" : ";fill:var(--viz-muted)"));
        if (!ok) txt(g, 140, y, c.why(t), "font-size:10.5px;fill:var(--viz-c2)");
        else if (sel) txt(g, 140, y, "main..dict.Last[" + t.dict + "]", "font-size:9.5px;" + MONO + ";fill:var(--viz-muted)");
        if (ok) {
          var toggle = function () { on[t.id] = !on[t.id]; last = t.id; draw(); narrate(t); };
          g.addEventListener("click", toggle);
          g.addEventListener("keydown", function (e) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
        }
      });

      // shapes, each at the mean height of its rows, with connectors
      gs.forEach(function (gr) {
        var ys = gr.rows.map(rowY), cy = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length - 4;
        var hot = gr.shape === hotShape, col = hot ? "var(--viz-c1)" : gr.rows.length > 1 ? "var(--viz-c4)" : "var(--viz-line)";
        ys.forEach(function (y) {
          var y0 = y - 4;
          V.svg("path", { d: "M348," + y0 + " C368," + y0 + " 366," + cy + " " + SX + "," + cy,
            style: "fill:none;stroke:" + col + ";stroke-width:" + (hot ? 1.6 : 1.1) }, gShapes);
        });
        V.svg("rect", { x: SX, y: cy - 9, width: 716 - SX, height: 18, rx: 4,
          style: "fill:" + (gr.rows.length > 1 || hot ? col : "var(--viz-fill)") + ";fill-opacity:" + (gr.rows.length > 1 || hot ? 0.12 : 1) + ";stroke:" + col }, gShapes);
        txt(gShapes, SX + 6, cy + 4, "main.Last[go.shape." + gr.shape + "]", "font-size:10.5px;" + MONO);
        if (gr.rows.length > 1) txt(gShapes, 710, cy + 4, L(gr.rows.length + " 个类型实参", gr.rows.length + " type args"), "font-size:10px;fill:var(--viz-muted)", "end");
      });

      var n = TYPES.filter(function (t) { return on[t.id] && c.ok(t); }).length;
      txt(gHead, 8, 326, "type MyInt int · type Point struct{ X, Y int } · type Node struct{ v int }", "font-size:10px;" + MONO + ";fill:var(--viz-muted)");
      txt(gHead, 716, 326, L(n + " 个类型实参：" + n + " 个字典，" + gs.length + " 份函数体", n + " type args: " + n + " dictionaries, " + gs.length + (gs.length === 1 ? " body" : " bodies")),
        "font-size:11px;font-weight:600", "end");
    }

    function peers(t) {
      var s = shapeOf(t, cons);
      return TYPES.filter(function (u) { return u !== t && on[u.id] && CONS[cons].ok(u) && shapeOf(u, cons) === s; })
        .map(function (u) { return u.label; });
    }
    function narrate(t) {
      if (!t) {
        var gs = groups(), n = gs.reduce(function (a, g) { return a + g.rows.length; }, 0);
        var merged = gs.filter(function (g) { return g.rows.length > 1; }).map(function (g) { return "go.shape." + g.shape; });
        var why = cons === "comparable" ? L("comparable 的类型集不只由方法决定，因此不是基本接口。", "comparable's type set is not given by methods alone, so it is not a basic interface. ")
          : cons === "cmp.Ordered" ? L("cmp.Ordered 由类型项构成，不是基本接口。", "cmp.Ordered consists of type terms, so it is not a basic interface. ")
          : L(cons + " 只含方法，是基本接口。", cons + " has only methods, so it is a basic interface. ");
        p.note.textContent = why + L("约束为 " + cons + " 时，" + n + " 个类型实参归入 " + gs.length + " 种形状" +
            (merged.length ? "，共用代码的是 " + merged.join("、") : "，没有任何两个类型实参共用代码") + "。点击左侧的类型实参，可以将其加入或去掉。",
          "Under " + cons + ", " + n + " type arguments fall into " + gs.length + " shapes" +
            (merged.length ? "; " + merged.join(", ") + (merged.length > 1 ? " are shared" : " is shared") : "; no two arguments share a body") + ". Click a type argument on the left to add or remove it.");
        return;
      }
      if (!on[t.id]) {
        var rest = peers(t);
        p.note.textContent = L("去掉 " + t.label + "：它的字典随之消失；" + (rest.length ? "形状 go.shape." + shapeOf(t, cons) + " 仍由 " + rest.join("、") + " 使用，函数体保留。" : "没有其他类型实参属于形状 go.shape." + shapeOf(t, cons) + "，这份函数体也不再生成。"),
          "Remove " + t.label + ": its dictionary goes away; " + (rest.length ? "shape go.shape." + shapeOf(t, cons) + " is still used by " + rest.join(", ") + ", so the body stays." : "no other argument has shape go.shape." + shapeOf(t, cons) + ", so that body is no longer compiled."));
        return;
      }
      var s = shapeOf(t, cons), pr = peers(t), why;
      if (CONS[cons].basic && t.ptr) why = L(t.label + " 是指针，而 " + cons + " 是基本接口，形状为 *uint8。", t.label + " is a pointer and " + cons + " is a basic interface, so its shape is *uint8.");
      else if (t.ptr) why = L(t.label + " 是指针，但 " + cons + " 不是基本接口，形状就是底层类型 " + s + "。", t.label + " is a pointer, but " + cons + " is not a basic interface, so its shape is its underlying type, " + s + ".");
      else if (t.under !== t.label) why = L(t.label + " 的底层类型是 " + s + "，以此为形状。", t.label + "'s underlying type is " + s + ", and that is its shape.");
      else why = L(t.label + " 以自身为形状。", t.label + " is its own shape.");
      var tail = pr.length
        ? L("它与 " + pr.join("、") + " 共用 main.Last[go.shape." + s + "]，只是字典不同。", " It shares main.Last[go.shape." + s + "] with " + pr.join(", ") + "; only the dictionaries differ.")
        : L("它独占一份函数体 main.Last[go.shape." + s + "]。", " It gets a body of its own, main.Last[go.shape." + s + "].");
      if (t.id === "int64" || t.id === "dur") {
        if (on.int) tail += L("int64 与 int 的大小相同，但底层类型不同，并不合并。", " int64 has the same size as int but a different underlying type, so the two are not merged.");
      }
      p.note.textContent = why + tail;
    }

    V.select(p.bar, L("约束", "Constraint"), Object.keys(CONS).map(function (k) { return { value: k, label: k }; }), cons,
      function (v) { cons = v; last = null; draw(); narrate(null); });
    V.button(p.bar, L("全选", "Select all"), function () { TYPES.forEach(function (t) { on[t.id] = true; }); last = null; draw(); narrate(null); });
    V.button(p.bar, L("只选指针", "Pointers only"), function () { TYPES.forEach(function (t) { on[t.id] = !!t.ptr; }); last = null; draw(); narrate(null); });

    draw(); narrate(null);
  });
})();
