/* LenderMapper Map search page. Shared data code (loading, scoring, lender details, dialogs) is in core.js. */
'use strict';

/* ---------------- columns (CSV download) ---------------- */
const COLS = [
  { k: 'grade', l: 'Grade' }, { k: 'total', l: 'Points (4-16)' }, { k: 'n', l: 'Lender' }, { k: 'c', l: 'Type' }, { k: 'hq', l: 'HQ' }, { k: 'dist', l: 'HQ mi' }, { k: 'nbr', l: 'Branches near' },
  { k: 'dep', l: 'Deposits $M' }, { k: 'ast', l: 'Assets $M' }, { k: 'ltd', l: 'Loan/Dep' }, { k: 't1', l: 'Tier 1 lev' }, { k: 'nwr', l: 'Net worth' }, { k: 'fc', l: 'Funding cost' }, { k: 'nim', l: 'NIM' },
  { k: 'crecap', l: 'Inv. CRE / capital' }, { k: 'oocap', l: 'OO CRE / capital' }, { k: 'inv', l: 'Inv. CRE $M' }, { k: 'oo', l: 'OO CRE $M' }, { k: 'cre', l: 'Total CRE $M' },
  { k: 'mom', l: 'CRE growth 4Q' }, { k: 'chg', l: 'CRE lent YTD $M' }, { k: 'granted', l: 'CRE granted YTD $M' }, { k: 'avgloan', l: 'Avg loan $M' }, { k: 'brok', l: 'Brokered / non-mbr' },
  { k: 'head', l: 'Cap headroom $M' }, { k: 'mblused', l: 'MBL cap used' }, { k: 'rate', l: 'CRE rate' }, { k: 'yield', l: 'Loan yield' }, { k: 'npl', l: 'NPL' }, { k: 'crenpl', l: 'CRE NPL' },
  { k: 'roa', l: 'ROA' }, { k: 'limit', l: 'Lending limit $M' }, { k: 'nb', l: 'Branches' },
];

/* ---------------- load ---------------- */
async function load() {
  await loadData();
  if (CFG.offline) { $('csv').hidden = true; $('addr').placeholder = 'ZIP code, e.g. 60606'; $('addr-result').textContent = 'Preview build: enter a 5-digit ZIP or click the map to drop a pin. The hosted site accepts full street addresses and shows a street basemap.'; }
  $('asof').textContent = 'Updated ' + quarterLabel(S.meta.latest);
  renderPlacements();
  const q = new URLSearchParams(location.search).get('q'); if (q) { $('addr').value = q; search(); }
}

