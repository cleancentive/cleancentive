#!/usr/bin/env bash
set -euo pipefail

compose_file="${1:-infrastructure/docker-compose.prod.yml}"

if [[ ! -f "$compose_file" ]]; then
  echo "Compose file not found: $compose_file" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to validate production image references" >&2
  exit 1
fi

images=()
while IFS= read -r line; do
  images+=("$line")
done < <(grep -E '^\s*image:\s*(ghcr\.io/cleancentive/|docker\.getoutline\.com/outlinewiki/outline(:|@))' "$compose_file" | sed -E 's/^[[:space:]]*image:[[:space:]]*//')

if [[ ${#images[@]} -eq 0 ]]; then
  echo "No image references found in $compose_file" >&2
  exit 1
fi

sha_pattern='^[0-9a-f]{40}$'
digest_pattern='^docker\.getoutline\.com/outlinewiki/outline(:[^@]+)?@sha256:[0-9a-f]{64}$'

for image in "${images[@]}"; do
  tag="${image##*:}"

  if [[ "$image" == ghcr.io/cleancentive/*:* ]]; then
    if [[ ! "$tag" =~ $sha_pattern ]]; then
      echo "Cleancentive image tag must be a full 40-character git SHA: $image" >&2
      exit 1
    fi
  elif [[ "$image" =~ $digest_pattern ]]; then
    true
  else
    echo "Unsupported production image reference: $image" >&2
    exit 1
  fi

  if ! docker manifest inspect "$image" >/dev/null 2>&1; then
    echo "Image tag does not exist in registry: $image" >&2
    exit 1
  fi
done

# Irreplaceable data volumes must be declared `external: true` so an accidental
# `docker compose down -v` cannot delete them. Fail the deploy if that guard was
# dropped from the compose file.
assert_external_volume() {
  local vol="$1"
  if ! awk -v v="$vol" '
    /^volumes:/ { invol = 1; next }
    invol && $1 == v ":" { inblock = 1; next }
    invol && inblock && /^  [^[:space:]]/ && $1 != v ":" { inblock = 0 }
    inblock && /external:[[:space:]]*true/ { found = 1 }
    END { exit (found ? 0 : 1) }
  ' "$compose_file"; then
    echo "Production volume '$vol' must be declared 'external: true' to prevent data loss via 'docker compose down -v'" >&2
    exit 1
  fi
}

assert_external_volume postgres_data
assert_external_volume redis_data

echo "Production compose image references are valid"
