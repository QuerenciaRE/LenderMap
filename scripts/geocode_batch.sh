#!/bin/bash
# Census batch geocoder (free, no key). A failed batch is deleted so the merge step falls back to ZIP centroids for it.
cd "$(dirname "$0")/../raw/geo"
for f in $(ls batch_*.csv 2>/dev/null | grep -v _out); do
  out="${f%.csv}_out.csv"
  [ -s "$out" ] && continue
  echo "$(date +%T) geocoding $f"
  if curl -sS -m 1500 --retry 2 --form addressFile=@$f --form benchmark=Public_AR_Current "https://geocoding.geo.census.gov/geocoder/locations/addressbatch" -o "$out" && [ -s "$out" ] && head -1 "$out" | grep -q '"'; then
    echo "$(date +%T) done $f -> $(wc -l < $out) lines"
  else
    echo "$(date +%T) FAILED $f (ZIP-centroid fallback will be used)"; rm -f "$out"
  fi
done
exit 0
