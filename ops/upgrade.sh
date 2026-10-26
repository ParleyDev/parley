#!/usr/bin/env sh
# Deploy: main is production. Back up, build the images with the version from scripts/version.mjs, roll every
# running backend (backend2 too under the cluster profile) and the frontend, then check health and the served version.
#   ops/upgrade.sh               # backup → build → roll → check
#   ops/upgrade.sh --no-backup
#   ops/upgrade.sh --dev         # allow a dev build (another branch, or local changes that go into the images)
# A clean main commit builds as production (0.12.0+<sha>), a release tag as the release; anything else is a dev build,
# which is refused without --dev. PARLEY_VERSION in the environment wins over the computed version.
# Rollback (README "Upgrades and rollback"): git checkout <previous tag>; MIGRATIONS_IGNORE_MISSING=1 ops/upgrade.sh --dev
set -eu
cd "$(dirname "$0")/.."
backup=1; dev=0
for a in "$@"; do
  case "$a" in
    --no-backup) backup=0 ;;
    --dev) dev=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

PARLEY_VERSION="${PARLEY_VERSION:-$(node scripts/version.mjs 2>/dev/null || echo dev)}"
export PARLEY_VERSION
case "$PARLEY_VERSION" in
  dev|*-dev*)
    if [ "$dev" -ne 1 ]; then
      echo "refusing to deploy dev build $PARLEY_VERSION: production deploys main with no local changes (or pass --dev)" >&2
      exit 1
    fi ;;
esac
echo ">> version $PARLEY_VERSION"

if [ "$backup" -eq 1 ]; then
  echo ">> backup"; docker compose --profile backup run --rm backup once
fi
echo ">> build"; docker compose build backend frontend

# Keep the second backend in the roll when it is running.
profiles=""; backends="backend"
if docker compose --profile cluster ps --status running --services 2>/dev/null | grep -qx backend2; then
  profiles="--profile cluster"; backends="backend backend2"
fi
echo ">> roll"; docker compose $profiles up -d

echo ">> health"
for svc in $backends; do
  port=$(docker compose $profiles port "$svc" 8080 | sed 's/.*://')
  ok=0
  for _ in $(seq 1 30); do
    if curl -fsS "localhost:$port/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  if [ "$ok" -ne 1 ]; then echo "$svc not healthy after 60s; check: docker compose logs $svc" >&2; exit 1; fi
  echo "$svc healthy"
done
web=$(docker compose port frontend 80 | sed 's/.*://')
served=$(curl -fsS "localhost:$web/version.json" | sed 's/.*"version":"\([^"]*\)".*/\1/')
if [ "$served" != "$PARLEY_VERSION" ]; then echo "frontend serves $served, expected $PARLEY_VERSION" >&2; exit 1; fi
echo "deployed $PARLEY_VERSION"
