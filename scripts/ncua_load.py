"""Parse NCUA 5300 quarterly zips into one long table of selected accounts (CU_NUMBER, CYCLE, account -> value)."""
import zipfile, io, csv, os, sys, glob
import pandas as pd

RAW = os.path.join(os.path.dirname(__file__), '..', 'raw', 'ncua')
# concept candidates: we load all of these raw; splicing decided later with data in hand
ACCTS = """Acct_010 Acct_018 Acct_013 Acct_025B Acct_041B Acct_110 Acct_115 Acct_350 Acct_380 Acct_381 Acct_340 Acct_661A Acct_997 Acct_998
Acct_788 Acct_879T Acct_879N Acct_459 Acct_880 Acct_860C Acct_010A Acct_010C Acct_031A Acct_031B Acct_730A Acct_730B
Acct_400A Acct_400A1 Acct_400B1 Acct_400T1 Acct_400H Acct_400H2 Acct_400H3 Acct_400J Acct_400J2 Acct_400J3 Acct_400M Acct_400M1 Acct_400G Acct_400L Acct_400L2 Acct_400L3
Acct_143B Acct_143B3 Acct_143B4 Acct_143D3 Acct_718A Acct_718A3 Acct_718A4 Acct_042A5 Acct_042A6 Acct_042A7 Acct_042A8
Acct_475A Acct_475A1 Acct_475B1 Acct_475H Acct_475H2 Acct_475J Acct_475J2 Acct_475K Acct_475K2 Acct_475K3 Acct_475M Acct_475L2 Acct_463A5
Acct_090A Acct_090A1 Acct_090K Acct_090K2 Acct_090H2 Acct_090J2 Acct_090M Acct_041G Acct_041G3 Acct_041G4 Acct_041H1
Acct_525 Acct_526 Acct_562B Acct_563A Acct_562A Acct_703A Acct_386A Acct_025A Acct_300 Acct_301 Acct_671 Acct_672 Acct_902 Acct_083""".split()

def load_quarter(zpath):
    cycle = os.path.basename(zpath)[17:24]  # e.g. 2026-06
    z = zipfile.ZipFile(zpath)
    names = {n.lower(): n for n in z.namelist()}
    frames = []
    for n in z.namelist():
        ln = n.lower()
        if not (ln.startswith('fs220') and ln.endswith('.txt')): continue
        with z.open(n) as fh:
            hdr = next(csv.reader(io.TextIOWrapper(fh, encoding='latin-1')))
        up = {h.upper(): h for h in hdr}
        want = [up[a.upper()] for a in ACCTS if a.upper() in up]
        if not want: continue
        with z.open(n) as fh:
            df = pd.read_csv(io.TextIOWrapper(fh, encoding='latin-1'), usecols=['CU_NUMBER'] + want, dtype={'CU_NUMBER': int}, low_memory=False)
        df.columns = [c.upper() if c != 'CU_NUMBER' else c for c in df.columns]
        df = df.set_index('CU_NUMBER')
        df = df[~df.index.duplicated()]
        frames.append(df)
    wide = pd.concat(frames, axis=1)
    wide = wide.loc[:, ~wide.columns.duplicated()]
    wide.insert(0, 'CYCLE', cycle)
    # FOICU: names, state, charter type, LICU
    fo = names.get('foicu.txt')
    with z.open(fo) as fh:
        f = pd.read_csv(io.TextIOWrapper(fh, encoding='latin-1'), dtype=str, low_memory=False)
    f.columns = [c.upper() for c in f.columns]
    keep = [c for c in ['CU_NUMBER','CU_NAME','CITY','STATE','ZIP_CODE','CU_TYPE','TOM_CODE','LIMITED_INC','PEER_GROUP','RSSD','YEAR_OPENED','ISMDI','STREET','COUNTY_CODE'] if c in f.columns]
    f = f[keep].copy(); f['CU_NUMBER'] = f['CU_NUMBER'].astype(int); f = f.set_index('CU_NUMBER'); f = f[~f.index.duplicated()]
    wide = f.join(wide, how='inner').reset_index()
    return wide

if __name__ == '__main__':
    out = []
    for zp in sorted(glob.glob(f'{RAW}/call-report-data-*.zip')):
        w = load_quarter(zp); out.append(w); print(w['CYCLE'].iloc[0], len(w), w.shape[1], flush=True)
    allq = pd.concat(out, ignore_index=True)
    allq.to_parquet(os.path.join(RAW, '..', '..', 'data', 'ncua_raw.parquet'), index=False)
    print(allq.shape)
