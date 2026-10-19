/* LenderMapper shared data code: loading, formatting, scoring, lender details, name search, dialogs and definitions.
   Used by Map search (app.js) and Lender lookup (lookup.js). Data built by scripts/package_site.py. */
'use strict';
const CFG = { data: 'data/', histMode: 'lender' /* 'lender' => data/history/{id}.json ; 'state' => data/history_state/{ST}.json */, tiles: 'https://tiles.openfreemap.org/styles/positron', offline: false /* true => no external hosts: ZIP-centroid geocoding and schematic state-outline basemap */ };
const STATES = {AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',PR:'Puerto Rico',GU:'Guam',VI:'Virgin Islands'};
const NAME2ST = Object.fromEntries(Object.entries(STATES).map(([k, v]) => [v.toLowerCase(), k]));

const S = { lenders: [], byId: {}, branches: [], years: [], brByLender: {}, pt: null, st: null, results: [], lists: { hq: [], br: [] }, map: null, hist: {}, histState: {} };
const $ = id => document.getElementById(id);
const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// design tokens live in styles/tokens.css; the map reads them here because MapLibre paint cannot use CSS variables
const TOK = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const ICON = (name, cls) => `<svg class="icon${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="assets/icons.svg#i-${name}"/></svg>`;

/* ---------------- formatting: negative amounts in brackets, changes as a triangle plus a signed value ---------------- */
const NA = '<span class="na">–</span>';
const num = (x, d) => Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtM = (x, d = 1) => x == null ? NA : (+x.toFixed(d) < 0 ? `(${num(x, d)})` : num(x, d));
const fmtP = (x, d = 2) => x == null ? NA : (+x.toFixed(d) < 0 ? '−' + num(x, d) : num(x, d)) + '%';
const fmtI = x => x == null ? NA : x.toLocaleString('en-US');
const money = (x, d = 1) => x == null ? NA : (+x.toFixed(d) < 0 ? `($${num(x, d)}M)` : `$${num(x, d)}M`);
const fmtChg = (x, d = 1, unit = '%') => {
  if (x == null) return NA;
  const v = +x.toFixed(d); if (v === 0) return (0).toFixed(d) + unit;
  return `<span class="${v > 0 ? 'up' : 'down'}"><span aria-hidden="true">${v > 0 ? '▲' : '▼'}</span> ${v > 0 ? '+' : '−'}${num(v, d)}${unit}</span>`;
};
// NCUA names come in capitals ("TEXAS DOW EMPLOYEES"): show item names in title case, keeping known abbreviations
const UPPER = new Set(['FCU', 'CU', 'TCU', 'ECU', 'USA', 'US', 'FSB', 'SSB', 'NA', 'N.A.', 'AFL', 'CIO', 'IBEW', 'II', 'III', 'IV', 'HMO', 'IBM', 'NASA', 'TVA', 'GE', 'AT&T', 'NYC', 'LA', 'DC']);
const SMALL = new Set(['of', 'and', 'the', 'for', 'at', 'in', 'on', 'by', 'to', 'de', 'la']);
function titleName(s) {
  if (!s || /[a-z]/.test(s)) return s || '';
  return s.split(/\s+/).map((w, i) => {
    if (UPPER.has(w) || (w.length <= 4 && !/[AEIOUY]/.test(w))) return w;
    const lw = w.toLowerCase();
    if (i && SMALL.has(lw)) return lw;
    return lw.replace(/(^|[-/(.&])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }).join(' ');
}
const nm = l => titleName(l.n);

const CTY = s => s ? s.toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]+/g, ' ').replace(/\bSAINTE\b/g, 'STE').replace(/\bSAINT\b/g, 'ST').replace(/\b(CITY AND BOROUGH|CENSUS AREA|COUNTY|PARISH|BOROUGH|MUNICIPALITY)\b/g, ' ').replace(/\s+/g, '') || null : null;
const countyName = (raw, st) => !raw ? null : /\b(county|parish|borough|city|census area|municipality)\b/i.test(raw) ? raw : raw + (st === 'LA' ? ' Parish' : st === 'AK' ? '' : ' County');
const hav = (a, b, c, d) => { const R = 3958.8, p = Math.PI / 180, dLat = (c - a) * p, dLon = (d - b) * p; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

/* ---------------- load ---------------- */
async function loadData() {
  const get = f => fetch(CFG.data + f).then(r => { if (!r.ok) throw new Error(`${f} (${r.status})`); return r.json(); });
  const [meta, lj, bi] = await Promise.all(['meta.json', 'lenders.json', 'branch_index.json'].map(get));
  const lenders = lj.rows.map(r => Object.fromEntries(lj.cols.map((k, i) => [k, r[i]])));
  S.meta = meta; S.lenders = lenders; S.years = bi.years; S.brBox = bi.states; S.brLoaded = {}; S.branches = []; S.brById = {};
  lenders.forEach(l => { S.byId[l.id] = l; l.ck = CTY(l.cty); });
  rankAll();
}
// call reports are labelled "26Q2"; shown as "Q2 2026"
const quarterLabel = q => { const m = /^(\d\d)Q(\d)$/.exec(q || ''); return m ? `Q${m[2]} 20${m[1]}` : (q || ''); };

/* ---------------- national score: four headline measures, 4 points for the best quarter down to 1 for the worst ---------------- */
// Ranked against every lender in the data. Capacity and the capital ratio are ranked within each charter (banks against
// banks, credit unions against credit unions) because the rules differ. A missing figure earns 1 point.
// Low-income credit unions have no business-loan cap, so their capacity ranks at the top.
const NO_CAP = 1e12;
const capOf = l => l.c === 'B' ? l.caprem : (l.licu ? NO_CAP : l.mblrem);
const capitalOf = l => l.c === 'B' ? l.t1 : l.nwr;
const capitalName = l => l.c === 'B' ? 'Tier 1 leverage' : 'Net worth ratio';
const MEASURES = [
  { k: 'ltd', v: l => l.ltd, dir: -1 },                      // lower loan to deposit = more room to lend
  { k: 'cap', v: capOf, dir: 1, byCharter: true },
  { k: 'capital', v: capitalOf, dir: 1, byCharter: true },
  { k: 'fc', v: l => l.fc, dir: -1 },
];
const QUARTER = { 4: 'top quarter', 3: 'second quarter', 2: 'third quarter', 1: 'bottom quarter' };
// position of each value among the group, best first; tied values share the better position
function positions(group, v, dir) {
  const vals = group.map(v).filter(x => x != null && !Number.isNaN(x)).sort((a, b) => (b - a) * dir), first = new Map();
  vals.forEach((x, i) => { if (!first.has(x)) first.set(x, i); });
  return x => x == null || Number.isNaN(x) ? null : first.get(x) / vals.length;
}
function rankAll() {
  const L = S.lenders, groups = { all: [L], byCharter: [L.filter(l => l.c === 'B'), L.filter(l => l.c === 'C')] };
  L.forEach(l => { l.pts = {}; l.pct = {}; });
  for (const m of MEASURES) for (const g of groups[m.byCharter ? 'byCharter' : 'all']) {
    const pos = positions(g, m.v, m.dir);
    for (const l of g) { const p = pos(m.v(l)); l.pts[m.k] = p == null ? 1 : p < .25 ? 4 : p < .5 ? 3 : p < .75 ? 2 : 1; l.pct[m.k] = p == null ? 0 : 1 - p; }
  }
  L.forEach(l => { l.total = Object.values(l.pts).reduce((a, b) => a + b, 0); l.fine = Object.values(l.pct).reduce((a, b) => a + b, 0); });
  const pos = positions(L, l => l.total, 1);
  L.forEach(l => { const p = pos(l.total); l.grade = l.total === 16 ? 'A+' : p < .25 ? 'A' : p < .5 ? 'B' : p < .75 ? 'C' : 'D'; });
}
// national order: points, then the finer position within each measure to break ties
const byScore = (a, b) => b.total - a.total || b.fine - a.fine;

/* ---------------- branch files (per state, loaded on demand) ---------------- */
async function ensureBranches(states) {
  const need = states.filter(s => S.brBox[s] && !S.brLoaded[s]);
  if (!need.length) return;
  if ($('summary')) $('summary').innerHTML = `Loading branches for ${need.join(', ')}…`;
  const files = await Promise.all(need.map(s => fetch(`${CFG.data}branches/${s}.json`).then(r => r.json()).catch(() => [])));
  need.forEach((s, i) => { S.brLoaded[s] = true; for (const b of files[i]) { b[11] = CTY(b[10]); S.branches.push(b); S.brById[b[0]] = b; (S.brByLender[b[1]] = S.brByLender[b[1]] || []).push(b); } });
}
function branchStats(lid) {
  const rows = S.brByLender[lid] || [], last = S.years.length - 1, tot = rows.reduce((s, b) => s + (b[9][last] || 0), 0);
  const nonMain = rows.filter(b => !b[8] && b[9][last] != null).sort((a, b) => b[9][last] - a[9][last]);
  const q = {}; nonMain.forEach((b, i) => q[b[0]] = Math.min(4, Math.floor(i / nonMain.length * 4) + 1));
  return rows.map(b => { const d = b[9], v = d[last], y1 = d[last - 1], y5 = d[last - 5], y10 = d[0]; return { b, dep: v, g1: v != null && y1 ? (v / y1 - 1) * 100 : null, g5: v != null && y5 ? (v / y5 - 1) * 100 : null, g10: v != null && y10 ? (v / y10 - 1) * 100 : null, share: v != null && tot ? v / tot * 100 : null, quart: q[b[0]] || null, main: !!b[8], n: nonMain.length }; });
}

/* ---------------- shared bits of markup ---------------- */
function typeText(r) { return (r.c === 'B' ? 'Bank' : 'Credit union') + (r.cl === 'Savings institution' ? ', thrift' : '') + (r.c === 'C' && r.licu ? ', low-income designated' : ''); }
const typeTag = l => `<span class="tag">${l.c === 'B' ? 'Bank' : 'Credit union'}</span>`;
const gradeTag = (l, long) => `<span class="grade g${l.grade === 'A+' ? 'Ap' : l.grade}" title="Grade ${l.grade}: ${l.total} of 16 points nationally">${long ? 'Grade ' : ''}${l.grade}</span>`;
// tabs: role=tab buttons inside role=tablist; arrow keys move between them
function wireTabs(list, onSelect) {
  const tabs = [...list.querySelectorAll('[role=tab]')];
  const pick = (t, focus) => { tabs.forEach(x => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; }); if (focus) t.focus(); onSelect(t); };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => pick(t));
    t.addEventListener('keydown', e => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { e.preventDefault(); pick(tabs[(i + d + tabs.length) % tabs.length], true); } });
  });
}

