"""Package data for the static site: lenders.json, branches.json, per-lender (and per-state) history, macro.json."""
import os, json, math, numpy as np, pandas as pd
D = os.path.join(os.path.dirname(__file__), '..', 'data'); SITE = os.path.join(os.path.dirname(__file__), '..', 'site', 'data')
os.makedirs(f'{SITE}/history', exist_ok=True); os.makedirs(f'{SITE}/history_state', exist_ok=True)

STATES_OK = set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP FM MH PW'.split())
m = pd.read_parquet(f'{D}/metrics_quarterly.parquet').sort_values(['lender_id', 'period'])
L = pd.read_parquet(f'{D}/lenders.parquet'); B = pd.read_parquet(f'{D}/branches.parquet')
geo = pd.read_parquet(f'{D}/cu_geocoded.parquet') if os.path.exists(f'{D}/cu_geocoded.parquet') else None

# trailing 4-quarter changes (pts of assets) for the three CRE definitions
g = m.groupby('lender_id')
for c in ['cre_total', 'cre_investment', 'cre_oo']:
    b4 = g[c].shift(4); ok = (m['period'] - g['period'].shift(4)).dt.days.between(360, 370)
    m[c + '_chg4_assets'] = ((m[c] - b4) / g['assets'].shift(4) * 100).where(ok)
m['cre_investment_pct_loans'] = m['cre_investment'] / m['loans'] * 100
m['cre_oo_pct_loans'] = m['cre_oo'] / m['loans'] * 100
m['cre_oo_pct_capital'] = m['cre_oo'] / m['total_rbc'] * 100
dep_b4 = g['deposits'].shift(4); okd = (m['period'] - g['period'].shift(4)).dt.days.between(360, 370)
m['deposit_growth_pct'] = ((m['deposits'] / dep_b4 - 1) * 100).where(okd)

latest = m['period'].max(); lq = latest.quarter
active = set(L[L['active']]['lender_id'])
excl = set(L[L['charter_class'] == 'Insured branch of foreign bank']['lender_id'])
lat = m[(m['period'] == latest) & m['lender_id'].isin(active) & ~m['lender_id'].isin(excl)].copy()
lat = lat.merge(L[['lender_id', 'address', 'city', 'zip', 'lat', 'lon', 'website', 'holding_company', 'charter_class', 'fom_class', 'offices', 'successor_id']], on='lender_id', how='left')
if geo is not None:
    hq = geo[geo['branch_id'].str.endswith('-HQ')].set_index('lender_id')[['lat', 'lon']]
    isc = lat['charter'] == 'cu'
    lat.loc[isc, 'lat'] = lat.loc[isc, 'lender_id'].map(hq['lat']); lat.loc[isc, 'lon'] = lat.loc[isc, 'lender_id'].map(hq['lon'])
    gb_ = geo[~geo['branch_id'].str.endswith('-HQ')].dropna(subset=['lat'])
    Bm = B[B['branch_id'].str[0] == 'C'].merge(gb_[['branch_id', 'lat', 'lon']], on='branch_id', suffixes=('_x', ''))
    fb = pd.concat([Bm[Bm['main_office']], Bm[~Bm['main_office']]]).drop_duplicates('lender_id').set_index('lender_id')[['lat', 'lon']]
    miss = isc & lat['lat'].isna()
    lat.loc[miss, 'lat'] = lat.loc[miss, 'lender_id'].map(fb['lat']); lat.loc[miss, 'lon'] = lat.loc[miss, 'lender_id'].map(fb['lon'])

# ---- scorecard components: percentiles 0-100 (higher = more likely to lend). NPL ranked within charter (definitions differ).
def pct(s): return s.rank(pct=True) * 100
lat['c_mom_inv'] = pct(lat['cre_investment_chg4_assets'].fillna(0))
lat['c_mom_oo'] = pct(lat['cre_oo_chg4_assets'].fillna(0))
lat['c_fr_inv'] = (pct(lat['cre_investment_pct_loans'].fillna(0)) + pct(lat['cre_pct_capital'].fillna(0))) / 2
lat['c_fr_oo'] = (pct(lat['cre_oo_pct_loans'].fillna(0)) + pct(lat['cre_oo_pct_capital'].fillna(0))) / 2
lat['c_gro'] = pct(lat['deposit_growth_pct'].fillna(lat['deposit_growth_pct'].median()))
q = 100 - lat.groupby('charter')['npl_pct'].transform(lambda s: s.fillna(s.median()).rank(pct=True) * 100)
qb = 100 - lat['cre_npl_pct'].fillna(0).rank(pct=True) * 100
lat['c_qual'] = np.where(lat['charter'] == 'bank', (q + qb) / 2, q)
lat['c_cap'] = pct(lat['tier1_leverage_pct'].fillna(lat['tier1_leverage_pct'].median()))
lat['c_mar'] = pct(lat['nim_pct'].fillna(lat['nim_pct'].median()))
# cap penalties (multiplier) - only at the extremes where the data show growth actually slows
pen = np.ones(len(lat))
bank = (lat['charter'] == 'bank').values
pen = np.where(bank & (lat['cre_pct_capital'] > 500), 0.70, np.where(bank & (lat['cre_pct_capital'] > 400), 0.85, pen))
pen = np.where(bank & (lat['constr_pct_capital'] > 150), pen * 0.9, pen)
pen = np.where(~bank & (lat['mbl_cap_used_pct'] > 90) & (lat['mbl_cap_used_pct'] <= 100), pen * 0.8, pen)
lat['penalty'] = pen

