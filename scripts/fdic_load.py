"""Combine downloaded FDIC JSON into parquet tables."""
import json, glob, os, pandas as pd
RAW = os.path.join(os.path.dirname(__file__), '..', 'raw', 'fdic'); OUT = os.path.join(os.path.dirname(__file__), '..', 'data')
fin = pd.concat([pd.DataFrame(json.load(open(f))) for f in sorted(glob.glob(f'{RAW}/fin_*.json'))], ignore_index=True)
fin['REPDTE'] = fin['REPDTE'].astype(str)
fin.to_parquet(f'{OUT}/fdic_fin_raw.parquet', index=False); print('fin', fin.shape)
inst = pd.DataFrame(json.load(open(f'{RAW}/institutions.json'))); inst.to_parquet(f'{OUT}/fdic_institutions.parquet', index=False); print('inst', inst.shape)
loc = pd.DataFrame(json.load(open(f'{RAW}/locations.json'))); loc = loc.astype({c:str for c in loc.columns if loc[c].dtype==object}); loc.to_parquet(f'{OUT}/fdic_locations.parquet', index=False); print('loc', loc.shape)
sod = pd.concat([pd.DataFrame(json.load(open(f))) for f in sorted(glob.glob(f'{RAW}/sod_*.json'))], ignore_index=True)
sod = sod.astype({c:str for c in sod.columns if sod[c].dtype==object}); sod.to_parquet(f'{OUT}/fdic_sod_raw.parquet', index=False); print('sod', sod.shape)
