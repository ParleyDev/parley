# Parley — a Discord-style chat app

Rust backend (axum + sqlx/Postgres + WebSockets) and a React/Vite/Tailwind frontend, packaged with Docker Compose.

## Run it

```bash
docker compose up --build
```

Open <http://localhost:3000>, register two accounts in two browsers, create a server, copy an invite link, join, chat.

| Service  | Port | Notes                                   |
|----------|------|-----------------------------------------|
| frontend | 3000 (HTTP), 3443 (HTTPS) | nginx serving the SPA, proxies /api, /ws; health at `/healthz` |
| backend  | 18080 | axum REST + WebSocket; health at `/health` |
| db       | —    | Postgres 16, volume `pgdata`            |

Set a real secret in production: `JWT_SECRET=... docker compose up`. Override host ports with `WEB_PORT=8081` (frontend, default 3000) and `API_PORT=...` (backend, default 18080).

Parley admins approve Discover submissions: set `ADMIN_EMAILS=a@b.c,d@e.f` (comma separated); those accounts get the admin flag when they next connect.

Email: `MAIL_MODE=smtp` with `SMTP_URL` (for example `smtp://user:pass@mail.example.com:587?tls=required`), `MAIL_FROM` and `APP_URL` (the public base used in links) sends real mail; the default `MAIL_MODE=log` prints each mail to the backend log, and admins can always read the last 200 at `GET /admin/mail?to=` (how the e2e suites fetch links). `MAIL_MODE=off` disables mail. New accounts get a 24-hour verification link; a banner in the app offers Resend until they confirm. Password reset: "Forgot your password?" on the login page mails a one-hour single-use link to `/reset`; the response never reveals whether an address exists, and a successful reset also verifies the address. Admin Console → Instance Settings can require a verified email before creating servers or using Discover (existing accounts were grandfathered in by the migration).

Rate limits are token buckets per client IP (registration, login, failed logins) or per user (message sends, uploads, the GIF proxy), configured as `count/seconds`: `RL_REGISTER`, `RL_LOGIN`, `RL_LOGIN_FAIL`, `RL_MESSAGES`, `RL_UPLOADS`, `RL_GIFS`. The backend's built-in defaults (20/60, 30/60, 5/60, 10/5, 30/60, 60/60) suit production; `docker-compose.yml` loosens registration, login, messages and uploads for local development and the e2e suites, so set production values in `.env`. Throttled requests get `429` with `Retry-After`.

The GIF picker needs a provider key: `TENOR_API_KEY=...` (preferred, free from Google Cloud → Tenor API) or `GIPHY_API_KEY=...`. Without one the GIF tab says so; everything else works.

## Features

