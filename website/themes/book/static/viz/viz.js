/*
 * viz.js — embeddable interactive visualizations for the book.
 *
 * Usage in markdown (stays invisible on GitHub, mounts on the site):
 *   <div class="viz" data-viz="gmp-scheduler"></div>
 *
 * Each widget gets a <canvas> + a control bar. Colours adapt to light/dark.
 * No dependencies; vanilla canvas + requestAnimationFrame.
 */
(function () {
  "use strict";

  // ---- shared helpers -------------------------------------------------------
  function theme() {
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  }
  var PALETTE = {
    light: { bg: "#f6f7f8", panel: "#ffffff", stroke: "#c9cdd2", text: "#1b1b1f",
             muted: "#8a9099", accent: "#2196f3", g: "#2196f3", run: "#21bf73",
             grey: "#9aa0a6", black: "#33373d", white: "#ffffff", warn: "#e8833a" },
    dark:  { bg: "#16161a", panel: "#1f1f25", stroke: "#3a3a42", text: "#e6e6e0",
             muted: "#8a9099", accent: "#5aa8ff", g: "#5aa8ff", run: "#3fd07f",
             grey: "#9aa0a6", black: "#0c0d10", white: "#e9e9e4", warn: "#f0a35e" },
  };
  function col() { return PALETTE[theme()]; }
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Build the standard scaffold: title, canvas (hi-dpi), control bar.
  function scaffold(host, opts) {
    host.classList.add("viz-mounted");
    host.innerHTML = "";
    var wrap = document.createElement("div"); wrap.className = "viz-wrap";
    var cap = document.createElement("div"); cap.className = "viz-title"; cap.textContent = opts.title || "";
    var canvas = document.createElement("canvas"); canvas.className = "viz-canvas";
    var bar = document.createElement("div"); bar.className = "viz-controls";
    wrap.appendChild(cap); wrap.appendChild(canvas); wrap.appendChild(bar);
    host.appendChild(wrap);

    var ctx = canvas.getContext("2d");
    var W = opts.width || 760, H = opts.height || 360;
    function size() {
      var cssW = Math.min(W, host.clientWidth || W);
      var scale = cssW / W;
      var cssH = H * scale;
      var dpr = window.devicePixelRatio || 1;
      canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0); // draw in W×H coords
    }
    size();
    window.addEventListener("resize", size);
    return { wrap: wrap, canvas: canvas, ctx: ctx, bar: bar, W: W, H: H, resize: size };
  }
  function button(bar, label, on) {
    var b = document.createElement("button"); b.className = "viz-btn"; b.type = "button";
    b.textContent = label; b.addEventListener("click", on); bar.appendChild(b); return b;
  }
  function slider(bar, label, min, max, val, on) {
    var s = document.createElement("label"); s.className = "viz-slider";
    s.innerHTML = "<span>" + label + "</span>";
    var i = document.createElement("input"); i.type = "range"; i.min = min; i.max = max; i.value = val;
    i.addEventListener("input", function () { on(+i.value); });
    s.appendChild(i); bar.appendChild(s); return i;
  }
  // Animation driver shared by all widgets.
  function driver(s, step, draw) {
    var playing = true, last = 0, acc = 0, TICK = 1 / 60;
    function frame(t) {
      if (!s.canvas.isConnected) return; // host removed
      var dt = last ? (t - last) / 1000 : 0; last = t;
      if (playing) { acc += Math.min(dt, 0.1); while (acc >= TICK) { step(TICK); acc -= TICK; } }
      draw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return {
      toggle: function () { playing = !playing; return playing; },
      set: function (v) { playing = v; },
      playing: function () { return playing; },
    };
  }

  // ===========================================================================
  // Widget 1: GMP scheduler — goroutines, per-P run queues, Ms, work stealing.
  // ===========================================================================
  function gmpScheduler(host) {
    var s = scaffold(host, { title: "GMP 调度器：本地运行队列、M 绑定与工作窃取", width: 760, height: 380 });
    var ctx = s.ctx, W = s.W, H = s.H;
    var NP = 3;
    var nextId = 1;
    function newG() { return { id: nextId++, t: Math.random() * 0.5 + 0.5, anim: 0, from: null }; }
    var Ps = [];
    for (var i = 0; i < NP; i++) Ps.push({ q: [], run: null, runLeft: 0, x: 0, steal: 0 });
    var grq = []; // global run queue
    // seed
    for (var k = 0; k < 7; k++) Ps[k % NP].q.push(newG());

    var spawnTimer = 1.2, speed = 1;

    function pGeo(i) {
      var pw = 200, gap = 24, total = NP * pw + (NP - 1) * gap;
      var x0 = (W - total) / 2;
      return { x: x0 + i * (pw + gap), y: 96, w: pw, h: 210 };
    }

    function step(dt) {
      dt *= speed;
      // spawn new goroutines into the least-loaded P (or GRQ if all full)
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = 0.9 + Math.random() * 0.8;
        var best = -1, bl = 1e9;
        for (var i = 0; i < NP; i++) if (Ps[i].q.length < 6 && Ps[i].q.length < bl) { bl = Ps[i].q.length; best = i; }
        var g = newG();
        if (best >= 0) Ps[best].q.push(g); else grq.push(g);
      }
      // each P runs its current G, then pulls the next
      for (var p = 0; p < NP; p++) {
        var P = Ps[p];
        if (P.steal > 0) P.steal -= dt;
        if (P.run) {
          P.run.anim = Math.min(1, P.run.anim + dt * 3);
          P.runLeft -= dt;
          if (P.runLeft <= 0) P.run = null; // goroutine finished
        } else {
          if (P.q.length) { P.run = P.q.shift(); P.runLeft = P.run.t; P.run.anim = 0; }
          else if (grq.length) { P.run = grq.shift(); P.runLeft = P.run.t; P.run.anim = 0; }
          else {
            // work stealing: take half from the busiest other P
            var victim = -1, vl = 1;
            for (var q = 0; q < NP; q++) if (q !== p && Ps[q].q.length > vl) { vl = Ps[q].q.length; victim = q; }
            if (victim >= 0) {
              var n = Math.ceil(Ps[victim].q.length / 2);
              for (var m = 0; m < n; m++) { var st = Ps[victim].q.pop(); st.from = victim; st.anim = 0; P.q.unshift(st); }
              P.steal = 0.6;
            }
          }
        }
      }
    }

    function dot(x, y, r, fill, label) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
      if (label) { ctx.fillStyle = "#fff"; ctx.font = "600 10px ui-sans-serif,system-ui,sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x, y + 0.5); }
    }

    function draw() {
      var c = col();
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = c.bg; rr(ctx, 0, 0, W, H, 10); ctx.fill();
      ctx.font = "600 12px ui-sans-serif,system-ui,sans-serif"; ctx.textBaseline = "middle";
      // global run queue
      ctx.textAlign = "left"; ctx.fillStyle = c.muted;
      ctx.fillText("全局运行队列 GRQ", 24, 36);
      for (var i = 0; i < grq.length && i < 12; i++) dot(150 + i * 22, 36, 9, c.g, "G");
      // P/M columns
      for (var p = 0; p < NP; p++) {
        var g = pGeo(p);
        ctx.fillStyle = c.panel; ctx.strokeStyle = c.stroke; ctx.lineWidth = 1.4;
        rr(ctx, g.x, g.y, g.w, g.h, 10); ctx.fill(); ctx.stroke();
        ctx.fillStyle = c.text; ctx.textAlign = "left"; ctx.font = "700 13px ui-sans-serif,system-ui,sans-serif";
        ctx.fillText("P" + p, g.x + 14, g.y + 20);
        // M (thread) running the current G
        var mx = g.x + g.w - 40, my = g.y + 24;
        ctx.strokeStyle = Ps[p].steal > 0 ? c.warn : c.stroke;
        ctx.fillStyle = c.bg; ctx.beginPath(); ctx.arc(mx, my, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = c.muted; ctx.font = "600 11px ui-sans-serif,system-ui,sans-serif"; ctx.textAlign = "center";
        ctx.fillText("M", mx, my);
        var P = Ps[p];
        if (P.run) {
          var ry = lerp(g.y + 70, my, P.run.anim);
          var rx = lerp(g.x + 30, mx, P.run.anim);
          dot(rx, ry, 11, c.run, "G");
          ctx.fillStyle = c.muted; ctx.font = "11px ui-sans-serif,system-ui,sans-serif"; ctx.textAlign = "center";
          if (P.run.anim > 0.8) ctx.fillText("运行中", mx, my + 30);
        }
        // local run queue (slots)
        ctx.textAlign = "left"; ctx.fillStyle = c.muted; ctx.font = "11px ui-sans-serif,system-ui,sans-serif";
        ctx.fillText("本地队列", g.x + 14, g.y + 104);
        for (var k = 0; k < 6; k++) {
          var sx = g.x + 24 + k * 28, sy = g.y + 132;
          ctx.strokeStyle = c.stroke; ctx.fillStyle = "transparent";
          ctx.beginPath(); ctx.arc(sx, sy, 11, 0, Math.PI * 2); ctx.stroke();
          if (P.q[k]) dot(sx, sy, 10, P.q[k].from != null && P.q[k].anim < 1 ? c.warn : c.g, "G");
          if (P.q[k]) P.q[k].anim = Math.min(1, (P.q[k].anim || 1) + 0.03);
        }
        if (P.steal > 0) {
          ctx.fillStyle = c.warn; ctx.font = "600 11px ui-sans-serif,system-ui,sans-serif"; ctx.textAlign = "center";
          ctx.fillText("窃取!", g.x + g.w / 2, g.y + g.h - 14);
        }
      }
      ctx.fillStyle = c.muted; ctx.font = "11px ui-sans-serif,system-ui,sans-serif"; ctx.textAlign = "center";
      ctx.fillText("绿点 = 正在 M 上运行的 G，蓝点 = 待运行，橙色 = 刚被窃取", W / 2, H - 14);
    }

    var d = driver(s, step, draw);
    var pb = button(s.bar, "暂停", function () { pb.textContent = d.toggle() ? "暂停" : "继续"; });
    button(s.bar, "单步", function () { d.set(false); pb.textContent = "继续"; step(0.25); });
    button(s.bar, "go func()", function () {
      var best = 0; for (var i = 1; i < NP; i++) if (Ps[i].q.length < Ps[best].q.length) best = i;
      if (Ps[best].q.length < 6) Ps[best].q.push(newG()); else grq.push(newG());
    });
    slider(s.bar, "速度", 1, 30, 10, function (v) { speed = v / 10; });
  }

  // ===========================================================================
  // Widget 2: tricolor mark-sweep GC.
  // ===========================================================================
  function gcTricolor(host) {
    var s = scaffold(host, { title: "三色标记清扫：从根出发，灰色波前推进，白色被回收", width: 760, height: 360 });
    var ctx = s.ctx, W = s.W, H = s.H;
    var nodes, edges, grey, phase, sweepIdx, timer;
    function build() {
      nodes = []; edges = [];
      // layered layout: roots at left, heap fanning right
      var layers = [["R0", "R1"], ["a", "b", "c"], ["d", "e", "f", "g"], ["h", "i", "j"]];
      var lx = [90, 270, 470, 660];
      layers.forEach(function (layer, li) {
        layer.forEach(function (name, idx) {
          var y = (H - 40) * (idx + 1) / (layer.length + 1) + 20;
          nodes.push({ name: name, x: lx[li], y: y, color: li === 0 ? "root" : "white", scan: 0 });
        });
      });
      function find(n) { return nodes.findIndex(function (x) { return x.name === n; }); }
      [["R0", "a"], ["R0", "b"], ["R1", "c"], ["a", "d"], ["a", "e"], ["b", "f"],
       ["c", "g"], ["d", "h"], ["f", "i"], ["g", "j"], ["e", "i"]].forEach(function (e) {
        edges.push([find(e[0]), find(e[1])]);
      });
      // a couple of unreachable (garbage) objects
      nodes.push({ name: "x", x: 470, y: H - 24, color: "white", scan: 0 });
      nodes.push({ name: "y", x: 660, y: H - 24, color: "white", scan: 0 });
      edges.push([nodes.length - 2, nodes.length - 1]);
      grey = []; phase = "idle"; sweepIdx = -1; timer = 0;
      nodes.forEach(function (n, i) { if (n.color === "root") { n.color = "grey"; grey.push(i); } });
      phase = "mark";
    }
    build();

    function children(i) { return edges.filter(function (e) { return e[0] === i; }).map(function (e) { return e[1]; }); }
    function markStep() {
      if (!grey.length) { phase = "sweep"; sweepIdx = 0; return; }
      var i = grey.shift();
      children(i).forEach(function (ci) { if (nodes[ci].color === "white") { nodes[ci].color = "grey"; grey.push(ci); } });
      nodes[i].color = "black";
    }
    function sweepStep() {
      while (sweepIdx < nodes.length && nodes[sweepIdx].color !== "white") sweepIdx++;
      if (sweepIdx >= nodes.length) { phase = "done"; return; }
      nodes[sweepIdx].color = "collected"; sweepIdx++;
    }
    var speed = 1;
    function step(dt) {
      timer += dt * speed;
      if (timer < 0.7) return; timer = 0;
      if (phase === "mark") markStep(); else if (phase === "sweep") sweepStep();
    }

    function draw() {
      var c = col(); ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = c.bg; rr(ctx, 0, 0, W, H, 10); ctx.fill();
      // edges
      ctx.strokeStyle = c.stroke; ctx.lineWidth = 1.2;
      edges.forEach(function (e) {
        var a = nodes[e[0]], b = nodes[e[1]];
        if (a.color === "collected" || b.color === "collected") return;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      });
      // nodes
      nodes.forEach(function (n) {
        if (n.color === "collected") return;
        var fill = c.white, txt = c.text, ring = c.stroke;
        if (n.color === "grey") { fill = c.grey; txt = "#fff"; }
        else if (n.color === "black") { fill = c.black; txt = "#fff"; }
        ctx.beginPath(); ctx.arc(n.x, n.y, 17, 0, Math.PI * 2);
        ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = ring; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.fillStyle = txt; ctx.font = "600 12px ui-sans-serif,system-ui,sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(n.name, n.x, n.y);
      });
      ctx.fillStyle = c.muted; ctx.font = "12px ui-sans-serif,system-ui,sans-serif"; ctx.textAlign = "center";
      var label = phase === "mark" ? "标记阶段：灰色集合 " + grey.length + " 个待扫描"
        : phase === "sweep" ? "清扫阶段：回收白色对象" : "完成：白色对象 x、y 已回收";
      ctx.fillText(label, W / 2, H - 14);
    }
    var d = driver(s, step, draw);
    var pb = button(s.bar, "暂停", function () { pb.textContent = d.toggle() ? "暂停" : "继续"; });
    button(s.bar, "单步", function () { d.set(false); pb.textContent = "继续"; if (phase === "mark") markStep(); else if (phase === "sweep") sweepStep(); });
    button(s.bar, "重置", function () { build(); });
    slider(s.bar, "速度", 1, 20, 6, function (v) { speed = v / 6; });
  }

  // ===========================================================================
  // Widget 3: channel send/recv with a bounded buffer.
  // ===========================================================================
  function channel(host) {
    var s = scaffold(host, { title: "通道：有缓冲队列、发送/接收与阻塞", width: 760, height: 320 });
    var ctx = s.ctx, W = s.W, H = s.H;
    var cap = 4, buf = [], nextId = 1, items = [];
    var sender = { blocked: false, pending: null }, receiver = { blocked: false };
    var auto = true, sTimer = 0, rTimer = 0, speed = 1;

    function geo() {
      var bw = 60 * cap + 20, bx = (W - bw) / 2, by = 120;
      return { bx: bx, by: by, bw: bw, bh: 70, slot: 60 };
    }
    function doSend() {
      if (buf.length < cap) { var it = { id: nextId++, x: 80, y: 155, target: null, t: 0 }; items.push(it); it.target = "buf:" + buf.length; buf.push(it); sender.blocked = false; }
      else { sender.blocked = true; }
    }
    function doRecv() {
      if (buf.length) { var it = buf.shift(); it.target = "out"; it.t = 0; receiver.blocked = false;
        // shift remaining
        buf.forEach(function (b, i) { b.target = "buf:" + i; b.t = 0; });
        if (sender.blocked) { sender.blocked = false; doSend(); } }
      else { receiver.blocked = true; }
    }
    function slotPos(i) { var g = geo(); return { x: g.bx + 10 + i * g.slot + g.slot / 2 - 20 + 20, y: g.by + g.bh / 2 }; }
    function step(dt) {
      dt *= speed;
      if (auto) {
        sTimer -= dt; rTimer -= dt;
        if (sTimer <= 0) { sTimer = 0.8 + Math.random() * 0.6; doSend(); }
        if (rTimer <= 0) { rTimer = 1.1 + Math.random() * 0.8; doRecv(); }
      }
      items.forEach(function (it) {
        var tp;
        if (it.target === "out") tp = { x: W - 80, y: 155 };
        else { var idx = +it.target.split(":")[1]; tp = slotPos(idx); }
        it.t = Math.min(1, it.t + dt * 2.5);
        it.x = lerp(it.x, tp.x, 0.2); it.y = lerp(it.y, tp.y, 0.2);
      });
      items = items.filter(function (it) { return !(it.target === "out" && Math.abs(it.x - (W - 80)) < 2); });
    }
    function draw() {
      var c = col(); ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = c.bg; rr(ctx, 0, 0, W, H, 10); ctx.fill();
      var g = geo();
      // sender & receiver
      function actor(x, label, blocked) {
        ctx.fillStyle = blocked ? c.warn : c.panel; ctx.strokeStyle = blocked ? c.warn : c.stroke; ctx.lineWidth = 1.4;
        rr(ctx, x - 46, 130, 92, 50, 8); ctx.fill(); ctx.stroke();
        ctx.fillStyle = blocked ? "#fff" : c.text; ctx.font = "600 12px ui-sans-serif,system-ui,sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x, 150);
        if (blocked) { ctx.fillStyle = c.warn; ctx.font = "11px ui-sans-serif,system-ui,sans-serif"; ctx.fillText("阻塞", x, 196); }
      }
      actor(80, "发送 G", sender.blocked);
      actor(W - 80, "接收 G", receiver.blocked);
      // buffer
      ctx.fillStyle = c.panel; ctx.strokeStyle = c.stroke; ctx.lineWidth = 1.4;
      rr(ctx, g.bx, g.by, g.bw, g.bh, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c.muted; ctx.font = "12px ui-sans-serif,system-ui,sans-serif"; ctx.textAlign = "center";
      ctx.fillText("缓冲区 cap=" + cap + " len=" + buf.length, W / 2, g.by - 14);
      for (var i = 0; i < cap; i++) { var p = slotPos(i);
        ctx.strokeStyle = c.stroke; ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, Math.PI * 2); ctx.stroke(); }
      // items
      items.forEach(function (it) {
        ctx.beginPath(); ctx.arc(it.x, it.y, 14, 0, Math.PI * 2); ctx.fillStyle = c.accent; ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "600 11px ui-sans-serif,system-ui,sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(it.id, it.x, it.y);
      });
      ctx.fillStyle = c.muted; ctx.font = "11px ui-sans-serif,system-ui,sans-serif"; ctx.textAlign = "center";
      ctx.fillText("缓冲满则发送阻塞，缓冲空则接收阻塞", W / 2, H - 14);
    }
    var d = driver(s, step, draw);
    var pb = button(s.bar, "暂停", function () { pb.textContent = d.toggle() ? "暂停" : "继续"; });
    button(s.bar, "ch <- v", function () { auto = false; ab.textContent = "自动"; doSend(); });
    button(s.bar, "<-ch", function () { auto = false; ab.textContent = "自动"; doRecv(); });
    var ab = button(s.bar, "暂停自动", function () { auto = !auto; ab.textContent = auto ? "暂停自动" : "自动"; });
    slider(s.bar, "cap", 0, 6, 4, function (v) { cap = v; buf = buf.slice(0, cap); });
  }

  // ---- registry & mount -----------------------------------------------------
  var REGISTRY = {
    "gmp-scheduler": gmpScheduler,
    "gc-tricolor": gcTricolor,
    "channel": channel,
  };
  function mountAll() {
    var hosts = document.querySelectorAll(".viz[data-viz]:not(.viz-mounted)");
    hosts.forEach(function (h) {
      var name = h.getAttribute("data-viz");
      var fn = REGISTRY[name];
      if (fn) { try { fn(h); } catch (e) { h.innerHTML = '<div class="viz-fallback">可视化加载失败: ' + name + "</div>"; } }
      else { h.innerHTML = '<div class="viz-fallback">未知可视化: ' + name + "</div>"; }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAll);
  else mountAll();
})();
