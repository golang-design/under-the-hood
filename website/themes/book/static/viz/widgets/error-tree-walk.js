/*
 * error-tree-walk: how errors.Is, errors.As and errors.AsType walk an error
 * tree (book §7.2).
 *
 * The tree is the one §7.2.1 builds:
 *   err   := fmt.Errorf("save: %w\n%w", flush, open)        // *fmt.wrapErrors
 *   flush := fmt.Errorf("flush: %w", io.ErrUnexpectedEOF)   // *fmt.wrapError
 *   open  := &fs.PathError{Op: "open", Path: "a.conf", Err: leaf}
 * where leaf is fs.ErrNotExist or syscall.ENOENT (what os.Open returns on Unix).
 *
 * The walk is src/errors/wrap.go on release-branch.go1.26, check for check:
 *   is      err == target (only if target's type is comparable), then the
 *           Is(error) bool method, then Unwrap() error (loop in the same call)
 *           or Unwrap() []error (recurse into each child in order);
 *   as      AssignableTo(targetType), then As(any) bool, then the same unwrap;
 *   asType  err.(E), then As(any) bool (only then is *E allocated), then the
 *           same unwrap. as and asType skip nil children; is does not, but
 *           this tree has none.
 * Methods per node come from the sources: fmt/errors.go (wrapError.Unwrap,
 * wrapErrors.Unwrap), io/fs/fs.go (PathError.Unwrap, no Is or As),
 * syscall/syscall_unix.go (Errno.Is maps ENOENT to oserror.ErrNotExist, which
 * is fs.ErrNotExist). errors.errorString has none of the three.
 * Every result here was checked against a Go 1.26.10 run of the same calls.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace)";

  function tree(leaf) {
    var eof = { id: "eof", label: "io.ErrUnexpectedEOF", type: "*errors.errorString", vid: "eof", kids: [] };
    var nx = leaf === "enoent"
      ? { id: "leaf", label: "syscall.ENOENT", type: "syscall.Errno", vid: "enoent", kids: [],
        is: function (t) { return t === "notexist"; } } // Errno.Is: ErrNotExist <=> ENOENT
      : { id: "leaf", label: "fs.ErrNotExist", type: "*errors.errorString", vid: "notexist", kids: [] };
    var wrap = { id: "flush", label: "*fmt.wrapError", type: "*fmt.wrapError", unwrap: "one", kids: [eof] };
    var path = { id: "open", label: "*fs.PathError", type: "*fs.PathError", unwrap: "one", kids: [nx] };
    var root = { id: "root", label: "*fmt.wrapErrors", type: "*fmt.wrapErrors", unwrap: "many", kids: [wrap, path] };
    return { root: root, all: [root, wrap, path, eof, nx] };
  }

  var QUERIES = [
    { id: "is-eof", fn: "Is", code: "errors.Is(err, io.ErrUnexpectedEOF)", t: "eof" },
    { id: "is-nx", fn: "Is", code: "errors.Is(err, fs.ErrNotExist)", t: "notexist" },
    { id: "is-ioeof", fn: "Is", code: "errors.Is(err, io.EOF)", t: "ioeof" },
    { id: "as-pe", fn: "As", code: "errors.As(err, &pe)", decl: "var pe *fs.PathError", t: "*fs.PathError", v: "pe" },
    { id: "as-en", fn: "As", code: "errors.As(err, &en)", decl: "var en syscall.Errno", t: "syscall.Errno", v: "en" },
    { id: "astype-pe", fn: "AsType", code: "errors.AsType[*fs.PathError](err)", t: "*fs.PathError" },
  ];

  // Run the real algorithm and record one event per node visited.
  function trace(q, leaf) {
    var T = tree(leaf), ev = [], frames = [], seen = [];
    var fname = q.fn === "Is" ? "is" : q.fn === "As" ? "as" : "asType";
    function snapFrames() { return frames.map(function (f) { return { node: f.node.label, kid: f.kid, n: f.n }; }); }
    function visit(node, how, kidIdx) {
      seen.push(node.id);
      var e = { node: node, how: how, kid: kidIdx, order: seen.slice(), checks: [] };
      if (q.fn === "Is") {
        e.eq = node.vid === q.t;             // the targets here are all comparable
        e.isM = node.is ? node.is(q.t) : null;
        e.match = e.eq || e.isM === true;
      } else {
        e.assign = node.type === q.t;        // AssignableTo / err.(E) for a concrete type
        e.match = e.assign;                  // no node in this tree has an As method
      }
      e.act = e.match ? "match" : node.unwrap || "leaf";
      e.frames = snapFrames();
      ev.push(e);
      return e;
    }
    function walk(node, how, kidIdx) {
      frames.push({ node: node, kid: null, n: node.unwrap === "many" ? node.kids.length : 0 });
      var cur = node, h = how, ki = kidIdx;
      for (;;) {
        frames[frames.length - 1].node = cur;
        frames[frames.length - 1].n = cur.unwrap === "many" ? cur.kids.length : 0;
        var e = visit(cur, h, ki);
        if (e.match) { frames.pop(); return true; }
        if (cur.unwrap === "one") { cur = cur.kids[0]; h = "loop"; ki = null; continue; }
        if (cur.unwrap === "many") {
          for (var i = 0; i < cur.kids.length; i++) {
            frames[frames.length - 1].kid = i;
            if (walk(cur.kids[i], "rec", i)) { frames.pop(); return true; }
            ev.push({ ret: true, from: cur.kids[i] });
          }
          frames.pop(); return false;
        }
        frames.pop(); return false;
      }
    }
    var ok = walk(T.root, "root", null);
    // fold "returned false" markers into the following visit
    var steps = [], pendRet = null;
    ev.forEach(function (e) {
      if (e.ret) { pendRet = e.from; return; }
      e.after = pendRet; pendRet = null; steps.push(e);
    });
    return { T: T, steps: steps, ok: ok, fname: fname };
  }

  V.register("error-tree-walk", function (host) {
    var p = V.panel(host, { title: L("errors.Is、As 与 AsType 如何遍历错误树", "How errors.Is, As and AsType walk an error tree") });
    var root = V.svg("svg", { viewBox: "0 0 720 300", role: "img",
      "aria-label": L("错误树与每个节点上的检查", "The error tree and the checks at each node") }, p.stage);
    var gTree = V.svg("g", null, root), gSide = V.svg("g", null, root);

    var q = QUERIES[1], leaf = "enoent", run, k = 0, timer = null;
    var POS = { root: [224, 62], flush: [112, 156], open: [336, 156], eof: [112, 250], leaf: [336, 250] };
    var BW = 204, BH = 42;

    function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }
    function txt(g, x, y, s, style, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: style || "", text: s }, g);
    }
    function methods(n) {
      if (n.unwrap === "many") return "Unwrap() []error";
      if (n.unwrap === "one") return "Unwrap() error";
      if (n.is) return n.type + " · Is(error) bool";
      return n.type;
    }

    function drawTree(st) {
      clear(gTree);
      var T = run.T, cur = st && st.node, order = st ? st.order : [];
      var path = {}; // nodes on the current call path
      if (st) st.frames.forEach(function (f) { T.all.forEach(function (n) { if (n.label === f.node) path[n.id] = true; }); });
      T.all.forEach(function (n) {
        n.kids.forEach(function (c, i) {
          var a = POS[n.id], b = POS[c.id], hot = cur && (cur.id === c.id) && order.indexOf(c.id) >= 0;
          V.svg("line", { x1: a[0], y1: a[1] + BH / 2, x2: b[0], y2: b[1] - BH / 2,
            style: "stroke:" + (hot ? "var(--viz-c1)" : "var(--viz-line)") + ";stroke-width:" + (hot ? 1.8 : 1.2) }, gTree);
          if (n.unwrap === "many") {
            var mx = (a[0] + b[0]) / 2 + (i ? 10 : -10), my = (a[1] + BH / 2 + b[1] - BH / 2) / 2;
            txt(gTree, mx, my + 4, "[" + i + "]", "font-size:10.5px;" + MONO + ";fill:var(--viz-muted)", i ? "start" : "end");
          }
        });
      });
      T.all.forEach(function (n) {
        var c = POS[n.id], x = c[0] - BW / 2, y = c[1] - BH / 2;
        var vi = order.indexOf(n.id), isCur = cur && cur.id === n.id, hit = isCur && st.match;
        var col = hit ? "var(--viz-c3)" : isCur ? "var(--viz-c1)" : vi >= 0 ? "var(--viz-muted)" : "var(--viz-line)";
        V.svg("rect", { x: x, y: y, width: BW, height: BH, rx: 6,
          style: "fill:" + (hit || isCur ? col : "var(--viz-fill)") + ";fill-opacity:" + (hit || isCur ? 0.13 : 1) +
            ";stroke:" + col + ";stroke-width:" + (isCur ? 2 : 1.1) }, gTree);
        txt(gTree, c[0], c[1] - 3, n.label, "font-size:12px;font-weight:600;" + MONO, "middle");
        txt(gTree, c[0], c[1] + 13, methods(n), "font-size:10px;" + MONO + ";fill:var(--viz-muted)", "middle");
        if (vi >= 0) {
          V.svg("circle", { cx: x + 2, cy: y + 2, r: 9, style: "fill:" + col + ";stroke:none" }, gTree);
          txt(gTree, x + 2, y + 5.5, String(vi + 1), "font-size:10px;font-weight:700;fill:var(--viz-fill)", "middle");
        }
      });
    }

    function checkRows(st) {
      var r = [], n = st.node;
      function row(a, b, tone) { r.push([a, b, tone]); }
      if (q.fn === "Is") {
        row("err == target", st.eq ? L("成立", "true") : L("不成立", "false"), st.eq ? "ok" : "no");
        if (st.eq) return r;
        row(L("Is(target) 方法", "Is(target) method"), st.isM == null ? L("没有", "none") : L("返回 " + st.isM, "returns " + st.isM), st.isM ? "ok" : "no");
        if (st.isM) return r;
      } else {
        row(q.fn === "As" ? L("可赋值给 ", "assignable to ") + q.t : "err.(" + q.t + ")",
          st.assign ? L("成立", "true") : L("不成立", "false"), st.assign ? "ok" : "no");
        if (st.assign) return r;
        row(L("As(any) 方法", "As(any) method"), q.fn === "AsType" ? L("没有，不分配 *E", "none, no *E allocated") : L("没有", "none"), "no");
      }
      row("Unwrap", n.unwrap === "many" ? L("[]error：逐个递归", "[]error: recurse into each")
        : n.unwrap === "one" ? L("error：同一次调用中继续", "error: loop in the same call") : L("没有：返回 false", "none: return false"), "act");
      return r;
    }

    function drawSide(st) {
      clear(gSide);
      var X = 462, R = 714;
      var done = k === run.steps.length + 1;
      txt(gSide, X, 18, q.code, "font-size:12px;font-weight:600;" + MONO);
      if (q.decl) txt(gSide, X, 34, q.decl, "font-size:10.5px;" + MONO + ";fill:var(--viz-muted)");
      txt(gSide, X, 60, L("本节点上的检查（按源码次序）", "Checks at this node, in source order"), "font-size:11.5px;font-weight:600");
      if (st) {
        checkRows(st).forEach(function (rw, i) {
          var y = 84 + i * 22;
          V.svg("rect", { x: X, y: y - 14, width: R - X, height: 19, rx: 3,
            style: "fill:" + (rw[2] === "ok" ? "var(--viz-c3)" : "var(--viz-fill)") + ";fill-opacity:" + (rw[2] === "ok" ? 0.14 : 1) + ";stroke:var(--viz-line)" }, gSide);
          txt(gSide, X + 6, y, rw[0], "font-size:11px;" + MONO);
          txt(gSide, R - 6, y, rw[1], "font-size:11px;fill:" + (rw[2] === "ok" ? "var(--viz-c3)" : rw[2] === "act" ? "var(--viz-c1)" : "var(--viz-muted)"), "end");
        });
      } else {
        txt(gSide, X, 84, done ? L("遍历结束。", "The walk is over.") : L("（尚未开始）", "(not started)"), "font-size:11px;fill:var(--viz-muted)");
      }
      txt(gSide, X, 166, L("调用栈（" + run.fname + " 的递归）", "Call stack (" + run.fname + " recursion)"), "font-size:11.5px;font-weight:600");
      var fr = st ? st.frames : [];
      if (!fr.length) txt(gSide, X, 188, done ? L("（已全部返回）", "(all returned)") : "—", "font-size:11px;fill:var(--viz-muted)");
      fr.forEach(function (f, i) {
        var y = 188 + i * 20;
        txt(gSide, X + i * 12, y, run.fname + "(" + f.node + ")", "font-size:11px;" + MONO + (i === fr.length - 1 ? ";fill:var(--viz-c1)" : ""));
        if (f.kid != null && i < fr.length - 1)
          txt(gSide, R, y, L("子节点 " + f.kid + "，共 " + f.n + " 个", "child " + f.kid + " of " + f.n), "font-size:10.5px;fill:var(--viz-muted)", "end");
      });
      // result
      var ry = 254;
      txt(gSide, X, ry, L("结果", "Result"), "font-size:11.5px;font-weight:600");
      var res = done ? resultText() : "…";
      txt(gSide, X, ry + 20, res, "font-size:11.5px;" + MONO + ";fill:" + (done ? (run.ok ? "var(--viz-c3)" : "var(--viz-c2)") : "var(--viz-muted)"));
    }
    function resultText() {
      if (q.fn === "Is") return String(run.ok);
      if (q.fn === "As") return run.ok ? "true, " + q.v + " = " + (q.t === "syscall.Errno" ? "ENOENT" : L("树中的 *fs.PathError", "the *fs.PathError in the tree")) : "false";
      return run.ok ? L("(树中的 *fs.PathError, true)", "(the *fs.PathError in the tree, true)") : "(nil, false)";
    }

    function narrate(st) {
      if (k === 0) {
        if (q.fn === "Is") return L("errors.Is 先排除 nil，再检查 target 的动态类型是否可比较：*errors.errorString 是指针，可以比较，因此每个节点都先比较 ==。按「下一步」开始遍历。",
          "errors.Is first rules out nil, then checks whether target's dynamic type is comparable: *errors.errorString is a pointer, so every node is compared with == first. Press Step to start the walk.");
        if (q.fn === "As") return L("errors.As 先在运行时检查 target：它必须是非空指针，这里指向 " + q.t + "，而 " + q.t + " 实现了 error。类型不符的 target 要到运行时才会引发 panic。按「下一步」开始遍历。",
          "errors.As first checks target at run time: it must be a non-nil pointer, here to " + q.t + ", and " + q.t + " implements error. A wrong target panics only at run time. Press Step to start the walk.");
        return L("errors.AsType 以类型实参给出目标类型，约束 E error 在编译期检查，运行时不再检查参数；供 As 方法使用的 *E 延迟分配，此时为 nil。按「下一步」开始遍历。",
          "errors.AsType takes the target type as a type argument; the constraint E error is checked at compile time, so nothing is checked at run time. The *E handed to As methods is allocated lazily and is nil for now. Press Step to start the walk.");
      }
      if (!st) {
        var n = run.steps.length;
        if (q.fn === "Is") return run.ok
          ? L("errors.Is 返回 true。访问了 " + n + " 个节点，次序是先序、深度优先：父节点先于子节点，子节点 0 的整棵子树先于子节点 1。",
            "errors.Is returns true after visiting " + n + " nodes in preorder, depth first: a parent before its children, and all of child 0's subtree before child 1.")
          : L("errors.Is 返回 false：树中的 " + n + " 个节点都已访问，没有一个匹配。",
            "errors.Is returns false: all " + n + " nodes were visited and none matched.");
        if (q.fn === "As") return run.ok
          ? L("errors.As 返回 true。目标变量 " + q.v + " 的地址经由 any 参数传入，" + q.v + " 因此逃逸到堆上，这是 As 唯一的一次分配，发生在遍历之前。",
            "errors.As returns true. The address of " + q.v + " is passed through an any parameter, so " + q.v + " escapes to the heap; that is As's one allocation, made before the walk.")
          : L("errors.As 返回 false：没有节点的类型可以赋值给 " + q.t + "。若把 PathError 包装的错误换成 syscall.ENOENT，结果便不同。",
            "errors.As returns false: no node's type is assignable to " + q.t + ". Switch the error inside the PathError to syscall.ENOENT and the result changes.");
        return L("errors.AsType 返回 true。树中没有节点实现 As 方法，*E 从未分配，类型检查也没有用到反射。",
          "errors.AsType returns true. No node in the tree has an As method, so *E was never allocated, and no reflection was used.");
      }
      var s = "", n2 = st.node;
      if (st.after) s += L("以 " + st.after.label + " 为根的子树中没有匹配，那次 " + run.fname + " 调用返回 false。",
        "Nothing matched in the subtree under " + st.after.label + ", so that " + run.fname + " call returned false. ");
      if (st.how === "root") s += L("从根节点 " + n2.label + " 开始。", "Start at the root, " + n2.label + ". ");
      else if (st.how === "rec") s += L("递归调用 " + run.fname + "，进入子节点 " + st.kid + "：" + n2.label + "。", "Recurse into child " + st.kid + ": " + n2.label + ". ");
      else s += L("在同一次调用中，err 换成下一层的 " + n2.label + "。", "Within the same call, err becomes the next error down, " + n2.label + ". ");
      if (q.fn === "Is") {
        if (st.eq) s += L("它就是 target，== 成立，匹配成功，各层调用依次返回 true。", "It is target itself: == holds, it matches, and every call returns true.");
        else if (st.isM === true) s += L("它的动态类型是 syscall.Errno，与 target 不同，== 不成立；但 Errno 实现了 Is 方法，Errno.Is(fs.ErrNotExist) 在错误号为 ENOENT 时返回 true，匹配成功。",
          "Its dynamic type is syscall.Errno, not target's, so == fails; but Errno has an Is method, and Errno.Is(fs.ErrNotExist) returns true for ENOENT, so it matches.");
        else if (st.isM === false) s += L("== 不成立；Errno.Is(target) 只把 ENOENT 等少数错误号映射到对应的哨兵，这里返回 false。",
          "== fails, and Errno.Is(target) maps only a few error numbers to their sentinels, so it returns false here. ");
        else s += L("它与 target 不相等，也没有 Is 方法。", "It is not equal to target and has no Is method. ");
      } else if (st.assign) {
        s += q.fn === "As"
          ? L("它的类型可以赋值给 " + q.t + "，As 把它写入 *target（即 " + q.v + "），匹配成功。", "Its type is assignable to " + q.t + ", so As stores it in *target (that is, " + q.v + ") and matches.")
          : L("类型断言 err.(" + q.t + ") 成功，直接返回这个值。", "The type assertion err.(" + q.t + ") succeeds, and the value is returned as is.");
      } else {
        s += q.fn === "As"
          ? L("它的类型不能赋值给 " + q.t + "，也没有 As 方法。", "Its type is not assignable to " + q.t + ", and it has no As method. ")
          : L("类型断言 err.(" + q.t + ") 失败；它没有 As 方法，所以不分配 *E。", "The type assertion err.(" + q.t + ") fails; it has no As method, so no *E is allocated. ");
      }
      if (!st.match) s += st.act === "many"
        ? L("它实现了 Unwrap() []error，于是对 " + n2.kids.length + " 个子节点逐个递归调用 " + run.fname + "。", "It implements Unwrap() []error, so " + run.fname + " recurses into its " + n2.kids.length + " children in order.")
        : st.act === "one"
        ? L("它实现了 Unwrap() error，下一层只有一个错误，于是在同一次调用中继续循环，不再递归。", "It implements Unwrap() error, so with only one error below, the same call keeps looping instead of recursing.")
        : L("它不再包装其他错误，这次调用返回 false。", "It wraps nothing, so this call returns false.");
      return s;
    }

    function draw() {
      var st = k >= 1 && k <= run.steps.length ? run.steps[k - 1] : null;
      if (k > run.steps.length) st = null;
      drawTree(st || (k > run.steps.length ? lastState() : null));
      drawSide(st);
      p.note.textContent = narrate(st);
      stepBtn.disabled = k > run.steps.length;
    }
    function lastState() { var s = run.steps[run.steps.length - 1]; return { node: run.ok ? s.node : null, order: s.order, match: run.ok, frames: [] }; }
    function stop() { if (timer) { clearInterval(timer); timer = null; } playBtn.textContent = L("自动播放", "Play"); }
    function rebuild() { stop(); run = trace(q, leaf); k = 0; draw(); }

    var stepBtn = V.button(p.bar, L("下一步", "Step"), function () { stop(); if (k <= run.steps.length) { k++; draw(); } });
    var playBtn = V.button(p.bar, L("自动播放", "Play"), function () {
      if (timer) { stop(); return; }
      if (k > run.steps.length) { k = 0; draw(); }
      playBtn.textContent = L("暂停", "Pause");
      timer = setInterval(function () {
        if (!host.isConnected) { stop(); return; }
        if (k <= run.steps.length) { k++; draw(); }
        if (k > run.steps.length) stop();
      }, 2200);
    });
    V.button(p.bar, L("从头", "Restart"), function () { stop(); k = 0; draw(); });
    V.select(p.bar, L("调用", "Call"), QUERIES.map(function (x) { return { value: x.id, label: x.code }; }), q.id,
      function (v) { q = QUERIES.filter(function (x) { return x.id === v; })[0]; rebuild(); });
    V.select(p.bar, L("PathError 包装的错误", "Error inside the PathError"), [
      { value: "enoent", label: "syscall.ENOENT" },
      { value: "notexist", label: "fs.ErrNotExist" },
    ], leaf, function (v) { leaf = v; rebuild(); });

    rebuild();
  });
})();
