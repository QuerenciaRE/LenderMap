/* CRE Lender Finder — client-side app. Data built by scripts/package_site.py. */
'use strict';
const CFG = { data: 'data/', histMode: 'lender' /* 'lender' => data/history/{id}.json ; 'state' => data/history_state/{ST}.json */, tiles: 'https://tiles.openfreemap.org/styles/positron', offline: false /* true => no external hosts: ZIP-centroid geocoding and schematic state-outline basemap */ };
const STATES = {AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',PR:'Puerto Rico',GU:'Guam',VI:'Virgin Islands'};
const NAME2ST = Object.fromEntries(Object.entries(STATES).map(([k, v]) => [v.toLowerCase(), k]));

const S = { lenders: [], byId: {}, branches: [], years: [], brByLender: {}, pt: null, st: null, results: [], sort: { key: 'score', dir: -1 }, map: null, hist: {}, histState: {} };
const $ = id => document.getElementById(id);
const fmtM = (x, d = 1) => x == null ? '<span class="na">–</span>' : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtP = (x, d = 2) => x == null ? '<span class="na">–</span>' : x.toFixed(d) + '%';
const fmtI = x => x == null ? '<span class="na">–</span>' : x.toLocaleString('en-US');
const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hav = (a, b, c, d) => { const R = 3958.8, p = Math.PI / 180, dLat = (c - a) * p, dLon = (d - b) * p; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

/* ---------------- columns ---------------- */
const COLS = [
  { k: 'tier', l: 'Tier', f: r => `<span class="tier t${r.tier}">${r.tier}</span>`, t: 'National quintile of the likeliness-to-lend score (A = top 20%)' },
  { k: 'score', l: 'Score', f: r => r.score.toFixed(0), t: 'Weighted percentile scorecard (0-100) × cap penalty' },
  { k: 'n', l: 'Lender', cls: 'name l', f: r => esc(r.n), t: 'Click for history and branches' },
  { k: 'c', l: 'Type', cls: 'l', f: r => `<span class="badge ${r.c}">${r.c === 'B' ? 'Bank' : 'CU'}</span>${r.cl === 'Savings institution' ? ' <span class="dim">thrift</span>' : ''}${r.c === 'C' && r.licu ? ' <span class="dim" title="Low-income designated: exempt from the business-loan cap">LICU</span>' : ''}`, t: 'Bank / credit union' },
  { k: 'hq', l: 'HQ', cls: 'l', f: r => `${esc(r.ci)}, ${r.st}`, t: 'Main office city' },
  { k: 'dist', l: 'HQ mi', f: r => r.dist.toFixed(1), t: 'Distance from the address to the main office' },
  { k: 'nbr', l: 'Branches near', f: r => r.nbr + (r.brdist != null ? ` <span class="dim">(${r.brdist.toFixed(1)} mi)</span>` : ''), t: 'Branches within the branch radius (closest distance)' },
  { k: 'dep', l: 'Deposits $M', f: r => fmtM(r.dep, 0), t: 'Total deposits' },
  { k: 'ast', l: 'Assets $M', f: r => fmtM(r.ast, 0), t: 'Total assets' },
  { k: 'ltd', l: 'Loan/Dep', f: r => fmtP(r.ltd, 1), t: 'Gross loans / total deposits' },
  { k: 't1', l: 'Tier 1 lev', f: r => fmtP(r.t1), t: 'Bank: tier 1 leverage ratio as reported. CU: net worth / assets' },
  { k: 'nwr', l: 'Net worth', f: r => fmtP(r.nwr), t: 'Bank: equity / assets. CU: NCUA net worth ratio' },
  { k: 'fc', l: 'Funding cost', f: r => fmtP(r.fc), t: 'Annualized interest expense / average deposits + borrowings' },
  { k: 'nim', l: 'NIM', f: r => fmtP(r.nim), t: 'Annualized net interest income / average assets (same basis for banks and CUs)' },
  { k: 'crecap', l: 'Inv. CRE / capital', f: r => fmtP(r.crecap, 0), t: 'Non-owner-occupied + multifamily + construction as % of capital. Bank guidance threshold 300%; growth slows above ~400%' , occ: 'inv' },
  { k: 'oocap', l: 'OO CRE / capital', f: r => fmtP(r.oocap, 0), t: 'Owner-occupied nonfarm nonresidential loans as % of capital', occ: 'oo' },
  { k: 'inv', l: 'Inv. CRE $M', f: r => fmtM(r.inv, 1), t: 'Non-owner-occupied nonres + multifamily + construction & land', occ: 'inv' },
  { k: 'oo', l: 'OO CRE $M', f: r => fmtM(r.oo, 1), t: 'Owner-occupied nonfarm nonresidential loans', occ: 'oo' },
  { k: 'cre', l: 'Total CRE $M', f: r => fmtM(r.cre, 1), t: 'OO + non-OO + multifamily + construction' },
  { k: 'mom', l: 'CRE growth 4Q', f: r => fmtP(r.momv, 2), t: 'Change in CRE over the trailing 4 quarters as % of assets (investment or OO per selection)' },
  { k: 'chg', l: 'CRE lent YTD $M', f: r => fmtM(r.chgv, 1), t: 'Net change in CRE balances since Dec 31 (both charters). Understates originations by payoffs' },
  { k: 'granted', l: 'CRE granted YTD $M', f: r => r.c === 'C' ? fmtM(r.granted, 1) : '<span class="na">n/r</span>', t: 'Credit unions only: RE-secured commercial loans granted YTD (banks do not report originations)' },
  { k: 'avgloan', l: 'Avg loan $M', f: r => r.c === 'C' ? fmtM(r.avgloan, 2) : '<span class="na">n/r</span>', t: 'Credit unions only: granted $ / number granted' },
  { k: 'brok', l: 'Brokered / non-mbr', f: r => r.c === 'B' ? fmtP(r.brok, 1) : (fmtP(r.nonmem, 1) + (r.brokflag ? ' <span class="dim" title="Reports using brokered deposits">b</span>' : '')), t: 'Bank: brokered deposits % of deposits. CU: non-member deposits % (NCUA reports no brokered $; "b" = uses brokered deposits)' },
  { k: 'head', l: 'Cap headroom $M', f: r => r.c === 'B' ? fmtM(r.caprem, 0) : (r.mblrem == null ? '<span class="na">exempt</span>' : fmtM(r.mblrem, 0)), t: 'Bank: room to 300% of capital in investment CRE. CU: room under the statutory business-loan cap (1.75× net worth); LICUs exempt' },
  { k: 'mblused', l: 'MBL cap used', f: r => r.c === 'C' ? (r.mblused == null ? '<span class="na">exempt</span>' : fmtP(r.mblused, 0)) : '<span class="na">n/a</span>', t: 'Credit unions: net member business loans / statutory cap' },
  { k: 'rate', l: 'CRE rate', f: r => r.c === 'C' ? fmtP(r.rate) : '<span class="na">n/r</span>', t: 'Credit unions only: reported rate on RE-secured commercial loans (NCUA Acct 525). Banks report no loan rates' },
  { k: 'yield', l: 'Loan yield', f: r => fmtP(r.yield), t: 'Annualized interest & fee income on loans / average loans (all loans, both charters)' },
  { k: 'npl', l: 'NPL', f: r => fmtP(r.npl), t: 'Bank: 90+ days past due + nonaccrual / loans. CU: 60+ days delinquent / loans (definitions differ)' },
  { k: 'crenpl', l: 'CRE NPL', f: r => r.c === 'B' ? fmtP(r.crenpl) : '<span class="na">n/r</span>', t: 'Banks: noncurrent CRE / total CRE' },
  { k: 'roa', l: 'ROA', f: r => fmtP(r.roa), t: 'Annualized net income / average assets' },
  { k: 'limit', l: 'Lending limit $M', f: r => fmtM(r.limit, 1), t: 'Estimate: 15% of capital base (national banks 15% of capital & surplus; CUs 15% of net worth to one borrower)' },
  { k: 'nb', l: 'Branches', f: r => fmtI(r.nb), t: 'Total offices' },
];

/* ---------------- load ---------------- */
async function load() {
  const [meta, lj, bi, macro] = await Promise.all(['meta.json', 'lenders.json', 'branch_index.json', 'macro.json'].map(f => fetch(CFG.data + f).then(r => r.json())));
  const lenders = lj.rows.map(r => Object.fromEntries(lj.cols.map((k, i) => [k, r[i]])));
  S.meta = meta; S.lenders = lenders; S.years = bi.years; S.brBox = bi.states; S.brLoaded = {}; S.branches = []; S.brById = {};
  lenders.forEach(l => S.byId[l.id] = l);
  const i = macro.q.length - 1;
  $('meta-line').textContent = `${meta.latest} call reports · ${meta.n_banks.toLocaleString()} banks · ${meta.n_cus.toLocaleString()} credit unions · ${meta.n_branches.toLocaleString()} branches`;
  $('macro-line').textContent = `${macro.q[i]} avg: Fed funds ${macro.fedfunds[i]}% · SOFR ${macro.sofr[i]}% · 5y ${macro.dgs5[i]}% · 10y ${macro.dgs10[i]}% · banks tightening CRE standards (net %): ${macro.sloos_cre_tight[i]}`;
  $('built').textContent = `Data built ${meta.built}.`;
  if (CFG.offline) { $('csv').style.display = 'none'; $('addr').placeholder = 'ZIP code, e.g. 60606 — or click the map'; $('addr-result').textContent = 'Preview build: enter a 5-digit ZIP or click the map to drop a pin. The hosted site accepts full street addresses and shows a street basemap.'; }
  else $('addr-result').textContent = 'Street address, city and state, or a ZIP code. After a search you can also click the map to drop a pin.';
  rescoreAll(); renderPlacements();
  const q = new URLSearchParams(location.search).get('q'); if (q) { $('addr').value = q; search(); }
}

/* ---------------- scoring ---------------- */
function weights() { return { mom: +$('w-mom').value, fr: +$('w-fr').value, gro: +$('w-gro').value, qual: +$('w-qual').value, cap: +$('w-cap').value, mar: +$('w-mar').value }; }
function scoreOf(l, occ, w) {
  const c = l.sc, mom = occ === 'inv' ? c.mom_inv : c.mom_oo, fr = occ === 'inv' ? c.fr_inv : c.fr_oo;
  const tot = w.mom + w.fr + w.gro + w.qual + w.cap + w.mar;
  const raw = tot ? (w.mom * mom + w.fr * fr + w.gro * c.gro + w.qual * c.qual + w.cap * c.cap + w.mar * c.mar) / tot : 50;
  let pen = occ === 'inv' ? l.pen : Math.min(1, l.pen + 0.15);        // OO lending is outside the 300% guidance: soften the penalty
  if (!(l.cre > 0)) pen *= 0.5; else if (occ === 'inv' ? !(l.inv > 0) : !(l.oo > 0)) pen *= 0.7;   // no CRE of this kind on the books: revealed preference says unlikely
  return raw * pen;
}
function rescoreAll() {
  const occ = $('occ').value, w = weights();
  S.lenders.forEach(l => l.score = scoreOf(l, occ, w));
  const sorted = S.lenders.map(l => l.score).sort((a, b) => a - b), n = sorted.length;
  const cut = p => sorted[Math.floor(p * n)];
  const c80 = cut(.8), c60 = cut(.6), c40 = cut(.4), c20 = cut(.2);
  S.lenders.forEach(l => { l.tier = l.score >= c80 ? 'A' : l.score >= c60 ? 'B' : l.score >= c40 ? 'C' : l.score >= c20 ? 'D' : 'E'; l.momv = occ === 'inv' ? l.mominv : l.momoo; l.chgv = occ === 'inv' ? l.invchg : (l.chg != null && l.invchg != null ? +(l.chg - l.invchg).toFixed(1) : null); });
  document.querySelectorAll('.w').forEach(d => d.querySelector('b').textContent = d.querySelector('input').value);
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
    if (f) { const p = f.properties, st = NAME2ST[(p.state || '').toLowerCase()] || null; return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], st, label: [p.name, p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street, p.city || p.county, p.state, p.postcode].filter(Boolean).join(', ') }; }
  } catch (e) { console.warn('photon failed', e); }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&limit=1&addressdetails=1&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } }).then(r => r.json());
    if (r.length) { const a = r[0].address || {}, iso = a['ISO3166-2-lvl4'] || ''; return { lat: +r[0].lat, lon: +r[0].lon, st: iso.startsWith('US-') ? iso.slice(3) : NAME2ST[(a.state || '').toLowerCase()] || null, label: r[0].display_name }; }
  } catch (e) { console.warn('nominatim failed', e); }
  return zipHit;
}

