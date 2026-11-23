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

### Event notifications

**Admin Console → Notifications** sends what happens on the instance to a text channel, a webhook, or both, so your team doesn't have to keep the console open. Events come in four groups, and each group has its own channel and webhook (several groups can share one):

| Group | What it posts |
|---|---|
| Users | New accounts, account deletions being asked for and carried out, and admins suspending, deleting, promoting or demoting people |
| Servers | Servers created, handed to a new owner, being deleted, restored or deleted, taken down, invites paused, discovery changes |
| Safety | New reports (urgent ones marked 🚨), uploads matching known abuse material, spam-check flags, age check requests, restrictions, and case activity |
| Console activity | Every entry in the console's audit log: which admin did what, and to whom |

Each post names who was involved and links to the matching console page: the user, the server, the report, the case, or the settings page that changed. Posts never include a report's reason, a message's content, search terms or anything else from the audit log's details.

- **Channel**: any text channel on the instance. The Parley account posts there, and anyone who can see the channel sees the posts, so use one only your admins can read. Links to the console open in place in the app.
- **Webhook**: a Discord or Slack incoming webhook gets posts in its own format (with mentions turned off). Any other `https://` address gets a JSON `POST` with `content` and `text` versions of the post plus an `event` object: `category`, `kind` (such as `user.signup` or `report.create`), `summary`, `at` and `links` (`label` and absolute `url`; the links use `APP_URL`). Only the webhook's host is shown in the console afterwards; the address itself stays secret.

**Send a test** posts to a group's channel and webhook at once and says if either failed. Each group posts at most 30 times a minute; anything past that is counted in its next post. If a post fails (the channel was deleted, the webhook stopped answering), the group shows the error until a post succeeds or you change its settings.

## Avatar decorations

Besides the built-in frames, people can pick image decorations that you provide. Put the files in `avatar-decorations/` inside the assets folder (`data/assets/avatar-decorations/` by default, or set `ASSETS_PATH` to any folder, for example a NAS share):

- **Formats:** PNG, APNG, GIF or WebP, up to 8 MB each. Animated files play when someone hovers an avatar and on profile cards; lists show the first frame. Reduced motion keeps them still.
- **Shape:** square, with a transparent middle where the avatar shows through. The image is drawn at 1.2× the avatar size, centred, so a 288×288 file suits Discord-style decorations.
- **Names:** the file name is the name people see (`a_hint_of_clove.png` → "A Hint Of Clove") and, lower-cased with anything other than letters, digits, `_` and `-` turned into `_` (`all_bark,_all_bite.webm` → `all_bark__all_bite`), the id saved on profiles. Names added through the admin console or Import may use letters, digits, spaces and `. _ - ! & ' ( ) ,`. Renaming a file therefore removes it from the people using it.
- **Changes:** adding or removing files needs no restart; the list refreshes within 30 seconds. A removed decoration simply stops showing.

The folder is mounted read-only. Still frames are cached under `uploads/asset-cache/`, which is safe to delete.

**Names, descriptions and tags.** Each kind's folder can have a `metadata.json` (nameplates, profile effects and profile frames use the same format; effects and frames name a `folder` of layers instead of a `file`):

```json
{
 "items": [
  {
   "file": "holly_wreath.png",
   "name": "Holly Wreath",
   "description": "A ring of holly and berries.",
   "tags": ["christmas", "winter"]
  }
 ]
}
```

`name` and `description` replace the ones taken from the file name. `tags` group items: people can search for a tag in the profile editor's pickers or click it to see only the items that have it, and the admin console's Cosmetics list filters by them the same way. Tags are shown in lower case without a leading `#`; an item keeps at most 20, each up to 32 characters, and repeats are dropped. Adding or editing an item in the admin console writes its tags here too.

**Browsing: colours, themes, collections, styles and sets.** Members browse everything under Discover → **Profile Style**, sort it by popularity, newness or name, and wear an item or a whole set in one click. The page also uses these optional fields, which a shop sync script or Profile Studio can add. A value of the wrong type is ignored, and prices and availability are never shown.

- On each entry:
  - `colors`: any of purple, blue, green, brown, yellow, orange, red, pink, white, black.
  - `themes`: codes such as `cute_cozy` or `sci_fi`.
  - `collection_id`: groups related items, across kinds.
  - `base_name` and `variant_label`: styles of one design, which share a card, for example "Crystals" and "Amethyst".
  - `bundles`: a list of `[{id, name}]`.
  - `shop_item_id`: what the bundle files refer to an item by.
- At the top of the file:
  - `tag_labels`: the colours' and themes' display names. "Cute & Cozy" becomes the code `cute_cozy`.
  - `collections`: `{id: {items: [file or folder]}}`. When the file has this key, Parley keeps it in step with the entries' `collection_id`s whenever it writes the file.

