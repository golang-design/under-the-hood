// CSS-based dark mode toggle.
// The `.dark` class is applied to <html> as early as possible by an inline
// script in the page <head> (see partials/zh-cn/html-head.html) to avoid a
// flash of the light theme; this file only keeps the checkbox in sync and
// handles user toggles. The actual colours live in assets/_custom.scss.
(function () {
  var KEY = "dark-mode";
  var root = document.documentElement;

  function persisted() {
    var s = localStorage.getItem(KEY);
    if (s === null) {
      return window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return s === "true";
  }

  function apply(on) {
    if (on) root.classList.add("dark");
    else root.classList.remove("dark");
  }

  // Keep the checkbox in sync with the (already applied) state.
  function syncCheckbox() {
    var cb = document.getElementById("dark-mode-checkbox");
    if (cb) cb.checked = root.classList.contains("dark");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncCheckbox);
  } else {
    syncCheckbox();
  }

  // Invoked by the checkbox's onchange handler.
  window.darkmode = function () {
    var cb = document.getElementById("dark-mode-checkbox");
    var on = cb ? cb.checked : !root.classList.contains("dark");
    apply(on);
    localStorage.setItem(KEY, on ? "true" : "false");
  };

  // Safety net in case the early head script did not run.
  apply(persisted());
})();
