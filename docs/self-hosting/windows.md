# Windows 10 / 11

Parley runs in Docker Desktop on its WSL 2 backend. A desktop PC that stays on works fine for a small group. For an always-on server, a Linux VM or a mini PC is usually less hassle (see [linux.md](linux.md) or [proxmox.md](proxmox.md)).

## 1. Install Docker Desktop

1. In an **administrator** PowerShell, enable WSL 2 and reboot when it asks:
   ```powershell
   wsl --install
   ```
2. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/). Keep **Use WSL 2 based engine** turned on.
3. In Docker Desktop → Settings → General, turn on **Start Docker Desktop when you sign in to your computer**.
4. Check that it works in a new PowerShell window: `docker compose version`.

On Windows Server, or if you'd rather not use Docker Desktop, install Ubuntu from the Microsoft Store (`wsl --install -d Ubuntu`), and follow [linux.md](linux.md) inside it. Note that WSL needs extra port forwarding before other devices on your LAN can reach it.

## 2. Install Parley (PowerShell)

```powershell
mkdir C:\parley; cd C:\parley
Invoke-WebRequest https://raw.githubusercontent.com/ParleyDev/parley/main/docs/self-hosting/compose.yaml -OutFile compose.yaml
Invoke-WebRequest https://raw.githubusercontent.com/ParleyDev/parley/main/docs/self-hosting/example.env  -OutFile .env

# Generate two secrets and write them into .env
$pg  = docker run --rm alpine/openssl rand -hex 32
$jwt = docker run --rm alpine/openssl rand -hex 32
(Get-Content .env) -replace '^POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$pg" `
                   -replace '^JWT_SECRET=.*', "JWT_SECRET=$jwt" | Set-Content .env

notepad .env     # set APP_URL, ADMIN_EMAILS, TLS_HOSTNAME
docker compose up -d
```

Open <http://localhost:3000> on the PC itself. Microphone access works there over plain HTTP, because the address is `localhost`.

## 3. Let other devices connect

Find your PC's LAN address with `ipconfig` (for example `192.168.1.50`). Set `TLS_HOSTNAME=192.168.1.50` and `APP_URL=https://192.168.1.50:3443` in `.env`, then run `docker compose up -d`.

Windows Firewall blocks incoming connections by default. Allow the two ports from an **administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Parley" -Direction Inbound -Protocol TCP -LocalPort 3000,3443 -Action Allow -Profile Private
```

`-Profile Private` only opens the ports when Windows treats your network as Private (Settings → Network & Internet → your connection → **Private network**).

Other devices can now use `https://192.168.1.50:3443`. They need to accept the self-signed certificate warning once.

## 4. Keep it running

- Docker Desktop only starts after you **sign in**. Parley's containers come back on their own once Docker is up (`restart: unless-stopped`).
- Stop the PC from sleeping: Settings → System → Power → Screen and sleep → **Never** (when plugged in).
- Windows Update reboots the PC from time to time. After a reboot, Parley is unavailable until someone signs in.

## Backups (PowerShell)

```powershell
cd C:\parley; mkdir backups -Force | Out-Null
$d = Get-Date -Format yyyy-MM-dd
docker compose exec -T db pg_dump -U parley -Fc parley -f /tmp/db.dump
docker compose cp db:/tmp/db.dump backups\db-$d.dump
tar czf backups\uploads-$d.tgz -C data uploads
```

PowerShell 5.1's `>` redirection re-encodes binary output and corrupts the dump. The commands above avoid it by writing the dump inside the container and copying it out. To run the backup nightly, save the commands as `backup.ps1` and schedule it in Task Scheduler.
