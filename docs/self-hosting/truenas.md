# TrueNAS SCALE (24.10 "Electric Eel" and later)

Since 24.10, TrueNAS SCALE runs apps on Docker. Parley installs as a **Custom App** from YAML. Older SCALE releases (23.10 and earlier) used Kubernetes and aren't covered here. Upgrade first, or run Parley in a VM ([linux.md](linux.md)).

## 1. Create a dataset

Datasets → your pool → Add Dataset:

- **Name:** `parley` (for example `tank/apps/parley`)
- **Dataset Preset:** **Apps**. This sets permissions that containers can write to.

The path is now `/mnt/tank/apps/parley`.

## 2. Render the YAML

The Custom App YAML editor has no `.env` file. Expand the variables first, on any machine with Docker (including the TrueNAS shell under System → Shell):

```bash
mkdir -p /mnt/tank/apps/parley/setup && cd /mnt/tank/apps/parley/setup
curl -fsSLO https://raw.githubusercontent.com/ParleyDev/parley/main/docs/self-hosting/compose.yaml
curl -fsSL  https://raw.githubusercontent.com/ParleyDev/parley/main/docs/self-hosting/example.env -o .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 32)/" .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s|^DATA_DIR=.*|DATA_DIR=/mnt/tank/apps/parley|" .env
nano .env                                   # TLS_HOSTNAME, APP_URL, ADMIN_EMAILS
docker compose config > parley.yaml         # fully resolved YAML, with no ${...} left
cat parley.yaml
```

`parley.yaml` contains your secrets, so keep the `setup` folder private, or delete it once the app is installed.

## 3. Install

Apps → Discover Apps → **⋮** (top right) → **Install via YAML**:

- **Name:** `parley`
- **Custom Config:** paste the contents of `parley.yaml`

Click **Save**. The app shows as *Running* once all three containers are healthy. The TrueNAS UI already uses ports 80/443, so browse to `https://<truenas-ip>:3443`.

If Postgres fails with `chown: Operation not permitted` / `could not change permissions of directory`, the dataset wasn't created with the Apps preset. Open Datasets → parley → Permissions → Edit, and give the **apps** user (UID 568) and **root** full control. Alternatively, recreate the dataset with the preset.

## Backups

- Periodic ZFS snapshots of the dataset (Data Protection → Periodic Snapshot Tasks) give you quick rollback.
- For a portable database copy, add a Cron Job under System → Advanced → Cron Jobs, running as `root`:
  ```bash
  docker exec $(docker ps -qf name=parley-db) pg_dump -U parley -Fc parley > /mnt/tank/apps/parley/backups/db-$(date +\%F).dump
  ```
  Create the `backups` folder first. Cron needs `%` escaped as `\%`.

## Upgrades

Apps → parley → **Edit**, then **Save** without changes to pull `latest` again. To switch to a pinned version, change the image tag in the YAML before saving.
