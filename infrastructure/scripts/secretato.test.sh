#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETATO_SOURCE_ONLY=1 source "$SCRIPT_DIR/secretato"

fail() {
  printf 'FAIL %s\n' "$1" >&2
  exit 1
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  [[ "$expected" == "$actual" ]] || fail "$message (expected '$expected', got '$actual')"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  grep -Fq "$needle" <<<"$haystack" || fail "$message (missing '$needle')"
}

parse_args --spy
assert_eq "spy" "$MODE" "--spy should switch to spy mode"

parse_args --main-repo acme/main --private-repo acme/private --deploy-key /tmp/dk --host 1.2.3.4 --user svc
assert_eq "acme/main" "$MAIN_REPO" "main repo should be configurable"
assert_eq "acme/private" "$PRIVATE_REPO" "private repo should be configurable"
assert_eq "/tmp/dk" "$DEPLOY_KEY_FILE" "deploy key path should be configurable"
assert_eq "1.2.3.4" "$PROD_HOST" "prod host should be configurable"
assert_eq "svc" "$PROD_USER" "prod user should be configurable"

output="$(usage)"
assert_contains "$output" 'infrastructure/scripts/secretato [--spy]' "usage should include spy mode"
assert_contains "$output" 'gh auth token' "usage should document token fallback"

script_contents="$(cat "$SCRIPT_DIR/secretato")"
assert_contains "$script_contents" 'PRIVATE_REPO_READ_TOKEN_VALUE' "secretato should support env var token source"
assert_contains "$script_contents" '.config/cleancentive/secretato.env' "secretato should support local config token source"
assert_contains "$script_contents" 'gh auth token' "secretato should support gh auth token fallback"
assert_contains "$script_contents" 'gh secret set' "secretato should write secrets via gh cli"

echo "PASS secretato bash tests"
