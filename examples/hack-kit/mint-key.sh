#!/usr/bin/env bash
# Mint an API key for your app from the terminal: device-code sign-in in the
# browser, then the resulting session creates the key.
#   ./mint-key.sh "Litter Wars"                      # prints cc_live_…
#   ./mint-key.sh "Litter Wars" 30                   # expires in 30 days (default 365; 0 = never)
set -euo pipefail
API=${API:-https://cleancentive.org/api/v1}
APP=${APP:-https://cleancentive.org}
NAME=${1:?usage: mint-key.sh "<app name>" [days]}
DAYS=${2:-365}
json() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }

code=$(curl -sf -X POST "$API/auth/device-code")
id=$(echo "$code" | json '["id"]'); device=$(echo "$code" | json '["deviceCode"]')
echo "Open $APP/auth/device?code=$device and approve (5 minutes)…" >&2
until session=$(curl -sf "$API/auth/device-code/$id" | json '.get("sessionToken","")'); [ -n "$session" ]; do sleep 2; done

expires=$([ "$DAYS" = "0" ] && echo null || echo "$DAYS")
curl -sf -X POST "$API/user/api-keys" \
  -H "Authorization: Bearer $session" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$NAME\",\"scopes\":[\"read\",\"write:spots\"],\"expiresInDays\":$expires}" | json '["key"]'
