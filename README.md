# LenderMap — CRE Lender Finder

Free, static website that ranks banks and credit unions near a property address by their likelihood of lending on
commercial real estate, built entirely from public regulatory filings (FDIC Call Reports and Summary of Deposits,
NCUA 5300 Call Reports and branch files, FRED). No server, no database, no API keys.

## Working on this repo with Claude Code

Open the repo in Claude Code on the web (claude.ai/code); it reads `CLAUDE.md` automatically and `docs/HANDOFF.md`
has the full context. Ask for changes in plain language, click **Create PR**, merge on GitHub, and the Action rebuilds
and redeploys the site by itself (about 15 minutes).

## One-time setup (about 15 minutes, no coding)

1. Create a free account at https://github.com if you do not have one.
2. Click **New repository**, name it `cre-lender-finder`, leave it **Public** (GitHub Pages is free on public repos), click **Create repository**.
3. On the empty repository page click **uploading an existing file**, drag in **everything inside this folder**
   (the `scripts`, `site`, `.github` folders and the files `README.md`, `requirements.txt`, `.gitignore`), then click **Commit changes**.
   - If the upload tool skips the `.github` folder (some browsers hide dot-folders), use **Add file → Create new file**,
     type the path `.github/workflows/build.yml` and paste the contents of that file.
4. Go to **Settings → Pages**. Under **Build and deployment → Source** choose **GitHub Actions**.
5. Go to the **Actions** tab, click **Build data and deploy site** in the left list, then **Run workflow → Run workflow**.
   The first run downloads ~0.6 GB of call reports and takes 20–40 minutes. When it turns green, the site is live at
   `https://<your-username>.github.io/cre-lender-finder/`.

After that the workflow runs by itself whenever `main` changes and on the 1st and 15th of every month and republishes with the newest quarter
automatically (bank and credit-union call reports appear about 60 days after each quarter end; branch deposits once a
year in late September). Nothing else to maintain.

## Custom domain (optional)

Buy a domain anywhere, then in **Settings → Pages → Custom domain** enter it and add the DNS records GitHub shows.

## What is in here

- `scripts/` — the data pipeline (`run_all.sh` runs everything in order):
  download FDIC and NCUA data, harmonize bank and credit-union fields, compute the metrics, geocode credit-union
  addresses with the Census geocoder, package compact JSON for the site. `model_fit.py` and `export_validation_xlsx.py`
  are the research scripts used to set the default scorecard weights; they are not needed for the site.
- `site/` — the website: `index.html`, `app.css`, `app.js`. Data lands in `site/data/` when the pipeline runs.
- `.github/workflows/build.yml` — the schedule and deployment.

## Running locally (optional, needs Python 3.11+)

    pip install -r requirements.txt
    bash scripts/run_all.sh
    cd site && python3 -m http.server 8000      # then open http://localhost:8000

## Data notes

All definitions, sources and known gaps are in the site's **Definitions** and **About** pages. Headline caveats:
banks do not report loan originations or interest rates (net balance changes and blended yields are used); NCUA
reports no branch-level deposits and no brokered-deposit dollars; the two regulators define non-performing loans
differently (90+ days vs 60+ days). Everything is shown as reported.
