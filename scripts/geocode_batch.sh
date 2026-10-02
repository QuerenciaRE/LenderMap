#!/bin/bash
cd "$(dirname "$0")/../raw/geo"
for f in $(ls batch_*.csv | grep -v _out); do
  out="${f%.csv}_out.csv"
  [ -s "$out" ] && continue
  echo "$(date +%T) geocoding $f"
  curl -sS -m 1200 --form addressFile=@$f --form benchmark=Public_AR_Current "https://geocoding.geo.census.gov/geocoder/locations/addressbatch" -o "$out"
  echo "$(date +%T) done $f -> $(wc -l < $out) lines"
done
