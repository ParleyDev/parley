#!/usr/bin/env sh
# Upgrade the running stack safely: back up first, then build and roll the new images.
#   ops/upgrade.sh            # backup → build → up -d
#   ops/upgrade.sh --no-backup
# Rollback (README "Upgrades and rollback"): git checkout <previous tag>; MIGRATIONS_IGNORE_MISSING=1 docker compose up -d --build
set -eu
cd "$(dirname "$0")/.."
if [ "${1:-}" != "--no-backup" ]; then
  echo ">> backup"; docker compose --profile backup run --rm backup once
fi
echo ">> build"; docker compose build backend frontend
echo ">> roll"; docker compose up -d
echo ">> health"; for i in $(seq 1 30); do if curl -fsS localhost:8080/healthz >/dev/null 2>&1; then echo healthy; exit 0; fi; sleep 2; done
echo "backend not healthy after 60s; check: docker compose logs backend" >&2; exit 1
