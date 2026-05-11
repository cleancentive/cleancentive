#!/usr/bin/env bash
#
# Build the cleancentive Outline fork locally for fast dev iteration —
# avoids the GH Actions roundtrip when iterating on patches.
#
# Usage:
#   ./infrastructure/scripts/build-outline-local.sh
#   OUTLINE_FORK_DIR=/path/to/outline-fork ./infrastructure/scripts/build-outline-local.sh
#
# After building, recreate the outline container with the local image:
#   OUTLINE_IMAGE=ghcr.io/cleancentive/outline:dev-local \
#     docker compose -f infrastructure/docker-compose.dev.yml up -d --force-recreate outline
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FORK_DIR="${OUTLINE_FORK_DIR:-$(cd "$REPO_DIR/.." && pwd)/outline-fork}"

if [ ! -d "$FORK_DIR/.git" ]; then
  echo "Outline fork not found at $FORK_DIR" >&2
  echo "Clone the fork first:" >&2
  echo "  git clone -b cleancentive-customizations git@github.com:cleancentive/outline.git $FORK_DIR" >&2
  exit 1
fi

cd "$FORK_DIR"
echo "Building outline-base from $FORK_DIR (this is the slow step on a cold cache, ~10–15 min)..."
docker build -f Dockerfile.base -t outline-base:dev-local .

echo "Building outline runtime..."
docker build -t ghcr.io/cleancentive/outline:dev-local \
  --build-arg BASE_IMAGE=outline-base:dev-local .

cat <<EOF

Done. To use the local image:

  OUTLINE_IMAGE=ghcr.io/cleancentive/outline:dev-local \\
    docker compose -f infrastructure/docker-compose.dev.yml up -d --force-recreate outline

To switch back to the GHCR image, recreate without OUTLINE_IMAGE set.
EOF
