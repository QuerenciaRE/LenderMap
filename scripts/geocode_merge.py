"""Merge Census batch geocoder output; fall back to ZIP (ZCTA) centroid for non-matches."""
import glob, os, pandas as pd, numpy as np
RAW = os.path.join(os.path.dirname(__file__), '..', 'raw', 'geo'); D = os.path.join(os.path.dirname(__file__), '..', 'data')
cols = ['branch_id', 'input', 'match', 'matchtype', 'matched_addr', 'coords', 'tiger', 'side']
out = pd.concat([pd.read_csv(f, header=None, names=cols, dtype=str) for f in sorted(glob.glob(f'{RAW}/batch_*_out.csv'))], ignore_index=True).drop_duplicates('branch_id', keep='last')
ok = out['match'] == 'Match'
ll = out.loc[ok, 'coords'].str.split(',', expand=True).astype(float)
out['lon'] = np.nan; out['lat'] = np.nan
out.loc[ok, 'lon'] = ll[0].values; out.loc[ok, 'lat'] = ll[1].values
out['geo_source'] = np.where(ok, 'census_' + out['matchtype'].fillna('').str.lower(), None)
# ZIP fallback
inp = pd.concat([pd.read_csv(f, header=None, names=['branch_id', 'address', 'city', 'state', 'zip'], dtype=str) for f in sorted(glob.glob(f'{RAW}/batch_[0-9]*.csv')) if '_out' not in f], ignore_index=True)
import urllib.request, zipfile
if not os.path.exists(f'{RAW}/2023_Gaz_zcta_national.txt'):
    urllib.request.urlretrieve('https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip', f'{RAW}/zcta.zip'); zipfile.ZipFile(f'{RAW}/zcta.zip').extractall(RAW)
z = pd.read_csv(f'{RAW}/2023_Gaz_zcta_national.txt', sep='\t', dtype={'GEOID': str}); z.columns = [c.strip() for c in z.columns]
z = z.set_index('GEOID')[['INTPTLAT', 'INTPTLONG']]
out = out.merge(inp[['branch_id', 'zip']], on='branch_id', how='left')
miss = out['lat'].isna()
out.loc[miss, 'lat'] = out.loc[miss, 'zip'].str[:5].map(z['INTPTLAT']); out.loc[miss, 'lon'] = out.loc[miss, 'zip'].str[:5].map(z['INTPTLONG'])
out.loc[miss & out['lat'].notna(), 'geo_source'] = 'zip_centroid'
out['lender_id'] = out['branch_id'].str.split('-').str[0]
out[['branch_id', 'lender_id', 'lat', 'lon', 'geo_source']].to_parquet(f'{D}/cu_geocoded.parquet', index=False)
print(out['geo_source'].value_counts(dropna=False).to_dict(), len(out))