/* ---------------- geocoding ---------------- */
async function zipTable() { if (!S.zips) S.zips = await fetch(CFG.data + 'zips.json').then(r => r.json()); return S.zips; }
async function statesGeo() { if (!S.statesGeo) S.statesGeo = await fetch(CFG.data + 'us-states.json').then(r => r.json()); return S.statesGeo; }
function pip(pt, ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside; } return inside; }
async function stateAt(lat, lon) {
  const g = await statesGeo();
  for (const f of g.features) { const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const p of polys) if (pip([lon, lat], p[0])) return f.properties.st; }
  return null;
}
async function geocodeZip(q) {
  const m = q.match(/\b(\d{5})\b/); if (!m) return null;
  const z = (await zipTable())[m[1]]; if (!z) return null;
  return { lat: z[0], lon: z[1], st: await stateAt(z[0], z[1]), label: `ZIP ${m[1]} (center of ZIP area)` };
}
function queryState(q) { // state named at the end of the query: "..., TX" / "... Texas 77995"
  const t = q.replace(/\b\d{5}(-\d{4})?\b/g, '').replace(/[.,]+\s*$/, '').trim(), m = t.match(/(?:,|\s)\s*([A-Za-z]{2})$/);
  if (m && STATES[m[1].toUpperCase()]) return m[1].toUpperCase();
  const low = t.toLowerCase(); for (const [name, st] of Object.entries(NAME2ST)) if (low.endsWith(name)) return st;
  return null;
}
async function geocode(q) {
  if (CFG.offline) return geocodeZip(q);
  const zipHit = await geocodeZip(q).catch(() => null);
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en`).then(r => r.json());
    // Photon often ranks a same-named county or creek first ("Yoakum, TX" -> Yoakum County, 400 mi away):
    // keep Photon's order but push counties, states, creeks etc. and hits outside the state named in the query to the back
    const qst = queryState(q), us = (r.features || []).filter(f => (f.properties.countrycode || '').toUpperCase() === 'US' || f.properties.country === 'United States');
    const rank = f => { const p = f.properties, st = NAME2ST[(p.state || '').toLowerCase()]; return (qst && st !== qst ? 2 : 0) + (p.type === 'county' || p.type === 'state' || ['waterway', 'natural', 'boundary'].includes(p.osm_key) ? 1 : 0); };
    const f = us.map((f, i) => [rank(f) * 100 + i, f]).sort((a, b) => a[0] - b[0]).map(x => x[1])[0];
    if (f) { const p = f.properties, st = NAME2ST[(p.state || '').toLowerCase()] || null; return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], st, county: p.type === 'county' ? p.name : p.county || null, label: [p.name, p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street, p.city || p.county, p.state, p.postcode].filter(Boolean).join(', ') }; }
  } catch (e) { console.warn('photon failed', e); }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&limit=1&addressdetails=1&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } }).then(r => r.json());
    if (r.length) { const a = r[0].address || {}, iso = a['ISO3166-2-lvl4'] || ''; return { lat: +r[0].lat, lon: +r[0].lon, st: iso.startsWith('US-') ? iso.slice(3) : NAME2ST[(a.state || '').toLowerCase()] || null, county: a.county || null, label: r[0].display_name }; }
  } catch (e) { console.warn('nominatim failed', e); }
  return zipHit;
}

function statesNear(lat, lon, mi) {
  const dLat = mi / 68.7, dLon = mi / (69.17 * Math.cos(lat * Math.PI / 180)), a = lat - dLat, b = lon - dLon, c = lat + dLat, d = lon + dLon;
  return Object.entries(S.brBox).filter(([s, bb]) => !(bb[2] < a || bb[0] > c || bb[3] < b || bb[1] > d)).map(([s]) => s);
}

/* ---------------- search & filter ---------------- */
async function search() {
  const q = $('addr').value.trim(); if (!q) return;
  $('addr-result').textContent = 'Locating…';
  const g = await geocode(q).catch(() => null);
  if (!g) { $('addr-result').textContent = CFG.offline ? 'Enter a 5-digit ZIP code (full address lookup is available on the hosted site).' : 'Address not found. Try adding the city, state and ZIP code.'; return; }
  S.pt = g; S.st = g.st;
  history.replaceState(null, '', '?q=' + encodeURIComponent(q));
  await run();
}
// The property's county: the address lookup's county when it matches a county that has bank or credit-union offices in the state;
// otherwise (ZIP codes, dropped pins, independent cities) the county of the nearest office in the same state.
async function resolveCounty(pt) {
  if (pt.ck !== undefined) return;
  if (!pt.st) pt.st = S.st = await stateAt(pt.lat, pt.lon).catch(() => null);
  pt.ck = null; pt.cname = null;
  if (!pt.st) return;
  await ensureBranches([pt.st]);
  const inSt = S.branches.filter(b => b[6] === pt.st && b[11]), want = CTY(pt.county);
  const hit = want && inSt.find(b => b[11] === want);
  if (hit) { pt.ck = want; pt.cname = countyName(pt.county, pt.st); return; }
  let best = null, bd = 25;
  for (const b of inSt) { const d = hav(pt.lat, pt.lon, b[2], b[3]); if (d < bd) { bd = d; best = b; } }
  if (best) { pt.ck = best[11]; pt.cname = countyName(best[10], pt.st); pt.cguess = true; }
}
const brMode = () => document.querySelector('input[name=brmode]:checked').value;
async function run() {
  if (!S.pt) return;
  await resolveCounty(S.pt);
  const pt = S.pt, mode = pt.ck ? brMode() : 'miles', rBr = +$('r-br').value || 10;
  if (!pt.ck) document.querySelector('input[name=brmode][value=miles]').checked = true;
  await ensureBranches([...new Set([pt.st, ...(mode === 'miles' ? statesNear(pt.lat, pt.lon, rBr) : [])].filter(Boolean))]);
  const where = `${esc(pt.label)}${pt.cname ? ` <span class="muted">(${esc(pt.cname)}, ${pt.st})</span>` : pt.st ? ` <span class="muted">(${pt.st}; county not found)</span>` : ' <span class="muted">(state not resolved)</span>'}`;
  $('addr-result').innerHTML = where; $('where').innerHTML = where;
  const amt = parseFloat(($('amt').value || '').replace(/[^0-9.]/g, '')) || null, amtM = amt ? (amt > 1e5 ? amt / 1e6 : amt) : null; // accept dollars or $M
  const { lat, lon } = pt;
  // branches that count as "nearby": in the property's county, or within the mile radius. Closest one kept per lender.
  const near = {};
  for (const b of S.branches) {
    const d = hav(lat, lon, b[2], b[3]);
    if (mode === 'county' ? !(b[6] === pt.st && b[11] === pt.ck) : d > rBr) continue;
    const n = near[b[1]] || (near[b[1]] = { n: 0, min: 1e9, b: null }); n.n++; if (d < n.min) { n.min = d; n.b = b; }
  }
  const hq = [], br = [];
  for (const l of S.lenders) {
    if (l.lat == null || !pt.st || l.st !== pt.st) continue;
    // fixed rules: credit unions that lend only to one employer or group, and lenders with no CRE on the books, are not listed
    if (l.c === 'C' && l.fom && !(l.fom === 'Community' || l.fom.startsWith('State charter'))) continue;
    if (!(l.cre > 0)) continue;
    // loan amount box (off by default): hide lenders whose legal lending limit or remaining CRE capacity is below the loan
    if (amtM && ((l.limit != null && l.limit < amtM) || (capOf(l) != null && capOf(l) < amtM))) continue;
    const nb = near[l.id], r = Object.assign({}, l, { dist: hav(lat, lon, l.lat, l.lon), nbr: nb ? nb.n : 0, brdist: nb ? nb.min : null, brpt: nb ? nb.b : null });
    if (pt.ck && l.ck === pt.ck) hq.push(Object.assign(r, { list: 'hq' }));
    else if (nb) br.push(Object.assign(r, { list: 'br' }));
  }
  hq.sort(byScore); br.sort(byScore);
  S.lists = { hq, br }; S.results = [...hq, ...br]; S.mode = mode; S.rBr = rBr;
  markTop(S.results);
  renderResults();
  const nB = S.results.filter(r => r.c === 'B').length, nC = S.results.length - nB;
  $('summary').innerHTML = `<b>${S.results.length}</b> lenders (${nB} banks, ${nC} credit unions)${amtM ? ` · can hold a $${amtM.toFixed(1)}M loan` : ''} · ordered by national score. A green box marks the top third of this search.`;
  $('csv').disabled = !S.results.length;
}

/* ---------------- page state: landing vs results ---------------- */
function enterResults() {
  if (document.body.classList.contains('results')) return;
  document.body.classList.replace('landing', 'results');
  $('drop-inner').appendChild($('search-home'));   // the one search form moves under the header; the header Search button opens it
  if (S.map) S.map.resize();
}
function renderResults() {
  enterResults();
  renderSponsorSlot(); renderCards(); renderMap();
}

/* ---------------- cards: two lists (HQ in the county; HQ in the state with a branch nearby), each ordered by score ---------------- */
// Only the headline metrics are shown; the score orders the lists but is not displayed here (it is in the lender details).
function capacity(r) {
  if (r.c === 'B') return r.caprem == null ? money(null) : r.caprem <= 0 ? 'None <span class="na">(above 300%)</span>' : money(r.caprem);
  return r.licu ? 'No cap' : r.mblrem == null ? money(null) : r.mblrem <= 0 ? 'None <span class="na">(cap reached)</span>' : money(r.mblrem);
}
// Green box: top third of the current search (both lists) for each headline figure. Tier 1 leverage is compared among the
// banks in the search; net worth ratio, CRE granted and CRE rate among the credit unions; capacity within each charter.
// Fewer than 3 to compare: only the best one is marked; a lone lender is not marked.
const TOP = [['ltd', r => r.ltd, -1, 'all'], ['cap', capOf, 1, 'charter'], ['t1', r => r.t1, 1, 'B'], ['nwr', r => r.nwr, 1, 'C'], ['fc', r => r.fc, -1, 'all'], ['granted', r => r.granted, 1, 'C'], ['rate', r => r.rate, -1, 'C']];
function markTop(rows) {
  rows.forEach(r => r.top = {});
  for (const [k, v, dir, who] of TOP) {
    const groups = who === 'all' ? [rows] : who === 'charter' ? [rows.filter(r => r.c === 'B'), rows.filter(r => r.c === 'C')] : [rows.filter(r => r.c === who)];
    for (const g of groups) {
      const vals = g.map(v).filter(x => x != null && !Number.isNaN(x)).sort((a, b) => (b - a) * dir);
      if (vals.length < 2) continue;
      const cutoff = vals[Math.max(1, Math.floor(vals.length / 3)) - 1];
      g.forEach(r => { const x = v(r); if (x != null && (dir > 0 ? x >= cutoff : x <= cutoff)) r.top[k] = true; });
    }
  }
}
function cardStats(r) {
  const s = [
    ['ltd', 'Loan to deposit', fmtP(r.ltd, 1), 'Gross loans / total deposits'],
    ['cap', 'CRE lending capacity', capacity(r), r.c === 'B' ? 'Room to grow investment CRE to 300% of capital (regulatory guidance level)' : 'Room left under the business-loan cap (1.75× net worth); low-income credit unions are exempt'],
    r.c === 'B' ? ['t1', 'Tier 1 leverage', fmtP(r.t1), 'Tier 1 capital / average assets, as reported'] : ['nwr', 'Net worth ratio', fmtP(r.nwr), 'NCUA net worth ratio'],
    ['fc', 'Funding cost', fmtP(r.fc), 'Annualized interest expense / average deposits + borrowings'],
  ];
  if (r.c === 'C') s.push(
    ['granted', 'CRE granted YTD', r.granted == null ? money(null) : money(r.granted) + (r.grantedn != null ? ` <span class="na">(${fmtI(r.grantedn)})</span>` : ''), 'Real-estate-secured commercial loans granted this year: dollars (number of loans)'],
    ['rate', 'CRE loan rate', fmtP(r.rate), 'Reported rate on real-estate-secured commercial loans (NCUA account 525)']);
  return s.map(([k, l, v, t]) => [l, r.top && r.top[k] ? `<span class="top3">${v}<span class="vh"> (top third of this search)</span></span>` : v, t]);
}
function cardHtml(r, i) {
  const where = r.list === 'hq' ? `HQ ${esc(r.ci)}, ${r.st}, ${r.dist.toFixed(1)} mi`
    : `HQ ${esc(r.ci)}, ${r.st} · ${r.nbr} branch${r.nbr === 1 ? '' : 'es'} ${S.mode === 'county' ? 'in the county' : 'within ' + S.rBr + ' mi'}, closest ${r.brdist.toFixed(1)} mi`;
  return `<li class="lcard" data-id="${r.id}" tabindex="0" aria-label="${i}. ${esc(nm(r))}. Open details">
    <span class="pin pin-${r.list}" aria-hidden="true">${i}</span>
    <div class="lc-main">
      <div class="lc-top"><span class="lc-name t-product">${esc(nm(r))}</span>${typeTag(r)}${gradeTag(r)}</div>
      <p class="lc-meta small">${typeText(r)} · ${where}</p>
      <dl class="lc-stats">${cardStats(r).map(([k, v, t]) => `<div title="${esc(t)}"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    </div></li>`;
}
function renderCards() {
  const { hq, br } = S.lists, pt = S.pt, cn = pt.cname || 'the county', stn = STATES[pt.st] || pt.st || 'the state';
  $('lt-hq').textContent = `Headquartered in ${cn}`;
  $('ls-hq').textContent = !pt.ck ? 'The county could not be determined for this location; see the list below.' : `${hq.length} lender${hq.length === 1 ? '' : 's'} with a main office in ${cn}, ${pt.st}${pt.cguess ? ' (county taken from the nearest bank or credit-union office)' : ''}.`;
  $('lt-br').textContent = `Headquartered elsewhere in ${stn}, with a branch nearby`;
  $('bm-county').textContent = `Branch in ${pt.cname || 'the county'}`;
  document.querySelector('input[name=brmode][value=county]').disabled = !pt.ck;
  $('ls-br').textContent = `${br.length} lender${br.length === 1 ? '' : 's'} headquartered in ${stn} outside ${cn} with ${S.mode === 'county' ? `a branch in ${cn}` : `a branch within ${S.rBr} miles`}. Map pins show the closest branch.`;
  $('cards-hq').innerHTML = hq.map((r, i) => cardHtml(r, i + 1)).join('') || (pt.ck ? `<li class="empty">No lenders headquartered in ${esc(cn)} match. See the list below, or change Filters.</li>` : '');
  $('cards-br').innerHTML = br.map((r, i) => cardHtml(r, hq.length + i + 1)).join('') || `<li class="empty">No match. Try ${S.mode === 'county' ? 'a mile radius' : 'a larger radius'} or change Filters.</li>`;
}
function highlight(id, on, fromMarker) {
  const m = S.markers && S.markers[id], card = document.querySelector(`.lcard[data-id="${id}"]`);
  if (m) m.getElement().classList.toggle('selected', on);
  if (card) { card.classList.toggle('hl', on); if (on && fromMarker) card.scrollIntoView({ block: 'nearest' }); }
}
const cardOf = e => e.target.closest && e.target.closest('.lcard');
for (const ol of [$('cards-hq'), $('cards-br')]) {
  ol.addEventListener('mouseover', e => { const c = cardOf(e); if (c && !c.contains(e.relatedTarget)) highlight(c.dataset.id, true); });
  ol.addEventListener('mouseout', e => { const c = cardOf(e); if (c && !c.contains(e.relatedTarget)) highlight(c.dataset.id, false); });
  ol.addEventListener('focusin', e => { const c = cardOf(e); if (c) highlight(c.dataset.id, true); });
  ol.addEventListener('focusout', e => { const c = cardOf(e); if (c) highlight(c.dataset.id, false); });
  ol.addEventListener('click', e => { const c = cardOf(e); if (c) openLender(c.dataset.id); });
  ol.addEventListener('keydown', e => { const c = cardOf(e); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openLender(c.dataset.id); } });
}

/* ---------------- map ---------------- */
let popup = null;
function showPopup(lngLat, html) {   // MapLibre's own close glyph is replaced by a labelled icon button
  if (popup) popup.remove();
  popup = new maplibregl.Popup({ closeButton: false, offset: 18, maxWidth: '300px' }).setLngLat(lngLat).setHTML(`<button type="button" class="icon-button bare pp-close" aria-label="Close">${ICON('x')}</button>` + html).addTo(S.map);
  popup.getElement().querySelector('.pp-close').onclick = () => popup.remove();
  return popup;
}
// List 1 pins sit on the headquarters; list 2 pins on the lender's closest qualifying branch (its HQ may be across the state).
const pinAt = r => r.list === 'br' && r.brpt ? [r.brpt[3], r.brpt[2]] : [r.lon, r.lat];
function markerPopup(r, i) {
  return `<div class="pp"><span class="t-product">${i}. ${esc(nm(r))}</span><p class="small">${typeText(r)} · HQ ${esc(r.ci)}, ${r.st} · Grade ${r.grade}, ${r.total} of 16 points</p>
  ${r.list === 'br' && r.brpt ? `<p class="small">Pin: closest branch, ${esc(r.brpt[4])}, ${esc(r.brpt[5])} (${r.brdist.toFixed(1)} mi)</p>` : ''}
  <dl class="pp-stats"><div><dt>Loan/dep</dt><dd>${fmtP(r.ltd, 1)}</dd></div><div><dt>Funding cost</dt><dd>${fmtP(r.fc)}</dd></div></dl>
  <button type="button" class="button button-primary button-sm" data-open="${r.id}">Details</button></div>`;
}
function renderMarkers() {
  Object.values(S.markers || {}).forEach(m => m.remove()); S.markers = {};
  S.results.map((r, i) => [r, i + 1]).reverse().forEach(([r, i]) => {   // first in the list added last so it sits on top
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'pin pin-' + r.list; el.tabIndex = -1; el.textContent = i;
    el.setAttribute('aria-label', `${i}. ${nm(r)}`);
    el.addEventListener('mouseenter', () => highlight(r.id, true, true)); el.addEventListener('mouseleave', () => highlight(r.id, false));
    el.addEventListener('click', e => { e.stopPropagation(); showPopup(pinAt(r), markerPopup(r, i)); });
    S.markers[r.id] = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(pinAt(r)).addTo(S.map);
  });
}
document.addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b && S.byId[b.dataset.open]) openLender(b.dataset.open); });

