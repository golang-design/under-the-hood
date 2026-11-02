/*
 * race-vclock: how the race detector orders accesses with vector clocks
 * (book §16.2.2).
 *
 * The update rules are the ones the Go runtime drives in ThreadSanitizer
 * (the LLVM revision named in src/runtime/race/README for Go 1.26; the
 * __tsan_* entry points are in tsan_go.cpp, ThreadCreate and ThreadStart in
 * tsan_rtl_thread.cpp, Acquire, Release and ReleaseStore in
 * tsan_rtl_mutex.cpp, DoReportRace in tsan_rtl_access.cpp):
 *   go f()        runtime.racegostart -> __tsan_go_start -> ThreadCreate:
 *                 the parent's clock is stored for the child (ReleaseStore)
 *                 and the parent's own component is incremented; the child
 *                 acquires it when it starts (ThreadStart).
 *   release       racerelease -> __tsan_release -> ReleaseStore:
 *                 L_m <- C_t, then C_t[t]++. Used by sync.Mutex.Unlock
 *                 (internal/sync/mutex.go) and by channels.
 *   release-merge racereleasemerge -> __tsan_release_merge -> Release:
 *                 L_m <- L_m join C_t, then C_t[t]++. Used by
 *                 sync.WaitGroup.Add with a negative delta (Done).
 *   acquire       raceacquire -> __tsan_acquire -> Acquire: C_t <- C_t join
 *                 L_m; nothing happens if m has no clock yet. Used by
 *                 Mutex.Lock and when WaitGroup.Wait returns.
 *   unbuffered    runtime.racesync (chan.go): the sender releases, the
 *   channel       receiver acquires, the receiver releases, the sender
 *                 acquires, so the hand-off orders both directions.
 *   access        an earlier access at epoch c@u is ordered before this one
 *                 by t iff c <= C_t[u]; two unordered accesses, at least one
 *                 a write, are a race. After a report DoReportRace
 *                 (tsan_rtl_access.cpp) overwrites the shadow cells "to
 *                 prevent trapping on this address in future", which is why
 *                 the counter program reports one race.
 * As in the book, each goroutine's own component starts at 1. time.Sleep
 * is not a synchronization operation and calls none of the above. The
 * shadow is simplified to the latest access of each goroutine. The counter
 * program runs in the order of the book's GOMAXPROCS=1 run: main blocks in
 * wg.Wait, the goroutine created last runs first (it sits in runnext).
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace)";

  // op kinds: go, start, acq, rel, relm, chan, r, w, nop
  function op(g, k, a, zh, en) { return { g: g, k: k, a: a || {}, zh: zh, en: en }; }
  var RD = ["读 counter", "read counter"], WR = ["写 counter", "write counter"];
  var SCENES = {
    counter: {
      label: { zh: "计数器：只用 WaitGroup", en: "Counter with only a WaitGroup" },
      gs: ["main", "G1", "G2"], v: "counter",
      ops: [
        op("main", "go", { child: "G1" }, "go G1", "go G1"),
        op("main", "go", { child: "G2" }, "go G2", "go G2"),
        op("G2", "start", {}, "开始运行", "starts"),
        op("G2", "r", {}, RD[0], RD[1]),
        op("G2", "w", {}, WR[0], WR[1]),
        op("G2", "relm", { obj: "wg" }, "wg.Done()", "wg.Done()"),
        op("G1", "start", {}, "开始运行", "starts"),
        op("G1", "r", {}, RD[0], RD[1]),
        op("G1", "w", {}, WR[0], WR[1]),
        op("G1", "relm", { obj: "wg" }, "wg.Done()", "wg.Done()"),
        op("main", "acq", { obj: "wg" }, "wg.Wait()", "wg.Wait()"),
        op("main", "r", {}, RD[0], RD[1]),
      ],
    },
    mutex: {
      label: { zh: "计数器：加上互斥锁", en: "Counter with a mutex" },
      gs: ["main", "G1", "G2"], v: "counter",
      ops: [
        op("main", "go", { child: "G1" }, "go G1", "go G1"),
        op("main", "go", { child: "G2" }, "go G2", "go G2"),
        op("G2", "start", {}, "开始运行", "starts"),
        op("G2", "acq", { obj: "mu" }, "mu.Lock()", "mu.Lock()"),
        op("G2", "r", {}, RD[0], RD[1]),
        op("G2", "w", {}, WR[0], WR[1]),
        op("G2", "rel", { obj: "mu" }, "mu.Unlock()", "mu.Unlock()"),
        op("G2", "relm", { obj: "wg" }, "wg.Done()", "wg.Done()"),
        op("G1", "start", {}, "开始运行", "starts"),
        op("G1", "acq", { obj: "mu" }, "mu.Lock()", "mu.Lock()"),
        op("G1", "r", {}, RD[0], RD[1]),
        op("G1", "w", {}, WR[0], WR[1]),
        op("G1", "rel", { obj: "mu" }, "mu.Unlock()", "mu.Unlock()"),
        op("G1", "relm", { obj: "wg" }, "wg.Done()", "wg.Done()"),
        op("main", "acq", { obj: "wg" }, "wg.Wait()", "wg.Wait()"),
        op("main", "r", {}, RD[0], RD[1]),
      ],
    },
    sleep: {
      label: { zh: "用 time.Sleep 代替同步", en: "time.Sleep instead of sync" },
      gs: ["main", "G"], v: "ready",
      ops: [
        op("main", "go", { child: "G" }, "go G", "go G"),
        op("main", "nop", {}, "time.Sleep(100ms)", "time.Sleep(100ms)"),
        op("G", "start", {}, "开始运行", "starts"),
        op("G", "w", {}, "ready = true", "ready = true"),
        op("main", "r", {}, "Println(ready)", "Println(ready)"),
      ],
    },
    chan: {
      label: { zh: "用无缓冲通道同步", en: "Sync by an unbuffered channel" },
      gs: ["main", "G"], v: "x",
      ops: [
        op("main", "go", { child: "G" }, "go G", "go G"),
        op("G", "start", {}, "开始运行", "starts"),
        op("G", "w", {}, "x = 1", "x = 1"),
        op("G", "chan", { obj: "done", peer: "main", pzh: "<-done 返回", pen: "<-done returns" }, "done <- true", "done <- true"),
        op("main", "r", {}, "Println(x)", "Println(x)"),
      ],
    },
  };

  // ---- the detector ---------------------------------------------------
  function simulate(sc) {
    var gs = sc.gs, C = {}, S = {}, Lm = {}, acc = [], reported = null, states = [];
    var goSrc = {}, objSrc = {};
    gs.forEach(function (g) { C[g] = {}; gs.forEach(function (u) { C[g][u] = u === g ? 1 : 0; }); });
    function copy(v) { var o = {}; Object.keys(v).forEach(function (k) { o[k] = v[k]; }); return o; }
    function join(a, b) { Object.keys(b).forEach(function (k) { if (b[k] > a[k]) a[k] = b[k]; }); }
    sc.ops.forEach(function (o, i) {
      var g = o.g, ev = { op: o, i: i, changed: {}, before: copy(C[g]), src: [] }, t = C[g];
      switch (o.k) {
        case "go":
          S[o.a.child] = copy(t); goSrc[o.a.child] = i; t[g]++; ev.stored = copy(S[o.a.child]); break;
        case "start":
          ev.from = copy(S[g]); ev.src = [goSrc[g]]; join(t, S[g]); break;
        case "acq":
          if (Lm[o.a.obj]) { ev.from = copy(Lm[o.a.obj]); ev.src = objSrc[o.a.obj].slice(); join(t, Lm[o.a.obj]); }
          else ev.none = true;
          break;
        case "rel":
          Lm[o.a.obj] = copy(t); objSrc[o.a.obj] = [i]; t[g]++; break;
        case "relm":
          ev.prev = Lm[o.a.obj] ? copy(Lm[o.a.obj]) : null;
          if (!Lm[o.a.obj]) { Lm[o.a.obj] = {}; gs.forEach(function (u) { Lm[o.a.obj][u] = 0; }); }
          join(Lm[o.a.obj], t);
          objSrc[o.a.obj] = (objSrc[o.a.obj] || []).concat([i]);
          t[g]++; break;
        case "chan": {
          var u = o.a.peer, m = o.a.obj;
          ev.peerBefore = copy(C[u]);
          Lm[m] = copy(t); t[g]++;                 // sender: release
          ev.l1 = copy(Lm[m]); ev.mid = copy(t);
          join(C[u], Lm[m]);                       // receiver: acquire
          ev.peerAfterAcq = copy(C[u]);
          Lm[m] = copy(C[u]); C[u][u]++;           // receiver: release
          ev.l2 = copy(Lm[m]);
          join(t, Lm[m]);                          // sender: acquire
          ev.changed[u] = true;
          break;
        }
        case "r": case "w": {
          var epoch = t[g], conflicts = [];
          ev.epoch = epoch;
          if (reported) ev.suppressed = true;
          else acc.forEach(function (p) {
            if (p.g === g || (p.k === "r" && o.k === "r")) return;
            conflicts.push({ p: p, ordered: p.c <= t[p.g], seen: t[p.g] });
          });
          ev.checks = conflicts;
          var race = conflicts.filter(function (c) { return !c.ordered; })[0];
          if (race) { ev.race = race; reported = { cur: { g: g, k: o.k, c: epoch, i: i }, prev: race.p }; }
          // keep one access per goroutine; a write supersedes a read
          if (!reported) {
            var kept = acc.filter(function (p) { return p.g !== g || (p.k === "w" && o.k === "r"); });
            kept.push({ g: g, k: o.k, c: epoch, i: i });
            acc = kept;
          }
          break;
        }
      }
      ev.changed[g] = o.k !== "r" && o.k !== "w" && o.k !== "nop" && !ev.none;
      ev.C = {}; gs.forEach(function (u) { ev.C[u] = copy(C[u]); });
      ev.L = {}; Object.keys(Lm).forEach(function (m) { ev.L[m] = copy(Lm[m]); });
      ev.S = {}; Object.keys(S).forEach(function (m) { ev.S[m] = copy(S[m]); });
      ev.acc = acc.slice();
      ev.reported = reported;
      states.push(ev);
    });
    return states;
  }

  V.register("race-vclock", function (host) {
    var p = V.panel(host, { title: L("竞争检测：用向量时钟判断先行发生", "Race detection: happens-before from vector clocks") });
    var root = V.svg("svg", { viewBox: "0 0 720 344", role: "img",
      "aria-label": L("各 goroutine 的操作序列、向量时钟与访问记录", "Each goroutine's operations, vector clocks and access record") }, p.stage);
    var defs = V.svg("defs", null, root);
    [["hb", "var(--viz-c1)"], ["race", "var(--viz-c2)"]].forEach(function (a) {
      var mk = V.svg("marker", { id: "rv-arrow-" + a[0], viewBox: "0 0 10 10", refX: 9, refY: 5,
        markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
      V.svg("path", { d: "M0,0 L10,5 L0,10 z", style: "fill:" + a[1] }, mk);
    });
    var gBg = V.svg("g", null, root), gA = V.svg("g", null, root), gL = V.svg("g", null, root), gP = V.svg("g", null, root);
    var scene = "counter", sc, R, k = 0, timer = null;
    var LX = 8, LW = 480, TOP = 34, BOT = 314, RX = 504;

    function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }
    function txt(g, x, y, s, style, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: style || "font-size:12px", text: s }, g);
    }
    function tw(s) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 11.5 : 6.6; return w; }
    function vc(v) { return "(" + sc.gs.map(function (u) { return v[u]; }).join(",") + ")"; }
    function cur() { return k > 0 ? R[k - 1] : null; }
    function lane(g) { return sc.gs.indexOf(g); }
    function laneW() { return LW / sc.gs.length; }
    function lifeX(g) { return LX + lane(g) * laneW() + 12; }
    function rh() { return Math.min(26, (BOT - TOP) / sc.ops.length); }
    function rowY(i) { return TOP + i * rh() + rh() / 2; }
    function lbl(o) { return L(o.zh, o.en); }

    function drawLanes(ev) {
      clear(gBg); clear(gL); clear(gA);
      var w = laneW(), h = rh();
      sc.gs.forEach(function (g) {
        var x = lifeX(g);
        txt(gL, x - 4, 18, g, "font-size:12.5px;font-weight:600;" + MONO);
        V.svg("line", { x1: x, y1: 25, x2: x, y2: BOT, style: "stroke:var(--viz-line);stroke-width:1.2" }, gBg);
      });
      // happens-before edges: down the source lane, left of its lifeline, then
      // across in the gap just above the target row and into the target dot
      function hbPath(x1, y1, x2, y2) {
        var vx = x1 - 7, top = y2 - h / 2;
        return "M" + (x1 - 4) + "," + y1 + " L" + vx + "," + y1 + " L" + vx + "," + top + " L" + x2 + "," + top + " L" + x2 + "," + (y2 - 4);
      }
      // the race marker: across below the earlier access, down the target lane
      function elbow(x1, y1, x2, y2, off) {
        var mid = y1 + h / 2, vx = x2 - off;
        return "M" + x1 + "," + (y1 + 3) + " L" + x1 + "," + mid + " L" + vx + "," + mid + " L" + vx + "," + y2 + " L" + (x2 - 4) + "," + y2;
      }
      for (var j = 0; j < k; j++) {
        var e = R[j], now = j === k - 1, sty = "fill:none;stroke:var(--viz-c1);stroke-width:" + (now ? 1.8 : 1.1);
        e.src.forEach(function (i) {
          V.svg("path", { d: hbPath(lifeX(sc.ops[i].g), rowY(i), lifeX(e.op.g), rowY(j)),
            "marker-end": "url(#rv-arrow-hb)", opacity: now ? 1 : 0.45, style: sty }, gA);
        });
        if (e.op.k === "chan") {
          var xs = lifeX(e.op.g), xp = lifeX(e.op.a.peer), y = rowY(j), up = y - h / 2 + 1;
          V.svg("path", { d: "M" + xs + "," + (y - 4) + " L" + xs + "," + up + " L" + xp + "," + up + " L" + xp + "," + (y - 4),
            "marker-start": "url(#rv-arrow-hb)", "marker-end": "url(#rv-arrow-hb)", opacity: now ? 1 : 0.45, style: sty }, gA);
        }
      }
      var race = ev && ev.reported;
      if (race && k - 1 >= race.cur.i) {
        var pi = race.prev.i, ci = race.cur.i;
        V.svg("path", { d: elbow(lifeX(sc.ops[pi].g), rowY(pi), lifeX(sc.ops[ci].g), rowY(ci), 10),
          "marker-end": "url(#rv-arrow-race)", style: "fill:none;stroke:var(--viz-c2);stroke-width:1.5;stroke-dasharray:4 3" }, gA);
      }
      sc.ops.forEach(function (o, i) {
        var e = i < k ? R[i] : null, y = rowY(i), x = lifeX(o.g), lx0 = LX + lane(o.g) * w;
        var isRace = e && e.race, now = i === k - 1;
        if (now) V.svg("rect", { x: lx0 + 2, y: y - h / 2 + 2, width: w - 4, height: h - 4, rx: 4,
          style: "fill:var(--viz-" + (isRace ? "c2" : "c1") + ");fill-opacity:.13" }, gBg);
        var acc = o.k === "r" || o.k === "w";
        var col = !e ? "var(--viz-muted)" : isRace ? "var(--viz-c2)" : e.suppressed ? "var(--viz-muted)" : "var(--viz-ink)";
        V.svg("circle", { cx: x, cy: y, r: 3.2, style: "fill:" + (!e ? "var(--viz-line)" : isRace ? "var(--viz-c2)" : acc ? "var(--viz-ink)" : "var(--viz-c1)") }, gL);
        txt(gL, x + 9, y + 4, lbl(o), "font-size:12px;font-variant-ligatures:none;fill:" + col + (now ? ";font-weight:600" : "") + (e ? "" : ";opacity:.7"));
        if (!e) return;
        var val = acc ? e.epoch + "@" + o.g : o.k === "nop" || e.none ? "" : vc(e.C[o.g]);
        if (val) txt(gL, lx0 + w - 6, y + 4, val, "font-size:11.5px;" + MONO + ";fill:" + (isRace ? "var(--viz-c2)" : acc ? "var(--viz-muted)" : "var(--viz-c1)"), "end");
        if (o.k === "chan") {
          var u = o.a.peer, px = lifeX(u), pl = LX + lane(u) * w;
          if (now) V.svg("rect", { x: pl + 2, y: y - h / 2 + 2, width: w - 4, height: h - 4, rx: 4,
            style: "fill:var(--viz-c1);fill-opacity:.13" }, gBg);
          V.svg("circle", { cx: px, cy: y, r: 3.2, style: "fill:var(--viz-c1)" }, gL);
          txt(gL, px + 9, y + 4, L(o.a.pzh, o.a.pen), "font-size:12px;font-variant-ligatures:none;fill:var(--viz-ink)" + (now ? ";font-weight:600" : ""));
          txt(gL, pl + w - 6, y + 4, vc(e.C[u]), "font-size:11.5px;" + MONO + ";fill:var(--viz-c1)", "end");
        }
      });
      // legend
      var ly = 334, lx = LX + 4;
      V.svg("path", { d: "M" + lx + "," + (ly - 4) + " L" + (lx + 24) + "," + (ly - 4), "marker-end": "url(#rv-arrow-hb)",
        style: "fill:none;stroke:var(--viz-c1);stroke-width:1.5" }, gL);
      var t1 = L("同步：release 指向 acquire", "sync: release to acquire");
      txt(gL, lx + 30, ly, t1, "font-size:11px;fill:var(--viz-muted)"); lx += 30 + tw(t1) * 0.92 + 18;
      V.svg("path", { d: "M" + lx + "," + (ly - 4) + " L" + (lx + 24) + "," + (ly - 4), "marker-end": "url(#rv-arrow-race)",
        style: "fill:none;stroke:var(--viz-c2);stroke-width:1.5;stroke-dasharray:4 3" }, gL);
      txt(gL, lx + 30, ly, L("无先行发生的两次访问", "two accesses without happens-before"), "font-size:11px;fill:var(--viz-muted)");
    }

    function drawPanel(ev) {
      clear(gP);
      var y = 16, H = "font-size:12px;font-weight:600", cl = "font-size:12px;" + MONO;
      txt(gP, RX, y, L("向量时钟 C_t", "Vector clocks C_t"), H); y += 16;
      txt(gP, RX, y, L("分量依次为 ", "Components: ") + sc.gs.join(L("、", ", ")), "font-size:11px;fill:var(--viz-muted)"); y += 19;
      sc.gs.forEach(function (g) {
        var v = ev ? ev.C[g] : null, ch = ev && ev.changed[g];
        if (!v) { v = {}; sc.gs.forEach(function (u) { v[u] = u === g ? 1 : 0; }); }
        txt(gP, RX + 4, y, g, cl);
        txt(gP, RX + 56, y, vc(v), cl + ";fill:" + (ch ? "var(--viz-c1);font-weight:600" : "var(--viz-ink)")); y += 17;
      });
      y += 9;
      txt(gP, RX, y, L("同步对象上的时钟", "Clocks on sync objects"), H); y += 19;
      var objs = [];
      if (ev) {
        Object.keys(ev.S).forEach(function (c) { objs.push(["go " + c, ev.S[c], ev.op.k === "go" && ev.op.a.child === c]); });
        Object.keys(ev.L).forEach(function (m) { objs.push([m, ev.L[m], ev.op.a.obj === m && /rel|chan/.test(ev.op.k)]); });
      }
      if (!objs.length) { txt(gP, RX + 4, y, L("（尚无）", "(none yet)"), "font-size:12px;fill:var(--viz-muted)"); y += 17; }
      objs.forEach(function (o) {
        txt(gP, RX + 4, y, o[0], cl);
        txt(gP, RX + 56, y, vc(o[1]), cl + ";fill:" + (o[2] ? "var(--viz-c1);font-weight:600" : "var(--viz-ink)")); y += 17;
      });
      y += 9;
      txt(gP, RX, y, L(sc.v + " 的访问记录", "Accesses to " + sc.v), H); y += 19;
      var acc = ev ? ev.acc : [];
      if (ev && ev.reported && !ev.race) {
        txt(gP, RX + 4, y, L("报告后已标记，不再检查", "Marked after the report"), "font-size:12px;fill:var(--viz-muted)"); y += 17;
      } else {
        if (!acc.length) { txt(gP, RX + 4, y, L("（尚无）", "(none yet)"), "font-size:12px;fill:var(--viz-muted)"); y += 17; }
        acc.forEach(function (a) {
          txt(gP, RX + 4, y, (a.k === "w" ? L("写 ", "write ") : L("读 ", "read ")) + a.c + "@" + a.g, cl); y += 17;
        });
      }
      if (ev && ev.checks && ev.checks.length) {
        ev.checks.forEach(function (c) {
          var s = c.p.c + "@" + c.p.g + ": " + c.p.c + " ≤ C_" + ev.op.g + "[" + c.p.g + "] = " + c.seen + (c.ordered ? " ✓" : " ✗");
          txt(gP, RX + 4, y, s, "font-size:11.5px;" + MONO + ";fill:" + (c.ordered ? "var(--viz-c3)" : "var(--viz-c2)")); y += 16;
        });
      }
      var rep = ev && ev.reported;
      if (rep) {
        y += 8;
        txt(gP, RX, y, "WARNING: DATA RACE", "font-size:12px;font-weight:700;fill:var(--viz-c2);" + MONO); y += 17;
        txt(gP, RX + 4, y, (rep.cur.k === "w" ? L("写：", "Write by ") : L("读：", "Read by ")) + rep.cur.g + L("，", " at ") + rep.cur.c + "@" + rep.cur.g,
          "font-size:12px;fill:var(--viz-c2)"); y += 17;
        txt(gP, RX + 4, y, (rep.prev.k === "w" ? L("此前的写：", "Previous write by ") : L("此前的读：", "Previous read by ")) + rep.prev.g +
          L("，", " at ") + rep.prev.c + "@" + rep.prev.g, "font-size:12px;fill:var(--viz-c2)");
      }
    }

    function narrate(ev) {
      if (!ev) {
        p.note.textContent = L("每个 goroutine 持有一个向量时钟，分量依次对应 " + sc.gs.join("、") + "；自己的分量从 1 开始，其余为 0。" +
          "左侧每一行是一次操作，按实际执行的先后排列。按「下一步」逐个执行。",
          "Each goroutine holds a vector clock with one component for each of " + sc.gs.join(", ") +
          "; its own component starts at 1 and the others at 0. Each row on the left is one operation, in the order they run. Press Step to run them one by one.");
        return;
      }
      var o = ev.op, g = o.g, s = "", t = ev.C[g];
      var Cg = "C_" + g;
      switch (o.k) {
        case "go":
          s = L(g + " 执行 go 语句：运行时调用 racegostart，把 " + Cg + " = " + vc(ev.stored) + " 存给新的 " + o.a.child + "（release），然后 " +
            Cg + "[" + g + "] 加 1，变为 " + vc(t) + "。",
            g + " runs a go statement: racegostart stores " + Cg + " = " + vc(ev.stored) + " for the new " + o.a.child + " (a release), then " +
            Cg + "[" + g + "] goes up by 1, to " + vc(t) + ".");
          break;
        case "start":
          s = L(g + " 开始运行，取得创建时存下的时钟（acquire）：" + vc(ev.before) + " ⊔ " + vc(ev.from) + " = " + vc(t) +
            "。go 语句之前 main 所做的一切，都先行于 " + g + " 此后的操作。",
            g + " starts and acquires the clock stored at its creation: " + vc(ev.before) + " ⊔ " + vc(ev.from) + " = " + vc(t) +
            ". Everything main did before the go statement happens before what " + g + " does from now on.");
          break;
        case "acq":
          if (ev.none) s = L(g + " 执行 " + lbl(o) + "：此前没有人释放过这把锁，它上面还没有时钟，acquire 什么也不做，" + Cg + " 仍为 " + vc(t) + "。",
            g + " runs " + lbl(o) + ": nobody has released this lock yet, so it has no clock and the acquire does nothing; " + Cg + " stays " + vc(t) + ".");
          else s = L(g + (o.a.obj === "wg" ? " 从 wg.Wait() 返回" : " 执行 " + lbl(o)) + "，调用 race.Acquire：" + Cg + " ← " + vc(ev.before) + " ⊔ L_" + o.a.obj + " " + vc(ev.from) + " = " + vc(t) +
            "。" + (o.a.obj === "wg" ? "main 由此得知 " + sc.gs.slice(1).join(" 与 ") + " 在 Done 之前的全部操作。" : g + " 由此得知释放方在解锁之前的全部操作。"),
            g + (o.a.obj === "wg" ? " returns from wg.Wait()" : " runs " + lbl(o)) + ", which calls race.Acquire: " + Cg + " ← " + vc(ev.before) + " ⊔ L_" + o.a.obj + " " + vc(ev.from) + " = " + vc(t) +
            ". " + (o.a.obj === "wg" ? "main now knows everything " + sc.gs.slice(1).join(" and ") + " did before Done." : g + " now knows everything the releasing side did before unlocking."));
          break;
        case "rel":
          s = L(g + " 执行 " + lbl(o) + "，调用 race.Release：L_" + o.a.obj + " ← " + Cg + " = " + vc(ev.before) + "，然后 " + Cg + "[" + g + "] 加 1，变为 " + vc(t) + "。",
            g + " runs " + lbl(o) + ", which calls race.Release: L_" + o.a.obj + " ← " + Cg + " = " + vc(ev.before) + ", then " + Cg + "[" + g + "] goes up by 1, to " + vc(t) + ".");
          break;
        case "relm":
          s = L(g + " 执行 wg.Done()：Add 的增量为负，调用 race.ReleaseMerge。" +
            (ev.prev ? "L_wg ← " + vc(ev.prev) + " ⊔ " + vc(ev.before) + " = " + vc(ev.L.wg) + "，与 release 不同，合并保留了先结束者的时间。"
              : "wg 上还没有时钟，L_wg ← " + vc(ev.L.wg) + "。") + Cg + " 随后变为 " + vc(t) + "。",
            g + " runs wg.Done(): Add with a negative delta calls race.ReleaseMerge. " +
            (ev.prev ? "L_wg ← " + vc(ev.prev) + " ⊔ " + vc(ev.before) + " = " + vc(ev.L.wg) + "; unlike a release, the merge keeps the time of the goroutine that finished first."
              : "wg has no clock yet, so L_wg ← " + vc(ev.L.wg) + ".") + " " + Cg + " then becomes " + vc(t) + ".");
          break;
        case "chan": {
          var u = o.a.peer;
          s = L(g + " 执行 done <- true，" + u + " 正阻塞在 <-done 上。通道无缓冲，运行时调用 racesync，分四步：" +
            g + " release，L_done ← " + vc(ev.l1) + "，C_" + g + " 变为 " + vc(ev.mid) + "；" +
            u + " acquire，" + vc(ev.peerBefore) + " ⊔ " + vc(ev.l1) + " = " + vc(ev.peerAfterAcq) + "；" +
            u + " release，L_done ← " + vc(ev.l2) + "，C_" + u + " 变为 " + vc(ev.C[u]) + "；" +
            g + " acquire，" + vc(ev.mid) + " ⊔ " + vc(ev.l2) + " = " + vc(t) + "。收发两端由此互相定序。",
            g + " runs done <- true while " + u + " is blocked in <-done. The channel is unbuffered, so the runtime calls racesync in four steps: " +
            g + " releases, L_done ← " + vc(ev.l1) + " and C_" + g + " becomes " + vc(ev.mid) + "; " +
            u + " acquires, " + vc(ev.peerBefore) + " ⊔ " + vc(ev.l1) + " = " + vc(ev.peerAfterAcq) + "; " +
            u + " releases, L_done ← " + vc(ev.l2) + " and C_" + u + " becomes " + vc(ev.C[u]) + "; " +
            g + " acquires, " + vc(ev.mid) + " ⊔ " + vc(ev.l2) + " = " + vc(t) + ". The two sides are now ordered both ways.");
          break;
        }
        case "nop":
          s = L(g + " 调用 time.Sleep：它不是同步操作，既不 release 也不 acquire，" + Cg + " 仍为 " + vc(t) + "，" +
            Cg + "[G] 仍为 0。G 在这段时间里运行并结束，main 却无从得知。",
            g + " calls time.Sleep. It is not a synchronization operation: no release, no acquire. " + Cg + " stays " + vc(t) +
            ", and " + Cg + "[G] is still 0. G runs and finishes meanwhile, but main has no way to know.");
          break;
        case "r": case "w": {
          var verb = o.k === "w" ? L("写", "writes") : L("读", "reads"), ep = ev.epoch + "@" + g;
          s = L(g + " " + verb + " " + sc.v + "，纪元 " + ep + "。", g + " " + verb + " " + sc.v + " at epoch " + ep + ". ");
          if (ev.suppressed) {
            s += L("这个地址刚报告过竞争，DoReportRace 已改写它的影子，此后不再在这里报告，所以程序结束时只有 Found 1 data race(s)。",
              "This address was just reported; DoReportRace overwrote its shadow so that it does not trap here again, which is why the program ends with Found 1 data race(s).");
            if (g === "main") s += L("即便检查，" + Cg + " = " + vc(t) + " 也已从 wg 得知两次写，它们都先行于这次读。",
              " Even if it were checked, " + Cg + " = " + vc(t) + " already knows both writes through wg, so both happen before this read.");
          } else if (ev.race) {
            var pr = ev.race.p, pe = pr.c + "@" + pr.g;
            s += L("此前" + (pr.k === "w" ? "写" : "读") + "于 " + pe + "，而 " + Cg + "[" + pr.g + "] = " + ev.race.seen + "，" + pr.c + " ≤ " + ev.race.seen +
              " 不成立：两次访问之间没有先行发生关系，又有一次是写，报告 WARNING: DATA RACE。",
              "The earlier " + (pr.k === "w" ? "write" : "read") + " is " + pe + " and " + Cg + "[" + pr.g + "] = " + ev.race.seen + ", so " + pr.c + " ≤ " + ev.race.seen +
              " fails: no happens-before relation links the two accesses and one of them is a write, so WARNING: DATA RACE is reported.");
            if (scene === "counter") s += L("这就是 16.2.1 中的报告：先创建的 goroutine 7（这里的 G1）读，后创建、先运行的 goroutine 8（G2）此前写。两次自增在时间上并未交错。",
              " This is the report in 16.2.1: goroutine 7 (G1 here, created first) reads, and goroutine 8 (G2, created last but run first) wrote before. The two increments never overlapped in time.");
            if (scene === "sleep") s += L("100 毫秒的等待没有在时钟上留下任何痕迹。", " The 100 ms wait left no trace on the clocks.");
          } else if (ev.checks.length) {
            s += L("此前的访问 " + ev.checks.map(function (c) { return c.p.c + "@" + c.p.g + "：" + c.p.c + " ≤ " + Cg + "[" + c.p.g + "] = " + c.seen; }).join("；") +
              "，都先行于这次访问，不是竞争。",
              "Earlier accesses " + ev.checks.map(function (c) { return c.p.c + "@" + c.p.g + ": " + c.p.c + " ≤ " + Cg + "[" + c.p.g + "] = " + c.seen; }).join("; ") +
              ". All happen before this one, so there is no race.");
          } else {
            var own = ev.acc.filter(function (a) { return a.g !== g; }).length;
            s += own ? L("此前的访问都是读，读与读不构成竞争。", "The earlier accesses are reads, and two reads never race.")
              : L("此前没有别的 goroutine 访问过它，只记下这次访问。", "No other goroutine has accessed it yet, so the access is just recorded.");
          }
          break;
        }
      }
      if (k === R.length && !ev.suppressed && !ev.race) s += L("程序结束，没有报告竞争。", " The program ends with no race reported.");
      p.note.textContent = s;
    }

    function draw() {
      var ev = cur();
      drawLanes(ev); drawPanel(ev); narrate(ev);
      stepBtn.disabled = k >= R.length;
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } playBtn.textContent = L("自动播放", "Play"); }
    function reset() { stop(); sc = SCENES[scene]; R = simulate(sc); k = 0; draw(); }
    var stepBtn = V.button(p.bar, L("下一步", "Step"), function () { stop(); if (k < R.length) { k++; draw(); } });
    var playBtn = V.button(p.bar, L("自动播放", "Play"), function () {
      if (timer) { stop(); return; }
      if (k >= R.length) k = 0;
      playBtn.textContent = L("暂停", "Pause");
      timer = setInterval(function () {
        if (!host.isConnected) { stop(); return; }
        if (k < R.length) { k++; draw(); }
        if (k >= R.length) stop();
      }, 1500);
    });
    V.button(p.bar, L("全部", "All"), function () { stop(); k = R.length; draw(); });
    V.button(p.bar, L("从头", "Restart"), function () { stop(); k = 0; draw(); });
    V.select(p.bar, L("程序", "Program"), Object.keys(SCENES).map(function (id) {
      return { value: id, label: L(SCENES[id].label.zh, SCENES[id].label.en) };
    }), scene, function (v) { scene = v; reset(); });
    reset();
  });
})();
