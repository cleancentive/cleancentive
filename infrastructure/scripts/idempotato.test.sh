#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IDEMPOTATO_SOURCE_ONLY=1 source "$SCRIPT_DIR/idempotato"

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

parse_args cleancentive
assert_eq "apply" "$MODE" "default mode should be apply"
assert_eq "root" "$SSH_USER" "default SSH user should be root"
assert_eq "deploy" "$DEPLOY_USER" "default deploy user should be deploy"
assert_eq "$HOME/.ssh/cleancentive_deploy" "$DEPLOY_KEY_FILE" "default deploy key path should be managed key"
assert_eq "$HOME/.ssh/cleancentive_deploy.pub" "$PUBLIC_KEY_FILE" "default public key path should derive from managed key path"
assert_eq "cleancentive" "$TARGET_HOST" "host should be parsed"

parse_args --no-fry 46.225.228.123
assert_eq "check" "$MODE" "--no-fry should switch to check mode"
assert_eq "46.225.228.123" "$TARGET_HOST" "host should be parsed in check mode"

parse_args --reconcile cleancentive
assert_eq "reconcile" "$MODE" "--reconcile should switch to reconcile mode"
assert_eq "cleancentive" "$TARGET_HOST" "host should be parsed in reconcile mode"

parse_args --deploy-key /tmp/ci_deploy_key cleancentive
assert_eq "/tmp/ci_deploy_key" "$DEPLOY_KEY_FILE" "--deploy-key should override managed private key path"
assert_eq "/tmp/ci_deploy_key.pub" "$PUBLIC_KEY_FILE" "--deploy-key should update derived public key path"

managed_files="$(get_managed_files)"
assert_contains "$managed_files" "/opt/cleancentive/deploy/scripts/reconcile.sh" "managed files should include reconcile script"
assert_contains "$managed_files" "/etc/systemd/system/cleancentive-reconcile.service" "managed files should include service unit"
if grep -Fq "/etc/cleancentive/reconcile.env" <<<"$managed_files"; then
  fail "managed files should not include reconcile env anymore"
fi

MODE="check"
script_check="$(build_remote_script 'ssh-ed25519 AAAATEST matthias@test')"
assert_contains "$script_check" 'MODE="check"' "rendered script should include check mode"
assert_contains "$script_check" 'report_gap' "rendered script should include reporting helpers"
assert_contains "$script_check" 'getent passwd "$DEPLOY_USER" | cut -d: -f6 || true' "check mode should tolerate a missing deploy user"
assert_contains "$script_check" 'ensure_directory /opt/cleancentive/private "deploy" "deploy" 0750' "check mode should keep deploy-owned private directory policy"

MODE="apply"
script_apply="$(build_remote_script 'ssh-ed25519 AAAATEST matthias@test')"
assert_contains "$script_apply" 'MODE="apply"' "rendered script should include apply mode"
assert_contains "$script_apply" 'ensure_package docker docker.io' "apply mode should ensure docker package availability"
assert_contains "$script_apply" '/etc/sudoers.d/cleancentive-deploy' "apply mode should manage sudoers"

MODE="reconcile"
script_reconcile="$(build_remote_script 'ssh-ed25519 AAAATEST matthias@test')"
assert_contains "$script_reconcile" 'MODE="reconcile"' "rendered script should include reconcile mode"
assert_contains "$script_reconcile" 'systemctl start cleancentive-reconcile.service' "reconcile mode should trigger systemd reconcile"

assert_contains "$(cat "$SCRIPT_DIR/idempotato")" 'verify_deploy_key_connection()' "idempotato should define deploy-key login verification"
assert_contains "$(cat "$SCRIPT_DIR/idempotato")" 'ssh-keygen -t ed25519 -f "$DEPLOY_KEY_FILE"' "idempotato should generate managed deploy key if missing"

echo "PASS idempotato bash tests"