function initMap() {
  if (!window.maplibregl) { $('map').innerHTML = '<p class="note">The map could not load. The lists still work.</p>'; return; }
  const style = CFG.offline ? { version: 8, sources: { states: { type: 'geojson', data: CFG.data + 'us-states.json' } }, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': TOK('--surface') } }, { id: 'states', type: 'fill', source: 'states', paint: { 'fill-color': TOK('--ground'), 'fill-outline-color': TOK('--line') } }, { id: 'states-line', type: 'line', source: 'states', paint: { 'line-color': TOK('--muted'), 'line-width': 0.8 } }] } : CFG.tiles;
  S.map = new maplibregl.Map({ container: 'map', style, center: [-96, 38.5], zoom: 3.6, attributionControl: !CFG.offline });
  S.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  const lg = document.createElement('div'); lg.className = 'legend small'; lg.innerHTML = '<span><i class="lg-hq" aria-hidden="true"></i>HQ in the county</span><span><i class="lg-br" aria-hidden="true"></i>Closest branch, HQ elsewhere</span><span><i class="lg-dot" aria-hidden="true"></i>Nearby branches</span><span><svg class="lg-prop" viewBox="0 0 36 48" aria-hidden="true"><path class="prop-body" d="M18 46C10 35 3 27 3 18a15 15 0 0 1 30 0c0 9-7 17-15 28z"/><circle class="prop-hole" cx="18" cy="18" r="6"/></svg>Property</span>'; $('map').appendChild(lg);
  S.map.on('load', () => {
    const accent = TOK('--accent'), ink = TOK('--ink');
    S.map.addSource('circle', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    S.map.addLayer({ id: 'circle', type: 'fill', source: 'circle', paint: { 'fill-color': accent, 'fill-opacity': 0.06 } });
    S.map.addLayer({ id: 'circle-line', type: 'line', source: 'circle', paint: { 'line-color': TOK('--accent-text'), 'line-width': 2, 'line-dasharray': [2, 2] } });
    S.map.addSource('br', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    S.map.addLayer({ id: 'br', type: 'circle', source: 'br', paint: { 'circle-radius': 4, 'circle-color': ['get', 'color'], 'circle-opacity': 0.85, 'circle-stroke-color': ink, 'circle-stroke-width': 1 } });
    S.map.on('mouseenter', 'br', () => S.map.getCanvas().style.cursor = 'pointer'); S.map.on('mouseleave', 'br', () => S.map.getCanvas().style.cursor = '');
    S.map.on('click', 'br', e => { const p = e.features[0].properties; showPopup(e.lngLat, branchPopup(p.bid)); });
    S.map.on('click', async e => {
      if (S.map.queryRenderedFeatures(e.point, { layers: ['br'] }).length) return;
      const { lat, lng } = e.lngLat; S.pt = { lat, lon: lng, st: await stateAt(lat, lng).catch(() => null), label: `Dropped pin ${lat.toFixed(4)}, ${lng.toFixed(4)}` }; S.st = S.pt.st;
      $('addr').value = ''; history.replaceState(null, '', location.pathname); run();
    });
    if (S.results.length) renderMap();
  });
}
const PROP_PIN = '<svg viewBox="0 0 36 48" aria-hidden="true"><path class="prop-body" d="M18 46C10 35 3 27 3 18a15 15 0 0 1 30 0c0 9-7 17-15 28z"/><circle class="prop-hole" cx="18" cy="18" r="6"/></svg>';
function circlePoly(lat, lon, mi) { const pts = []; for (let i = 0; i <= 64; i++) { const a = i / 64 * 2 * Math.PI; pts.push([lon + (mi / 69.172 / Math.cos(lat * Math.PI / 180)) * Math.cos(a), lat + (mi / 68.703) * Math.sin(a)]); } return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } }; }
function renderMap() {
  if (!S.map || !S.map.getSource('br')) return;
  const { lat, lon } = S.pt, ok = S.mode === 'county' ? b => b[6] === S.pt.st && b[11] === S.pt.ck : b => hav(lat, lon, b[2], b[3]) <= S.rBr;
  if (!S.propPin) { const el = document.createElement('div'); el.className = 'prop-pin'; el.setAttribute('role', 'img'); el.setAttribute('aria-label', 'Property'); el.innerHTML = PROP_PIN; S.propPin = new maplibregl.Marker({ element: el, anchor: 'bottom' }); }
  S.propPin.setLngLat([lon, lat]).addTo(S.map);   // drawn above the lender pins (z-index in app.css)
  const ring = S.mode === 'miles' ? circlePoly(lat, lon, S.rBr) : null;
  S.map.getSource('circle').setData({ type: 'FeatureCollection', features: ring ? [ring] : [] });
  renderMarkers();
  const brs = [], color = { hq: TOK('--pin-fill'), br: TOK('--brand') };
  for (const r of S.results) for (const b of S.brByLender[r.id] || []) if (ok(b)) brs.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [b[3], b[2]] }, properties: { bid: b[0], color: color[r.list] } });
  S.map.getSource('br').setData({ type: 'FeatureCollection', features: brs });
  const bb = new maplibregl.LngLatBounds([lon, lat], [lon, lat]); S.results.forEach(r => bb.extend(pinAt(r))); brs.forEach(f => bb.extend(f.geometry.coordinates));
  if (ring) ring.geometry.coordinates[0].forEach(p => bb.extend(p));
  S.map.fitBounds(bb, { padding: 48, maxZoom: 12, duration: 0 });
}

