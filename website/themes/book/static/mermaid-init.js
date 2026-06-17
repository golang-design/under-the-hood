// Mermaid theming for 《Go 语言原本》.
//
// Diagrams are themed from the book's live CSS tokens (see _reading.scss) using
// mermaid's `base` theme, so flowcharts, subgraphs, edge labels and arrows all
// match the warm-paper / Go-blue surface instead of mermaid's stock palette.
// Because the tokens swap for light/dark, we re-render every diagram when the
// reader toggles the theme (dark.js adds/removes `.dark` on <html>).
(function () {
  if (typeof mermaid === "undefined") return;

  function token(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    v = (v || "").trim();
    return v || fallback;
  }

  // Map the book's design tokens onto mermaid's theme variables. The cluster
  // and edge-label entries matter: without them the subgraph box and the 是/否
  // labels keep mermaid's stock yellow/white and clash in dark mode.
  function themeVariables() {
    var surface = token("--surface", "#f7f4ee");
    var bg = token("--bg", "#ece8df");
    var fg = token("--fg", "#232019");
    var muted = token("--fg-muted", "#6a6256");
    var accent = token("--accent", "#007d9c");
    var border = token("--border-strong", "rgba(35,32,25,0.18)");
    return {
      darkMode: document.documentElement.classList.contains("dark"),
      background: surface,
      fontFamily: "inherit",
      primaryColor: surface,
      primaryBorderColor: accent,
      primaryTextColor: fg,
      secondaryColor: bg,
      secondaryBorderColor: border,
      secondaryTextColor: fg,
      tertiaryColor: bg,
      tertiaryBorderColor: border,
      tertiaryTextColor: fg,
      mainBkg: surface,
      nodeBorder: accent,
      nodeTextColor: fg,
      lineColor: muted,
      textColor: fg,
      titleColor: fg,
      clusterBkg: bg,
      clusterBorder: border,
      edgeLabelBackground: surface,
      labelBackground: surface,
      labelBoxBorderColor: border,
      labelTextColor: fg
    };
  }

  function init() {
    var blocks = [].slice.call(document.querySelectorAll("pre.mermaid"));
    if (!blocks.length) return;

    // Stash the original definition once. innerHTML keeps <br/> line breaks in
    // node labels, which textContent would flatten away on re-render.
    blocks.forEach(function (el) {
      if (el.getAttribute("data-src") === null) {
        el.setAttribute("data-src", el.innerHTML);
      }
    });

    // Serialize renders so a theme toggle mid-render can't overlap (mermaid.run
    // is async). Each call enqueues exactly one re-render.
    var chain = Promise.resolve();
    function render() {
      chain = chain
        .then(function () {
          mermaid.initialize({
            startOnLoad: false,
            theme: "base",
            themeVariables: themeVariables(),
            securityLevel: "strict",
            fontFamily: "inherit",
            flowchart: { htmlLabels: true, useMaxWidth: true }
          });
          blocks.forEach(function (el) {
            el.removeAttribute("data-processed");
            el.innerHTML = el.getAttribute("data-src");
          });
          return mermaid.run({ nodes: blocks });
        })
        .catch(function () {});
    }

    render();

    // Re-render only when the dark/light state actually flips.
    var prevDark = document.documentElement.classList.contains("dark");
    new MutationObserver(function () {
      var dark = document.documentElement.classList.contains("dark");
      if (dark === prevDark) return;
      prevDark = dark;
      render();
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"]
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
