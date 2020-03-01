var enabled = false
if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  enabled = true; enable(); document.getElementById("dark-mode-checkbox").checked = true;
}
function enable()  {DarkReader.enable({brightness: 100, contrast: 85, sepia: 10});}
function disable() {DarkReader.disable();}
function darkmode() {
  if (!enabled) { enable(); enabled = true;} else { disable(); enabled = false;}
}