/* ---------------- branch popup ---------------- */
function branchPopup(bid) {
  const b = S.brById[bid], l = S.byId[b[1]], st = branchStats(l.id).find(x => x.b[0] === bid);
  let h = `<div class="pp"><span class="t-product">${esc(b[4])}</span><p class="small">${esc(b[5])}, ${b[6]} ${b[7]}<br>Owner: <button type="button" class="button-text pp-link" data-open="${l.id}">${esc(nm(l))}</button> (${l.c === 'B' ? 'bank' : 'credit union'}, grade ${l.grade})</p>`;
  if (l.c === 'C') h += '<p class="small">NCUA publishes no branch-level deposits.</p>';
  else if (st.dep == null) h += '<p class="small">No Summary of Deposits record (opened after June 30 or non-deposit office).</p>';
  else {
    h += `<dl class="pp-stats"><div><dt>Deposits, June ${S.years[S.years.length - 1]}</dt><dd>${money(st.dep / 1000)}</dd></div><div><dt>Share of lender</dt><dd>${fmtP(st.share, 1)}</dd></div></dl>`;
    h += `<p class="small figures">1-yr ${fmtChg(st.g1)} · 5-yr ${fmtChg(st.g5)} · 10-yr ${fmtChg(st.g10)}</p>`;
    h += st.main ? '<p class="small">Main office: often carries internet, brokered and corporate deposits; excluded from branch quartiles.</p>' : (st.quart ? `<p class="small">Quartile ${st.quart} of ${st.n} branches by deposits (1 = largest)</p>` : '');
  }
  return h + '</div>';
}

