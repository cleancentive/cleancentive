#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Full MongoDB export script.

What this script does:
1) Creates a full-fidelity compressed backup with mongodump
2) Exports every collection as NDJSON for analysis (mongoexport)
3) Writes metadata and a restore helper script

Requirements:
- mongodump
- mongorestore
- mongoexport
- mongosh

Usage:
  bash scripts/export-mongodb-full.sh --uri "<mongodb-uri>" [options]

Options:
  --uri <value>           MongoDB connection string (required)
  --out-base <path>       Base output directory (default: ~/mongo-exports)
  --label <value>         Folder label prefix (default: mongodb-export)
  --skip-json             Skip per-collection NDJSON exports
  --help                  Show this help

Examples:
  bash scripts/export-mongodb-full.sh \
    --uri "mongodb+srv://user:pass@cluster.mongodb.net/?appName=MyApp"

  bash scripts/export-mongodb-full.sh \
    --uri "mongodb+srv://user:pass@cluster.mongodb.net/?appName=MyApp" \
    --out-base "~/backups" \
    --label "hackaton2025"
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: required command not found: $cmd" >&2
    exit 1
  fi
}

safe_file_name() {
  local value="$1"
  value="${value//\//_}"
  value="${value//\\/_}"
  value="${value//:/_}"
  value="${value//\*/_}"
  value="${value//\?/_}"
  value="${value//\"/_}"
  value="${value//</_}"
  value="${value//>/_}"
  value="${value//|/_}"
  printf '%s' "$value"
}

MONGO_URI=""
OUT_BASE="$HOME/mongo-exports"
LABEL="mongodb-export"
SKIP_JSON=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uri)
      MONGO_URI="${2:-}"
      shift 2
      ;;
    --out-base)
      OUT_BASE="${2:-}"
      shift 2
      ;;
    --label)
      LABEL="${2:-}"
      shift 2
      ;;
    --skip-json)
      SKIP_JSON=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$MONGO_URI" ]]; then
  echo "Error: --uri is required" >&2
  usage
  exit 1
fi

require_cmd mongodump
require_cmd mongorestore

if [[ "$SKIP_JSON" -eq 0 ]]; then
  require_cmd mongoexport
  require_cmd mongosh
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
EXPORT_ROOT="${OUT_BASE/#\~/$HOME}/${LABEL}-${TIMESTAMP}"
DUMP_DIR="$EXPORT_ROOT/dump"
JSON_DIR="$EXPORT_ROOT/json"
META_DIR="$EXPORT_ROOT/meta"

mkdir -p "$DUMP_DIR" "$META_DIR"
if [[ "$SKIP_JSON" -eq 0 ]]; then
  mkdir -p "$JSON_DIR"
fi

echo "Starting export..."
echo "Output directory: $EXPORT_ROOT"

echo "Running mongodump (compressed)..."
mongodump \
  --uri "$MONGO_URI" \
  --out "$DUMP_DIR" \
  --gzip

if [[ "$SKIP_JSON" -eq 0 ]]; then
  echo "Exporting per-collection NDJSON files..."

  DB_LIST_FILE="$META_DIR/databases.txt"
  COLLECTION_MAP_FILE="$META_DIR/collections.tsv"
  : > "$DB_LIST_FILE"
  : > "$COLLECTION_MAP_FILE"

  while IFS= read -r db_name; do
    [[ -z "$db_name" ]] && continue

    printf '%s\n' "$db_name" >> "$DB_LIST_FILE"
    db_folder="$(safe_file_name "$db_name")"
    mkdir -p "$JSON_DIR/$db_folder"

    while IFS= read -r collection_name; do
      [[ -z "$collection_name" ]] && continue

      printf '%s\t%s\n' "$db_name" "$collection_name" >> "$COLLECTION_MAP_FILE"

      collection_file_name="$(safe_file_name "$collection_name")"
      out_file="$JSON_DIR/$db_folder/${collection_file_name}.ndjson"

      mongoexport \
        --uri "$MONGO_URI" \
        --db "$db_name" \
        --collection "$collection_name" \
        --type json \
        --out "$out_file"
    done < <(
      mongosh "$MONGO_URI" --quiet --eval "db.getMongo().getDB('$db_name').getCollectionNames().forEach(c => print(c))"
    )
  done < <(
    mongosh "$MONGO_URI" --quiet --eval 'db.adminCommand({ listDatabases: 1, nameOnly: true }).databases.forEach(d => print(d.name))'
  )
fi

cat > "$META_DIR/restore.sh" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail

if [[ \${1:-} == "" ]]; then
  echo "Usage: bash restore.sh <target-uri>"
  exit 1
fi

TARGET_URI="\$1"
SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
EXPORT_ROOT="\$(cd "\$SCRIPT_DIR/.." && pwd)"

mongorestore \
  --uri "\$TARGET_URI" \
  --drop \
  --gzip \
  "\$EXPORT_ROOT/dump"
EOF

echo "Collecting summary metadata..."
{
  echo "timestamp=$TIMESTAMP"
  echo "export_root=$EXPORT_ROOT"
  echo "dump_dir=$DUMP_DIR"
  echo "json_dir=$JSON_DIR"
  echo "skip_json=$SKIP_JSON"
  echo "mongodump_version=$(mongodump --version 2>/dev/null | tr '\n' ' ')"
  echo "mongorestore_version=$(mongorestore --version 2>/dev/null | tr '\n' ' ')"
} > "$META_DIR/export-summary.txt"

echo "Done."
echo "- Full backup: $DUMP_DIR"
if [[ "$SKIP_JSON" -eq 0 ]]; then
  echo "- NDJSON exports: $JSON_DIR"
fi
echo "- Restore helper: $META_DIR/restore.sh"
echo "- Metadata: $META_DIR/export-summary.txt"
