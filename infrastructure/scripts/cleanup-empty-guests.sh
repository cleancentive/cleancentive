#!/usr/bin/env bash
# cleanup-empty-guests.sh — Delete guest accounts with no meaningful content.
#
# Deletes users where nickname='guest' AND they have no spots, no emails,
# no admin role, no team memberships, no cleanup participation, and no feedback.
#
# Usage:
#   ./cleanup-empty-guests.sh                  # dry-run on local Docker DB
#   ./cleanup-empty-guests.sh --execute        # delete on local Docker DB
#   ./cleanup-empty-guests.sh --remote HOST    # dry-run on remote host via SSH
#   ./cleanup-empty-guests.sh --remote HOST --execute  # delete on remote host
#
# Examples:
#   ./cleanup-empty-guests.sh --remote cleancentive          # analyse prod
#   ./cleanup-empty-guests.sh --remote cleancentive --execute # clean prod

set -euo pipefail

COMPOSE_FILE="/opt/cleancentive/deploy/docker-compose.prod.yml"
LOCAL_CONTAINER="cleancentive-db"
DB_USER="${DB_USERNAME:-cleancentive}"
DB_NAME="${DB_DATABASE:-cleancentive}"
EXECUTE=false
REMOTE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) EXECUTE=true; shift ;;
    --remote)  REMOTE="$2"; shift 2 ;;
    *)         echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

run_sql() {
  local sql="$1"
  if [[ -n "$REMOTE" ]]; then
    ssh "$REMOTE" "docker compose -f $COMPOSE_FILE exec -T postgres psql -U $DB_USER -d $DB_NAME" <<< "$sql"
  else
    docker exec "$LOCAL_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" <<< "$sql"
  fi
}

# ── Analysis ──────────────────────────────────────────────────────────
echo "=== Empty guest account analysis ==="
run_sql "
WITH empty_guests AS (
  SELECT u.id
  FROM users u
  WHERE u.nickname = 'guest'
    AND NOT EXISTS (SELECT 1 FROM spots s WHERE s.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM admins a WHERE a.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM user_emails ue WHERE ue.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM cleanup_participants cp WHERE cp.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.user_id = u.id OR f.guest_id = u.id)
)
SELECT
  (SELECT COUNT(*) FROM users WHERE nickname = 'guest') AS total_guests,
  (SELECT COUNT(*) FROM empty_guests) AS deletable,
  (SELECT COUNT(*) FROM users u WHERE u.nickname = 'guest'
     AND NOT EXISTS (SELECT 1 FROM spots s WHERE s.user_id = u.id)) - (SELECT COUNT(*) FROM empty_guests) AS kept_no_spots_but_has_refs;
"

if [[ "$EXECUTE" != true ]]; then
  echo ""
  echo "(dry-run — pass --execute to delete)"
  exit 0
fi

# ── Deletion ──────────────────────────────────────────────────────────
echo ""
echo "=== Deleting empty guest accounts ==="
run_sql "
DELETE FROM users
WHERE nickname = 'guest'
  AND NOT EXISTS (SELECT 1 FROM spots s WHERE s.user_id = users.id)
  AND NOT EXISTS (SELECT 1 FROM admins a WHERE a.user_id = users.id)
  AND NOT EXISTS (SELECT 1 FROM user_emails ue WHERE ue.user_id = users.id)
  AND NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.user_id = users.id)
  AND NOT EXISTS (SELECT 1 FROM cleanup_participants cp WHERE cp.user_id = users.id)
  AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.user_id = users.id OR f.guest_id = users.id)
RETURNING id, created_at;
"