/* ---------------- lender details drawer ---------------- */
window.openLender = function (id) {
  openDialog('drawer');
  renderLender(id, $('drawer-content'), { links: `<a href="lookup.html?id=${encodeURIComponent(id)}">Open as a full page</a>` });
};

/* ---------------- CSV ---------------- */
function csv() {
  const cols = [{ k: 'list', l: 'List' }, ...COLS], rows = S.results;
  const val = (r, c) => { const v = c.k === 'brok' ? (r.c === 'B' ? r.brok : r.nonmem) : c.k === 'head' ? (r.c === 'B' ? r.caprem : r.mblrem) : c.k === 'hq' ? `${r.ci}, ${r.st}` : c.k === 'c' ? (r.c === 'B' ? 'Bank' : 'CU') : c.k === 'list' ? (r.list === 'hq' ? 'HQ in county' : 'HQ in state, branch nearby') : r[c.k]; return v == null ? '' : typeof v === 'number' ? (Number.isInteger(v) ? v : +v.toFixed(3)) : `"${String(v).replace(/"/g, '""')}"`; };
  const txt = cols.map(c => `"${c.l}"`).join(',') + '\n' + rows.map(r => cols.map(c => val(r, c)).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = `lenders_${(S.pt.label || 'search').replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.csv`; a.click();
}

/* ---------------- definitions dialog ---------------- */
function showModal(title, html) { $('modal-title').textContent = title; $('modal-content').innerHTML = html; openDialog('modal'); }
$('btn-defs').onclick = () => showModal('Definitions', defsHtml());

/* ---------------- search panel under the header (results view) ---------------- */
const dropOpen = () => !$('hdr-drop').hidden;
function openSearchPanel() { $('hdr-drop').hidden = false; document.querySelectorAll('[data-search]').forEach(b => b.setAttribute('aria-expanded', 'true')); $('addr').focus(); $('addr').select(); }
function closeSearchPanel() { if (!dropOpen()) return; $('hdr-drop').hidden = true; document.querySelectorAll('[data-search]').forEach(b => b.setAttribute('aria-expanded', 'false')); }
// header Search buttons: on the landing view they jump to the address field; on results they open the panel
document.querySelectorAll('[data-search]').forEach(b => {
  b.setAttribute('aria-controls', 'hdr-drop'); b.setAttribute('aria-expanded', 'false');
  b.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    if (!document.body.classList.contains('results')) { $('addr').focus(); $('addr').scrollIntoView({ block: 'center' }); return; }
    dropOpen() ? closeSearchPanel() : openSearchPanel();
  });
});
$('change-addr').addEventListener('click', e => { e.stopPropagation(); openSearchPanel(); });
document.addEventListener('click', e => { if (!e.target.closest('#hdr-drop')) closeSearchPanel(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !topDialog() && dropOpen()) { closeSearchPanel(); $('change-addr').focus(); } });
async function searchFromBar() {
  const before = S.pt;
  if (document.body.classList.contains('results') && $('addr').value.trim()) { $('cards-hq').innerHTML = skeletons(3, 'lcard'); $('cards-br').innerHTML = ''; }
  await search();
  if (S.pt === before && S.results.length) renderCards();   // lookup failed: put the previous results back
  if (S.pt && S.pt !== before) closeSearchPanel();
}

