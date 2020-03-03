var enabled = localStorage.getItem('dark-mode')
if (enabled === null) {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    enable(); document.getElementById("dark-mode-checkbox").checked = true;
  }
} else if (enabled === 'true') {
  enable(); document.getElementById("dark-mode-checkbox").checked = true;
}
function enable()  {
  DarkReader.enable({brightness: 100, contrast: 85, sepia: 10});
  localStorage.setItem('dark-mode', 'true');
}
function disable() {
  DarkReader.disable();
  localStorage.setItem('dark-mode', 'false')
}
function darkmode() {
  if (localStorage.getItem('dark-mode') === 'false') { enable(); } else { disable();}
}