"""Write Census batch-geocoder input files for every credit-union branch and HQ address not already geocoded."""
import os, glob, pandas as pd
D = os.path.join(os.path.dirname(__file__), '..', 'data'); RAW = os.path.join(os.path.dirname(__file__), '..', 'raw', 'geo')
B = pd.read_parquet(f'{D}/branches.parquet'); L = pd.read_parquet(f'{D}/lenders.parquet')
cu = B[(B['lender_id'].str[0] == 'C') & B['country'].fillna('United States').str.contains('United States|USA|Puerto|Guam|Virgin', case=False)]
hq = L[(L['charter'] == 'cu') & L['active']][['lender_id', 'address', 'city', 'state', 'zip']].copy(); hq['branch_id'] = hq['lender_id'] + '-HQ'
df = pd.concat([cu[['branch_id', 'address', 'city', 'state', 'zip']], hq[['branch_id', 'address', 'city', 'state', 'zip']]], ignore_index=True).drop_duplicates('branch_id')
df['zip'] = df['zip'].astype(str).str[:5]
done = set()
for f in glob.glob(f'{RAW}/batch_*_out.csv'):
    try: done |= set(pd.read_csv(f, header=None, usecols=[0], dtype=str)[0])
    except Exception: pass
new = df[~df['branch_id'].isin(done)]
start = len(glob.glob(f'{RAW}/batch_[0-9]*.csv')) - len(glob.glob(f'{RAW}/batch_*_out.csv'))
n = len(glob.glob(f'{RAW}/batch_*_out.csv'))
for i in range(0, len(new), 9000):
    new.iloc[i:i + 9000].to_csv(f'{RAW}/batch_{n + i // 9000}.csv', index=False, header=False)
print(len(df), 'addresses;', len(new), 'new to geocode')
