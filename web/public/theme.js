// Applies a saved theme before first paint, so dark-mode visitors don't see a light flash.
// A separate file rather than an inline script, so the Content Security Policy can forbid inline code.
try {
  var t = localStorage.getItem('ps5-tracker-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
