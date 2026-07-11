#!/usr/bin/env bash
# Daily PostgreSQL backup for the winserv database: pg_dump -> gzip -> rotate.
# ====================================================================
# Install on the VPS:
#   chmod +x /opt/winserv/ops/db-backup.sh
#   ( crontab -l 2>/dev/null | grep -v db-backup.sh; \
#     echo '30 3 * * * /opt/winserv/ops/db-backup.sh >> /var/log/winserv-backup.log 2>&1' ) | crontab -
#
# Restore a dump:
#   gunzip -c /var/backups/winserv/winserv-YYYYMMDD-HHMMSS.sql.gz | psql "$DATABASE_URL"
# ====================================================================
set -euo pipefail

BACKUP_DIR="${WINSERV_BACKUP_DIR:-/var/backups/winserv}"
KEEP_DAYS="${WINSERV_BACKUP_KEEP_DAYS:-14}"
ENV_FILE="${WINSERV_ENV_FILE:-/opt/winserv/backend/.env}"

DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)"
if [ -z "${DATABASE_URL:-}" ]; then
  echo "$(date '+%F %T') ERROR: DATABASE_URL not found in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/winserv-$TS.sql.gz"
TMP="$OUT.partial"

# Dump to a temp file first, then atomically rename — a crash never leaves a
# half-written file that looks like a valid backup.
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$TMP"
# Sanity check: gzip must be valid and non-trivial in size.
if ! gzip -t "$TMP" 2>/dev/null || [ "$(stat -c%s "$TMP")" -lt 1024 ]; then
  echo "$(date '+%F %T') ERROR: dump failed validation, discarding $TMP" >&2
  rm -f "$TMP"
  exit 1
fi
mv "$TMP" "$OUT"
chmod 600 "$OUT"

# Rotate: keep the last N days.
find "$BACKUP_DIR" -maxdepth 1 -name 'winserv-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

echo "$(date '+%F %T') OK backup=$OUT size=$(du -h "$OUT" | cut -f1) kept=$(ls -1 "$BACKUP_DIR"/winserv-*.sql.gz 2>/dev/null | wc -l)"
