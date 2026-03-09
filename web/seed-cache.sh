#!/usr/bin/env bash
# Seed the Netlify Blobs signal cache from the local CSV.
# Usage: CRON_SECRET=<your-secret> ./seed-cache.sh

set -euo pipefail

SITE_URL="${SITE_URL:-https://coinstrat.xyz}"
CSV="../signals_full_daily.csv"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "Error: set CRON_SECRET env var first."
  exit 1
fi

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

echo "Converting CSV → JSON …"
python3 -c "
import csv, json, sys
with open('$CSV') as f:
    rows = list(csv.DictReader(f))
    for r in rows:
        for k, v in list(r.items()):
            if k == 'Date':
                continue
            try:
                r[k] = float(v) if v else None
            except ValueError:
                pass
json.dump(rows, sys.stdout)
" > "$TMPFILE"

COUNT=$(python3 -c "import json; print(len(json.load(open('$TMPFILE'))))")
echo "POSTing $COUNT rows to $SITE_URL/api/v1/signals/refresh …"

curl -s -X POST "$SITE_URL/api/v1/signals/refresh" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d @"$TMPFILE" | python3 -m json.tool

echo "Done. Try: curl $SITE_URL/api/v1/signals/current | python3 -m json.tool"
