/*
 * continuous-batching: request-level batching, iteration-level (continuous)
 * batching, and why admission must reserve KV cache for the answer
 * (book §20.3.2).
 *
 * Seven requests arrive over the first steps; each has a prompt length T, an
 * answer length A (tokens until it stops) and a max_tokens limit M ≥ A. Four
 * slots share one paged KV cache pool. One step is one forward pass.
 *
 * The rules are Forma's (github.com/latere-ai/forma at 5af707fbe6, which the
 * chapter cites):
 *   admission (scheduler.go Admit, internal/prefix Pool.Acquire,
 *     specs/008-scheduler.md §3): a request is admitted when a slot is free
 *     and the pool can hold ⌈(T + R) / B⌉ blocks, taken together or not at
 *     all; here R = M, the request's own max_tokens (022-D7);
 *   step composition (schedule.go nextStep): mid-prefill slots first, each
 *     taking min(chunk, prompt left, rows left) rows, then one row per
 *     decoding slot; slots that do not fit wait a step and are not evicted;
 *   the step that finishes a prompt yields the first token; each decode feeds
 *     one token, writes one position and yields the next;
 *   Finish returns a slot's blocks at once.
 * "Free slot only" sets R = 0, which Forma refuses (NewScheduler) because of
 * the deadlock §3 describes: every slot occupied, the pool empty, no sequence
 * able to grow. The figure grows such a sequence one block at a time when a
 * block is free and stalls it otherwise, with no eviction, which is the
 * situation that section and the chapter describe.
 * "Request-level batching" is the problem Orca (Yu et al., OSDI 2022) names:
 * a new request waits until the whole batch finishes, and a request that
 * finishes early is returned only when the batch does. Its admission uses the
 * same reserve.
 *
 * Simplifications: the constants are scaled for legibility (4 positions per
 * block, chunks of 8 tokens, 12 rows per step; Forma uses CacheBlock = 32
 * and DefaultChunk = 512), the queue is strict first-come-first-served
 * (Forma's queue lets the head be overtaken a bounded number of times), and
 * there is no prefix reuse.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;

  var SLOTS = 4, NB = 16, B = 4, CHUNK = 8, ROWS = 12;
  var REQS = [
    { id: 1, a: 0, T: 4, A: 14, M: 15 },
    { id: 2, a: 2, T: 6, A: 2, M: 4 },
    { id: 3, a: 2, T: 7, A: 11, M: 13 },
    { id: 4, a: 3, T: 10, A: 2, M: 2 },
    { id: 5, a: 4, T: 6, A: 16, M: 17 },
    { id: 6, a: 5, T: 8, A: 11, M: 11 },
    { id: 7, a: 7, T: 6, A: 2, M: 2 },
  ];
  var SCEN = {
    req: { iter: false, reserve: true },
    iter: { iter: true, reserve: true },
    nores: { iter: true, reserve: false },
  };

  function simulate(sc) {
    var reqs = REQS.map(function (r) {
      return { id: r.id, a: r.a, T: r.T, A: r.A, M: r.M, slot: -1, pre: 0, gen: 0, pos: 0, blocks: [], ttft: null, fin: null, ret: null };
    });
    var pool = [], slots = [], queue = [], steps = [], deadlock = null;
    for (var i = 0; i < NB; i++) pool.push(0);
    for (i = 0; i < SLOTS; i++) slots.push(null);
    for (var k = 0; k < 80; k++) {
      var ev = { k: k, arrive: [], admit: [], blockedHead: null, prefill: [], decode: [], waitRows: [], stall: [], grow: [], first: [], finish: [], ret: [] };
      reqs.forEach(function (r) { if (r.a === k) { queue.push(r); ev.arrive.push(r.id); } });
      var empty = slots.every(function (s) { return s === null; });
      if (sc.iter || empty) {
        while (queue.length) {
          var r = queue[0], free = slots.indexOf(null);
          if (free < 0) { ev.blockedHead = { id: r.id, why: "slot" }; break; }
          var need = Math.ceil((r.T + (sc.reserve ? r.M : 0)) / B);
          var fb = [];
          pool.forEach(function (o, j) { if (!o) fb.push(j); });
          if (fb.length < need) { ev.blockedHead = { id: r.id, why: "blocks", need: need, free: fb.length }; break; }
          queue.shift();
          r.slot = free; slots[free] = r; r.blocks = fb.slice(0, need);
          r.blocks.forEach(function (j) { pool[j] = r.id; });
          ev.admit.push({ id: r.id, need: need });
        }
      } else if (queue.length) ev.blockedHead = { id: queue[0].id, why: "batch" };
      // Plan the step: prefills first, then one row per decoding slot.
      var left = ROWS, work = [], s;
      for (s = 0; s < SLOTS; s++) {
        r = slots[s];
        if (!r || r.fin != null || r.pre >= r.T) continue;
        var n = Math.min(CHUNK, r.T - r.pre, left);
        if (n <= 0) { work.push({ s: s, kind: "W" }); continue; }
        work.push({ s: s, kind: "P", n: n }); left -= n;
      }
      for (s = 0; s < SLOTS; s++) {
        r = slots[s];
        if (!r || r.fin != null || r.pre < r.T) continue;
        if (left <= 0) { work.push({ s: s, kind: "W" }); continue; }
        if (r.pos >= r.blocks.length * B) { // the next position needs a new block
          var f = pool.indexOf(0);
          if (f < 0) { work.push({ s: s, kind: "X" }); continue; }
          pool[f] = r.id; r.blocks.push(f); ev.grow.push(r.id);
        }
        work.push({ s: s, kind: "D" }); left--;
      }
      // Run it.
      var row = [];
      for (s = 0; s < SLOTS; s++) row.push(null);
      work.forEach(function (w) {
        var r = slots[w.s];
        if (w.kind === "P") {
          r.pre += w.n; r.pos += w.n; ev.prefill.push({ id: r.id, n: w.n });
          if (r.pre >= r.T) { r.gen = 1; r.ttft = k + 1 - r.a; ev.first.push(r.id); if (r.gen >= r.A) r.fin = k + 1; }
          row[w.s] = { id: r.id, k: "P" };
        } else if (w.kind === "D") {
          r.pos += 1; r.gen += 1; ev.decode.push(r.id);
          if (r.gen >= r.A) r.fin = k + 1;
          row[w.s] = { id: r.id, k: "D" };
        } else {
          (w.kind === "W" ? ev.waitRows : ev.stall).push(r.id);
          row[w.s] = { id: r.id, k: w.kind };
        }
      });
      for (s = 0; s < SLOTS; s++) if (!row[s] && slots[s]) row[s] = { id: slots[s].id, k: "H" };
      // Finish and return.
      slots.forEach(function (r) { if (r && r.fin === k + 1) ev.finish.push(r.id); });
      var live = slots.filter(Boolean);
      if (sc.iter) {
        live.forEach(function (r) {
          if (r.fin != null) { r.ret = r.fin; r.blocks.forEach(function (j) { pool[j] = 0; }); slots[r.slot] = null; ev.ret.push({ id: r.id, blocks: r.blocks.length }); }
        });
      } else if (live.length && live.every(function (r) { return r.fin != null; })) {
        live.forEach(function (r) { r.ret = k + 1; r.blocks.forEach(function (j) { pool[j] = 0; }); slots[r.slot] = null; ev.ret.push({ id: r.id, blocks: r.blocks.length }); });
      }
      var stalled = work.some(function (w) { return w.kind === "X"; }) &&
        !work.some(function (w) { return w.kind === "P" || w.kind === "D"; });
      steps.push({ row: row, ev: ev, queue: queue.map(function (r) { return r.id; }),
        pool: pool.slice(), pos: reqs.map(function (r) { return { id: r.id, pos: r.pos, blocks: r.blocks.slice(), live: r.slot >= 0 && r.ret == null }; }) });
      if (stalled) { deadlock = k; break; }
      if (reqs.every(function (r) { return r.ret != null; })) break;
    }
    return { steps: steps, reqs: reqs, deadlock: deadlock };
  }

  // "a, b and c" in English, "a、b、c" in Chinese.
  function andList(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  function list(a) { return L(a.join("、"), andList(a)); }
  function ids(a) { return list(a.map(function (x) { return "R" + (x.id != null ? x.id : x); })); }

  V.register("continuous-batching", function (host) {
    var p = V.panel(host, { title: L("连续批处理与 KV 缓存的准入：4 个槽位，16 个缓存块",
      "Continuous batching and KV cache admission: 4 slots, 16 cache blocks") });
    var W = 720, H = 366;
    var root = V.svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": L("槽位时间线、KV 缓存池与各请求的延迟", "Slot timeline, KV cache pool and per-request latency") }, p.stage);
    var g = V.svg("g", null, root);
    function text(x, y, s, st) { return V.svg("text", { x: x, y: y, style: st || "font-size:12px", text: s }, g); }
    function rect(x, y, w, h, st, rx) { return V.svg("rect", { x: x, y: y, width: w, height: h, rx: rx == null ? 2 : rx, style: st }, g); }
    function tw(s, px) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? px : px * 0.56; return w; }

    var scen = "iter", sim, cursor = null, timer = null;
    var X0 = 62, CW = 15, LY = 34, LH = 18, LG = 23;

    var STY = {
      P: "fill:var(--viz-c4);fill-opacity:.3;stroke:var(--viz-c4);stroke-width:.8",
      D: "fill:var(--viz-c1);fill-opacity:.28;stroke:var(--viz-c1);stroke-width:.8",
      W: "fill:none;stroke:var(--viz-c1);stroke-width:.8;stroke-dasharray:2 2",
      X: "fill:var(--viz-c2);fill-opacity:.35;stroke:var(--viz-c2);stroke-width:1",
      H: "fill:var(--viz-muted);fill-opacity:.2;stroke:none",
    };

    function draw() {
      while (g.firstChild) g.removeChild(g.firstChild);
      var last = sim.steps.length - 1, upto = cursor == null ? last : cursor;
      // Legend.
      var items = [["P", L("预填充", "prefill")], ["D", L("解码", "decode")], ["W", L("本步行数已满", "no rows left")],
        ["X", L("缺块，无法增长", "no block to grow")], ["H", L("已完成，等整批结束", "done, held for the batch")]];
      var lx = W - 8;
      for (var i = items.length - 1; i >= 0; i--) {
        lx -= tw(items[i][1], 11);
        text(lx, 16, items[i][1], "font-size:11px;fill:var(--viz-muted)");
        lx -= 16; rect(lx, 6, 12, 12, STY[items[i][0]]); lx -= 12;
      }
      // Slot lanes.
      for (var s = 0; s < SLOTS; s++) {
        var y = LY + s * LG;
        text(8, y + 13, L("槽位 " + s, "slot " + s), "font-size:11px;fill:var(--viz-muted)");
        V.svg("line", { x1: X0, y1: y + LH + 2, x2: X0 + (last + 1) * CW, y2: y + LH + 2, style: "stroke:var(--viz-line);stroke-width:.6" }, g);
        for (var k = 0; k <= upto; k++) {
          var c = sim.steps[k].row[s];
          if (!c) continue;
          rect(X0 + k * CW + 1, y, CW - 2, LH, STY[c.k]);
          if (c.k !== "H") text(X0 + k * CW + CW / 2, y + 12.5, String(c.id), "font-size:9.5px;text-anchor:middle;font-family:var(--font-mono,monospace)");
        }
      }
      // Step axis.
      var ay = LY + SLOTS * LG + 4;
      for (k = 0; k <= last + 1; k += 5) {
        V.svg("line", { x1: X0 + k * CW, y1: ay - 2, x2: X0 + k * CW, y2: ay + 2, style: "stroke:var(--viz-line)" }, g);
        text(X0 + k * CW, ay + 13, String(k), "font-size:10px;text-anchor:middle;fill:var(--viz-muted)");
      }
      text(8, ay + 13, L("步", "step"), "font-size:11px;fill:var(--viz-muted)");
      // The step whose queue and pool are shown: the cursor, or in the full
      // view the deadlocked step or else the step that allocated most blocks.
      var shown = cursor;
      if (shown == null) {
        shown = last;
        if (sim.deadlock == null) {
          var most = -1;
          sim.steps.forEach(function (st, j) { var n = st.pool.filter(Boolean).length; if (n > most) { most = n; shown = j; } });
        }
      }
      rect(X0 + shown * CW, LY - 4, CW, SLOTS * LG + 4, "fill:none;stroke:var(--viz-ink);stroke-width:1.2;stroke-opacity:" + (cursor != null ? ".7" : ".35"), 3);
      if (sim.deadlock != null && upto === last) {
        var dx = X0 + (last + 1) * CW + 6;
        text(dx, LY + 2 * LG - 2, L("死锁", "deadlock"), "font-size:12px;font-weight:600;fill:var(--viz-c2)");
      }
      // Queue at the cursor.
      var st = sim.steps[shown], qy = ay + 32;
      text(8, qy, L("第 " + shown + " 步结束时" + (cursor == null && sim.deadlock == null ? "（缓存占用最多）" : "") + "，等待准入：",
        "After step " + shown + (cursor == null && sim.deadlock == null ? " (most blocks in use)" : "") + ", waiting: ") +
        (st.queue.length ? st.queue.map(function (x) { return "R" + x; }).join(L("、", ", ")) : L("无", "none")), "font-size:11px");
      // KV pool after the step.
      var py = qy + 22, BW = 40;
      var used = st.pool.filter(Boolean).length;
      text(8, py + 4, L("KV 缓存池：每块 4 个位置，已分配 " + used + "/" + NB + " 块；实心为已写入的位置，空心为预留的位置",
        "KV cache pool: 4 positions per block, " + used + "/" + NB + " blocks allocated; filled positions are written, hollow ones reserved"),
        "font-size:11px;fill:var(--viz-muted)");
      var posOf = {};
      st.pos.forEach(function (q) { posOf[q.id] = q; });
      for (var b = 0; b < NB; b++) {
        var bx = 8 + b * (BW + 4), by = py + 12, owner = st.pool[b];
        rect(bx, by, BW, 30, owner ? "fill:var(--viz-fill);stroke:var(--viz-ink);stroke-width:.8;stroke-opacity:.6"
          : "fill:none;stroke:var(--viz-line);stroke-dasharray:3 2", 3);
        if (!owner) continue;
        text(bx + 4, by + 11, "R" + owner, "font-size:10px;font-family:var(--font-mono,monospace)");
        var q = posOf[owner], j = q.blocks.indexOf(b), written = Math.max(0, Math.min(B, q.pos - j * B));
        for (var u = 0; u < B; u++) {
          rect(bx + 4 + u * 8.5, by + 16, 7, 9, u < written ? "fill:var(--viz-ink);fill-opacity:.55" : "fill:none;stroke:var(--viz-ink);stroke-opacity:.5;stroke-width:.8", 1);
        }
      }
      // Per-request table.
      var ty = py + 64, cols = [8, 60, 112, 176, 288, 400];
      var head = [L("请求", "req"), L("到达", "arrives"), L("提示", "prompt"), L("回答（上限）", "answer (max)"), L("首词元时间", "first token"), L("返回时间", "returned after")];
      head.forEach(function (h, i) { text(cols[i], ty, h, "font-size:11px;font-weight:600"); });
      sim.reqs.forEach(function (r, i) {
        var y = ty + 15 + i * 14.5;
        var seen = function (v, rel) { return v != null && (cursor == null || v + (rel ? r.a : 0) <= cursor + 1); };
        var cells = ["R" + r.id, L("第 " + r.a + " 步", "step " + r.a), r.T, r.A + " (" + r.M + ")",
          seen(r.ttft, true) ? L(r.ttft + " 步", r.ttft + (r.ttft === 1 ? " step" : " steps")) : "—",
          seen(r.ret, false) ? L((r.ret - r.a) + " 步", (r.ret - r.a) + " steps") : "—"];
        cells.forEach(function (v, j) { text(cols[j], y, String(v), "font-size:11px"); });
      });
    }

    function summary() {
      var r = sim.reqs, done = r.filter(function (q) { return q.ret != null; });
      var avg = function (f) { var a = done.map(f); return a.length ? (a.reduce(function (x, y) { return x + y; }, 0) / a.length).toFixed(1) : "—"; };
      var busy = 0;
      sim.steps.forEach(function (st) { st.row.forEach(function (c) { if (c && (c.k === "P" || c.k === "D")) busy++; }); });
      var util = Math.round(100 * busy / (sim.steps.length * SLOTS));
      if (scen === "req") p.note.textContent = L(
        "以请求为单位组批：批次开始后不再接纳新请求，R2、R3、R4 在第 2、3 步到达，却要等 R1 完成、下一批在第 14 步开始；批中先完成的请求也要等整批结束才返回。" +
        "全部完成用时 " + sim.steps.length + " 步，槽位利用率 " + util + "%，平均首词元时间 " + avg(function (q) { return q.ttft; }) + " 步。点「下一步」逐步观察，或切换到连续批处理比较。",
        "Request-level batching: once a batch starts it takes no new requests, so R2, R3 and R4, arriving at steps 2 and 3, wait until R1 is done and the next batch starts at step 14, and a request that finishes early is returned only when its batch ends. " +
        "Everything finishes in " + sim.steps.length + " steps, with " + util + "% slot utilization and an average time to first token of " + avg(function (q) { return q.ttft; }) + " steps. Press Step to replay, or switch to continuous batching.");
      else if (scen === "iter") p.note.textContent = L(
        "连续批处理：每一步都可以准入新请求、移出已完成的请求。准入时按 ⌈(T + R) / B⌉ 为提示与回答一并预留缓存块（R 取请求的 max_tokens），" +
        "因此 R6 要等到第 14 步才有足够的块；但每个被准入的请求都能完成。全部完成用时 " + sim.steps.length + " 步，槽位利用率 " + util + "%，平均首词元时间 " + avg(function (q) { return q.ttft; }) + " 步。",
        "Continuous batching: every step can admit new requests and retire finished ones. Admission reserves ⌈(T + R) / B⌉ blocks for the prompt and the answer together (R is the request's max_tokens), " +
        "so R6 waits until step 14 for enough blocks, but every admitted request can finish. Everything finishes in " + sim.steps.length + " steps, with " + util + "% slot utilization and an average time to first token of " + avg(function (q) { return q.ttft; }) + " steps.");
      else p.note.textContent = L(
        "只看空闲槽位、不为回答预留：准入时只分配提示所需的块，四个槽位很快占满，利用率一度更高。但序列在增长中逐渐耗尽缓存池，到第 " + sim.deadlock +
        " 步，R1、R3、R5、R6 都需要新的块而池已空：没有序列能继续增长，也就没有序列能完成并释放缓存。这正是 Forma 拒绝零预留的原因。",
        "Free slot only, no reserve for the answer: admission allocates only the prompt's blocks, so all four slots fill quickly and utilization is higher for a while. But the growing sequences use up the pool, and at step " + sim.deadlock +
        " R1, R3, R5 and R6 all need a new block while the pool is empty: no sequence can grow, so none can finish and give blocks back. This is why Forma refuses a zero reserve.");
    }

    function narrate(k) {
      var e = sim.steps[k].ev, out = [];
      function many(a) { return a.length > 1; }
      function blocks(n) { return n + (n === 1 ? " block" : " blocks"); }
      if (e.arrive.length) out.push(L(ids(e.arrive) + " 到达", ids(e.arrive) + (many(e.arrive) ? " arrive" : " arrives")));
      if (e.admit.length) out.push(L("准入 " + e.admit.map(function (a) { return "R" + a.id + "（分配 " + a.need + " 块）"; }).join("、"),
        "admit " + andList(e.admit.map(function (a) { return "R" + a.id + " with " + blocks(a.need); }))));
      if (e.blockedHead) {
        var h = e.blockedHead;
        out.push(h.why === "batch" ? L("R" + h.id + " 等待当前批次结束", "R" + h.id + " waits for the current batch to end")
          : h.why === "slot" ? L("R" + h.id + " 等待空闲槽位", "R" + h.id + " waits for a free slot")
          : L("R" + h.id + " 需要 " + h.need + " 块，池中只剩 " + h.free + " 块，继续等待", "R" + h.id + " needs " + blocks(h.need) + " but only " + h.free + " are free, so it waits"));
      }
      if (e.prefill.length) out.push(L("预填充 " + e.prefill.map(function (x) { return "R" + x.id + " 的 " + x.n + " 个词元"; }).join("、"),
        "prefill " + andList(e.prefill.map(function (x) { return x.n + (x.n === 1 ? " token" : " tokens") + " of R" + x.id; }))));
      if (e.first.length) out.push(L(ids(e.first) + " 得到首个词元", ids(e.first) + (many(e.first) ? " get their first tokens" : " gets its first token")));
      if (e.decode.length) out.push(many(e.decode) ? L("解码 " + ids(e.decode) + "，各生成一个词元", "decode one token each for " + ids(e.decode))
        : L("解码 " + ids(e.decode) + "，生成一个词元", "decode one token for " + ids(e.decode)));
      if (e.grow.length) out.push(L(ids(e.grow) + " 写满了已有的块，从池中再取一块", ids(e.grow) + (many(e.grow) ? " have filled their blocks and take one more each" : " has filled its blocks and takes one more")));
      if (e.waitRows.length) out.push(L("本步的 " + ROWS + " 行已用完，" + ids(e.waitRows) + " 等待下一步（不被逐出）",
        "the step's " + ROWS + " rows are used up, so " + ids(e.waitRows) + (many(e.waitRows) ? " wait" : " waits") + " a step (not evicted)"));
      if (e.stall.length) out.push(L(ids(e.stall) + " 需要新的块，池已空，无法增长",
        ids(e.stall) + (many(e.stall) ? " need a new block, but the pool is empty, so they cannot grow" : " needs a new block, but the pool is empty, so it cannot grow")));
      if (e.finish.length) out.push(L(ids(e.finish) + " 生成完毕", ids(e.finish) + (many(e.finish) ? " finish" : " finishes")));
      if (e.ret.length) {
        var nb = e.ret.reduce(function (a, x) { return a + x.blocks; }, 0);
        out.push(L(ids(e.ret) + " 返回结果并归还 " + nb + " 块", ids(e.ret) + (many(e.ret) ? " return and give back " : " returns and gives back ") + blocks(nb)));
      }
      var s = out.length ? out.join(L("；", "; ")) : L("各序列继续解码", "the sequences keep decoding");
      var line = L("第 " + k + " 步：" + s + "。", "Step " + k + ": " + s.charAt(0).toUpperCase() + s.slice(1) + ".");
      if (sim.deadlock === k) line += L("所有在途序列都在等待缓存块，调度陷入死锁。", " Every live sequence is waiting for a block: the scheduler is deadlocked.");
      p.note.textContent = line;
    }

    function stop() { if (timer) { clearInterval(timer); timer = null; } playBtn.textContent = L("自动播放", "Play"); }
    function step() {
      cursor = cursor == null ? 0 : cursor + 1;
      if (cursor >= sim.steps.length) { cursor = null; draw(); summary(); return false; }
      draw(); narrate(cursor);
      return true;
    }
    function rebuild() { stop(); sim = simulate(SCEN[scen]); cursor = null; draw(); summary(); }

    V.button(p.bar, L("下一步", "Step"), function () { stop(); step(); });
    var playBtn = V.button(p.bar, L("自动播放", "Play"), function () {
      if (timer) { stop(); return; }
      if (cursor == null) cursor = -1;
      playBtn.textContent = L("暂停", "Pause");
      timer = setInterval(function () {
        if (!host.isConnected) { stop(); return; }
        if (!step()) stop();
      }, 700);
    });
    V.button(p.bar, L("显示全部", "Show all"), function () { stop(); cursor = null; draw(); summary(); });
    V.select(p.bar, L("情形", "Scenario"), [
      { value: "req", label: L("以请求为单位组批", "Request-level batching") },
      { value: "iter", label: L("连续批处理，准入时预留", "Continuous, reserve at admission") },
      { value: "nores", label: L("连续批处理，只看空闲槽位", "Continuous, free slot only") },
    ], "iter", function (v) { scen = v; rebuild(); });

    rebuild();
  });
})();
