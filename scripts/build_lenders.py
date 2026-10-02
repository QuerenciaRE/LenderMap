"""Lender directory (one row per institution) and branch tables."""
import os, io, csv, zipfile, glob, numpy as np, pandas as pd
D = os.path.join(os.path.dirname(__file__), '..', 'data'); RAW = os.path.join(os.path.dirname(__file__), '..', 'raw')

TOM = {'00': 'Community', '66': 'Community', '77': 'Community', '99': 'State charter (FOM not reported)', '24': 'Single common bond'}
def fom_class(code):
    code = (code or '').strip()
    if code in TOM: return TOM[code]
    if code.isdigit() and int(code) < 30: return 'Single common bond'
    return 'Multiple common bond'

def banks():
    i = pd.read_parquet(f'{D}/fdic_institutions.parquet')
    thrift = i['BKCLASS'].isin(['SB', 'SA', 'SI', 'SL'])
    return pd.DataFrame({
        'lender_id': 'B' + i['CERT'].astype(str), 'charter': 'bank', 'name': i['NAME'], 'address': i['ADDRESS'], 'city': i['CITY'],
        'state': i['STALP'], 'zip': i['ZIP'].astype(str).str.zfill(5), 'lat': i['LATITUDE'], 'lon': i['LONGITUDE'],
        'active': i['ACTIVE'] == 1, 'closed_date': i['ENDEFYMD'], 'successor_id': np.where(i['NEWCERT'].fillna(0) > 0, 'B' + i['NEWCERT'].fillna(0).astype(int).astype(str), None),
        'offices': i['OFFICES'], 'website': i['WEBADDR'], 'holding_company': i['NAMEHCR'], 'bkclass': i['BKCLASS'],
        'charter_class': np.where(i['BKCLASS'] == 'OI', 'Insured branch of foreign bank', np.where(thrift, 'Savings institution', 'Commercial bank')),
        'community_bank': i['CB'] == 1, 'specialization': i['SPECGRPN'], 'fom_class': None, 'licu': None, 'established': i['ESTYMD'],
    })

def cus():
    r = pd.read_parquet(f'{D}/ncua_raw.parquet', columns=['CU_NUMBER', 'CYCLE', 'CU_NAME', 'STREET', 'CITY', 'STATE', 'ZIP_CODE', 'TOM_CODE', 'LIMITED_INC', 'CU_TYPE', 'PEER_GROUP', 'YEAR_OPENED'])
    last = r.sort_values('CYCLE').groupby('CU_NUMBER').tail(1)
    latest_cycle = r['CYCLE'].max()
    return pd.DataFrame({
        'lender_id': 'C' + last['CU_NUMBER'].astype(str), 'charter': 'cu', 'name': last['CU_NAME'].str.strip(), 'address': last['STREET'].str.strip(),
        'city': last['CITY'].str.strip(), 'state': last['STATE'].str.strip(), 'zip': last['ZIP_CODE'].astype(str).str.strip().str[:5].str.zfill(5), 'lat': np.nan, 'lon': np.nan,
        'active': last['CYCLE'] == latest_cycle, 'closed_date': np.where(last['CYCLE'] == latest_cycle, None, last['CYCLE']), 'successor_id': None,
        'offices': np.nan, 'website': None, 'holding_company': None, 'bkclass': 'CU',
        'charter_class': last['CU_TYPE'].map({'1': 'Federal credit union', '2': 'State credit union (federally insured)', '3': 'State credit union (privately insured)'}),
        'community_bank': None, 'specialization': None, 'fom_class': last['TOM_CODE'].map(fom_class), 'licu': last['LIMITED_INC'] == '1', 'established': last['YEAR_OPENED'],
    })