/* ---------------- branch files (per state, loaded on demand) ---------------- */
async function ensureBranches(states) {
  const need = states.filter(s => S.brBox[s] && !S.brLoaded[s]);
  if (!need.length) return;
  $('summary').innerHTML = `Loading branches for ${need.join(', ')}…`;
  const files = await Promise.all(need.map(s => fetch(`${CFG.data}branches/${s}.json`).then(r => r.json()).catch(() => [])));
  need.forEach((s, i) => { S.brLoaded[s] = true; for (const b of files[i]) { S.branches.push(b); S.brById[b[0]] = b; (S.brByLender[b[1]] = S.brByLender[b[1]] || []).push(b); } });
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
  if (!g) { $('addr-result').textContent = CFG.offline ? 'Enter a 5-digit ZIP code (full address lookup is available on the hosted site).' : 'Address not found. Try adding city, state and ZIP.'; return; }
  S.pt = g; S.st = g.st;
  $('addr-result').innerHTML = `${esc(g.label)}${g.st ? ` <span class="dim">(${g.st})</span>` : ' <span class="dim">(state not resolved; state mode unavailable)</span>'}`;
  history.replaceState(null, '', '?q=' + encodeURIComponent(q));
  run();
}
async function run() {
  if (!S.pt) return;
  const mode = document.querySelector('input[name=mode]:checked').value, rHq = +$('r-hq').value || 10, rHq2 = $('r-hq2').value === '' ? null : +$('r-hq2').value, rBr = +$('r-br').value || 5;
  await ensureBranches(statesNear(S.pt.lat, S.pt.lon, mode === 'hq' ? Math.max(rBr, rHq) : rBr));
  const occ = $('occ').value, amt = parseFloat(($('amt').value || '').replace(/[^0-9.]/g, '')) || null, amtM = amt ? (amt > 1e5 ? amt / 1e6 : amt) : null; // accept dollars or $M
  const fBank = $('f-bank').checked, fThrift = $('f-thrift').checked, fCu = $('f-cu').checked, fFom = $('f-fom').checked, fAny = $('f-anycre').checked;
  const { lat, lon } = S.pt;
  // branch proximity for every lender (one pass over all branches)
  const near = {}, brR = mode === 'hq' ? Math.max(rBr, rHq) : rBr;
  for (const b of S.branches) { const d = hav(lat, lon, b[2], b[3]); if (d <= brR) { const n = near[b[1]] || (near[b[1]] = { n: 0, min: 1e9 }); n.n++; if (d < n.min) n.min = d; } }
  const out = [];
  for (const l of S.lenders) {
    if (l.lat == null) continue;
    if (l.c === 'B' && !(l.cl === 'Savings institution' ? fThrift : fBank)) continue;
    if (l.c === 'C' && !fCu) continue;
    if (l.c === 'C' && !fFom && l.fom && !(l.fom === 'Community' || l.fom.startsWith('State charter'))) continue;
    if (fAny && !(l.cre > 0)) continue;
    if (amtM) { if (l.limit != null && l.limit < amtM) continue; if (l.c === 'C' && l.mblrem != null && l.mblrem < amtM) continue; }
    const d = hav(lat, lon, l.lat, l.lon), nb = near[l.id];
    let ok;
    if (mode === 'hq') ok = d <= rHq;
    else ok = ((S.st && l.st === S.st) || (rHq2 != null && d <= rHq2)) && nb && nb.min <= rBr;
    if (!ok) continue;
    out.push(Object.assign({}, l, { dist: d, nbr: nb ? nb.n : 0, brdist: nb ? nb.min : null }));
  }
  S.results = out; S.rBr = brR; S.mode = mode; S.rHq = rHq;
  renderResults();
  const nB = out.filter(r => r.c === 'B').length, nC = out.length - nB;
  $('summary').innerHTML = `<b>${out.length}</b> lenders (${nB} banks, ${nC} credit unions) · ${mode === 'hq' ? `HQ within ${rHq} mi` : `HQ in ${S.st || 'state'}${rHq2 != null ? ` or within ${rHq2} mi` : ''}, branch within ${rBr} mi`}${amtM ? ` · can lend $${amtM.toFixed(1)}M` : ''} · ${occ === 'inv' ? 'investment' : 'owner-occupied'} scoring`;
  $('csv').disabled = !out.length;
}

