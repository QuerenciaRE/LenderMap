"""Download FDIC BankFind data: quarterly financials 2016Q1-latest, institutions, locations, SOD 2016-latest."""
import requests, json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__)); from fdic_fields import FIN_FIELDS
RAW = os.path.join(os.path.dirname(__file__), '..', 'raw', 'fdic'); os.makedirs(RAW, exist_ok=True)
API = "https://api.fdic.gov/banks/"
S = requests.Session()

def fetch_all(endpoint, filters, fields, page=10000):
    out, offset = [], 0
    while True:
        for attempt in range(5):
            try:
                r = S.get(API+endpoint, params={"filters": filters, "fields": ",".join(fields), "limit": page, "offset": offset}, timeout=180)
                r.raise_for_status(); j = r.json(); break
            except Exception as e:
                print("retry", endpoint, filters, offset, e); time.sleep(5*(attempt+1))
        else: raise RuntimeError("failed "+filters)
        rows = [d['data'] for d in j['data']]; out += rows
        total = j['meta']['total']
        if len(rows) < page or len(out) >= total: break
        offset += page
    return out, total

def latest_repdte():
    r = S.get(API + "financials", params={"filters": "CERT:3511", "fields": "REPDTE", "sort_by": "REPDTE", "sort_order": "DESC", "limit": 1}, timeout=60)
    return r.json()["data"][0]["data"]["REPDTE"]

def quarters():
    last = latest_repdte()
    for y in range(2016, 2100):
        for md in ("0331", "0630", "0930", "1231"):
            d = f"{y}{md}"
            if d > last: return
            yield d

if __name__ == "__main__":
    # 1. financials by quarter
    qs = list(quarters())
    for d in qs:
        fn = f"{RAW}/fin_{d}.json"
        if os.path.exists(fn) and d != qs[-1]: continue
        rows, total = fetch_all("financials", f"REPDTE:{d}", FIN_FIELDS)
        assert len(rows) == total, (d, len(rows), total)
        json.dump(rows, open(fn, "w")); print("fin", d, len(rows), flush=True)
    # 2. institutions (all, active and inactive) 
    INST = "CERT NAME ADDRESS CITY STALP ZIP LATITUDE LONGITUDE OFFICES ACTIVE BKCLASS CB ASSET DEP RSSDHCR NAMEHCR SPECGRP SPECGRPN REGAGNT WEBADDR ESTYMD ENDEFYMD PROCDATE STNAME COUNTY CBSA MUTUAL SUBCHAPS NEWCERT FEDCHRTR STCHRTR".split()
    fn = f"{RAW}/institutions.json"
    if True:
        rows, total = fetch_all("institutions", "ACTIVE:1", INST)
        rows2, total2 = fetch_all("institutions", "ACTIVE:0 AND ENDEFYMD:[2015-12-31 TO 2030-12-31]", INST)
        json.dump(rows+rows2, open(fn, "w")); print("institutions", len(rows), "active", len(rows2), "closed since 2016")
    # 3. locations (branches, active)
    fn = f"{RAW}/locations.json"
    if True:
        LOC = "UNINUM CERT NAME OFFNAME OFFNUM ADDRESS CITY STALP ZIP LATITUDE LONGITUDE MAINOFF SERVTYPE ESTYMD COUNTY CBSA_NO CBSA".split()
        rows, total = fetch_all("locations", "CERT:[0 TO 999999]", LOC)
        json.dump(rows, open(fn, "w")); print("locations", len(rows), total)
    # 4. SOD by year
    SOD = "YEAR CERT UNINUMBR BRNUM NAMEFULL NAMEBR ADDRESBR CITYBR STALPBR ZIPBR CNTYNAMB SIMS_LATITUDE SIMS_LONGITUDE DEPSUMBR DEPSUM ASSET BKMO BRSERTYP MSABR CBSA_DIV_NAMB SIMS_ESTABLISHED_DATE SIMS_ACQUIRED_DATE RSSDHCR NAMEHCR".split()
    for y in range(2016, 2100):
        fn = f"{RAW}/sod_{y}.json"
        if os.path.exists(fn): continue
        rows, total = fetch_all("sod", f"YEAR:{y}", SOD)
        if not rows: break
        json.dump(rows, open(fn, "w")); print("sod", y, len(rows), total, flush=True)