nb = B.groupby('lender_id').size(); bdep = B.groupby('lender_id')['deposits'].sum(min_count=1)
lat['n_branches'] = lat['lender_id'].map(nb).fillna(0).astype(int); lat['branch_deposits'] = lat['lender_id'].map(bdep)

def r(x, d=2):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))): return None
    if isinstance(x, (np.floating, float)): return round(float(x), d)
    if isinstance(x, (np.integer, int)): return int(x)
    return x
def musd(x): return r(x / 1e6, 1) if x is not None and not pd.isna(x) else None

KEYS = [  # (json key, column, kind)
    ('dep', 'deposits', 'musd'), ('ast', 'assets', 'musd'), ('loans', 'loans', 'musd'), ('ltd', 'loan_to_deposit_pct', 'p'), ('t1', 'tier1_leverage_pct', 'p'), ('nwr', 'net_worth_ratio_pct', 'p'),
    ('fc', 'funding_cost_pct', 'p'), ('fcp', 'cost_funds_pct_published', 'p'), ('nim', 'nim_pct', 'p'), ('nimp', 'nim_pct_published', 'p'),
    ('crecap', 'cre_pct_capital', 'p'), ('conscap', 'constr_pct_capital', 'p'), ('oocap', 'cre_oo_pct_capital', 'p'), ('nonoo', 'cre_nonoo', 'musd'), ('mf', 'cre_multi', 'musd'), ('cons', 'cre_constr', 'musd'),
    ('inv', 'cre_investment', 'musd'), ('oo', 'cre_oo', 'musd'), ('cre', 'cre_total', 'musd'), ('creloans', 'cre_total_pct_loans', 'p'), ('invloans', 'cre_investment_pct_loans', 'p'), ('ooloans', 'cre_oo_pct_loans', 'p'),
    ('brok', 'brokered_pct', 'p'), ('nonmem', 'nonmember_dep_pct', 'p'), ('brokflag', 'brokered_flag', 'f'),
    ('chg', 'cre_net_change_ytd', 'musd'), ('invchg', 'cre_investment_net_change_ytd', 'musd'), ('mom', 'cre_total_chg4_assets', 'p'), ('mominv', 'cre_investment_chg4_assets', 'p'), ('momoo', 'cre_oo_chg4_assets', 'p'),
    ('granted', 'cre_granted_ytd', 'musd'), ('grantedn', 'cre_granted_ytd_n', 'i'), ('avgloan', 'cre_granted_avg_loan', 'musd'),
    ('caprem', 'cre_cap_remaining', 'musd'), ('consrem', 'constr_cap_remaining', 'musd'), ('mblused', 'mbl_cap_used_pct', 'p'), ('mblrem', 'mbl_cap_remaining', 'musd'),
    ('rate', 'cre_rate_pct', 'p'), ('yield', 'loan_yield_pct', 'p'), ('npl', 'npl_pct', 'p'), ('crenpl', 'cre_npl_pct', 'p'), ('roa', 'roa_pct', 'p'),
    ('limit', 'lending_limit_est', 'musd'), ('capbase', 'total_rbc', 'musd'), ('depgro', 'deposit_growth_pct', 'p'), ('emp', 'employees', 'i'),
]
def conv(row, key, col, kind):
    v = row[col]
    if pd.isna(v): return None
    return musd(v) if kind == 'musd' else (int(v) if kind in ('i', 'f') else r(v, 2))

