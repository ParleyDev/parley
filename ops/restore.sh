#!/bin/sh
# Restore drill / disaster recovery for a compose deployment. Run from the repo root on the host:
#   ops/restore.sh backups/db-20260101T000000Z.dump [backups/uploads-20260101T000000Z.tgz]
# Stops the backend, replaces the database contents with the dump (pg_restore --clean), unpacks the uploads
# tarball into the uploads volume, starts the backend again. Everything currently in the DB/uploads is lost.
set -eu
DUMP="${1:?db dump path required}"
UPLOADS="${2:-}"
COMPOSE="${COMPOSE:-docker compose}"
[ -f "$DUMP" ] || { echo "no such file: $DUMP" >&2; exit 1; }
echo "==> stopping backend"
$COMPOSE stop backend
echo "==> restoring database from $DUMP"
$COMPOSE exec -T db pg_restore --username=parley --dbname=parley --clean --if-exists --no-owner --exit-on-error < "$DUMP"
if [ -n "$UPLOADS" ]; then
    [ -f "$UPLOADS" ] || { echo "no such file: $UPLOADS" >&2; exit 1; }
    echo "==> restoring uploads from $UPLOADS"
    $COMPOSE run --rm --no-deps -T --entrypoint sh -v "$(cd "$(dirname "$UPLOADS")" && pwd)/$(basename "$UPLOADS"):/restore.tgz:ro" backend -c 'rm -rf /data/uploads/* && tar -xzf /restore.tgz -C /data'
fi
echo "==> starting backend"
$COMPOSE start backend
echo "==> done. Verify: $COMPOSE ps; curl -fs http://localhost:18080/health"