/* ---------------- lender details (drawer on Map search, page body on Lender lookup) ---------------- */
const HIST_ROWS = [
  ['Balance sheet'], ['dep', 'Total deposits ($M)', 'M0'], ['ast', 'Total assets ($M)', 'M0'], ['loans', 'Total loans ($M)', 'M0'], ['ltd', 'Loan to deposit', 'P1'], ['t1', 'Tier 1 leverage', 'P2'], ['nwr', 'Net worth ratio', 'P2'],
  ['Earnings'], ['fc', 'Funding cost', 'P2'], ['nim', 'NIM (avg assets)', 'P2'], ['nimp', 'NIM (FDIC published)', 'P2'], ['yield', 'Blended loan yield', 'P2'], ['rate', 'Reported CRE rate (CU)', 'P2'], ['roa', 'ROA', 'P2'],
  ['CRE exposure'], ['crecap', 'Investment CRE / capital', 'P0'], ['conscap', 'Construction / capital', 'P0'], ['oocap', 'OO CRE / capital', 'P0'], ['inv', 'Investment CRE ($M)', 'M1'], ['nonoo', '  Non-owner-occ nonres ($M)', 'M1'], ['mf', '  Multifamily ($M)', 'M1'], ['cons', '  Construction & land ($M)', 'M1'], ['oo', 'Owner-occupied CRE ($M)', 'M1'], ['cre', 'Total CRE ($M)', 'M1'], ['creloans', 'Total CRE / loans', 'P1'],
  ['CRE activity'], ['chg', 'CRE lent YTD, net change ($M)', 'M1'], ['invchg', 'Investment CRE net change YTD ($M)', 'M1'], ['mom', 'CRE growth, trailing 4Q (% assets)', 'C2'], ['granted', 'CRE granted YTD ($M, CU)', 'M1'], ['grantedn', 'CRE loans granted YTD (#, CU)', 'I'], ['avgloan', 'Avg CRE loan granted ($M, CU)', 'M2'],
  ['Capacity'], ['caprem', 'Room to 300% of capital ($M, bank)', 'M0'], ['consrem', 'Room to 100% construction ($M, bank)', 'M0'], ['mblused', 'MBL cap used (CU)', 'P0'], ['mblrem', 'MBL cap remaining ($M, CU)', 'M0'], ['limit', 'Est. lending limit ($M)', 'M1'], ['capbase', 'Capital base ($M)', 'M0'],
  ['Funding & quality'], ['brok', 'Brokered deposits % (bank)', 'P1'], ['nonmem', 'Non-member deposits % (CU)', 'P1'], ['depgro', 'Deposit growth, 4Q', 'C1'], ['npl', 'Non-performing loans', 'P2'], ['crenpl', 'CRE non-performing (bank)', 'P2'],
];
const fmtH = (v, f) => v == null ? NA : f[0] === 'P' ? fmtP(v, +f[1]) : f[0] === 'M' ? fmtM(v, +f[1]) : f[0] === 'C' ? fmtChg(v, +f[1]) : fmtI(v);
async function getHist(id) {
  if (S.hist[id]) return S.hist[id];
  if (CFG.histMode === 'lender') { S.hist[id] = await fetch(`${CFG.data}history/${id}.json`).then(r => r.json()); return S.hist[id]; }
  const st = S.byId[id].st; if (!S.histState[st]) S.histState[st] = await fetch(`${CFG.data}history_state/${st}.json`).then(r => r.json());
  return S.histState[st][id];
}
const stat = (k, v, sub) => `<div class="ld-stat"><span class="stat-label">${k}</span><span class="stat-value">${v}</span>${sub ? `<span class="small">${sub}</span>` : ''}</div>`;
// box: element to fill. opts.links: extra links under the title (e.g. "Open full page")
async function renderLender(id, box, opts = {}) {
  const l = S.byId[id];
  box.dataset.id = id;
  box.innerHTML = `<h2 class="ld-name">${esc(nm(l))}</h2><p class="meta">Loading history…</p>`;
  const h = await getHist(id).catch(() => null);
  await ensureBranches(l.bst || []).catch(() => null);
  if (box.dataset.id !== id) return;   // another lender was opened while this one loaded
  const nB = S.lenders.filter(x => x.c === 'B').length, nC = S.lenders.length - nB, peers = l.c === 'B' ? `${nB.toLocaleString('en-US')} banks` : `${nC.toLocaleString('en-US')} credit unions`;
  const pts = (k, v) => `${l.pts[k]} point${l.pts[k] === 1 ? '' : 's'} · ${v == null ? 'not reported' : QUARTER[l.pts[k]]}`;
  const capTxt = l.c === 'C' && l.licu ? 'No cap' : money(capOf(l));
  const web = l.web ? `<a href="${esc(/^https?:/.test(l.web) ? l.web : 'https://' + l.web)}" target="_blank" rel="noopener">Website ${ICON('external')}</a>` : '';
  let html = `<div class="ld-head">
    <div class="ld-tags">${typeTag(l)}${gradeTag(l, true)}</div>
    <h2 class="ld-name">${esc(nm(l))}</h2>
    <p class="meta">${esc(l.cl)} · HQ ${esc(l.ci)}, ${l.st} ${l.zip || ''}${l.cty ? ` (${esc(countyName(l.cty, l.st))})` : ''}${l.hc ? ` · Holding company: ${esc(l.hc)}` : ''}${l.fom ? ` · Field of membership: ${esc(l.fom)}` : ''}${l.licu ? ' · Low-income designated (business-loan cap exempt)' : ''}${l.cb ? ' · FDIC community bank' : ''} · ${l.nb} offices · Capital base: ${esc(l.captype)} · Data ${esc(l.per)}</p>
    <p class="ld-links">${web}${opts.links || ''}</p>
  </div>
  <section class="ld-score" aria-labelledby="ld-score"><h3 id="ld-score" class="t-label">National score</h3><div class="ld-stats">
    <div class="ld-stat ld-total"><span class="stat-label">Score</span><span class="stat-value">${l.total}<span class="of"> / 16</span></span><span class="small">Grade ${l.grade}, against all ${S.lenders.length.toLocaleString('en-US')} lenders</span></div>
    ${stat('Loan to deposit', fmtP(l.ltd, 1), pts('ltd', l.ltd))}${stat('CRE lending capacity', capTxt, pts('cap', capOf(l)))}
    ${stat(capitalName(l), fmtP(capitalOf(l)), pts('capital', capitalOf(l)))}${stat('Funding cost', fmtP(l.fc), pts('fc', l.fc))}
  </div>
  <p class="small">Each measure earns 4 points in the best quarter of all lenders nationally, down to 1 in the worst; a missing figure earns 1. ${capitalName(l)} and CRE lending capacity are ranked against the ${peers} only. Lower loan to deposit and funding cost rank higher.</p>
  <div class="ld-stats ld-facts">${stat('Assets', money(l.ast, 0))}${stat('Investment CRE', money(l.inv, 0))}${stat('Est. lending limit', money(l.limit, 1))}</div></section>`;
  if (h) {
    const qs = h.q, same = qs[qs.length - 1].slice(2), annual = qs.map((q, i) => i).filter(i => qs[i].slice(2) === same).reverse();   // newest first
    const build = idx => `<div class="table-wrap hist-wrap" tabindex="0" role="region" aria-label="History table"><table class="table hist"><thead><tr><th scope="col">Metric</th>${idx.map(i => `<th scope="col" class="n">${qs[i]}</th>`).join('')}</tr></thead><tbody>` +
      HIST_ROWS.map(r => r.length === 1 ? `<tr class="group"><td colspan="${idx.length + 1}">${r[0]}</td></tr>` : `<tr><th scope="row"${r[1].startsWith('  ') ? ' class="sub"' : ''}>${esc(r[1].trim())}</th>${idx.map(i => `<td class="n">${fmtH(h[r[0]] ? h[r[0]][i] : null, r[2])}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>';
    html += `<section class="ld-section" aria-labelledby="ld-hist"><h3 id="ld-hist">History</h3>
      <div class="tabs" role="tablist" aria-label="History period"><button type="button" class="tab" role="tab" id="ht-a" aria-selected="true" aria-controls="hist-tbl" data-p="a">Same quarter each year (${same})</button><button type="button" class="tab" role="tab" id="ht-q" aria-selected="false" tabindex="-1" aria-controls="hist-tbl" data-p="q">All quarters</button></div>
      <div id="hist-tbl" role="tabpanel" aria-labelledby="ht-a">${build(annual)}</div></section>`;
    S.histBuild = () => ({ annual: build(annual), all: build(qs.map((q, i) => i).reverse()) });
  } else html += '<p class="meta">History unavailable.</p>';
  const bs = branchStats(id).sort((a, b) => (b.dep || 0) - (a.dep || 0)), miles = b => S.pt ? `<td class="n">${hav(S.pt.lat, S.pt.lon, b[2], b[3]).toFixed(1)}</td>` : '';
  html += `<section class="ld-section" aria-labelledby="ld-br"><h3 id="ld-br">Branches (${bs.length})</h3>`;
  if (l.c === 'B') html += `<div class="table-wrap hist-wrap" tabindex="0" role="region" aria-label="Branches table"><table class="table hist"><thead><tr><th scope="col">Office</th><th scope="col">City</th><th scope="col">St</th><th scope="col" class="n">Deposits $M (Jun ${S.years[S.years.length - 1]})</th><th scope="col" class="n">1-yr</th><th scope="col" class="n">5-yr</th><th scope="col" class="n">10-yr</th><th scope="col" class="n">Share</th><th scope="col" class="n">Quartile</th>${S.pt ? '<th scope="col" class="n">Miles</th>' : ''}</tr></thead><tbody>` +
    bs.map(s => `<tr><th scope="row">${esc(s.b[4])}${s.main ? ' <span class="na">(main office)</span>' : ''}</th><td>${esc(s.b[5])}</td><td>${s.b[6]}</td><td class="n">${s.dep == null ? NA : fmtM(s.dep / 1000, 1)}</td><td class="n">${fmtChg(s.g1)}</td><td class="n">${fmtChg(s.g5)}</td><td class="n">${fmtChg(s.g10)}</td><td class="n">${fmtP(s.share, 1)}</td><td class="n">${s.main ? 'n/a' : (s.quart || NA)}</td>${miles(s.b)}</tr>`).join('') + '</tbody></table></div><p class="small">Branch deposits from the FDIC Summary of Deposits (annual, June 30). Main offices often book internet, brokered and corporate deposits and are excluded from quartile ranks.</p>';
  else html += `<div class="table-wrap hist-wrap" tabindex="0" role="region" aria-label="Branches table"><table class="table hist"><thead><tr><th scope="col">Office</th><th scope="col">City</th><th scope="col">St</th>${S.pt ? '<th scope="col" class="n">Miles</th>' : ''}</tr></thead><tbody>` + bs.map(s => `<tr><th scope="row">${esc(s.b[4])}${s.main ? ' <span class="na">(main office)</span>' : ''}</th><td>${esc(s.b[5])}</td><td>${s.b[6]}</td>${miles(s.b)}</tr>`).join('') + '</tbody></table></div><p class="small">NCUA publishes branch locations but no branch-level deposits.</p>';
  html += '</section>';
  box.innerHTML = html;
  const tl = box.querySelector('[role=tablist]');
  if (tl) { const t = S.histBuild(); wireTabs(tl, tab => { const p = $('hist-tbl'); p.innerHTML = tab.dataset.p === 'a' ? t.annual : t.all; p.setAttribute('aria-labelledby', tab.id); }); }
}

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
function findLenders(q, max = 12) {
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
  return hits.sort((a, b) => a[0] - b[0] || (b[1].ast || 0) - (a[1].ast || 0)).slice(0, max).map(h => h[1]);
}

/* ---------------- dialogs: focus moves in, Tab stays inside, Esc or Close returns focus ---------------- */
const openStack = [], opener = {};
function openDialog(id) {
  const el = $(id);
  if (el.classList.contains('hidden')) { opener[id] = document.activeElement; openStack.push(id); }
  el.classList.remove('hidden'); document.body.style.overflow = 'hidden';
  (el.querySelector('[data-close]') || el).focus();
}
function closeDialog(id) {
  const el = $(id); if (el.classList.contains('hidden')) return;
  el.classList.add('hidden'); openStack.splice(openStack.indexOf(id), 1);
  if (!openStack.length) document.body.style.overflow = '';
  const o = opener[id]; if (o && document.contains(o)) o.focus();
}
const topDialog = () => openStack[openStack.length - 1];
document.querySelectorAll('.scrim').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) closeDialog(el.id); });
});
document.addEventListener('keydown', e => {
  const id = topDialog(); if (!id) return;
  if (e.key === 'Escape') { e.stopImmediatePropagation(); closeDialog(id); return; }
  if (e.key !== 'Tab') return;
  const f = [...$(id).querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
}, true);

/* ---------------- definitions (Definitions dialog on Map search, About page) ---------------- */
const DEFS = [
  ['Lists', 'The first list shows lenders whose main office is in the property\'s county. The second shows lenders headquartered elsewhere in the same state that have a branch in the county, or within the chosen number of miles. Each list is ordered by the national score (see "Score and grades"). Lender HQ counties come from the main office in the FDIC and NCUA branch files. The property\'s county comes from the address lookup; for ZIP codes and dropped pins it is the county of the nearest bank or credit-union office.'],
  ['Headline metrics', 'Loan to deposit, CRE lending capacity, capital ratio and funding cost are shown for every lender; credit unions also show CRE loans granted this year and their CRE loan rate, which banks do not report. Capital ratio: banks show the tier 1 leverage ratio, credit unions the NCUA net worth ratio (net worth / assets); the definitions are close but not identical. A green box marks a figure in the top third of the lenders in the current search (both lists together): lower is better for loan to deposit, funding cost and CRE loan rate, higher for the rest. Tier 1 leverage is compared among the banks in the search; net worth ratio, CRE granted and CRE loan rate among the credit unions; lending capacity within each charter.'],
  ['CRE lending capacity', 'Banks: dollars of additional investment CRE (non-owner-occupied, multifamily, construction) before reaching 300% of capital, the level that draws extra regulatory scrutiny. "None" means the bank is already above 300%. Credit unions: dollars left under the statutory member-business-loan cap (lesser of 1.75× net worth or 12.25% of assets); low-income-designated credit unions are exempt and shown as "No cap". The two limits are different rules, so compare within a charter type.'],
  ['Scope', 'Every FDIC-insured bank and savings institution (FDIC BankFind Suite: Call Reports, Summary of Deposits) and every federally insured credit union (NCUA Form 5300), quarterly 2016Q1 to the latest quarter. Dollar figures in millions; negative amounts in brackets. History shows the same quarter each year so year-to-date items compare like with like.'],
  ['Score and grades', 'Four measures, weighted equally: loan to deposit (lower is better), CRE lending capacity in dollars (higher is better), capital ratio (higher is better) and funding cost (lower is better). Each is ranked against every bank and credit union in the country and earns 4 points in the best quarter, 3, 2, or 1 in the worst; a missing figure earns 1. Tier 1 leverage is ranked among banks only, net worth ratio among credit unions only, and lending capacity within each charter because the bank and credit-union limits are different rules. Low-income-designated credit unions have no business-loan cap and earn 4 points for capacity. The score is the sum, 4 to 16. Grades: A+ for all 16 points, then A, B, C and D for the national quarters of the score (tied scores take the higher grade). The score sorts lenders; it is not a prediction of approval.'],
  ['Investment vs owner-occupied', 'Investment CRE = non-owner-occupied nonfarm nonresidential + multifamily + construction & land development (the 2006 interagency concentration definition). Owner-occupied = loans secured by owner-occupied nonfarm nonresidential property, which fall outside the 300% guidance. Call reports split only these categories: no office/retail/industrial detail exists.'],
  ['Capital base', 'Banks: total risk-based capital. About 1,800 community banks use the Community Bank Leverage Ratio and report no risk-based capital; for them tier 1 capital + loan-loss allowance is used (examiner convention) and the lender page says so. Credit unions: net worth.'],
  ['Credit-union business-loan cap', 'Statutory cap = lesser of 1.75× net worth or 12.25% of assets. Low-income-designated credit unions (about half) are exempt and shown as "exempt". Net member business loan balance per NCUA definition.'],
  ['Funding cost / NIM', 'Computed identically for both charters: annualized year-to-date interest expense / average deposits + borrowings; net interest income / average assets. FDIC-published ratios (on earning assets) are shown in the lender history for reference.'],
  ['Brokered deposits', 'Banks: brokered deposits / total deposits. NCUA collects no brokered-deposit dollar amount, only a yes/no flag; non-member deposits % is shown for credit unions as the nearest analog.'],
  ['CRE lent YTD', 'Net change in CRE balances since December 31, both charters; understates originations by payoffs. Credit unions additionally report real-estate-secured commercial loans granted year-to-date (count and dollars), shown as "granted" and "avg loan". Banks report no originations.'],
  ['CRE rate', 'Credit unions report the rate on real-estate-secured commercial loans (NCUA account 525, since 2017Q3). Banks report no loan-level rates; the blended loan yield (interest income / average loans) is shown for both.'],
  ['Non-performing loans', 'Banks: loans 90+ days past due plus nonaccrual, / gross loans. Credit unions: loans 60+ days delinquent / loans. Shown as reported; definitions differ.'],
  ['Lending limit', 'Estimate = 15% of the capital base. National banks: 15% of capital and surplus unsecured (state limits range roughly 15-25%). Credit unions: 15% of net worth to one borrower. Used, with the remaining CRE lending capacity, by the loan amount box on the results page to hide lenders that could not hold the loan alone.'],
  ['Branches', 'Bank branch deposits: FDIC Summary of Deposits as of June 30 each year. Quartile = rank within the owning bank\'s non-main-office branches by deposits. Main offices are excluded because they often carry internet, brokered and corporate deposits. Credit-union branches are shown from the NCUA branch file without deposits; addresses were geocoded (Census), with ZIP-centroid fallback.'],
  ['Mergers', 'History is as reported under each charter. An acquired institution keeps its own pre-merger history; the acquirer shows its own.'],
  ['Who is listed', 'Results include community-charter credit unions and state charters (whose field of membership NCUA does not classify). Single- and multiple-common-bond credit unions, which lend only to members of one employer or group, are left out, as are lenders that report no commercial real estate loans. The national score still ranks every lender.'],
];
const defsHtml = () => '<dl class="defs">' + DEFS.map(d => `<div><dt>${d[0]}</dt><dd>${d[1]}</dd></div>`).join('') + '</dl>';
