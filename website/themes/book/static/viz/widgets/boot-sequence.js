/*
 * boot-sequence: what the Go runtime does between the kernel jumping to the
 * entry point and the first goroutine running (book §3.5).
 *
 * Steps follow runtime/rt0_linux_amd64.s, runtime/asm_amd64.s (rt0_go) and
 * runtime/proc.go (schedinit, newproc, mstart) in Go 1.26. The right-hand
 * side shows what exists after each step. Two controls feed the GOMAXPROCS
 * default of Go 1.25+ on Linux: min(CPUs, max(2, ceil(limit))) when the
 * container has a CPU limit, otherwise the CPU count (runtime/cgroup_linux.go).
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;

  var STEPS = [
    [L("内核装入程序，跳到入口", "Kernel loads the program, jumps to the entry"),
     L("内核把程序的代码和数据装进内存，在栈上放好命令行参数、环境变量和一组附加信息，然后跳到入口 _rt0_amd64_linux。此刻只有一个线程，m0 和 g0 只是两个还没用上的全局变量。",
       "The kernel maps the code and data, puts the arguments, environment and some extra facts on the stack, and jumps to the entry _rt0_amd64_linux. There is one thread; m0 and g0 are just two unused global variables.")],
    [L("入口取出参数，转到 rt0_go", "Entry picks up argc, argv, jumps to rt0_go"),
     L("入口只有几条指令：从栈顶取出参数个数和参数列表的位置，跳到这个 CPU 架构共用的 rt0_go。",
       "The entry is a few instructions: read the argument count and the address of the argument list from the stack, then jump to rt0_go, shared by every OS on this CPU.")],
    [L("从系统栈划出 64 KB 给 g0", "Carve 64 KB of the OS stack for g0"),
     L("运行时自己的代码要在 g0 上运行。主线程的 g0 直接用操作系统给的栈：最上面的 64 KB 划给它。",
       "The runtime's own code runs on g0. The main thread's g0 simply uses the stack the OS provided: the top 64 KB.")],
    [L("询问 CPU 的厂商和型号", "Ask the CPU what it is"),
     L("CPUID 指令报告 CPU 的厂商和型号。运行时记下是不是 Intel 的 CPU，据此微调个别实现，比如复制大块内存的方式。",
       "The CPUID instruction reports the vendor and model. The runtime notes whether it is an Intel CPU and uses that to tune a few routines, such as copying large blocks of memory.")],
    [L("设置 TLS，关联 m0 与 g0", "Set up TLS, link m0 and g0"),
     L("让线程本地存储（TLS）记下「当前 goroutine 是 g0」，再让 m0 和 g0 互相指向对方。从此任何 Go 函数都能找到当前 goroutine，可以调用 Go 代码了。",
       "Thread-local storage now records \"the current goroutine is g0\", and m0 and g0 point to each other. Any Go function can now find the current goroutine, so Go code can run.")],
    [L("check、args、osinit：自检与读取信息", "check, args, osinit: self-check, read facts"),
     L("check 核对编译器的假设（如 int8 占 1 字节）；args 读出内核给的页大小和 16 个随机字节；osinit 数出本进程能用的 CPU 个数。",
       "check verifies compiler assumptions (int8 is 1 byte, ...); args reads the page size and 16 random bytes from the kernel; osinit counts the CPUs this process may use.")],
    [L("schedinit：栈、随机数、堆、哈希……", "schedinit: stacks, random, heap, hashing..."),
     L("按依赖次序准备各个部件：先有随机数种子，才能把堆放到随机地址；先用 CPUID 逐项问清 CPU 支持哪些指令，才能选哈希算法，之后才能用 map。垃圾回收器只设好参数，3.6 才打开它。",
       "Parts are prepared in dependency order: the random seed comes before the heap (placed at a random address), the CPU features are queried (CPUID again) before the hash function is chosen, and only then can maps be used. The garbage collector is configured but stays off until 3.6.")],
    [L("创建 P，个数 = GOMAXPROCS", "Create the P's, GOMAXPROCS of them"),
     null],
    [L("newproc：为 runtime.main 建第一个 goroutine", "newproc: first goroutine, for runtime.main"),
     L("为 runtime.main 新建一个 goroutine（现在已经能分配内存了），放进 P0 的待运行队列。它还没有运行。",
       "A goroutine is created for runtime.main (allocation works now) and put on P0's run queue. It is not running yet.")],
    [L("mstart：进入调度循环，运行 runtime.main", "mstart: enter the scheduler, run runtime.main"),
     L("主线程装好信号处理函数，进入调度循环：从队列里取出唯一的 goroutine，切换到它的栈上运行 runtime.main。接下来的事见 3.6。mstart 不会返回。",
       "The main thread installs signal handlers and enters the scheduling loop: it takes the only queued goroutine and switches to its stack to run runtime.main. 3.6 continues from here. mstart never returns.")],
  ];

  V.register("boot-sequence", function (host) {
    var p = V.panel(host, { title: L("从程序入口到第一个 goroutine", "From the entry point to the first goroutine") });
    var root = V.svg("svg", { viewBox: "0 0 720 362", role: "img",
      "aria-label": L("启动步骤与每一步之后进程里已有的东西", "Startup steps and what exists after each") }, p.stage);
    var defs = V.svg("defs", null, root);
    var mk = V.svg("marker", { id: "bs-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5,
      markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
    V.svg("path", { d: "M0,0 L10,5 L0,10 z", style: "fill:var(--viz-c3)" }, mk);
    var g = V.svg("g", null, root);

    var cpus = 8, limit = 0, cur = -1, timer = null;

    function procs() {
      if (!limit) return cpus;
      return Math.min(cpus, Math.max(2, Math.ceil(limit)));
    }
    function stepNote(i) {
      if (i !== 7) return STEPS[i][1];
      var n = procs();
      var why = limit
        ? L("容器限额 " + limit + " 个 CPU，向上取整、至少为 2，再与 CPU 数 " + cpus + " 取较小者，得 " + n + "。",
            "the container limit is " + limit + " CPUs: round up, at least 2, then the smaller of that and the CPU count " + cpus + ", giving " + n + ".")
        : L("没有容器限额，默认等于 CPU 数 " + cpus + "。", "there is no container limit, so it is the CPU count, " + cpus + ".");
      return L("P 是运行 Go 代码的许可，个数决定最多几个 goroutine 同时运行。没设环境变量 GOMAXPROCS 时用默认值：", "A P is a permit to run Go code; their number caps how many goroutines run at once. Without the GOMAXPROCS variable the default applies: ") +
        why + L("主线程拿走 P0。", " The main thread takes P0.");
    }

    function box(x, y, w, h, on, c, label, sub, opt) {
      opt = opt || {};
      V.svg("rect", { x: x, y: y, width: w, height: h, rx: 5,
        style: "fill:" + (on ? c : "var(--viz-fill)") + ";fill-opacity:" + (on ? 0.16 : 1) +
          ";stroke:" + (on ? c : "var(--viz-line)") + ";stroke-width:" + (opt.bold ? 2 : 1.2) +
          (opt.dash ? ";stroke-dasharray:4 3" : "") }, g);
      V.svg("text", { x: x + w / 2, y: y + (sub ? h / 2 - 1 : h / 2 + 4.5), "text-anchor": "middle",
        style: "font-size:" + (opt.fs || 12) + "px" + (opt.mono ? ";font-family:var(--font-mono,monospace)" : "") +
          (on ? "" : ";fill:var(--viz-muted)"), text: label }, g);
      if (sub) V.svg("text", { x: x + w / 2, y: y + h / 2 + 12, "text-anchor": "middle",
        style: "font-size:10.5px;fill:var(--viz-muted)", text: sub }, g);
    }
    function arrow(x1, y1, x2, y2, both) {
      var a = { x1: x1, y1: y1, x2: x2, y2: y2, "marker-end": "url(#bs-arrow)",
        style: "stroke:var(--viz-c3);stroke-width:1.5" };
      if (both) a["marker-start"] = "url(#bs-arrow)";
      V.svg("line", a, g);
    }

    function draw() {
      while (g.firstChild) g.removeChild(g.firstChild);
      // Left: the steps.
      STEPS.forEach(function (s, i) {
        var y = 26 + i * 33, done = i < cur, now = i === cur;
        var c = now ? "var(--viz-c1)" : done ? "var(--viz-c3)" : "var(--viz-line)";
        V.svg("circle", { cx: 16, cy: y - 4, r: 9,
          style: "fill:" + (now || done ? c : "var(--viz-fill)") + ";fill-opacity:" + (now || done ? 0.2 : 1) + ";stroke:" + c }, g);
        V.svg("text", { x: 16, y: y, "text-anchor": "middle", style: "font-size:10.5px", text: String(i + 1) }, g);
        V.svg("text", { x: 32, y: y, style: "font-size:12px" + (now ? ";font-weight:600" : "") +
          (now || done ? "" : ";fill:var(--viz-muted)"), text: s[0] }, g);
      });

      // Right: what exists now.
      var X = 336, k = cur;
      V.svg("text", { x: X, y: 16, style: "font-size:12px;font-weight:600",
        text: L("此刻进程里有什么", "What exists now") }, g);
      // The main thread.
      V.svg("rect", { x: X, y: 26, width: 376, height: 162, rx: 6,
        style: "fill:none;stroke:var(--viz-line);stroke-width:1.2" }, g);
      V.svg("text", { x: X + 8, y: 42, style: "font-size:11.5px;fill:var(--viz-muted)",
        text: k >= 0 ? L("主线程（目前唯一的线程）", "Main thread (the only thread)") : L("（程序尚未启动）", "(not started)") }, g);
      // OS stack: top part holds args/env/extra facts, then g0's 64 KB.
      var sx = X + 10, sy = 54, sw = 92;
      if (k >= 0) {
        V.svg("text", { x: sx + sw / 2, y: sy + 4, "text-anchor": "middle", style: "font-size:10.5px;fill:var(--viz-muted)",
          text: L("系统给的栈", "OS stack") }, g);
        box(sx, sy + 10, sw, 30, true, "var(--viz-c4)", L("参数 环境变量", "args, env"), L("附加信息", "extra facts"), { fs: 10.5 });
        box(sx, sy + 42, sw, 50, k >= 2, "var(--viz-c1)", k >= 2 ? L("g0 的栈", "g0's stack") : "", k >= 2 ? "64 KB" : "", {});
        box(sx, sy + 94, sw, 34, false, "", L("其余", "the rest"), "", { fs: 10.5 });
      }
      // m0 and g0.
      var mx = X + 120;
      box(mx, 60, 96, 36, k >= 4, "var(--viz-c3)", "m0", k >= 4 ? L("描述主线程", "the main thread") : L("全局变量，未用", "global, unused"), { mono: true, dash: k < 4 });
      box(mx, 132, 96, 36, k >= 4, "var(--viz-c3)", "g0", k >= 4 ? L("运行时自己用", "for the runtime") : L("全局变量，未用", "global, unused"), { mono: true, dash: k < 4 });
      if (k >= 4) arrow(mx + 48, 98, mx + 48, 130, true);
      // TLS and CPU info.
      var tx = X + 236;
      if (k >= 4) {
        box(tx, 60, 130, 36, true, "var(--viz-c3)", "TLS", L("当前 goroutine", "current goroutine"), { mono: false });
        if (k >= 9) arrow(tx + 65, 98, tx + 65, 104);
        else arrow(tx, 84, mx + 98, 140);
      }
      if (k >= 3) box(tx, 150, 130, 30, true, "var(--viz-c4)", L("CPU 信息", "CPU info"), "", {});
      if (k >= 9) box(tx, 106, 130, 30, true, "var(--viz-c1)", L("运行 runtime.main", "running runtime.main"), "", { bold: true });

      // Facts read in step 6.
      if (k >= 5) {
        var facts = [L("页大小 4 KB", "page size 4 KB"), L("16 个随机字节", "16 random bytes"), L("CPU 数 = ", "CPUs = ") + cpus];
        facts.forEach(function (f, i) { box(X + i * 126, 198, 120, 26, true, "var(--viz-c4)", f, "", { fs: 11.5 }); });
      }
      // Heap and GC after schedinit.
      if (k >= 6) {
        box(X, 234, 180, 26, true, "var(--viz-c3)", L("堆：可以分配内存了", "heap: allocation works"), "", { fs: 11.5 });
        box(X + 190, 234, 186, 26, false, "", L("垃圾回收：参数已设，未开启", "GC: configured, still off"), "", { fs: 11.5, dash: true });
      }
      // P's.
      if (k >= 7) {
        var n = procs(), pw = Math.min(40, (376 - 30) / n - 6);
        V.svg("text", { x: X, y: 290, style: "font-size:11.5px;fill:var(--viz-muted)", text: "P" }, g);
        for (var i = 0; i < n; i++) {
          var px = X + 16 + i * (pw + 6);
          box(px, 272, pw, 26, i === 0, "var(--viz-c1)", "P" + i, "", { fs: 11, mono: true, bold: i === 0 });
        }
        V.svg("text", { x: X + 16, y: 314, style: "font-size:10.5px;fill:var(--viz-muted)",
          text: "GOMAXPROCS = " + n + L("，P0 归主线程", "; P0 belongs to the main thread") }, g);
      }
      // P0's run queue.
      if (k >= 7) {
        V.svg("text", { x: X + 16, y: 340, style: "font-size:11.5px;fill:var(--viz-muted)",
          text: L("P0 的待运行队列：", "P0 run queue:") }, g);
        if (k === 8) box(X + 136, 324, 170, 26, true, "var(--viz-c1)", L("goroutine：runtime.main", "goroutine: runtime.main"), "", { fs: 11.5 });
        else V.svg("text", { x: X + 136, y: 340, style: "font-size:11.5px;fill:var(--viz-muted)",
          text: k >= 9 ? L("（空，已取出运行）", "(empty: taken to run)") : L("（空）", "(empty)") }, g);
      }
    }

    function step() {
      if (cur >= STEPS.length - 1) return false;
      cur++;
      p.note.textContent = (cur + 1) + ". " + stepNote(cur);
      draw();
      return cur < STEPS.length - 1;
    }
    function reset() {
      stop();
      cur = -1;
      draw();
      p.note.textContent = L("左边是启动的十步，右边是每一步之后进程里已有的东西。点「下一步」开始。改 CPU 数或容器限额，看第 8 步创建几个 P。",
        "Left: the ten startup steps. Right: what exists after each one. Press Step to begin. Change the CPU count or the container limit to see how many P's step 8 creates.");
      stepBtn.disabled = false; playBtn.disabled = false;
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } if (playBtn) playBtn.textContent = L("自动播放", "Play"); }

    var stepBtn = V.button(p.bar, L("下一步", "Step"), function () {
      stop();
      if (!step()) { stepBtn.disabled = true; playBtn.disabled = true; }
    });
    var playBtn = V.button(p.bar, L("自动播放", "Play"), function () {
      if (timer) { stop(); return; }
      playBtn.textContent = L("暂停", "Pause");
      timer = setInterval(function () {
        if (!host.isConnected) { stop(); return; }
        if (!step()) { stop(); stepBtn.disabled = true; playBtn.disabled = true; }
      }, 1500);
    });
    V.button(p.bar, L("重置", "Reset"), reset);
    function rerender() { draw(); if (cur === 7) p.note.textContent = "8. " + stepNote(7); }
    V.select(p.bar, L("CPU 数", "CPUs"), [1, 2, 4, 8].map(function (v) { return { value: String(v), label: String(v) }; }),
      "8", function (v) { cpus = +v; rerender(); });
    V.select(p.bar, L("容器 CPU 限额", "Container CPU limit"), [
      { value: "0", label: L("无", "none") }, { value: "0.5", label: "0.5" },
      { value: "1.5", label: "1.5" }, { value: "3", label: "3" },
    ], "0", function (v) { limit = +v; rerender(); });

    reset();
  });
})();
