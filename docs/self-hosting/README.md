# Self-hosting Parley

This guide gets Parley running on your own hardware: a spare PC, a Raspberry Pi, a NAS, or a VM in your home lab. Every setup uses the same three containers (Postgres, the backend, and the web frontend). Only the way you install Docker and where you keep the files change between platforms.

## Pick your platform

| You have | Guide |
|---|---|
| A Linux box or VM (Ubuntu, Debian, Fedora, Rocky/Alma, Arch) | [linux.md](linux.md) |
| A Raspberry Pi 4/5 or another ARM board | [raspberry-pi.md](raspberry-pi.md) |
| A Windows 10/11 PC | [windows.md](windows.md) |
| A Mac (Apple Silicon or Intel) | [macos.md](macos.md) |
| Proxmox VE | [proxmox.md](proxmox.md) |
| Synology NAS (DSM 7.2+) | [synology.md](synology.md) |
| Unraid | [unraid.md](unraid.md) |
| TrueNAS SCALE (24.10+) | [truenas.md](truenas.md) |
| Portainer on any Docker host | [portainer.md](portainer.md) |

Once it runs, [remote-access.md](remote-access.md) covers reaching it from outside your network: Caddy, Nginx Proxy Manager, Traefik, Cloudflare Tunnel, Tailscale, or Let's Encrypt on the built-in frontend.

## Requirements

- **CPU:** x86-64 (amd64) or 64-bit ARM (arm64). The published images have no 32-bit builds, so a 32-bit Raspberry Pi OS or an armv7 NAS won't work.
- **Memory:** 1 GB free is enough for a handful of users. Plan on 2 GB or more for a busy server.
- **Disk:** about 1 GB for the images, plus whatever people upload (the default quota is 1 GiB per user).
- **Docker Engine 24+ with Compose v2** (the `docker compose` command, not the old `docker-compose`).

## Quick start (any Docker host)

```bash
mkdir parley && cd parley
curl -fsSLO https://raw.githubusercontent.com/ParleyDev/parley/main/docs/self-hosting/compose.yaml
curl -fsSL  https://raw.githubusercontent.com/ParleyDev/parley/main/docs/self-hosting/example.env -o .env

# Fill in the two secrets
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 32)/" .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
nano .env        # set APP_URL, ADMIN_EMAILS and TLS_HOSTNAME

docker compose up -d
docker compose ps        # all three containers should show "running" / "healthy"
```

If you cloned the repository instead, the same two files are in `docs/self-hosting/`. The `docker-compose.yml` at the repository root is meant for development. It builds from source, uses throwaway database credentials, publishes the backend port, and loosens the rate limits. Use `docs/self-hosting/compose.yaml` for a server you plan to keep.

Then:

