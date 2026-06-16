#!/usr/bin/env bash
#
# Verify the *deployed* Firestore rules in both Firebase projects match the
# version-controlled firestore.rules. Catches console hand-edits and dev/prod
# drift. See docs/firestore-rules-deploy.md.
#
# Requires: gcloud (authenticated), python3, curl.
# Exit code is non-zero if either environment is out of sync.

set -euo pipefail
cd "$(dirname "$0")/.."

CANON="firestore.rules"
TOKEN="$(gcloud auth print-access-token)"

fetch_deployed() { # $1 = project id -> writes deployed rules to stdout
  local proj="$1" rel rs
  rel="$(curl -s -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: $proj" \
    "https://firebaserules.googleapis.com/v1/projects/$proj/releases")"
  rs="$(printf '%s' "$rel" | python3 -c \
    "import sys,json;d=json.load(sys.stdin);print([r['rulesetName'] for r in d['releases'] if r['name'].endswith('cloud.firestore')][0])")"
  curl -s -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: $proj" \
    "https://firebaserules.googleapis.com/v1/$rs" \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['source']['files'][0]['content'],end='')"
}

status=0
for proj in catalist-dev catalist-1; do
  tmp="$(mktemp)"
  fetch_deployed "$proj" > "$tmp"
  if diff -q "$tmp" "$CANON" >/dev/null; then
    echo "✅ $proj  matches  $CANON"
  else
    echo "❌ $proj  DIFFERS from  $CANON"
    echo "   deployed copy saved at: $tmp"
    echo "   diff: diff \"$tmp\" $CANON"
    status=1
  fi
  [ "$status" -eq 0 ] && rm -f "$tmp"
done

if [ "$status" -eq 0 ]; then
  echo "All environments in sync with $CANON."
else
  echo "Out of sync — deploy $CANON (see docs/firestore-rules-deploy.md) or investigate."
fi
exit "$status"
