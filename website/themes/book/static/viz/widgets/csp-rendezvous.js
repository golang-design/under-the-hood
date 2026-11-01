/*
 * csp-rendezvous: who blocks, and when, on a Go channel (book §1.3).
 *
 * A sender goroutine produces four values and sends each on ch; a receiver
 * goroutine receives them one by one. Time advances in ticks. Work takes
 * ticks; channel operations take none, but may block. The rules are Go's:
 *
 *   send: a waiting receiver gets the value directly; otherwise the value
 *         goes into the buffer if there is room; otherwise the sender blocks.
 *   recv: take the oldest buffered value, and if a sender is blocked on a
 *         full buffer, move its value into the freed slot and wake it;
 *         with no buffer, take the blocked sender's value directly;
 *         otherwise the receiver blocks.
 *
 * The figure shows the whole timeline by default; Step replays it tick by
 * tick. The point the reader should see: with the slow side fixed, capacity
 * changes how long the fast side waits, not when the work is finished.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;

  var N = 4; // values sent
  var SCEN = {
    fastSend: { prod: 1, cons: 3 },
    fastRecv: { prod: 3, cons: 1 },
  };

  // Programs: sender = (work prod, send v) × N; receiver = (recv, work cons) × N.
  function programs(sc) {
    var s = [], r = [];
    for (var v = 1; v <= N; v++) {
      s.push({ op: "work", n: sc.prod }); s.push({ op: "send", v: v });
      r.push({ op: "recv" }); r.push({ op: "work", n: sc.cons });
    }
    return { s: s, r: r };
  }

  // Run the whole program. Returns per-tick states and events.
  function simulate(sc, cap) {
    var P = programs(sc);
    var G = {
      s: { prog: P.s, pc: 0, left: null, blocked: false, pend: null, blockedFor: 0, doneAt: null },
      r: { prog: P.r, pc: 0, left: null, blocked: false, blockedFor: 0, doneAt: null },
    };
    var buf = [], ticks = [], events = [], t = 0;
    function cur(g) { return g.prog[g.pc]; }
    function adv(g) { g.pc++; g.blocked = false; g.left = null; }
    function ev(e) { e.t = t; events.push(e); }

    function trySend() {
      var g = G.s, op = cur(g), r = G.r;
      if (!op || op.op !== "send" || g.blocked) return false;
      if (r.blocked) { // a receiver is waiting: hand the value over directly
        ev({ k: "hand", v: op.v }); adv(r); adv(g); return true;
      }
      if (buf.length < cap) { buf.push(op.v); ev({ k: "in", v: op.v, len: buf.length }); adv(g); return true; }
      g.blocked = true; g.pend = op.v;
      ev({ k: "sblock", v: op.v }); return true;
    }
    function tryRecv() {
      var g = G.r, op = cur(g), s = G.s;
      if (!op || op.op !== "recv" || g.blocked) return false;
      if (buf.length) {
        var v = buf.shift(); ev({ k: "out", v: v, len: buf.length }); adv(g);
        if (s.blocked) { buf.push(s.pend); ev({ k: "wake", v: s.pend, len: buf.length }); adv(s); }
        return true;
      }
      if (s.blocked) { ev({ k: "hand", v: s.pend, late: true }); adv(s); adv(g); return true; }
      g.blocked = true; ev({ k: "rblock" }); return true;
    }

    for (t = 0; t < 40; t++) {
      // Channel operations at instant t, until nothing changes.
      for (var guard = 0; guard < 10; guard++) {
        var a = trySend(), b = tryRecv();
        if (!a && !b) break;
      }
      ["s", "r"].forEach(function (k) {
        var g = G[k];
        if (g.pc >= g.prog.length && g.doneAt == null) g.doneAt = t;
      });
      if (G.s.doneAt != null && G.r.doneAt != null) break;
      // State during [t, t+1).
      var row = { buf: buf.slice(), sp: G.s.pc, rp: G.r.pc };
      ["s", "r"].forEach(function (k) {
        var g = G[k], op = cur(g);
        if (!op) { row[k] = "done"; return; }
        if (g.blocked) { row[k] = "block"; g.blockedFor++; return; }
        if (op.op === "work") {
          if (g.left == null) g.left = op.n;
          row[k] = "run"; g.left--;
        } else row[k] = "idle";
      });
      ticks.push(row);
      ["s", "r"].forEach(function (k) {
        var g = G[k], op = cur(g);
        if (op && op.op === "work" && g.left === 0) adv(g);
      });
    }
    return { ticks: ticks, events: events, T: t, s: G.s, r: G.r };
  }

  V.register("csp-rendezvous", function (host) {
    var p = V.panel(host, { title: L("channel 上谁在等：发送方与接收方的时间线", "Who waits on a channel: sender and receiver timelines") });
    var root = V.svg("svg", { viewBox: "0 0 720 262", role: "img",
      "aria-label": L("发送方、channel 缓冲区与接收方的时间线", "Timeline of sender, channel buffer and receiver") }, p.stage);
    var defs = V.svg("defs", null, root);
    var mk = V.svg("marker", { id: "cr-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5,
      markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
    V.svg("path", { d: "M0,0 L10,5 L0,10 z", style: "fill:var(--viz-muted)" }, mk);
    var g = V.svg("g", null, root);

    var cap = 0, scen = "fastSend", sim, cursor = null, timer = null;
    var X0 = 104, TW = 40; // time axis origin and tick width
    var LANE = { s: [34, 24], c: [72, 56], r: [146, 24] };
    function x(t) { return X0 + t * TW; }
    // rough text width at 11px: CJK glyphs are square, Latin about half
    function tw(s) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 11 : 6.2; return w; }

    function rect(x1, y, w, h, color, op) {
      return V.svg("rect", { x: x1, y: y, width: w, height: h, rx: 3,
        style: "fill:" + color + ";fill-opacity:" + op + ";stroke:" + color + ";stroke-width:1" }, g);
    }
    function text(x1, y, s, st) { return V.svg("text", { x: x1, y: y, style: st || "font-size:12px", text: s }, g); }
    function arrow(x1, y1, x2, y2) {
      V.svg("path", { d: "M" + x1 + "," + y1 + " L" + x2 + "," + y2, "marker-end": "url(#cr-arrow)",
        style: "fill:none;stroke:var(--viz-muted);stroke-width:1.2" }, g);
    }

    function draw() {
      while (g.firstChild) g.removeChild(g.firstChild);
      var upto = cursor == null ? sim.T : cursor; // draw instants <= upto
      // legend, right-aligned on one line
      var items = [["var(--viz-c1)", L("运行", "running")], ["var(--viz-c2)", L("阻塞", "blocked")],
        ["var(--viz-c4)", L("缓冲区中的值", "buffered value")], ["var(--viz-c3)", L("直接交接", "direct hand-off")]];
      var lx = 712;
      for (var li = items.length - 1; li >= 0; li--) {
        lx -= tw(items[li][1]) + 17;
        if (li === 3) V.svg("circle", { cx: lx + 6, cy: 12, r: 6, style: "fill:none;stroke:var(--viz-c3);stroke-width:1.4" }, g);
        else rect(lx, 6, 12, 12, items[li][0], 0.22);
        text(lx + 17, 16, items[li][1], "font-size:11px;fill:var(--viz-muted)");
        lx -= 14;
      }
      // lane labels
      text(8, LANE.s[0] + 16, L("发送方", "sender"), "font-size:12px;font-weight:600");
      text(8, LANE.c[0] + 24, "ch", "font-size:12px;font-weight:600;font-family:var(--font-mono,monospace)");
      text(8, LANE.c[0] + 40, cap ? L("容量 " + cap, "cap " + cap) : L("无缓冲", "unbuffered"), "font-size:11px;fill:var(--viz-muted)");
      text(8, LANE.r[0] + 16, L("接收方", "receiver"), "font-size:12px;font-weight:600");
      // channel lane frame
      V.svg("rect", { x: X0, y: LANE.c[0], width: sim.T * TW, height: LANE.c[1], rx: 4,
        style: "fill:var(--viz-fill);stroke:var(--viz-line)" }, g);
      var vis = cursor == null ? sim.ticks.length : Math.min(cursor + 1, sim.ticks.length);
      // Lanes: merge consecutive ticks of the same operation into one segment.
      ["s", "r"].forEach(function (k) {
        var y = LANE[k][0], h = LANE[k][1], t = 0;
        while (t < vis) {
          var st = sim.ticks[t][k], pc = sim.ticks[t][k + "p"], e = t + 1;
          while (e < vis && sim.ticks[e][k] === st && (st !== "run" || sim.ticks[e][k + "p"] === pc)) e++;
          var w = x(e) - x(t) - 2, cx = (x(t) + x(e)) / 2;
          if (st === "run") {
            rect(x(t) + 1, y, w, h, "var(--viz-c1)", 0.18);
            var v = k === "s" ? pc / 2 + 1 : (pc + 1) / 2;
            text(cx, y + 16, k === "s" ? L("生产 " + v, "make " + v) : L("处理 " + v, "use " + v),
              "font-size:10px;text-anchor:middle");
          } else if (st === "block") {
            rect(x(t) + 1, y, w, h, "var(--viz-c2)", 0.28);
            if (e - t >= 2) text(cx, y + 16, L("阻塞", "blocked"), "font-size:11px;text-anchor:middle");
          } else if (st === "done") {
            V.svg("line", { x1: x(t), y1: y + h / 2, x2: x(e), y2: y + h / 2,
              style: "stroke:var(--viz-line);stroke-dasharray:3 3" }, g);
          }
          t = e;
        }
      });
      // Buffer slots for each tick, filled bottom-up.
      if (cap) for (var t = 0; t < vis; t++) {
        var sh = Math.min(11, (LANE.c[1] - 8) / cap - 2);
        for (var i = 0; i < cap; i++) {
          var sy = LANE.c[0] + LANE.c[1] - 5 - (i + 1) * (sh + 2), v = sim.ticks[t].buf[i];
          V.svg("rect", { x: x(t) + 8, y: sy, width: TW - 16, height: sh, rx: 2,
            style: v ? "fill:var(--viz-c4);fill-opacity:.22;stroke:var(--viz-c4)" : "fill:none;stroke:var(--viz-line)" }, g);
          if (v) text(x(t) + TW / 2, sy + sh - 2, String(v), "font-size:9px;text-anchor:middle;font-family:var(--font-mono,monospace)");
        }
      }
      // done markers
      ["s", "r"].forEach(function (k) {
        var d = sim[k].doneAt;
        if (d != null && (cursor == null || d <= cursor))
          text(x(d) + 4, LANE[k][0] + 16, L("完成", "done"), "font-size:11px;fill:var(--viz-c3)");
      });
      // events
      sim.events.forEach(function (e) {
        if (e.t > upto) return;
        var xx = x(e.t), sb = LANE.s[0] + LANE.s[1], ct = LANE.c[0], cb = LANE.c[0] + LANE.c[1], rt = LANE.r[0];
        if (e.k === "hand") {
          arrow(xx, sb + 1, xx, rt - 1);
          V.svg("circle", { cx: xx, cy: ct + LANE.c[1] / 2, r: 8, style: "fill:var(--viz-fill);stroke:var(--viz-c3);stroke-width:1.4" }, g);
          text(xx, ct + LANE.c[1] / 2 + 4, String(e.v), "font-size:10px;text-anchor:middle;font-family:var(--font-mono,monospace)");
        } else if (e.k === "in" || e.k === "wake") {
          arrow(xx + 4, sb + 1, xx + 4, ct + 4);
          text(xx + 7, sb + 12, String(e.v), "font-size:9px;fill:var(--viz-muted);font-family:var(--font-mono,monospace)");
        } else if (e.k === "out") {
          arrow(xx - 4, cb - 4, xx - 4, rt - 1);
          text(xx - 7, rt - 4, String(e.v), "font-size:9px;fill:var(--viz-muted);text-anchor:end;font-family:var(--font-mono,monospace)");
        }
      });
      // time axis
      var ay = 182;
      V.svg("line", { x1: X0, y1: ay, x2: x(sim.T), y2: ay, style: "stroke:var(--viz-line)" }, g);
      for (var t = 0; t <= sim.T; t++) {
        V.svg("line", { x1: x(t), y1: ay, x2: x(t), y2: ay + 4, style: "stroke:var(--viz-line)" }, g);
        text(x(t), ay + 16, String(t), "font-size:10px;text-anchor:middle;fill:var(--viz-muted)");
      }
      text(8, ay + 16, L("时间（拍）", "time (ticks)"), "font-size:11px;fill:var(--viz-muted)");
      if (cursor != null) V.svg("line", { x1: x(cursor), y1: 26, x2: x(cursor), y2: ay,
        style: "stroke:var(--viz-c1);stroke-width:1.5;stroke-dasharray:4 3" }, g);
      // summary: totals, or counts so far while stepping
      ["s", "r"].forEach(function (k, i) {
        var G = sim[k], who = k === "s" ? L("发送方", "Sender") : L("接收方", "Receiver");
        var b = 0;
        for (var t = 0; t < vis; t++) if (sim.ticks[t][k] === "block") b++;
        var fin = G.doneAt != null && (cursor == null || G.doneAt <= cursor);
        var line = L(who + "：" + (cursor == null ? "" : "到第 " + cursor + " 拍为止") + "阻塞 " + b + " 拍" +
            (fin ? "，第 " + G.doneAt + " 拍" + (k === "s" ? "发完" : "处理完") + "四个值。" : "。"),
          who + ": blocked for " + b + (b === 1 ? " tick" : " ticks") + (cursor == null ? "" : " so far") +
            (fin ? ", finished " + (k === "s" ? "sending" : "handling") + " at tick " + G.doneAt + "." : "."));
        text(8, 224 + 22 * i, line, "font-size:12px");
      });
    }

    function summary() {
      var s = sim.s, r = sim.r;
      if (scen === "fastSend") {
        p.note.textContent = cap === 0
          ? L("无缓冲：发送方每次都要等接收方来取，双方在同一时刻完成交接（会合）。发送方共阻塞 " + s.blockedFor + " 拍。点「下一步」逐拍查看。",
              "Unbuffered: every send waits until the receiver takes the value; both complete the hand-off at the same instant (a rendezvous). The sender is blocked for " + s.blockedFor + " ticks. Press Step to replay.")
          : L("容量 " + cap + "：发送方最多可以领先接收方 " + cap + " 个值，" + (s.blockedFor ? "阻塞减少到 " + s.blockedFor + " 拍" : "一次也没有阻塞") + "。接收方仍然在第 " + r.doneAt + " 拍才处理完：缓冲区让快的一方少等，慢的一方并没有变快。",
              "Capacity " + cap + ": the sender may run up to " + cap + " values ahead, so " + (s.blockedFor ? "it is blocked for only " + s.blockedFor + (s.blockedFor === 1 ? " tick" : " ticks") : "it never blocks") + ". The receiver still finishes at tick " + r.doneAt + ": a buffer lets the fast side wait less; it does not make the slow side faster.");
      } else {
        p.note.textContent = L("接收方比发送方快：缓冲区始终是空的，接收方每次都在 <-ch 上等新值。容量改成多少，这张图都不变。",
          "The receiver is faster: the buffer is always empty and the receiver waits at <-ch for every value. Changing the capacity does not change this picture.");
      }
    }

    function narrate(t) {
      var es = sim.events.filter(function (e) { return e.t === t; }), out = [];
      es.forEach(function (e) {
        if (e.k === "hand") out.push(e.late
          ? L("接收方执行 <-ch，直接拿走阻塞中的发送方手里的值 " + e.v + "，双方同时继续。", "The receiver runs <-ch and takes value " + e.v + " straight from the blocked sender; both continue.")
          : L("发送方执行 ch <- " + e.v + "，接收方正等在 <-ch 上，值直接交给它，双方同时继续。", "The sender runs ch <- " + e.v + "; the receiver is already waiting, so the value is handed over and both continue."));
        else if (e.k === "in") out.push(L("ch <- " + e.v + " 立即返回：值放进缓冲区（" + e.len + "/" + cap + "）。", "ch <- " + e.v + " returns at once: the value goes into the buffer (" + e.len + "/" + cap + ")."));
        else if (e.k === "sblock") out.push(cap
          ? L("发送方执行 ch <- " + e.v + "，缓冲区已满，发送方阻塞。", "The sender runs ch <- " + e.v + "; the buffer is full, so it blocks.")
          : L("发送方执行 ch <- " + e.v + "，没有接收方在等，发送方阻塞。", "The sender runs ch <- " + e.v + "; no receiver is waiting, so it blocks."));
        else if (e.k === "out") out.push(L("<-ch 从缓冲区取走 " + e.v + "。", "<-ch takes " + e.v + " from the buffer."));
        else if (e.k === "wake") out.push(L("空出的位置立刻放进阻塞中的发送方的值 " + e.v + "，发送方被唤醒。", "The blocked sender's value " + e.v + " fills the freed slot, and the sender wakes up."));
        else if (e.k === "rblock") out.push(L("接收方执行 <-ch，缓冲区是空的，接收方阻塞。", "The receiver runs <-ch; the buffer is empty, so it blocks."));
      });
      if (!out.length) {
        var row = sim.ticks[t] || {}, w = [];
        if (row.s === "block") w.push(L("发送方仍在阻塞", "the sender is still blocked"));
        if (row.r === "block") w.push(L("接收方仍在阻塞", "the receiver is still blocked"));
        out.push(w.length ? w.join(L("，", "; ")) + L("。", ".") : L("双方都在忙自己的事。", "Both are busy with their own work."));
      }
      p.note.textContent = L("第 " + t + " 拍：", "Tick " + t + ": ") + out.join(L("", " "));
    }

    function stop() { if (timer) { clearInterval(timer); timer = null; } playBtn.textContent = L("自动播放", "Play"); }
    function step() {
      if (cursor == null) cursor = 0; else cursor++;
      if (cursor > sim.T) { cursor = null; draw(); summary(); return false; }
      draw(); narrate(cursor);
      return true;
    }
    function rebuild() { stop(); sim = simulate(SCEN[scen], cap); cursor = null; draw(); summary(); }

    V.button(p.bar, L("下一步", "Step"), function () { stop(); step(); });
    var playBtn = V.button(p.bar, L("自动播放", "Play"), function () {
      if (timer) { stop(); return; }
      if (cursor == null) { cursor = -1; }
      playBtn.textContent = L("暂停", "Pause");
      timer = setInterval(function () {
        if (!host.isConnected) { stop(); return; }
        if (!step()) stop();
      }, 900);
    });
    V.button(p.bar, L("显示全部", "Show all"), function () { stop(); cursor = null; draw(); summary(); });
    V.select(p.bar, L("容量", "Capacity"), [0, 1, 2, 4].map(function (c) {
      return { value: String(c), label: c ? String(c) : L("0（无缓冲）", "0 (unbuffered)") };
    }), "0", function (v) { cap = +v; rebuild(); });
    V.select(p.bar, L("场景", "Scene"), [
      { value: "fastSend", label: L("发送快，接收慢", "fast sender, slow receiver") },
      { value: "fastRecv", label: L("发送慢，接收快", "slow sender, fast receiver") },
    ], "fastSend", function (v) { scen = v; rebuild(); });

    rebuild();
  });
})();
