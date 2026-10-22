# Unraid

Parley is a multi-container app, so the simplest way to run it on Unraid is the **Docker Compose Manager** plugin.

## 1. Install the plugin

Apps (Community Applications) → search **Docker Compose Manager** → Install. A **Compose** section appears at the bottom of the Docker tab.

## 2. Create the stack

1. On the Docker tab, click **Add New Stack** and name it `parley`.
2. Click the stack's gear icon → **Edit Stack** → **Compose File**, and paste the contents of [compose.yaml](compose.yaml).
3. Open **Edit Stack** → **ENV File** and paste [example.env](example.env), then change:
   ```ini
   POSTGRES_PASSWORD=<openssl rand -hex 32>
   JWT_SECRET=<openssl rand -hex 32>
   DATA_DIR=/mnt/user/appdata/parley
   TLS_HOSTNAME=192.168.1.10                # your Unraid IP
   APP_URL=https://192.168.1.10:3443
   ADMIN_EMAILS=you@example.com
   ```
   You can generate the secrets in the Unraid terminal (the `>_` icon) with `openssl rand -hex 32`.
4. Click **Compose Up**.

The Unraid web UI already uses ports 80/443. Keep Parley on 3000/3443, and browse to `https://<unraid-ip>:3443`.

If `appdata` is on the array, set the share to **cache: prefer** or **only**, or put `DATA_DIR` on a pool (`/mnt/cache/appdata/parley`). Postgres on spinning array disks is slow and keeps them awake.

## 3. Start with the array

In the Compose section, set the stack's **Autostart** toggle to on.

## Reverse proxy

If you already run **Nginx Proxy Manager** or **SWAG** from Community Applications, add a proxy host for `chat.example.com` that forwards to `http://<unraid-ip>:3000`, with WebSockets enabled. See [remote-access.md](remote-access.md#nginx-proxy-manager) for the exact settings. Don't bind `WEB_PORT` to `127.0.0.1` in this setup: a proxy container on a bridge network reaches Parley through the Unraid IP. Don't forward ports 3000/3443 on your router either. Forward only the proxy's ports.

## Backups

Install the **User Scripts** plugin and add a script with a daily schedule:

```bash
#!/bin/bash
cd /boot/config/plugins/compose.manager/projects/parley || exit 1
mkdir -p /mnt/user/backups/parley
docker compose -p parley exec -T db pg_dump -U parley -Fc parley > /mnt/user/backups/parley/db-$(date +%F).dump
tar czf /mnt/user/backups/parley/uploads-$(date +%F).tgz -C /mnt/user/appdata/parley uploads
find /mnt/user/backups/parley -type f -mtime +7 -delete
```

The plugin stores stacks under `/boot/config/plugins/compose.manager/projects/<name>`. If your stack lives elsewhere, adjust the `cd` line.

## Upgrades

Docker tab → Compose → parley → **Update Stack**. This pulls the images and recreates the containers.
