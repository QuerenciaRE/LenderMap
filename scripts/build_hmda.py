"""Match HMDA multifamily originations to FDIC banks / NCUA credit unions and place each loan at its census-tract centroid.

Match order: filer RSSD -> FDIC FED_RSSD or NCUA RSSD; else filer name + state among banks (OCC/Fed/FDIC filers) or credit
unions (NCUA filers). HUD-supervised filers are nonbanks and skipped. Writes data/hmda_loans.parquet (one row per
lender x year x tract) and data/hmda_match.parquet (audit). Skips quietly when dl_hmda.py produced nothing.
"""
import os, re, glob, json, zipfile, urllib.request, pandas as pd, numpy as np, pyarrow.parquet as pq
D = os.path.join(os.path.dirname(__file__), '..', 'data'); RAW = os.path.join(os.path.dirname(__file__), '..', 'raw')
GEO = f'{RAW}/geo'; os.makedirs(GEO, exist_ok=True)
GAZ = {  # 2020-vintage tracts (HMDA 2022+), 2010-vintage tracts (HMDA 2018-2021), counties (fallback when the tract is NA)
    't20': ('https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_tracts_national.zip', '2023_Gaz_tracts_national.txt'),
    't10': ('https://www2.census.gov/geo/docs/maps-data/data/gazetteer/Gaz_tracts_national.zip', 'Gaz_tracts_national.txt'),
    'cty': ('https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_counties_national.zip', '2023_Gaz_counties_national.txt'),
}

def gazetteer(key):
    url, name = GAZ[key]
    if not os.path.exists(f'{GEO}/{name}'):
        urllib.request.urlretrieve(url, f'{GEO}/{key}.zip'); zipfile.ZipFile(f'{GEO}/{key}.zip').extractall(GEO)
    g = pd.read_csv(f'{GEO}/{name}', sep='\t', dtype={'GEOID': str}, encoding='latin-1'); g.columns = [c.strip() for c in g.columns]
    return g.set_index(g['GEOID'].str.zfill(11 if key != 'cty' else 5))[['INTPTLAT', 'INTPTLONG']]

LEGAL = {'THE', 'NA', 'INC', 'CORP', 'CORPORATION', 'CO', 'COMPANY'}
CU_WORDS = {'CREDIT', 'UNION', 'FCU', 'CU', 'FEDERAL'}   # NCUA names often drop "credit union"; LEI names keep it
def norm(s, cu=False):
    t = str(s or '').upper().replace('&', ' AND ').replace('N.A.', ' NA ')
    w = re.sub(r'[^A-Z0-9 ]+', ' ', t).replace('NATIONAL ASSOCIATION', 'NA').split()
    core = [x for x in w if x not in LEGAL and not (cu and x in CU_WORDS)]
    return ' '.join(core or w)

def rssd(v):
    try: v = int(float(v))
    except (TypeError, ValueError): return None
    return v if v > 0 else None

