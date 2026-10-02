#!/bin/bash
# Full pipeline: download -> parse -> metrics -> geocode -> package site. Safe to re-run; downloads are cached in raw/.
set -e
export PYTHONUNBUFFERED=1
cd "$(dirname "$0")/.."
mkdir -p raw/fdic raw/ncua raw/geo raw/fred data site/data
echo "== FDIC";  python3 scripts/dl_fdic.py
echo "== NCUA";  bash scripts/dl_ncua.sh
echo "== FRED";  for s in DFF SOFR DGS2 DGS5 DGS10 UNRATE DRTSCLCC SUBLPDRCSC COMREPUSQ159N BAMLC0A4CBBB; do curl -sS -m 60 --retry 2 -o raw/fred/$s.csv "https://fred.stlouisfed.org/graph/fredgraph.csv?id=$s" || echo "FRED $s unavailable"; done
echo "== parse";  python3 scripts/fdic_load.py && python3 scripts/ncua_load.py
echo "== metrics"; python3 scripts/build_metrics.py && python3 scripts/build_lenders.py
echo "== geocode"; python3 scripts/geocode_prepare.py && bash scripts/geocode_batch.sh && python3 scripts/geocode_merge.py
echo "== panel";  python3 scripts/model_panel.py
echo "== package"; python3 scripts/package_site.py
echo "done"
