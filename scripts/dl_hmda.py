"""Download HMDA multifamily (5+ unit) originations 2018-latest and the filer directory (LEI -> RSSD, agency).

Source: CFPB/FFIEC HMDA Data Browser API (free, no key). One slim CSV per year in raw/hmda/; published years never change,
so cached files are not re-fetched. Filer lookups are cached in raw/hmda/filers.json. Any failure leaves the site build
running without HMDA (run_all.sh tolerates a non-zero exit here).
"""
import csv, io, json, os, sys, time, datetime
from concurrent.futures import ThreadPoolExecutor
import requests

RAW = os.path.join(os.path.dirname(__file__), '..', 'raw', 'hmda'); os.makedirs(RAW, exist_ok=True)
API = 'https://ffiec.cfpb.gov/v2/'
UNITS = '5-24,25-49,50-99,100-149,>149'
KEEP = ['activity_year', 'lei', 'state_code', 'county_code', 'census_tract', 'loan_amount', 'loan_purpose', 'total_units', 'purchaser_type', 'business_or_commercial_purpose']
STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split()
S = requests.Session(); S.headers['User-Agent'] = 'LenderMap data build (github.com/QuerenciaRE/LenderMap)'


def get_rows(url, params):
    """Download a CSV fully (one year of multifamily loans is tens of MB) and return its rows; raises on errors or a non-CSV body."""
    for attempt in range(4):
        try:
            r = S.get(url, params=params, timeout=900)
            if r.status_code in (400, 404): r.raise_for_status()
            if r.status_code >= 500 or r.status_code == 429: raise requests.ConnectionError(f'HTTP {r.status_code}')
            r.raise_for_status()
            rd = csv.DictReader(io.StringIO(r.content.decode('utf-8', 'replace')))
            if not rd.fieldnames or 'lei' not in rd.fieldnames: raise ValueError(f'unexpected response header {rd.fieldnames[:5] if rd.fieldnames else None}')
            return [{k: x.get(k, '') for k in KEEP} for x in rd]
        except (requests.ConnectionError, requests.Timeout) as e:
            print('retry', params, e, flush=True); time.sleep(10 * (attempt + 1))
    raise RuntimeError(f'failed {url} {params}')


def fetch_year(y):
    fn = f'{RAW}/mf_{y}.csv'
    if os.path.exists(fn): return True
    base = {'years': y, 'actions_taken': '1', 'total_units': UNITS}
    rows = []
    try:
        rows = get_rows(API + 'data-browser-api/view/nationwide/csv', base)
    except Exception as e:
        print(f'nationwide {y} failed ({e}); trying state by state', flush=True)
        rows = []
        for st in STATES:
            try: rows += get_rows(API + 'data-browser-api/view/csv', {**base, 'states': st})
            except Exception as e2:
                print(f'  {y} {st}: {e2}', flush=True); return False   # year not published, or a partial year: never cache it
    if not rows: return False
    with open(fn + '.part', 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=KEEP); w.writeheader(); w.writerows(rows)
    os.replace(fn + '.part', fn); print('hmda', y, len(rows), 'multifamily originations', flush=True)
    return True


def filer(lei, year):
    """HMDA Institutions API: agency code, RSSD and respondent name/state for one LEI-year."""
    err = None
    for attempt in range(3):
        try:
            r = S.get(f'{API}public/institutions/{lei}/year/{year}', timeout=60)
            if r.status_code == 404: return None
            if r.status_code == 429: time.sleep(15 * (attempt + 1)); continue
            r.raise_for_status(); j = r.json()
            inst = (j.get('institutions') or [None])[0] if isinstance(j, dict) and 'institutions' in j else j
            if not isinstance(inst, dict): return None
            resp = inst.get('respondent') or {}
            return {'rssd': inst.get('rssd'), 'agency': inst.get('agency'), 'name': resp.get('name'), 'state': resp.get('state'), 'city': resp.get('city'), 'tax_id': inst.get('taxId'), 'year': year}
        except Exception as e:
            time.sleep(5 * (attempt + 1)); err = e
    print('filer lookup failed', lei, year, err, flush=True)
    return 'retry'   # not cached: looked up again next run


if __name__ == '__main__':
    this_year = datetime.date.today().year
    years = []
    for y in range(2018, this_year):
        if fetch_year(y): years.append(y)
        elif y >= this_year - 2: break      # newest year not released yet
        else: print('hmda', y, 'unavailable', flush=True)
    if not years: sys.exit('no HMDA years downloaded')
    # filer directory: latest year each LEI appears in
    last = {}
    for y in years:
        with open(f'{RAW}/mf_{y}.csv') as fh:
            for r in csv.DictReader(fh): last[r['lei']] = y
    fpath = f'{RAW}/filers.json'
    cache = json.load(open(fpath)) if os.path.exists(fpath) else {}
    todo = [(lei, y) for lei, y in last.items() if lei not in cache or (cache[lei] or {}).get('fallback') or (not cache[lei] and y == years[-1])]
    print('filer lookups:', len(todo), 'of', len(last), flush=True)
    with ThreadPoolExecutor(6) as ex:
        for (lei, y), rec in zip(todo, ex.map(lambda a: filer(*a), todo)):
            if rec != 'retry': cache[lei] = rec
    # the reporting filers list gives a name for any LEI the institutions lookup missed
    for y in years[::-1]:
        if all(cache.get(l) for l in last): break
        try:
            for f in S.get(f'{API}reporting/filers/{y}', timeout=120).json().get('institutions', []):
                if f.get('lei') in last and not cache.get(f['lei']): cache[f['lei']] = {'rssd': None, 'agency': None, 'name': f.get('name'), 'state': None, 'city': None, 'year': y, 'fallback': True}
        except Exception as e: print('filers list', y, e, flush=True)
    json.dump(cache, open(fpath, 'w'))
    print('filers resolved:', sum(1 for l in last if cache.get(l)), 'of', len(last))
