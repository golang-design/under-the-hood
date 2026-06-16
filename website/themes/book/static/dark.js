// Three-state theme control: LIGHT / DARK / AUTO.
//
// The chosen preference is stored in localStorage under "theme" as one of
// "light", "dark" or "auto". "auto" follows the OS (prefers-color-scheme) and
// is the default when the user has never chosen. The `.dark` class on <html>
// is applied as early as possible by an inline script in the page <head> (see
// partials/zh-cn/html-head.html) to avoid a flash of the light theme; this
// file keeps the segmented control in sync, reacts to user clicks, and (when
// in "auto") reacts live to system theme changes. Colours live in
// assets/_custom.scss.
(function () {
  var KEY = "theme";
  var root = document.documentElement;
  var mql = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

  function pref() {
    var s = localStorage.getItem(KEY);
    return s === "light" || s === "dark" || s === "auto" ? s : "auto";
  }

  // Resolve a preference to an effective dark/light boolean.
  function isDark(p) {
    if (p === "dark") return true;
    if (p === "light") return false;
    return !!(mql && mql.matches); // auto
  }

  function applyClass(p) {
    if (isDark(p)) root.classList.add("dark");
    else root.classList.remove("dark");
  }

  // Reflect the current preference on the segmented control: mark the active
  // option and expose it for assistive tech via aria-checked.
  function syncControl() {
    var p = pref();
    var group = document.getElementById("theme-switch");
    if (!group) return;
    var opts = group.querySelectorAll("[data-theme]");
    for (var i = 0; i < opts.length; i++) {
      var on = opts[i].getAttribute("data-theme") === p;
      opts[i].setAttribute("aria-checked", on ? "true" : "false");
      opts[i].classList.toggle("active", on);
    }
  }

  function set(p) {
    localStorage.setItem(KEY, p);
    applyClass(p);
    syncControl();
  }

  // Public entry point used by the control's buttons.
  window.setTheme = function (p) {
    if (p !== "light" && p !== "dark" && p !== "auto") p = "auto";
    set(p);
  };

  // When in "auto", track live OS theme changes.
  function onSystemChange() {
    if (pref() === "auto") applyClass("auto");
  }
  if (mql) {
    if (mql.addEventListener) mql.addEventListener("change", onSystemChange);
    else if (mql.addListener) mql.addListener(onSystemChange); // older Safari
  }

  // Safety net + control sync once the DOM is ready.
  function init() {
    applyClass(pref());
    syncControl();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
