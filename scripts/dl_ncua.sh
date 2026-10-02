#!/bin/bash
# Download NCUA quarterly call report zips from 2016-03 through the newest one that exists.
cd "$(dirname "$0")/../raw/ncua"
y=2016; m=3
while :; do
  mm=$(printf "%02d" $m); f="call-report-data-$y-$mm.zip"
  if [ ! -s "$f" ]; then
    code=$(curl -sS -L -m 900 -o "$f" -w "%{http_code}" "https://ncua.gov/files/publications/analysis/$f")
    if [ "$code" != "200" ] || ! unzip -tq "$f" >/dev/null 2>&1; then rm -f "$f"; echo "stop at $y-$mm (http $code)"; break; fi
  fi
  echo "$f $(stat -c %s "$f")"
  m=$((m+3)); if [ $m -gt 12 ]; then m=3; y=$((y+1)); fi
  [ $y -gt $(date +%Y) ] && break
done
