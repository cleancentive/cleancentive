#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECONCILE_SCRIPT="$SCRIPT_DIR/reconcile.sh"

fail() {
  printf 'FAIL %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local needle="$1"
  local message="$2"
  grep -Fq "$needle" "$RECONCILE_SCRIPT" || fail "$message (missing '$needle')"
}

assert_not_contains() {
  local needle="$1"
  local message="$2"
  if grep -Fq "$needle" "$RECONCILE_SCRIPT"; then
    fail "$message (unexpected '$needle')"
  fi
}

assert_contains 'PRIVATE_DIR="$DEPLOY_ROOT/private"' 'reconcile should use local private env directory'
assert_contains 'docker compose --env-file "$PRIVATE_DIR/.env" -f docker-compose.prod.yml pull' 'reconcile should use shipped private env file'
assert_not_contains 'PRIVATE_ENV_URL=' 'reconcile should not require private repo URL'
assert_not_contains 'PRIVATE_ENV_TOKEN=' 'reconcile should not require private repo token'
assert_not_contains 'fetch_private()' 'reconcile should not fetch private env itself'
assert_contains 'env_checksum=' 'reconcile should track env file checksum'
assert_contains 'env.sha256' 'reconcile should persist env checksum to state directory'

echo "PASS reconcile bash tests"
