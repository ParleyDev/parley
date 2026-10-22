# Portainer

Use this guide if your home lab already runs [Portainer](https://www.portainer.io) (CE or BE) on a Docker standalone environment.

## Create the stack

1. Portainer → your environment → **Stacks** → **Add stack** → name it `parley`.
2. Choose a build method:
   - **Web editor:** paste [compose.yaml](compose.yaml).
   - **Repository:** URL `https://github.com/ParleyDev/parley`, reference `refs/heads/main`, compose path `docs/self-hosting/compose.yaml`. Optionally turn on **GitOps updates** so the stack follows changes to the file.
3. Under **Environment variables**, switch to **Advanced mode** and paste your edited [example.env](example.env). Set at least:
   ```ini
   POSTGRES_PASSWORD=<random hex>
   JWT_SECRET=<random hex>
   DATA_DIR=/opt/parley/data
   TLS_HOSTNAME=192.168.1.30
   APP_URL=https://192.168.1.30:3443
   ADMIN_EMAILS=you@example.com
   ```
   **Set `DATA_DIR` to an absolute path.** With the default `./data`, Portainer resolves the path inside its own container, and your data ends up in a hard-to-find folder under Portainer's own data directory.
4. Click **Deploy the stack**.

## Updating

Stacks → parley → **Editor** → **Update the stack**, with **Re-pull image and redeploy** turned on.

## Notes

- Portainer Agent environments on a NAS or Raspberry Pi work the same way. The images are multi-arch (amd64 and arm64).
- Swarm mode isn't supported by this compose file (`depends_on` conditions and profiles are compose-only). Use a standalone Docker environment.
- To back up, run the `pg_dump` command from [README.md](README.md#backups) through the db container's **Console** (Containers → parley-db-1 → Console → `/bin/sh`), or from the host with a cron job.
