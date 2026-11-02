/*
 * timer-heap: one P's timer heap, with lazy deletion (book §9.10.3 to §9.10.5).
 *
 * Everything follows src/runtime/time.go in Go 1.26:
 *   heap        []timerWhen, a 4-ary min-heap (timerHeapN = 4) on the
 *               redundant copy timerWhen.when; parent of i is (i-1)/4.
 *   maybeAdd    cleanHead, then set timerHeaped and addHeap (append, siftUp).
 *   cleanHead   drop zombies from the tail; while the head is zombie or
 *               modified, updateHeap it (zombie: deleteMin; modified: copy
 *               when into heap[0] and siftDown).
 *   stop        set timerModified and timerZombie (zombies++), when = 0;
 *               the heap is not touched.
 *   modify      (Reset) set when and timerModified; a zombie is revived
 *               (zombies--); lower minWhenModified if the new when is
 *               earlier. A timer not in a heap is added by maybeAdd.
 *   check       wakeTime = min(minWhenHeap, minWhenModified); force is
 *               zombies > len/4 (local P); return at once if now < wakeTime
 *               and !force; else adjust(now, false), run the head until it
 *               is not due, then adjust(now, true) if force holds again.
 *   adjust      unless forced, scan only if minWhenModified != 0 and has
 *               arrived; the scan removes zombies (swap with the last),
 *               copies new whens, and rebuilds with initHeap.
 *   run         head neither modified nor zombie and not due: stop;
 *               updateHeap and retry; not due: stop; else unlockAndRun: a
 *               one-shot timer gets when = 0, becomes a zombie, and
 *               updateHeap removes it before f runs.
 * The timers are one-shot non-channel timers (time.AfterFunc): channel
 * timers enter the heap only while a goroutine is blocked on the channel.
 * Times are in milliseconds for readability.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace);font-variant-ligatures:none";
  var N4 = 4, CAP = 21; // three levels of a 4-ary heap
  var INIT = [30, 50, 20, 70, 45, 60, 25, 90, 40, 55];

  V.register("timer-heap", function (host) {
    var p = V.panel(host, { title: L("计时器堆：四叉堆与惰性删除", "The timer heap: a 4-ary heap with lazy deletion") });
    var root = V.svg("svg", { viewBox: "0 0 720 366", role: "img",
      "aria-label": L("一个 P 的计时器四叉堆、它的数组以及 timers 的字段", "One P's 4-ary timer heap, its array, and the fields of timers") }, p.stage);
    var g = V.svg("g", null, root);

    var ts, timers, now, nextName, sel, touched, dur = 20;

    // ---- the runtime's data structures ------------------------------------
    function name(k) { return k < 26 ? String.fromCharCode(65 + k) : String.fromCharCode(97 + (k - 26) % 26); }
    function newTimer() { var t = { id: name(nextName++), when: 0, heaped: false, mod: false, zombie: false, fired: false }; timers.push(t); return t; }
    function less(a, b) { return a.when < b.when; }
    function siftUp(i) {
      var h = ts.heap, tw = h[i], moved = 0;
      while (i > 0) {
        var pa = Math.floor((i - 1) / N4);
        if (!less(tw, h[pa])) break;
        h[i] = h[pa]; i = pa; moved++;
      }
      h[i] = tw;
      return moved;
    }
    function siftDown(i) {
      var h = ts.heap, n = h.length, moved = 0;
      if (i * N4 + 1 >= n) return 0;
      var tw = h[i];
      for (;;) {
        var lc = i * N4 + 1;
        if (lc >= n) break;
        var w = tw, c = -1;
        for (var j = lc; j < Math.min(lc + N4, n); j++) if (less(h[j], w)) { w = h[j]; c = j; }
        if (c < 0) break;
        h[i] = h[c]; i = c; moved++;
      }
      h[i] = tw;
      return moved;
    }
    function initHeap() {
      if (ts.heap.length <= 1) return;
      for (var i = Math.floor((ts.heap.length - 2) / N4); i >= 0; i--) siftDown(i);
    }
    function updateMinWhenHeap() { ts.minWhenHeap = ts.heap.length ? ts.heap[0].when : 0; }
    function wakeTime() {
      var nw = ts.minWhenModified, w = ts.minWhenHeap;
      if (w === 0 || (nw !== 0 && nw < w)) w = nw;
      return w;
    }
    function deleteMin() {
      var h = ts.heap, last = h.length - 1;
      if (last > 0) h[0] = h[last];
      h.pop();
      if (last > 0) siftDown(0);
      updateMinWhenHeap();
      if (last === 0) ts.minWhenModified = 0;
    }
    function updateHeap(t, out) { // t is the head
      if (t.zombie) {
        t.heaped = t.zombie = t.mod = false; ts.zombies--;
        deleteMin();
        out.push(L(t.id + " 是僵尸，移出堆", t.id + " is a zombie and is removed"));
        touched[t.id] = 1;
        return true;
      }
      if (t.mod) {
        t.mod = false; ts.heap[0].when = t.when;
        var m = siftDown(0); updateMinWhenHeap();
        out.push(L(t.id + " 已修改，副本改为 " + t.when + (m ? " 后下沉 " + m + " 层" : "，仍留在堆顶"),
          t.id + " was modified: its copy becomes " + t.when + (m ? " and it sifts down " + m + (m === 1 ? " level" : " levels") : " and it stays at the head")));
        touched[t.id] = 1;
        return true;
      }
      return false;
    }
    function cleanHead(out) {
      for (;;) {
        var h = ts.heap;
        if (!h.length) return;
        var tail = h[h.length - 1].t;
        if (tail.zombie) {
          tail.heaped = tail.zombie = tail.mod = false; ts.zombies--; h.pop();
          out.push(L("从尾部删除僵尸 " + tail.id, "drop zombie " + tail.id + " from the tail"));
          continue;
        }
        var t = h[0].t;
        if (!t.mod && !t.zombie) return;
        if (!updateHeap(t, out)) return;
      }
    }
    function addHeap(t) {
      ts.heap.push({ t: t, when: t.when });
      var m = siftUp(ts.heap.length - 1);
      if (ts.heap[0].t === t) updateMinWhenHeap();
      return m;
    }
    function maybeAdd(t, out) {
      var pre = [];
      cleanHead(pre);
      if (pre.length) out.push(L("cleanHead：", "cleanHead: ") + pre.join(L("；", "; ")) + L("。", "."));
      t.heaped = true;
      var m = addHeap(t);
      touched[t.id] = 1;
      out.push(m
        ? L("addHeap：把 " + t.id + "（" + t.when + "）放到数组末尾，上浮 " + m + " 层。",
            "addHeap appends " + t.id + " (" + t.when + ") and sifts it up " + m + (m === 1 ? " level." : " levels."))
        : L("addHeap：把 " + t.id + "（" + t.when + "）放到数组末尾；它不早于父节点，留在原处。",
            "addHeap appends " + t.id + " (" + t.when + "); it is not earlier than its parent, so it stays there."));
    }
    function adjust(force, out) {
      if (!force) {
        var first = ts.minWhenModified;
        if (first === 0 || first > now) return false;
      }
      ts.minWhenHeap = wakeTime();
      ts.minWhenModified = 0;
      var dz = 0, dm = 0, changed = false;
      for (var i = 0; i < ts.heap.length; i++) {
        var tw = ts.heap[i], t = tw.t;
        if (!t.mod && !t.zombie) continue;
        if (t.zombie) {
          ts.zombies--; t.heaped = t.zombie = t.mod = false;
          ts.heap[i] = ts.heap[ts.heap.length - 1]; ts.heap.pop(); i--; dz++; changed = true;
        } else { tw.when = t.when; t.mod = false; dm++; changed = true; touched[t.id] = 1; }
      }
      if (changed) initHeap();
      updateMinWhenHeap();
      out.push(L("adjust" + (force ? "（强制）" : " ") + "扫描整个数组：删除 " + dz + " 个僵尸，更新 " + dm + " 个已修改的计时器" + (changed ? "，用 initHeap 重建堆。" : "。"),
        "adjust" + (force ? " (forced)" : "") + " scans the whole array: removes " + dz + (dz === 1 ? " zombie" : " zombies") + ", updates " + dm + " modified " + (dm === 1 ? "timer" : "timers") + (changed ? ", and rebuilds the heap with initHeap." : ".")));
      return true;
    }
    function run(out) {
      for (;;) {
        if (!ts.heap.length) return -1;
        var tw = ts.heap[0], t = tw.t;
        if (!t.mod && !t.zombie && tw.when > now) return tw.when;
        var fix = [];
        if (updateHeap(t, fix)) { out.push(L("堆顶 ", "The head ") + fix[0] + L("。", ".")); continue; }
        if (t.when > now) return t.when;
        // unlockAndRun, one-shot: when = 0, zombie, removed by updateHeap
        t.when = 0; t.mod = true; t.zombie = true; ts.zombies++;
        t.heaped = t.zombie = t.mod = false; ts.zombies--; deleteMin();
        t.fired = true;
        out.push(L("堆顶 " + t.id + " 到期：移出堆，执行它的 f。", "The head " + t.id + " is due: it leaves the heap and its f runs."));
        return 0;
      }
    }
    function check() {
      var out = [], next = wakeTime();
      if (next === 0) return L("check：堆中没有计时器。", "check: the heap is empty.");
      var force = ts.zombies > Math.floor(ts.heap.length / N4);
      if (now < next && !force)
        return L("check：now = " + now + " 早于 wakeTime = " + next + "，僵尸 " + ts.zombies + " 个，不超过 len/4 = " + Math.floor(ts.heap.length / N4) + "，不加锁就返回。",
          "check: now = " + now + " is before wakeTime = " + next + ", and " + ts.zombies + (ts.zombies === 1 ? " zombie does" : " zombies do") + " not exceed len/4 = " + Math.floor(ts.heap.length / N4) + ", so it returns without locking.");
      out.push(force && now < next
        ? L("check：僵尸 " + ts.zombies + " 个，超过 len/4 = " + Math.floor(ts.heap.length / N4) + "，需要整理。", "check: " + ts.zombies + " zombies exceed len/4 = " + Math.floor(ts.heap.length / N4) + ", so the heap needs cleaning.")
        : L("check：now = " + now + " 已到 wakeTime = " + next + "，锁住堆。", "check: now = " + now + " has reached wakeTime = " + next + ", so it locks the heap."));
      if (ts.heap.length) {
        adjust(false, out);
        for (;;) {
          var r = run(out);
          if (r !== 0) { if (r > 0) out.push(L("堆顶 " + ts.heap[0].t.id + "（" + r + "）尚未到期，停止。", "The head " + ts.heap[0].t.id + " (" + r + ") is not due yet; stop.")); break; }
        }
        if (ts.zombies > Math.floor(ts.heap.length / N4)) adjust(true, out);
      }
      return out.join(L("", " "));
    }

    // ---- operations ------------------------------------------------------------
    function reset() {
      ts = { heap: [], zombies: 0, minWhenHeap: 0, minWhenModified: 0 };
      timers = []; now = 0; nextName = 0; touched = {};
      INIT.forEach(function (w) { var t = newTimer(); t.when = w; t.heaped = true; addHeap(t); });
      sel = ts.heap[0].t;
      draw();
      p.note.textContent = L("10 个计时器按到期时间组成四叉最小堆，下标 i 的父节点在 (i−1)/4。点一个计时器选中它，用 Stop 或 Reset 修改，再让时钟前进，看 P 的 check 怎样处理。",
        "Ten timers form a 4-ary min-heap by expiry time; the parent of index i is (i−1)/4. Click a timer to select it, change it with Stop or Reset, then advance the clock to see how the P's check deals with it.");
    }
    function act(fn) { touched = {}; var msg = fn(); draw(); p.note.textContent = msg; }

    function afterFunc() {
      if (ts.heap.length >= CAP) return L("这张图只画三层，堆已满。", "The figure draws only three levels, and the heap is full.");
      var t = newTimer(); t.when = now + dur; sel = t;
      var out = [L("time.AfterFunc(" + dur + " ms) 创建 " + t.id + "，when = " + t.when + "。", "time.AfterFunc(" + dur + " ms) creates " + t.id + " with when = " + t.when + ".")];
      maybeAdd(t, out);
      return out.join(L("", " "));
    }
    function stop() {
      var t = sel;
      if (!t) return L("先选中一个计时器。", "Select a timer first.");
      if (!t.heaped) return L(t.id + " 不在堆中（已执行或已停止），Stop 返回 false。", t.id + " is not in a heap (it has run or was stopped); Stop returns false.");
      var was = t.zombie;
      t.mod = true;
      if (!t.zombie) { t.zombie = true; ts.zombies++; }
      t.when = 0;
      touched[t.id] = 1;
      if (was) return L(t.id + " 已经停止过，Stop 返回 false。", t.id + " was already stopped; Stop returns false.");
      return L("Stop(" + t.id + ")：只给它打上僵尸标记，zombies 变为 " + ts.zombies + "；堆中的元素一个也不移动。",
        "Stop(" + t.id + ") only marks it as a zombie, and zombies becomes " + ts.zombies + "; nothing in the heap moves.");
    }
    function resetTimer() {
      var t = sel;
      if (!t) return L("先选中一个计时器。", "Select a timer first.");
      var when = now + dur, out = [];
      t.when = when; t.fired = false;
      touched[t.id] = 1;
      if (t.heaped) {
        t.mod = true;
        var revived = t.zombie;
        if (t.zombie) { ts.zombies--; t.zombie = false; }
        var lowered = false, prevMin = ts.minWhenModified;
        if (ts.minWhenModified === 0 || when < ts.minWhenModified) { ts.minWhenModified = when; lowered = true; }
        out.push(L("Reset(" + t.id + ", " + dur + " ms)：when 改为 " + when + "，打上已修改标记" + (revived ? "，并撤销僵尸标记" : "") + "；堆中的副本仍是旧值。" +
            (lowered ? (prevMin ? "minWhenModified 降为 " : "minWhenModified 记下 ") + when + "。" : ""),
          "Reset(" + t.id + ", " + dur + " ms) sets when to " + when + " and marks it modified" + (revived ? ", clearing the zombie mark" : "") + "; the copy in the heap keeps the old value." +
            (lowered ? (prevMin ? " minWhenModified drops to " : " minWhenModified records ") + when + "." : "")));
      } else {
        out.push(L("Reset(" + t.id + ", " + dur + " ms)：它不在堆中，when 改为 " + when + "，由 maybeAdd 加入当前 P 的堆。",
          "Reset(" + t.id + ", " + dur + " ms): it is not in a heap, so when becomes " + when + " and maybeAdd puts it in the current P's heap."));
        maybeAdd(t, out);
      }
      return out.join(L("", " "));
    }
    function advance(to) {
      if (to == null) {
        var w = wakeTime();
        if (!w) return L("没有计时器，wakeTime 为 0。", "No timers: wakeTime is 0.");
        now = Math.max(now, w);
      } else now += to;
      return check();
    }

    // ---- drawing ---------------------------------------------------------------
    function nodePos(i) {
      if (i === 0) return { x: 360, y: 34 };
      if (i <= 4) return { x: 120 + 160 * (i - 1), y: 96 };
      return { x: 60 + 40 * (i - 5), y: 158 };
    }
    function text(x, y, s, st, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: st || "font-size:12px", text: s }, g);
    }
    function colorOf(t) { return t.zombie ? "var(--viz-c2)" : t.mod ? "var(--viz-c4)" : "var(--viz-c1)"; }
    function pick(t) { return function () { sel = t; touched = {}; draw(); describe(); }; }
    function describe() {
      var t = sel;
      var stt = !t.heaped ? (t.fired ? L("已执行，不在堆中", "has run, not in a heap") : L("不在堆中", "not in a heap"))
        : t.zombie ? L("僵尸：已停止，仍在堆中", "zombie: stopped but still in the heap")
        : t.mod ? L("已修改：堆中的副本尚未更新", "modified: the heap copy is stale") : L("在堆中", "in the heap");
      p.note.textContent = L("选中 " + t.id + "：when = " + t.when + "，" + stt + "。", "Selected " + t.id + ": when = " + t.when + ", " + stt + ".");
    }

    function draw() {
      while (g.firstChild) g.removeChild(g.firstChild);
      var h = ts.heap;
      // legend and clock
      text(8, 16, "now = " + now + " ms", "font-size:13px;font-weight:600;" + MONO);
      var items = [["var(--viz-c1)", L("正常", "normal"), false], ["var(--viz-c4)", L("已修改", "modified"), false], ["var(--viz-c2)", L("僵尸", "zombie"), true]];
      var lx = 712;
      for (var li = items.length - 1; li >= 0; li--) {
        var w = items[li][1].length * (/[a-z]/.test(items[li][1]) ? 6.4 : 11);
        lx -= w + 18;
        V.svg("rect", { x: lx, y: 6, width: 12, height: 12, rx: 2, style: "fill:" + items[li][0] + ";fill-opacity:.15;stroke:" + items[li][0] + (items[li][2] ? ";stroke-dasharray:2 2" : "") }, g);
        text(lx + 16, 16, items[li][1], "font-size:11px;fill:var(--viz-muted)");
        lx -= 10;
      }
      // edges
      for (var i = 1; i < h.length; i++) {
        var a = nodePos(Math.floor((i - 1) / N4)), b = nodePos(i);
        V.svg("line", { x1: a.x, y1: a.y + 34, x2: b.x, y2: b.y, style: "stroke:var(--viz-line)" }, g);
      }
      // nodes
      h.forEach(function (tw, i) {
        var q = nodePos(i), t = tw.t, c = colorOf(t), isSel = sel === t, hot = touched[t.id];
        var gg = V.svg("g", { style: "cursor:pointer", on: { click: pick(t) } }, g);
        V.svg("rect", { x: q.x - 18, y: q.y, width: 36, height: 34, rx: 5,
          style: "fill:" + c + ";fill-opacity:" + (hot ? 0.3 : 0.1) + ";stroke:" + c + ";stroke-width:" + (isSel ? 2.6 : 1.2) + (t.zombie ? ";stroke-dasharray:3 2" : "") }, gg);
        V.svg("text", { x: q.x, y: q.y + 14, "text-anchor": "middle", style: "font-size:12px;font-weight:600", text: t.id + (t.zombie ? " ×" : "") }, gg);
        V.svg("text", { x: q.x, y: q.y + 28, "text-anchor": "middle", style: "font-size:" + (t.mod && !t.zombie ? 9.5 : 11) + "px;" + MONO + (t.zombie ? ";fill:var(--viz-muted)" : ""),
          text: t.mod && !t.zombie ? tw.when + "→" + t.when : String(tw.when) }, gg);
        if (isSel) text(q.x, q.y - 4, L("选中", "selected"), "font-size:9px;fill:var(--viz-muted)", "middle");
      });
      // array strip
      var ay = 222;
      text(8, ay - 6, "heap []timerWhen", "font-size:12px;font-weight:600;" + MONO);
      text(712, ay - 6, L("数组中只存指针与到期时间的副本；格中数字为副本", "The array stores a pointer and a copy of when; cells show the copy"), "font-size:10.5px;fill:var(--viz-muted)", "end");
      for (i = 0; i < CAP; i++) {
        var x = 40 + 31 * i, tw2 = h[i];
        var cc = tw2 ? colorOf(tw2.t) : "var(--viz-line)";
        var cell = V.svg("g", tw2 ? { style: "cursor:pointer", on: { click: pick(tw2.t) } } : null, g);
        V.svg("rect", { x: x, y: ay, width: 29, height: 30, rx: 3,
          style: "fill:" + (tw2 ? cc : "none") + ";fill-opacity:.1;stroke:" + cc + (tw2 && tw2.t.zombie ? ";stroke-dasharray:3 2" : "") + (tw2 && sel === tw2.t ? ";stroke-width:2.4" : "") }, cell);
        if (tw2) {
          V.svg("text", { x: x + 14.5, y: ay + 13, "text-anchor": "middle", style: "font-size:11px;font-weight:600", text: tw2.t.id }, cell);
          V.svg("text", { x: x + 14.5, y: ay + 26, "text-anchor": "middle", style: "font-size:10px;" + MONO, text: String(tw2.when) }, cell);
        }
        text(x + 14.5, ay + 42, String(i), "font-size:9px;fill:var(--viz-muted);" + MONO, "middle");
      }
      // fields of timers
      var fy = 290, lim = Math.floor(h.length / N4);
      text(8, fy, L("timers 的字段", "Fields of timers"), "font-size:12px;font-weight:600");
      var rows = [
        ["len", String(h.length), ""],
        ["zombies", String(ts.zombies), L("超过 len/4 = " + lim + " 时强制整理", "cleanup forced above len/4 = " + lim)],
        ["minWhenHeap", String(ts.minWhenHeap), ""],
        ["minWhenModified", String(ts.minWhenModified), ""],
        ["wakeTime", String(wakeTime()), L("两者中较早的非零值", "the earlier nonzero of the two")],
      ];
      rows.forEach(function (r, k) {
        var col = k < 2 ? 0 : 1, row = k < 2 ? k : k - 2;
        var x0 = col ? 400 : 8, y = fy + 20 + row * 19, vx = x0 + (col ? 124 : 70);
        text(x0, y, r[0], "font-size:12px;" + MONO + ";fill:var(--viz-muted)");
        text(vx, y, r[1], "font-size:12px;" + MONO + (k === 1 && ts.zombies > lim ? ";fill:var(--viz-c2);font-weight:600" : ""));
        if (r[2]) text(vx + 8 + 7.3 * r[1].length, y, r[2], "font-size:10.5px;fill:var(--viz-muted)");
      });
      // timers outside the heap
      var off = timers.filter(function (t) { return !t.heaped; });
      var oy = fy + 20 + 2 * 19;
      var offLabel = L("不在堆中", "Not in a heap"), ox = 8 + (/[a-z]/.test(offLabel) ? 6.6 * offLabel.length : 12 * offLabel.length) + 10;
      text(8, oy, offLabel, "font-size:12px;fill:var(--viz-muted)");
      if (!off.length) text(ox, oy, L("（无）", "(none)"), "font-size:12px;fill:var(--viz-muted)");
      off.slice(-9).forEach(function (t, k) {
        var x = ox + k * 28;
        var gg = V.svg("g", { style: "cursor:pointer", on: { click: pick(t) } }, g);
        V.svg("rect", { x: x, y: oy - 13, width: 24, height: 18, rx: 4,
          style: "fill:var(--viz-fill);stroke:var(--viz-line)" + (sel === t ? ";stroke-width:2.4;stroke:var(--viz-ink)" : "") }, gg);
        V.svg("text", { x: x + 12, y: oy, "text-anchor": "middle", style: "font-size:11px;fill:var(--viz-muted)", text: t.id }, gg);
      });
    }

    // ---- controls ----------------------------------------------------------------
    V.select(p.bar, L("时长 d", "Duration d"), [5, 20, 50].map(function (d) { return { value: String(d), label: d + " ms" }; }),
      "20", function (v) { dur = +v; });
    V.button(p.bar, "AfterFunc(d)", function () { act(afterFunc); });
    V.button(p.bar, "Stop", function () { act(stop); });
    V.button(p.bar, "Reset(d)", function () { act(resetTimer); });
    V.button(p.bar, L("时钟前进 5 ms", "Advance 5 ms"), function () { act(function () { return advance(5); }); });
    V.button(p.bar, L("前进到 wakeTime", "Advance to wakeTime"), function () { act(function () { return advance(null); }); });
    V.button(p.bar, L("重新开始", "Start over"), reset);

    reset();
  });
})();
