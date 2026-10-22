# macOS (Apple Silicon and Intel)

On Apple Silicon Macs the arm64 images run natively. On Intel Macs the amd64 images do. Choose one Docker runtime:

| Runtime | Notes |
|---|---|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Official. Free for personal use and small businesses. |
| [OrbStack](https://orbstack.dev) | Light and fast. Free for personal use. |
| [Colima](https://github.com/abiosoft/colima) | Open source, command line only. |

Colima setup:

```bash
brew install colima docker docker-compose
mkdir -p ~/.docker/cli-plugins && ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" ~/.docker/cli-plugins/docker-compose
colima start --cpu 2 --memory 4
brew services start colima          # start Colima at login
```

Check with `docker compose version`.

## Install Parley

```bash
mkdir -p ~/parley && cd ~/parley
curl -fsSLO https://raw.githubusercontent.com/ParleyDev/parley/main/docs/self-hosting/compose.yaml
curl -fsSL  https://raw.githubusercontent.com/ParleyDev/parley/main/docs/self-hosting/example.env -o .env
sed -i '' "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 32)/" .env
sed -i '' "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
open -e .env       # APP_URL, ADMIN_EMAILS, TLS_HOSTNAME
docker compose up -d
```

macOS ships BSD `sed`, which needs the empty `''` after `-i`.

Open <http://localhost:3000>. For other devices on your network, find your Mac's address in System Settings → Network (or run `ipconfig getifaddr en0`), set `TLS_HOSTNAME` to that address, and browse to `https://<that-address>:3443`. If the macOS firewall asks whether Docker, OrbStack or Colima may accept incoming connections, allow it.

## Keep it running

- Docker Desktop and OrbStack each have a "start at login" setting. Colima starts at login through `brew services`.
- Stop a Mac mini or an always-on laptop from sleeping: System Settings → Energy → **Prevent automatic sleeping when the display is off**. The Terminal equivalent is `sudo pmset -a sleep 0`.
- In System Settings → Energy, turn on **Start up automatically after a power failure**.

Backups and upgrades work as described in [README.md](README.md#day-to-day-operations). For a nightly backup, schedule the backup script with `launchd`, or with `crontab -e` (cron still works on macOS).
