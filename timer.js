/* Cronometro sempre visibile in basso: START / PAUSA / RESET. */
(function () {
  var acc = 0, t0 = 0, run = false, raf = 0, lock = null;
  var css = document.createElement('style');
  css.textContent =
    'body{padding-bottom:calc(76px + env(safe-area-inset-bottom))}' +
    '#cr{position:fixed;left:0;right:0;bottom:0;z-index:50;background:var(--surface);border-top:1px solid var(--line);box-shadow:0 -4px 16px rgba(10,106,153,.12);padding:8px max(12px,env(safe-area-inset-right)) calc(8px + env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));display:flex;align-items:center;gap:8px;justify-content:center}' +
    '#cr .dg{font:700 34px/1 var(--f-display);letter-spacing:.02em;font-variant-numeric:tabular-nums;color:var(--ink);min-width:98px;text-align:center}' +
    '#cr.on .dg{color:var(--accent-text)}' +
    '#cr button{min-height:44px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:700 14px system-ui,sans-serif;letter-spacing:.04em}' +
    '#cr .go{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);min-width:84px}';
  document.head.appendChild(css);
  var el = document.createElement('div');
  el.id = 'cr';
  el.innerHTML = '<div class="dg" id="crd">00:00.0</div>' +
    '<button class="go" id="crg">START</button><button id="crp">PAUSA</button><button id="crr">RESET</button>';
  document.body.appendChild(el);
  var $ = function (i) { return document.getElementById(i); };
  function ms() { return acc + (run ? Date.now() - t0 : 0); }
  function fmt(v) {
    var s = Math.floor(v / 1000), m = Math.floor(s / 60), d = Math.floor(v / 100) % 10;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(m) + ':' + p(s % 60) + '.' + d;
  }
  function paint() {
    $('crd').textContent = fmt(ms());
    el.className = run ? 'on' : '';
    $('crg').textContent = (!run && acc) ? 'RIPRENDI' : 'START';
  }
  function loop() { paint(); if (run) raf = requestAnimationFrame(loop); }
  function keep(on) {
    try {
      if (on && navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {});
      else if (lock) { lock.release(); lock = null; }
    } catch (e) {}
  }
  $('crg').onclick = function () { if (run) return; run = true; t0 = Date.now(); keep(true); loop(); };
  $('crp').onclick = function () { if (!run) return; acc += Date.now() - t0; run = false; cancelAnimationFrame(raf); keep(false); paint(); };
  $('crr').onclick = function () { run = false; acc = 0; cancelAnimationFrame(raf); keep(false); paint(); };
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { if (run) { keep(true); loop(); } else paint(); } });
  paint();
})();
