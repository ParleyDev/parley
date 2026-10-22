# Synology NAS (DSM 7.2+)

**Supported models:** You need a model that supports Container Manager and has a 64-bit CPU: Intel or AMD (most "+" and "xs" models), or 64-bit ARM (for example Realtek RTD1296/RTD1619B). To check, enable SSH and run `uname -m`. It must print `x86_64` or `aarch64`.

## 1. Prepare

1. In Package Center, install **Container Manager**.
2. In File Station, create the folder `docker/parley` (the `docker` shared folder is created along with Container Manager).
3. Download [compose.yaml](compose.yaml) and [example.env](example.env) to your computer. Rename `compose.yaml` to `docker-compose.yml` and `example.env` to `.env`, then edit `.env`:
   - `POSTGRES_PASSWORD` and `JWT_SECRET`: two random hex strings. Generate them with `openssl rand -hex 32`, or use any password generator, keeping only letters and digits.
   - `TLS_HOSTNAME` and `APP_URL`: your NAS address, for example `192.168.1.20` and `https://192.168.1.20:3443`.
   - `ADMIN_EMAILS`: your email address.
4. Upload both files into `docker/parley` with File Station.

## 2. Create the project

1. Open Container Manager → **Project** → **Create**.
2. Fill in:
   - **Project name:** `parley`
   - **Path:** `/docker/parley`
   - **Source:** *Use existing docker-compose.yml*. Container Manager picks up `docker-compose.yml` and reads the `.env` next to it.
3. Skip the Web Station portal step, then click **Done**. Container Manager pulls the images and starts the project.

DSM's own web services already use ports 80 and 443, so keep Parley on 3000 and 3443. Browse to `https://<nas-ip>:3443`.

If the project fails with a permission error on `data/postgres`, create the `data` folder yourself in File Station first, and grant **Everyone** read/write on it. Then rebuild the project.

## 3. Optional: DSM reverse proxy with a real certificate

If you already use a domain on the NAS (for example through Synology DDNS with a Let's Encrypt certificate):

1. Control Panel → Login Portal → Advanced → **Reverse Proxy** → Create:
   - **Source:** HTTPS, hostname `chat.example.com`, port 443
   - **Destination:** HTTP, `localhost`, port 3000
2. Open **Custom Header** → Create → **WebSocket**. This adds the Upgrade/Connection headers that Parley's live connection needs.
3. Control Panel → Security → Certificate → Settings: assign your certificate to `chat.example.com`.
4. Set `APP_URL=https://chat.example.com` in `.env`, then run Project → parley → Action → **Build** again.

The DSM reverse proxy limits upload size. If large attachments fail, use Nginx Proxy Manager in a container, or a Cloudflare Tunnel ([remote-access.md](remote-access.md)) instead.

## Backups

Hyper Backup can back up `docker/parley`, but don't rely on it for a database that is running. Schedule a dump in Control Panel → **Task Scheduler** → Create → Scheduled Task → User-defined script, running as `root`:

```bash
cd /volume1/docker/parley
mkdir -p backups
docker compose exec -T db pg_dump -U parley -Fc parley > backups/db-$(date +%F).dump
tar czf backups/uploads-$(date +%F).tgz -C data uploads
find backups -type f -mtime +7 -delete
```

Then include `docker/parley/backups` in your Hyper Backup task.

## Upgrades

Container Manager → Project → parley → Action → **Stop**, then **Build**. Build pulls newer images when `PARLEY_IMAGE_TAG=latest`. Alternatively, SSH in and run `cd /volume1/docker/parley && sudo docker compose pull && sudo docker compose up -d`.