/* ---------------- table ---------------- */
function visibleCols() { const occ = $('occ').value; return COLS.filter(c => !c.occ || c.occ === occ); }
function displayCols() { const c = visibleCols(); return [...c.filter(x => x.k === 'n'), ...c.filter(x => x.k !== 'n')]; }   // lender name leads on screen; CSV keeps COLS order
function renderTable() {
  const cols = displayCols(), { key, dir } = S.sort;
  const rows = S.results.slice().sort((a, b) => { const x = a[key], y = b[key]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  $('tbl').querySelector('thead').innerHTML = '<tr>' + cols.map(c => `<th class="${c.cls || ''}" data-k="${c.k}" title="${esc(c.t)}" tabindex="0"${c.k === key ? ` aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''}>${c.l}${c.k === key ? `<span class="sortlbl">${dir > 0 ? 'low first' : 'high first'}</span>` : ''}</th>`).join('') + '</tr>';
  $('tbl').querySelector('tbody').innerHTML = rows.map(r => '<tr data-id="' + r.id + '">' + cols.map(c => `<td class="${c.cls || ''}">${c.f(r)}</td>`).join('') + '</tr>').join('');
}
$('tbl').addEventListener('click', e => {
  const th = e.target.closest('th'); if (th) { const k = th.dataset.k; S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (k === 'n' || k === 'hq' || k === 'dist' ? 1 : -1) }; renderTable(); return; }
  const td = e.target.closest('td.name'); if (td) openLender(td.parentElement.dataset.id);
});

$('tbl').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('th')) e.target.click(); });

/* ---------------- page state: landing vs results ---------------- */
function enterResults() {
  if (document.body.classList.contains('results')) return;
  document.body.classList.replace('landing', 'results');
  $('hdr-drop').appendChild($('search-home'));   // the one search form moves under the header; the compact pill opens it
  if (S.map) S.map.resize();
}
function renderResults() {
  enterResults(); updateSummaries(); syncChips();
  $('list-title').textContent = `${S.results.length} lender${S.results.length === 1 ? '' : 's'} near ${S.pt.label}`;
  renderSponsorSlot(); renderTable(); renderCards(); renderMap();
}

/* ---------------- cards (ranked by score, same order as the table's default sort) ---------------- */
const ranked = () => S.results.slice().sort((a, b) => b.score - a.score);
function typeText(r) { return (r.c === 'B' ? 'Bank' : 'Credit union') + (r.cl === 'Savings institution' ? ', thrift' : '') + (r.c === 'C' && r.licu ? ', low-income designated' : ''); }
function renderCards() {
  const occ = $('occ').value;
  $('cards').innerHTML = ranked().map((r, i) => {
    const stats = [['Score', r.score.toFixed(0)], ['Assets', '$' + fmtM(r.ast, 0) + 'M'],
      occ === 'inv' ? ['Inv. CRE', '$' + fmtM(r.inv, 1) + 'M'] : ['OO CRE', '$' + fmtM(r.oo, 1) + 'M'],
      occ === 'inv' ? ['Inv. CRE / capital', fmtP(r.crecap, 0)] : ['OO CRE / capital', fmtP(r.oocap, 0)],
      ['CRE growth 4Q', fmtP(r.momv, 2)], ['Lending limit', '$' + fmtM(r.limit, 1) + 'M']];
    const near = r.nbr ? `${r.nbr} branch${r.nbr === 1 ? '' : 'es'} near (closest ${r.brdist.toFixed(1)} mi)` : 'No branch within the radius';
    return `<li class="lcard" data-id="${r.id}" tabindex="0" aria-label="${i + 1}. ${esc(r.n)}, tier ${r.tier}, score ${r.score.toFixed(0)}. Open details">
      <div class="lc-tier t${r.tier}"><span class="lc-letter">${r.tier}</span><span class="lc-sub">Tier</span></div>
      <div class="lc-main">
        <div class="lc-top"><span class="lc-rank">${i + 1}</span><span class="lc-name">${esc(r.n)}</span></div>
        <div class="lc-meta">${typeText(r)} · HQ ${esc(r.ci)}, ${r.st}, ${r.dist.toFixed(1)} mi · ${near}</div>
        <dl class="lc-stats">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      </div></li>`;
  }).join('') || '<li class="empty">No lenders match. Try "In state + branch nearby" in Filters, a larger radius, or more lender types.</li>';
}
function highlight(id, on, fromMarker) {
  const m = S.markers && S.markers[id], card = $('cards').querySelector(`[data-id="${id}"]`);
  if (m) m.getElement().classList.toggle('hl', on);
  if (card) { card.classList.toggle('hl', on); if (on && fromMarker && !$('cards').hidden) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}
const cardOf = e => e.target.closest && e.target.closest('.lcard');
$('cards').addEventListener('mouseover', e => { const c = cardOf(e); if (c && !c.contains(e.relatedTarget)) highlight(c.dataset.id, true); });
$('cards').addEventListener('mouseout', e => { const c = cardOf(e); if (c && !c.contains(e.relatedTarget)) highlight(c.dataset.id, false); });
$('cards').addEventListener('focusin', e => { const c = cardOf(e); if (c) highlight(c.dataset.id, true); });
$('cards').addEventListener('focusout', e => { const c = cardOf(e); if (c) highlight(c.dataset.id, false); });
$('cards').addEventListener('click', e => { const c = cardOf(e); if (c) openLender(c.dataset.id); });
$('cards').addEventListener('keydown', e => { const c = cardOf(e); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openLender(c.dataset.id); } });
function setView(v) {
  S.view = v; try { localStorage.setItem('lm.view', v); } catch (e) {}
  $('cards').hidden = v !== 'cards'; $('tablewrap').hidden = v !== 'table';
  $('v-cards').setAttribute('aria-pressed', String(v === 'cards')); $('v-table').setAttribute('aria-pressed', String(v === 'table'));
}
$('v-cards').onclick = () => setView('cards'); $('v-table').onclick = () => setView('table');
setView((() => { try { return localStorage.getItem('lm.view') === 'table' ? 'table' : 'cards'; } catch (e) { return 'cards'; } })());

/* ---------------- map ---------------- */
let popup = null;
function showPopup(lngLat, html) {   // MapLibre's own close glyph is replaced by a text "Close" button
  if (popup) popup.remove();
  popup = new maplibregl.Popup({ closeButton: false, offset: 16, maxWidth: '300px' }).setLngLat(lngLat).setHTML(html + '<div class="pp-actions"><button type="button" class="pp-close">Close</button></div>').addTo(S.map);
  popup.getElement().querySelector('.pp-close').onclick = () => popup.remove();
  return popup;
}
function markerPopup(r) {
  return `<div class="pp"><span class="tier t${r.tier}">${r.tier}</span> <b>${esc(r.n)}</b><div class="dim">${typeText(r)} · HQ ${esc(r.ci)}, ${r.st}</div>
  <dl class="pp-stats"><div><dt>Score</dt><dd>${r.score.toFixed(0)}</dd></div><div><dt>Assets</dt><dd>$${fmtM(r.ast, 0)}M</dd></div><div><dt>Inv. CRE</dt><dd>$${fmtM(r.inv, 1)}M</dd></div></dl>
  <button type="button" class="primary pp-details" onclick="openLender('${r.id}')">Details</button></div>`;
}
function renderMarkers() {
  Object.values(S.markers || {}).forEach(m => m.remove()); S.markers = {};
  for (const r of ranked().reverse()) {   // best-ranked added last so it sits on top
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'mk'; el.tabIndex = -1; el.textContent = r.tier; el.style.setProperty('--tc', TIERC[r.tier]);
    el.setAttribute('aria-label', `${r.n}, tier ${r.tier}`);
    el.addEventListener('mouseenter', () => highlight(r.id, true, true)); el.addEventListener('mouseleave', () => highlight(r.id, false));
    el.addEventListener('click', e => { e.stopPropagation(); showPopup([r.lon, r.lat], markerPopup(r)); });
    S.markers[r.id] = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([r.lon, r.lat]).addTo(S.map);
  }
}

const TIERC = { A: '#1a7f37', B: '#3f7d1c', C: '#856a00', D: '#b4530a', E: '#b42318' };   // match --tA..--tE in app.css (4.5:1 on white)
function initMap() {
  const style = CFG.offline ? { version: 8, sources: { states: { type: 'geojson', data: CFG.data + 'us-states.json' } }, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dfe6ee' } }, { id: 'states', type: 'fill', source: 'states', paint: { 'fill-color': '#f4f6f8', 'fill-outline-color': '#b7c2cf' } }, { id: 'states-line', type: 'line', source: 'states', paint: { 'line-color': '#9fb0c2', 'line-width': 0.8 } }] } : CFG.tiles;
  S.map = new maplibregl.Map({ container: 'map', style, center: [-96, 38.5], zoom: 3.6, attributionControl: !CFG.offline });
  S.map.addControl(new maplibregl.NavigationControl(), 'top-right');
  const lg = document.createElement('div'); lg.className = 'legend'; lg.innerHTML = Object.entries(TIERC).map(([t, c]) => `<span style="color:${c}">Tier ${t}</span>`).join('') + '<span>Letters: headquarters</span><span>Dots: branches</span><span>Ring: property</span>'; $('map').appendChild(lg);
  S.map.on('load', () => {
    S.map.addSource('circle', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    S.map.addLayer({ id: 'circle', type: 'fill', source: 'circle', paint: { 'fill-color': '#2d6fd1', 'fill-opacity': 0.06 } });
    S.map.addLayer({ id: 'circle-line', type: 'line', source: 'circle', paint: { 'line-color': '#2d6fd1', 'line-width': 1.5, 'line-dasharray': [2, 2] } });
    S.map.addSource('br', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    S.map.addLayer({ id: 'br', type: 'circle', source: 'br', paint: { 'circle-radius': 4, 'circle-color': ['get', 'color'], 'circle-opacity': 0.75, 'circle-stroke-color': '#333', 'circle-stroke-width': 0.6 } });
    S.map.addSource('pin', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    S.map.addLayer({ id: 'pin', type: 'circle', source: 'pin', paint: { 'circle-radius': 7, 'circle-color': '#fff', 'circle-stroke-color': '#111', 'circle-stroke-width': 3 } });
    S.map.on('mouseenter', 'br', () => S.map.getCanvas().style.cursor = 'pointer'); S.map.on('mouseleave', 'br', () => S.map.getCanvas().style.cursor = '');
    S.map.on('click', 'br', e => { const p = e.features[0].properties; showPopup(e.lngLat, branchPopup(p.bid)); });
    S.map.on('click', async e => {
      if (S.map.queryRenderedFeatures(e.point, { layers: ['br'] }).length) return;
      const { lat, lng } = e.lngLat; S.pt = { lat, lon: lng, st: await stateAt(lat, lng).catch(() => null), label: `Dropped pin ${lat.toFixed(4)}, ${lng.toFixed(4)}` }; S.st = S.pt.st;
      $('addr-result').innerHTML = `${esc(S.pt.label)}${S.st ? ` <span class="dim">(${S.st})</span>` : ''}`; $('addr').value = ''; history.replaceState(null, '', location.pathname); run();
    });
    if (S.results.length) renderMap();
  });
}
function circlePoly(lat, lon, mi) { const pts = []; for (let i = 0; i <= 64; i++) { const a = i / 64 * 2 * Math.PI; pts.push([lon + (mi / 69.172 / Math.cos(lat * Math.PI / 180)) * Math.cos(a), lat + (mi / 68.703) * Math.sin(a)]); } return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } }; }
function renderMap() {
  if (!S.map || !S.map.getSource('pin')) return;
  const { lat, lon } = S.pt, ids = new Set(S.results.map(r => r.id));
  S.map.getSource('pin').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] } }] });
  S.map.getSource('circle').setData({ type: 'FeatureCollection', features: [circlePoly(lat, lon, S.mode === 'hq' ? S.rHq : S.rBr)] });
  renderMarkers();
  const brs = [];
  for (const b of S.branches) if (ids.has(b[1]) && hav(lat, lon, b[2], b[3]) <= S.rBr) brs.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [b[3], b[2]] }, properties: { bid: b[0], color: TIERC[S.byId[b[1]].tier] } });
  S.map.getSource('br').setData({ type: 'FeatureCollection', features: brs });
  const bb = new maplibregl.LngLatBounds([lon, lat], [lon, lat]); S.results.forEach(r => bb.extend([r.lon, r.lat])); const c = circlePoly(lat, lon, S.mode === 'hq' ? S.rHq : S.rBr); c.geometry.coordinates[0].forEach(p => bb.extend(p));
  S.map.fitBounds(bb, { padding: 40, maxZoom: 12, duration: 600 });
}

/* ---------------- branches ---------------- */
function branchStats(lid) {
  const rows = S.brByLender[lid] || [], last = S.years.length - 1, tot = rows.reduce((s, b) => s + (b[9][last] || 0), 0);
  const nonMain = rows.filter(b => !b[8] && b[9][last] != null).sort((a, b) => b[9][last] - a[9][last]);
  const q = {}; nonMain.forEach((b, i) => q[b[0]] = Math.min(4, Math.floor(i / nonMain.length * 4) + 1));
  return rows.map(b => { const d = b[9], v = d[last], y1 = d[last - 1], y5 = d[last - 5], y10 = d[0]; return { b, dep: v, g1: v != null && y1 ? (v / y1 - 1) * 100 : null, g5: v != null && y5 ? (v / y5 - 1) * 100 : null, g10: v != null && y10 ? (v / y10 - 1) * 100 : null, share: v != null && tot ? v / tot * 100 : null, quart: q[b[0]] || null, main: !!b[8], n: nonMain.length }; });
}
function branchPopup(bid) {
  const b = S.brById[bid], l = S.byId[b[1]], st = branchStats(l.id).find(x => x.b[0] === bid);
  let h = `<b>${esc(b[4])}</b><br>${esc(b[5])}, ${b[6]} ${b[7]}<br>Owner: <a onclick="openLender('${l.id}')">${esc(l.n)}</a> (${l.c === 'B' ? 'bank' : 'credit union'}, Tier ${l.tier})`;
  if (l.c === 'C') h += '<br><span class="dim">NCUA publishes no branch-level deposits.</span>';
  else if (st.dep == null) h += '<br><span class="dim">No Summary of Deposits record (opened after June 30 or non-deposit office).</span>';
  else {
    h += `<br>Deposits (June ${S.years[S.years.length - 1]}): <b>$${(st.dep / 1000).toFixed(1)}M</b>`;
    h += `<br>1-yr ${st.g1 == null ? '–' : st.g1.toFixed(1) + '%'} · 5-yr ${st.g5 == null ? '–' : st.g5.toFixed(1) + '%'} · 10-yr ${st.g10 == null ? '–' : st.g10.toFixed(1) + '%'}`;
    h += `<br>${st.share == null ? '' : st.share.toFixed(1) + '% of this lender\'s branch deposits'}`;
    h += st.main ? '<br><span class="dim">Main office: often carries internet, brokered and corporate deposits; excluded from branch quartiles.</span>' : (st.quart ? `<br>Quartile ${st.quart} of ${st.n} branches by deposits (1 = largest)` : '');
  }
  return h;
}

/* ---------------- lender drawer ---------------- */
const HIST_ROWS = [
  ['Balance sheet'], ['dep', 'Total deposits ($M)', 'M0'], ['ast', 'Total assets ($M)', 'M0'], ['loans', 'Total loans ($M)', 'M0'], ['ltd', 'Loan to deposit', 'P1'], ['t1', 'Tier 1 leverage', 'P2'], ['nwr', 'Net worth ratio', 'P2'],
  ['Earnings'], ['fc', 'Funding cost', 'P2'], ['nim', 'NIM (avg assets)', 'P2'], ['nimp', 'NIM (FDIC published)', 'P2'], ['yield', 'Blended loan yield', 'P2'], ['rate', 'Reported CRE rate (CU)', 'P2'], ['roa', 'ROA', 'P2'],
  ['CRE exposure'], ['crecap', 'Investment CRE / capital', 'P0'], ['conscap', 'Construction / capital', 'P0'], ['oocap', 'OO CRE / capital', 'P0'], ['inv', 'Investment CRE ($M)', 'M1'], ['nonoo', '  Non-owner-occ nonres ($M)', 'M1'], ['mf', '  Multifamily ($M)', 'M1'], ['cons', '  Construction & land ($M)', 'M1'], ['oo', 'Owner-occupied CRE ($M)', 'M1'], ['cre', 'Total CRE ($M)', 'M1'], ['creloans', 'Total CRE / loans', 'P1'],
  ['CRE activity'], ['chg', 'CRE lent YTD, net change ($M)', 'M1'], ['invchg', 'Investment CRE net change YTD ($M)', 'M1'], ['mom', 'CRE growth, trailing 4Q (% assets)', 'P2'], ['granted', 'CRE granted YTD ($M, CU)', 'M1'], ['grantedn', 'CRE loans granted YTD (#, CU)', 'I'], ['avgloan', 'Avg CRE loan granted ($M, CU)', 'M2'],
  ['Capacity'], ['caprem', 'Room to 300% of capital ($M, bank)', 'M0'], ['consrem', 'Room to 100% construction ($M, bank)', 'M0'], ['mblused', 'MBL cap used (CU)', 'P0'], ['mblrem', 'MBL cap remaining ($M, CU)', 'M0'], ['limit', 'Est. lending limit ($M)', 'M1'], ['capbase', 'Capital base ($M)', 'M0'],
  ['Funding & quality'], ['brok', 'Brokered deposits % (bank)', 'P1'], ['nonmem', 'Non-member deposits % (CU)', 'P1'], ['depgro', 'Deposit growth, 4Q', 'P1'], ['npl', 'Non-performing loans', 'P2'], ['crenpl', 'CRE non-performing (bank)', 'P2'],
];
const fmtH = (v, f) => v == null ? '<span class="na">–</span>' : f[0] === 'P' ? v.toFixed(+f[1]) + '%' : f[0] === 'M' ? v.toLocaleString('en-US', { minimumFractionDigits: +f[1], maximumFractionDigits: +f[1] }) : v.toLocaleString('en-US');
async function getHist(id) {
  if (S.hist[id]) return S.hist[id];
  if (CFG.histMode === 'lender') { S.hist[id] = await fetch(`${CFG.data}history/${id}.json`).then(r => r.json()); return S.hist[id]; }
  const st = S.byId[id].st; if (!S.histState[st]) S.histState[st] = await fetch(`${CFG.data}history_state/${st}.json`).then(r => r.json());
  return S.histState[st][id];
}
window.openLender = async function (id) {
  const l = S.byId[id]; openDialog('drawer');
  $('drawer-content').innerHTML = `<h2>${esc(l.n)}</h2><div class="meta">Loading history…</div>`;
  const h = await getHist(id).catch(() => null);
  await ensureBranches(l.bst || []).catch(() => null);
  const occ = $('occ').value, w = weights(), c = l.sc, mom = occ === 'inv' ? c.mom_inv : c.mom_oo, fr = occ === 'inv' ? c.fr_inv : c.fr_oo;
  let html = `<h2>${esc(l.n)} <span class="tier t${l.tier}">${l.tier}</span></h2>
  <div class="meta">${l.c === 'B' ? l.cl : l.cl} · HQ ${esc(l.ci)}, ${l.st} ${l.zip || ''}${l.hc ? ` · Holding co: ${esc(l.hc)}` : ''}${l.fom ? ` · Field of membership: ${esc(l.fom)}` : ''}${l.licu ? ' · Low-income designated (MBL cap exempt)' : ''}${l.cb ? ' · FDIC community bank' : ''}${l.web ? ` · <a href="${/^https?:/.test(l.web) ? l.web : 'https://' + l.web}" target="_blank" rel="noopener">website</a>` : ''} · ${l.nb} offices · capital base: ${l.captype} · data ${l.per}</div>
  <div class="cards">
    <div class="card"><div class="k">Score (${occ === 'inv' ? 'investment' : 'owner-occ'})</div><div class="v">${l.score.toFixed(0)}</div></div>
    <div class="card"><div class="k">CRE momentum pct</div><div class="v">${mom.toFixed(0)}</div></div>
    <div class="card"><div class="k">CRE franchise pct</div><div class="v">${fr.toFixed(0)}</div></div>
    <div class="card"><div class="k">Deposit growth pct</div><div class="v">${c.gro.toFixed(0)}</div></div>
    <div class="card"><div class="k">Asset quality pct</div><div class="v">${c.qual.toFixed(0)}</div></div>
    <div class="card"><div class="k">Capital pct</div><div class="v">${c.cap.toFixed(0)}</div></div>
    <div class="card"><div class="k">Margin pct</div><div class="v">${c.mar.toFixed(0)}</div></div>
    <div class="card"><div class="k">Penalties</div><div class="v">${(() => { const p = l.score / ((w.mom * mom + w.fr * fr + w.gro * c.gro + w.qual * c.qual + w.cap * c.cap + w.mar * c.mar) / Math.max(1, w.mom + w.fr + w.gro + w.qual + w.cap + w.mar)); return p < 0.995 ? '×' + p.toFixed(2) : 'none'; })()}</div></div>
    <div class="card"><div class="k">Assets</div><div class="v">$${fmtM(l.ast, 0)}M</div></div>
    <div class="card"><div class="k">Investment CRE</div><div class="v">$${fmtM(l.inv, 0)}M</div></div>
    <div class="card"><div class="k">Est. lending limit</div><div class="v">$${fmtM(l.limit, 1)}M</div></div>
  </div>`;
  if (h) {
    const qs = h.q, same = qs[qs.length - 1].slice(2), annual = qs.map((q, i) => i).filter(i => qs[i].slice(2) === same);
    const build = idx => `<div class="histwrap"><table class="hist"><thead><tr><th>Metric</th>${idx.map(i => `<th>${qs[i]}</th>`).join('')}</tr></thead><tbody>` +
      HIST_ROWS.map(r => r.length === 1 ? `<tr class="sep"><td colspan="${idx.length + 1}"><b>${r[0]}</b></td></tr>` : `<tr><td>${r[1]}</td>${idx.map(i => `<td>${fmtH(h[r[0]] ? h[r[0]][i] : null, r[2])}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>';
    html += `<h3>History</h3><div class="toggle"><a id="h-annual" class="on">Same quarter each year (${same})</a><a id="h-quarterly">All quarters</a></div><div id="hist-tbl">${build(annual)}</div>`;
    setTimeout(() => { $('h-annual').onclick = () => { $('hist-tbl').innerHTML = build(annual); $('h-annual').classList.add('on'); $('h-quarterly').classList.remove('on'); }; $('h-quarterly').onclick = () => { $('hist-tbl').innerHTML = build(qs.map((q, i) => i)); $('h-quarterly').classList.add('on'); $('h-annual').classList.remove('on'); }; }, 0);
  } else html += '<div class="meta">History unavailable.</div>';
  const bs = branchStats(id).sort((a, b) => (b.dep || 0) - (a.dep || 0));
  html += `<h3>Branches (${bs.length})</h3>`;
  if (l.c === 'B') html += `<div class="histwrap"><table class="hist"><thead><tr><th>Office</th><th>City</th><th>St</th><th>Deposits $M (Jun ${S.years[S.years.length - 1]})</th><th>1-yr</th><th>5-yr</th><th>10-yr</th><th>Share</th><th>Quartile</th>${S.pt ? '<th>Miles</th>' : ''}</tr></thead><tbody>` +
    bs.map(s => `<tr><td>${esc(s.b[4])}${s.main ? ' <span class="dim">(main office)</span>' : ''}</td><td>${esc(s.b[5])}</td><td>${s.b[6]}</td><td>${s.dep == null ? '–' : (s.dep / 1000).toFixed(1)}</td><td>${s.g1 == null ? '–' : s.g1.toFixed(1) + '%'}</td><td>${s.g5 == null ? '–' : s.g5.toFixed(1) + '%'}</td><td>${s.g10 == null ? '–' : s.g10.toFixed(1) + '%'}</td><td>${s.share == null ? '–' : s.share.toFixed(1) + '%'}</td><td>${s.main ? 'n/a' : (s.quart || '–')}</td>${S.pt ? `<td>${hav(S.pt.lat, S.pt.lon, s.b[2], s.b[3]).toFixed(1)}</td>` : ''}</tr>`).join('') + '</tbody></table></div><div class="hint">Branch deposits from the FDIC Summary of Deposits (annual, June 30). Main offices often book internet, brokered and corporate deposits and are excluded from quartile ranks.</div>';
  else html += `<div class="histwrap"><table class="hist"><thead><tr><th>Office</th><th>Address</th><th>City</th><th>St</th>${S.pt ? '<th>Miles</th>' : ''}</tr></thead><tbody>` + bs.map(s => `<tr><td>${esc(s.b[4])}${s.main ? ' <span class="dim">(main office)</span>' : ''}</td><td></td><td>${esc(s.b[5])}</td><td>${s.b[6]}</td>${S.pt ? `<td>${hav(S.pt.lat, S.pt.lon, s.b[2], s.b[3]).toFixed(1)}</td>` : ''}</tr>`).join('') + '</tbody></table></div><div class="hint">NCUA publishes branch locations but no branch-level deposits.</div>';
  $('drawer-content').innerHTML = html;
};

/* ---------------- CSV ---------------- */
function csv() {
  const cols = visibleCols(); const rows = S.results.slice().sort((a, b) => b.score - a.score);
  const val = (r, c) => { const v = c.k === 'brok' ? (r.c === 'B' ? r.brok : r.nonmem) : c.k === 'head' ? (r.c === 'B' ? r.caprem : r.mblrem) : c.k === 'mom' ? r.momv : c.k === 'chg' ? r.chgv : c.k === 'hq' ? `${r.ci}, ${r.st}` : c.k === 'c' ? (r.c === 'B' ? 'Bank' : 'CU') : r[c.k]; return v == null ? '' : typeof v === 'number' ? (Number.isInteger(v) ? v : +v.toFixed(3)) : `"${String(v).replace(/"/g, '""')}"`; };
  const txt = cols.map(c => `"${c.l}"`).join(',') + '\n' + rows.map(r => cols.map(c => val(r, c)).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = `lenders_${(S.pt.label || 'search').replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.csv`; a.click();
}

/* ---------------- definitions & about ---------------- */
const DEFS = [
  ['Scope', 'Every FDIC-insured bank and savings institution (FDIC BankFind Suite: Call Reports, Summary of Deposits) and every federally insured credit union (NCUA Form 5300), quarterly 2016Q1 to the latest quarter. Dollar figures in millions. History shows the same quarter each year so year-to-date items compare like with like.'],
  ['Score and tiers', 'Each component is a national percentile (0-100). Score = weighted average × cap penalty. Components: CRE momentum (trailing 4-quarter change in investment or owner-occupied CRE as % of assets), CRE franchise (CRE share of loans and CRE % of capital), deposit growth (4 quarters), asset quality (lower NPLs; banks also CRE NPLs), capital (tier 1 leverage), margin (NIM). Tiers A-E are national quintiles. Default weights reflect which metrics predicted next-year CRE growth 2016-2026 out of sample (rank correlation 0.37 banks, 0.33 credit unions).'],
  ['Cap penalty', 'Banks above 400% of capital in investment CRE ×0.85, above 500% ×0.70, construction above 150% ×0.90. Non-LICU credit unions at 90-100% of the business-loan cap ×0.80. These are the ranges where lending growth actually slowed historically; the 300% regulatory guidance alone did not.'],
  ['Investment vs owner-occupied', 'Investment CRE = non-owner-occupied nonfarm nonresidential + multifamily + construction & land development (the 2006 interagency concentration definition). Owner-occupied = loans secured by owner-occupied nonfarm nonresidential property, which fall outside the 300% guidance. Call reports split only these categories: no office/retail/industrial detail exists.'],
  ['Capital base', 'Banks: total risk-based capital. About 1,800 community banks use the Community Bank Leverage Ratio and report no risk-based capital; for them tier 1 capital + loan-loss allowance is used (examiner convention) and the lender page says so. Credit unions: net worth.'],
  ['Credit-union business-loan cap', 'Statutory cap = lesser of 1.75× net worth or 12.25% of assets. Low-income-designated credit unions (about half) are exempt and shown as "exempt". Net member business loan balance per NCUA definition.'],
  ['Funding cost / NIM', 'Computed identically for both charters: annualized year-to-date interest expense / average deposits + borrowings; net interest income / average assets. FDIC-published ratios (on earning assets) are shown in the lender history for reference.'],
  ['Brokered deposits', 'Banks: brokered deposits / total deposits. NCUA collects no brokered-deposit dollar amount, only a yes/no flag; non-member deposits % is shown for credit unions as the nearest analog.'],
  ['CRE lent YTD', 'Net change in CRE balances since December 31, both charters; understates originations by payoffs. Credit unions additionally report real-estate-secured commercial loans granted year-to-date (count and dollars), shown as "granted" and "avg loan". Banks report no originations.'],
  ['CRE rate', 'Credit unions report the rate on real-estate-secured commercial loans (NCUA account 525, since 2017Q3). Banks report no loan-level rates; the blended loan yield (interest income / average loans) is shown for both.'],
  ['Non-performing loans', 'Banks: loans 90+ days past due plus nonaccrual, / gross loans. Credit unions: loans 60+ days delinquent / loans. Shown as reported; definitions differ.'],
  ['Lending limit', 'Estimate = 15% of the capital base. National banks: 15% of capital and surplus unsecured (state limits range roughly 15-25%). Credit unions: 15% of net worth to one borrower. Used only to drop lenders that could not hold the requested amount alone.'],
  ['Branches', 'Bank branch deposits: FDIC Summary of Deposits as of June 30 each year. Quartile = rank within the owning bank\'s non-main-office branches by deposits. Main offices are excluded because they often carry internet, brokered and corporate deposits. Credit-union branches are shown from the NCUA branch file without deposits; addresses were geocoded (Census), with ZIP-centroid fallback.'],
  ['Mergers', 'History is as reported under each charter. An acquired institution keeps its own pre-merger history; the acquirer shows its own.'],
  ['Credit-union field of membership', 'Default results include community-charter credit unions and state charters (whose field of membership NCUA does not classify). Single- and multiple-common-bond credit unions can lend only to members and are hidden unless the box is checked.'],
];
function showModal(html) { $('modal-content').innerHTML = html; openDialog('modal'); }
$('btn-defs').onclick = e => { e.preventDefault(); showModal('<h2>Definitions</h2><dl class="defs">' + DEFS.map(d => `<dt>${d[0]}</dt><dd>${d[1]}</dd>`).join('') + '</dl>'); };
$('btn-about').onclick = e => { e.preventDefault(); showModal(`<h2>About</h2><p>Free tool for commercial real estate borrowers to find the depository lenders most likely to lend on a property, using only public regulatory filings. Nothing here is a recommendation, an offer of credit, or a statement by any lender.</p>
<dl class="defs"><dt>Sources</dt><dd>FDIC BankFind Suite API (institutions, locations, quarterly financials from Call Reports, Summary of Deposits); NCUA 5300 Call Report quarterly data and Credit Union Branch Information files; FRED (fed funds, SOFR, Treasury yields, Senior Loan Officer Survey); U.S. Census Bureau geocoder; OpenStreetMap / Photon for address lookup; OpenFreeMap tiles.</dd>
<dt>Refresh</dt><dd>Bank and credit-union call reports are published roughly 60 days after each quarter end; branch deposits once a year (June 30 data, published late September). The site rebuilds automatically when new data appears.</dd>
<dt>Method notes</dt><dd>A panel of ${(430927).toLocaleString()} lender-quarters (2016-2026) was used to test which current metrics predict the next four quarters of CRE growth. The strongest, in order: trailing CRE growth, CRE share of loans, CRE and construction as % of capital, size, deposit growth; non-performing loans reduce it. Capital headroom only matters at the extremes. Those findings set the default weights and penalties; weights are adjustable.</dd></dl>`); };
/* dialogs (drawer, Definitions/About modal, Filters): focus moves in, Tab stays inside, Esc or Close returns focus */
const DIALOGS = ['filters', 'modal', 'drawer'], opener = {};
function openDialog(id) {
  const el = $(id); if (el.classList.contains('hidden')) opener[id] = document.activeElement;
  el.classList.remove('hidden'); (el.querySelector('.close') || el).focus();
}
function closeDialog(id) { const el = $(id); if (el.classList.contains('hidden')) return; el.classList.add('hidden'); const o = opener[id]; if (o && document.contains(o)) o.focus(); }
const topDialog = () => ['drawer', 'modal', 'filters'].find(id => !$(id).classList.contains('hidden'));
for (const id of DIALOGS) { $(id + '-close').onclick = () => closeDialog(id); $(id).addEventListener('click', e => { if (e.target.id === id) closeDialog(id); }); }
document.addEventListener('keydown', e => {
  const id = topDialog(); if (!id) return;
  if (e.key === 'Escape') { e.stopImmediatePropagation(); closeDialog(id); return; }
  if (e.key !== 'Tab') return;
  const f = [...$(id).querySelectorAll('button, a[href], a[onclick], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
}, true);

/* ---------------- search bar: segments, pop-overs, compact pill ---------------- */
function typesLabel() {
  const on = [['f-bank', 'Banks'], ['f-thrift', 'Thrifts'], ['f-cu', 'Credit unions']].filter(([id]) => $(id).checked).map(x => x[1]);
  return on.length === 3 ? 'All types' : on.length ? on.join(', ') : 'None selected';
}
function amtLabel() { const v = $('amt').value.trim(); return v ? '$' + v.replace(/^\$/, '') : 'Any amount'; }
function updateSummaries() {
  const occ = $('occ').value === 'inv' ? 'Investment' : 'Owner-occupied', types = typesLabel();
  $('occ-val').textContent = occ; $('occ-val').classList.add('set');
  document.querySelectorAll('input[name=occ-r]').forEach(r => r.checked = r.value === $('occ').value);
  $('types-val').textContent = types; $('types-val').classList.toggle('set', types !== 'All types');
  $('pc-addr').textContent = S.pt ? S.pt.label : 'Address'; $('pc-occ').textContent = occ; $('pc-amt').textContent = amtLabel(); $('pc-types').textContent = types;
  $('pill-compact').setAttribute('aria-label', `Edit search: ${S.pt ? S.pt.label : 'no address'}, ${occ}, ${amtLabel()}, ${types}`);
}
function closePops() {
  document.querySelectorAll('.seg-pop').forEach(s => { s.classList.remove('on'); s.querySelector('.pop').hidden = true; s.querySelector('.seg-btn').setAttribute('aria-expanded', 'false'); });
  $('searchbar').classList.remove('active');
}
function togglePop(seg) {
  const open = !seg.classList.contains('on'); closePops();
  if (!open) return;
  seg.classList.add('on'); seg.querySelector('.pop').hidden = false; seg.querySelector('.seg-btn').setAttribute('aria-expanded', 'true'); $('searchbar').classList.add('active');
  const first = seg.querySelector('.pop input:checked') || seg.querySelector('.pop input'); if (first) first.focus();
}
document.querySelectorAll('.seg-pop .seg-btn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); togglePop(b.closest('.seg-pop')); }));
document.querySelectorAll('.seg-pop .pop').forEach(p => p.addEventListener('click', e => e.stopPropagation()));
document.addEventListener('click', e => { if (!e.target.closest('.seg-pop')) closePops(); if (!e.target.closest('#hdr-drop, #pill-compact')) closeSearchPanel(); });
document.querySelectorAll('input[name=occ-r]').forEach(r => r.addEventListener('change', () => { $('occ').value = r.value; $('occ').dispatchEvent(new Event('change')); updateSummaries(); }));
['f-bank', 'f-thrift', 'f-cu'].forEach(id => $(id).addEventListener('change', updateSummaries));
$('amt').addEventListener('input', updateSummaries);
function openSearchPanel() { $('hdr-drop').hidden = false; $('pill-compact').setAttribute('aria-expanded', 'true'); $('addr').focus(); $('addr').select(); }
function closeSearchPanel() { if ($('hdr-drop').hidden) return; closePops(); $('hdr-drop').hidden = true; $('pill-compact').setAttribute('aria-expanded', 'false'); }
$('pill-compact').addEventListener('click', e => { e.stopPropagation(); $('hdr-drop').hidden ? openSearchPanel() : closeSearchPanel(); });
async function searchFromBar() {
  closePops(); const before = S.pt;
  if (document.body.classList.contains('results') && $('addr').value.trim()) $('cards').innerHTML = skeletons(4, 'lcard');
  await search();
  if (S.pt === before && S.results.length) renderCards();   // lookup failed: put the previous results back
  if (S.pt && S.pt !== before) { closeSearchPanel(); updateSummaries(); }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !topDialog()) { const wasOpen = !!document.querySelector('.seg-pop.on'); closePops(); if (wasOpen) return; closeSearchPanel(); } });

/* ---------------- filter chips and Filters modal ---------------- */
const DEF = { mode: 'hq', 'r-hq': '10', 'r-hq2': '100', 'r-br': '5', 'f-fom': false, 'f-anycre': true, w: { 'w-mom': 25, 'w-fr': 25, 'w-gro': 15, 'w-qual': 15, 'w-cap': 10, 'w-mar': 10 } };
const modeNow = () => document.querySelector('input[name=mode]:checked').value;
function syncChips() {
  const occ = $('occ').value, mode = modeNow();
  document.querySelectorAll('.chip[data-occ]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.occ === occ)));
  document.querySelectorAll('.chip[data-type]').forEach(c => c.setAttribute('aria-pressed', String($(c.dataset.type).checked)));
  $('chip-amt').textContent = $('amt').value.trim() ? 'Amount ' + amtLabel() : 'Add amount';
  $('chip-amt').setAttribute('aria-pressed', String(!!$('amt').value.trim()));
  $('chip-geo').textContent = mode === 'hq' ? `HQ within ${$('r-hq').value || 10} mi` : `In ${S.st || 'state'} + branch within ${$('r-br').value || 5} mi`;
  $('filters').dataset.mode = mode;
  const n = (mode !== DEF.mode) + ['r-hq', 'r-hq2', 'r-br'].filter(k => $(k).value !== DEF[k]).length + ($('f-fom').checked !== DEF['f-fom']) + ($('f-anycre').checked !== DEF['f-anycre']) + Object.entries(DEF.w).some(([k, v]) => +$(k).value !== v);
  $('fcount').textContent = n ? n : '';
  $('btn-filters').setAttribute('aria-label', n ? `Filters, ${n} changed` : 'Filters');
  $('f-apply').textContent = S.pt ? `Show ${S.results.length} lender${S.results.length === 1 ? '' : 's'}` : 'Done';
}
document.querySelectorAll('.chip[data-occ]').forEach(c => c.onclick = () => { if ($('occ').value === c.dataset.occ) return; $('occ').value = c.dataset.occ; $('occ').dispatchEvent(new Event('change')); updateSummaries(); syncChips(); });
document.querySelectorAll('.chip[data-type]').forEach(c => c.onclick = () => { const b = $(c.dataset.type); b.checked = !b.checked; b.dispatchEvent(new Event('change')); syncChips(); });
$('chip-amt').onclick = e => { e.stopPropagation(); openSearchPanel(); $('amt').focus(); };
$('chip-geo').onclick = () => openDialog('filters');
$('btn-filters').onclick = () => openDialog('filters');
$('f-apply').onclick = () => closeDialog('filters');
document.querySelectorAll('input[name=mode], #r-hq, #r-hq2, #r-br, #f-fom, #f-anycre').forEach(el => el.addEventListener('change', syncChips));
$('f-reset').onclick = () => {
  document.querySelector(`input[name=mode][value=${DEF.mode}]`).checked = true;
  ['r-hq', 'r-hq2', 'r-br'].forEach(k => $(k).value = DEF[k]); $('f-fom').checked = DEF['f-fom']; $('f-anycre').checked = DEF['f-anycre'];
  Object.entries(DEF.w).forEach(([k, v]) => $(k).value = v);
  rescoreAll(); syncChips(); run();
};

/* ---------------- placements (featured.json): never touch score, tier or result order ---------------- */
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
  return `<li class="pcard">
    <button type="button" class="pc-main" data-id="${l.id}" aria-label="${esc(l.n)}${isPaid(p) ? ', sponsored' : ''}, tier ${l.tier}. Open details">
      <span class="pc-tile t${l.tier}"><span class="pc-letter">${l.tier}</span><span class="pc-sub">Tier</span>${isPaid(p) ? '<span class="pc-badge">Sponsored</span>' : ''}</span>
      <span class="pc-name">${esc(l.n)}</span>
      <span class="pc-meta">${typeText(l)} · ${esc(l.ci)}, ${l.st}</span>
      <span class="pc-blurb">${esc(p.blurb || '')}</span>
    </button>
    ${p.profile_url ? `<a class="pc-profile" href="${esc(p.profile_url)}" target="_blank" rel="noopener sponsored">View profile</a>` : ''}
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
  fillRow('row-sponsored', inState.length ? inState : ['<li class="pcard-empty">No sponsored lenders in this state yet.</li>']);
  $('row-sponsored').hidden = !sp.length;
}
// A labeled slot above the ranked list for one sponsored lender in the property's state. Not numbered, not ranked.
function renderSponsorSlot() {
  const p = S.st && activePlacements('sponsored').find(p => (p.states || []).includes(S.st)), l = p && S.byId[p.id];
  $('sponsor-slot').innerHTML = l ? `<div class="sslot"><span class="lbl">Sponsored</span>
    <button type="button" class="ss-main" data-id="${l.id}" aria-label="Sponsored: ${esc(l.n)}, tier ${l.tier}. Open details"><span class="tier t${l.tier}">${l.tier}</span> <b>${esc(l.n)}</b> <span class="dim">${typeText(l)} · ${esc(l.ci)}, ${l.st}</span><span class="ss-blurb">${esc(p.blurb || '')}</span></button>
    ${p.profile_url ? `<a href="${esc(p.profile_url)}" target="_blank" rel="noopener sponsored">View profile</a>` : ''}
    <span class="hint">Sponsored placement. It does not change any lender's score, tier or position in the ranked list below.</span></div>` : '';
}
document.addEventListener('click', e => { const b = e.target.closest('.pc-main, .ss-main'); if (b && S.byId[b.dataset.id]) openLender(b.dataset.id); });
document.querySelectorAll('.lrow-nav button').forEach(b => b.onclick = () => { const t = b.closest('.lrow').querySelector('.lrow-track'); t.scrollBy({ left: +b.dataset.dir * t.clientWidth * 0.9, behavior: 'smooth' }); });
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

/* ---------------- phones: list or map, one at a time ---------------- */
$('maptoggle').onclick = () => {
  const show = !document.body.classList.contains('show-map');
  document.body.classList.toggle('show-map', show);
  $('maptoggle').textContent = show ? 'Show list' : 'Show map';
  window.scrollTo(0, 0);
  if (show && S.map) { S.map.resize(); if (S.pt) renderMap(); }
};
window.matchMedia('(min-width: 768px)').addEventListener('change', e => { if (e.matches) { document.body.classList.remove('show-map'); $('maptoggle').textContent = 'Show map'; if (S.map) S.map.resize(); } });

/* ---------------- lender name search ---------------- */
// NCUA names drop "credit union" ("TEXAS DOW EMPLOYEES"), so also match acronyms: TDE, TDECU, TDEFCU
const NORM = s => (s || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim();
const CU_WORDS = new Set(['CREDIT', 'UNION', 'CU', 'FCU', 'FEDERAL']), SKIP = new Set(['THE', 'OF', 'AND']);
function nameIndex() {
  if (S.nameIdx) return S.nameIdx;
  S.nameIdx = S.lenders.map(l => {
    const words = NORM(l.n).split(' ').filter(Boolean), acr = words.filter(w => !SKIP.has(w)).map(w => w[0]).join('');
    const keys = l.c === 'C' ? [acr, acr + 'CU', acr + 'FCU'] : [acr, acr + 'B'];
    return { l, words, flat: words.join(''), keys };
  });
  return S.nameIdx;
}
function findLenders(q) {
  const qn = NORM(q), flat = qn.replace(/ /g, ''), toks = qn.split(' ').filter(Boolean); if (!flat) return [];
  const hits = [];
  for (const e of nameIndex()) {
    let s = null;
    if (e.flat === flat) s = 0;
    else if (flat.length >= 2 && e.keys.includes(flat)) s = 1;
    else if (e.flat.startsWith(flat)) s = 2;
    else if (toks.every(t => e.words.some(w => w.startsWith(t)) || (e.l.c === 'C' && CU_WORDS.has(t)) || (e.l.c === 'B' && t === 'BANK'))
      && toks.some(t => e.words.some(w => w.startsWith(t)))) s = 3;
    if (s != null) hits.push([s, e.l]);
  }
  return hits.sort((a, b) => a[0] - b[0] || (b[1].ast || 0) - (a[1].ast || 0)).slice(0, 12).map(h => h[1]);
}
function showSuggest() {
  const q = $('lname').value, box = $('lsugg');
  if (!q.trim() || !S.lenders.length) { box.classList.add('hidden'); return; }
  S.lhits = findLenders(q); S.lsel = 0;
  box.innerHTML = S.lhits.length ? S.lhits.map((l, i) => `<div class="opt${i ? '' : ' on'}" data-id="${l.id}"><span class="badge ${l.c}">${l.c === 'B' ? 'Bank' : 'CU'}</span> ${esc(l.n)} <span class="tier t${l.tier}">${l.tier}</span><span class="dim">${esc(l.ci)}, ${l.st} · $${fmtM(l.ast, 0)}M assets · ${l.nb} offices</span></div>`).join('') : '<div class="none">No lender matches that name.</div>';
  box.classList.remove('hidden');
}
function pickLender(id) { $('lsugg').classList.add('hidden'); $('lname').value = S.byId[id].n; openLender(id); }
$('lname').addEventListener('input', showSuggest);
$('lname').addEventListener('focus', showSuggest);
$('lname').addEventListener('keydown', e => {
  const opts = [...$('lsugg').querySelectorAll('.opt')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!opts.length) return; S.lsel = (S.lsel + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length; opts.forEach((o, i) => o.classList.toggle('on', i === S.lsel)); opts[S.lsel].scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter' && opts.length) pickLender(opts[S.lsel].dataset.id);
  else if (e.key === 'Escape') $('lsugg').classList.add('hidden');
});
$('lsugg').addEventListener('mousedown', e => { const o = e.target.closest('.opt'); if (o) { e.preventDefault(); pickLender(o.dataset.id); } });
$('lname').addEventListener('blur', () => $('lsugg').classList.add('hidden'));

/* ---------------- wiring ---------------- */
$('go').onclick = searchFromBar; $('addr').addEventListener('keydown', e => { if (e.key === 'Enter') searchFromBar(); });
document.querySelectorAll('input[name=mode], #r-hq, #r-hq2, #r-br, #amt, #f-bank, #f-thrift, #f-cu, #f-fom, #f-anycre').forEach(el => el.addEventListener('change', run));
document.querySelectorAll('.w input').forEach(el => el.addEventListener('input', () => { rescoreAll(); if (S.results.length) run(); }));
$('occ').addEventListener('change', () => { rescoreAll(); run(); });
$('w-reset').onclick = e => { e.preventDefault(); [['w-mom', 25], ['w-fr', 25], ['w-gro', 15], ['w-qual', 15], ['w-cap', 10], ['w-mar', 10]].forEach(([i, v]) => $(i).value = v); rescoreAll(); run(); };
$('csv').onclick = csv;
initMap(); load().catch(e => { $('summary').textContent = 'Failed to load data: ' + e; console.error(e); });
