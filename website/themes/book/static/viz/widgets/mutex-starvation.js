/*
 * mutex-starvation: why a woken waiter keeps losing in normal mode, and how
 * starvation mode bounds its wait (book §11.2.4).
 *
 * The rules are those of src/internal/sync/mutex.go in Go 1.26:
 *   Lock      fast path CAS(0 -> mutexLocked), else lockSlow;
 *   lockSlow  new = old; set mutexLocked unless starving; add a waiter if
 *             the lock is held or starving; set mutexStarving if this
 *             goroutine is starving and the lock is held; clear mutexWoken if
 *             this goroutine was woken; then either own the lock or
 *             SemacquireMutex (LIFO if it has waited before). On wake-up,
 *             starving |= waited > starvationThresholdNs (1 ms); in
 *             starvation mode the woken goroutine owns the lock, takes
 *             mutexLocked and drops itself as a waiter, and clears
 *             mutexStarving if it is the last waiter or waited < 1 ms.
 *   Unlock    state -= mutexLocked; if nonzero, unlockSlow: in normal mode,
 *             if there is a waiter and none of locked/woken/starving is set,
 *             take a waiter off the count, set mutexWoken and Semrelease; in
 *             starvation mode Semrelease(handoff=true), which (runtime/sema.go,
 *             semrelease1) puts the waiter in runnext and yields, so it runs
 *             at once.
 * "Go 1.8" uses the same code without mutexStarving and with FIFO
 * re-queueing (src/sync/mutex.go at go1.8); with a single waiter the queue
 * discipline makes no difference here.
 *
 * The scenario is the program in §11.2.4 (issue 13086): G1 holds the lock
 * for 100 µs, unlocks and locks again at once; main locks every 100 µs and
 * holds it for about 1 µs. Two timings are assumptions, not Go constants: a
 * goroutine woken in normal mode starts running 5 µs later, while G1 relocks
 * within 1 µs. Active spinning (at most active_spin = 4 rounds of
 * procyield(30)) cannot outlast a 100 µs critical section, so it is left out.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace);font-variant-ligatures:none";

  var HOLD = 100, GAP = 0.2, MAIN_HOLD = 1, MAIN_SLEEP = 100, WAKE = 5, ARRIVE = 40;
  var THRESH = 1000, END = 2500; // µs

  function simulate(mode) {
    var starvOK = mode === "go19";
    var st = { L: 0, W: 0, S: 0, n: 0 };
    var queue = [], evq = [], log = [], seq = 0;
    var G = {
      g1: { name: "G1", waitStart: 0, starving: false, awoke: false },
      main: { name: "main", waitStart: 0, starving: false, awoke: false },
    };
    var spans = { g1: [], main: [] }, marks = [], starve = [], waits = [];
    var holdFrom = {}, queuedFrom = {}, starveFrom = null;

    function at(t, who, what) { evq.push({ t: t, who: who, what: what, seq: seq++ }); }
    function snap() { return { L: st.L, W: st.W, S: st.S, n: st.n }; }
    function rec(t, who, kind, extra) {
      var e = { t: t, who: who, kind: kind, st: snap() };
      if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
      log.push(e);
    }
    function own(t, who) { holdFrom[who] = t; }
    function release(t, who) { spans[who].push({ a: holdFrom[who], b: t, k: "hold" }); }
    function sleepOn(t, who, lifo) {
      if (lifo) queue.unshift(who); else queue.push(who);
      queuedFrom[who] = queuedFrom[who] == null ? t : queuedFrom[who];
    }

    // lockSlow from the top of its loop; returns true if the lock was taken.
    function lockSlow(t, who) {
      var g = G[who], old = snap(), nw = snap();
      if (!old.S) nw.L = 1;
      if (old.L || old.S) nw.n++;
      if (g.starving && old.L) nw.S = 1;
      if (g.awoke) nw.W = 0;
      st = nw;
      if (!old.L && !old.S) return true;
      var lifo = g.waitStart !== 0;
      if (g.waitStart === 0) g.waitStart = t;
      sleepOn(t, who, lifo && starvOK);
      if (nw.S && !old.S) starveFrom = t;
      return false;
    }
    function lock(t, who) {
      var g = G[who];
      g.waitStart = 0; g.starving = false; g.awoke = false;
      if (!st.L && !st.W && !st.S && !st.n) { st.L = 1; own(t, who); rec(t, who, "fast"); return; }
      if (lockSlow(t, who)) { own(t, who); rec(t, who, "barge"); return; }
      rec(t, who, "queue");
    }
    function wake(t, who) {
      var g = G[who], waited = t - g.waitStart;
      if (starvOK) g.starving = g.starving || waited > THRESH;
      marks.push({ t: t, who: who });
      if (st.S) { // ownership was handed off
        var last = st.n === 1;
        st.L = 1; st.n--;
        var exit = !g.starving || last;
        if (exit) { st.S = 0; starve.push({ a: starveFrom, b: t }); starveFrom = null; }
        own(t, who);
        spans[who].push({ a: queuedFrom[who], b: t, k: "wait" }); queuedFrom[who] = null;
        waits.push({ who: who, a: g.waitStart, b: t });
        rec(t, who, "handoff", { waited: waited, last: last, exit: exit });
        return true;
      }
      g.awoke = true;
      var wasS = st.S;
      if (lockSlow(t, who)) {
        own(t, who);
        spans[who].push({ a: queuedFrom[who], b: t, k: "wait" }); queuedFrom[who] = null;
        waits.push({ who: who, a: g.waitStart, b: t });
        rec(t, who, "wakewin", { waited: waited });
        return true;
      }
      rec(t, who, st.S && !wasS ? "wakestarve" : "wakelose", { waited: waited });
      return false;
    }
    // Unlock; returns the goroutine that was woken (or null) and whether by handoff.
    function unlock(t, who) {
      release(t, who);
      st.L = 0;
      if (!st.W && !st.S && !st.n) { rec(t, who, "unlock"); return null; }
      if (!st.S) {
        if (st.n === 0 || st.L || st.W || st.S) { rec(t, who, "unlock"); return null; }
        st.n--; st.W = 1;
        var w = queue.shift();
        rec(t, who, "unlockwake", { to: w });
        return { who: w, handoff: false };
      }
      var h = queue.shift();
      rec(t, who, "unlockhand", { to: h });
      return { who: h, handoff: true };
    }

    at(0, "g1", "lock");
    at(ARRIVE, "main", "lock");
    var yielded = null;
    while (evq.length) {
      evq.sort(function (a, b) { return a.t - b.t || a.seq - b.seq; });
      var e = evq.shift();
      if (e.t > END) break;
      var t = e.t, who = e.who;
      if (e.what === "lock") {
        lock(t, who);
        if (st.L && holdFrom[who] === t) at(t + (who === "g1" ? HOLD : MAIN_HOLD), who, "unlock");
      } else if (e.what === "wake") {
        if (wake(t, who)) at(t + (who === "g1" ? HOLD : MAIN_HOLD), who, "unlock");
      } else if (e.what === "unlock") {
        var r = unlock(t, who);
        if (r && r.handoff) {
          at(t, r.who, "wake");  // runs at once in the yielded time slice
          yielded = who;         // the unlocker waits until the woken one parks
        } else {
          if (r) at(t + WAKE, r.who, "wake");
          if (who === "g1") at(t + GAP, "g1", "lock");
          else {
            at(t + MAIN_SLEEP, "main", "lock");
            if (yielded) { at(t + 0.5, yielded, "lock"); yielded = null; }
          }
        }
      }
    }
    Object.keys(holdFrom).forEach(function (w) {
      var sp = spans[w], lastSp = sp[sp.length - 1];
      if (!lastSp || lastSp.b < holdFrom[w]) sp.push({ a: holdFrom[w], b: END, k: "hold", open: true });
    });
    Object.keys(queuedFrom).forEach(function (w) {
      if (queuedFrom[w] != null) { spans[w].push({ a: queuedFrom[w], b: END, k: "wait", open: true }); waits.push({ who: w, a: G[w].waitStart, b: null }); }
    });
    if (starveFrom != null) starve.push({ a: starveFrom, b: END, open: true });
    // Steps: one per unlock by G1, with everything up to the next one.
    var steps = [], cur = [];
    log.forEach(function (ev) {
      if (ev.who === "g1" && /^unlock/.test(ev.kind) && cur.length) { steps.push(cur); cur = []; }
      cur.push(ev);
    });
    if (cur.length) steps.push(cur);
    return { log: log, steps: steps, spans: spans, marks: marks, starve: starve, waits: waits };
  }

  function us(t) { return (Math.round(t * 10) / 10) + " µs"; }
  function ms(t) { return (t / 1000).toFixed(2) + " ms"; }

  function nm(k) { return k === "g1" ? "G1" : k; }
  function short(e, mode) {
    switch (e.kind) {
      case "fast": return L(nm(e.who) + " 加锁：快速路径", nm(e.who) + " locks: fast path");
      case "barge": return L(nm(e.who) + " 加锁：插队", nm(e.who) + " locks: barges in");
      case "queue": return L(nm(e.who) + " 加锁：锁被占用，排到队尾", nm(e.who) + " locks: held, queues at the tail");
      case "unlock": return L(nm(e.who) + " 解锁：无人等待", nm(e.who) + " unlocks: no waiters");
      case "unlockwake": return L(nm(e.who) + " 解锁：唤醒 " + nm(e.to), nm(e.who) + " unlocks and wakes " + nm(e.to));
      case "unlockhand": return L(nm(e.who) + " 解锁：把锁移交给 " + nm(e.to), nm(e.who) + " unlocks and hands off to " + nm(e.to));
      case "wakelose": return mode === "go19"
        ? L(nm(e.who) + " 醒来：锁已被占，排回队首", nm(e.who) + " wakes: lock taken, back to the head")
        : L(nm(e.who) + " 醒来：锁已被占，重新排队", nm(e.who) + " wakes: lock taken, queues again");
      case "wakestarve": return L(nm(e.who) + " 醒来：超过 1 ms，设置饥饿位", nm(e.who) + " wakes: over 1 ms, sets starving");
      case "wakewin": return L(nm(e.who) + " 醒来：锁空闲，取得锁", nm(e.who) + " wakes: lock free, takes it");
      case "handoff": return e.exit
        ? L(nm(e.who) + " 醒来即持有锁，回到正常模式", nm(e.who) + " wakes owning the lock; normal mode again")
        : L(nm(e.who) + " 醒来即持有锁，仍为饥饿模式", nm(e.who) + " wakes owning the lock; still starving");
    }
    return "";
  }
  function long(e, mode) {
    var w = e.waited == null ? "" : e.waited < 1000 ? us(e.waited) : ms(e.waited);
    switch (e.kind) {
      case "fast": return L(nm(e.who) + " 加锁，state 为 0，快速路径的 CAS 直接成功。", nm(e.who) + " locks; state is 0, so the fast-path CAS succeeds.");
      case "barge": return L(nm(e.who) + " 加锁：state 中有唤醒位，快速路径失败；lockSlow 发现加锁位为 0，用 CAS 取得锁。被唤醒的 main 还没来得及运行。",
        nm(e.who) + " locks: the woken bit makes the fast path fail; lockSlow finds the locked bit clear and takes the lock with a CAS before the woken main gets to run.");
      case "queue": return L(nm(e.who) + " 加锁：锁已被持有，登记为等待者，排到信号量队列的队尾，并记下开始等待的时刻。",
        nm(e.who) + " locks: the lock is held, so it registers as a waiter, queues at the tail of the semaphore and records when it started waiting.");
      case "unlock": return L(nm(e.who) + " 解锁：没有等待者，state 归零。", nm(e.who) + " unlocks: nobody is waiting and state drops to 0.");
      case "unlockwake": return L(nm(e.who) + " 解锁：还有等待者，unlockSlow 把等待者数减一、设置唤醒位，再唤醒 " + nm(e.to) + "。唤醒并不移交锁。",
        nm(e.who) + " unlocks: there is a waiter, so unlockSlow decrements the count, sets the woken bit and wakes " + nm(e.to) + ". Waking is not handing over.");
      case "unlockhand": return L(nm(e.who) + " 解锁：饥饿位已置，unlockSlow 以 handoff 方式释放信号量，把锁直接交给队首的 " + nm(e.to) + " 并让出 CPU；加锁位留给对方去设置。",
        nm(e.who) + " unlocks: the starving bit is set, so unlockSlow releases the semaphore with handoff, giving the lock to " + nm(e.to) + " at the head of the queue, and yields; the new owner sets the locked bit.");
      case "wakelose": return mode === "go19"
        ? L(nm(e.who) + " 醒来时已等待 " + w + "，未超过 1 ms；锁又被占用，于是清除唤醒位，重新登记为等待者，排回队首。",
            nm(e.who) + " wakes after waiting " + w + ", not yet over 1 ms; the lock is taken again, so it clears the woken bit, registers as a waiter again and goes back to the head of the queue.")
        : L(nm(e.who) + " 醒来时已等待 " + w + "；锁又被占用，只能清除唤醒位，重新排队。Go 1.8 没有饥饿模式，等得再久也一样。",
            nm(e.who) + " wakes after waiting " + w + "; the lock is taken again, so it clears the woken bit and queues again. Go 1.8 has no starvation mode, so waiting longer changes nothing.");
      case "wakestarve": return L(nm(e.who) + " 醒来时已等待 " + w + "，超过 1 ms；锁仍被占用，它在排回队首的同时设置饥饿位，锁进入饥饿模式。",
        nm(e.who) + " wakes after waiting " + w + ", over 1 ms; the lock is still held, so it goes back to the head of the queue and sets the starving bit: the lock enters starvation mode.");
      case "wakewin": return L(nm(e.who) + " 醒来时锁空闲，用 CAS 取得锁，共等待 " + w + "。", nm(e.who) + " wakes to a free lock and takes it with a CAS, after waiting " + w + ".");
      case "handoff": return L(nm(e.who) + " 醒来即持有锁，共等待 " + w + "。它设置加锁位并把自己从等待者中减去；" +
          (e.exit ? (e.last ? "它是最后一个等待者，" : "它的等待不足 1 ms，") + "于是清除饥饿位，锁回到正常模式。" : "锁仍处于饥饿模式。"),
        nm(e.who) + " wakes owning the lock, after waiting " + w + ". It sets the locked bit and removes itself from the waiters; " +
          (e.exit ? (e.last ? "it is the last waiter, " : "it waited less than 1 ms, ") + "so it clears the starving bit and the lock returns to normal mode." : "the lock stays in starvation mode."));
    }
    return "";
  }

  V.register("mutex-starvation", function (host) {
    var p = V.panel(host, { title: L("被唤醒者为何总是抢不到锁：正常模式与饥饿模式", "Why a woken waiter keeps losing: normal mode and starvation mode") });
    var root = V.svg("svg", { viewBox: "0 0 720 334", role: "img",
      "aria-label": L("两个 goroutine 争用一把锁的时间线，以及 state 字段的变化", "Timeline of two goroutines contending for one mutex, and how its state word changes") }, p.stage);
    var g = V.svg("g", null, root);

    var mode = "go19", sim, cursor = null, timer = null;
    var X0 = 64, X1 = 708, LANE = { g1: 40, main: 82 }, LH = 20;
    function x(t) { return X0 + (X1 - X0) * t / END; }
    function text(x1, y, s, st, anchor) {
      return V.svg("text", { x: x1, y: y, "text-anchor": anchor || "start", style: st || "font-size:12px", text: s }, g);
    }
    function rect(x1, y, w, h, color, op, extra) {
      return V.svg("rect", { x: x1, y: y, width: Math.max(w, 0.8), height: h, rx: 2,
        style: "fill:" + color + ";fill-opacity:" + op + ";stroke:" + color + ";stroke-width:0.8" + (extra || "") }, g);
    }
    function tw(s) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 11 : 6.2; return w; }

    function draw() {
      while (g.firstChild) g.removeChild(g.firstChild);
      // Events up to lastT belong to the steps shown; spans extend to upto,
      // the start of the next step.
      var upto = cursor == null ? END : (cursor + 1 < sim.steps.length ? sim.steps[cursor + 1][0].t : END);
      var cur = cursor == null ? null : sim.steps[cursor], lastT = cur ? cur[cur.length - 1].t : END;
      function clip(a, b) { return [a, Math.min(b, upto)]; }
      function shown(a) { return cursor == null || a <= lastT; }
      // legend
      var items = [["var(--viz-c1)", L("持有锁", "holds the lock")], ["var(--viz-c2)", L("排队等待", "queued")],
        ["var(--viz-c4)", L("饥饿模式", "starvation mode")]];
      var lx = 708;
      for (var li = items.length - 1; li >= 0; li--) {
        lx -= tw(items[li][1]) + 17;
        rect(lx, 6, 12, 12, items[li][0], 0.25);
        text(lx + 17, 16, items[li][1], "font-size:11px;fill:var(--viz-muted)");
        lx -= 12;
      }
      text(lx - 4, 16, L("▼ 被唤醒", "▼ woken"), "font-size:11px;fill:var(--viz-muted)", "end");
      // starvation bands
      sim.starve.forEach(function (s) {
        if (!shown(s.a)) return;
        var c = clip(s.a, s.b);
        rect(x(c[0]), LANE.g1 - 6, x(c[1]) - x(c[0]), LANE.main + LH + 6 - (LANE.g1 - 6), "var(--viz-c4)", 0.14, ";stroke-opacity:.5");
      });
      // lane labels and frames
      text(8, LANE.g1 + 14, "G1", "font-size:12px;font-weight:600;" + MONO);
      text(8, LANE.main + 14, "main", "font-size:12px;font-weight:600;" + MONO);
      ["g1", "main"].forEach(function (w) {
        V.svg("line", { x1: X0, y1: LANE[w] + LH / 2, x2: x(upto), y2: LANE[w] + LH / 2, style: "stroke:var(--viz-line);stroke-dasharray:2 3" }, g);
        sim.spans[w].forEach(function (s) {
          if (!shown(s.a)) return;
          var c = clip(s.a, s.b);
          if (s.k === "hold") rect(x(c[0]), LANE[w], x(c[1]) - x(c[0]), LH, "var(--viz-c1)", 0.22);
          else rect(x(c[0]), LANE[w] + 3, x(c[1]) - x(c[0]), LH - 6, "var(--viz-c2)", 0.22);
        });
      });
      // G1's separate critical sections: tick at each relock
      sim.log.forEach(function (e) {
        if (!shown(e.t)) return;
        if (e.who === "g1" && (e.kind === "fast" || e.kind === "barge") && e.t > 0)
          V.svg("line", { x1: x(e.t), y1: LANE.g1, x2: x(e.t), y2: LANE.g1 + LH, style: "stroke:var(--viz-fill);stroke-width:1.2" }, g);
        if (e.who === "main" && (e.kind === "handoff" || e.kind === "wakewin" || e.kind === "fast"))
          V.svg("circle", { cx: x(e.t), cy: LANE.main + LH / 2, r: 4, style: "fill:var(--viz-c1);stroke:var(--viz-fill);stroke-width:1" }, g);
      });
      sim.marks.forEach(function (m) {
        if (!shown(m.t)) return;
        var xx = x(m.t), y = LANE[m.who] - 2;
        V.svg("path", { d: "M" + (xx - 3) + "," + (y - 5) + " L" + (xx + 3) + "," + (y - 5) + " L" + xx + "," + y + " z", style: "fill:var(--viz-c2)" }, g);
      });
      // wait annotations and the 1 ms threshold
      sim.waits.forEach(function (wt) {
        if (!shown(wt.a)) return;
        var y = LANE.main + LH + 14;
        var th = wt.a + THRESH;
        if (mode === "go19" && th <= upto && th <= END) {
          V.svg("line", { x1: x(th), y1: LANE.main - 1, x2: x(th), y2: LANE.main + LH + 4, style: "stroke:var(--viz-ink);stroke-width:1;stroke-dasharray:3 2" }, g);
          text(x(th) - 3, y, L("等满 1 ms", "1 ms"), "font-size:10px;fill:var(--viz-muted)", "end");
        }
        if (wt.b != null && shown(wt.b)) text((x(wt.a) + x(wt.b)) / 2, y, L("等待 ", "waited ") + ms(wt.b - wt.a), "font-size:11px", "middle");
        else if (wt.b == null && upto >= END) text(x(END), y, L("仍在等待：已等 ", "still waiting: ") + ms(END - wt.a), "font-size:11px;fill:var(--viz-c2)", "end");
      });
      // time axis
      var ay = 128;
      V.svg("line", { x1: X0, y1: ay, x2: X1, y2: ay, style: "stroke:var(--viz-line)" }, g);
      for (var t = 0; t <= END; t += 500) {
        V.svg("line", { x1: x(t), y1: ay, x2: x(t), y2: ay + 4, style: "stroke:var(--viz-line)" }, g);
        text(x(t), ay + 16, (t / 1000) + " ms", "font-size:10px;fill:var(--viz-muted)", "middle");
      }
      if (cursor != null) {
        var ct = sim.steps[cursor][0].t;
        V.svg("line", { x1: x(ct), y1: 24, x2: x(ct), y2: ay, style: "stroke:var(--viz-c1);stroke-width:1.5;stroke-dasharray:4 3" }, g);
      }
      // state word table
      var ty = 172, CX = [536, 580, 624, 668], CW = 40;
      text(8, ty - 8, cursor == null ? L("main 每次加锁的等待", "main's wait for each Lock") : L("本步的事件与 state 的各个字段", "Events in this step and the fields of state"), "font-size:12px;font-weight:600");
      if (cursor == null) {
        var mw = sim.waits.filter(function (wt) { return wt.who === "main"; });
        text(8, ty + 14 + mw.length * 20 + 12, L("场景：G1 每次持锁 100 µs，解锁后立即再次加锁；main 每隔 100 µs 加一次锁，持锁约 1 µs。",
          "Scenario: G1 holds the lock for 100 µs and locks again right after unlocking; main locks every 100 µs and holds it for about 1 µs."),
          "font-size:11px;fill:var(--viz-muted)");
        mw.forEach(function (wt, i) {
          var y = ty + 14 + i * 20;
          text(8, y, L("第 " + (i + 1) + " 次：从 " + us(wt.a) + " 开始，", "Lock " + (i + 1) + ": from " + us(wt.a) + ", ") +
            (wt.b != null ? L("等待 " + ms(wt.b - wt.a) + "。", "waited " + ms(wt.b - wt.a) + ".") : L("到图的末尾仍未取得锁。", "still waiting at the end of the figure.")), "font-size:12px");
        });
      } else {
        var heads = [L("等待者", "waiters"), L("饥饿", "starving"), L("唤醒", "woken"), L("加锁", "locked")];
        heads.forEach(function (h, i) { text(CX[i] + CW / 2, ty - 8, h, "font-size:10px;fill:var(--viz-muted)", "middle"); });
        var prev = cursor > 0 ? sim.steps[cursor - 1][sim.steps[cursor - 1].length - 1].st : { L: 0, W: 0, S: 0, n: 0 };
        sim.steps[cursor].forEach(function (e, i) {
          var y = ty + 2 + i * 24;
          text(8, y + 14, us(e.t), "font-size:11px;fill:var(--viz-muted);" + MONO);
          text(84, y + 14, short(e, mode), "font-size:12px");
          var vals = [e.st.n, mode === "go19" ? e.st.S : null, e.st.W, e.st.L], pv = [prev.n, prev.S, prev.W, prev.L];
          vals.forEach(function (v, k) {
            var changed = v != null && v !== pv[k];
            rect(CX[k], y, CW - 4, 20, changed ? "var(--viz-c1)" : "var(--viz-line)", changed ? 0.18 : 0.04);
            text(CX[k] + (CW - 4) / 2, y + 14, v == null ? "–" : String(v), "font-size:12px;" + MONO + (changed ? ";font-weight:600" : ""), "middle");
          });
          prev = e.st;
        });
      }
      text(8, 314, L("假设：被唤醒的 goroutine 约 5 µs 后才能运行，G1 解锁后不到 1 µs 就再次加锁。",
        "Assumed: a woken goroutine starts running about 5 µs later, while G1 relocks within 1 µs."), "font-size:10.5px;fill:var(--viz-muted)");
      text(8, 329, L("自旋（至多 4 轮）熬不过 100 µs 的临界区，图中略去。",
        "Spinning (at most 4 rounds) cannot outlast a 100 µs critical section and is left out."), "font-size:10.5px;fill:var(--viz-muted)");
    }

    function summary() {
      var ws = sim.waits.filter(function (wt) { return wt.who === "main"; });
      if (mode === "go19") {
        p.note.textContent = L("G1 每次解锁都会唤醒 main，又总在 main 运行之前把锁拿回去。main 等满 1 ms 之后的那次醒来，把锁切换到饥饿模式，G1 的下一次解锁便直接把锁交给它。每次加锁的等待因此约为 1 ms 加一个临界区。点「下一步」逐轮查看 state 的变化。",
          "Each unlock by G1 wakes main, and each time G1 takes the lock back before main runs. The first wake-up after main has waited 1 ms switches the lock to starvation mode, and G1's next unlock hands the lock straight to main. Each wait is therefore about 1 ms plus one critical section. Press Step to follow state round by round.");
      } else {
        var w = ws[ws.length - 1];
        p.note.textContent = L("Go 1.8 没有饥饿模式：main 每次醒来都输给正在运行的 G1，到图的末尾已等待 " + ms(END - w.a) + "，仍未取得锁。Cox 在 #13086 中测到的等待超过 100 秒。",
          "Go 1.8 has no starvation mode: main loses to the running G1 at every wake-up and is still waiting after " + ms(END - w.a) + ". In issue 13086 Cox measured waits of more than 100 seconds.");
      }
    }
    function narrate() {
      var evs = sim.steps[cursor];
      p.note.textContent = L("第 " + (cursor + 1) + " 步（共 " + sim.steps.length + " 步）：", "Step " + (cursor + 1) + " of " + sim.steps.length + ": ") +
        evs.map(function (e) { return long(e, mode); }).join(L("", " "));
    }

    function stop() { if (timer) { clearInterval(timer); timer = null; } playBtn.textContent = L("自动播放", "Play"); }
    function step() {
      cursor = cursor == null ? 0 : cursor + 1;
      if (cursor >= sim.steps.length) { cursor = null; draw(); summary(); return false; }
      draw(); narrate();
      return true;
    }
    function rebuild() { stop(); sim = simulate(mode); cursor = null; draw(); summary(); }

    V.button(p.bar, L("下一步", "Step"), function () { stop(); step(); });
    var playBtn = V.button(p.bar, L("自动播放", "Play"), function () {
      if (timer) { stop(); return; }
      if (cursor == null) cursor = -1;
      playBtn.textContent = L("暂停", "Pause");
      timer = setInterval(function () {
        if (!host.isConnected) { stop(); return; }
        if (!step()) stop();
      }, 900);
    });
    V.button(p.bar, L("显示全部", "Show all"), function () { stop(); cursor = null; draw(); summary(); });
    V.select(p.bar, L("版本", "Version"), [
      { value: "go19", label: L("Go 1.9 起：有饥饿模式", "Go 1.9 on: starvation mode") },
      { value: "go18", label: L("Go 1.8：没有饥饿模式", "Go 1.8: no starvation mode") },
    ], "go19", function (v) { mode = v; rebuild(); });

    rebuild();
  });
})();