/* ---------------- loan amount box (results view; off until a number is applied) ---------------- */
$('amt-form').addEventListener('submit', e => { e.preventDefault(); $('amt-clear').hidden = !$('amt').value.trim(); run(); });
$('amt-clear').onclick = () => { $('amt').value = ''; $('amt-clear').hidden = true; run(); $('amt').focus(); };
// second list: branch in the county, or within N miles (clicking the miles box switches to miles)
document.querySelectorAll('input[name=brmode]').forEach(r => r.addEventListener('change', run));
$('r-br').addEventListener('focus', () => { const m = document.querySelector('input[name=brmode][value=miles]'); if (!m.checked) { m.checked = true; run(); } });
$('r-br').addEventListener('change', run);

/* ---------------- placements (featured.json): never touch score, grade or result order ---------------- */
// Placeholder entries render only on a preview URL (?preview=1) or a local copy, so the public site shows no fake sponsors.
const PREVIEW = new URLSearchParams(location.search).has('preview') || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const PL = { all: null };
const today = () => new Date().toISOString().slice(0, 10);
function activePlacements(type) {
  const d = today();
  return (PL.all || []).filter(p => p.type === type && (!p.placeholder || PREVIEW) && (!p.start_date || p.start_date <= d) && (!p.end_date || p.end_date >= d) && (!S.lenders.length || S.byId[p.id]));
}
// The state for "Sponsored in {state}". One place to swap in a signed-in borrower's registered state later.
function currentSponsorState() {
  if (window.LM_USER && window.LM_USER.state) return window.LM_USER.state;
  try { const v = localStorage.getItem('lm.sponsorState'); if (v && STATES[v]) return v; } catch (e) {}
  if (S.st) return S.st;
  const first = activePlacements('sponsored').flatMap(p => p.states || [])[0];
  return first || 'TX';
}
function setSponsorState(st) { try { localStorage.setItem('lm.sponsorState', st); } catch (e) {} renderPlacements(); }
const isPaid = p => p.paid !== false;
function placementCard(p) {
  const l = S.byId[p.id];
  if (!l) return '';
  return `<li class="card pcard">
    <div class="card-image pc-tile g${l.grade === 'A+' ? 'Ap' : l.grade}" aria-hidden="true"><span class="pc-letter">${l.grade}</span><span class="pc-sub">Grade</span></div>
    <div class="card-body">
      ${isPaid(p) ? '<span class="tag">Sponsored</span>' : ''}
      <button type="button" class="pc-main t-product" data-open="${l.id}" aria-label="${esc(nm(l))}${isPaid(p) ? ', sponsored' : ''}, grade ${l.grade}. Open details">${esc(nm(l))}</button>
      <p class="small">${typeText(l)} · ${esc(l.ci)}, ${l.st}</p>
      ${p.blurb ? `<p class="pc-blurb">${esc(p.blurb)}</p>` : ''}
      ${p.profile_url ? `<a class="pc-profile small" href="${esc(p.profile_url)}" target="_blank" rel="noopener sponsored">View profile</a>` : ''}
    </div>
  </li>`;
}
const skeletons = (n, cls) => Array.from({ length: n }, () => `<li class="${cls} skel" aria-hidden="true"><span></span><span></span><span></span></li>`).join('');
function fillRow(id, items) {
  const row = $(id); row.hidden = !items.length;
  row.querySelector('.lrow-track').innerHTML = items.join('');
}
function renderPlacements() {
  if (!PL.all) return;
  if (!S.lenders.length) {   // data still loading: show the rows that will have entries, as skeletons
    for (const [id, type] of [['row-featured', 'featured'], ['row-profile', 'profile'], ['row-sponsored', 'sponsored']]) if (activePlacements(type).length) fillRow(id, [skeletons(4, 'pcard')]);
    return;
  }
  fillRow('row-featured', activePlacements('featured').map(placementCard));
  fillRow('row-profile', activePlacements('profile').map(placementCard));
  const sp = activePlacements('sponsored'), st = currentSponsorState();
  const states = [...new Set([st, ...sp.flatMap(p => p.states || [])])].filter(s => STATES[s]).sort((a, b) => STATES[a].localeCompare(STATES[b]));
  $('sp-state').innerHTML = states.map(s => `<option value="${s}"${s === st ? ' selected' : ''}>${STATES[s]}</option>`).join('');
  $('sp-state-name').textContent = STATES[st] || st;
  const inState = sp.filter(p => (p.states || []).includes(st)).map(placementCard);
  fillRow('row-sponsored', inState.length ? inState : ['<li class="pcard-empty small">No sponsored lenders in this state yet.</li>']);
  $('row-sponsored').hidden = !sp.length;
}
// A labelled slot above the ranked list for one sponsored lender in the property's state. Not numbered, not ranked.
function renderSponsorSlot() {
  const p = S.st && activePlacements('sponsored').find(p => (p.states || []).includes(S.st)), l = p && S.byId[p.id];
  $('sponsor-slot').innerHTML = l ? `<div class="sslot"><span class="tag">Sponsored</span>
    <button type="button" class="ss-main" data-open="${l.id}" aria-label="Sponsored: ${esc(nm(l))}, grade ${l.grade}. Open details">${gradeTag(l)} <span class="t-product">${esc(nm(l))}</span></button>
    <p class="small">${typeText(l)} · ${esc(l.ci)}, ${l.st}${p.blurb ? ` · ${esc(p.blurb)}` : ''}</p>
    ${p.profile_url ? `<a class="small" href="${esc(p.profile_url)}" target="_blank" rel="noopener sponsored">View profile</a>` : ''}
    <p class="small">Sponsored placement. It does not change any lender's score, grade or position in the ranked lists below.</p></div>` : '';
}
document.querySelectorAll('.lrow-nav button').forEach(b => b.onclick = () => { const t = b.closest('.lrow').querySelector('.lrow-track'); t.scrollBy({ left: +b.dataset.dir * t.clientWidth * 0.9 }); });
$('sp-state').onchange = e => setSponsorState(e.target.value);
fetch('featured.json').then(r => r.ok ? r.json() : []).catch(() => []).then(a => { PL.all = Array.isArray(a) ? a : []; renderPlacements(); if (S.pt) renderSponsorSlot(); });