out = []
for _, row in lat.iterrows():
    o = {'id': row['lender_id'], 'n': row['name'], 'c': 'B' if row['charter'] == 'bank' else 'C', 'cl': row['charter_class'], 'ci': (row['city'].title() if row['charter'] == 'cu' and isinstance(row['city'], str) else row['city']), 'st': row['state'], 'zip': row['zip'],
         'lat': r(row['lat'], 5), 'lon': r(row['lon'], 5), 'web': row['website'] if isinstance(row['website'], str) else None, 'hc': row['holding_company'] if isinstance(row['holding_company'], str) else None,
         'cb': bool(row['community_bank'] == 1) if row['charter'] == 'bank' else None, 'fom': row['fom_class'] if isinstance(row['fom_class'], str) else None,
         'licu': bool(row['licu'] == 1) if row['charter'] == 'cu' else None, 'captype': 'Net worth' if row['charter'] == 'cu' else ('Tier 1 + allowance (CBLR)' if row['cblr_bank'] == 1 else 'Total risk-based capital'),
         'nb': int(row['n_branches']), 'bdep': musd(row['branch_deposits']), 'per': f"{row['period'].year % 100}Q{row['quarter']}"}
    for k, col, kind in KEYS:
        if k in ('fcp', 'nimp', 'emp', 'conscap', 'consrem', 'depgro'): continue
        o[k] = conv(row, k, col, kind)
    o['sc'] = {k: r(row['c_' + k], 1) for k in ['mom_inv', 'mom_oo', 'fr_inv', 'fr_oo', 'gro', 'qual', 'cap', 'mar']}
    o['pen'] = r(row['penalty'], 2)
    out.append(o)
