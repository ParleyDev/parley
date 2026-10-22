# Proxmox VE

There are two ways to run Docker on Proxmox:

| Option | Pros | Cons |
|---|---|---|
| **VM (recommended)** | Full isolation, works the same way as any Linux server, and snapshots include everything. | Uses a little more RAM. |
| **LXC container** | Lighter, and boots in seconds. | Docker-in-LXC needs extra features enabled, and some Proxmox upgrades have broken it before. |

## Option A: Debian 12 VM

1. Download the Debian 12 netinst ISO to local storage (Datacenter → *node* → local → ISO Images → Download from URL).
2. Create a VM with 2 vCPU, 2–4 GB RAM, a 20 GB or larger disk (VirtIO SCSI), and a VirtIO network on `vmbr0`. Set the CPU type to `host`.
3. Install Debian with **SSH server** and **standard system utilities** selected, and no desktop.
4. Install the QEMU guest agent: run `apt install qemu-guest-agent` in the VM, then enable it under VM → Options → QEMU Guest Agent.
5. Follow [linux.md](linux.md).

## Option B: unprivileged LXC

1. Create a CT from the Debian 12 template: unprivileged, 2 cores, 2 GB RAM, 20 GB disk.
2. Before the first start, enable the features Docker needs. On the Proxmox host, run:
   ```bash
   pct set <CTID> --features nesting=1,keyctl=1
   ```
   You can also tick **keyctl** and **Nesting** under CT → Options → Features.
3. Start the CT, open its console, and run:
   ```bash
   apt update && apt install -y curl
   curl -fsSL https://get.docker.com | sh
   ```
4. Follow [linux.md](linux.md) from step 2. You are root inside the CT, so drop the `sudo`s.

Community helper scripts can automate the Docker LXC setup. Read any script before you run it as root on your hypervisor.

## Storage and backups

- Proxmox Backup Server, or `vzdump` snapshot backups of the VM or CT, capture Parley completely. Postgres recovers from a crash-consistent snapshot. A `pg_dump` (see [README.md](README.md#backups)) is still the safest copy, and the easiest to move to another host.
- To keep uploads on a separate disk or a NAS share, add a second disk (VM), or a mount point (CT → Resources → Add → Mount Point). Then point `DATA_DIR` at it.

## Networking

Give the VM or CT a static IP, or create a DHCP reservation for its MAC address on your router. Set `TLS_HOSTNAME` and `APP_URL` to that address. If you enabled the Proxmox firewall on the guest, allow TCP 3000 and 3443 under VM/CT → Firewall.