- Accounts: register, log in (JWT), presence status (online / idle / dnd / invisible)
- Appearance (User Settings → Appearance, saved per browser): Dark, Light or Sync with system theme (a light palette overrides the Tailwind colour tokens on `<html data-theme>`), chat font scaling 80–120% for message text and the composer (`--font-scale`), and Cozy or Compact message display (compact drops avatars and puts the time and name inline).
- Two-factor authentication: User Settings → My Account → Enable Two-Factor Auth (confirm password, scan the QR code or type the key into any TOTP app, enter the first code). Activation shows ten single-use backup codes once; View Backup Codes regenerates them, Remove 2FA needs the password and a current or backup code. With 2FA on, the login page asks for a code after the password (one step of clock drift is tolerated, a code never works twice, wrong codes count against the failed-login limit). Admins see a 2FA badge in the Users console and can clear it for a locked-out user.
- Sessions: every login is a row in `sessions` and its id travels in the JWT, so a token can be revoked on its own. User Settings → My Account → Devices lists active logins (browser and OS from the user agent, IP, last active, "this device"), logs any one out, or logs out all other devices; a revoked session gets `SESSION_REVOKED` over its socket and is bounced to the login page at once, and its token is refused by the API and the websocket. Log Out calls `POST /auth/logout`; a password reset revokes every session; admins have Log out of all devices in the Users console.
- Delete account: My Account → Delete Account asks for the password (and a two-factor code when 2FA is on) plus an "I understand" checkbox, then `DELETE /users/@me {password, code?}` removes the account the same way the admin console does (servers you own, messages, uploads and sessions go with it; members of those servers see them vanish live). The only admin on an instance must hand admin to someone else first.
- Profile popout: clicking a user anywhere (chat, member list, voice, friends) opens Discord's compact 300px popout beside what you clicked (a bottom sheet on phones): banner with add-friend and "⋯" buttons, avatar with status, nickname, "display name • username • pronouns", a "N Mutual Friends • N Mutual Servers" row with stacked avatars, a three-line bio with View Full Bio, a "User Reviews" panel, and a "Message @user" box with an emoji picker that starts a DM straight from the card. The "⋯" menu has View Full Profile, Invite to Server (DMs an invite link), friend actions, Block, Kick/Ban (when you may), and Copy User Info (ID, profile link `/users/<id>`, avatar and banner links). View Full Profile opens the full card with Member Since (app and server), roles, mutual friends and servers, user reviews (one short note per author, replaceable; the author or the profile owner can delete it; `GET/PUT /users/:id/reviews`, `DELETE /users/:id/reviews/:rid`) and action buttons.
- DMs, Discord-style: the header shows the recipient's custom status and has Start Voice Call / Start Video Call, Pinned Messages, a profile-panel toggle and a search box; the right-hand panel is the recipient's profile card (banner, friend badge, bio, mutual friends/servers, Member Since, View Full Profile). DM calls use the same WebRTC voice stack as servers (mic, deafen, camera, screen share); the other side gets an incoming-call banner with Join / Ignore.
- Server bar layout: drag a server to reorder it, drop it onto another server to make a folder, or drop it onto/into a folder; folders show a 2×2 preview when closed and expand on click, with a name and colour (Folder Settings) and a Remove Folder option. Every action has a context-menu equivalent (Move Up/Down, Add to Folder › existing or New Folder, Remove from Folder). The layout is per user and saved server-side (`PUT /users/@me/guild-layout`), reconciled with the servers you are actually in.
- Server banners (Server Settings → Overview): shown behind the server name above the channel list and used as the Discover card's banner when the listing has none.
- Create Your Server: the + button opens Discord's two-step dialog (Create My Own, or a Gaming / Friends / Study Group / School Club / Local Community / Artists & Creators template that adds starter channels), with a "Have an invite already? Join a Server" link at the bottom.
- Discover: the compass button opens a directory of servers that their owners submitted (Server Settings → Discovery: category, description, banner) and a Parley admin approved. Browse by category or search and see online/member counts. Clicking a server you are not in opens Discord-style preview mode: its public text channels (those @everyone can view) and their history, read-only, with a "You are currently in preview mode — Join" bar in place of the composer; hovering a card also offers a direct Join. Members are taken straight into the server. Admins (emails in `ADMIN_EMAILS`, persisted as `users.is_admin`) get a Review Queue with Approve / Reject and a note the owner sees. Edits to an approved listing stay live; rejected ones return to pending on resubmission; owners can withdraw at any time.
- Group DMs: pick several friends from "Create a group DM" (or Add Friends from any DM or group) for a chat of up to 10. Groups have an owner (crown), an optional name and icon that any member can change (click the header name to rename), stacked-avatar icons, a members panel with remove (owner) and Leave, and work with calls, pins, search and forwarding like any DM. Only friends can be added; blocking someone does not close a group you share. System notices appear inline as compact rows when someone is added, removed or leaves and when the group name or icon changes (`messages.kind` other than `default`; the actor is the author and `mentions` names the affected member).
- Returning to a server lands on the channel you last had open there (remembered per server in this browser), falling back to the first text channel.
- Custom status: "Set a custom status" from your user panel (emoji + text, 128 chars) shows under your name in DM lists, member lists, DM headers and as a bubble on your profile card.
- Pinned messages: pin from a message's "⋯" menu (Manage Messages in servers, anyone in a DM); the pin button in the header lists them with Jump and Unpin. Message search (header box, Enter) lists matches with Jump. The hover bar also offers your three most-used reactions, and the "⋯" menu has Copy Text, Copy Message ID and Delete.
- Spoiler attachments: mark a pending upload as a spoiler (eye icon); it is blurred with a SPOILER badge until clicked. Discord's `SPOILER_` filename convention is used, so uploads from Discord render the same way.
- Expression picker (GIF / Stickers / Emoji tabs from the composer's three buttons): the emoji tab has search, a category rail (Frequently Used, each server's custom emoji, then the nine unicode groups ≈1,900 emoji) and a `:name:` preview; picks insert at the caret. Typing `:xy` in the composer pops up matching shortcodes (custom emoji from the current server first, shorter names first); Up/Down, Enter or Tab inserts, Escape dismisses, and typing the closing colon of an exact `:name:` converts it in place. Names are the CLDR shortcodes plus Discord/GitHub-style aliases (`:smile:`, `:joy:`, `:+1:`, `:thumbsup:`…), so names copied from Discord work. Add Reaction on a message opens the same picker, so any emoji (custom included) can be a reaction, and the hover bar keeps offering your three most-used. A message that is only emoji renders them jumbo.
- Skin tones: the hand button beside the picker search cycles the six Fitzpatrick tones; the choice persists and applies to every tone-capable emoji in the picker, the composer autocomplete and reactions.
- Reactions render as Discord-style chips (emoji + count, highlighted when yours) followed by an add-reaction chip; hovering a chip lists who reacted ("Bob and You reacted with :fire:"). Clicking or tapping an emoji in a message shows its `:name:` and origin (default or which server's custom emoji).
- Forward: pick one or more channels or DMs from a searchable dialog with a preview; the copy (content, sticker, duplicated attachments) is posted by you with a "Forwarded" label and survives deletion of the original. Bookmarks: save any message you can see from its menu and find them all, across channels, behind the bookmark button in the chat header, with Jump and Remove.
- Right-click context menus: messages (quick reactions, Add Reaction, Reply, Forward, Edit, Copy Text, Bookmark, Pin, Mark Unread, Copy Message Link, Speak Message, Delete, Copy Message ID), users anywhere (Profile, Message, friend actions, Block, Kick/Ban when you outrank them, Copy User ID), channels (Mark As Read, Invite, Copy Link, Edit/Delete, Copy Channel ID), DMs and server icons (Mark As Read, Invite, Settings, Leave/Delete, Copy Server ID).
- Mentions: type `@` or `#` in the composer for an autocomplete of members, roles, `@everyone`/`@here` and text channels (Up/Down, Enter/Tab). Picks stay readable as `@Name` while you type and become Discord's wire tokens (`<@id>`, `<@&id>`, `<#id>`) on send; messages render them as pills (click a user pill for their profile, a channel pill to jump). Messages that mention you, one of your roles or everyone are highlighted, and unread mention counts show as red badges on channels and server icons until you read the channel. `@everyone`/`@here` count only inside servers for members with the new Mention @everyone permission (on by default).
- Notification settings, per server, channel or DM (right-click, or the server header menu): Mute for 15 minutes / 1 hour / 8 hours / 24 hours / until turned back on, and a level of All Messages, Only @mentions or Nothing (channels can also Use Server Default); servers additionally offer Suppress @everyone and @here. Muted places lose their unread indicators and desktop notifications but still badge direct mentions; "Only @mentions" hides the unread pill until you are mentioned; suppressed @everyone never counts as a mention for you. Settings are per user and saved server-side (`/users/@me/notification-settings`).
- Custom emoji and stickers per server (Server Settings → Emoji / Stickers, Manage Server): up to 100 emoji (PNG/JPEG/GIF/WebP ≤ 512 KB, names 2–32 `[A-Za-z0-9_]`, inline rename, live updates) and 60 stickers (≤ 1 MB, name/description/tags). Emoji appear in text as `<:name:id>` / `<a:name:id>` and are usable in any server you belong to; a sticker sends as its own message (`sticker_id`) and renders at 160 px.
- GIFs: the GIF tab shows categories, trending, local favourites (star a GIF) and search via a backend proxy to Tenor/GIPHY, so the key never reaches the browser. Picking one sends its URL; a message that is just a link to an image/GIF renders as an inline embed instead of a bare link.
- Profiles (User Settings → Profiles, with live preview): avatar and banner uploads (still images are resized in the browser; GIF, APNG and animated WebP are uploaded as-is and stay animated, up to 8 MB), pronouns, a theme colour with optional second colour for a gradient that tints the whole profile card, an About Me that supports inline markdown (bold, italic, underline, strike, code, spoilers, quotes, links), and a name colour with optional gradient that styles your name in chat, DMs and lists
- Servers: create, rename, icon, delete, leave, kick, ban (with reason; Server Settings → Bans lists and revokes them, banned users can't accept invites), transfer ownership (owner only, from Server Settings; the new owner gets full control and the old owner keeps only their roles), invite links (`/invite/<code>`, optional max uses)
- Roles & permissions (Server Settings → Roles / Members): Discord-style roles with colour (solid or two-colour gradient, applied to member names in chat and lists; the highest coloured role wins over a user's own name style), hoisting and a permission bitfield; role hierarchy (you can only edit, assign or kick below your highest role); per-channel allow/deny overwrites for roles and members, private channels, and a "Private channel" switch when creating one. Permissions are enforced server-side and the UI hides what you can't do. See *Permissions* below.
- Channels: text and voice, topics, rename, delete, unread indicators
- Voice & video: WebRTC mesh in voice channels (clicking a voice channel opens it; you join with the Join Voice button, like Discord), mute / deafen, camera, screen share, speaking indicators, focus view for a tile, participant list, auto-rejoin after socket reconnect
- Voice & Video settings (User Settings → Voice & Video): input / output / camera device pickers, input and output volume, mic test with level meter, voice activity or push-to-talk with a recordable key, automatic or manual input sensitivity, echo cancellation / noise suppression / auto gain toggles, camera preview. Settings persist in the browser and apply live mid-call.
- Voice channel chat: every voice channel has its own persistent text chat (the chat icon in the voice header), with unread markers on the channel row and the toggle
- Responsive layout: phones get one pane at a time (channel list ↔ chat / voice stage, member list as a sheet, voice chat as an overlay) with a back button in every header; tablets and desktops get the side-by-side layout
- Messages: real-time delivery, history with infinite scroll, edit, delete (author or owner), replies, reactions, Discord-style markdown (see *Markdown* below), typing indicators, read states, desktop notifications
- Attachments: upload up to 10 files (25 MB each) per message via the + button, drag and drop anywhere, or paste from the clipboard. Images render inline with a lightbox, mp4/webm and audio get players, everything else is a download card. Gated by the Attach Files permission.
- Friends: send requests by username (or from any profile), accept / ignore / cancel, friends list with Online / All / Pending / Blocked tabs and a pending badge, mutual requests auto-accept. Blocking removes the friendship, hides the block from the other side, stops DMs both ways and collapses their messages in servers ("1 blocked message — Show").
- Direct messages: search any user, 1:1 DM channels with presence
- Live member list with online/offline grouping and user profile cards

### Upgrading from the Y99-era checkout

The Postgres role and database were renamed `y99` → `parley`. An existing `pgdata` volume keeps the old names, so either reset it (`docker compose down -v`, loses data) or rename in place before starting the new compose file:

```sh
docker compose stop backend
docker compose exec db psql -U y99 -d postgres -c "ALTER DATABASE y99 RENAME TO parley;" -c "CREATE USER tmp_admin SUPERUSER PASSWORD 'tmp';"
docker compose exec db psql -U tmp_admin -d postgres -c "ALTER USER y99 RENAME TO parley;" -c "ALTER USER parley PASSWORD 'parley';"
docker compose exec db psql -U parley -d parley -c "DROP USER tmp_admin;"
docker compose up -d --build
```

Browser sessions carry over: the client migrates the old `y99.token` storage key on first load.

## Tests

End-to-end suites live in `frontend/e2e/` (see its README): `npm run e2e` drives a running stack through the API and a headless browser, and each suite cleans up the users it created. CI (`.github/workflows/ci.yml`) typechecks and lints the frontend, builds and tests the backend, then runs the suites against a fresh `docker compose` stack and uploads screenshots on failure.

Cross-browser: `npm run e2e:webkit` (in `frontend/`, after `npx playwright install --with-deps webkit`) runs the phone-layout suites on WebKit, the engine behind iOS Safari; `E2E_BROWSER=webkit|firefox` works for any suite that launches through `launchBrowser()`. CI runs the Chromium pass and then the WebKit mobile pass.

## Issue tracking (beads)

Open work is tracked in-repo with [beads](https://github.com/steveyegge/beads) (`npm i -g @beads/bd`). Issues live in `.beads/` (Dolt-backed; `.beads/issues.jsonl` is the git-friendly export). Useful commands:

```bash
bd list -t epic          # the roadmap: Testing & CI, Accounts & security, Messaging, Servers, DMs, Voice, Profiles, Admin, Robustness, Operations
bd children <epic-id>    # tasks under an epic
bd ready                 # unblocked work, highest priority first
bd show <id> / bd close <id>
```

## Running more than one backend

Backends are stateless apart from the websocket hub, and the hub is clustered over Postgres: every event an instance emits is also `NOTIFY`-ed on the `parley_events` channel (payloads over 7 KB go through `bus_outbox` by id) and every other instance injects it into its own broadcast, so members connected anywhere see the same messages, typing, reactions, channel and role changes. Presence lives in the `presence` table (one row per user and instance, refreshed by a 30 s heartbeat, rows stale after 90 s): `PRESENCE_UPDATE` fires only when a user's first socket anywhere opens or their last one closes, and online lists (READY, admin console, Discover counts, metrics) read the table. Resume with replay only works against the instance that numbered the client's last event (`READY`/`RESUMED` carry the instance id as `i`, the client sends it back); after a failover the client gets a fresh `READY`. Voice state is still per instance: route a user's websocket consistently (sticky sessions) and keep call participants on the same instance, or put a TURN/SFU in front. Try it locally with `docker compose --profile cluster up -d` (a second backend on port 18081 sharing the database and uploads); the `cluster` e2e suite starts it on demand and checks that events and presence cross instances.

## Observability

- **Metrics**: `GET /metrics` on the backend port (18080, not proxied by nginx) in Prometheus text format: `parley_http_requests_total{method,class}`, a latency histogram `parley_http_request_duration_ms`, `parley_http_errors_5xx_total`, `parley_http_rate_limited_total`, `parley_messages_created_total`, `parley_uploads_total` / `parley_upload_bytes_total`, `parley_ws_connects_total` / `parley_ws_resumes_total`, gauges `parley_ws_connections`, `parley_online_users`, `parley_voice_sessions`, `parley_ws_events_total`, `parley_db_pool_size` / `parley_db_pool_idle`. Set `METRICS_TOKEN` to require `Authorization: Bearer <token>` (or `?token=`) — do that whenever the port is reachable beyond the host.
- **Logs**: `LOG_FORMAT=json` switches the backend to one JSON object per line (level, target, message, fields), ready for Loki / CloudWatch / Datadog; `RUST_LOG` filters as before.
- **Error reporting**: `SENTRY_DSN=https://…` (plus `SENTRY_ENVIRONMENT`) sends every `error!`-level event (database and internal errors, failed audit writes) and any panic to Sentry with the release name baked in at build time. Unset, nothing is sent.

## Backups and restore

`ops/backup.sh` (run by the `backup` compose profile from the official Postgres image) writes a compressed `pg_dump --format=custom` of the database and a `tar.gz` of the uploads volume into `./backups` (`BACKUP_DIR`), keeping the newest `BACKUP_KEEP` (default 7) of each:

```bash
docker compose --profile backup run --rm backup once      # one backup now (also before upgrades)
docker compose --profile backup up -d                     # keep a backup container running: daily (BACKUP_INTERVAL=86400)
ls -lh backups/                                           # db-<ts>.dump, uploads-<ts>.tgz
```

Copy `backups/` off the host (rsync, object storage, snapshots of that directory) — the retention here only bounds local disk. The dump is a plain `pg_restore` archive, so it can be inspected with `pg_restore --list`.

Restore drill (practise it on a scratch checkout before you need it):

```bash
docker compose up -d                                      # fresh stack, migrations applied
ops/restore.sh backups/db-<ts>.dump backups/uploads-<ts>.tgz
```

The script stops the backend, runs `pg_restore --clean --if-exists --no-owner` into the `parley` database (everything currently there is replaced), unpacks the uploads tarball over the `uploads` volume and starts the backend again. Check `docker compose ps`, `curl -fs localhost:18080/health`, log in and open an attachment. To restore just the database, omit the second argument; to restore into a different database for inspection: `docker compose exec -T db pg_restore -U parley -d parley_check --create < backups/db-<ts>.dump` after `createdb -U parley parley_check`.

## Development

Backend (needs Postgres; `docker compose up db` works):

```bash
cd backend
cp .env.example .env
cargo run
```

Frontend (proxies `/api` and `/ws` to `localhost:8080`):

```bash
cd frontend
npm install
npm run dev
```

## API sketch

All routes under `/api`, JSON, `Authorization: Bearer <jwt>` except auth.

```
POST  /auth/register  /auth/login
GET   /users/@me   PATCH /users/@me   GET /users/search?q=   GET /users/:id
GET   /users/@me/channels   POST /users/@me/channels {recipient_id} | {recipient_ids: [...], name?} (group)
PUT|DELETE /channels/:id/recipients/:uid (add a friend / leave or, as owner, remove)   PATCH /channels/:id {name, icon_url} (groups: any member)
GET   /guilds   POST /guilds {name, icon_url, banner_url}   GET|PATCH|DELETE /guilds/:id   GET|PUT /users/@me/guild-layout
GET|POST /guilds/:id/channels   GET /guilds/:id/members
DELETE /guilds/:id/members/@me   DELETE /guilds/:id/members/:uid
GET /guilds/:id/bans   PUT|DELETE /guilds/:id/bans/:uid {reason}   POST /guilds/:id/owner {user_id}
GET|POST(multipart name+file) /guilds/:id/emojis   PATCH|DELETE /guilds/:id/emojis/:eid
GET|POST(multipart name+description+tags+file) /guilds/:id/stickers   PATCH|DELETE /guilds/:id/stickers/:sid
POST /images?kind=avatar|banner|icon (multipart file → {url, animated})   GET /images/:id
GET /gifs/search?q=&pos=   GET /gifs/trending?pos=   GET /gifs/categories
GET|POST /guilds/:id/invites   GET|POST /invites/:code
GET /discover?category=&q=   POST /discover/:gid/join   GET /discover/:gid/preview   GET /discover/:gid/channels/:cid/messages?before= (read-only, public channels of approved servers)   GET|PUT|DELETE /guilds/:id/discovery {description, category, banner_url}
GET /admin/discovery?status=   POST /admin/discovery/:gid/review {status, note}   (Parley admins)
GET|PATCH|DELETE /channels/:id
GET|POST /channels/:id/messages?before=&limit= {content, reply_to, attachment_ids, sticker_id}   GET /channels/:id/search?q=
GET /channels/:id/pins   PUT|DELETE /channels/:id/pins/:mid
POST /channels/:id/messages/:mid/forward {channel_id}   GET /channels/:id/messages/:mid/reactions/:emoji (who reacted)
GET /users/@me/bookmarks   PUT|DELETE /users/@me/bookmarks/:mid
PATCH|DELETE /channels/:id/messages/:mid
PUT|DELETE /channels/:id/messages/:mid/reactions/:emoji
POST /channels/:id/typing   PUT /channels/:id/read {message_id}
GET  /ws?token=<jwt>   (events: READY, MESSAGE_CREATE/UPDATE/DELETE, REACTION_ADD/REMOVE,
      TYPING_START, PRESENCE_UPDATE, USER_UPDATE, GUILD_*, GUILD_MEMBER_*, GUILD_BAN_ADD/REMOVE, GUILD_EMOJIS_UPDATE, GUILD_STICKERS_UPDATE, CHANNEL_*, READ_STATE_UPDATE,
      VOICE_STATE_UPDATE, VOICE_SIGNAL, VOICE_ERROR)
      client ops: ping, typing, voice_join, voice_leave, voice_state, voice_signal
```

## Voice, video and screen share (WebRTC)

Media is peer-to-peer mesh: each participant keeps one `RTCPeerConnection` per other participant, so it suits small rooms (roughly up to 6-8 people for audio, fewer with everyone on camera; upload bandwidth scales with participant count). Each connection negotiates three fixed transceivers once (audio, camera, screen); toggling camera or screen share swaps the sender track with `replaceTrack`, so there is no renegotiation. Camera is capped at 720p / 1.5 Mbps and screen share at 3 Mbps per peer. Signaling goes over the app WebSocket (`voice_join`, `voice_leave`, `voice_state`, `voice_signal` ops; `VOICE_STATE_UPDATE` / `VOICE_SIGNAL` events). The server only relays SDP/ICE between users in the same channel.

- Browsers require a secure context for microphone access: `localhost` works over HTTP, anything else (LAN IP, hostname) needs HTTPS. The frontend container serves HTTPS on port 3443 with a self-signed certificate generated at first start (set `TLS_HOSTNAME=your-host` for a matching CN; accept the browser warning once). To use a real certificate, place `cert.pem` and `key.pem` in the `certs` volume (`/etc/nginx/certs` inside the container). Without HTTPS the client reports "Microphone needs a secure context".
- Real certificates: either mount `cert.pem` / `key.pem` into the `certs` volume, or run `docker compose --profile letsencrypt up -d` with `TLS_HOSTNAME=chat.example.com`, `LETSENCRYPT_EMAIL=you@example.com` and `WEB_PORT=80` (the HTTP-01 challenge is served from `/.well-known/acme-challenge/` on port 80 of that name). The `certbot` sidecar issues the certificate on first start and renews twice a day into the shared `letsencrypt` volume; the frontend copies a new certificate over the self-signed pair within ten minutes and reloads nginx gracefully. `LETSENCRYPT_STAGING=1` uses the staging CA while testing. Both containers have Docker healthchecks (`frontend` `/healthz`, `backend` `/health`), so `docker compose ps` and orchestrators can tell a wedged container from a slow one.
- Default ICE config is Google's public STUN. Users behind symmetric NATs need a TURN server; set `ICE_SERVERS` to a JSON array of `RTCIceServer` objects, e.g.
  `ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]'`
- Screen share captures video only (no system audio).
- The microphone is routed through Web Audio (device → input gain → voice gate → outgoing track). Input volume and the voice-activity / push-to-talk gate therefore affect what peers hear, and switching input device never needs a renegotiation.
- Output device selection uses `setSinkId`, available in Chromium browsers and recent Firefox; the picker is disabled elsewhere.
- Push-to-talk only works while the browser tab has focus, since web pages cannot read global hotkeys.

## Admin console (root)

Accounts listed in `ADMIN_EMAILS` (or flagged `users.is_admin`) get **Admin Console** in their self-card menu, at `/admin`:

- **Overview** — users (online / admins / suspended), servers (in Discover / pending review), messages, upload volume.
- **Users** — search by username, display name or email; make/remove admin, suspend/unsuspend, log out of all devices, clear two-factor auth, delete account. Suspension is immediate: existing tokens stop working, open clients are logged out, and login is refused with "This account has been suspended." You cannot demote or suspend yourself, and the last admin cannot be demoted.
- **Servers** — every server with owner, member and message counts and Discover status; delete any server (members lose it live).
- **Discovery Queue** — the review page described above.
- **Messages** — find any message on the instance by its words (`GET /admin/messages?q=&user_id=&before=`, prefix full-text, 50 per page) and delete it (`DELETE /admin/messages/:id`).
- **Users → Messages and uploads** (folder icon) — a member's 50 most recent messages with Delete on each, every file they uploaded and their profile images with totals (`GET /admin/users/:id/content`), plus Delete all messages (`DELETE /admin/users/:id/messages`) and Purge uploads (`DELETE /admin/users/:id/uploads`: attachments and avatar/banner images are removed and the profile cleared; messages stay without their files). Everything is written to the audit log.
- **Reports** — members can Report Message (any message not their own, from its menu) or Report User (from a user's menu) with a reason; reports land here with the reporter, target, reason and a snapshot of the message (server and channel, kept even if the message is deleted). Actions: Delete message (`DELETE /admin/messages/:id`, works anywhere), Suspend the user, Open channel, Resolve / Dismiss / Reopen (`PATCH /admin/reports/:id {status, note}`); `GET /admin/reports?status=open|resolved|dismissed|all`; `POST /reports {kind: message|user, message_id|user_id, reason}`. The Overview card shows the open count.
- **Audit Log** — every console action (promote/demote, suspend, delete, clear 2FA, log out everywhere, server deletion, settings changes, Discover decisions) with the acting admin, target and time; names are copied at write time so entries outlive deletions. `GET /admin/audit?q=&before=` pages 100 at a time.
- **Instance Settings** — open/close registration (the register page closes and the login page hides its link) and a sitewide announcement banner shown at the top of the app for everyone, both applied live.

Routes: `GET /instance` (public), `GET /admin/stats`, `GET /admin/users?q=`, `PATCH /admin/users/:id {is_admin?, suspended?, mfa?: false}`, `GET|DELETE /admin/users/:id/sessions`, `DELETE /admin/users/:id`, `GET /admin/guilds?q=`, `DELETE /admin/guilds/:id`, `GET|PUT /admin/settings`, `GET /admin/mail?to=`. Auth: `POST /auth/login` answers `{mfa: true, ticket}` for 2FA accounts, then `POST /auth/mfa {ticket, code}` (five-minute ticket) issues the token; `POST /users/@me/mfa/enroll {password}` → `{secret, otpauth_url}`, `POST /users/@me/mfa/confirm {code}` → `{backup_codes, user}`, `POST /users/@me/mfa/backup-codes {password}`, `POST /users/@me/mfa/disable {password, code}`. Sessions: `POST /auth/logout`, `GET /users/@me/sessions` (`current` flags the caller), `DELETE /users/@me/sessions/:id`, `DELETE /users/@me/sessions` (all others). `POST /auth/verify {token}`, `POST /auth/resend-verification`, `POST /auth/forgot {email}`, `POST /auth/reset {token, password}`.

## Permissions

Channel categories: Create Channel offers a Category type; text and voice channels can be created inside one (`parent_id`) or dragged between categories and reordered in the sidebar (Manage Channels; `PATCH /guilds/:id/channels/positions {items: [{id, position, parent_id}]}`, or `PATCH /channels/:id {parent_id, position}`). A channel with no overwrites of its own inherits its category's, so a private category makes its channels private until one gets its own overwrites (then it stops syncing). Categories collapse per browser (unread and the current channel stay visible), have their own context menu (collapse, create channel, edit, delete) and deleting one keeps its channels at the top level. Categories hold no messages.

Member timeouts: anyone with Timeout Members (`MODERATE_MEMBERS`, bit 29) who outranks the target can right-click a member → Timeout (60 s to 1 week) or Remove Timeout; `PUT /guilds/:id/members/:uid/timeout {minutes}` (1 to 40320) and `DELETE` the same path. While `guild_members.timeout_until` is in the future the member keeps View and Read but loses Send, React, Attach, Connect/Speak/Video, Create Invite, Change Nickname and Mention Everyone in every channel (enforced inside the permission math, so overwrites cannot undo it); they are dropped from voice, the member list shows a timer badge, and their composer explains until when. Owners and administrators cannot be timed out; it lapses on its own.

Server audit log: Server Settings → Audit Log (Manage Server) lists moderation and settings changes newest first with the acting member and target: server edits and ownership transfers, channel create/edit/delete and permission overwrites, role create/edit/delete, member role or nickname changes, kicks, bans (with reason), unbans, timeouts, messages deleted by moderators, emoji and sticker changes, Discover submissions and withdrawals. `GET /guilds/:id/audit?q=&before=` pages 100 at a time; rows live in `guild_audit` with names copied at write time.

Bits mirror Discord's values: Create Invite, Kick Members, Ban Members, Administrator, Manage Channels, Manage Server, Add Reactions, Video (camera/screen), View Channels, Send Messages, Manage Messages, Connect, Speak, Change Nickname, Manage Nicknames, Manage Roles. `GET /api/permissions` lists them.

- Every server has an `@everyone` role whose id equals the server id. New servers give it invite, reactions, video, view, send, connect, speak and nickname.
- Effective permissions = `@everyone` | member's roles; the owner and anyone with Administrator get everything. Channel overwrites then apply in order: `@everyone`, the member's roles (aggregated), the member. No View Channel means no permissions at all in that channel, and the server does not send that channel (or its messages, typing, voice states) to that user.
- Hierarchy: a member may only create/edit/delete roles, assign roles, set overwrites, kick or ban when the target role or member sits below their own highest role; the owner outranks all and can never be kicked or banned (transfer ownership first). A manager can only grant or revoke permission bits they themselves hold.
- Voice: no Connect blocks joining (and evicts you if revoked mid-call), no Speak marks you `suppress`ed so your client keeps its mic gate closed (shown as "Muted by server"), no Video drops camera and screen share.
- Endpoints: `GET/POST /guilds/:id/roles`, `PATCH/DELETE /guilds/:id/roles/:rid` (`position` reorders), `PATCH /guilds/:id/members/:uid` (`roles`, `nickname`), `PUT/DELETE /channels/:id/permissions/:target` (`{kind: role|member, allow, deny}`). Events: `ROLE_UPDATE`, `ROLE_DELETE`, `ROLES_SYNC`, `GUILD_MEMBER_UPDATE`, plus `CHANNEL_CREATE`/`CHANNEL_DELETE`/`CHANNEL_UPDATE` sent per user as visibility changes.

## Realtime resume

Every websocket event carries a global sequence number `s`, and the hub keeps the last 4096 events in memory. A client that drops and reconnects passes the last `s` it saw (`/ws?token=…&seq=N`); when the gap is still buffered the server answers `RESUMED {replayed, from}` followed by exactly the events that client missed (filtered to its servers and DMs) and carries on, so state is never rebuilt and nothing is lost. If the gap is older than the buffer, the number comes from a previous backend process, or no `seq` is given, the server sends a full `READY` as before (its `s` is the sequence at subscribe time). Duplicate `MESSAGE_CREATE`s are ignored by the client. `window.__parleyWs` exposes resume/ready counters for debugging.

## Search

The header search box (Enter) opens a results panel scoped to this channel, this server or everywhere you can read (DMs included). Free text uses a Postgres full-text index (`messages.search`, `simple` dictionary) with prefix matching on each word, and Discord-style filters are parsed out of the query: `from:user`, `mentions:user`, `in:channel`, `has:link|image|video|file|sticker`, `before:YYYY-MM-DD`, `after:YYYY-MM-DD`, `pinned:true`. `GET /search?q=&guild_id=&channel_id=&offset=` returns `{total, results}` (25 per page, each hit tagged with its `guild_id` and `channel_name`); `GET /channels/:id/search?q=` is the same engine fixed to one channel. Results only ever include channels the caller can view; an empty query (or one that is only punctuation) returns nothing. Jump opens the message's channel and flashes it when it is loaded.

## Link previews

The first http(s) link in a message that is not bare media (images and GIFs still embed directly) and not a link into the app gets an OpenGraph card: site name, title, description and image. The client asks `GET /embeds?url=` and the backend fetches the page itself with SSRF protection: only `http`/`https`, no credentials in the URL, the host must resolve to public addresses only (loopback, RFC1918, link-local, CGNAT, multicast, IPv6 ULA and mapped forms are refused, as are `localhost`, `*.local`, `*.internal`), redirects are followed by hand for at most three hops with every hop re-checked, bodies are capped at 512 KB, requests time out after six seconds and only `text/html` is parsed (`og:*`, `twitter:*`, `description`, `<title>`). Results are cached in `link_embeds` for 24 hours (misses for one hour) and the request goes through the GIF-proxy rate limit. `EMBED_ALLOW_HOSTS` exempts specific hosts from the private-address rule; `docker-compose.yml` pins the compose network to `172.30.0.0/16` and allows the gateway `172.30.0.1` so the e2e suites can serve test pages from the host. Leave it empty in production.

## Threads

Any message in a server text channel offers Create Thread (needs Send Messages); the header's Threads button lists a channel's active threads, shows the archive, and starts a thread without a root message. A thread is a channel of kind `thread` with `parent_id` set to the text channel, so every message feature works inside it and it inherits the parent's permissions; it never appears in the sidebar. The root message shows a card with the thread name and message count (kept live), and clicking it opens the thread in a side panel with its own composer. The thread's owner, or Manage Messages, can rename or archive it (`PATCH /threads/:id {name, archived}`); a new message in an archived thread reopens it. Thread replies do not light up the server icon, mentions inside threads do; notification settings fall back from the thread to its parent channel. Routes: `POST /channels/:id/threads {name, message_id?}`, `GET /channels/:id/threads?archived=`, `GET /channels/:id/threads/:tid` (with the root message). Threads are included in search.

## Forum channels

Create Channel offers a Forum type: instead of a running chat, the channel shows a grid of posts, pinned ones first, sorted by latest activity or newest, filtered by tag, with an Archived view. New Post takes a title, a message (the post's first message) and tags; a post is a thread under the forum (`POST /channels/:id/threads {name, content, tags}`), so replies happen in the thread panel with every message feature, and the author or Manage Messages can archive or rename it. Manage Messages can pin posts (`PATCH /threads/:id {pinned}`); posts can be retagged (`{tags}`). Tags (up to 20, name + emoji) are managed in Channel Settings → Tags (`GET/POST /channels/:id/tags`, `PATCH/DELETE /channels/:id/tags/:tag`, Manage Channels). Sending a plain message to a forum channel is refused; search covers forum posts like any thread.

## Polls

The bar-chart button beside the composer opens Create Poll: a question, 2–10 answers, "allow multiple answers" and a duration (1 hour to 1 week, or no end time). It is sent as a message with a `poll` object (`POST /channels/:id/messages {content: '', poll: {question, options, multi, duration_hours}}`) and renders as a card. Anyone who can read the channel votes by clicking an answer (`PUT /channels/:id/messages/:mid/poll/:oid`; single-choice polls swap the vote, clicking again removes it via `DELETE`); bars and counts update live for everyone through `POLL_UPDATE` and your own choices are kept client-side. The author, or Manage Messages in a server, can Close poll early (`POST …/poll/close`); expiry closes it on its own and shows Final results. Votes live in `poll_votes`; deleting the message removes the poll.

## Edit history

Editing a message stores the text it replaced in `message_revisions` (only when it actually changed). The "(edited)" marker is a button: it opens a modal with the original and every later version (rendered as markdown, with when each was replaced) and the current text. Anyone who can read the channel can view it: `GET /channels/:id/messages/:mid/history` returns revisions oldest first. Deleting the message drops its history.

## Markdown

Messages and About Me render Discord-flavoured markdown, entirely client-side (the server stores plain text).

| Syntax | Result |
|---|---|
| `**bold**` `*italic*` `_italic_` `***both***` `__underline__` `~~strike~~` | inline styles (nestable) |
| `` `code` `` and ``` ``code with ` inside`` ``` | inline code |
| ` ```lang ` … ` ``` ` | code block with a language label, copy button and syntax highlighting (JS/TS, JSON, shell, Python, Rust, Go, Java, C#, C/C++, CSS, HTML, SQL, YAML, Markdown, diff) |
| `\|\|spoiler\|\|` | hidden until clicked |
| `[text](https://…)`, `<https://…>`, bare URLs | links (http/https only, open in a new tab) |
| `# H1` `## H2` `### H3` | headers (messages only) |
| `-# text` | subtext |
| `> line` (consecutive lines merge), `>>> rest of message` | block quotes |
| `- item`, `* item`, `1. item`, two-space indent for one level of nesting | lists (messages only) |
| `\*literal\*` | backslash escapes any marker |

Composer and message editor: **Ctrl/⌘+B / I / U / E** (bold, italic, underline, code) and **Ctrl/⌘+Shift+S** (strike) wrap or unwrap the selection, and selecting text shows a small formatting bar with those plus spoiler.

## Attachments

Thumbnails: image attachments larger than 400px on a side get a server-made preview (`<id>.thumb`, JPEG for JPEG sources, PNG otherwise, decoded only when under 50 megapixels) served at `/api/attachments/:id/thumb` and used by the chat grid; the lightbox and downloads use the original. Quotas: each user may hold `UPLOAD_QUOTA_BYTES` (default 1 GiB, 0 = unlimited) across attachments and profile images; uploads over the limit are refused with the current usage, My Account → Storage shows a usage bar (`GET /users/@me/storage`), and the admin's per-user content page can set a custom quota (`PATCH /admin/users/:id {upload_quota_bytes}`; null = default, 0 = unlimited). Deleting messages or purging uploads frees space.

Files are uploaded first (`POST /api/channels/:id/attachments`, multipart field `file`) and then referenced by `attachment_ids` in `POST /api/channels/:id/messages`; a message may have empty content if it has attachments. Uploads that are never attached are swept after an hour. Files live on disk under `UPLOAD_DIR` (the `uploads` volume in compose) and metadata in the `attachments` table; deleting a message deletes its files.

Profile images (avatars, banners, server icons) and the files behind custom emoji and stickers go through `POST /api/images` into the `images` table and the same upload directory, served at `/api/images/<uuid-v4>` with an immutable cache header; a custom emoji or sticker shares its id with its image, so `<:name:id>` resolves without a lookup. Replacing an avatar deletes the old file; unreferenced images are swept after an hour. Data-URL avatars from older clients are still accepted.

The content type is sniffed from magic bytes, not trusted from the client. Only known image/video/audio/PDF/text types are served `inline`; everything else is `Content-Disposition: attachment` with `nosniff` and a restrictive CSP, so an uploaded HTML or SVG file can never run in the app's origin. Files are served without authentication at `/api/attachments/<uuid-v4>/<name>` so `<img>` tags work, relying on the unguessable id (Discord-CDN style); put the API behind HTTPS if that matters to you.

## Not included

Threads, an SFU for large calls, audit log, timeouts.
