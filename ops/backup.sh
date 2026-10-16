#!/bin/sh
# Parley backups: a compressed pg_dump of the database plus a tarball of the uploads volume, with retention.
# Runs inside the `backup` compose service (postgres image: pg_dump, tar, gzip are all there).
#   backup.sh once   - one backup, then exit (CI, cron, "before I upgrade")
#   backup.sh loop   - one backup now, then every BACKUP_INTERVAL seconds (default 24h)
# Env: PGHOST PGUSER PGPASSWORD PGDATABASE (set by compose), BACKUP_DIR (/backups), UPLOADS_DIR (/data/uploads),
#      BACKUP_KEEP (how many of each kind to keep, default 7), BACKUP_INTERVAL (seconds, default 86400).
set -eu
BACKUP_DIR="${BACKUP_DIR:-/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-/data/uploads}"
KEEP="${BACKUP_KEEP:-7}"
INTERVAL="${BACKUP_INTERVAL:-86400}"

run_backup() {
    ts=$(date -u +%Y%m%dT%H%M%SZ)
    mkdir -p "$BACKUP_DIR"
    echo "[$ts] dumping database $PGDATABASE"
    pg_dump --format=custom --compress=6 --file="$BACKUP_DIR/db-$ts.dump.tmp" "$PGDATABASE"
    mv "$BACKUP_DIR/db-$ts.dump.tmp" "$BACKUP_DIR/db-$ts.dump"
    if [ -d "$UPLOADS_DIR" ]; then
        echo "[$ts] archiving uploads from $UPLOADS_DIR"
        tar -czf "$BACKUP_DIR/uploads-$ts.tgz.tmp" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
        mv "$BACKUP_DIR/uploads-$ts.tgz.tmp" "$BACKUP_DIR/uploads-$ts.tgz"
    fi
    # Retention: keep the newest $KEEP of each kind.
    for kind in "db-*.dump" "uploads-*.tgz"; do
        ls -1t "$BACKUP_DIR"/$kind 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do echo "pruning $old"; rm -f "$old"; done
    done
    echo "[$ts] done:"; ls -lh "$BACKUP_DIR" | grep -E "db-$ts|uploads-$ts" || true
}

case "${1:-once}" in
    once) run_backup ;;
    loop) while :; do run_backup || echo "backup failed; retrying after $INTERVAL s"; sleep "$INTERVAL"; done ;;
    *) echo "usage: backup.sh once|loop" >&2; exit 2 ;;
esac
