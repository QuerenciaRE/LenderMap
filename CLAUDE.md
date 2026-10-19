# LenderMap (CRE Lender Finder)

Free static website: a commercial-real-estate borrower types a property address and gets the banks and credit unions
nearby, ranked by their likelihood of lending on CRE, built only from public regulatory filings. Owner: Matt
(non-developer). Claude does all code changes; keep explanations short and avoid jargon in replies to him.

Read `docs/HANDOFF.md` once at the start of a new piece of work: it holds the decisions, the research findings behind
the scorecard, and the roadmap.

## Layout

- `scripts/` Python data pipeline. `run_all.sh` runs everything in order: FDIC + NCUA + FRED downloads -> parse ->
  `build_metrics.py` (harmonized quarterly metrics) -> `build_lenders.py` (directory + branches) -> Census geocoding
  of credit-union addresses -> `model_panel.py` (macro.json) -> `package_site.py` (JSON for the site).
- `site/` the website, branded LenderMapper (vanilla JS + MapLibre GL from cdnjs; no build step). Pages: `index.html`
  (Map search, `app.js`), `lookup.html` (Lender lookup, `lookup.js`), `about.html`. `core.js` is shared by both tools
  (data loading, scoring, lender details, name search, dialogs, `DEFS`); `site.js` is the phone menu on every page.
  `site/data/` is generated, never committed. Landing page asks only for the property address. Results page: two lists
  (1: lenders headquartered in the property's county; 2: lenders headquartered elsewhere in the state with a branch in
  the county or within N miles), each ordered by score, with the map on the right. Cards show only the headline
  metrics: loan/deposit, CRE lending capacity, tier 1 leverage (bank) / net worth ratio (CU), funding cost, and for
  CUs CRE granted YTD + CRE rate; a green box (`app.js::markTop`) marks the top third of the current search (both
  lists) per figure. The only user filter is the loan amount box above the results (off by default): it hides lenders
  whose lending limit or remaining CRE capacity is below the loan. Fixed rules: single/multiple common-bond credit
  unions and lenders with no CRE are never listed. The hero kicker "Updated Qn YYYY" comes from `meta.json` `latest`.
  County matching: `cty` (lender HQ county) and branch index 10 come from `package_site.py`; `core.js::CTY` normalizes names.