def cu_branches():
    zp = sorted(glob.glob(f'{RAW}/ncua/call-report-data-*.zip'))[-1]
    z = zipfile.ZipFile(zp); n = [x for x in z.namelist() if x.lower().startswith('credit union branch')][0]
    with z.open(n) as fh:
        b = pd.read_csv(io.TextIOWrapper(fh, encoding='latin-1'), dtype=str, low_memory=False)
    b.columns = [c.upper() for c in b.columns]
    return pd.DataFrame({
        'branch_id': 'C' + b['CU_NUMBER'] + '-' + b['SITEID'], 'lender_id': 'C' + b['CU_NUMBER'], 'name': b['SITENAME'].str.strip(), 'site_type': b['SITETYPENAME'],
        'main_office': b['MAINOFFICE'].str.upper() == 'YES', 'address': b['PHYSICALADDRESSLINE1'].str.strip(), 'city': b['PHYSICALADDRESSCITY'].str.strip(),
        'state': b['PHYSICALADDRESSSTATECODE'].str.strip(), 'zip': b['PHYSICALADDRESSPOSTALCODE'].str.strip().str[:5], 'county': b['PHYSICALADDRESSCOUNTYNAME2'],
        'country': b['PHYSICALADDRESSCOUNTRY'], 'lat': np.nan, 'lon': np.nan, 'deposits': np.nan, 'member_services': b['MEMBERSERVICES'], 'atm': b['ATM'], 'drive_thru': b['DRIVETHRU'],
    })

def bank_branches():
    l = pd.read_parquet(f'{D}/fdic_locations.parquet')
    s = pd.read_parquet(f'{D}/fdic_sod_raw.parquet')
    s['UNINUMBR'] = pd.to_numeric(s['UNINUMBR'], errors='coerce'); s['DEPSUMBR'] = pd.to_numeric(s['DEPSUMBR'], errors='coerce')
    dep = s.pivot_table(index='UNINUMBR', columns='YEAR', values='DEPSUMBR', aggfunc='first')
    dep.columns = [f'dep_{int(c)}' for c in dep.columns]
    l['UNINUM'] = pd.to_numeric(l['UNINUM'], errors='coerce')
    o = pd.DataFrame({
        'branch_id': 'B' + l['CERT'].astype(str) + '-' + l['UNINUM'].astype('Int64').astype(str), 'lender_id': 'B' + l['CERT'].astype(str), 'name': l['OFFNAME'],
        'site_type': l['SERVTYPE'], 'main_office': l['MAINOFF'].astype(str) == '1', 'address': l['ADDRESS'], 'city': l['CITY'], 'state': l['STALP'], 'zip': l['ZIP'].astype(str).str.zfill(5),
        'county': l['COUNTY'], 'country': 'United States', 'lat': pd.to_numeric(l['LATITUDE'], errors='coerce'), 'lon': pd.to_numeric(l['LONGITUDE'], errors='coerce'),
        'uninum': l['UNINUM'],
    })
    o = o.merge(dep, left_on='uninum', right_index=True, how='left')
    yrs = sorted([c for c in o.columns if c.startswith('dep_')])
    o['deposits'] = o[yrs[-1]] * 1000.0            # latest SOD, $ (SOD reports thousands)
    for c in yrs: o[c] = o[c] * 1000.0
    return o.drop(columns=['uninum'])

if __name__ == '__main__':
    L = pd.concat([banks(), cus()], ignore_index=True)
    L.to_parquet(f'{D}/lenders.parquet', index=False); print('lenders', L.shape, L.groupby(['charter', 'active']).size().to_dict())
    B = pd.concat([bank_branches(), cu_branches()], ignore_index=True)
    for c in ['site_type', 'name', 'address', 'city', 'state', 'zip', 'county', 'country', 'member_services', 'atm', 'drive_thru']: B[c] = B[c].astype(str).where(B[c].notna(), None)
    B.to_parquet(f'{D}/branches.parquet', index=False); print('branches', B.shape, B.groupby('lender_id').size().groupby(B.drop_duplicates('lender_id').set_index('lender_id').index.str[0]).sum().to_dict() if False else B['lender_id'].str[0].value_counts().to_dict())
    print('bank branches with SOD deposits:', B[B.lender_id.str.startswith('B')]['deposits'].notna().sum())
