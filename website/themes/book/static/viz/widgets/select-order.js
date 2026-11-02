/*
 * select-order: the two orders selectgo builds before it touches a channel
 * (book §10.5.3 and §10.5.4).
 *
 * Go 1.26 (src/runtime/select.go, selectgo):
 *   - pollorder: for each case with a non-nil channel, in scases order,
 *       j := cheaprandn(norder+1); pollorder[norder] = pollorder[j]; pollorder[j] = i
 *     cheaprandn (src/runtime/rand.go) maps a 32-bit random number to [0, n)
 *     by multiply and shift (Lemire's method); here the 32-bit number comes
 *     from Math.random.
 *   - lockorder: the heap sort in selectgo, keyed by hchan.sortkey() (the
 *     channel's address) and fed from pollorder, so cases on the same channel
 *     end up adjacent in a random relative order. sellock locks each channel
 *     once; selunlock unlocks in reverse.
 *   - pass 1 walks pollorder and takes the first case that can proceed.
 *   The compiler (src/cmd/compile/internal/walk/select.go, walkSelectCases)
 *   puts send cases at the front of scases and receive cases from the back
 *   (i = ncas - nrecvs), so in a receive-only select scases[i] is source case
 *   ncas-1-i. The figure shows that index next to each case.
 *
 * Before January 2011 (src/pkg/runtime/chan.c at 4f269d3060^, selectgo):
 *   p is a random 32-bit number with gcd(p, ncase) == 1, o is random, both
 *   taken mod ncase; the scase array is insertion-sorted by channel address
 *   (comparison >=, so equal channels end up reversed), and pass 1 visits
 *   scase[o], scase[o+p], ... (mod ncase). Russ Cox replaced it with an
 *   explicit permutation in commit 4f269d3060 ("runtime: make select fairer",
 *   issue 1425). Nil-channel cases never entered either scheme.
 *
 * The histogram repeats the select many times with fixed channel states, so
 * the reader can see Sherry's bias come back under the old scheme and vanish
 * under the current one.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace);font-variant-ligatures:none";

  // Channel addresses are made up but fixed, and deliberately not in name
  // order, so the lock order visibly differs from the order in the source.
  var ADDR = { a: 0xc000022120, b: 0xc0000220c0, c: 0xc000022060, d: 0xc000022180 };
  function hex(n) { return "0x" + n.toString(16); }
  var NILNAME = "e"; // the name shown for a channel variable that is nil

  var PRESETS = {
    sherry: { cases: ["c", "c", "c", "d"], ready: { c: true, d: false } },
    mixed: { cases: ["a", "b", null, "c", "a"], ready: { a: true, b: false, c: true } },
  };

  function rand32() { return Math.floor(Math.random() * 4294967296); }
  // cheaprandn: uint32((uint64(cheaprand()) * uint64(n)) >> 32)
  function cheaprandn(n) { return Math.floor(rand32() * n / 4294967296); }
  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }

  // Go 1.26. cases[k] is source case k; scases is the compiler's array.
  function runNew(cases, ready) {
    var n = cases.length, scases = [];
    for (var i = 0; i < n; i++) scases.push({ src: n - 1 - i, ch: cases[n - 1 - i] }); // receive-only
    var poll = [], norder = 0;
    for (i = 0; i < n; i++) {
      if (scases[i].ch == null) continue;
      var j = cheaprandn(norder + 1);
      poll[norder] = poll[j];
      poll[j] = i;
      norder++;
    }
    function key(si) { return ADDR[scases[si].ch]; }
    var lock = new Array(norder);
    for (i = 0; i < norder; i++) { // heap sort, as in selectgo
      var jj = i, c = key(poll[i]);
      while (jj > 0 && key(lock[(jj - 1) >> 1]) < c) { var k = (jj - 1) >> 1; lock[jj] = lock[k]; jj = k; }
      lock[jj] = poll[i];
    }
    for (i = norder - 1; i >= 0; i--) {
      var o = lock[i], co = key(o);
      lock[i] = lock[0];
      jj = 0;
      for (;;) {
        k = jj * 2 + 1;
        if (k >= i) break;
        if (k + 1 < i && key(lock[k]) < key(lock[k + 1])) k++;
        if (co < key(lock[k])) { lock[jj] = lock[k]; jj = k; continue; }
        break;
      }
      lock[jj] = o;
    }
    var pick = -1;
    for (i = 0; i < norder; i++) if (ready[scases[poll[i]].ch]) { pick = i; break; }
    return {
      poll: poll.map(function (si) { return scases[si].src; }),
      lock: lock.map(function (si) { return scases[si].src; }),
      pick: pick,
    };
  }

  // Before 2011. Cases with nil channels were never added to the select.
  function runOld(cases, ready) {
    var sc = [];
    cases.forEach(function (ch, k) { if (ch != null) sc.push({ src: k, ch: ch }); });
    var n = sc.length, p;
    do { p = rand32(); } while (gcd(p, n) !== 1);
    var o = rand32();
    p %= n; o %= n;
    for (var i = 1; i < n; i++) { // insertion sort by address, comparison >=
      var cas = sc[i], j = i;
      for (; j > 0 && ADDR[sc[j - 1].ch] >= ADDR[cas.ch]; j--) sc[j] = sc[j - 1];
      sc[j] = cas;
    }
    var visit = [], pos = o;
    for (i = 0; i < n; i++) { visit.push(pos); pos += p; if (pos >= n) pos -= n; }
    var pick = -1;
    for (i = 0; i < n; i++) if (ready[sc[visit[i]].ch]) { pick = i; break; }
    return {
      poll: visit.map(function (v) { return sc[v].src; }),
      lock: sc.map(function (s) { return s.src; }),
      pick: pick, o: o, p: p, visit: visit,
    };
  }

  V.register("select-order", function (host) {
    var p = V.panel(host, { title: L("select 的两套次序：随机轮询，按地址加锁", "select's two orders: poll at random, lock by address") });
    var root = V.svg("svg", { viewBox: "0 0 720 420", role: "img",
      "aria-label": L("select 语句、轮询次序、加锁次序与多次运行的统计", "A select statement, its poll order, its lock order, and counts over many runs") }, p.stage);
    var g = V.svg("g", null, root);

    var preset = "sherry", algo = "new", cases, ready, last = null, tally, total = 0, timer = null;

    function text(x, y, s, st, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: st || "font-size:12px", text: s }, g);
    }
    function box(x, y, w, h, color, op, dash) {
      return V.svg("rect", { x: x, y: y, width: w, height: h, rx: 5,
        style: "fill:" + color + ";fill-opacity:" + op + ";stroke:" + color + ";stroke-width:1.2" + (dash ? ";stroke-dasharray:3 3" : "") }, g);
    }
    function label(k) { return "#" + (k + 1); }
    function chName(k) { return cases[k] == null ? NILNAME : cases[k]; }
    function caseCode(k) { return "case <-" + chName(k) + ":"; }

    function reset(keepRun) {
      stop();
      var pr = PRESETS[preset];
      cases = pr.cases.slice();
      if (!keepRun) {
        ready = {};
        Object.keys(pr.ready).forEach(function (c) { ready[c] = pr.ready[c]; });
      }
      tally = cases.map(function () { return 0; });
      total = 0;
      last = null;
      buildToggles();
      draw();
      p.note.textContent = algo === "new"
        ? L("点「运行一次」执行一次 select：先洗出轮询次序，再按 channel 地址排出加锁次序，第一趟按轮询次序选出第一个就绪的 case。",
            "Press Run once to execute the select: shuffle a poll order, sort a lock order by channel address, then take the first ready case in poll order.")
        : L("2011 年以前的做法：随机选起点 o 和与 case 数互素的步长 p，在按地址排好序的 case 数组上依次访问 o, o+p, o+2p, …",
            "The scheme used before 2011: pick a random start o and a step p coprime with the number of cases, then visit o, o+p, o+2p, ... in the case array sorted by address.");
    }

    function run() {
      return algo === "new" ? runNew(cases, ready) : runOld(cases, ready);
    }
    function record(r) {
      if (r.pick >= 0) tally[r.poll[r.pick]]++;
      total++;
    }

    function readyCount() {
      var n = 0;
      cases.forEach(function (ch) { if (ch != null && ready[ch]) n++; });
      return n;
    }

    function draw() {
      while (g.firstChild) g.removeChild(g.firstChild);
      var n = cases.length;
      // --- the select statement --------------------------------------------
      text(12, 18, L("select 语句", "The select statement"), "font-size:12px;font-weight:600");
      text(12, 40, "select {", "font-size:12px;" + MONO);
      cases.forEach(function (ch, k) {
        var y = 60 + k * 20;
        text(26, y, caseCode(k), "font-size:12px;" + MONO);
        text(124, y, "// " + label(k), "font-size:11px;fill:var(--viz-muted);" + MONO);
        var st, col;
        if (ch == null) { st = L("nil，不参与", "nil, left out"); col = "var(--viz-muted)"; }
        else if (ready[ch]) { st = L("就绪", "ready"); col = "var(--viz-c3)"; }
        else { st = L("未就绪", "not ready"); col = "var(--viz-muted)"; }
        box(174, y - 13, 78, 18, col, ch != null && ready[ch] ? 0.16 : 0.06, ch == null);
        text(213, y, st, "font-size:11px;fill:" + col, "middle");
        if (algo === "new") text(262, y, "scases[" + (n - 1 - k) + "]", "font-size:10px;fill:var(--viz-muted);" + MONO);
      });
      text(12, 60 + n * 20, "}", "font-size:12px;" + MONO);
      // --- channel addresses ---------------------------------------------------
      var chans = [];
      cases.forEach(function (ch) { if (ch != null && chans.indexOf(ch) < 0) chans.push(ch); });
      chans.sort(function (x, y) { return ADDR[x] - ADDR[y]; });
      text(400, 18, L("channel 的地址（加锁的键）", "Channel addresses (the lock key)"), "font-size:12px;font-weight:600");
      chans.forEach(function (ch, i) {
        var y = 40 + i * 20;
        text(400, y, ch, "font-size:12px;font-weight:600;" + MONO);
        text(420, y, hex(ADDR[ch]), "font-size:12px;" + MONO);
        text(530, y, ready[ch] ? L("有值可收", "has a value") : L("无值可收", "nothing to receive"),
          "font-size:11px;fill:" + (ready[ch] ? "var(--viz-c3)" : "var(--viz-muted)"));
      });
      var ty = 40 + chans.length * 20;
      if (cases.indexOf(null) >= 0) {
        text(400, ty, NILNAME, "font-size:12px;font-weight:600;" + MONO);
        text(420, ty, "nil", "font-size:12px;" + MONO);
        text(530, ty, L("不参与轮询与加锁", "never polled or locked"), "font-size:11px;fill:var(--viz-muted)");
        ty += 20;
      }
      text(400, ty + 2, L("地址从小到大排列；同一 channel 只加一次锁。", "Sorted by address; each channel is locked once."),
        "font-size:11px;fill:var(--viz-muted)");

      // --- one run: poll order and lock order ----------------------------------
      var y0 = 60 + n * 20 + 36, CW = 74, X0 = 120;
      V.svg("line", { x1: 12, y1: y0 - 18, x2: 708, y2: y0 - 18, style: "stroke:var(--viz-line)" }, g);
      text(12, y0, algo === "new" ? "pollorder" : L("访问次序", "visit order"), "font-size:12px;font-weight:600;" + MONO);
      text(12, y0 + 52, algo === "new" ? "lockorder" : L("排序后的数组", "sorted array"), "font-size:12px;font-weight:600;" + MONO);
      if (!last) {
        text(X0, y0, L("（尚未运行）", "(not run yet)"), "font-size:12px;fill:var(--viz-muted)");
        text(X0, y0 + 52, L("（尚未运行）", "(not run yet)"), "font-size:12px;fill:var(--viz-muted)");
      } else {
        last.poll.forEach(function (k, i) {
          var x = X0 + i * CW, ch = cases[k];
          var picked = i === last.pick, skipped = last.pick < 0 || i < last.pick;
          var col = picked ? "var(--viz-c1)" : skipped ? "var(--viz-muted)" : "var(--viz-line)";
          box(x, y0 - 15, CW - 8, 22, col, picked ? 0.18 : 0.06);
          text(x + (CW - 8) / 2, y0, label(k) + " <-" + ch, "font-size:12px;text-anchor:middle;" + MONO);
          var tag = picked ? L("选中", "chosen") : skipped ? L("未就绪", "not ready") : L("不再检查", "not checked");
          text(x + (CW - 8) / 2, y0 + 20, tag, "font-size:10px;text-anchor:middle;fill:" + (picked ? "var(--viz-c1)" : "var(--viz-muted)"));
        });
        // lock order with one lock per channel
        var prev = null, runStart = 0;
        last.lock.forEach(function (k, i) {
          var x = X0 + i * CW, ch = cases[k];
          box(x, y0 + 37, CW - 8, 22, "var(--viz-c4)", 0.1);
          text(x + (CW - 8) / 2, y0 + 52, label(k) + " <-" + ch, "font-size:12px;text-anchor:middle;" + MONO);
          var endRun = i === last.lock.length - 1 || cases[last.lock[i + 1]] !== ch;
          if (ch !== prev) runStart = i;
          if (endRun) {
            var xa = X0 + runStart * CW, xb = x + CW - 8;
            V.svg("path", { d: "M" + xa + "," + (y0 + 68) + " v4 H" + xb + " v-4",
              style: "fill:none;stroke:var(--viz-c4);stroke-width:1" }, g);
            text((xa + xb) / 2, y0 + 84, "lock(" + ch + ")", "font-size:10px;text-anchor:middle;fill:var(--viz-c4);" + MONO);
          }
          prev = ch;
        });
        if (algo === "old") text(708, y0 + 20, "o = " + last.o + ", p = " + last.p, "font-size:11px;fill:var(--viz-muted);" + MONO, "end");
      }

      // --- histogram ------------------------------------------------------------
      var hy = y0 + 110;
      root.setAttribute("viewBox", "0 0 720 " + (hy + 18 + n * 21));
      V.svg("line", { x1: 12, y1: hy - 20, x2: 708, y2: hy - 20, style: "stroke:var(--viz-line)" }, g);
      text(12, hy, total
        ? L("运行 " + total + " 次，各 case 被选中的次数", "Times each case was chosen in " + total + " runs")
        : L("多次运行的统计（尚无数据）", "Counts over many runs (no data yet)"), "font-size:12px;font-weight:600");
      var rc = readyCount(), BX = 120, BW = 460;
      text(708, hy, L("虚线：均匀时的期望", "dashed: expected if uniform"), "font-size:11px;fill:var(--viz-muted)", "end");
      cases.forEach(function (ch, k) {
        var y = hy + 12 + k * 21;
        text(12, y + 12, label(k) + " <-" + chName(k), "font-size:12px;" + MONO);
        V.svg("rect", { x: BX, y: y + 1, width: BW, height: 14, rx: 2, style: "fill:var(--viz-fill);stroke:var(--viz-line)" }, g);
        var share = total ? tally[k] / total : 0;
        if (share > 0) box(BX, y + 1, BW * share, 14, "var(--viz-c1)", 0.3);
        var exp = ch != null && ready[ch] && rc ? 1 / rc : 0;
        if (exp > 0) V.svg("line", { x1: BX + BW * exp, y1: y - 2, x2: BX + BW * exp, y2: y + 18,
          style: "stroke:var(--viz-ink);stroke-width:1.2;stroke-dasharray:3 2" }, g);
        if (total) text(BX + BW + 8, y + 12, tally[k] + "  (" + (100 * share).toFixed(1) + "%)", "font-size:11px;" + MONO);
      });
    }

    function narrate(r) {
      var parts = [];
      if (algo === "new") {
        parts.push(L("pollorder 是一个随机排列：", "pollorder is a random permutation: ") +
          r.poll.map(label).join(L("、", ", ")) + L("。", "."));
        var chs = [];
        r.lock.forEach(function (k) { var c = cases[k]; if (chs.indexOf(c) < 0) chs.push(c); });
        parts.push(L("lockorder 按地址排序，依次锁住 ", "lockorder sorts by address and locks ") + chs.join(L("、", ", ")) +
          (hasDup() ? L("；同一 channel 的 case 相邻，只锁一次，它们之间的先后来自 pollorder。",
            "; cases on one channel sit together and are locked once, in an order inherited from pollorder.") : L("。", ".")));
      } else {
        parts.push(L("o = " + r.o + "，p = " + r.p + "：依次访问排序后数组的位置 " + r.visit.join("、") + "。",
          "o = " + r.o + ", p = " + r.p + ": visit positions " + r.visit.join(", ") + " of the sorted array."));
      }
      if (r.pick < 0) parts.push(L("没有 case 就绪：没有 default 的 select 将进入第二趟，在每个 channel 上排队。",
        "No case is ready: without a default, select goes on to pass 2 and queues on every channel."));
      else {
        var skipped = r.poll.slice(0, r.pick).map(label);
        parts.push(L("第一趟" + (skipped.length ? "跳过未就绪的 " + skipped.join("、") + "，" : "") + "选中 " + label(r.poll[r.pick]) + "。",
          "Pass 1 " + (skipped.length ? "skips " + skipped.join(", ") + " (not ready) and " : "") + "chooses " + label(r.poll[r.pick]) + "."));
      }
      p.note.textContent = parts.join(L("", " "));
    }

    function hasDup() {
      var seen = {}, dup = false;
      cases.forEach(function (ch) { if (ch != null) { if (seen[ch]) dup = true; seen[ch] = true; } });
      return dup;
    }
    function summary() {
      if (!total) return;
      var rc = readyCount();
      if (!rc) {
        p.note.textContent = L("没有就绪的 case：每次都要进入第二趟，在所有 channel 上排队。", "No case is ready: every run goes on to pass 2 and queues on every channel.");
        return;
      }
      var idle = cases.filter(function (ch) { return ch != null && !ready[ch]; }).length;
      var lines = cases.map(function (ch, k) { return ch != null && ready[ch] ? label(k) + " " + (100 * tally[k] / total).toFixed(1) + "%" : null; })
        .filter(Boolean).join(L("，", ", "));
      var msg = L("就绪的 case 各被选中：" + lines + "。", "Ready cases were chosen: " + lines + ". ");
      if (rc > 1) msg += algo === "new"
        ? L("在随机排列中，每个就绪的 case 排在其他就绪 case 之前的机会相同，期望各为 " + (100 / rc).toFixed(1) + "%，与混入多少个未就绪的 case 无关。",
            "In a random permutation every ready case is equally likely to come first among the ready ones, " + (100 / rc).toFixed(1) + "% each, however many cases are not ready.")
        : idle
          ? L("紧随未就绪 case 之后被访问的 case 多得了机会：起点每次落在未就绪的 case 上，选中的都是访问次序中的下一个。",
              "Cases visited right after a never-ready case get extra chances: whenever the start lands on the never-ready case, the next one in the visit order wins.")
          : L("所有 case 都就绪时，选中的就是起点，起点是均匀的，这种做法也就是公平的。",
              "When every case is ready, the start itself is chosen; the start is uniform, so the scheme is fair.");
      p.note.textContent = msg;
    }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      if (manyBtn) manyBtn.textContent = L("运行 4000 次", "Run 4000 times");
    }

    V.button(p.bar, L("运行一次", "Run once"), function () {
      stop();
      last = run(); record(last); draw(); narrate(last);
    });
    var manyBtn = V.button(p.bar, L("运行 4000 次", "Run 4000 times"), function () {
      if (timer) { stop(); summary(); return; }
      var left = 4000;
      manyBtn.textContent = L("停止", "Stop");
      timer = setInterval(function () {
        if (!host.isConnected) { stop(); return; }
        for (var i = 0; i < 200 && left > 0; i++, left--) { last = run(); record(last); }
        draw();
        if (left <= 0) { stop(); summary(); }
      }, 40);
    });
    V.button(p.bar, L("清空", "Clear"), function () { reset(true); });
    V.select(p.bar, L("算法", "Algorithm"), [
      { value: "new", label: L("Go 1.26：随机排列", "Go 1.26: random permutation") },
      { value: "old", label: L("2011 年以前：起点加步长", "Before 2011: start plus step") },
    ], "new", function (v) { algo = v; reset(true); });
    V.select(p.bar, L("示例", "Example"), [
      { value: "sherry", label: L("三个 case 读 c，一个读 d", "three cases on c, one on d") },
      { value: "mixed", label: L("四个 channel 与一个 nil", "four channels and a nil") },
    ], "sherry", function (v) { preset = v; reset(false); });
    var toggles = V.el("span", { style: "display:inline-flex;gap:6px;flex-wrap:wrap" }, p.bar);
    function buildToggles() {
      while (toggles.firstChild) toggles.removeChild(toggles.firstChild);
      Object.keys(ready).sort().forEach(function (ch) {
        var b = V.button(toggles, ch + (ready[ch] ? L(" 就绪", " ready") : L(" 未就绪", " not ready")),
          function () { ready[ch] = !ready[ch]; reset(true); });
        b.classList.toggle("is-on", !!ready[ch]);
        b.setAttribute("aria-pressed", ready[ch] ? "true" : "false");
      });
    }

    reset(false);
  });
})();
