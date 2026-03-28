#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/cleancentive}"
DEPLOY_DIR="$DEPLOY_ROOT/deploy"
STATE_DIR="$DEPLOY_ROOT/state"
PRIVATE_DIR="$DEPLOY_ROOT/private"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLIC_REPO_RAW_BASE="${PUBLIC_REPO_RAW_BASE:-https://raw.githubusercontent.com/cleancentive/cleancentive/main}"

mkdir -p "$DEPLOY_DIR/caddy" "$STATE_DIR" "$PRIVATE_DIR"

fetch() {
  local url="$1"
  local destination="$2"
  curl --fail --silent --show-error --location "$url" --output "$destination"
}

fetch "$PUBLIC_REPO_RAW_BASE/infrastructure/docker-compose.prod.yml" "$DEPLOY_DIR/docker-compose.prod.yml"
fetch "$PUBLIC_REPO_RAW_BASE/infrastructure/caddy/Caddyfile" "$DEPLOY_DIR/caddy/Caddyfile"

if [[ ! -f "$PRIVATE_DIR/.env" ]]; then
  echo "Private env file is missing: $PRIVATE_DIR/.env" >&2
  exit 1
fi

"$SCRIPT_DIR/validate-prod-compose.sh" "$DEPLOY_DIR/docker-compose.prod.yml"

compose_checksum=$(shasum -a 256 "$DEPLOY_DIR/docker-compose.prod.yml" | awk '{print $1}')
caddy_checksum=$(shasum -a 256 "$DEPLOY_DIR/caddy/Caddyfile" | awk '{print $1}')
env_checksum=$(shasum -a 256 "$PRIVATE_DIR/.env" | awk '{print $1}')

last_compose_checksum=$(cat "$STATE_DIR/compose.sha256" 2>/dev/null || true)
last_caddy_checksum=$(cat "$STATE_DIR/caddy.sha256" 2>/dev/null || true)
last_env_checksum=$(cat "$STATE_DIR/env.sha256" 2>/dev/null || true)

desired_images=()
while IFS= read -r line; do
  desired_images+=("$line")
done < <(grep -E '^\s*image:\s*ghcr\.io/cleancentive/' "$DEPLOY_DIR/docker-compose.prod.yml" | sed -E 's/^[[:space:]]*image:[[:space:]]*//')

print_summary() {
  local status="$1"
  echo ""
  echo "=== Deployment Summary ==="
  for image in "${desired_images[@]}"; do
    service="${image##*/cleancentive-}"
    name="${service%%:*}"
    tag="${service##*:}"
    printf '  %-10s version %s %s\n' "$name" "$tag" "$status"
  done
  echo "=========================="
}

already_running=true
for image in "${desired_images[@]}"; do
  if ! docker ps --format '{{.Image}}' | grep -Fxq "$image"; then
    already_running=false
    break
  fi
done

if [[ "$compose_checksum" == "$last_compose_checksum" && "$caddy_checksum" == "$last_caddy_checksum" && "$env_checksum" == "$last_env_checksum" && "$already_running" == true ]]; then
  echo "Desired state already deployed"
  print_summary "already running"
  exit 0
fi

cd "$DEPLOY_DIR"
docker compose --env-file "$PRIVATE_DIR/.env" -f docker-compose.prod.yml pull
docker compose --env-file "$PRIVATE_DIR/.env" -f docker-compose.prod.yml up -d

printf '%s\n' "$compose_checksum" > "$STATE_DIR/compose.sha256"
printf '%s\n' "$caddy_checksum" > "$STATE_DIR/caddy.sha256"
printf '%s\n' "$env_checksum" > "$STATE_DIR/env.sha256"

echo "Reconcile complete"
print_summary "deployed"