**Special tags.** An item a sync doesn't know about (made by hand) has no `colors` or `themes`, so it would never show under Discover's colour and theme filters. Give it tags instead: `color:<x>` adds a colour and `theme:<x>` a theme, for example `color:light_blue` or `theme:holiday`. The part after the prefix becomes a code the same way labels do (`theme:Cute & Cozy` is `cute_cozy`). Tags only add to the entry's own `colors` and `themes`, never remove one. A theme's label comes from `tag_labels`, else from its code ("holiday" shows as "Holiday"). A colour other than the ten above is listed by name, without a swatch. Discover shows these tags as the item's colours and themes rather than in its tag list; other prefixes, such as `foo:bar`, are plain tags.

Sets (bundles) span kinds and live at the assets root. `bundles.json` has the shape `{"bundles": [{"id", "name", "collection_id", "items": [{"shop_item_id", "type"}]}]}`, where `type` is `avatar_decoration`, `nameplate`, `profile_effect` or `profile_frame`. An optional `bundles.local.json` is laid over it:
- An entry whose `id` is in `bundles.json` overrides that bundle's fields: `items` replaces the whole list, and `deleted: true` hides the bundle.
- Any other id is a set of its own. Its items may name a file or folder as `{"type", "key"}`.
- A bundle that neither file defines takes its members from the entries' own `bundles` lists.

Members never see items that are missing or turned off. Parley changes neither bundle file on its own. Profile Studio reads and writes them, and each kind's top-level fields, through the admin API (`/api/admin/cosmetics/bundles` and `/api/admin/cosmetics/{kind}/metadata`, with etags), and sets entry fields Parley doesn't manage through `fields`.

When Parley rewrites a `metadata.json` file, it keeps the file's indentation and whether it ends with a newline.

**Importing from another folder.** With the assets folder mounted read-write, Admin Console → Cosmetics → **Import from folder** takes a folder laid out the same way (`avatar-decorations/`, `nameplates/`, `profile-effects/`, `profile-frames/`, each with its `metadata.json`), picked in the browser. It lists, per kind, how many items that folder has, how many this server already has (matched by file or folder name) and how many are new, then adds only the new ones: their files, and their `metadata.json` entries copied as they are. Items whose id clashes with one already here, whose file or folder names have characters other than letters, digits, spaces and `. _ - ! & ' ( ) ,` (or start with `.` or a space, end with a space, run past 100 characters; folder names also leave out `.`), whose files are missing, or with a file over 8 MB are listed and skipped. Nothing already in the folder is changed.

## AI assistants (MCP)

People can connect Claude, ChatGPT, Cursor and other MCP clients to your server at `https://<your server>/mcp`; User Settings → Authorized Apps shows the address and lets them disconnect. It works with nothing extra to install, provided that:

- `APP_URL` is the address people use, with `https://`. Discovery, the consent page and the redirects are built from it.
- Anything in front of the web container forwards `/mcp`, `/oauth/` and `/.well-known/oauth-` to it, like `/api`. With Caddy, Traefik, Nginx Proxy Manager or a Cloudflare Tunnel pointed at the whole site, that is already the case.
- For cloud assistants (claude.ai, ChatGPT), the server is reachable from the internet. Desktop clients also work on a LAN address.

Registration and token requests are limited per IP by `RL_OAUTH` (default `300/60`); see the main README for what each permission allows.

## End-to-end encrypted calls

Voice channels (Channel Settings → End-to-end encryption) and DM or group calls (the lock in the conversation header) can be end-to-end encrypted. Nothing to configure: it works with peer-to-peer calls and with LiveKit, and your server only relays the encrypted key exchange. People compare the safety code in the call header to check nobody is in the middle. Members need a current browser or app (Chrome, Edge, Firefox or Safari from the last few years); older ones are told they can't join an encrypted call.

## Before you open registration to the public

When you run an instance for people you don't know, you are the provider of that service, with the duties your country puts on one. These are worth doing first:

- **Reports**: members can report messages and people, and the reports wait under **Admin Console → Reports**. Child-safety, threat, self-harm and intimate-image reports are marked urgent and sorted first. Make sure someone looks: [event notifications](#event-notifications) can post new ones to your team's channel or chat.
- **Known abuse material**: Parley can check every upload against known child sexual abuse material, hold a match in quarantine and suspend the account. It ships the plumbing and no lists, so it does nothing until you connect a source you are entitled to. See [Matching uploads against known abuse material](media-matching.md).
- **Reporting to the authorities**: register with the body you would report to before you need it, and read [what Parley does and does not do for you](reporting-to-authorities.md). A child-safety report cannot be closed until the report you made, or the decision that none was needed, is on record.
- **Ages**: Parley asks nobody for a date of birth and treats every account as a possible minor until it is confirmed as an adult. Decide [what counts as confirmed](age-assurance.md) on your instance: your staff's word, or a verification service you connect.
- **Spam and bans**: Parley limits accounts that behave like spam and queues them for you to review, and you can limit, silence, suspend or hard-ban an account everywhere. See [abuse and bans](abuse-and-bans.md).
- **Explicit pictures**: optional. [Connect a classifier](explicit-images.md) and the server checks profile pictures, emoji and (where a server asks for it) attachments, not only members' own apps.
- **Your terms and contacts**: publish your terms and community guidelines and a safety contact, and tell Parley where they are (**Admin Console → Policies & Contacts**). Templates are in [docs/policies](../policies/README.md).

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