1. Open `http://<host>:3000`. For voice and video, open `https://<host>:3443` instead (see [HTTPS and voice](#https-and-voice)).
2. Register with an address listed in `ADMIN_EMAILS`. That account gets **Admin Console** in its user menu.
3. Create a server, copy an invite, and send it to your friends.
4. Once everyone is in, you can stop open sign-ups under Admin Console → Instance Settings → **Registration**.

## What goes in `.env`

[example.env](example.env) explains every setting. The ones you have to get right:

| Variable | What it does |
|---|---|
| `POSTGRES_PASSWORD` | Database password. Use hex (`openssl rand -hex 32`), because it is also inserted into a URL. Set it **before the first start**: Postgres only reads it when it creates the database. |
| `JWT_SECRET` | Signs login sessions. Changing it logs everyone out. |
| `APP_URL` | The address people use, for example `https://chat.example.com`. Emailed links and invites are built from it. |
| `ADMIN_EMAILS` | Comma-separated emails that get admin rights. |
| `TLS_HOSTNAME` | The name or IP put into the self-signed certificate, and the domain used for Let's Encrypt. |
| `WEB_PORT` / `WEB_TLS_PORT` | Host ports for HTTP (3000) and HTTPS (3443). Write `127.0.0.1:3000` to accept local connections only. |
| `DATA_DIR` | Where the database, uploads and certificates are stored (default `./data`). |
| `PARLEY_IMAGE_TAG` | `latest`, a release such as `v0.2.0`, or `sha-<commit>`. |
| `ASSETS_PATH` | Folder of instance-wide assets, mounted read-only (default `DATA_DIR/assets`). See [Avatar decorations](#avatar-decorations). |

Email defaults to `MAIL_MODE=log`: verification and password-reset mails are printed to `docker compose logs backend` instead of being sent. Admins can also read them in the app. To send real mail, set `MAIL_MODE=smtp`, `SMTP_URL` and `MAIL_FROM`. A free SMTP relay or your email provider's SMTP server works.

## HTTPS and voice

Browsers only allow microphone and camera access on a **secure origin**: `https://…`, or `http://localhost` on the same machine. From any other device, plain `http://192.168.1.50:3000` loads the chat, but voice reports "Microphone needs a secure context".

There are three ways to get HTTPS, from least to most effort:

1. **The built-in self-signed certificate.** Open `https://<host>:3443` and accept the browser warning once on each device. Set `TLS_HOSTNAME` to the name or IP you browse to. This works on a LAN, but phones and the desktop app may refuse untrusted certificates.
2. **Tailscale.** Run `tailscale serve` to get a trusted certificate inside your tailnet without opening any ports. See [remote-access.md](remote-access.md#tailscale).
3. **A real domain.** Use a reverse proxy, a Cloudflare Tunnel, or the Let's Encrypt profile. See [remote-access.md](remote-access.md).

To bring your own certificate, put `cert.pem` (full chain) and `key.pem` into `data/certs/` and restart the frontend with `docker compose restart frontend`.

Voice calls are peer-to-peer and work well up to about six people. For bigger calls and users behind strict NATs, see "Voice, video and screen share" in the [main README](../../README.md#voice-video-and-screen-share-webrtc): it covers TURN servers (`ICE_SERVERS`) and the LiveKit SFU.

## Day-to-day operations

```bash
docker compose ps                      # status and health
docker compose logs -f backend         # backend log (also where MAIL_MODE=log mails appear)
docker compose restart frontend        # pick up new certificates
docker compose down                    # stop (data stays in DATA_DIR)
```

### Upgrading

```bash
# take a backup first (below), then:
docker compose pull
docker compose up -d
```

The backend applies database migrations when it starts. If `PARLEY_IMAGE_TAG` is pinned to a release, change it in `.env` before you run `pull`. To roll back to an older image, follow "Upgrades and rollback" in the [main README](../../README.md#upgrades-and-rollback).

### Backups

Don't copy `data/postgres` while the database is running. Dump the database, and archive the uploads folder:

```bash
mkdir -p backups
docker compose exec -T db pg_dump -U parley -Fc parley > backups/db-$(date +%F).dump
tar czf backups/uploads-$(date +%F).tgz -C data uploads
```

Copy `backups/` to another machine or to cloud storage. To make this a nightly job, add the three lines to a script and run it from cron, Synology Task Scheduler, or Unraid User Scripts.

To restore into a fresh install:

```bash
docker compose up -d                   # empty stack, migrations applied
docker compose stop backend
docker compose exec -T db pg_restore -U parley -d parley --clean --if-exists --no-owner < backups/db-2026-10-22.dump
tar xzf backups/uploads-2026-10-22.tgz -C data
docker compose start backend
```

`pg_restore --clean` replaces everything currently in the database.

## Avatar decorations

Besides the built-in frames, people can pick image decorations that you provide. Put the files in `avatar-decorations/` inside the assets folder (`data/assets/avatar-decorations/` by default, or set `ASSETS_PATH` to any folder, for example a NAS share):

- **Formats:** PNG, APNG, GIF or WebP, up to 8 MB each. Animated files play when someone hovers an avatar and on profile cards; lists show the first frame. Reduced motion keeps them still.
- **Shape:** square, with a transparent middle where the avatar shows through. The image is drawn at 1.2× the avatar size, centred, so a 288×288 file suits Discord-style decorations.
- **Names:** the file name is the name people see (`a_hint_of_clove.png` → "A Hint Of Clove") and, lower-cased, the id saved on profiles. Renaming a file therefore removes it from the people using it.
- **Changes:** adding or removing files needs no restart; the list refreshes within 30 seconds. A removed decoration simply stops showing.

The folder is mounted read-only. Still frames are cached under `uploads/asset-cache/`, which is safe to delete.

## Optional extras

The root `docker-compose.yml` in the repository also has profiles for ClamAV upload scanning (`av`), voice-message transcription (`stt`), a LiveKit SFU (`sfu`), and a second backend (`cluster`). Each one is documented in the [main README](../../README.md). You can copy the service you need into your `compose.yaml`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `docker compose up` says `set POSTGRES_PASSWORD in .env` | `.env` is missing, or isn't in the same folder as `compose.yaml`. |
| Backend restarts with `password authentication failed for user "parley"` | `POSTGRES_PASSWORD` changed after the database was created. Put the old value back, or change it inside Postgres: `docker compose exec db psql -U parley -c "ALTER USER parley PASSWORD '<new>'"`. |
| `exec format error` | The host is 32-bit ARM. Install a 64-bit OS. |
| Page loads, but chat never connects or keeps reconnecting | A reverse proxy in front isn't passing WebSockets on `/ws`. See [remote-access.md](remote-access.md). |
| "Microphone needs a secure context" | You opened the page over plain HTTP. See [HTTPS and voice](#https-and-voice). |
| Uploads fail with 413 | A reverse proxy in front is limiting request size. Raise it (Nginx: `client_max_body_size`). Cloudflare's free plan caps uploads at 100 MB. |
| Invite and email links point to `localhost` | Set `APP_URL` to the public address, then run `docker compose up -d`. |
| Port 3000 or 3443 already in use | Change `WEB_PORT` / `WEB_TLS_PORT` in `.env`. |
| Everyone gets "Too many requests" behind a proxy | The proxy isn't setting `X-Forwarded-For`, so every user appears to come from one IP. Caddy, Traefik and Nginx Proxy Manager set it by default. |
