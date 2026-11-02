// Sidebar and "on this page" toggles, and scroll-spy for the latter.
//
// Progressive enhancement only: without JS the page still reads fine. Loaded
// `defer` so the DOM is parsed before it runs.
(function () {
  "use strict";

  var html = document.documentElement;
  var SM = 1280; // matches $sm-breakpoint (80rem); below this the sidebar overlays

  // A single rAF-throttled scroll dispatcher.
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

  // --- Foldable sidebar + "on this page" panel ---------------------------
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

  function init() {
    setupFolds();
    setupScrollSpy();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
