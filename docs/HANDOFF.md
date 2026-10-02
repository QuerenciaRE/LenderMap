# Handoff notes — LenderMap

Written 2026-10-02 at the end of the design-and-build session that produced this repo. Everything below was decided
with Matt; change it only when he asks.

## 1. Product

Two audiences, built in this order:

1. **Borrowers (v1, built).** Enter a property address -> lenders that are (a) headquartered within N miles, or
   (b) headquartered in the property's state (or within a larger radius) AND have a branch within M miles.
   Defaults: 10 mi for (a); in-state + 5 mi branch, optional 100 mi HQ for (b). User toggles which mode, picks
   investment vs owner-occupied use, optional loan amount, lender-type filters, and scorecard weights. Output: ranked
   table of the 16 requested metrics, per-lender annual history 2016-latest (same quarter each year), branch popups with
   deposit strength (banks only).
2. **Banks (v2, not built).** Branch gap / closure analysis: where competitors have strong branches, where own branches
   are bottom-quartile or losing deposits. All the data for it is already in `site/data/branches/*.json`
   (every bank branch with coordinates and June-30 deposits 2016-latest). This is a front-end addition.

Decisions from the Q&A:
- Show as-reported figures when bank and credit-union definitions differ, with footnotes, plus the closest
  apples-to-apples version where one exists (e.g. net CRE balance change for both; CU "granted YTD" alongside).
- Show CU branches without deposits (NCUA publishes none). Flag HQ/main offices and exclude from branch quartiles.
- Annual view = the same quarter as the latest available quarter, every year (so YTD items compare like with like).
- Mergers: pre-merger history stays under the acquired charter; the survivor shows only its own history.
- Non-owner-occupied nonresidential is labelled "commercial investment"; call reports have no office/retail/industrial split.
- Thrifts/savings institutions included (toggle). Debt funds, life companies, agencies: out of scope (no public filings) — revisit later.
- No domain yet; GitHub Pages default URL.

## 2. Data sources (all free, no keys)

| Source | What | Notes |
|---|---|---|
| FDIC BankFind Suite API `api.fdic.gov/banks/{financials,institutions,locations,sod}` | Quarterly Call Report financials 2016Q1->latest (80 fields), institution directory with coordinates, branch locations, Summary of Deposits (branch deposits each June 30) | 10,000 rows per request; we query per quarter / per year |
| NCUA quarterly zips `ncua.gov/files/publications/analysis/call-report-data-YYYY-MM.zip` | Form 5300 call reports (FS220*.txt), FOICU directory, Credit Union Branch Information | Form changed 2017Q2; account mapping in `build_metrics.py` |
| FRED CSV (no key) | DFF, SOFR, DGS2/5/10, UNRATE, DRTSCLCC (SLOOS CRE tightening), SUBLPDRCSC, COMREPUSQ159N, BAMLC0A4CBBB | BBB OAS only ~3 years without a key; tolerated as missing |
| Census geocoder (batch, free) + ZCTA gazetteer | CU branch/HQ coordinates; ZIP centroids | 74% exact, 10% non-exact, 13% ZIP centroid, 3% unresolved (foreign/military) |
| Photon (komoot) / Nominatim | In-browser address lookup | Both allow cross-origin requests; Census geocoder does not |
| OpenFreeMap `tiles.openfreemap.org/styles/positron` | Basemap tiles | Free, no key |

Validation done: active-bank assets sum to $26.46T = FDIC Q2 2026 QBP; top-10 CU assets match published figures to
$0.01B; computed NPL/ROA/brokered ratios equal FDIC-published ratios exactly; NIM differs by design (avg assets vs
avg earning assets, both shown).

## 3. Research behind the scorecard (`docs/model_results.txt`, `docs/model_results.xlsx`)

Panel of 381,507 lender-quarters with a 4-quarter-ahead target (change in total CRE as % of assets; mergers with
>30% asset jumps excluded; winsorized 1/99). Out-of-sample test trained through 2022Q2 targets, tested 2023Q3-2025Q2:

- Banks: rank correlation 0.37 (0.36-0.40 across 8 quarters), R² 0.14; top predicted decile grew CRE 4.28 pts of assets vs 0.09 for the bottom decile.
- Credit unions: rank correlation 0.33, R² 0.15; deciles 1.57 vs 0.14.
- Strongest predictors (both): trailing CRE growth, CRE share of loans, CRE and construction as % of capital, size,
  deposit growth; NPLs negative. Tier 1 leverage mildly negative univariately, positive holding concentration fixed.
- Caps bind only at the extremes: bank growth rises up to 350-400% of capital, falls above 400% and 500%;
  construction peaks at 125-150%; non-LICU CUs peak at 50-75% of the MBL cap and dip at 90-100%.
- Macro: aggregate bank CRE growth correlates -0.78 with SLOOS tightening, -0.65 with fed funds, +0.70 with CRE
  price growth, +0.54 with curve slope; CUs far less rate-sensitive. Interactions: in high-rate periods concentration
  matters less for ranking, capital and loan yield matter more; CUs charging higher CRE rates grow more when rates are high.
- CU originations check (true dollars granted): CRE share of loans and CRE % of capital have 0.71-0.74 rank
  correlation with next-year originations.

Matt's framing, agreed: the model cannot predict how much a given lender will lend, but it sorts lenders reliably.
Product claim is "likely vs unlikely CRE lenders near this address", shown as tiers, never as approval odds.

## 4. Known gaps / ideas

- Bank CRE-specific interest income (Schedule RI items) is not in the FDIC API; the FFIEC CDR bulk files would allow a
  bank CRE yield proxy. HMDA multifamily originations could add true bank originations for multifamily only.
- Branch-level deposit cost does not exist publicly; "expensive deposits" is institution-level only.
- CU field-of-membership for state charters (TOM code 99) is not classified by NCUA; treated as eligible by default.
- `site/data/lenders.json` is 4 MB (1.2 MB gzipped); branches are per-state files loaded by bounding box; per-lender
  history files are loaded on click. Fine for GitHub Pages; revisit if traffic grows.
- The claude.ai preview build (`CFG.offline=true`, state-sharded history) exists only because that sandbox blocks
  outside hosts; the hosted site uses full address lookup and street tiles.
- Photon is a free community service; heavy traffic would justify a paid geocoder.

## 5. Status at handoff

- First GitHub Actions run (repo QuerenciaRE/LenderMap) failed in the panel step because `run_all.sh` did not
  download `BAMLC0A4CBBB.csv`; fixed in this version (download added, `model_panel.py` tolerates missing series).
  A clean end-to-end run of the fixed pipeline succeeded locally.
- Next action: push this version to `main`, run the workflow, confirm the Pages URL loads and a search works.
