/* LenderMapper shared page chrome: the phone menu panel. Loaded on every page. */
'use strict';
(() => {
  const panel = document.getElementById('menu'), openBtn = document.querySelector('[data-menu-open]');
  if (!panel || !openBtn) return;
  const focusables = () => [...panel.querySelectorAll('a[href], button')].filter(x => x.offsetParent !== null);
  const open = () => { panel.hidden = false; openBtn.setAttribute('aria-expanded', 'true'); document.body.style.overflow = 'hidden'; panel.querySelector('[data-menu-close]').focus(); };
  const close = () => { if (panel.hidden) return; panel.hidden = true; openBtn.setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; openBtn.focus(); };
  openBtn.addEventListener('click', open);
  panel.querySelector('[data-menu-close]').addEventListener('click', close);
  panel.addEventListener('click', e => { if (e.target.closest('nav a')) close(); });
  document.addEventListener('keydown', e => {
    if (panel.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(); if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  window.matchMedia('(min-width: 900px)').addEventListener('change', e => { if (e.matches) close(); });
})();
