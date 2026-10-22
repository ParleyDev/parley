# Linux (Ubuntu, Debian, Fedora, Rocky/Alma, Arch)

These steps work on bare metal, in a VM, or in a cloud VPS.

## 1. Install Docker

**Ubuntu / Debian** (and derivatives such as Linux Mint and Pop!_OS): Docker's convenience script adds the official repository and installs Engine and Compose v2.

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # run docker without sudo; log out and back in afterwards
```

**Fedora**

```bash
sudo dnf -y install dnf-plugins-core
sudo dnf config-manager addrepo --from-repofile=https://download.docker.com/linux/fedora/docker-ce.repo
sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

On Fedora 40 and older, `dnf config-manager` uses the old syntax: `sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo`.

**Rocky Linux / AlmaLinux / RHEL 9**

```bash
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

**Arch / Manjaro**

```bash
sudo pacman -S --needed docker docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

Check the install with `docker compose version`. It should print v2.x.

Podman with `podman compose` may work, but it is untested. Use Docker if you want the guide to apply as written.

## 2. Install Parley

```bash
sudo mkdir -p /opt/parley && sudo chown $USER: /opt/parley && cd /opt/parley
curl -fsSLO https://raw.githubusercontent.com/ParleyDev/parley/main/docs/self-hosting/compose.yaml
curl -fsSL  https://raw.githubusercontent.com/ParleyDev/parley/main/docs/self-hosting/example.env -o .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 32)/" .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
nano .env      # APP_URL, ADMIN_EMAILS, TLS_HOSTNAME (e.g. your LAN IP)
docker compose up -d
```

Find the host's LAN address with `hostname -I`, then browse to `https://<that-ip>:3443`.

## 3. Firewall

**ufw** (Ubuntu / Debian):

```bash
sudo ufw allow 3000,3443/tcp
```

**firewalld** (Fedora / RHEL family):

```bash
sudo firewall-cmd --permanent --add-port=3000/tcp --add-port=3443/tcp
sudo firewall-cmd --reload
```

> **Warning:** Docker writes its own iptables rules, so a port published by a container is reachable even if ufw or firewalld would block it. A firewall rule can't hide Parley. To keep a port off the network, bind it to localhost in `.env` (`WEB_PORT=127.0.0.1:3000`), or filter it at your router.

## 4. SELinux (Fedora, RHEL, Rocky, Alma)

When SELinux is enforcing, containers can't read the bind-mounted `data/` folder until it has the right label. Do this once, after the first `docker compose up -d` has created the folders:

```bash
sudo chcon -Rt container_file_t /opt/parley/data
docker compose restart
```

Alternatively, add `:z` to the end of each `${DATA_DIR…}` volume line in `compose.yaml`.

## 5. Start on boot

Docker starts at boot (`systemctl enable docker`), and every Parley service has `restart: unless-stopped`, so nothing else is needed. If you'd rather manage Parley as a systemd unit, use this:

```ini
# /etc/systemd/system/parley.service
[Unit]
Description=Parley
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/parley
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now parley
```

## 6. Nightly backup with cron

```bash
cat > /opt/parley/backup.sh <<'EOF'
#!/bin/sh
set -e
cd /opt/parley
mkdir -p backups
docker compose exec -T db pg_dump -U parley -Fc parley > backups/db-$(date +%F).dump
tar czf backups/uploads-$(date +%F).tgz -C data uploads
find backups -type f -mtime +7 -delete
EOF
chmod +x /opt/parley/backup.sh
(crontab -l 2>/dev/null; echo "30 3 * * * /opt/parley/backup.sh") | crontab -
```

This keeps one week of backups locally. Copy `backups/` to another machine as well.

Next: [remote-access.md](remote-access.md) to reach Parley from outside your network.
