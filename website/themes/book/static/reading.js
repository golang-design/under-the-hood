// Reading experience enhancements for 《Go 语言原本》.
//
// Progressive enhancement only: every feature degrades gracefully when JS is
// off (the page already reads fine; CSS carries the static look). This file is
// loaded `defer` so the DOM is parsed before it runs.
(function () {
  "use strict";

  var article = document.querySelector("article.markdown");

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

  function init() {
    enhanceCodeBlocks();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
