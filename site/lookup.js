/* LenderMapper Lender lookup page: find a lender by name, list the matches, open one as a full profile (?id=). Shared code in core.js. */
'use strict';
const LK = { hits: [], sel: -1 };
const box = $('lsugg'), inp = $('lname');

function setExpanded(on) { box.hidden = !on; inp.setAttribute('aria-expanded', String(on)); if (!on) inp.removeAttribute('aria-activedescendant'); }
function showSuggest() {
  const q = inp.value;
  if (!q.trim() || !S.lenders.length) { setExpanded(false); return; }
  LK.hits = findLenders(q, 8); LK.sel = -1;
  box.innerHTML = LK.hits.length ? LK.hits.map((l, i) => `<li role="option" id="opt-${i}" aria-selected="false" data-id="${l.id}"><span class="t-product">${esc(nm(l))}</span>${typeTag(l)}${gradeTag(l)}<span class="small">${esc(l.ci)}, ${l.st} · ${money(l.ast, 0)} assets · ${l.nb} offices</span></li>`).join('')
    : '<li class="none" role="option" aria-disabled="true">No lender matches that name.</li>';
  setExpanded(true);
}
function moveSel(d) {
  const opts = [...box.querySelectorAll('[data-id]')]; if (!opts.length) return;
  LK.sel = (LK.sel + d + opts.length) % opts.length;
  opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === LK.sel)));
  inp.setAttribute('aria-activedescendant', opts[LK.sel].id); opts[LK.sel].scrollIntoView({ block: 'nearest' });
}

function showResults(q) {
  const hits = findLenders(q, 50);
  $('lk-res-h').textContent = `Matches for “${q}”`;
  $('lk-count').textContent = hits.length ? `${hits.length === 50 ? 'First 50' : hits.length} lender${hits.length === 1 ? '' : 's'}, largest first within each match type.` : 'No lender matches that name. Try fewer words, or the initials.';
  $('lk-rows').innerHTML = hits.map(l => `<tr><td><button type="button" class="row-link" data-id="${l.id}">${esc(nm(l))}</button></td><td>${typeText(l)}</td><td>${esc(l.ci)}, ${l.st}</td><td class="n">${fmtM(l.ast, 0)}</td><td class="n">${fmtI(l.nb)}</td><td>${gradeTag(l)} <span class="na">${l.total}/16</span></td></tr>`).join('');
  $('lk-results').hidden = false;
}

async function openProfile(id, push) {
  const l = S.byId[id]; if (!l) return;
  setExpanded(false); inp.value = nm(l);
  if (push) history.pushState({ id }, '', '?id=' + encodeURIComponent(id));
  document.title = `${nm(l)} · LenderMapper`;
  const p = $('lk-profile'); p.hidden = false;
  await renderLender(id, p, { links: `<a href="./?q=${encodeURIComponent(`${l.ci}, ${l.st}`)}">Lenders near ${esc(l.ci)} on the map</a>` });
  p.querySelector('.ld-name').setAttribute('tabindex', '-1');
  if (push) p.querySelector('.ld-name').focus();
}

inp.addEventListener('input', showSuggest);
inp.addEventListener('focus', showSuggest);
inp.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (box.hidden) showSuggest(); moveSel(e.key === 'ArrowDown' ? 1 : -1); }
  else if (e.key === 'Escape') setExpanded(false);
  else if (e.key === 'Enter' && LK.sel >= 0 && !box.hidden) { e.preventDefault(); openProfile(LK.hits[LK.sel].id, true); }
});
inp.addEventListener('blur', () => setTimeout(() => setExpanded(false), 150));
box.addEventListener('mousedown', e => { const o = e.target.closest('[data-id]'); if (o) { e.preventDefault(); openProfile(o.dataset.id, true); } });
$('lk-form').addEventListener('submit', e => {
  e.preventDefault(); const q = inp.value.trim(); if (!q) return;
  setExpanded(false); showResults(q); $('lk-profile').hidden = true;
  history.pushState({ q }, '', '?q=' + encodeURIComponent(q));
});
$('lk-rows').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) openProfile(b.dataset.id, true); });
document.querySelectorAll('a[href="lookup.html"]').forEach(a => a.addEventListener('click', e => { if (a.closest('.site-header')) { e.preventDefault(); inp.focus(); } }));

function fromUrl() {
  const p = new URLSearchParams(location.search), id = p.get('id'), q = p.get('q');
  if (id && S.byId[id]) { $('lk-results').hidden = true; openProfile(id, false); }
  else if (q) { inp.value = q; showResults(q); $('lk-profile').hidden = true; }
}
window.addEventListener('popstate', fromUrl);

loadData().then(() => {
  inp.disabled = false; $('lk-go').disabled = false;
  $('lk-help').textContent = `${S.lenders.length.toLocaleString('en-US')} lenders, call reports through ${S.meta.latest}. Pick from the list, or press Search to see every match.`;
  fromUrl();
}).catch(e => { $('lk-help').textContent = 'The lender data could not load (' + e.message + '). Try again later.'; console.error(e); });
