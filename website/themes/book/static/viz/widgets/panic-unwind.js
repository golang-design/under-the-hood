/*
 * panic-unwind: one panic, step by step, through the Go 1.26 runtime (book §6.3).
 *
 * The program has every kind of frame the runtime must handle: main and serve
 * use open-coded defers (a deferBits byte and closure slots in the frame),
 * handle's defer sits in a loop and is heap-allocated on g._defer, and parse
 * has no defers. `go build -gcflags=-d=defer` with Go 1.26.10 reports exactly
 * this, and the console lines are the program's real output for each variant.
 *
 * The steps follow src/runtime/panic.go on release-branch.go1.26:
 *   gopanic         builds _panic p on its own frame and links it to g._panic;
 *   _panic.start    calls nextFrame to find the first frame with defers;
 *   nextFrame       walks up with the unwinder and stops at a frame whose SP
 *                   equals g._defer.sp, or whose FUNCDATA_OpenCodedDeferInfo
 *                   shows nonzero deferBits (initOpenCodedDefers, which also
 *                   sets p.retpc to the frame's deferreturn call);
 *   nextDefer       takes the top set bit (7 - LeadingZeros8), clears it and
 *                   stores it back before returning the slot's closure, then
 *                   pops g._defer records whose d.sp matches the frame; if
 *                   p.recovered is set it calls mcall(recovery) instead;
 *   gorecover       counts non-wrapper frames between itself and gopanic and
 *                   succeeds only if there is exactly one (and gopanic's FP
 *                   matches p.gopanicFP); it only sets p.recovered;
 *   recovery        pops the recovered _panic, saves the frame's remaining
 *                   open-coded state (savedOpenDeferState) when deferBits is
 *                   nonzero, and jumps to the frame's deferreturn call; the
 *                   frames above are discarded;
 *   deferreturn     resumes from the saved state with the same nextDefer loop;
 *   preprintpanics,
 *   fatalpanic      run when no defer is left, then exit(2).
 * runtime.main has its own open-coded defer (proc.go, needUnlock), which
 * nextFrame also finds when a panic is not recovered.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;
  var MONO = "font-family:var(--font-mono,monospace)";

  // ---- the program --------------------------------------------------------
  // tag: which defer a line registers (gutter label); id: lines the steps point at.
  function program(v) {
    var P = [];
    function ln(s, o) { var x = o || {}; x.s = s; P.push(x); }
    ln("func main() {");
    ln("\tdefer fmt.Println(\"main: deferred\")", { tag: "m0", id: "m0" });
    ln("\tserve()", { id: "mcall" });
    ln("\tfmt.Println(\"main: serve returned\")", { id: "mafter" });
    ln("}", { id: "mend" });
    ln("");
    ln("func serve() {");
    ln("\tdefer fmt.Println(\"serve: cleanup\")", { tag: "s0", id: "s0" });
    if (v === "direct") {
      ln("\tdefer func() {", { tag: "s1", id: "s1" });
      ln("\t\tfmt.Println(\"recovered:\", recover())", { id: "rec" });
      ln("\t}()");
    } else if (v === "nested") {
      ln("\tdefer func() {", { tag: "s1", id: "s1" });
      ln("\t\tfunc() {", { id: "inner" });
      ln("\t\t\tfmt.Println(\"recovered:\", recover())", { id: "rec" });
      ln("\t\t}()");
      ln("\t}()");
    } else {
      ln("\tdefer recover()", { tag: "s1", id: "s1" });
    }
    ln("\thandle(2)", { id: "scall" });
    ln("}", { id: "send" });
    ln("");
    ln("func handle(n int) {");
    ln("\tfor i := range n {");
    ln("\t\tdefer fmt.Println(\"handle: release\", i)", { tag: "h", id: "h" });
    ln("\t}");
    ln("\tparse()", { id: "hcall" });
    ln("}");
    ln("");
    ln("//go:noinline");
    ln("func parse() { panic(\"boom\") }", { id: "panic" });
    return P;
  }

  // ---- the run ------------------------------------------------------------
  function simulate(v) {
    var steps = [];
    var st = {
      frames: [{ id: "rt", name: "runtime.main", kind: "rt", bits: 1 },
        { id: "main", name: "main.main", kind: "open", bits: 0 }],
      gdefer: [], panic: null, psp: null, out: [], exit: null,
      ds: { m0: 0, s0: 0, s1: 0, h: 0 }, // 0 not registered, 1 pending, 2 running, 3 done
      lines: [], scan: null, discard: [], hot: null, check: null,
    };
    function F(id) { for (var i = 0; i < st.frames.length; i++) if (st.frames[i].id === id) return st.frames[i]; return null; }
    function push(id, o) { var x = o || {}; x.id = id; st.frames.push(x); }
    function pop(id) { st.frames = st.frames.filter(function (f) { return f.id !== id; }); }
    function snap(zh, en) {
      var s = JSON.parse(JSON.stringify(st));
      s.zh = zh; s.en = en; steps.push(s);
      st.scan = null; st.discard = []; st.hot = null; st.check = null;
      Object.keys(st.ds).forEach(function (k) { if (st.ds[k] === 2) st.ds[k] = 3; });
    }
    var recName = v === "direct" ? "main.serve.func1" : v === "nested" ? "main.serve.func1" : "main.serve.deferwrap2";

    snap("程序从 main 开始执行。左侧代码的标签给出每条 defer 采用的实现（与 -gcflags=-d=defer 的报告一致）：「位 n」表示开放编码式延迟，占用延迟位图中的第 n 位；handle 中的 defer 位于循环里，只能在堆上分配记录。",
      "The program starts in main. The tags in the code give the implementation of each defer, as -gcflags=-d=defer reports it: \"bit n\" is an open-coded defer that owns bit n of the frame's deferBits; the defer in handle sits in a loop, so its records are heap-allocated.");

    F("main").bits = 1; st.ds.m0 = 1; st.lines = ["m0"];
    snap("main 执行 defer：被延迟的闭包 main.deferwrap1 存入栈帧中的槽位 0，然后把 deferBits 的第 0 位置 1。没有调用运行时，也没有分配记录。",
      "main runs its defer: the deferred closure main.deferwrap1 is stored in slot 0 of the frame, and then bit 0 of deferBits is set. No runtime call, no record.");

    push("serve", { name: "main.serve", kind: "open", bits: 3 });
    st.ds.s0 = 1; st.ds.s1 = 1; st.lines = ["mcall", "s0", "s1"];
    snap("main 调用 serve。serve 的两条 defer 依次把闭包存入槽位 0 与 1，并置位第 0 位与第 1 位，deferBits 变为 0000 0011。",
      "main calls serve. serve's two defers store their closures in slots 0 and 1 and set bits 0 and 1, so deferBits becomes 0000 0011.");

    push("handle", { name: "main.handle", kind: "heap" });
    st.gdefer = [{ i: 1 }, { i: 0 }]; st.ds.h = 1; st.lines = ["scall", "h"];
    snap("serve 调用 handle(2)。循环执行两次 defer，每次由 deferproc 在堆上取得一个 _defer 记录，挂到 g._defer 的表头，记录中的 d.sp 是 handle 的栈指针。后登记的 i=1 位于表头。",
      "serve calls handle(2). The loop runs the defer twice; each time deferproc takes a heap _defer record and links it at the head of g._defer, with d.sp set to handle's stack pointer. The later one, i=1, is at the head.");

    push("parse", { name: "main.parse", kind: "none" });
    push("gopanic", { name: "runtime.gopanic", kind: "gopanic" });
    st.panic = { recovered: false }; st.lines = ["hcall", "panic"];
    snap("handle 调用 parse，parse 调用 panic(\"boom\")，即 runtime.gopanic。gopanic 在自己的栈帧上建立 _panic 记录 p，挂到 g._panic 的表头。没有任何栈帧被弹出。",
      "handle calls parse, and parse calls panic(\"boom\"), which is runtime.gopanic. gopanic builds the _panic record p on its own frame and links it at the head of g._panic. No frame is popped.");

    st.psp = "handle"; st.scan = { skip: ["parse"], hit: "handle" };
    snap("p.start 调用 nextFrame，由栈展开器从 parse 开始逐帧向上：parse 的栈指针不等于 g._defer 表头记录的 d.sp，也没有开放编码信息，跳过；handle 的栈指针等于 d.sp，遍历在此停止，p.sp 指向 handle。",
      "p.start calls nextFrame, and the unwinder walks up from parse: parse's SP is not g._defer.sp and it has no open-coded info, so it is skipped; handle's SP equals d.sp, so the walk stops there. p.sp now points at handle.");

    [1, 0].forEach(function (i) {
      st.gdefer.shift();
      push("call", { name: "main.handle.deferwrap1", kind: "call" });
      st.out.push("handle: release " + i); st.lines = ["h"]; st.hot = { frame: "handle" };
      if (i === 0) st.ds.h = 2;
      snap("nextDefer：handle 没有延迟位图；g._defer 的表头记录 d(i=" + i + ") 登记于 handle（d.sp 相符），将其摘下并执行。延迟调用像普通调用一样运行在 gopanic 的栈帧之上。",
        "nextDefer: handle has no deferBits; the head of g._defer, d(i=" + i + "), belongs to handle (d.sp matches), so it is unlinked and run. The deferred call runs like any call, on top of gopanic's frame.");
      pop("call");
    });

    st.psp = "serve"; st.scan = { skip: [], hit: "serve" };
    snap("handle 的延迟调用已经取尽，nextDefer 调用 nextFrame。g._defer 已空，只能凭开放编码信息判断：serve 带有 FUNCDATA_OpenCodedDeferInfo，且 deferBits 不为零，遍历在此停止。initOpenCodedDefers 把 serve 中调用 deferreturn 的位置记入 p.retpc。",
      "handle has no defers left, so nextDefer calls nextFrame. g._defer is empty, so only open-coded info can stop the walk: serve has FUNCDATA_OpenCodedDeferInfo and nonzero deferBits, so the walk stops there. initOpenCodedDefers records the address of serve's deferreturn call in p.retpc.");

    F("serve").bits = 1; st.ds.s1 = 2; st.hot = { frame: "serve", bit: 1 };
    push("call", { name: recName, kind: v === "deferrec" ? "wrap" : "call" });
    st.lines = ["s1"];
    if (v === "nested") push("inner", { name: "main.serve.func1.1", kind: "plain" });
    snap(v === "deferrec"
      ? "nextDefer 取最高的置位位，即第 1 位：先清零并写回栈上（0000 0001），再执行槽位 1 中的闭包。编译器把 defer recover() 改写成了无参闭包 serve.deferwrap2，由它调用 recover。"
      : "nextDefer 取最高的置位位，即第 1 位：先清零并写回栈上（0000 0001），再执行槽位 1 中的闭包 serve.func1。" +
        (v === "nested" ? "serve.func1 又调用了一个函数字面量 serve.func1.1。" : ""),
      v === "deferrec"
      ? "nextDefer takes the highest set bit, bit 1: it clears it and stores it back (0000 0001), then runs the closure in slot 1. The compiler rewrote defer recover() into the argument-free closure serve.deferwrap2, which calls recover."
      : "nextDefer takes the highest set bit, bit 1: it clears it and stores it back (0000 0001), then runs the closure in slot 1, serve.func1." +
        (v === "nested" ? " serve.func1 in turn calls the function literal serve.func1.1." : ""));

    push("gorecover", { name: "runtime.gorecover", kind: "plain" });
    st.lines = ["rec"]; st.ds.s1 = 2;
    if (v === "direct") {
      st.panic.recovered = true;
      st.check = { rows: [["main.serve.func1", 1]], ok: true };
      snap("recover 即 runtime.gorecover。它沿栈向下计数 gopanic 与自身之间的非包装栈帧：只有 serve.func1，计数为 1，且 gopanic 的帧指针与 p 中记录的相符。截获成功：p.recovered 置为 true，返回 \"boom\"。此时 panic 尚未停止。",
        "recover is runtime.gorecover. It counts the non-wrapper frames between itself and gopanic: only serve.func1, a count of 1, and gopanic's frame pointer matches the one in p. The recover succeeds: p.recovered is set and \"boom\" is returned. The panic has not stopped yet.");
    } else if (v === "nested") {
      st.check = { rows: [["main.serve.func1.1", 1], ["main.serve.func1", 2]], ok: false };
      snap("gorecover 向下计数非包装栈帧：serve.func1.1 计 1，serve.func1 计 2，超过 1，停止。截获失败，recover 返回 nil，p.recovered 仍为 false。",
        "gorecover counts non-wrapper frames: serve.func1.1 is 1, serve.func1 is 2, more than 1, so it stops. The recover fails: it returns nil and p.recovered stays false.");
    } else {
      st.check = { rows: [["main.serve.deferwrap2", 0]], ok: false };
      snap("gorecover 向下计数非包装栈帧：serve.deferwrap2 是包装函数，不计数；随即到达 gopanic，计数为 0。截获失败，recover 返回 nil。",
        "gorecover counts non-wrapper frames: serve.deferwrap2 is a wrapper and is not counted; the next frame is gopanic, so the count is 0. The recover fails and returns nil.");
    }
    pop("gorecover"); pop("inner"); pop("call");

    if (v === "direct") {
      st.out.push("recovered: boom"); st.lines = ["rec"]; st.ds.s1 = 2;
      snap("serve.func1 打印 recovered: boom 并返回。gopanic 的循环再次调用 nextDefer，后者看到 p.recovered 为 true，通过 mcall 切换到系统栈调用 recovery，不再返回。",
        "serve.func1 prints recovered: boom and returns. gopanic's loop calls nextDefer again, which sees p.recovered and calls recovery on the system stack through mcall; it does not return.");

      st.discard = ["gopanic", "parse", "handle"]; st.lines = ["send"]; st.panic = null;
      snap("recovery：p.retpc 指向 serve 中调用 deferreturn 的位置。它从 g._panic 上弹出 p；serve 的 deferBits 还剩第 0 位，于是保存延迟位图与槽位的位置（savedOpenDeferState）；然后把 gp.sched 的栈指针设为 serve 的栈指针、程序计数器设为该位置，由 gogo 跳转过去。handle、parse 与 gopanic 的栈帧就此被丢弃。",
        "recovery: p.retpc points at serve's call to deferreturn. It pops p off g._panic; serve's deferBits still has bit 0, so it saves where the bits and slots are (savedOpenDeferState); then it sets gp.sched's SP to serve's SP and its PC to that call, and jumps there with gogo. The frames of handle, parse and gopanic are discarded.");
      pop("gopanic"); pop("parse"); pop("handle");
      st.psp = null;

      push("dr", { name: "runtime.deferreturn", kind: "dr" });
      push("call", { name: "main.serve.deferwrap1", kind: "call" });
      F("serve").bits = 0; st.ds.s0 = 2; st.psp = "serve"; st.hot = { frame: "serve", bit: 0 };
      st.out.push("serve: cleanup"); st.lines = ["s0"];
      snap("serve 从 deferreturn 继续。deferreturn 建立一个标记为 deferreturn 的 _panic，取回 recovery 保存的状态，执行同一个 nextDefer 循环：取出第 0 位，执行 serve.deferwrap1。",
        "serve resumes in deferreturn, which builds a _panic marked deferreturn, picks up the state recovery saved, and runs the same nextDefer loop: it takes bit 0 and runs serve.deferwrap1.");
      pop("call"); pop("dr"); pop("serve"); st.psp = null;

      st.out.push("main: serve returned"); st.lines = ["mafter"];
      snap("deferBits 已为零，serve 也没有登记在 g._defer 上的记录，deferreturn 的循环结束。serve 正常返回，main 继续执行下一行，如同 handle(2) 从未发生 panic。",
        "deferBits is zero and serve has no records on g._defer, so deferreturn's loop ends. serve returns normally and main runs its next line, as if handle(2) had never panicked.");

      push("call", { name: "main.main.deferwrap1", kind: "call" });
      F("main").bits = 0; st.ds.m0 = 2; st.hot = { frame: "main", bit: 0 };
      st.out.push("main: deferred"); st.lines = ["mend"]; st.exit = 0;
      snap("main 到达函数末尾。开放编码的出口代码检查 deferBits：第 0 位已置位，先清零，再直接调用槽位 0 中的闭包。main 返回后，程序以退出状态 0 结束。",
        "main reaches its end. The open-coded exit code checks deferBits: bit 0 is set, so it clears it and calls the closure in slot 0 directly. main returns and the program exits with status 0.");
      pop("call");
      return steps;
    }

    if (v === "nested") st.out.push("recovered: <nil>");
    st.lines = ["rec"]; st.ds.s1 = 2;
    snap(v === "nested"
      ? "serve.func1.1 打印 recovered: <nil>，两层函数先后返回。panic 没有被截获，gopanic 的循环继续。"
      : "serve.deferwrap2 返回。panic 没有被截获，gopanic 的循环继续。",
      v === "nested"
      ? "serve.func1.1 prints recovered: <nil>, and both functions return. The panic was not intercepted, so gopanic's loop goes on."
      : "serve.deferwrap2 returns. The panic was not intercepted, so gopanic's loop goes on.");

    push("call", { name: "main.serve.deferwrap1", kind: "call" });
    F("serve").bits = 0; st.ds.s0 = 2; st.hot = { frame: "serve", bit: 0 };
    st.out.push("serve: cleanup"); st.lines = ["s0"];
    snap("nextDefer：serve 的 deferBits 还剩第 0 位，清零后执行 serve.deferwrap1。",
      "nextDefer: serve's deferBits still has bit 0; it is cleared and serve.deferwrap1 runs.");
    pop("call");

    st.psp = "main"; st.scan = { skip: [], hit: "main" };
    snap("serve 的延迟调用已经取尽。nextFrame 继续向上：main 带有开放编码信息，deferBits 为 0000 0001，停在 main。",
      "serve has no defers left. nextFrame walks on: main has open-coded info and deferBits 0000 0001, so it stops at main.");

    push("call", { name: "main.main.deferwrap1", kind: "call" });
    F("main").bits = 0; st.ds.m0 = 2; st.hot = { frame: "main", bit: 0 };
    st.out.push("main: deferred"); st.lines = ["m0"];
    snap("nextDefer 取出 main 的第 0 位，执行 main.deferwrap1。",
      "nextDefer takes main's bit 0 and runs main.deferwrap1.");
    pop("call");

    st.psp = "rt"; st.scan = { skip: [], hit: "rt" }; F("rt").bits = 0; st.hot = { frame: "rt", bit: 0 };
    snap("nextFrame 越过 main.main，进入运行时的栈帧。runtime.main 也登记了一个开放编码式延迟（needUnlock 此时已为 false，它什么也不做），同样被取出执行。此后栈展开器到达栈底，nextFrame 返回 false，循环结束。",
      "nextFrame walks past main.main into the runtime. runtime.main has an open-coded defer of its own (needUnlock is false by now, so it does nothing), and it runs too. Then the unwinder reaches the bottom of the stack, nextFrame returns false, and the loop ends.");

    st.psp = null; st.out.push("panic: boom", "goroutine 1 [running]:", "main.parse()", "…"); st.exit = 2;
    st.lines = ["panic"];
    snap("所有延迟调用都已执行，panic 仍未被截获。preprintpanics 预先求出要打印的字符串，fatalpanic 打印 panic 的值与调用栈，以 exit(2) 结束进程。栈帧始终没有被弹出，因此调用栈从发生 panic 的 main.parse 开始打印。",
      "Every deferred call has run and the panic is still not intercepted. preprintpanics computes the strings to print, and fatalpanic prints the value and the stack, then calls exit(2). No frame was ever popped, so the trace starts at main.parse, where the panic happened.");
    return steps;
  }

  V.register("panic-unwind", function (host) {
    var p = V.panel(host, { title: L("一次 panic 的展开：延迟位图、_defer 链表与 recover", "Unwinding one panic: deferBits, the _defer list and recover") });
    var W = 720, H = 450;
    var root = V.svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": L("程序、goroutine 的调用栈与输出", "The program, the goroutine's stack and its output") }, p.stage);
    var gCode = V.svg("g", null, root), gStack = V.svg("g", null, root), gSide = V.svg("g", null, root);

    var variant = "direct", prog, steps, k = 0, timer = null;

    function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }
    function txt(g, x, y, s, style, anchor) {
      return V.svg("text", { x: x, y: y, "text-anchor": anchor || "start", style: style || "", text: s }, g);
    }
    function rect(g, x, y, w, h, style, rx) {
      return V.svg("rect", { x: x, y: y, width: w, height: h, rx: rx == null ? 4 : rx, style: style }, g);
    }
    var DS_COL = ["var(--viz-muted)", "var(--viz-c4)", "var(--viz-c1)", "var(--viz-c3)"];

    // ---- left: the code, with a gutter tag for every defer ------------------
    var CX = 50, CY = 20, LH = 13;
    function drawCode(s) {
      clear(gCode);
      prog.forEach(function (ln, i) {
        var y = CY + i * LH;
        if (ln.id && s.lines.indexOf(ln.id) >= 0)
          rect(gCode, CX - 4, y - 10, 300, LH, "fill:var(--viz-c1);fill-opacity:.14", 2);
        if (ln.tag) {
          var stt = s.ds[ln.tag], c = DS_COL[stt];
          var lab = ln.tag === "h" ? L("堆上", "heap") : L("位 ", "bit ") + ln.tag.slice(1);
          rect(gCode, 4, y - 9, 40, 12, "fill:" + (stt ? c : "none") + ";fill-opacity:.16;stroke:" + c + ";stroke-width:1", 3);
          txt(gCode, 24, y, lab, "font-size:9.5px;fill:" + (stt ? c : "var(--viz-muted)"), "middle");
        }
        var t = ln.s.replace(/^\t+/, ""), ind = ln.s.length - t.length;
        txt(gCode, CX + ind * 13, y, t, "font-size:11px;" + MONO + (ln.s.indexOf("//") === 0 ? ";fill:var(--viz-muted)" : ""));
      });
      // bottom-left box: the recover check, or a legend
      var by = 352;
      rect(gCode, 4, by, 344, 92, "fill:var(--viz-fill);stroke:var(--viz-line)", 6);
      if (s.check) {
        txt(gCode, 14, by + 17, L("gorecover：计数 gopanic 与自身之间的非包装栈帧", "gorecover: count non-wrapper frames down to gopanic"), "font-size:11.5px;font-weight:600");
        var y = by + 35;
        txt(gCode, 14, y, "runtime.gorecover", "font-size:11px;" + MONO + ";fill:var(--viz-muted)");
        txt(gCode, 338, y, L("起点", "start"), "font-size:11px;fill:var(--viz-muted)", "end");
        s.check.rows.forEach(function (r) {
          y += 15;
          txt(gCode, 14, y, r[0], "font-size:11px;" + MONO);
          txt(gCode, 338, y, r[1] === 0 ? L("包装函数，不计", "wrapper, not counted") : L("计数 " + r[1], "count " + r[1]),
            "font-size:11px;fill:" + (r[1] > 1 ? "var(--viz-c2)" : "var(--viz-ink)"), "end");
        });
        y += 15;
        var last = s.check.rows[s.check.rows.length - 1][1];
        txt(gCode, 14, y, last > 1 ? "…" : "runtime.gopanic", "font-size:11px;" + MONO + ";fill:var(--viz-muted)");
        txt(gCode, 338, y, s.check.ok ? L("恰好 1 个：截获成功", "exactly 1: recovered") : last > 1 ? L("超过 1 个：截获失败", "more than 1: fails") : L("0 个：截获失败", "none: fails"),
          "font-size:11px;font-weight:600;fill:" + (s.check.ok ? "var(--viz-c3)" : "var(--viz-c2)"), "end");
      } else {
        var lg = [
          ["var(--viz-c4)", L("已登记、尚未执行的延迟调用", "registered, not yet run")],
          ["var(--viz-c1)", L("本步执行的延迟调用；p.sp 所指的栈帧", "running this step; the frame at p.sp")],
          ["var(--viz-c3)", L("已执行", "already run")],
          ["var(--viz-c2)", L("本步被 nextFrame 跳过，或被 recovery 丢弃", "skipped by nextFrame, or discarded by recovery")],
        ];
        lg.forEach(function (it, i) {
          var yy = by + 20 + i * 19;
          rect(gCode, 14, yy - 9, 12, 12, "fill:" + it[0] + ";fill-opacity:.2;stroke:" + it[0], 3);
          txt(gCode, 34, yy + 1, it[1], "font-size:11px;fill:var(--viz-muted)");
        });
      }
    }

    // ---- right: g._panic, g._defer, the stack, the console -------------------
    var SX = 388, SW = 328, FH = 24, FG = 3, SBOT = 300;
    function kindText(f) {
      return {
        rt: L("运行时", "runtime"), open: L("开放编码", "open-coded"), heap: L("堆上分配", "heap"),
        none: L("无延迟调用", "no defers"), gopanic: "_panic p", dr: L("_panic（deferreturn）", "_panic (deferreturn)"),
        call: L("延迟调用", "deferred call"), wrap: L("包装函数", "wrapper"), plain: "",
      }[f.kind];
    }
    function drawStack(s) {
      clear(gStack);
      // state lines
      var gp = s.panic ? L("g._panic → p（arg = \"boom\"" + (s.panic.recovered ? "，recovered = true）" : "）"),
        "g._panic → p (arg = \"boom\"" + (s.panic.recovered ? ", recovered = true)" : ")")) : "g._panic → nil";
      txt(gStack, SX, 14, gp, "font-size:11px;" + MONO + (s.panic && s.panic.recovered ? ";fill:var(--viz-c3)" : ""));
      var gd = "g._defer → " + s.gdefer.map(function (d) { return "d(i=" + d.i + ")"; }).concat(["nil"]).join(" → ");
      txt(gStack, SX, 30, gd, "font-size:11px;" + MONO);
      txt(gStack, 716, 30, L("新的栈帧在上", "newest frame on top"), "font-size:10.5px;fill:var(--viz-muted)", "end");
      var n = s.frames.length;
      s.frames.forEach(function (f, i) {
        var y = SBOT - (i + 1) * FH - i * FG;
        var skip = s.scan && s.scan.skip.indexOf(f.id) >= 0, gone = s.discard.indexOf(f.id) >= 0;
        var cur = s.psp === f.id, hit = s.scan && s.scan.hit === f.id;
        var stroke = gone || skip ? "var(--viz-c2)" : cur ? "var(--viz-c1)" : "var(--viz-line)";
        var dim = f.kind === "rt" && !cur;
        rect(gStack, SX, y, SW, FH, "fill:" + (gone || skip ? "var(--viz-c2)" : cur ? "var(--viz-c1)" : "var(--viz-fill)") +
          ";fill-opacity:" + (gone || skip || cur ? 0.1 : 1) + ";stroke:" + stroke + ";stroke-width:" + (cur || hit ? 2 : 1) +
          (gone ? ";stroke-dasharray:4 3" : "") + (dim ? ";opacity:.6" : ""), 4);
        txt(gStack, SX + 8, y + 16, f.name, "font-size:11px;" + MONO + (gone ? ";text-decoration:line-through;fill:var(--viz-muted)" : dim ? ";fill:var(--viz-muted)" : ""));
        var kt = gone ? L("被丢弃", "discarded") : skip ? L("跳过：无延迟调用", "skipped: no defers") : kindText(f);
        txt(gStack, SX + 166, y + 16, kt, "font-size:10.5px;fill:" + (gone || skip ? "var(--viz-c2)" : "var(--viz-muted)"));
        if (f.kind === "open" || f.kind === "rt") {
          for (var b = 7; b >= 0; b--) {
            var bx = SX + 234 + (7 - b) * 11, on = (f.bits >> b) & 1;
            var hot = s.hot && s.hot.frame === f.id && s.hot.bit === b;
            var c = hot ? "var(--viz-c1)" : on ? "var(--viz-c4)" : "var(--viz-line)";
            rect(gStack, bx, y + 5, 10, 14, "fill:" + (hot || on ? c : "none") + ";fill-opacity:" + (hot || on ? 0.2 : 1) + ";stroke:" + c + (dim ? ";opacity:.6" : ""), 2);
            txt(gStack, bx + 5, y + 16, hot ? "0" : String(on), "font-size:9.5px;" + MONO + ";fill:" + (hot ? "var(--viz-c1)" : on ? "var(--viz-ink)" : "var(--viz-muted)"), "middle");
          }
        } else if (f.kind === "heap") {
          var nrec = s.gdefer.length;
          txt(gStack, SX + 234, y + 16, nrec ? L("g._defer 上 " + nrec + " 个", nrec + " on g._defer") : L("已取尽", "none left"),
            "font-size:10.5px;fill:" + (nrec ? "var(--viz-c4)" : "var(--viz-c3)"));
        }
        if (cur) txt(gStack, SX - 6, y + 16, "p.sp ▸", "font-size:10.5px;fill:var(--viz-c1);" + MONO, "end");
      });
      // console
      var oy = 318;
      txt(gStack, SX, oy, L("输出", "Output"), "font-size:11.5px;font-weight:600");
      if (s.exit != null) txt(gStack, 716, oy, L("退出状态 ", "exit status ") + s.exit, "font-size:11px;fill:" + (s.exit ? "var(--viz-c2)" : "var(--viz-c3)"), "end");
      rect(gStack, SX, oy + 6, SW, 120, "fill:var(--viz-fill);stroke:var(--viz-line)", 4);
      s.out.forEach(function (o, i) {
        var fresh = i >= (k > 0 ? steps[k - 1].out.length : 0);
        txt(gStack, SX + 8, oy + 21 + i * 12.4, o, "font-size:10.5px;" + MONO + (fresh ? ";fill:var(--viz-c1);font-weight:600" : ""));
      });
    }

    function draw() {
      var s = steps[k];
      drawCode(s); drawStack(s);
      p.note.textContent = L(s.zh, s.en);
      stepBtn.disabled = k >= steps.length - 1;
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } playBtn.textContent = L("自动播放", "Play"); }
    function rebuild() { stop(); prog = program(variant); steps = simulate(variant); k = 0; draw(); }

    var stepBtn = V.button(p.bar, L("下一步", "Step"), function () { stop(); if (k < steps.length - 1) { k++; draw(); } });
    var playBtn = V.button(p.bar, L("自动播放", "Play"), function () {
      if (timer) { stop(); return; }
      if (k >= steps.length - 1) { k = 0; draw(); }
      playBtn.textContent = L("暂停", "Pause");
      timer = setInterval(function () {
        if (!host.isConnected) { stop(); return; }
        if (k < steps.length - 1) { k++; draw(); }
        if (k >= steps.length - 1) stop();
      }, 2600);
    });
    V.button(p.bar, L("从头", "Restart"), function () { stop(); k = 0; draw(); });
    V.select(p.bar, L("延迟函数中的 recover", "recover in the deferred call"), [
      { value: "direct", label: L("直接调用", "called directly") },
      { value: "nested", label: L("隔一层函数调用", "one call deeper") },
      { value: "deferrec", label: "defer recover()" },
    ], variant, function (v) { variant = v; rebuild(); });

    rebuild();
  });
})();
