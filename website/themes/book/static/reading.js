// Reading experience enhancements for 《Go 语言原本》.
//
// Progressive enhancement only: every feature degrades gracefully when JS is
// off (the page already reads fine; CSS carries the static look). This file is
// loaded `defer` so the DOM is parsed before it runs.
(function () {
  "use strict";

  var article = document.querySelector("article.markdown");
  var html = document.documentElement;
  var SM = 1280; // matches $sm-breakpoint (80rem); below this the sidebar overlays

  // A single rAF-throttled scroll dispatcher shared by the scroll-driven
  // features (scroll-spy, progress bar, back-to-top).
  var scrollFns = [];
  function onScroll(fn) { scrollFns.push(fn); }
  (function () {
    var ticking = false;
    function run() {
      ticking = false;
      for (var i = 0; i < scrollFns.length; i++) scrollFns[i]();
    }
    window.addEventListener(
      "scroll",
      function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(run);
      },
      { passive: true }
    );
  })();

  // --- Foldable sidebar + floating TOC ----------------------------------
  function sidebarOpen() {
    var a = html.getAttribute("data-sidebar");
    if (a === "open") return true;
    if (a === "closed") return false;
    return window.innerWidth > SM; // default: open on desktop, closed on mobile
  }
  function setSidebar(open) {
    html.setAttribute("data-sidebar", open ? "open" : "closed");
    var btn = document.getElementById("fold-sidebar");
    if (btn) btn.classList.toggle("is-active", !open); // highlight when folded
    try { localStorage.setItem("reading.sidebar", open ? "open" : "closed"); } catch (e) {}
  }
  function tocOpen() {
    return html.getAttribute("data-toc") === "open";
  }
  function setToc(open) {
    html.setAttribute("data-toc", open ? "open" : "closed");
    var btn = document.getElementById("fold-toc");
    if (btn) btn.classList.toggle("is-active", open); // highlight when open
    try { localStorage.setItem("reading.toc", open ? "open" : "closed"); } catch (e) {}
  }

  function setupFolds() {
    // Restore: sidebar only on desktop (mobile always starts closed); TOC
    // only when explicitly opened before.
    try {
      var s = localStorage.getItem("reading.sidebar");
      if (s && window.innerWidth > SM) html.setAttribute("data-sidebar", s);
      if (localStorage.getItem("reading.toc") === "open") html.setAttribute("data-toc", "open");
    } catch (e) {}

    var sb = document.getElementById("fold-sidebar");
    if (sb) {
      sb.classList.toggle("is-active", !sidebarOpen());
      sb.addEventListener("click", function () { setSidebar(!sidebarOpen()); });
    }
    var tc = document.getElementById("fold-toc");
    if (tc) {
      tc.classList.toggle("is-active", tocOpen());
      tc.addEventListener("click", function () { setToc(!tocOpen()); });
    }
  }

  // --- Scroll-spy: highlight the current section in the TOC --------------
  function setupScrollSpy() {
    var toc = document.querySelector(".book-toc");
    if (!toc) return;
    var links = toc.querySelectorAll('a[href^="#"]');
    if (!links.length) return;
    var map = [];
    Array.prototype.forEach.call(links, function (a) {
      var id;
      try { id = decodeURIComponent(a.getAttribute("href").slice(1)); } catch (e) { return; }
      var el = id && document.getElementById(id);
      if (el) map.push({ a: a, el: el });
    });
    if (!map.length) return;

    function update() {
      var active = map[0];
      for (var i = 0; i < map.length; i++) {
        if (map[i].el.getBoundingClientRect().top - 120 <= 0) active = map[i];
      }
      for (var j = 0; j < map.length; j++) {
        map[j].a.classList.toggle("toc-active", map[j] === active);
      }
    }
    onScroll(update);
    update();
  }

  // --- Code blocks: header bar (language + copy button) ------------------
  // Hugo emits `div.highlight > div.chroma > table.lntable` with a line-number
  // gutter column and a code column. We wrap each block in a card and prepend a
  // bar; copy pulls the code column's text only (never the line numbers).
  function enhanceCodeBlocks() {
    if (!article) return;
    var blocks = article.querySelectorAll("div.highlight");
    Array.prototype.forEach.call(blocks, function (hl) {
      if (hl.parentNode && hl.parentNode.classList.contains("reading-code")) return;

      var wrap = document.createElement("div");
      wrap.className = "reading-code";
      hl.parentNode.insertBefore(wrap, hl);
      wrap.appendChild(hl);

      var bar = document.createElement("div");
      bar.className = "reading-codebar";

      var code = hl.querySelector("code[data-lang]");
      var lang = code ? code.getAttribute("data-lang") : "";
      var label = document.createElement("span");
      label.className = "reading-codelang";
      label.textContent = lang || "";
      bar.appendChild(label);

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "reading-copy";
      btn.setAttribute("aria-label", "复制代码");
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>' +
        "<span>复制</span>";
      bar.appendChild(btn);

      wrap.insertBefore(bar, hl);

      btn.addEventListener("click", function () {
        var cells = hl.querySelectorAll("table.lntable td");
        var src = cells.length ? cells[cells.length - 1] : hl.querySelector("pre");
        var text = src ? src.innerText : "";
        var done = function () {
          btn.classList.add("is-copied");
          var span = btn.querySelector("span");
          if (span) span.textContent = "已复制";
          setTimeout(function () {
            btn.classList.remove("is-copied");
            if (span) span.textContent = "复制";
          }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () {});
        } else {
          try {
            var ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            done();
          } catch (e) {}
        }
      });
    });
  }

  // --- Reading progress bar ---------------------------------------------
  function setupProgress() {
    var bar = document.getElementById("reading-progress-bar");
    if (!bar) return;
    function update() {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.width = p * 100 + "%";
    }
    onScroll(update);
    update();
  }

  // --- Font scaling (A- / A+), persisted --------------------------------
  function setupFontScale() {
    var KEY = "reading.fontScale";
    function clamp(v) { return Math.max(0.85, Math.min(1.32, v)); }
    var scale = 1;
    try {
      var stored = parseFloat(localStorage.getItem(KEY));
      if (!isNaN(stored)) scale = clamp(stored);
    } catch (e) {}
    function apply() { html.style.setProperty("--reading-scale", String(scale)); }
    apply();
    function bump(d) {
      scale = clamp(Math.round((scale + d) * 100) / 100);
      apply();
      try { localStorage.setItem(KEY, String(scale)); } catch (e) {}
    }
    var dec = document.getElementById("font-smaller");
    var inc = document.getElementById("font-bigger");
    if (dec) dec.addEventListener("click", function () { bump(-0.08); });
    if (inc) inc.addEventListener("click", function () { bump(0.08); });
  }

  // --- Chapter meta: reading time + 字数 --------------------------------
  function setupMeta() {
    if (!article) return;
    var h1 = article.querySelector("h1");
    if (!h1 || article.querySelector(".reading-meta")) return;
    var text = article.innerText || "";
    var chars = text.replace(/\s+/g, "").length;
    if (!chars) return;
    var mins = Math.max(1, Math.round(chars / 430));
    var el = document.createElement("div");
    el.className = "reading-meta";
    el.innerHTML =
      '<span class="rm-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>约 ' +
      mins +
      " 分钟</span>" +
      '<span class="rm-item">' +
      chars.toLocaleString() +
      " 字</span>";
    h1.parentNode.insertBefore(el, h1.nextSibling);
  }

  // --- Back-to-top FAB --------------------------------------------------
  function setupFab() {
    var fab = document.createElement("button");
    fab.type = "button";
    fab.className = "reading-fab";
    fab.setAttribute("aria-label", "返回顶部");
    fab.title = "返回顶部";
    fab.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    fab.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    document.body.appendChild(fab);
    function update() { fab.classList.toggle("is-visible", window.scrollY > 80); }
    onScroll(update);
    update();
  }

  function init() {
    setupMeta(); // before code enhancement so copy labels aren't counted
    enhanceCodeBlocks();
    setupFolds();
    setupScrollSpy();
    setupProgress();
    setupFontScale();
    setupFab();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