- Design system (from Brand Builder): `site/styles/tokens.css` holds every color, font and size; `base.css`,
  `components.css` (Stamped), `devices.css` (Press), `imagery.css` (Film), `pages.css` (layout), `app.css` (the two
  tools). No hex colors or font names outside `tokens.css`; map colors are read from the tokens in JS (`core.js::TOK`).
  Tool screens get no graphic devices except section rules and kickers. The logo uses the button face (Matt's choice),
  terracotta block; the property pin uses `--property-pin` (same terracotta) and sits above all lender pins. Reference pages (not linked from the nav):
  `styleguide.html`, `landing.html`, `article.html`, `tool.html`. Icons: Lucide sprite `site/assets/icons.svg`.
  Photo slots show the missing-image pattern until real photos are added under `site/assets/photos/`.
- `site/featured.json` (hand-edited, committed): paid placements for the landing rows and the one "Sponsored" slot above
  results. `id` is the site id (`B` + FDIC cert, `C` + NCUA charter). Entries with `"placeholder": true` show only on
  `?preview=1` or a local copy. Placements must never change score, grade or ranked order; paid ones always say "Sponsored".
- `.github/workflows/build.yml` runs the pipeline and deploys to GitHub Pages on `workflow_dispatch` and on the
  1st and 15th of each month. Source files are cached between runs under `raw/`.
- `docs/` handoff notes, model results, research outputs. `test/smoke.mjs` Playwright smoke test.
- Research-only scripts (not run by the workflow): `model_fit.py`, `export_validation_xlsx.py`.

## Commands

- Full local build (needs Python 3.11+, ~0.7 GB of downloads, 10-30 min): `pip install -r requirements.txt && bash scripts/run_all.sh`
- Serve locally after a build: `cd site && python3 -m http.server 8000` then open http://localhost:8000
- Smoke test (needs Node 18+): `cd test && npm i playwright && npx playwright install chromium && node smoke.mjs "233 S Wacker Dr, Chicago, IL"`
- Deploy: merging to `main` (any change under site/, scripts/, requirements.txt or the workflow) triggers the
  build-and-deploy workflow automatically (~15 min with cached downloads). Manual: Actions -> "Build data and
  deploy site" -> Run workflow. Site URL: https://querenciare.github.io/LenderMap/
- Matt works in Claude Code on the web: do the work on the session branch, run checks, then tell him to click
  Create PR and merge. Web sessions cannot trigger or watch GitHub Actions; say so instead of trying.
- Never commit `raw/`, `data/`, `site/data/`, or `site/artifact.html` (all in .gitignore).

## Data facts that shape the code (do not "fix" these)

- Units: FDIC amounts are reported in $ thousands (x1000 in `build_metrics.py`); NCUA in whole dollars. The site shows $M.
- Latest quarter is auto-detected (`dl_fdic.py::latest_repdte`, `dl_ncua.sh` stops at the first 404).
- NCUA changed the 5300 form in 2017Q2 (commercial schedule FS220L). `build_metrics.py::cus()` splices old/new
  account codes per cycle (`new_form` flag). Credit unions with no commercial lending leave the schedule blank -> 0.
- NCUA Acct_525 (CRE rate) is reported in basis points. Acct_788 is NOT brokered deposits (it is brokered CDs held as
  investments); NCUA has only a yes/no brokered flag (Acct_879T). Non-member deposits (Acct_880) is the shown analog.
- ~1,800 CBLR banks report no risk-based capital; capital base = tier 1 + allowance for them (`cblr_bank` flag).
- Bank NPL = 90+ days + nonaccrual; CU = 60+ days. Shown as reported, footnoted.
- Banks report no originations and no loan rates; "CRE lent YTD" is the net balance change for both charters,
  "granted YTD" exists for CUs only.
- SOD main offices often carry internet/brokered deposits: excluded from branch quartile ranks (`main_office`).
- Credit-union HQ coordinates come from Census batch geocoding (free) with ZIP-centroid fallback; FDIC supplies bank
  coordinates. Address lookup in the browser uses Photon (OpenStreetMap), Nominatim fallback, then ZIP centroid.
- Mergers: history is as reported per charter; no restatement.
- Engine-only fields (in lenders.json/history, not yet shown in the UI): free deposits (bank DEPNI; CUs report none),
  CDs (bank NTRTIME, CU Acct_908A), money market (bank NTRSMMDA, CU Acct_911), net charge-offs (bank NTLNLS, CU
  Acct_550-551; CRE charge-offs banks only), REO (bank ORE = real estate only; CU Acct_798A = all foreclosed and
  repossessed assets, autos included), bank 30-89 days past due. Optional FDIC fields are probed in `dl_fdic.py` and
  dropped if the API rejects them; `build_metrics.py` logs how many lenders have each field filled.

## National score (client-side, `core.js::rankAll`)

Set by Matt on 2026-10-19, replacing the research-weighted scorecard (the old `sc`/`pen` fields are still produced by
`package_site.py` but unused). Four measures, equal weight: loan to deposit (lower better), CRE lending capacity in
dollars (higher better; bank `caprem`, CU `mblrem`, low-income CUs = no cap = best), capital ratio (bank `t1`, CU `nwr`,
higher better), funding cost (lower better). Each is ranked against every lender in `lenders.json`: 4 points for the
best quarter down to 1; capacity and capital ratio are ranked within charter (banks vs banks, CUs vs CUs); a missing
figure earns 1. Score = sum, 4-16. Grades: A+ = 16, then A-D = national quarters of the score, ties to the higher grade.
Lists sort by score, then the finer within-measure position. The lender details show the score and each measure's points.

## Conventions

- Keep the site dependency-free apart from MapLibre; everything must work as static files on GitHub Pages.
- Any new metric: add to `build_metrics.py`, then `KEYS` in `package_site.py`, then `COLS` (CSV) in `app.js` and
  `HIST_ROWS`/`DEFS` in `core.js`.
- Footnote every bank-vs-credit-union definitional difference in the Definitions (`DEFS` in `core.js`; shown in the
  Map search dialog and on the About page).
- Dollar columns are $M with one decimal, negatives in brackets; ratios in percent with two decimals; changes as a
  triangle plus a signed value (`core.js::fmtChg`); years shown as same-quarter series.
- Commit messages: short imperative summary. Run the smoke test before pushing UI changes when Node is available.
