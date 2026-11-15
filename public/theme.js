// Applies the saved theme before first paint (kept out of index.html so the CSP needs no inline script).
try {
  var t = localStorage.getItem('btc.theme');
  if (t) document.documentElement.dataset.theme = JSON.parse(t);
} catch (e) {}