json.dump(out, open(f'{SITE}/lenders.json', 'w'), separators=(',', ':'))
print('lenders.json', len(out), os.path.getsize(f'{SITE}/lenders.json') // 1024, 'KB; CU with coords:', sum(1 for o in out if o['c'] == 'C' and o['lat']))

# ---- branches: compact arrays. [branch_id, lender_id, lat, lon, name, city, st, zip, main, [deposits $K by year 2016..latest]]
yrs = sorted([c for c in B.columns if c.startswith('dep_')])
if geo is not None:
    gb = geo[~geo['branch_id'].str.endswith('-HQ')].set_index('branch_id')[['lat', 'lon']]
    isc = B['branch_id'].str[0] == 'C'
    B.loc[isc, 'lat'] = B.loc[isc, 'branch_id'].map(gb['lat']); B.loc[isc, 'lon'] = B.loc[isc, 'branch_id'].map(gb['lon'])
keep = B[B['lender_id'].isin(set(lat['lender_id'])) & B['lat'].notna()]
depm = (keep[yrs] / 1000).round().to_numpy()
cols_ = keep[['branch_id', 'lender_id', 'lat', 'lon', 'name', 'city', 'state', 'zip', 'main_office']].to_numpy()
arr = []
for i in range(len(keep)):
    c_ = cols_[i]; deps = [None if np.isnan(v) else int(v) for v in depm[i]]
    arr.append([c_[0], c_[1], round(float(c_[2]), 5), round(float(c_[3]), 5), c_[4], (c_[5].title() if c_[0][0] == 'C' and isinstance(c_[5], str) else c_[5]), c_[6], c_[7], 1 if c_[8] else 0, deps])
os.makedirs(f'{SITE}/branches', exist_ok=True)
bystate, bbox = {}, {}
for a in arr:
    st_ = a[6] if a[6] in STATES_OK else 'XX'
    bystate.setdefault(st_, []).append(a)
for st_, rows_ in bystate.items():
    json.dump(rows_, open(f'{SITE}/branches/{st_}.json', 'w'), separators=(',', ':'))
    la = [x[2] for x in rows_]; lo = [x[3] for x in rows_]
    bbox[st_] = [min(la), min(lo), max(la), max(lo), len(rows_)]
json.dump({'years': [int(y[4:]) for y in yrs], 'states': bbox}, open(f'{SITE}/branch_index.json', 'w'), separators=(',', ':'))
lst = keep.groupby('lender_id')['state'].agg(lambda s: sorted(set(x if x in STATES_OK else 'XX' for x in s)))
for o in out: o['bst'] = lst.get(o['id'], [])
cols_l = list(out[0].keys())
json.dump({'cols': cols_l, 'rows': [[o[k] for k in cols_l] for o in out]}, open(f'{SITE}/lenders.json', 'w'), separators=(',', ':'))
print('branch files', len(bystate), 'rows', len(arr), 'largest KB', max(os.path.getsize(f'{SITE}/branches/{x}.json') for x in bystate) // 1024, '; lenders.json KB', os.path.getsize(f'{SITE}/lenders.json') // 1024)

# ---- history: per lender, all quarters; and per state with the same-quarter annual series (for the hosted preview)
HK = [k for k, _, _ in KEYS if k not in ('emp',)]
hist = m[m['lender_id'].isin(set(lat['lender_id']))]
hist = hist.merge(L[['lender_id', 'state']].rename(columns={'state': 'st_dir'}), on='lender_id', how='left')
# pre-convert every history column once (vectorized), then slice per lender
H = pd.DataFrame({'lender_id': hist['lender_id'].values, 'q': (hist['period'].dt.year % 100).astype(str).values + 'Q' + hist['period'].dt.quarter.astype(str).values, 'qq': hist['period'].dt.quarter.values, 'st': hist['st_dir'].values, 'nm': hist['name'].values})
for k, col, kind in KEYS:
    if k == 'emp': continue
    v = hist[col]
    H[k] = (v / 1e6).round(1) if kind == 'musd' else (v.round(0) if kind in ('i', 'f') else v.round(2))
H = H.sort_values(['lender_id', 'q']).reset_index(drop=True)
H = H.astype(object).where(H.notna(), None)
by_state = {}
for lid, hdf in H.groupby('lender_id', sort=False):
    rec = {'q': hdf['q'].tolist(), 'nm': hdf['nm'].iloc[-1]}
    for k in HK: rec[k] = hdf[k].tolist()
    json.dump(rec, open(f'{SITE}/history/{lid}.json', 'w'), separators=(',', ':'))
    sel = (hdf['qq'] == lq).values
    st = hdf['st'].iloc[-1]
    by_state.setdefault(st, {})[lid] = {'q': hdf['q'][sel].tolist(), **{k: hdf[k][sel].tolist() for k in HK}}
for st, recs in by_state.items():
    json.dump(recs, open(f'{SITE}/history_state/{st}.json', 'w'), separators=(',', ':'))
print('history files', len(os.listdir(f'{SITE}/history')), '; state files', len(by_state), 'largest KB', max(os.path.getsize(f'{SITE}/history_state/{s}.json') for s in by_state) // 1024)

# ---- macro context for the UI header
mac = pd.read_parquet(f'{D}/model_panel.parquet', columns=['period', 'fedfunds', 'sofr', 'dgs5', 'dgs10', 'sloos_cre_tight']).drop_duplicates('period').sort_values('period')
json.dump({'q': [f"{p.year % 100}Q{p.quarter}" for p in mac['period']], **{c: [r(v, 2) for v in mac[c]] for c in ['fedfunds', 'sofr', 'dgs5', 'dgs10', 'sloos_cre_tight']}}, open(f'{SITE}/macro.json', 'w'))
json.dump({'latest': f"{latest.year % 100}Q{lq}", 'latest_date': str(latest.date()), 'n_banks': int((lat['charter'] == 'bank').sum()), 'n_cus': int((lat['charter'] == 'cu').sum()), 'n_branches': len(arr), 'sod_year': int(yrs[-1][4:]), 'built': pd.Timestamp.today().strftime('%Y-%m-%d')}, open(f'{SITE}/meta.json', 'w'))
print(open(f'{SITE}/meta.json').read())

# ---- offline helpers: ZIP centroids (fallback geocoder) and simplified state outlines (schematic basemap)
import urllib.request, zipfile as _zf
GEO = os.path.join(os.path.dirname(__file__), '..', 'raw', 'geo')
if not os.path.exists(f'{GEO}/2023_Gaz_zcta_national.txt'):
    urllib.request.urlretrieve('https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip', f'{GEO}/zcta.zip'); _zf.ZipFile(f'{GEO}/zcta.zip').extractall(GEO)
z = pd.read_csv(f'{GEO}/2023_Gaz_zcta_national.txt', sep='\t', dtype={'GEOID': str}); z.columns = [c.strip() for c in z.columns]
json.dump({rw.GEOID: [round(rw.INTPTLAT, 4), round(rw.INTPTLONG, 4)] for rw in z.itertuples()}, open(f'{SITE}/zips.json', 'w'), separators=(',', ':'))
if not os.path.exists(f'{GEO}/us-states.json'):
    urllib.request.urlretrieve('https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json', f'{GEO}/us-states.json')
NAME2ST = {v: k for k, v in {'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','DC':'District of Columbia','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','PR':'Puerto Rico'}.items()}
def _rnd(c): return [round(c[0], 3), round(c[1], 3)] if isinstance(c[0], (int, float)) else [_rnd(x) for x in c]
gj = json.load(open(f'{GEO}/us-states.json'))
json.dump({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'st': NAME2ST[f['properties']['name']]}, 'geometry': {'type': f['geometry']['type'], 'coordinates': _rnd(f['geometry']['coordinates'])}} for f in gj['features'] if f['properties']['name'] in NAME2ST]}, open(f'{SITE}/us-states.json', 'w'), separators=(',', ':'))
print('zips.json + us-states.json written')