/* ---------------- list / map divider: drag, arrow keys, double-click to reset (remembered per browser) ---------------- */
function setListWidth(pct, save) {
  pct = Math.max(30, Math.min(80, Math.round(pct)));
  document.querySelector('.split').style.setProperty('--list-w', pct + '%'); $('divider').setAttribute('aria-valuenow', pct);
  if (S.map) S.map.resize();
  if (save) try { localStorage.setItem('lm.listW', pct); } catch (e) {}
}
(() => {
  const d = $('divider'), split = () => document.querySelector('.split').getBoundingClientRect();
  let raf = 0;
  d.addEventListener('pointerdown', e => {
    e.preventDefault(); d.setPointerCapture(e.pointerId); d.classList.add('dragging'); document.body.classList.add('resizing');
    const move = ev => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const r = split(); setListWidth((ev.clientX - r.left) / r.width * 100); }); };
    const up = () => { d.removeEventListener('pointermove', move); d.classList.remove('dragging'); document.body.classList.remove('resizing'); setListWidth(+d.getAttribute('aria-valuenow'), true); };
    d.addEventListener('pointermove', move); d.addEventListener('pointerup', up, { once: true }); d.addEventListener('pointercancel', up, { once: true });
  });
  d.addEventListener('keydown', e => { const v = +d.getAttribute('aria-valuenow'); if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setListWidth(v + (e.key === 'ArrowRight' ? 5 : -5), true); } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setListWidth(e.key === 'Home' ? 30 : 80, true); } });
  d.addEventListener('dblclick', () => setListWidth(60, true));
  let saved = 60; try { saved = +localStorage.getItem('lm.listW') || 60; } catch (e) {}
  setListWidth(saved, false);
})();

/* ---------------- below 900px: list or map, one at a time ---------------- */
function setMapView(show) {
  document.body.classList.toggle('show-map', show);
  $('maptoggle').innerHTML = show ? `${ICON('list')}Show list` : `${ICON('map')}Show map`;
}
$('maptoggle').onclick = () => {
  const show = !document.body.classList.contains('show-map');
  setMapView(show); window.scrollTo(0, 0);
  if (show && S.map) { S.map.resize(); if (S.pt) renderMap(); }
};
window.matchMedia('(min-width: 900px)').addEventListener('change', e => { if (e.matches) { setMapView(false); if (S.map) S.map.resize(); } });

/* ---------------- wiring ---------------- */
$('searchbar').addEventListener('submit', e => { e.preventDefault(); searchFromBar(); });
$('csv').onclick = csv;
if (location.hash === '#search') $('addr').focus();
initMap(); load().catch(e => { $('addr-result').textContent = 'The lender data could not load (' + e.message + '). Try again later.'; console.error(e); });
