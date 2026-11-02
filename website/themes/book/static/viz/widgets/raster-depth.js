/*
 * raster-depth: rasterization by pixel centers, barycentric depth and the
 * depth test, for two interpenetrating triangles (book §19.1.1).
 *
 * The rules follow the WebGPU specification (W3C Candidate Recommendation
 * Draft, cited by the chapter), "Detailed Operations":
 *   §23.2.5.4 Polygon Rasterization: without multisampling, fragments are
 *     associated with pixel centers, the points C with fract(C) = (0.5, 0.5)
 *     in framebuffer space (x right, y down) that the polygon encloses; a
 *     center exactly on an edge is undefined, so the vertices below are
 *     chosen so that no center lies on an edge;
 *   §23.2.5.3 Barycentric coordinates: b_i is the area of the triangle with
 *     v_i replaced by p, divided by the triangle's area (signed areas here,
 *     so a negative b_i means p is outside);
 *   the fragment's depth is Σ b_i × d_i over the vertex depths;
 *   §23.2.6 "compare fragment" with a GPUCompareFunction: "less" passes when
 *     the fragment's depth is less than the attachment's value, "greater"
 *     when greater, "always" always; a passing fragment writes color and,
 *     with depth writes enabled, its depth.
 * The specification has no default compare function; the figure lets the
 * reader pick one, and clears the depth buffer to 1.0 (0.0 for "greater"),
 * the values an application would pass as depthClearValue.
 *
 * The scan order inside a triangle (row by row over its bounding box) is the
 * figure's choice; a GPU tests many pixels in parallel. The order of the two
 * triangles is submission order, which the specification says affects the
 * depth test: with "always" the later triangle simply wins.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;

  var COLS = 24, ROWS = 16, CELL = 14;
  var TRIS = {
    A: { color: "var(--viz-c1)", v: [[1.6, 2.3, 0.15], [21.4, 4.8, 0.85], [5.3, 15.2, 0.45]] },
    B: { color: "var(--viz-c2)", v: [[9.2, 0.9, 0.90], [22.7, 13.6, 0.20], [2.4, 10.6, 0.55]] },
  };
  function area(a, b, c) { return 0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])); }
  function bary(T, p) {
    var v = T.v, A = area(v[0], v[1], v[2]);
    return [area(p, v[1], v[2]) / A, area(v[0], p, v[2]) / A, area(v[0], v[1], p) / A];
  }
  function depthOf(T, b) { return b[0] * T.v[0][2] + b[1] * T.v[1][2] + b[2] * T.v[2][2]; }
  function bbox(T) {
    var xs = T.v.map(function (q) { return q[0]; }), ys = T.v.map(function (q) { return q[1]; });
    return { x0: Math.max(0, Math.floor(Math.min.apply(null, xs))), x1: Math.min(COLS - 1, Math.ceil(Math.max.apply(null, xs)) - 1),
      y0: Math.max(0, Math.floor(Math.min.apply(null, ys))), y1: Math.min(ROWS - 1, Math.ceil(Math.max.apply(null, ys)) - 1) };
  }
  function f2(x) { return x.toFixed(2); }
  // A barycentric coordinate: two significant digits when it would round to zero.
  function fb(x) { return (Math.abs(x) < 0.005 ? x.toPrecision(2) : x.toFixed(2)).replace("-", "−"); }
  var SUB = ["₁", "₂", "₃"];

  V.register("raster-depth", function (host) {
    var p = V.panel(host, { title: L("光栅化与深度测试：两个相互穿插的三角形", "Rasterization and the depth test: two interpenetrating triangles") });
    var root = V.svg("svg", { viewBox: "0 0 720 312", role: "img",
      "aria-label": L("颜色缓冲与深度缓冲的像素网格", "Pixel grids of the color buffer and the depth buffer") }, p.stage);
    var GX = [8, 376], GY = 34;
    var gGrid = V.svg("g", null, root), gOver = V.svg("g", null, root), gText = V.svg("g", null, root);

    function text(parent, x, y, s, st) { return V.svg("text", { x: x, y: y, style: st || "font-size:12px", text: s }, parent); }

    // Cells, built once and restyled on every change.
    var cells = [[], []];
    for (var gi = 0; gi < 2; gi++) for (var i = 0; i < ROWS * COLS; i++) {
      (function (gi, i) {
        cells[gi].push(V.svg("rect", { x: GX[gi] + (i % COLS) * CELL, y: GY + Math.floor(i / COLS) * CELL,
          width: CELL, height: CELL, style: "cursor:pointer",
          on: { click: function () { stop(); inspect(i); } } }, gGrid));
      })(gi, i);
    }

    var order = ["A", "B"], cmp = "less", st, timer = null;

    function reset() {
      stop();
      var clear = cmp === "greater" ? 0 : 1;
      st = { color: [], depth: [], owner: [], ti: 0, x: null, y: null, cur: null, written: 0, dropped: 0, clear: clear, done: false };
      for (var i = 0; i < ROWS * COLS; i++) { st.color.push(null); st.depth.push(clear); st.owner.push(null); }
      start(0);
    }
    function start(ti) {
      st.ti = ti;
      if (ti >= order.length) { st.done = true; st.x = st.y = null; return; }
      var b = bbox(TRIS[order[ti]]);
      st.box = b; st.x = b.x0; st.y = b.y0;
    }
    function pass(d, old) { return cmp === "always" ? true : cmp === "less" ? d < old : d > old; }

    // Process the pixel under the cursor, then advance. Returns a description.
    function stepPixel() {
      if (st.done) return null;
      var name = order[st.ti], T = TRIS[name], x = st.x, y = st.y, i = y * COLS + x;
      var b = bary(T, [x + 0.5, y + 0.5]), r = { name: name, x: x, y: y, i: i, b: b };
      r.inside = b[0] >= 0 && b[1] >= 0 && b[2] >= 0;
      if (r.inside) {
        r.d = depthOf(T, b); r.old = st.depth[i]; r.oldOwner = st.owner[i];
        r.pass = pass(r.d, r.old);
        if (r.pass) { st.color[i] = T.color; st.depth[i] = r.d; st.owner[i] = name; st.written++; } else st.dropped++;
      }
      st.cur = r;
      if (++st.x > st.box.x1) { st.x = st.box.x0; if (++st.y > st.box.y1) start(st.ti + 1); }
      return r;
    }

    function draw() {
      for (var i = 0; i < ROWS * COLS; i++) {
        var c = st.color[i];
        cells[0][i].setAttribute("style", "cursor:pointer;stroke:var(--viz-line);stroke-width:.5;" +
          (c ? "fill:" + c + ";fill-opacity:.78" : "fill:var(--viz-fill)"));
        var w = st.owner[i] != null;
        cells[1][i].setAttribute("style", "cursor:pointer;stroke:var(--viz-line);stroke-width:.5;" +
          (w ? "fill:var(--viz-c4);fill-opacity:" + (0.1 + 0.85 * (1 - st.depth[i])).toFixed(3) : "fill:var(--viz-fill)"));
      }
      while (gOver.firstChild) gOver.removeChild(gOver.firstChild);
      while (gText.firstChild) gText.removeChild(gText.firstChild);
      // Triangle outlines on both grids, vertex depths on the color grid.
      order.forEach(function (name) {
        var T = TRIS[name];
        for (var g = 0; g < 2; g++) {
          var pts = T.v.map(function (q) { return (GX[g] + q[0] * CELL).toFixed(1) + "," + (GY + q[1] * CELL).toFixed(1); }).join(" ");
          V.svg("polygon", { points: pts, style: "fill:none;stroke:" + T.color + ";stroke-width:1.4;stroke-linejoin:round" }, gOver);
        }
        var cx = 0, cy = 0;
        T.v.forEach(function (q) { cx += q[0] / 3; cy += q[1] / 3; });
        T.v.forEach(function (q) {
          var dx = q[0] - cx, dy = q[1] - cy, n = Math.sqrt(dx * dx + dy * dy) || 1;
          var lx = GX[0] + q[0] * CELL + dx / n * 14, ly = GY + q[1] * CELL + dy / n * 12 + 4;
          lx = Math.max(GX[0] + 12, Math.min(GX[0] + COLS * CELL - 12, lx));
          ly = Math.max(GY + 10, Math.min(GY + ROWS * CELL - 3, ly));
          V.svg("circle", { cx: GX[0] + q[0] * CELL, cy: GY + q[1] * CELL, r: 2.5, style: "fill:" + T.color }, gOver);
          var t = text(gOver, lx, ly, q[2].toFixed(2), "font-size:10px;text-anchor:middle;font-weight:600;paint-order:stroke;stroke:var(--viz-fill);stroke-width:3;fill:" + T.color);
          t.style.fill = T.color;
        });
      });
      // Bounding box of the triangle being rasterized and the current pixel.
      if (!st.done && st.box) {
        var b = st.box;
        V.svg("rect", { x: GX[0] + b.x0 * CELL, y: GY + b.y0 * CELL, width: (b.x1 - b.x0 + 1) * CELL, height: (b.y1 - b.y0 + 1) * CELL,
          style: "fill:none;stroke:var(--viz-muted);stroke-dasharray:3 3" }, gOver);
      }
      if (st.cur) {
        for (var g = 0; g < 2; g++) {
          var px = GX[g] + st.cur.x * CELL, py = GY + st.cur.y * CELL;
          V.svg("rect", { x: px - 1, y: py - 1, width: CELL + 2, height: CELL + 2, style: "fill:none;stroke:var(--viz-ink);stroke-width:2" }, gOver);
          V.svg("circle", { cx: px + CELL / 2, cy: py + CELL / 2, r: 1.8, style: "fill:var(--viz-ink)" }, gOver);
        }
      }
      // Titles and legend.
      text(gText, GX[0], 24, L("颜色缓冲", "Color buffer"), "font-size:12px;font-weight:600");
      text(gText, GX[1], 24, L("深度缓冲（色块越浓，深度值越小）", "Depth buffer (a stronger shade is a smaller depth)"), "font-size:12px;font-weight:600");
      var ly = GY + ROWS * CELL + 22;
      order.forEach(function (name, k) {
        var T = TRIS[name], y = ly + k * 18;
        V.svg("rect", { x: GX[0], y: y - 10, width: 12, height: 12, rx: 2, style: "fill:" + T.color + ";fill-opacity:.78" }, gText);
        text(gText, GX[0] + 18, y, L("三角形 " + name + "（第 " + (k + 1) + " 个绘制）：顶点深度 " + T.v.map(function (q) { return q[2].toFixed(2); }).join("、"),
          "Triangle " + name + " (drawn " + (k ? "second" : "first") + "): vertex depths " + T.v.map(function (q) { return q[2].toFixed(2); }).join(", ")), "font-size:11px");
      });
      text(gText, GX[1], ly, L("比较函数 " + cmp + "，清除值 " + st.clear.toFixed(1), "Compare function " + cmp + ", cleared to " + st.clear.toFixed(1)), "font-size:11px");
      text(gText, GX[1], ly + 18, L("已写入 " + st.written + " 个片元，丢弃 " + st.dropped + " 个", st.written + " fragments written, " + st.dropped + " discarded"),
        "font-size:11px;fill:var(--viz-muted)");
    }

    function describe(r) {
      var head = L("三角形 " + r.name + "，像素 (" + r.x + ", " + r.y + ")：中心 (" + (r.x + 0.5) + ", " + (r.y + 0.5) + ")",
        "Triangle " + r.name + ", pixel (" + r.x + ", " + r.y + "): the center (" + (r.x + 0.5) + ", " + (r.y + 0.5) + ")");
      if (!r.inside) {
        var k = r.b[0] < 0 ? 0 : r.b[1] < 0 ? 1 : 2;
        return head + L(" 落在三角形之外（b" + SUB[k] + " = " + fb(r.b[k]) + " < 0），不生成片元。",
          " is outside the triangle (b" + SUB[k] + " = " + fb(r.b[k]) + " < 0), so no fragment is produced.");
      }
      var bs = "(" + r.b.map(f2).join(", ") + ")";
      var was = r.oldOwner ? L("三角形 " + r.oldOwner + " 写入的 " + f2(r.old), f2(r.old) + ", written by triangle " + r.oldOwner)
        : L("清除值 " + r.old.toFixed(2), "the clear value " + r.old.toFixed(2));
      var s = head + L(" 在三角形内，重心坐标 " + bs + "，深度 Σ bᵢdᵢ = " + f2(r.d) + "。深度缓冲中为" + was + "。",
        " is inside, with barycentric coordinates " + bs + " and depth Σ bᵢdᵢ = " + f2(r.d) + ". The depth buffer holds " + was + ". ");
      if (cmp === "always") return s + L("比较函数为 always，总是通过：写入颜色与深度。", "The compare function is always, so it passes: color and depth are written.");
      var op = cmp === "less" ? " < " : " > ";
      return s + (r.pass
        ? L(f2(r.d) + op + f2(r.old) + " 成立，通过比较，写入颜色与深度。", f2(r.d) + op + f2(r.old) + " holds, so the fragment passes and writes color and depth.")
        : L(f2(r.d) + op + f2(r.old) + " 不成立，片元被丢弃。", f2(r.d) + op + f2(r.old) + " does not hold, so the fragment is discarded."));
    }
    function summary() {
      var s = cmp === "always"
        ? L("比较函数为 always 时，深度测试形同虚设：后绘制的三角形 " + order[1] + " 覆盖了重叠区域，结果取决于提交顺序。把顺序调换，画面随之改变。",
            "With always, the depth test does nothing: triangle " + order[1] + ", drawn last, covers the whole overlap, so the result depends on submission order. Swap the order and the image changes.")
        : L("两个三角形在重叠区域相互穿插：每个像素保留深度更" + (cmp === "less" ? "小" : "大") + "的片元，交线由逐像素的比较自然得出，与绘制顺序无关。点像素可以查看它的重心坐标与深度，点「重置」后可以逐像素观察。",
            "The triangles interpenetrate in the overlap: each pixel keeps the fragment with the " + (cmp === "less" ? "smaller" : "larger") + " depth, so the intersection line falls out of per-pixel comparisons, whatever the drawing order. Click a pixel to see its barycentric coordinates and depth, or press Reset to step pixel by pixel.");
      p.note.textContent = s;
    }
    function inspect(i) {
      var x = i % COLS, y = Math.floor(i / COLS), parts = [];
      order.forEach(function (name) {
        var b = bary(TRIS[name], [x + 0.5, y + 0.5]);
        parts.push(b.every(function (v) { return v >= 0; })
          ? L("在三角形 " + name + " 内，重心坐标 (" + b.map(f2).join(", ") + ")，深度 " + f2(depthOf(TRIS[name], b)),
              "inside triangle " + name + ", barycentric (" + b.map(f2).join(", ") + "), depth " + f2(depthOf(TRIS[name], b)))
          : L("不在三角形 " + name + " 内", "outside triangle " + name));
      });
      var own = st.owner[i];
      p.note.textContent = L("像素 (" + x + ", " + y + ")，中心 (" + (x + 0.5) + ", " + (y + 0.5) + ")：" + parts.join("；") + "。" +
          (own ? "目前缓冲中保留三角形 " + own + " 的片元，深度 " + f2(st.depth[i]) + "。" : "目前缓冲中仍是清除值。"),
        "Pixel (" + x + ", " + y + "), center (" + (x + 0.5) + ", " + (y + 0.5) + "): " + parts.join("; ") + ". " +
          (own ? "The buffer now holds triangle " + own + "'s fragment, depth " + f2(st.depth[i]) + "." : "The buffer still holds the clear value."));
    }

    function finish() { stop(); while (!st.done) stepPixel(); st.cur = null; draw(); summary(); }
    function one() {
      var r = stepPixel();
      if (!r) { st.cur = null; draw(); summary(); return false; }
      draw(); p.note.textContent = describe(r);
      if (st.done) { p.note.textContent += L("两个三角形都已光栅化完毕。", " Both triangles are rasterized."); }
      return !st.done;
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } if (playBtn) playBtn.textContent = L("自动播放", "Play"); }

    V.button(p.bar, L("下一个像素", "Next pixel"), function () { stop(); if (st.done) reset(); one(); });
    V.button(p.bar, L("下一行", "Next row"), function () {
      stop(); if (st.done) reset();
      var y = st.y, ti = st.ti, r = null, inside = 0, passed = 0;
      while (!st.done && st.y === y && st.ti === ti) { r = stepPixel(); if (r.inside) { inside++; if (r.pass) passed++; } }
      draw();
      p.note.textContent = L("三角形 " + r.name + " 的第 " + r.y + " 行：" + inside + " 个像素中心落在三角形内，其中 " + passed + " 个片元通过深度比较。",
        "Row " + r.y + " of triangle " + r.name + ": " + inside + " pixel centers are inside, and " + passed + " of those fragments pass the depth comparison.");
    });
    var playBtn = V.button(p.bar, L("自动播放", "Play"), function () {
      if (timer) { stop(); return; }
      if (st.done) reset();
      playBtn.textContent = L("暂停", "Pause");
      timer = setInterval(function () {
        if (!host.isConnected) { stop(); return; }
        if (!one()) stop();
      }, 45);
    });
    V.button(p.bar, L("画完", "Finish"), finish);
    V.button(p.bar, L("重置", "Reset"), function () {
      reset(); draw();
      p.note.textContent = L("缓冲已清除。每一步检查当前三角形包围盒中的一个像素：中心是否在三角形内，若在，插值出深度并与深度缓冲比较。",
        "The buffers are cleared. Each step tests one pixel in the current triangle's bounding box: is its center inside, and if so, how does its interpolated depth compare with the depth buffer?");
    });
    V.select(p.bar, L("深度比较", "Depth compare"), ["less", "greater", "always"].map(function (c) { return { value: c, label: c }; }),
      "less", function (v) { cmp = v; reset(); finish(); });
    V.select(p.bar, L("绘制顺序", "Order"), [
      { value: "AB", label: L("A 先，B 后", "A, then B") },
      { value: "BA", label: L("B 先，A 后", "B, then A") },
    ], "AB", function (v) { order = v.split(""); reset(); finish(); });

    reset(); finish();
  });
})();