if __name__ == '__main__':
    files = sorted(glob.glob(f'{RAW}/hmda/mf_*.csv'))
    fpath = f'{RAW}/hmda/filers.json'
    if not files or not os.path.exists(fpath):
        print('no HMDA files; skipping'); raise SystemExit(0)
    lar = pd.concat([pd.read_csv(f, dtype=str) for f in files], ignore_index=True)
    lar['year'] = lar['activity_year'].astype(int); lar['amt'] = pd.to_numeric(lar['loan_amount'], errors='coerce')
    filers = json.load(open(fpath))

    # directory of FDIC / NCUA charters with RSSD, name, state
    inst = pd.read_parquet(f'{D}/fdic_institutions.parquet')
    banks = pd.DataFrame({'lender_id': 'B' + inst['CERT'].astype(str), 'charter': 'bank', 'name': inst['NAME'], 'state': inst['STALP'], 'active': inst['ACTIVE'] == 1,
                          'rssd': inst['FED_RSSD'].map(rssd) if 'FED_RSSD' in inst.columns else None})
    have = set(pq.read_schema(f'{D}/ncua_raw.parquet').names)
    nc = pd.read_parquet(f'{D}/ncua_raw.parquet', columns=[c for c in ['CU_NUMBER', 'CYCLE', 'CU_NAME', 'STATE', 'RSSD'] if c in have])
    nc = nc.sort_values('CYCLE').groupby('CU_NUMBER').tail(1)
    cus = pd.DataFrame({'lender_id': 'C' + nc['CU_NUMBER'].astype(str), 'charter': 'cu', 'name': nc['CU_NAME'].str.strip(), 'state': nc['STATE'].str.strip(),
                        'active': nc['CYCLE'] == nc['CYCLE'].max(), 'rssd': nc['RSSD'].map(rssd) if 'RSSD' in nc.columns else None})
    dirx = pd.concat([banks, cus], ignore_index=True)
    dirx['key'] = [norm(n, c == 'cu') for n, c in zip(dirx['name'], dirx['charter'])]
    by_rssd = dirx.dropna(subset=['rssd']).sort_values('active').drop_duplicates('rssd', keep='last').set_index('rssd')['lender_id'].to_dict()
    act = dirx[dirx['active']]
    by_name = {}
    for (ch, st, k), grp in act.groupby(['charter', 'state', 'key']): by_name[(ch, st, k)] = list(grp['lender_id'])
    by_name_nat = {}
    for (ch, k), grp in act.groupby(['charter', 'key']): by_name_nat[(ch, k)] = list(grp['lender_id'])

    def match(lei):
        f = filers.get(lei)
        if not f: return None, 'no filer record'
        r = rssd(f.get('rssd'))
        if r and r in by_rssd: return by_rssd[r], 'rssd'
        ag = str(f.get('agency') or '').strip()
        if ag == '7': return None, 'nonbank (HUD)'
        chs = ['cu'] if ag == '5' else ['bank'] if ag in ('1', '2', '3') else ['bank', 'cu']
        st = (f.get('state') or '').strip().upper()
        hits = [h for ch in chs for k in [norm(f.get('name'), ch == 'cu')] for h in (by_name.get((ch, st, k), []) if st else by_name_nat.get((ch, k), []))]
        if len(hits) == 1: return hits[0], 'name+state' if st else 'name'
        return None, 'ambiguous name' if hits else 'not a bank or credit union'

    leis = lar['lei'].unique()
    m = pd.DataFrame([(l, *match(l)) for l in leis], columns=['lei', 'lender_id', 'how'])
    m['name'] = m['lei'].map(lambda l: (filers.get(l) or {}).get('name')); m['agency'] = m['lei'].map(lambda l: (filers.get(l) or {}).get('agency'))
    m['loans'] = m['lei'].map(lar['lei'].value_counts())
    m.to_parquet(f'{D}/hmda_match.parquet', index=False)
    print('HMDA filers matched:', m['how'].value_counts().to_dict())
    print('loans by matched banks/CUs:', int(m.loc[m['lender_id'].notna(), 'loans'].sum()), 'of', len(lar))

    lar = lar.merge(m[['lei', 'lender_id']], on='lei').dropna(subset=['lender_id'])
    # tract centroid (2010 tracts before 2022, 2020 tracts from 2022), county centroid when the tract is missing
    t20, t10, cty = gazetteer('t20'), gazetteer('t10'), gazetteer('cty')
    tr = lar['census_tract'].fillna('').str.replace(r'\.0$', '', regex=True).str.zfill(11)
    old = lar['year'] < 2022
    lat = np.where(old, tr.map(t10['INTPTLAT']), tr.map(t20['INTPTLAT'])); lon = np.where(old, tr.map(t10['INTPTLONG']), tr.map(t20['INTPTLONG']))
    lat = pd.Series(lat, index=lar.index).fillna(tr.map(t20['INTPTLAT'])).fillna(tr.map(t10['INTPTLAT']))
    lon = pd.Series(lon, index=lar.index).fillna(tr.map(t20['INTPTLONG'])).fillna(tr.map(t10['INTPTLONG']))
    cc = lar['county_code'].fillna('').str.replace(r'\.0$', '', regex=True).str.zfill(5)
    lar['lat'] = lat.fillna(cc.map(cty['INTPTLAT'])); lar['lon'] = lon.fillna(cc.map(cty['INTPTLONG']))
    lar['st'] = lar['state_code'].fillna('')
    print('loans placed on the map:', int(lar['lat'].notna().sum()), 'of', len(lar))
    agg = lar.groupby(['lender_id', 'year', 'census_tract', 'st'], dropna=False).agg(n=('lei', 'size'), amt=('amt', 'sum'), lat=('lat', 'first'), lon=('lon', 'first')).reset_index()
    agg.drop(columns=['census_tract']).to_parquet(f'{D}/hmda_loans.parquet', index=False)
    print('hmda_loans', agg.shape, 'years', sorted(agg['year'].unique().tolist()))
