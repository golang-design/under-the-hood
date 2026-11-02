/*
 * swiss-probe: lookup, insertion and deletion in one Swiss table (book §5.4.3).
 *
 * One table of a Go 1.26 map: groups of 8 slots, each with a control byte
 * (0x80 empty, 0xFE deleted, otherwise the key's H2). The operations follow
 * internal/runtime/maps:
 *
 *   map.go    h1(hash) = hash >> 7, h2(hash) = hash & 0x7f.
 *   table.go  makeProbeSeq / probeSeq.next: start at h1 & mask, then add
 *             1, 2, 3, ... (triangular offsets), visiting every group.
 *   table.go  getWithKey: in each group, compare the keys whose control byte
 *             equals H2; stop at the first group that has an empty slot.
 *   table.go  PutSlot: remember the first tombstone on the way, keep probing
 *             to an empty slot, then reuse the tombstone if there was one
 *             (growthLeft unchanged) or take the empty slot (growthLeft-1).
 *             With growthLeft == 0 it calls pruneTombstones, then rehash.
 *   table.go  Delete: mark the slot empty if its group still has an empty
 *             slot, otherwise leave a tombstone.
 *   table.go  pruneTombstones: only when tombstones >= 10% of capacity, and
 *             only if it can free >= 10% of capacity; a group's tombstones
 *             are kept if some key's probe sequence passes through it.
 *   table.go  maxGrowthLeft: capacity * maxAvgGroupLoad(7) / 8;
 *             rehash -> grow doubles the capacity (here 32 -> 64) and
 *             reinserts every key in group/slot order (uncheckedPutSlot).
 *
 * The real hash is seeded per map (aeshash or the wyhash-style fallback);
 * this figure uses 32-bit FNV-1a so that the layout is reproducible. Matching
 * is exact, as with the SSE version on amd64 (the portable SWAR matchH2 can
 * report rare false positives, which the key comparison discards anyway).
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace)";
  var EMPTY = -1, DELETED = -2, SLOTS = 8, MAX_LOAD = 7;

  // The opening state: keys inserted in this order into a 32-slot table.
  var PRESET = ["dog", "eel", "fox", "hen", "hog", "pug", "ray", "bug", "ant", "ape", "bat",
    "mole", "duck", "cat", "cow", "kid", "fly", "owl", "yak"];
  var EXTRA = ["puma", "lion", "hare", "lamb", "mink", "toad", "koi", "ewe", "rat", "gar", "orc",
    "seal", "elk", "emu", "jay", "pig"];

  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function hex2(n) { return (n < 16 ? "0" : "") + n.toString(16).toUpperCase(); }
  function ctrlText(c) { return c === EMPTY ? "80" : c === DELETED ? "FE" : hex2(c); }

  // ---- the table ------------------------------------------------------
  function newTable(cap) {
    var t = { cap: cap, ng: cap / SLOTS, ctrl: [], key: [], used: 0 };
    for (var g = 0; g < t.ng; g++) {
      t.ctrl.push([]); t.key.push([]);
      for (var s = 0; s < SLOTS; s++) { t.ctrl[g].push(EMPTY); t.key[g].push(null); }
    }
    t.growthLeft = maxGrowthLeft(t);
    return t;
  }
  function maxGrowthLeft(t) { return t.cap * MAX_LOAD / SLOTS; }
  function tombstones(t) { return maxGrowthLeft(t) - t.used - t.growthLeft; }
  function clone(t) {
    return { cap: t.cap, ng: t.ng, used: t.used, growthLeft: t.growthLeft,
      ctrl: t.ctrl.map(function (r) { return r.slice(); }), key: t.key.map(function (r) { return r.slice(); }) };
  }
  function probe(t, hash) {
    var mask = t.ng - 1, off = (hash >>> 7) & mask, idx = 0, seq = [];
    for (var n = 0; n < t.ng; n++) { seq.push(off); idx++; off = (off + idx) & mask; }
    return seq;
  }
  function hasEmpty(t, g) { return t.ctrl[g].indexOf(EMPTY) >= 0; }
  function matchH2(t, g, h2) {
    var m = [];
    for (var s = 0; s < SLOTS; s++) if (t.ctrl[g][s] === h2) m.push(s);
    return m;
  }
  function firstEmptyOrDeleted(t, g) {
    for (var s = 0; s < SLOTS; s++) if (t.ctrl[g][s] === EMPTY || t.ctrl[g][s] === DELETED) return s;
    return -1;
  }
  function uncheckedPut(t, k) {
    var h = fnv(k), seq = probe(t, h);
    for (var i = 0; i < seq.length; i++) {
      var s = firstEmptyOrDeleted(t, seq[i]);
      if (s >= 0) { t.ctrl[seq[i]][s] = h & 0x7f; t.key[seq[i]][s] = k; t.used++; t.growthLeft--; return; }
    }
  }
  function grow(t) {
    var nt = newTable(t.cap * 2);
    for (var g = 0; g < t.ng; g++) for (var s = 0; s < SLOTS; s++) if (t.ctrl[g][s] >= 0) uncheckedPut(nt, t.key[g][s]);
    return nt;
  }
  // pruneTombstones; returns the number of tombstones removed (0 = gave up).
  function prune(t) {
    if (tombstones(t) * 10 < t.cap) return { n: 0, why: "few" };
    var needed = [], g, s;
    for (g = 0; g < t.ng; g++) needed.push(false);
    for (g = 0; g < t.ng; g++) {
      for (s = 0; s < SLOTS; s++) if (t.ctrl[g][s] >= 0) {
        var seq = probe(t, fnv(t.key[g][s]));
        for (var i = 0; i < seq.length && seq[i] !== g; i++) if (firstEmptyOrDeleted(t, seq[i]) >= 0) needed[seq[i]] = true;
      }
      if (hasEmpty(t, g)) needed[g] = true;
    }
    var cnt = 0;
    for (g = 0; g < t.ng; g++) if (!needed[g]) for (s = 0; s < SLOTS; s++) if (t.ctrl[g][s] === DELETED) cnt++;
    if (cnt * 10 < t.cap) return { n: 0, why: "stuck" };
    for (g = 0; g < t.ng; g++) if (!needed[g]) for (s = 0; s < SLOTS; s++) if (t.ctrl[g][s] === DELETED) {
      t.ctrl[g][s] = EMPTY; t.growthLeft++;
    }
    return { n: cnt };
  }
  function contains(t, k) {
    for (var g = 0; g < t.ng; g++) if (t.key[g].indexOf(k) >= 0) return true;
    return false;
  }

  // ---- operations as lists of frames ------------------------------------
  // A frame: { t: table snapshot, k: key, path: [groups], cands, ne: [slots
  // compared and unequal], hit: {g, s, c}, remember: {g, s}, note }.
  function trace(t, op, k) {
    var F = [], h = fnv(k), h2 = h & 0x7f;
    function bits(tt) { return Math.log(tt.ng) / Math.LN2; }
    function frame(o) {
      o.t = clone(t); o.k = k; o.h = h;
      o.path = o.path || []; o.cands = o.cands || []; o.ne = o.ne || [];
      F.push(o);
    }
    function hashNote() {
      var b = bits(t), start = (h >>> 7) & (t.ng - 1);
      return L("hash(\"" + k + "\") = 0x" + ("0000000" + h.toString(16)).slice(-8) + "（演示用 FNV-1a）。低 7 位是 H2 = 0x" + hex2(h2) +
        "；其余高位是 H1，表有 " + t.ng + " 组，取 H1 的低 " + b + " 位，得 " + start + "：探测从第 " + start + " 组开始。",
        "hash(\"" + k + "\") = 0x" + ("0000000" + h.toString(16)).slice(-8) + " (FNV-1a, for the demo). The low 7 bits are H2 = 0x" + hex2(h2) +
        "; the higher bits are H1. With " + t.ng + " groups, the low " + b + " bits of H1 give " + start + ": probing starts at group " + start + ".");
    }
    function nextNote(g, i) {
      var nx = (g + i) & (t.ng - 1);
      return L("前往第 (" + g + " + " + i + ") mod " + t.ng + " = " + nx + " 组。", "go to group (" + g + " + " + i + ") mod " + t.ng + " = " + nx + ".");
    }
    function head(i, g) { return L("第 " + i + " 次探测，第 " + g + " 组：", "Probe " + i + ", group " + g + ": "); }
    function candNote(g, cands) {
      if (!cands.length) return L("没有控制字节等于 0x" + hex2(h2) + " 的槽位。", "no control byte equals 0x" + hex2(h2) + ". ");
      return cands.map(function (s) {
        var kk = t.key[g][s];
        return kk === k ? L("槽位 " + s + " 的控制字节等于 0x" + hex2(h2) + "，键正是 " + k + "。", "slot " + s + " has control byte 0x" + hex2(h2) + " and holds " + k + ". ")
          : L("槽位 " + s + " 的控制字节等于 0x" + hex2(h2) + "，但键是 " + kk + "，不是 " + k + "（H2 偶然相同）。",
            "slot " + s + " has control byte 0x" + hex2(h2) + ", but its key is " + kk + ", not " + k + " (the H2 values collide by chance). ");
      }).join("");
    }

    function run() {
      frame({ kind: "hash", note: hashNote() });
      var seq = probe(t, h), path = [], remember = null;
      for (var i = 0; i < seq.length; i++) {
        var g = seq[i], cands = matchH2(t, g, h2), at = -1, ne = [];
        path.push(g);
        cands.forEach(function (s) { if (t.key[g][s] === k) at = s; else ne.push(s); });
        var pre = head(i + 1, g) + candNote(g, cands);
        if (at >= 0) {
          if (op === "get") { frame({ path: path.slice(), cands: cands, ne: ne, hit: { g: g, s: at, c: "c3" }, note: pre + L("查找成功。", "Found.") }); return; }
          if (op === "put") { frame({ path: path.slice(), cands: cands, ne: ne, hit: { g: g, s: at, c: "c3" }, note: pre + L("键已存在，只更新它的值，表的结构不变。", "The key exists, so only its value is updated; the table is unchanged.") }); return; }
          var empty = hasEmpty(t, g);
          frame({ path: path.slice(), cands: cands, ne: ne, hit: { g: g, s: at, c: "c1" }, note: pre + L("找到要删除的键。", "This is the key to delete.") });
          t.key[g][at] = null; t.used--;
          if (empty) {
            t.ctrl[g][at] = EMPTY; t.growthLeft++;
            frame({ path: path.slice(), hit: { g: g, s: at, c: "c3" }, note: L("第 " + g + " 组还有空槽，任何探测序列都在这一组结束，不会越过它，所以直接把槽位 " + at + " 标为空（80），growthLeft 加 1。",
              "Group " + g + " still has an empty slot, so every probe sequence ends at this group and none passes it; slot " + at + " becomes empty (80) and growthLeft goes up by 1.") });
          } else {
            t.ctrl[g][at] = DELETED;
            frame({ path: path.slice(), hit: { g: g, s: at, c: "c2" }, note: L("第 " + g + " 组没有空槽，别的键的探测序列可能经过这里；若标为空，它们会在此提前终止。所以槽位 " + at + " 标为墓碑（FE），growthLeft 不变。",
              "Group " + g + " has no empty slot, so other keys' probe sequences may pass through it; marking the slot empty would end them early. Slot " + at + " becomes a tombstone (FE), and growthLeft stays the same.") });
          }
          return;
        }
        if (op !== "put") {
          if (hasEmpty(t, g)) {
            frame({ path: path.slice(), cands: cands, ne: ne, note: pre + L("该组有空槽，探测在此结束：" + k + " 不在表中" + (op === "del" ? "，无须删除。" : "。"),
              "The group has an empty slot, so probing stops here: " + k + " is not in the table" + (op === "del" ? ", so there is nothing to delete." : ".")) });
            return;
          }
          frame({ path: path.slice(), cands: cands, ne: ne, note: pre + L("该组没有空槽（墓碑不算空槽），键可能在后面，", "The group has no empty slot (a tombstone does not count), so the key may lie further on; ") + nextNote(g, i + 1) });
          continue;
        }
        // insertion
        var s0 = firstEmptyOrDeleted(t, g);
        if (s0 < 0) {
          frame({ path: path.slice(), cands: cands, ne: ne, remember: remember, note: pre + L("该组没有空槽也没有墓碑，", "The group has neither an empty slot nor a tombstone; ") + nextNote(g, i + 1) });
          continue;
        }
        if (t.ctrl[g][s0] === DELETED) {
          var first = !remember;
          if (first) remember = { g: g, s: s0 };
          frame({ path: path.slice(), cands: cands, ne: ne, remember: remember, note: pre + (first
            ? L("第一个可用位置是墓碑（槽位 " + s0 + "）。先记下它；但该组没有空槽，键仍可能在后面，继续探测，", "the first free position is a tombstone (slot " + s0 + "). Remember it; the group has no empty slot, so the key may still lie further on. Keep probing: ")
            : L("这里也只有墓碑，已经记下了更早的一个，继续探测，", "only tombstones here, and an earlier one is already remembered. Keep probing: ")) + nextNote(g, i + 1) });
          continue;
        }
        frame({ path: path.slice(), cands: cands, ne: ne, remember: remember, note: pre + L("该组有空槽，探测结束：" + k + " 不在表中，可以插入。", "The group has an empty slot, so probing ends: " + k + " is not in the table and can be inserted.") });
        var tg = g, ts = s0, reuse = false;
        if (remember) { tg = remember.g; ts = remember.s; reuse = true; t.growthLeft++; }
        if (t.growthLeft === 0) {
          var pr = prune(t);
          if (pr.n === 0) {
            frame({ path: path.slice(), note: (pr.why === "few" && tombstones(t) === 0
              ? L("growthLeft 已为 0，也没有墓碑可以清理，", "growthLeft is 0 and there are no tombstones to prune, ")
              : pr.why === "few"
              ? L("growthLeft 已为 0。墓碑不到容量的 10%，不值得清理，", "growthLeft is 0. Tombstones are under 10% of the capacity, not worth pruning, ")
              : L("growthLeft 已为 0。墓碑虽多，但能清除的不到容量的 10%，", "growthLeft is 0. There are tombstones, but fewer than 10% of the capacity can be removed, ")) +
              L("所以表要扩容：新建一张容量为 " + (t.cap * 2) + "（" + (t.ng * 2) + " 组）的表，按组和槽位的次序把每个键重新放入，墓碑随之消失。",
                "so the table grows: a new table of " + (t.cap * 2) + " slots (" + (t.ng * 2) + " groups) receives every key in group and slot order, and the tombstones disappear.") });
            t = grow(t);
            frame({ kind: "grown", note: L("扩容完成，在新表中重新插入 " + k + "。", "The table has grown; insert " + k + " again into the new table.") });
            run();
            return;
          }
          frame({ path: path.slice(), note: L("growthLeft 已为 0。墓碑达到容量的 10%，pruneTombstones 找出不在任何键的探测路径上的墓碑，清除了 " + pr.n + " 个，growthLeft 恢复为 " + t.growthLeft + "。",
            "growthLeft is 0. Tombstones reach 10% of the capacity, so pruneTombstones removes the " + pr.n + " that lie on no key's probe path; growthLeft is back to " + t.growthLeft + ".") });
        }
        var was = t.ctrl[tg][ts];
        t.ctrl[tg][ts] = h2; t.key[tg][ts] = k; t.growthLeft--; t.used++;
        frame({ path: path.slice(), hit: { g: tg, s: ts, c: "c3" }, note: reuse
          ? L("放入先前记下的墓碑：第 " + tg + " 组槽位 " + ts + "，控制字节由 FE 改为 H2 0x" + hex2(h2) + "。复用墓碑不消耗 growthLeft。",
            "Use the remembered tombstone: group " + tg + ", slot " + ts + "; its control byte changes from FE to H2 0x" + hex2(h2) + ". Reusing a tombstone does not consume growthLeft.")
          : L("放入第 " + tg + " 组槽位 " + ts + "，控制字节由 " + ctrlText(was) + " 改为 H2 0x" + hex2(h2) + "，growthLeft 减 1。",
            "Put it in group " + tg + ", slot " + ts + "; its control byte changes from " + ctrlText(was) + " to H2 0x" + hex2(h2) + ", and growthLeft goes down by 1.") });
        return;
      }
    }
    run();
    return { frames: F, table: t };
  }

  V.register("swiss-probe", function (host) {
    var p = V.panel(host, { title: L("Swiss Table 的一张表：探测、匹配与墓碑", "One Swiss table: probing, matching and tombstones") });
    var root = V.svg("svg", { viewBox: "0 0 720 306", role: "img",
      "aria-label": L("按组排列的槽位与控制字节", "Slots and control bytes, group by group") }, p.stage);
    var gHash = V.svg("g", null, root), gTab = V.svg("g", null, root), gFoot = V.svg("g", null, root);

    var table, frames = [], cur = -1, timer = null, key = "duck";
    function reset() {
      stop();
      table = newTable(32);
      PRESET.forEach(function (k) { table = trace(table, "put", k).table; });
      frames = []; cur = -1;
      refreshKeys(); draw();
      p.note.textContent = L("这张表有 32 个槽位（4 组），装了 19 个键，第 2 组已满。选一个键，再点「查找」「插入」或「删除」，逐步观察探测过程。",
        "This table has 32 slots (4 groups) and holds 19 keys; group 2 is full. Pick a key, then press Lookup, Insert or Delete to watch the probe step by step.");
    }
    function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }
    function txt(g, x, y, s, style, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: style || "", text: s }, g);
    }

    function drawHash(f) {
      clear(gHash);
      var t = f ? f.t : table;
      if (!f) {
        txt(gHash, 8, 22, L("选一个键并执行操作，这里显示它的哈希值如何拆成 H1 与 H2。", "Pick a key and run an operation; its hash splits into H1 and H2 here."), "font-size:12px;fill:var(--viz-muted)");
        return;
      }
      var h = f.h, b = Math.log(t.ng) / Math.LN2;
      txt(gHash, 8, 22, "hash(\"" + f.k + "\") = 0x" + ("0000000" + h.toString(16)).slice(-8), "font-size:13px;" + MONO);
      // the low 7 + b bits as boxes; higher bits as an ellipsis
      var n = 7 + b, bw = 15, x0 = 712 - n * bw;
      txt(gHash, x0 - 6, 22, "…", "font-size:13px;" + MONO, "end");
      for (var i = 0; i < n; i++) {
        var bit = n - 1 - i, v = (h >>> bit) & 1, isG = bit >= 7;
        var c = isG ? "var(--viz-c1)" : "var(--viz-c4)";
        V.svg("rect", { x: x0 + i * bw, y: 8, width: bw - 2, height: 19, rx: 2,
          style: "fill:" + c + ";fill-opacity:.14;stroke:" + c }, gHash);
        txt(gHash, x0 + i * bw + (bw - 2) / 2, 22, String(v), "font-size:12px;" + MONO, "middle");
      }
      var start = (h >>> 7) & (t.ng - 1), h2 = h & 0x7f;
      txt(gHash, x0 + b * bw - 10, 43, L("H1 的低 " + b + " 位 → 第 " + start + " 组", "low " + b + " bits of H1 → group " + start), "font-size:11px;fill:var(--viz-c1)", "end");
      txt(gHash, x0 + b * bw + 8, 43, "H2 = 0x" + hex2(h2), "font-size:11px;fill:var(--viz-c4);" + MONO);
    }

    function drawTable(f) {
      clear(gTab);
      var t = f ? f.t : table, ng = t.ng;
      var top = 56, rh = ng <= 4 ? 46 : 26, cw = 70, x0 = 96;
      var path = f ? f.path : [], curG = path.length ? path[path.length - 1] : -1;
      for (var g = 0; g < ng; g++) {
        var y = top + g * rh, pi = path.indexOf(g), on = pi >= 0;
        if (on) V.svg("rect", { x: 4, y: y + 1, width: 708, height: rh - 2, rx: 5,
          style: "fill:var(--viz-c1);fill-opacity:" + (g === curG ? 0.10 : 0.05) }, gTab);
        txt(gTab, 12, y + rh / 2 + 4, L("组 ", "group ") + g, "font-size:12px;" + (on ? "font-weight:600" : "fill:var(--viz-muted)"));
        if (on) {
          V.svg("circle", { cx: 78, cy: y + rh / 2, r: 8, style: "fill:var(--viz-c1)" }, gTab);
          V.svg("text", { x: 78, y: y + rh / 2 + 4, "text-anchor": "middle", style: "font-size:10.5px;font-weight:700;fill:var(--viz-fill)", text: String(pi + 1) }, gTab);
        }
        for (var s = 0; s < SLOTS; s++) {
          var x = x0 + s * cw, c = t.ctrl[g][s], k = t.key[g][s];
          var fill = c >= 0 ? "var(--viz-c4)" : c === DELETED ? "var(--viz-c2)" : "var(--viz-fill)";
          var fop = c >= 0 ? 0.10 : c === DELETED ? 0.14 : 1;
          var stroke = c === DELETED ? "var(--viz-c2)" : "var(--viz-line)", sw = 1, dash = c === DELETED ? ";stroke-dasharray:3 2" : "";
          var isCand = f && g === curG && f.cands.indexOf(s) >= 0;
          if (isCand) { stroke = "var(--viz-c1)"; sw = 2; dash = ""; }
          if (f && f.remember && f.remember.g === g && f.remember.s === s) { stroke = "var(--viz-c2)"; sw = 2.2; dash = ""; }
          if (f && f.hit && f.hit.g === g && f.hit.s === s) { stroke = "var(--viz-" + f.hit.c + ")"; sw = 2.6; dash = ""; fill = "var(--viz-" + f.hit.c + ")"; fop = 0.2; }
          V.svg("rect", { x: x + 2, y: y + 4, width: cw - 4, height: rh - 8, rx: 4,
            style: "fill:" + fill + ";fill-opacity:" + fop + ";stroke:" + stroke + ";stroke-width:" + sw + dash }, gTab);
          var small = rh < 40;
          txt(gTab, x + 7, y + (small ? 13 : 16), ctrlText(c), "font-size:" + (small ? 8.5 : 9.5) + "px;" + MONO + ";fill:" +
            (c >= 0 ? "var(--viz-c4)" : c === DELETED ? "var(--viz-c2)" : "var(--viz-muted)"));
          if (k) txt(gTab, x + cw / 2 + (small ? 6 : 0), y + (small ? 18 : 33), k, "font-size:" + (small ? 11 : 13) + "px;" + MONO, "middle");
          else if (c === DELETED) txt(gTab, x + cw / 2 + (small ? 6 : 0), y + (small ? 18 : 33), "×", "font-size:" + (small ? 11 : 14) + "px;fill:var(--viz-c2)", "middle");
          if (f && g === curG && f.ne.indexOf(s) >= 0)
            txt(gTab, x + cw - 8, y + (small ? 13 : 16), "≠", "font-size:11px;font-weight:700;fill:var(--viz-c1)", "end");
        }
        if (!hasEmpty(t, g)) txt(gTab, 663, y + rh / 2 + 4, L("无空槽", "no empty"), "font-size:10.5px;fill:var(--viz-c2)");
      }
    }

    function drawFoot(f) {
      clear(gFoot);
      var t = f ? f.t : table, y = 280;
      txt(gFoot, 8, y, L("容量 " + t.cap + " · 元素 " + t.used + " · growthLeft " + t.growthLeft + " · 墓碑 " + tombstones(t),
        "capacity " + t.cap + " · used " + t.used + " · growthLeft " + t.growthLeft + " · tombstones " + tombstones(t)), "font-size:12px;" + MONO);
      txt(gFoot, 8, y + 20, L("每个槽位左上角是它的控制字节：80 表示空槽，FE 表示墓碑，其余是该槽位中键的 H2。",
        "The small number in each slot is its control byte: 80 is empty, FE is a tombstone, anything else is the H2 of the key in it."),
        "font-size:11px;fill:var(--viz-muted)");
    }

    function draw() {
      var f = cur >= 0 ? frames[cur] : null;
      drawHash(f); drawTable(f); drawFoot(f);
      if (f) p.note.textContent = f.note;
    }

    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function start(op) {
      stop();
      var r = trace(table, op, key);
      table = r.table; frames = r.frames; cur = 0; draw();
      timer = setInterval(function () {
        if (!host.isConnected) { stop(); return; }
        if (cur >= frames.length - 1) { stop(); refreshKeys(); return; }
        cur++; draw();
        if (cur >= frames.length - 1) { stop(); refreshKeys(); }
      }, 1500);
    }

    var lab = V.el("label", { class: "viz-slider" }, p.bar);
    V.el("span", { text: L("键", "Key") }, lab);
    var keySel = V.el("select", { class: "viz-select" }, lab);
    keySel.addEventListener("change", function () { key = keySel.value; });
    function refreshKeys() {
      while (keySel.firstChild) keySel.removeChild(keySel.firstChild);
      var inG = V.el("optgroup", { label: L("在表中", "in the table") }, keySel);
      var outG = V.el("optgroup", { label: L("不在表中", "not in the table") }, keySel);
      PRESET.concat(EXTRA).forEach(function (k) {
        var o = V.el("option", { value: k, text: k }, contains(table, k) ? inG : outG);
        if (k === key) o.selected = true;
      });
    }
    V.button(p.bar, L("查找", "Lookup"), function () { start("get"); });
    V.button(p.bar, L("插入", "Insert"), function () { start("put"); });
    V.button(p.bar, L("删除", "Delete"), function () { start("del"); });
    V.button(p.bar, L("重置", "Reset"), reset);

    reset();
  });
})();
