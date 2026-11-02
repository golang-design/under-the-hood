/*
 * agent-cancel: one cancel() travelling through an Agent's goroutine tree
 * (book §21.3.2, §21.3.4).
 *
 * The tree is the chapter's: an HTTP handler whose ctx is r.Context(), the
 * control loop, an inference stream, and three tool calls run in parallel by
 * errgroup. The client disconnects and the figure steps through what each
 * goroutine does. Every behaviour shown is one the chapter cites:
 *   net/http (Go 1.26, src/net/http/request.go): an incoming request's
 *     context is canceled when the client's connection closes; for an
 *     outgoing request the context controls its whole lifetime;
 *   context (src/context/context.go, cancelCtx.cancel): closing a context's
 *     Done channel cancels every child in the same call, so all derived
 *     contexts are done at once, but goroutines only stop when they look;
 *   golang.org/x/sync/errgroup v0.24.0: Wait blocks until every function
 *     passed to Go has returned, then returns the first error;
 *   MCP Go SDK v1.8.0 (mcp/transport.go): on ctx cancellation the client
 *     retires the call at once and sends notifications/cancelled from another
 *     goroutine with context.WithoutCancel and a 5 s timeout
 *     (notifyCancellationTimeout); the server's canceller.Preempt calls
 *     conn.Cancel(id), which cancels the handler's context; a notification
 *     may arrive after the handler has finished (MCP 2026-07-28);
 *   a goroutine in a cgo call cannot be preempted (§15.6, §18.2), so it
 *     ignores ctx until the C function returns;
 *   os/exec CommandContext (src/os/exec/exec.go): when ctx is done before
 *     the command completes, cmd.Cancel runs, which by default kills the
 *     process;
 *   topos harness/harness.go: a turn ended by cancellation is still recorded
 *     as interrupted, using context.WithoutCancel(ctx).
 * Only the stdio transport is drawn, the one the chapter quotes SDK code for.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;

  var NW = 130, NH = 42;
  // Node geometry: x, y of the top-left corner.
  var POS = {
    client: [8, 30, 88], root: [244, 30], loop: [244, 96], eg: [150, 162], infer: [382, 162],
    A: [106, 232], C: [244, 232], B: [382, 232],
    server: [572, 162, 140], mcp: [572, 232, 140], sub: [244, 300],
  };
  var TITLE = {
    client: L("客户端", "Client"), root: L("HTTP 处理函数", "HTTP handler"), loop: L("控制循环", "Control loop"),
    eg: "errgroup", infer: L("推理流", "Inference stream"), A: L("工具 A：HTTP", "Tool A: HTTP"),
    B: L("工具 B：MCP 调用", "Tool B: MCP call"), server: L("推理服务进程", "Inference server"),
    mcp: L("MCP 工具服务器进程", "MCP tool server"), sub: L("子进程", "Subprocess"),
  };
  var INPROC = ["root", "loop", "eg", "infer", "A", "C", "B"];

  // Each stage: node -> [state, status]; states: run, wait, done, stuck, off.
  // badge lists the nodes whose context is done.
  function stages(cmode) {
    var C = cmode === "cgo";
    var s0 = {
      client: ["run", L("等待事件流", "reading events")],
      root: ["run", L("转发事件", "forwarding events")],
      loop: ["run", L("转发词元，等待工具", "awaiting tools")],
      eg: ["run", L("3 个工具运行中", "3 tools running")],
      infer: ["run", L("接收词元", "receiving tokens")],
      A: ["run", L("请求进行中", "request in flight")],
      C: ["run", C ? L("C 函数执行中", "C function running") : L("等待子进程", "waiting for the process")],
      B: ["run", L("等待 MCP 响应", "awaiting the response")],
      server: ["run", L("生成中，占用 KV 缓存", "holding KV cache")],
      mcp: ["run", L("处理函数运行中", "handler running")],
      sub: ["run", L("运行中", "running")],
    };
    function next(prev, changes, extra) {
      var s = {};
      Object.keys(prev).forEach(function (k) { s[k] = prev[k]; });
      Object.keys(changes).forEach(function (k) { s[k] = changes[k]; });
      s._badge = (extra && extra.badge) || prev._badge || [];
      s._links = (extra && extra.links) || {};
      return s;
    }
    s0._badge = []; s0._links = {};
    var s1 = next(s0, { client: ["off", L("已断开连接", "disconnected")] }, { badge: INPROC.slice() });
    var s2 = next(s1, {
      infer: ["done", L("已退出，请求中止", "exited, request aborted")],
      A: ["done", L("返回 context canceled", "context canceled")],
      B: ["done", L("已返回，另行发出通知", "returned; notice sent")],
      C: C ? ["stuck", L("仍在 C 代码中", "still in C code")] : ["done", L("Wait 返回错误", "Wait returned an error")],
      sub: C ? s1.sub : ["off", L("已被终止", "killed")],
    }, { links: { infer: "cut", B: "notify", C: C ? null : "cut" } });
    var s3 = next(s2, {
      server: ["done", L("停止生成，归还 KV 缓存", "stopped, KV cache freed")],
      mcp: ["done", L("ctx 已取消，处理函数返回", "handler ctx canceled")],
    }, { badge: INPROC.concat(["server", "mcp"]), links: { infer: "cut", B: "notify", C: C ? null : "cut" } });
    var list = [s0, s1, s2, s3];
    if (C) {
      var s4 = next(s3, {
        eg: ["wait", L("Wait 仍在等工具 C", "Wait still waits for C")],
        loop: ["wait", L("阻塞在 g.Wait", "blocked in g.Wait")],
        root: ["wait", L("等待控制循环", "waiting for the loop")],
      });
      var s5 = next(s4, {
        C: ["done", L("C 函数返回后退出", "exited after C returned")],
        eg: ["done", L("Wait 返回第一个错误", "Wait returned an error")],
        loop: ["done", L("本轮结束", "turn ended")],
      });
      list.push(s4, s5);
    } else {
      list.push(next(s3, {
        eg: ["done", L("Wait 返回第一个错误", "Wait returned an error")],
        loop: ["done", L("本轮结束", "turn ended")],
      }));
    }
    list.push(next(list[list.length - 1], { root: ["done", L("记录「已中断」后返回", "turn logged, returned")] }));
    return list;
  }

  function notes(cmode) {
    var C = cmode === "cgo";
    var n = [
      L("运行中：客户端经 HTTP 连接读取事件流，控制循环一边转发模型输出的词元，一边经 errgroup 并行执行三个工具调用。所有 goroutine 的 ctx 都派生自 r.Context()。点「取消」模拟客户端断开连接。",
        "Running: the client reads the event stream over HTTP, and the control loop relays the model's tokens while errgroup runs three tool calls in parallel. Every goroutine's ctx derives from r.Context(). Press Cancel to have the client disconnect."),
      L("客户端断开连接，net/http 取消 r.Context()。cancel 在同一次调用中依次取消每个子 context，因此这次调用返回时，进程内所有派生的 ctx 都已关闭 Done 通道（橙点）。但此刻没有一个 goroutine 停下：取消是协作式的，每个 goroutine 要等到下一次检查 ctx 时才会退出。",
        "The client disconnects and net/http cancels r.Context(). cancel cancels every child context within the same call, so by the time it returns, every derived ctx in the process has closed its Done channel (orange dots). Yet no goroutine has stopped: cancellation is cooperative, and each goroutine exits only the next time it checks ctx."),
      L("检查 ctx 的 goroutine 相继退出。推理流在 select 中收到 ctx.Done()，发往推理服务的请求随之中止；工具 A 的请求由 ctx 控制，传输层中止请求并返回 context canceled；工具 B 的 SDK 立即放弃等待响应（conn.Retire），另起一个 goroutine，用 context.WithoutCancel 派生、最多 5 秒的 ctx 发送 notifications/cancelled。" +
          (C ? "工具 C 停在 C 代码中，运行时无法抢占它，ctx 对它不起作用。" : "工具 C 由 exec.CommandContext 启动，ctx 结束时调用 cmd.Cancel，默认即 Process.Kill，子进程被终止，Wait 返回错误。"),
        "The goroutines that check ctx exit one by one. The inference stream sees ctx.Done() in its select, and its request to the inference server is aborted. Tool A's request is governed by ctx, so the transport aborts it and returns context canceled. Tool B's SDK stops waiting for the response at once (conn.Retire) and starts another goroutine that sends notifications/cancelled under a ctx derived with context.WithoutCancel and limited to 5 s. " +
          (C ? "Tool C is inside C code; the runtime cannot preempt it, and ctx has no effect on it." : "Tool C was started with exec.CommandContext: when ctx is done, cmd.Cancel runs, which by default is Process.Kill, so the subprocess is killed and Wait returns an error.")),
      L("取消越过了进程边界。推理服务一侧，这次请求的 Request.Context 随之取消（连接关闭，或在 HTTP/2 上请求被取消）；生成循环若响应 ctx（20.3.4），便随即退出并归还这个请求的 KV 缓存。MCP 服务器收到 notifications/cancelled，canceller.Preempt 调用 conn.Cancel(id)，处理函数的 ctx 随之取消。若处理函数在通知到达之前已经完成，服务器可以忽略这条通知，而客户端早已放弃这次调用，不再处理随后到达的响应：双方都要处理这种竞争。",
        "Cancellation crosses process boundaries. On the inference server, this request's Request.Context is canceled (the connection closed, or with HTTP/2 the request was canceled); if the generation loop honors ctx (20.3.4), it exits and frees this request's KV cache. The MCP server receives notifications/cancelled; canceller.Preempt calls conn.Cancel(id), which cancels the handler's ctx. If the handler finished before the notice arrived, the server may ignore the notice, and the client, which has already dropped the call, discards the late response: both sides must handle that race."),
    ];
    if (C) n.push(
      L("errgroup 的 Wait 要等全部 goroutine 返回，工具 C 还没有返回，控制循环于是停在 g.Wait 上，处理函数也无法返回。协作式取消止于不可抢占的 FFI 边界。",
        "errgroup's Wait returns only when every goroutine has returned. Tool C has not, so the control loop is stuck in g.Wait and the handler cannot return. Cooperative cancellation stops at the FFI boundary, which cannot be preempted."),
      L("C 函数自行返回后，工具 C 才退出，g.Wait 返回第一个错误，控制循环结束这一轮。工具 C 的外部影响可能已经发生，取消并不会撤销它。",
        "Only when the C function returns on its own does tool C exit; g.Wait returns the first error and the control loop ends the turn. Whatever tool C did outside the process may already have happened; cancellation does not undo it."));
    else n.push(
      L("三个工具都已返回，g.Wait 返回第一个错误，控制循环检查到 ctx 已取消，结束这一轮。把不可取消的调用放进子进程，取消时就能直接结束它。",
        "All three tools have returned, g.Wait returns the first error, and the control loop sees that ctx is canceled and ends the turn. Putting a call that cannot be canceled into a subprocess lets cancellation simply end it."));
    n.push(L("运行框架仍要把这一轮记录为「已中断」。原来的 ctx 已被取消，用它写入日志会立即失败，因此 topos 改用 context.WithoutCancel(ctx)。处理函数随后返回，整棵树收拢，没有遗留的 goroutine。",
      "The harness still records the turn as interrupted. The original ctx is canceled and a write under it would fail at once, so topos uses context.WithoutCancel(ctx). The handler then returns, and the whole tree has wound down with no goroutine left behind."));
    return n;
  }

  V.register("agent-cancel", function (host) {
    var p = V.panel(host, { title: L("一次取消穿过 Agent 的 goroutine 树", "One cancel() through an Agent's goroutine tree") });
    var root = V.svg("svg", { viewBox: "0 0 720 318", role: "img",
      "aria-label": L("Agent 进程中由 context 绑定的 goroutine 树，以及推理服务与工具服务器两个外部进程",
        "An Agent's context-bound goroutine tree, with the inference server and the tool server as separate processes") }, p.stage);
    var g = V.svg("g", null, root);
    function text(x, y, s, st) { return V.svg("text", { x: x, y: y, style: st || "font-size:12px", text: s }, g); }

    var cmode = "cgo", list, notesList, k = 0;

    function box(id) { var q = POS[id]; return { x: q[0], y: q[1], w: q[2] || NW, h: NH }; }
    function mid(b, side) {
      return side === "top" ? [b.x + b.w / 2, b.y] : side === "bottom" ? [b.x + b.w / 2, b.y + b.h]
        : side === "left" ? [b.x, b.y + b.h / 2] : [b.x + b.w, b.y + b.h / 2];
    }
    function line(a, b, st, label, lst) {
      V.svg("path", { d: "M" + a[0] + "," + a[1] + " L" + b[0] + "," + b[1], style: "fill:none;" + st }, g);
      if (label) text((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 5, label, "font-size:10px;text-anchor:middle;" + (lst || "fill:var(--viz-muted)"));
    }
    var COL = { run: "var(--viz-c1)", wait: "var(--viz-muted)", done: "var(--viz-c3)", stuck: "var(--viz-c2)", off: "var(--viz-muted)" };

    function draw() {
      while (g.firstChild) g.removeChild(g.firstChild);
      var st = list[k], cancelled = k >= 1;
      // Process frame.
      V.svg("rect", { x: 100, y: 10, width: 426, height: 280, rx: 8, style: "fill:none;stroke:var(--viz-line);stroke-dasharray:5 4" }, g);
      text(110, 27, L("Agent 进程", "Agent process"), "font-size:11px;font-weight:600;fill:var(--viz-muted)");
      // Tree edges; red once the cancel has passed through them.
      var edge = cancelled ? "stroke:var(--viz-c2);stroke-width:1.6" : "stroke:var(--viz-line);stroke-width:1.2";
      line(mid(box("root"), "bottom"), mid(box("loop"), "top"), edge);
      line(mid(box("loop"), "bottom"), mid(box("eg"), "top"), edge);
      line(mid(box("loop"), "bottom"), mid(box("infer"), "top"), edge);
      ["A", "C", "B"].forEach(function (t) { line(mid(box("eg"), "bottom"), mid(box(t), "top"), edge); });
      // Links to other processes.
      var lk = st._links || {};
      var clientCut = k >= 1;
      line(mid(box("client"), "right"), mid(box("root"), "left"),
        "stroke:var(--viz-muted);stroke-width:1.2;stroke-dasharray:" + (clientCut ? "2 5" : "5 3"), clientCut ? L("连接关闭", "closed") : "HTTP / SSE");
      line(mid(box("infer"), "right"), mid(box("server"), "left"),
        "stroke:var(--viz-muted);stroke-width:1.2;stroke-dasharray:" + (lk.infer === "cut" ? "2 5" : "5 3"), lk.infer === "cut" ? L("请求中止", "aborted") : "HTTP");
      var bm = [mid(box("B"), "right"), mid(box("mcp"), "left")];
      line(bm[0], bm[1], "stroke:" + (lk.B === "notify" ? "var(--viz-c2)" : "var(--viz-muted)") + ";stroke-width:1.2;stroke-dasharray:5 3", "stdio");
      if (lk.B === "notify") text(bm[1][0] + 70, bm[1][1] + 36, "notifications/cancelled", "font-size:10px;text-anchor:middle;fill:var(--viz-c2);font-family:var(--font-mono,monospace)");
      if (cmode === "proc") {
        var ca = mid(box("C"), "bottom"), cb = mid(box("sub"), "top");
        line(ca, cb, "stroke:var(--viz-muted);stroke-width:1.2;stroke-dasharray:" + (lk.C === "cut" ? "2 5" : "5 3"));
        text(ca[0] + 6, cb[1] - 3, lk.C === "cut" ? "Kill" : L("管道", "pipes"), "font-size:10px;fill:" + (lk.C === "cut" ? "var(--viz-c2)" : "var(--viz-muted)"));
      }
      // Nodes.
      var ids = ["client", "root", "loop", "eg", "infer", "A", "C", "B", "server", "mcp"];
      if (cmode === "proc") ids.push("sub");
      ids.forEach(function (id) {
        var b = box(id), s = st[id], c = COL[s[0]];
        var fill = s[0] === "off" ? "fill:var(--viz-fill)" : "fill:" + c + ";fill-opacity:" + (s[0] === "wait" ? ".08" : ".14");
        V.svg("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 6,
          style: fill + ";stroke:" + c + ";stroke-width:" + (s[0] === "stuck" ? 2 : 1.2) + (s[0] === "wait" || s[0] === "off" ? ";stroke-dasharray:4 3" : "") }, g);
        var title = id === "C" ? (cmode === "cgo" ? L("工具 C：cgo 调用", "Tool C: cgo call") : L("工具 C：子进程", "Tool C: subprocess")) : TITLE[id];
        text(b.x + 8, b.y + 17, title, "font-size:11.5px;font-weight:600");
        text(b.x + 8, b.y + 33, s[1], "font-size:10.5px;fill:" + (s[0] === "run" ? "var(--viz-muted)" : c));
        if (st._badge.indexOf(id) >= 0) {
          V.svg("circle", { cx: b.x + b.w - 9, cy: b.y + 9, r: 4.5, style: "fill:var(--viz-c2)" }, g);
        }
      });
      if (k === 0) text(mid(box("root"), "top")[0], 23, "ctx = r.Context()", "font-size:10px;text-anchor:middle;fill:var(--viz-muted);font-family:var(--font-mono,monospace)");
      // Legend.
      var items = [["run", L("运行中", "running")], ["wait", L("阻塞等待", "waiting")], ["done", L("已返回", "returned")],
        ["stuck", L("无法响应取消", "cannot respond")], ["badge", L("ctx 已取消", "ctx done")]];
      var ly = cmode === "proc" ? 366 : 310, lx = 8;
      root.setAttribute("viewBox", "0 0 720 " + (ly + 8));
      items.forEach(function (it) {
        if (it[0] === "badge") V.svg("circle", { cx: lx + 6, cy: ly - 4, r: 4.5, style: "fill:var(--viz-c2)" }, g);
        else V.svg("rect", { x: lx, y: ly - 10, width: 12, height: 12, rx: 3,
          style: "fill:" + COL[it[0]] + ";fill-opacity:.14;stroke:" + COL[it[0]] + (it[0] === "wait" ? ";stroke-dasharray:3 2" : "") }, g);
        text(lx + 17, ly, it[1], "font-size:11px;fill:var(--viz-muted)");
        lx += 17 + it[1].length * (V.lang === "en" ? 6.2 : 11) + 16;
      });
      var cap = L("第 " + k + " / " + (list.length - 1) + " 步", "stage " + k + " of " + (list.length - 1));
      text(712, ly, cap, "font-size:11px;text-anchor:end;fill:var(--viz-muted)");
      p.note.textContent = notesList[k];
      cancelBtn.disabled = k !== 0;
      nextBtn.disabled = k === 0 || k === list.length - 1;
    }

    function rebuild() { list = stages(cmode); notesList = notes(cmode); k = 0; draw(); }

    var cancelBtn = V.button(p.bar, L("取消（客户端断开）", "Cancel (client disconnects)"), function () { if (k === 0) { k = 1; draw(); } });
    var nextBtn = V.button(p.bar, L("下一步", "Next"), function () { if (k > 0 && k < list.length - 1) { k++; draw(); } });
    V.button(p.bar, L("重置", "Reset"), function () { k = 0; draw(); });
    V.select(p.bar, L("工具 C", "Tool C"), [
      { value: "cgo", label: L("阻塞在 cgo 调用中", "blocked in a cgo call") },
      { value: "proc", label: L("在子进程中运行", "runs in a subprocess") },
    ], "cgo", function (v) { cmode = v; rebuild(); });

    rebuild();
  });
})();
