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
- `site/` the website: `index.html`, `app.css`, `app.js` (vanilla JS + MapLibre GL from cdnjs; no build step).
  `site/data/` is generated, never committed. Layout follows Airbnb-style patterns (see `PLAN.md`): landing page with a
  segmented search pill, results with chips + Filters modal, cards/table toggle, resizable list/map split.
- `site/featured.json` (hand-edited, committed): paid placements for the landing rows and the one "Sponsored" slot above
  results. `id` is the site id (`B` + FDIC cert, `C` + NCUA charter). Entries with `"placeholder": true` show only on
  `?preview=1` or a local copy. Placements must never change score, tier or ranked order; paid ones always say "Sponsored".
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

## Scorecard (client-side, `app.js::scoreOf`)

Components are national percentiles computed in `package_site.py` (`sc` object per lender): CRE momentum, CRE
franchise, deposit growth, asset quality, capital, margin. Default weights 25/25/15/15/10/10 came from the
out-of-sample study in `docs/HANDOFF.md`. Penalties: >400% investment CRE/capital x0.85, >500% x0.70, construction
>150% x0.90, CU MBL cap 90-100% used x0.80, no CRE on the books x0.5. Tiers A-E = national quintiles of the score.
Changing component definitions means editing both `package_site.py` (percentiles) and `app.js` (weights, Definitions text).

## Conventions

- Keep the site dependency-free apart from MapLibre; everything must work as static files on GitHub Pages.
- Any new metric: add to `build_metrics.py`, then `KEYS` in `package_site.py`, then `COLS`/`HIST_ROWS`/`DEFS` in `app.js`.
- Footnote every bank-vs-credit-union definitional difference in the Definitions modal (`DEFS` in `app.js`).
- Dollar columns are $M with one decimal; ratios in percent with two decimals; years shown as same-quarter series.
- Commit messages: short imperative summary. Run the smoke test before pushing UI changes when Node is available.
