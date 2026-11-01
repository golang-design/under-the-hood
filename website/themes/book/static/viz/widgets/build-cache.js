/*
 * build-cache: how `go build` decides what to redo (book §3.1.4).
 *
 * The graph is the `cut` module from the text: greet.go -> compile cut/greet,
 * main.go -> compile main, both plus the standard library -> link hello.
 * Keys follow cmd/go/internal/work: a compile step's action ID hashes its own
 * source files, the Go version and the *content IDs* (output hashes) of what
 * it imports; its content ID hashes its output. A comment edit changes the
 * action ID of greet but not its output, so main's key is unchanged and the
 * redo stops there. Compile outputs stay in the cache under every key ever
 * seen; the executable is not cached, it is only compared against the build
 * ID stored in the existing `hello` file. A parallel timestamp model shows
 * what a make-style "older than a prerequisite" rule would redo.
 * The hashes are illustrative (FNV-1a), not real Go build IDs.
 */
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;

  function h(s) {
    var x = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return ("00000000" + x.toString(16)).slice(-8).slice(0, 6);
  }
  var VERS = ["go1.26.10", "go1.27.3"];

  var EDITS = [
    { value: "comment", label: L("改 greet.go 的注释", "Edit a comment in greet.go") },
    { value: "body", label: L("改 Hello 的函数体", "Edit the body of Hello") },
    { value: "touch", label: L("touch greet.go（只改修改时间）", "touch greet.go (mtime only)") },
    { value: "revert", label: L("把 greet.go 改回最初的样子", "Revert greet.go to the original") },
    { value: "none", label: L("什么也不改", "Change nothing") },
    { value: "version", label: L("换一个 Go 版本", "Switch Go version") },
  ];

  // Box geometry (viewBox 720 x 384).
  var B = {
    greetgo: { x: 25, y: 260, w: 210, h: 66 },
    maingo: { x: 265, y: 260, w: 210, h: 66 },
    greet: { x: 25, y: 136, w: 210, h: 76 },
    main: { x: 265, y: 136, w: 210, h: 76 },
    std: { x: 505, y: 136, w: 190, h: 76 },
    link: { x: 265, y: 22, w: 210, h: 62 },
  };

  V.register("build-cache", function (host) {
    var p = V.panel(host, { title: L("构建缓存：键由输入算出，往上传的是产物的指纹", "The build cache: keys come from inputs, and outputs' fingerprints flow upward") });
    var root = V.svg("svg", { viewBox: "0 0 720 384", role: "img",
      "aria-label": L("cut 模块的构建步骤与缓存键", "Build steps and cache keys of the cut module") }, p.stage);
    var defs = V.svg("defs", null, root);
    ["line", "c2"].forEach(function (k) {
      var m = V.svg("marker", { id: "bc-arrow-" + k, viewBox: "0 0 10 10", refX: 9, refY: 5,
        markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
      V.svg("path", { d: "M0,0 L10,5 L0,10 z",
        style: "fill:" + (k === "c2" ? "var(--viz-c2)" : "var(--viz-muted)") }, m);
    });
    var gEdges = V.svg("g", null, root), gNodes = V.svg("g", null, root), gText = V.svg("g", null, root);

    var edit = "comment", st;

    function ids() {
      var v = VERS[st.ver];
      var gFile = h("greet.go|" + st.comment + "|" + st.body);
      var mFile = h("main.go|0");
      var stdA = h("A|std|" + v), stdC = h("C|std|" + v);
      var gA = h("A|greet|" + v + "|" + gFile);
      var gC = h("C|greet|" + v + "|" + st.body);           // comments never reach the output
      var mA = h("A|main|" + v + "|" + mFile + "|" + gC + "|" + stdC);
      var mC = h("C|main|" + v + "|" + st.body);            // Hello is inlined into main
      var lA = h("A|link|" + v + "|" + mC + "|" + gC + "|" + stdC);
      return { gFile: gFile, mFile: mFile, stdA: stdA, stdC: stdC, gA: gA, gC: gC, mA: mA, mC: mC, lA: lA };
    }

    // One build: compile steps consult the cache, link compares with hello's stored ID;
    // the make model compares modification times.
    function build() {
      var I = ids(), prev = st.ids, run = {};
      run.std = !st.cache[I.stdA]; st.cache[I.stdA] = I.stdC;
      run.greet = !st.cache[I.gA]; st.cache[I.gA] = I.gC;
      run.main = !st.cache[I.mA]; st.cache[I.mA] = I.mC;
      run.link = st.hello !== I.lA; st.hello = I.lA;
      var ch = {};
      if (prev) Object.keys(I).forEach(function (k) { ch[k] = prev[k] !== I[k]; });
      // make: rebuild a target that is older than any prerequisite.
      var t = st.mt, mk = {};
      function stale(target, deps) {
        if (t[target] == null) return true;
        return deps.some(function (d) { return t[d] > t[target]; });
      }
      mk.greet = stale("greet.a", ["greet.go"]); if (mk.greet) t["greet.a"] = ++st.clock;
      mk.main = stale("main.a", ["main.go", "greet.a"]); if (mk.main) t["main.a"] = ++st.clock;
      mk.link = stale("hello", ["main.a", "greet.a"]); if (mk.link) t.hello = ++st.clock;
      st.ids = I; st.run = run; st.ch = ch; st.mk = mk; st.builds++;
    }

    function reset() {
      st = { ver: 0, comment: 0, body: 0, cache: {}, hello: null, ids: null, run: {}, ch: {}, mk: {},
        clock: 2, mt: { "greet.go": 1, "main.go": 1 }, builds: 0 };
      build();
      st.first = true;
      draw();
      p.note.textContent = L(
        "这是第一次构建：缓存是空的，标准库、greet、main 都要编译，再链接出 hello。在下拉框里选一种改动，点「构建」。",
        "This is the first build: the cache is empty, so the standard library, greet and main are compiled and hello is linked. Pick a change and press Build.");
    }

    function apply(e) {
      var before = st.mt["greet.go"];
      st.verCh = e === "version";
      if (e === "comment") { st.comment++; st.mt["greet.go"] = ++st.clock; }
      else if (e === "body") { st.body++; st.mt["greet.go"] = ++st.clock; }
      else if (e === "touch") { st.mt["greet.go"] = ++st.clock; }
      else if (e === "revert") {
        if (st.comment || st.body) { st.comment = 0; st.body = 0; st.mt["greet.go"] = ++st.clock; }
      } else if (e === "version") { st.ver ^= 1; }
      st.mtCh = st.mt["greet.go"] !== before;
    }

    function names(r) {
      var out = [];
      if (r.std) out.push(L("编译 58 个标准库包", "compile 58 std packages"));
      if (r.greet) out.push(L("编译 greet", "compile greet"));
      if (r.main) out.push(L("编译 main", "compile main"));
      if (r.link) out.push(L("链接", "link"));
      return out.length ? out.join(L("、", ", ")) : L("什么也不做", "nothing");
    }

    function narrate(e) {
      var r = st.run, c = st.ch, I = st.ids, s = [];
      if (e === "touch") s.push(L("touch 只改了修改时间，greet.go 的内容哈希没变，所有键都没变。",
        "touch only changed the modification time; greet.go's content hash, and so every key, is unchanged."));
      if (e === "none") s.push(L("输入没变，键没变。", "No input changed, so no key changed."));
      if (e === "version") s.push(r.std
        ? L("Go 版本是每个键的一部分。换了版本，所有键都变了，连标准库也要重新编译；文件的修改时间却一个都没变。",
            "The Go version is part of every key. Switching it changes all keys, the standard library included, while no file's modification time changed. ")
        : L("换回了以前用过的版本，所有键都回到了当时的值，编译全部命中缓存；可执行文件不在缓存里，要重新链接。",
            "Back to a version used before: every key is one the cache has seen, so all compiles hit; the executable is not cached, so it links again. "));
      if (e === "comment" || e === "body" || (e === "revert" && c.gFile)) {
        s.push(L("greet.go 的内容变了，编译 greet 的键变成 " + I.gA + "。",
          "greet.go changed, so the key of compile greet is now " + I.gA + ". "));
        s.push(r.greet ? L("缓存里没有这个键，重新编译。", "It is not in the cache: compile. ")
          : L("这个键在缓存里有（之前构建过同样的内容），直接取出产物。", "That key is already in the cache (this content was built before), so the output is reused. "));
        if (!c.gC) s.push(L("注释不进产物，greet 的 content ID 仍是 " + I.gC + "，所以编译 main 的键没变，重做在这里停住。",
          "Comments do not reach the output: greet's content ID is still " + I.gC + ", so main's key is unchanged and the redo stops here. "));
        else s.push(L("greet 的产物变了（content ID " + I.gC + "），Hello 又被内联进了 main，所以 main 的键和链接的键都跟着变。",
          "greet's output changed (content ID " + I.gC + "), and Hello is inlined into main, so main's key and the link key change too. "));
      } else if (e === "revert") s.push(L("greet.go 已经是最初的样子。", "greet.go is already the original."));
      if (r.link && e === "revert" && !r.greet && !r.main) s.push(L("编译都命中了缓存，但 go build 不缓存可执行文件，现有的 hello 是上一次构建的，所以重新链接。",
        "Every compile hit the cache, but go build does not cache executables and the current hello is from the previous build, so it links again."));
      s.push(L("本次实际执行：" + names(r) + "。按修改时间判断的 make 会执行：" + mkNames() + "。",
        " This build ran: " + names(r) + ". A timestamp rule (make) would run: " + mkNames() + "."));
      return s.join("");
    }
    function mkNames() {
      var m = st.mk, out = [];
      if (m.greet) out.push(L("编译 greet", "compile greet"));
      if (m.main) out.push(L("编译 main", "compile main"));
      if (m.link) out.push(L("链接", "link"));
      return out.length ? out.join(L("、", ", ")) : L("什么也不做", "nothing");
    }

    function arrow(d, hot) {
      V.svg("path", { d: d, "marker-end": "url(#bc-arrow-" + (hot ? "c2" : "line") + ")",
        style: "fill:none;stroke-width:" + (hot ? 2 : 1.2) + ";stroke:" + (hot ? "var(--viz-c2)" : "var(--viz-line)") }, gEdges);
    }

    function node(k, title, lines, status, statusColor) {
      var b = B[k], ran = statusColor === "var(--viz-c1)", hit = statusColor === "var(--viz-c3)";
      var c = ran ? "var(--viz-c1)" : hit ? "var(--viz-c3)" : "var(--viz-line)";
      V.svg("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 6,
        style: "fill:" + (ran || hit ? c : "var(--viz-fill)") + ";fill-opacity:" + (ran || hit ? 0.14 : 1) +
          ";stroke:" + c + ";stroke-width:" + (ran ? 2 : 1.2) }, gNodes);
      V.svg("text", { x: b.x + 10, y: b.y + 19, style: "font-size:12px;font-weight:600", text: title }, gNodes);
      if (status) V.svg("text", { x: b.x + b.w - 8, y: b.y + 19, "text-anchor": "end",
        style: "font-size:11px;font-weight:600;fill:" + statusColor, text: status }, gNodes);
      lines.forEach(function (ln, i) {
        var y = b.y + 38 + i * 17;
        var t = V.svg("text", { x: b.x + 10, y: y, style: "font-size:11.5px;font-family:var(--font-mono,monospace)" }, gNodes);
        V.svg("tspan", { style: "fill:var(--viz-muted)", text: ln[0] + " " }, t);
        V.svg("tspan", { style: ln[2] ? "fill:var(--viz-c2);font-weight:600" : ln[3] ? "fill:var(--viz-c4);font-weight:600" : "", text: ln[1] }, t);
        if (ln[2] || ln[3]) V.svg("text", { x: b.x + b.w - 8, y: y, "text-anchor": "end",
          style: "font-size:11px;fill:var(--viz-" + (ln[2] ? "c2" : "c4") + ")", text: ln[2] ? L("变了", "changed") : L("更新了", "updated") }, gNodes);
      });
    }

    function draw() {
      [gEdges, gNodes, gText].forEach(function (g) { while (g.firstChild) g.removeChild(g.firstChild); });
      var I = st.ids, c = st.ch, r = st.run, first = st.first;
      var RUN = "var(--viz-c1)", HIT = "var(--viz-c3)", IDLE = "var(--viz-muted)";

      // Edges carry fingerprints upward; red when the carried value changed in this build.
      arrow("M130,260 L130,214", c.gFile);
      arrow("M370,260 L370,214", c.mFile);
      arrow("M235,174 L263,174", c.gC);
      arrow("M505,174 L477,174", c.stdC);
      arrow("M370,136 L370,86", c.mC);
      arrow("M130,136 C130,70 190,53 263,53", c.gC);
      arrow("M600,136 C600,70 545,53 477,53", c.stdC);

      node("greetgo", "greet/greet.go", [[L("内容哈希", "content"), I.gFile, c.gFile],
        [L("修改时间", "mtime"), "t" + st.mt["greet.go"], false, !st.first && st.mtCh]], "", IDLE);
      node("maingo", "main.go", [[L("内容哈希", "content"), I.mFile, c.mFile],
        [L("修改时间", "mtime"), "t" + st.mt["main.go"], false]], "", IDLE);
      node("greet", L("编译 cut/greet", "compile cut/greet"),
        [["action ID ", I.gA, c.gA], ["content ID", I.gC, c.gC]],
        r.greet ? L("执行", "run") : L("命中缓存", "cache hit"), r.greet ? RUN : HIT);
      node("main", L("编译 main", "compile main"),
        [["action ID ", I.mA, c.mA], ["content ID", I.mC, c.mC]],
        r.main ? L("执行", "run") : L("命中缓存", "cache hit"), r.main ? RUN : HIT);
      node("std", L("fmt 等 58 个包", "fmt and 57 more"),
        [["action ID ", I.stdA, c.stdA], ["content ID", I.stdC, c.stdC]],
        r.std ? L("执行", "run") : L("命中缓存", "cache hit"), r.std ? RUN : HIT);
      node("link", L("链接 → hello", "link → hello"),
        [["action ID ", I.lA, c.lA]],
        r.link ? L("执行", "run") : L("hello 已是最新", "hello up to date"), r.link ? RUN : HIT);
      V.svg("text", { x: 25, y: 40, style: "font-size:12px;fill:var(--viz-muted)", text: L("Go 版本", "Go version") }, gText);
      V.svg("text", { x: 25, y: 58, style: "font-size:12px;font-family:var(--font-mono,monospace)" +
        (!first && st.verCh ? ";fill:var(--viz-c2);font-weight:600" : ""), text: VERS[st.ver] + (!first && st.verCh ? L("（变了）", " (changed)") : "") }, gText);

      var y0 = 352;
      V.svg("text", { x: 25, y: y0, style: "font-size:12px", text:
        L("go build 本次执行：", "go build ran: ") + (first ? L("全部（第一次构建）", "everything (first build)") : names(r)) }, gText);
      V.svg("text", { x: 25, y: y0 + 20, style: "font-size:12px;fill:var(--viz-muted)", text:
        L("make（按修改时间）会执行：", "make (by mtime) would run: ") + (first ? L("全部", "everything") : mkNames()) }, gText);
      V.svg("text", { x: 695, y: y0 + 20, "text-anchor": "end", style: "font-size:11px;fill:var(--viz-muted)",
        text: L("哈希为示意值", "hashes are illustrative") }, gText);
    }

    V.select(p.bar, L("改动", "Change"), EDITS, edit, function (v) { edit = v; });
    V.button(p.bar, L("构建", "Build"), function () {
      apply(edit); st.first = false; build(); draw(); p.note.textContent = narrate(edit);
    });
    V.button(p.bar, L("重置（清空缓存）", "Reset (empty cache)"), reset);

    reset();
  });
})();
