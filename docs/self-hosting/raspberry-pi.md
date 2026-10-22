# Raspberry Pi and other ARM boards

The Parley images are built for `linux/arm64`, so a Raspberry Pi 4 or 5 runs Parley well for a group of friends.

## What you need

- **A Raspberry Pi 4 or 5 with 2 GB RAM or more** (4 GB recommended). A Pi 3 works on a 64-bit OS, but it's slow.
- **A 64-bit OS:** Raspberry Pi OS (64-bit), Ubuntu Server for Pi, or DietPi 64-bit. Check with `uname -m`, which should print `aarch64`. If it prints `armv7l`, the images won't run (`exec format error`), and you need to reflash with a 64-bit image.
- **An SSD or USB drive for `DATA_DIR`, if you can.** Postgres writes often, which wears out SD cards and makes them slow.

## Install

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

mkdir -p ~/parley && cd ~/parley
curl -fsSLO https://raw.githubusercontent.com/ParleyDev/parley/main/docs/self-hosting/compose.yaml
curl -fsSL  https://raw.githubusercontent.com/ParleyDev/parley/main/docs/self-hosting/example.env -o .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 32)/" .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
nano .env
docker compose up -d
```

To keep data on a USB SSD mounted at `/mnt/ssd`, set `DATA_DIR=/mnt/ssd/parley` in `.env` before the first start. Make sure the drive is listed in `/etc/fstab`, or Docker will create empty folders on the SD card when it boots without the drive.

Use the published images. Building from source (`docker compose up --build` in the repository) compiles the Rust backend, which takes a long time on a Pi and can run out of memory.

## Tips

- Give the Pi a fixed address with a DHCP reservation on your router, and set `TLS_HOSTNAME` and `APP_URL` to that address. Alternatively, use its mDNS name such as `raspberrypi.local`.
- Pi-hole or AdGuard Home often already uses port 80/443 on a Pi. Parley's default ports (3000/3443) don't clash with them.
- Follow [linux.md](linux.md) for firewall rules, starting on boot, and nightly backups. Everything there applies to Raspberry Pi OS.
