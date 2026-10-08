#!/usr/bin/env bash
# The whole loop once: sign in (device code), log a pick, watch detection finish.
#   USER_TOKEN=cc_pat_… TEAM_KEY=cc_live_… ./first-pick.sh photo.jpg
#   TEAM_KEY=cc_live_… ./first-pick.sh photo.jpg          # device-code sign-in instead of a token
set -euo pipefail
API=${API:-https://cleancentive.org/api/v1}
PHOTO=${1:?usage: first-pick.sh <photo.jpg>}
TEAM_KEY=${TEAM_KEY:?set TEAM_KEY to the cc_live_… key of your team}
json() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }

if [ -z "${USER_TOKEN:-}" ]; then
  code=$(curl -sf -X POST "$API/auth/device-code")
  id=$(echo "$code" | json '["id"]'); device=$(echo "$code" | json '["deviceCode"]')
  echo "Open https://cleancentive.org/auth/device?code=$device and approve (5 minutes)…"
  until USER_TOKEN=$(curl -sf "$API/auth/device-code/$id" | json '.get("sessionToken","")'); [ -n "$USER_TOKEN" ]; do sleep 2; done
fi

spot=$(curl -sf -X POST "$API/spots" \
  -H "Authorization: Bearer $USER_TOKEN" -H "X-API-Key: $TEAM_KEY" \
  -F "image=@$PHOTO" -F "uploadId=$(uuidgen | tr 'A-Z' 'a-z')" \
  -F latitude=47.5596 -F longitude=7.5886 -F "capturedAt=$(date -u +%FT%TZ)" | json '["spotId"]')
echo "Pick $spot accepted — waiting for detection"

for _ in $(seq 1 60); do
  view=$(curl -sf "$API/spots/$spot/view")
  status=$(echo "$view" | json '["status"]')
  if [ "$status" = "completed" ] || [ "$status" = "failed" ]; then
    VIEW="$view" python3 - <<'PY'
import json, os
spot = json.loads(os.environ["VIEW"])
print(spot["status"])
name = lambda ref: (ref or {}).get("name") or "?"
for item in spot.get("items", []):
    print(f" - {name(item['objectLabel'])} / {name(item['materialLabel'])} / {name(item['brandLabel'])} / {item.get('weightGrams')} g")
PY
    exit 0
  fi
  sleep 2
done
echo "still $status after two minutes; check $API/spots/$spot/view later"
