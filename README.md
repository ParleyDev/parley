<p align="center"><img src="branding/Parley-Neon-Logo.png" width="128" alt="Parley logo"></p>

# Parley — a Discord-style chat app

Website: [runparley.com](https://runparley.com)

Rust backend (axum + sqlx/Postgres + WebSockets) and a React/Vite/Tailwind frontend, packaged with Docker Compose.

## Run it

```bash
docker compose up --build
```

**Self-hosting:** to run Parley on your own server, NAS or home lab (Linux, Raspberry Pi, Windows, macOS, Proxmox, Synology, Unraid, TrueNAS, Portainer, plus reverse proxies and tunnels), follow [docs/self-hosting](docs/self-hosting/README.md). It uses an image-only `compose.yaml` with production defaults. The root `docker-compose.yml` is meant for development.

The `main` branch publishes multi-platform images to Docker Hub as `parleydev/parley:latest` (backend) and `parleydev/frontend:latest` (web frontend), with matching `sha-<commit>` tags. Pushing a `v*` Git tag also publishes that version tag for both images. To run a published version with Compose, set `PARLEY_IMAGE_TAG` to `latest`, a `v*` release tag, or a `sha-*` tag, then run `docker compose pull` and `docker compose up`. The Compose file defaults to `latest`; `docker compose up --build` builds from the local source instead.

Image publishing uses the repository secret `DOCKERHUB_TOKEN`, a Docker Hub access token with write access to both repositories. Add it under **Settings → Secrets and variables → Actions** in GitHub before the first publish.

Open <http://localhost:3000>, register two accounts in two browsers, create a server, copy an invite link, join, chat.

| Service  | Port | Notes                                   |
|----------|------|-----------------------------------------|
| frontend | 3000 (HTTP), 3443 (HTTPS) | nginx serving the SPA, proxies /api, /ws; health at `/healthz` |
| backend  | 18080 | axum REST + WebSocket; health at `/health` |
| db       | —    | Postgres 16, volume `pgdata`            |

Set a real secret in production: `JWT_SECRET=... docker compose up`. Override host ports with `WEB_PORT=8081` (frontend, default 3000) and `API_PORT=...` (backend, default 18080).

Parley admins approve Discover submissions: set `ADMIN_EMAILS=a@b.c,d@e.f` (comma separated); those accounts get the admin flag when they next connect. Removing an email from the list demotes that account again at its next request (audited as `user.demote`), unless it is the last admin; admins promoted from the Admin Console are not affected by the list.

Email: `MAIL_MODE=smtp` with `SMTP_URL` (for example `smtp://user:pass@mail.example.com:587?tls=required`), `MAIL_FROM` and `APP_URL` (the public base used in links) sends real mail; the default `MAIL_MODE=log` prints each mail to the backend log. Every email (sent, failed, logged or off) is recorded in the database and listed in Admin Console → Mail with its outcome, kept for 30 days by default (adjustable there, or until deleted; `GET/PUT /admin/mail/settings {retention_days}`, `DELETE /admin/mail/:id`, `DELETE /admin/mail?to=`); `GET /admin/mail?to=&limit=` is also how the e2e suites fetch links. `MAIL_MODE=off` disables mail. New accounts get a 24-hour verification link; a banner in the app offers Resend until they confirm. Password reset: "Forgot your password?" on the login page mails a one-hour single-use link to `/reset`; the response never reveals whether an address exists, and a successful reset also verifies the address. Admin Console → Instance Settings can require a verified email before creating servers or using Discover (existing accounts were grandfathered in by the migration).

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
- Profiles (User Settings → Profiles, with a live preview you can edit in place: click the name, pronouns, custom status, avatar or banner on the card to change it, and pick online, idle, do not disturb or invisible from the status chip): avatar and banner uploads (still images are resized in the browser; GIF, APNG and animated WebP are uploaded as-is and stay animated, up to 8 MB), pronouns, a theme colour with optional second colour for a gradient that tints the whole profile card, an About Me that supports inline markdown (bold, italic, underline, strike, code, spoilers, quotes, links), and a name colour with optional gradient that styles your name in chat, DMs and lists
- Servers: create, rename, icon, delete, leave, kick, ban (with reason; Server Settings → Bans lists and revokes them, banned users can't accept invites), transfer ownership (owner only, from Server Settings; the new owner gets full control and the old owner keeps only their roles), invite links (`/invite/<code>`) that expire after 30 minutes, 1, 6 or 12 hours, 1, 7 or 30 days or never, with an optional limit of 1, 5, 10, 25, 50 or 100 uses; Server Settings → Invites lists every live invite with its inviter, uses and expiry, makes new ones and revokes them, and servers approved for Discovery can claim up to three vanity links (`/invite/your-name`, any case, never expire, stop resolving while the server is out of Discovery)
- Roles & permissions (Server Settings → Roles / Members): Discord-style roles with colour (solid or two-colour gradient, applied to member names in chat and lists; the highest coloured role wins over a user's own name style), hoisting and a permission bitfield; role hierarchy (you can only edit, assign or kick below your highest role); per-channel allow/deny overwrites for roles and members, private channels, and a "Private channel" switch when creating one. Permissions are enforced server-side and the UI hides what you can't do. See *Permissions* below.
- Channels: text and voice, topics, rename, delete, unread indicators
- Voice & video: WebRTC mesh in voice channels (clicking a voice channel opens it; you join with the Join Voice button, like Discord), mute / deafen, camera, screen share, speaking indicators, focus view for a tile, participant list, auto-rejoin after socket reconnect
- End-to-end encrypted calls: a per-channel switch (Channel Settings → End-to-end encryption, Manage Channels; the lock button in a DM or group header, any member). Every audio, video and screen-share frame is sealed with AES-GCM on the sender's device under that sender's own random key; keys travel pairwise over the signalling relay, wrapped with a P-256 ECDH + HKDF secret, so the server relays them without being able to read them. Mesh calls run frames through an encoded-transform worker (`RTCRtpScriptTransform`, or Chrome's insertable streams; video is negotiated as VP8), LiveKit calls use LiveKit's frame encryption with the same per-participant keys, and senders rotate their key when someone leaves an SFU call. The call header shows a lock with a 20-digit safety code, a hash of everyone's public keys: everyone sees the same code unless someone in the middle swapped keys. Clients that can't encrypt are refused (`voice_join` carries `e2ee`; the server checks it), anyone in the call reconnects when the switch changes, and switching it on drops clients that can't encrypt from the call in progress
- Voice & Video settings (User Settings → Voice & Video): input / output / camera device pickers, input and output volume, mic test with level meter, voice activity or push-to-talk with a recordable key, automatic or manual input sensitivity, echo cancellation / noise suppression / auto gain toggles, camera preview. Settings persist in the browser and apply live mid-call.
- Voice channel chat: every voice channel has its own persistent text chat (the chat icon in the voice header), with unread markers on the channel row and the toggle
- Responsive layout: phones get one pane at a time (channel list ↔ chat / voice stage, member list as a sheet, voice chat as an overlay) with a back button in every header; tablets and desktops get the side-by-side layout
- Messages: real-time delivery, history with infinite scroll, edit, delete (author or owner), replies, reactions, Discord-style markdown (see *Markdown* below), typing indicators, read states, desktop notifications
- Attachments: upload up to 10 files (25 MB each) per message via the + button, drag and drop anywhere, or paste from the clipboard. Images render inline with a lightbox, mp4/webm and audio get players, everything else is a download card. Gated by the Attach Files permission.
- Friends: send requests by username (or from any profile), accept / ignore / cancel, friends list with Online / All / Pending / Blocked tabs and a pending badge, mutual requests auto-accept. Blocking removes the friendship, hides the block from the other side, stops DMs both ways and collapses their messages in servers ("1 blocked message — Show").
- Direct messages: search any user, 1:1 DM channels with presence
- Live member list with online/offline grouping and user profile cards

### Upgrading from the reChat-era checkout

The Postgres role and database were renamed `reChat` → `parley`. An existing `pgdata` volume keeps the old names, so either reset it (`docker compose down -v`, loses data) or rename in place before starting the new compose file:

```sh
docker compose stop backend
docker compose exec db psql -U reChat -d postgres -c "ALTER DATABASE reChat RENAME TO parley;" -c "CREATE USER tmp_admin SUPERUSER PASSWORD 'tmp';"
docker compose exec db psql -U tmp_admin -d postgres -c "ALTER USER reChat RENAME TO parley;" -c "ALTER USER parley PASSWORD 'parley';"
docker compose exec db psql -U parley -d parley -c "DROP USER tmp_admin;"
docker compose up -d --build
```

Browser sessions carry over: the client migrates the old `reChat.token` storage key on first load.

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

## Publishing through a Cloudflare Tunnel

No ports need opening: create a tunnel in Cloudflare Zero Trust (Networks → Tunnels), add a public hostname (for example `chat.example.com`) whose service is `http://frontend:80`, copy the tunnel token, then

```bash
TUNNEL_TOKEN=... APP_URL=https://chat.example.com docker compose --profile tunnel up -d
```

Cloudflare terminates TLS (the browser gets the secure context voice needs), forwards WebSockets, and sets `X-Forwarded-For` to the visitor's address so the per-IP rate limits keep working. Leave the origin on plain HTTP, keep ports 3000 and 18080 unpublished (so the forwarded header cannot be spoofed and `/metrics` stays private), set `APP_URL` to the public address (emailed links, invites), and leave `EMBED_ALLOW_HOSTS` empty. Mesh voice works unchanged (media is peer-to-peer; add a TURN server in `ICE_SERVERS` for strict NATs). The LiveKit SFU cannot ride the tunnel: its media ports (UDP 7882, TCP 7881) must be reachable directly, or use LiveKit Cloud.

## Running more than one backend

Backends are stateless apart from the websocket hub, and the hub is clustered over Postgres: every event an instance emits is also `NOTIFY`-ed on the `parley_events` channel (payloads over 7 KB go through `bus_outbox` by id) and every other instance injects it into its own broadcast, so members connected anywhere see the same messages, typing, reactions, channel and role changes. Presence lives in the `presence` table (one row per user and instance, refreshed by a 30 s heartbeat, rows stale after 90 s): `PRESENCE_UPDATE` fires only when a user's first socket anywhere opens or their last one closes, and online lists (READY, admin console, Discover counts, metrics) read the table. Resume with replay only works against the instance that numbered the client's last event (`READY`/`RESUMED` carry the instance id as `i`, the client sends it back); after a failover the client gets a fresh `READY`. Voice state is still per instance: route a user's websocket consistently (sticky sessions) and keep call participants on the same instance, or put a TURN/SFU in front. Try it locally with `docker compose --profile cluster up -d` (a second backend on port 18081 sharing the database and uploads); the `cluster` e2e suite starts it on demand and checks that events and presence cross instances.

## Passkeys

Settings → My Account → Passkeys adds a passkey (fingerprint, face, screen lock or a security key) after the password, plus a two-factor code when 2FA is on; a security email goes out each time. The login page then offers **Sign in with a passkey**, and browsers that support it suggest the passkey in the username field. A passkey replaces both the password and the second factor; passwords keep working. Typing the username first lets security keys that don't store a discoverable credential sign in too; an unknown username gets the same kind of challenge, so the page never reveals which accounts exist.

Passkeys belong to the host in `APP_URL` (any port), so they need a domain name (not an IP address) and work only on that address; the Passkeys card says so when they are unavailable. Moving an instance to a new domain makes existing passkeys stop working (passwords are unaffected). Server side: `webauthn-rs`, with credentials in `passkeys` and in-progress ceremonies (five minutes, single use) in `webauthn_challenges`, so any backend instance can finish one. Routes: `GET /users/@me/passkeys`, `POST /users/@me/passkeys/begin {password, code?}` → `/finish {id, credential, name}`, `PATCH|DELETE /users/@me/passkeys/:id`, `POST /auth/passkey/begin {login?}` → `/auth/passkey/finish {id, credential}`.

## MCP (AI assistants)

Parley is a remote [MCP](https://modelcontextprotocol.io) server, so assistants such as Claude, ChatGPT and Cursor can read and send messages for a user. Add `https://<your server>/mcp` (on the hosted service, `https://app.runparley.com/mcp`) as a custom connector or remote MCP server in the assistant; it opens Parley's consent page, the user picks what to allow, and the assistant acts as that user from then on. User Settings → Authorized Apps shows the address to copy and every connected assistant, with **Disconnect**.

**Permissions.** The consent page offers four, each a set of tools; an assistant only ever sees the tools it was granted, and it can never do more than the user could in the app:

| Permission | Tools |
|---|---|
| `mcp.read` Read | `whoami`, `list_servers`, `list_channels`, `list_dms`, `read_messages`, `search_messages` (with `from:`, `in:`, `has:`, `before:`… filters), `list_members`, `find_users`, `get_user`, `list_pins`, `list_threads` |
| `mcp.notifications` Notifications | `get_unreads` ("what did I miss?"), `get_mentions`, `mark_read` |
| `mcp.send` Send messages | `send_message` (replies too), `send_dm`, `edit_message`, `add_reaction`, `remove_reaction`, `create_thread` |
| `mcp.manage` Manage servers (off unless ticked) | `create_channel`, `update_channel`, `pin_message`, `unpin_message`, `delete_message`, `timeout_member`, `remove_timeout`, `kick_member`, `ban_member`, `unban_member`, `create_invite` |

**How it works.** Streamable HTTP transport (protocol revisions 2024-11-05 to 2025-11-25), stateless: one JSON-RPC response per `POST /mcp`, no session id, no server-initiated stream. Each tool calls Parley's own REST API in-process with the assistant's token, so permission checks, events and rate limits are the app's. Authorization follows the MCP spec: `401` with `WWW-Authenticate: Bearer resource_metadata=…` → `/.well-known/oauth-protected-resource/mcp` (RFC 9728) → `/.well-known/oauth-authorization-server` (RFC 8414) → dynamic client registration at `/oauth/register` (RFC 7591, public clients) → `/oauth/authorize` with PKCE S256 and the `resource` parameter (RFC 8707), which hands over to the web client's `/oauth2/mcp/authorize` consent page → `/oauth/token`. Access tokens (`mcp_…`) last an hour; refresh tokens (`mcpr_…`) last 30 days and rotate on every use, and replaying a used one ends the whole connection. MCP tokens also work against the REST API, but only for the calls their tools make (`backend/src/mcp/mod.rs`, `REST_ALLOW`): never account, password, session, admin, OAuth or MCP-consent endpoints. Tables: `mcp_clients`, `mcp_grants`, `mcp_codes`, `mcp_tokens`. Registration and token requests share the `RL_OAUTH` bucket (default 300/60 per IP), and each MCP token has its own message and upload buckets, since AI services call from a few shared addresses.

Self-hosted servers need `APP_URL` set to the public `https://` address (the metadata and redirects are built from it) and a reverse proxy that passes `/mcp`, `/oauth/` and `/.well-known/oauth-*` through to the web container, as it already does for `/api`. Cloud assistants (claude.ai, ChatGPT) can only reach servers on the public internet; desktop clients can use a LAN address.

## Rate limits and sessions (admin)

Rate limits (`RL_REGISTER`, `RL_LOGIN`, `RL_LOGIN_FAIL`, `RL_MESSAGES`, `RL_UPLOADS`, `RL_GIFS`, `RL_MAIL`, `RL_OAUTH`) start from the `RL_*` environment values and can be overridden per bucket in Admin Console → Instance Settings → Rate limits (`count/seconds`; blank = environment value). Changes apply immediately on the instance that saved them and on others at their next restart. Admin → Users → a user → Sessions lists their active devices (IP, client, last seen) with per-device and log-out-all buttons; clicking an IP filters the user list to everyone seen from it (`GET /admin/users?ip=`).

## Load testing

`ops/load/messages.js` (REST send + list per VU) and `ops/load/ws.js` (N sockets in one server, one publisher, measures MESSAGE_CREATE fan-out latency) run under [k6](https://k6.io):

```bash
docker run --rm -i --network host -e BASE=http://localhost:8080 -e VUS=20 -e DURATION=60s grafana/k6 run - < ops/load/messages.js
docker run --rm -i --network host -e BASE=http://localhost:8080 -e VUS=200 -e DURATION=60s grafana/k6 run - < ops/load/ws.js
```

Each VU registers its own account (raise `RL_REGISTER` / `RL_MESSAGES` for the run; the compose defaults are already loose), so point them at a scratch stack, not production. Thresholds: p95 send/list under 300 ms, p95 fan-out under 500 ms, under 1% failed requests. Voice signalling is only exercised by the e2e suites with fake media devices; put LiveKit (`--profile sfu`) in front before testing calls with more than a handful of participants.

## Antivirus

Admin Console → Instance Settings → Antivirus takes a clamd address; `docker compose --profile av up -d` runs ClamAV (`clamav:3310`, signatures in the `av-db` volume, first start takes minutes while they download). Every upload (attachments, voice messages, profile images, custom emoji and stickers) is streamed to clamd (INSTREAM) before it is stored, so nothing unscanned is ever served; an infected file is refused with the signature name and counted in `/metrics` (`av_rejected`). "Fail closed" refuses uploads while the scanner is unreachable; otherwise they pass with an error logged.

## Upgrades and rollback

`ops/upgrade.sh` takes a backup (`ops/backup.sh`), builds the new images and rolls them with `docker compose up -d`; the backend applies pending `sqlx` migrations on start. Migrations are forward-only and, by policy, additive (new tables and nullable or defaulted columns; nothing dropped or renamed in the same release that stops writing it), so an older build can run against a newer schema. To roll back:

1. `git checkout <previous tag>` (or pull the previous image).
2. `MIGRATIONS_IGNORE_MISSING=1 docker compose up -d --build` — without the flag the older backend refuses to start with "migration N was previously applied but is missing in the resolved migrations".
3. Leave the flag on until you roll forward again; it only skips rows the build does not know.

If a release ever ships a destructive migration it says so in its notes, and the rollback for that one is the backup: `ops/restore.sh backups/db-<ts>.dump backups/uploads-<ts>.tgz` taken by the upgrade script right before the migration ran.

## Versions and releases

`VERSION` holds the next release (semver) and `scripts/version.mjs` derives every artifact's version from it: a development build is `<VERSION>-dev.<commits>` (plus `.dirty` with local changes), displayed with the commit (`0.2.0-dev.230+f6a133a`). Desktop installers use `<VERSION>+<commits>` instead, because MSI needs a numeric suffix and RPM forbids `-`. `PARLEY_VERSION` overrides the computed value (containers, CI).

To ship a release, publish a GitHub release whose tag is semver (`v1.4.0`, `1.4.0`, or a pre-release such as `v2.0.0-rc.1`). That triggers the desktop (Windows, macOS, Linux) and mobile (Android, iOS) workflows, and the tag becomes the version of every artifact: `v1.4.0` builds `1.4.0` installers and apps, `v2.0.0-rc.1` builds `2.0.0-rc.1` (installers `2.0.0+<commits>`). Tags that are not semver are skipped with a notice. When the builds finish, each job attaches its files to the release: Windows `.msi` and `-setup.exe`, macOS `.dmg`, Linux `.AppImage`, `.deb` and `.rpm`, and the Android `.apk` (debug-signed, for sideloading; the Play Store needs a release signing key). iOS builds only prove the project compiles, since an installable iOS app needs an Apple developer account and signing. To attach files to a release that already exists, run the desktop or mobile workflow by hand with its tag. Android version codes and iOS build numbers come from the commit count, so they always increase. Both workflows can also be started by hand (Actions → Run workflow) for a development build. Bump `VERSION` after a release so development builds count toward the next one.

## Secrets

Every secret-bearing setting (`DATABASE_URL`, `JWT_SECRET`, `SMTP_URL`, `TENOR_API_KEY`, `GIPHY_API_KEY`, `METRICS_TOKEN`, `SENTRY_DSN`) also accepts a `*_FILE` variable naming a file whose trimmed contents are the value, which is how Docker and Kubernetes secrets arrive. With compose:

```yaml
services:
  backend:
    environment:
      JWT_SECRET_FILE: /run/secrets/jwt_secret
      SMTP_URL_FILE: /run/secrets/smtp_url
    secrets: [jwt_secret, smtp_url]
secrets:
  jwt_secret: { file: ./secrets/jwt_secret }      # or `external: true` under Swarm
  smtp_url: { file: ./secrets/smtp_url }
```

Keep `./secrets/` out of git (it is in `.gitignore`), and rotate `JWT_SECRET` knowing it logs every session out. For a vault (HashiCorp Vault, AWS Secrets Manager, 1Password Connect…), have its agent write the files the `*_FILE` variables point at; nothing in the app needs to know which vault. The Cloudflare tunnel token stays a plain `TUNNEL_TOKEN` because `cloudflared` reads it from the environment.

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
GET|POST /guilds/:id/invites   DELETE /guilds/:id/invites/:code   GET|POST /invites/:code
  (POST body: max_age seconds 1800|3600|21600|43200|86400|604800|2592000 or 0, max_uses 1|5|10|25|50|100 or 0, or vanity "name")
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

SFU for larger calls: peer-to-peer mesh is fine up to about six people. Point Admin Console → Instance Settings → Voice at a [LiveKit](https://livekit.io) server (URL browsers can reach, API key, API secret; `docker compose --profile sfu up -d` runs one in dev mode on `ws://localhost:7880` with key `devkey` / secret `secret`) and every voice channel and DM call becomes a LiveKit room: the backend mints a join token per user from the channel's Connect / Speak / Video permissions (`POST /voice/token {channel_id}` → `{url, token}`), the client publishes its processed microphone track (so push-to-talk, gating, device and volume settings keep working), camera and screen as separate sources, and subscribes to everyone else; the participant list, mute/deafen flags and speaking indicators come from the same `VOICE_STATE_UPDATE` events as before. Clearing the LiveKit fields returns the instance to mesh. `/instance` exposes `voice_mode` and `livekit_url` (never the credentials); `window.__parleyVoice()` reports the active transport for debugging.

Media is peer-to-peer mesh: each participant keeps one `RTCPeerConnection` per other participant, so it suits small rooms (roughly up to 6-8 people for audio, fewer with everyone on camera; upload bandwidth scales with participant count). Each connection negotiates three fixed transceivers once (audio, camera, screen); toggling camera or screen share swaps the sender track with `replaceTrack`, so there is no renegotiation. Camera is capped at 720p / 1.5 Mbps and screen share at 3 Mbps per peer. Signaling goes over the app WebSocket (`voice_join`, `voice_leave`, `voice_state`, `voice_signal` ops; `VOICE_STATE_UPDATE` / `VOICE_SIGNAL` events). The server only relays SDP/ICE between users in the same channel.

- Browsers require a secure context for microphone access: `localhost` works over HTTP, anything else (LAN IP, hostname) needs HTTPS. The frontend container serves HTTPS on port 3443 with a self-signed certificate generated at first start (set `TLS_HOSTNAME=your-host` for a matching CN; accept the browser warning once). To use a real certificate, place `cert.pem` and `key.pem` in the `certs` volume (`/etc/nginx/certs` inside the container). Without HTTPS the client reports "Microphone needs a secure context".
- Real certificates: either mount `cert.pem` / `key.pem` into the `certs` volume, or run `docker compose --profile letsencrypt up -d` with `TLS_HOSTNAME=chat.example.com`, `LETSENCRYPT_EMAIL=you@example.com` and `WEB_PORT=80` (the HTTP-01 challenge is served from `/.well-known/acme-challenge/` on port 80 of that name). The `certbot` sidecar issues the certificate on first start and renews twice a day into the shared `letsencrypt` volume; the frontend copies a new certificate over the self-signed pair within ten minutes and reloads nginx gracefully. `LETSENCRYPT_STAGING=1` uses the staging CA while testing. Both containers have Docker healthchecks (`frontend` `/healthz`, `backend` `/health`), so `docker compose ps` and orchestrators can tell a wedged container from a slow one.
- Default ICE config is Google's public STUN. Users behind symmetric NATs need a TURN server; set `ICE_SERVERS` to a JSON array of `RTCIceServer` objects, e.g.
  `ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]'`
- Screen share captures video only (no system audio).
- The microphone is routed through Web Audio (device → input gain → voice gate → outgoing track). Input volume and the voice-activity / push-to-talk gate therefore affect what peers hear, and switching input device never needs a renegotiation.
- Output device selection uses `setSinkId`, available in Chromium browsers and recent Firefox; the picker is disabled elsewhere.
- Push-to-talk only works while the browser tab has focus, since web pages cannot read global hotkeys.
- Audio profiles (Channel Settings → Overview → Audio, for voice, stage and studio channels): **Voice** keeps each member's echo cancellation, noise suppression and auto gain and sends mono Opus; **High fidelity** turns all processing off, captures 48 kHz stereo and disables DTX, for music and instruments (members should wear headphones). Bitrate is 8-510 kbps (defaults 64 for voice, 256 for high fidelity). **Ultra-low latency** asks for 10 ms Opus frames instead of 20 ms and a 0 ms jitter-buffer target, which saves roughly 20-60 ms of mouth-to-ear delay on good networks. New studio channels default to high fidelity with low latency. Every client advertises the channel's profile in the Opus parameters of the session descriptions it sends, so senders follow it; an admin changing the profile mid-call renegotiates in place. With LiveKit the profile maps to the published track (bitrate, stereo, DTX and RED off for music); frame size there stays LiveKit's default. **Always Transmit** (Voice & Video → Input Mode) keeps the mic open for music, where voice activity detection would clip quiet passages. The activity button on the Voice Connected card shows live codec, bitrate, frame size, jitter buffer, round trip and loss per participant.

## Admin console (root)

Accounts listed in `ADMIN_EMAILS` (or flagged `users.is_admin`) get **Admin Console** in their self-card menu, at `/admin`:

- **Overview** — users (online / admins / suspended), servers (in Discover / pending review), messages, upload volume.
- **Users** — search by username, display name or email, filter by role, suspended, verified email, 2FA, online now, join date range and inactivity (`GET /admin/users?q=&admin=&suspended=&verified=&mfa=&online=&joined_after=&joined_before=&inactive_days=&offset=&limit=`, total in `X-Total-Count`, 100 per page with Load more). Per row: make/remove admin, suspend/unsuspend, messages & uploads, log out of all devices, clear two-factor auth, delete. Tick rows (or select all on the current page) for bulk suspend, unsuspend, log out everywhere, clear 2FA, set quota or delete (`POST /admin/users/bulk {ids, action, upload_quota_bytes?}`, up to 500 per call; the caller is skipped for destructive actions and every change is audited). Suspension is immediate: existing tokens stop working, open clients are logged out, and login is refused with "This account has been suspended." You cannot demote or suspend yourself, and the last admin cannot be demoted.
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

## Voice messages

The composer's **+** menu (Upload a File, Create Poll, Record Voice Message) records a voice message (MediaRecorder, Opus in WebM/Ogg, AAC in MP4 on Safari, using the input device and processing toggles from Voice & Video settings). While recording the text box becomes a bar with a pulsing dot, timer and live level bars; Discard throws it away, Send decodes the clip to a 64-bar waveform and uploads it with `duration_ms` and `waveform` (base64 amplitude bytes) as multipart fields ahead of `file`. Audio attachments that carry a duration render as a pill-shaped player: play/pause, waveform bars that fill as it plays (accent-coloured for your own messages), click-to-seek, elapsed/total time and a 1× / 1.5× / 2× speed toggle. Audio files uploaded the ordinary way still get the plain `<audio>` control.

Playback everywhere: iPhones (Safari, and Chrome on iOS, both WebKit) cannot play recorder WebM/Opus, and recorder WebM has no duration or seek index, so the backend converts WebM/Ogg voice messages to AAC in MP4 (`.m4a`, 64 kbps mono, faststart) with ffmpeg as they are uploaded; recordings made before that are converted once in the background when the backend starts. iPhone recordings (`audio/mp4`) are kept as they are. The Docker image ships a small audio-only ffmpeg; outside Docker put `ffmpeg` on the backend's PATH, or voice messages stay in their recorded format. Attachments answer HTTP Range requests (`206`), which iOS needs for audio and video and seeking uses.

Listened state: once someone plays past 80% of a voice message the client posts `POST /attachments/:id/listened` and the channel gets `VOICE_LISTENED {channel_id, message_id, attachment_id, user_id}`; the message's attachment carries `listened_by`. A voice message you have not heard yet shows a small accent dot by its time; your own messages show a headphones badge with how many people have listened (hover for names).

Transcription: Admin Console → Instance Settings → Voice message transcription takes any OpenAI-compatible `POST /v1/audio/transcriptions` server (URL, optional API key, model). `docker compose --profile stt up -d` runs a CPU Whisper server (faster-whisper-server, `base.en` by default, a few seconds per clip on a modern CPU); enter `http://stt:8000` and `Systran/faster-whisper-base.en`. Hosted providers (OpenAI `whisper-1`, Groq, Deepgram's OpenAI-compatible endpoint) work the same with a key. When configured, each new voice message is marked `transcript_status: pending`, transcribed in the background and pushed to the channel with `MESSAGE_UPDATE`; the player shows "Transcribing…" and then a "View transcript" toggle that expands the text under it. Failures show "Transcript unavailable" and never block the message. `/instance` exposes `transcription: true|false` (never the key).

## Undelivered DMs and Ribbit

When a direct message cannot be delivered (the other person blocked you, or you blocked them) the server answers 403 with `code: "undeliverable"`. The client keeps the message in the conversation in red with Not delivered · Retry · Delete, and **Ribbit**, the in-app helper (a frog with an App badge), posts a note under it only you can see: why it may have failed, an expandable list of reasons, and Dismiss. Retry sends the same body again (after an unblock it goes through and becomes a normal message); Delete drops it. These rows exist only in your browser and disappear on reload.

Scrolling well above the bottom of a channel shows a "You're viewing older messages" pill with Jump to Present.

## Profile flair: badges, decorations, clan tags, panels

- **Badges** are computed by the server on `GET /users/:id` (`badges`): `admin`, `founder` (first ten accounts), `veteran` (over a year), `host` (owns a server), `verified` (email), `secure` (2FA). They show as icon chips with tooltips on the profile popout and card.
- **Avatar decorations**: User Settings → Profiles offers preset frames (gold, rainbow, glow, ice, dashed, ember) drawn over the avatar everywhere (`users.avatar_decoration`), plus a searchable gallery of image decorations the instance provides: PNG/APNG/GIF/WebP files in the mounted assets folder (`ASSETS_DIR`, Compose `ASSETS_PATH` → `/data/assets/avatar-decorations/`), saved as `asset:<id>`. `GET /api/assets/avatar-decorations` lists them; `…/:id` serves the file and `…/:id/static` a cached still first frame, which lists use until hovered. See [self-hosting → Avatar decorations](docs/self-hosting/README.md#avatar-decorations).
- **Clan tags**: a 2–4 character tag (`users.clan_tag`) shown as a chip beside your name in chat, member lists and profiles.
- **Panels**: optional Wishlist and Game collection sections on the profile card (`users.panels`, up to 25 `{title, url?}` items each), edited one per line as `Title | https://link`.

## Friend nicknames and notes

Open someone's profile popout: the pencil next to a friend's name sets a nickname only you see (it replaces their name in DMs, member lists and messages), and the Note box keeps a private note about anyone. `GET /users/@me/notes` lists yours, `PUT /users/@me/notes/:id {nickname?, note?}` sets them (nicknames for friends only, 32 chars; notes 256 chars; clearing both removes the row).

Group DMs: click the group icon in the header to upload a new one (any member); the owner can hand the group to another member from the member list (crown on hover, `PATCH /channels/:id {owner_id}`), which posts a "made X the group owner." notice.

## Membership screening, featured servers, bookmark folders

- **Rules**: Server Settings → Overview has a rules box (markdown, 4000 chars) and "Members must accept the rules before chatting". Invite pages and Discover previews show the rules; once inside, members who have not accepted see a bar above the composer with View rules → I agree (`POST /guilds/:id/rules/accept`, `guild_members.rules_accepted_at`, `GUILD_MEMBER_UPDATE`). Sending into a channel before accepting answers 403 `code: "rules_required"`. Turning the requirement on applies to existing members too.
- **Featured and verified** (Discover): on an approved listing the admin review queue offers Verified (a badge the instance vouches with, shown on the card) and Featured with an order; featured servers lead the Discover home page (`PATCH /admin/discovery/:gid {featured_order, verified}`, audited as `discovery.update`).
- **Bookmark folders**: each bookmark can be moved into a folder (or a new one) and reordered within it from the Bookmarks panel (`PATCH /users/@me/bookmarks/:mid {folder, position}`); the list groups by folder, loose bookmarks first.

## System messages

Some actions leave a notice in the conversation, rendered as a one-line system row rather than a chat bubble (`kind` on the message; the actor is its author):

- `pins_add` when someone pins a message (`reply_to` is the pinned message; the row has a "See the message" link that jumps to it)
- `thread_created` when a thread is started in a text channel (`ref_id` is the thread; the name opens it)
- `member_join` when someone joins a server, posted to its system channel: the first text channel
- `call_started` when the first person joins a DM or group call
- the group-DM notices (`recipient_add`, `recipient_remove`, `recipient_leave`, `channel_name_change`, `channel_icon_change`)

## Stage channels and scheduled events

- **Stage** is a channel kind (Create Channel → Stage): members with Manage Channels join as speakers, everyone else joins as audience (voice state `suppress`, mic gate shut) and can Raise Hand (`POST/DELETE /channels/:id/stage/hand`, `request_to_speak` on their voice state). Moderators see hands in the audience strip and Invite to speak (`PUT /channels/:id/stage/speakers/:uid`, needs Speak) or move someone back (`DELETE …`); speakers can step down themselves. The voice view shows speakers as tiles and the audience as chips.
- **Events** (`guild_events`, `event_rsvps`): the Events row above the channel list opens the server's upcoming events; Manage Server creates them with a name, start/end, a voice or stage channel or an external location, and a description (`POST /guilds/:id/events`, `PATCH`, `DELETE`, audited). Anyone RSVPs (`PUT/DELETE …/rsvp`); `EVENT_UPDATE` refreshes lists live, and the client reminds you ten minutes before an event you are going to (toast and browser notification). Events drop off an hour after they end.

## Recording Studio

A studio is a voice channel kind (Create Channel → Recording Studio) with three roles: **engineers** (one or more; `studio_engineers`), the **band** (artists; heard and recorded) and the **audience** (suppressed, listening). Every tile and audience chip carries a role menu: Manage Channels and engineers set anyone's role (`PUT /channels/:id/studio/role/:uid {role: engineer|artist|audience}`, audited as `studio.role`); anyone can step down a level themselves. Engineers and moderators join unsuppressed; everyone else starts in the audience. Any engineer's Record control starts a session (`POST /channels/:id/studio/sessions`) and the server tells the channel (`STUDIO_SESSION start`); every band member's client then records its own microphone, taken after input volume but before the talk gate so takes are never clipped by VAD or push-to-talk, with MediaRecorder (Opus/WebM, 128 kbps) and streams 5-second chunks to its own track (`POST /studio/sessions/:sid/tracks`, `…/chunks`, `…/finish`). Each artist is therefore a clean, separate file with no network artefacts, the way remote-session tools work. Stop ends the session.

The Sessions panel (list icon in the studio header) shows every session with its per-artist tracks (name, length, size, start offset, download) and opens a multitrack player: all tracks decoded and played aligned by their offsets, per-track gain / mute / solo, and "Export mix" which renders the audible tracks offline to a 48 kHz 16-bit WAV. Tracks are capped at 30 MB (about an hour) and served only to members who can see the channel. Sessions are listed under `studio_sessions` / `studio_tracks`; the engineer or Manage Channels can delete one.

## Soundboard

Server Settings → Soundboard (Manage Server) takes short clips (MP3/OGG/WAV/WebM/M4A under 512 KB, up to 48 per server) with a name, emoji and volume; files are scanned like any upload and served at `/api/sounds/:id`. In a voice channel the Soundboard control opens a grid; a pick calls `POST /channels/:id/soundboard/:sid` (needs Speak there and to be connected, never while server-suppressed) and the server fans out `SOUNDBOARD_PLAY` to everyone in the channel, who play the clip locally through their voice output device (not while deafened). `SOUNDBOARD_UPDATE` keeps lists fresh.

## iOS and Android apps

`mobile/` holds Capacitor shells for both platforms: a connect-to-server screen, then the server's own web client inside a native WebView with push notifications (FCM, configured in Admin Console → Instance Settings → Push notifications with a Firebase service account), keep-awake during calls, the hardware back button, status bar and haptics. See `mobile/README.md` for building (Gradle / Xcode), signing and the Firebase setup; `.github/workflows/mobile.yml` produces a debug APK and an iOS simulator build.

## Languages

Appearance → Language picks English, Español or Deutsch, or follows the browser (`navigator.language`). `src/lib/i18n.ts` holds the catalogues: keys are the English source strings, so anything untranslated stays English, and `t('Message {name}', { name })` fills placeholders. The core chrome (sign-in, sidebars, settings, voice controls, channel header, server menu) is extracted; to add a language, add a catalogue and an entry in `LANGUAGES`.

## Tablets, phones, accessibility and keybinds

- Three layouts: desktop (≥1024px), tablet (768–1023px: narrower server/channel sidebars, member list as an overlay from its toggle) and phone (<768px: one pane at a time). Phones respect notch safe areas (`viewport-fit=cover`), and a horizontal swipe on the content pane opens the channel list (right) or the member list (left); swiping right again closes the member list.
- Appearance → Accessibility: Reduced motion (the OS setting is honoured automatically) and High contrast.
- User Settings → Keybinds: rebind the app shortcuts (defaults: Ctrl+Shift+M mute, Ctrl+Shift+D deafen, Ctrl+U member list, Ctrl+/ focus the message box, Alt+↑/↓ previous/next channel, Ctrl+, settings, Ctrl+Shift+J jump to date). Plain keys never fire while typing.
- Voice on phones: a two-column tile grid, labelled round controls with a full-width Disconnect, and the chat as a full-screen overlay.

## Jumping around history

`GET /channels/:id/messages` takes `before` (older pages), `after` (newer pages, oldest first) and `around` (a window of `limit/2` messages at or before an id and the rest after it). Ids are uuid v7, so `around` also accepts an id built from a timestamp: the client's jump-to-date (calendar button in the channel header) does exactly that. Jumping to a pin, bookmark, search hit or reply far back loads one window, the pane pages forward as you scroll down, live messages are held back until you press Jump to Present, and the "You're viewing older messages" pill shows the whole time.

## Read receipts, reply links and invite cards

- **Read receipts**: whenever someone's read pointer moves (`PUT /channels/:id/read`) the channel's members get `READ_RECEIPT {channel_id, user_id, message_id}`; `GET /channels/:id/receipts` lists where everyone else is. In a 1:1 DM the last message the other person has seen shows "Seen" with their avatar; in groups and server channels each message shows the stacked avatars of the people whose pointer sits on it (hover for names). Marking happens when the channel is on screen in a visible tab, so a receipt means the message was actually in view.
- **Reply links**: the reply header above a message is a link to the original; clicking scrolls to it and flashes it, loading older history first if it is not on screen yet (up to ten pages).
- **Invite cards**: an invite link to this instance in a message renders as a card with the server icon, name, online and member counts, and Join / Joined / Expired (`GET /invites/:code` includes `online_count`). The Invite People modal also lists your friends with search and an Invite button that opens a DM and sends the link for you (friends already in the server are marked).

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

Profile images (avatars, banners, server icons) and the files behind custom emoji and stickers go through `POST /api/images` into the `images` table and the same upload directory, served at `/api/images/<uuid-v4>` with an immutable cache header; a custom emoji or sticker shares its id with its image, so `<:name:id>` resolves without a lookup. Replacing an avatar deletes the old file; unreferenced images are swept after an hour. Legacy `data:` URL avatars and banners are converted to uploaded images at startup; the API no longer accepts them.

The content type is sniffed from magic bytes, not trusted from the client. Only known image/video/audio/PDF/text types are served `inline`; everything else is `Content-Disposition: attachment` with `nosniff` and a restrictive CSP, so an uploaded HTML or SVG file can never run in the app's origin. Files are served without authentication at `/api/attachments/<uuid-v4>/<name>` so `<img>` tags work, relying on the unguessable id (Discord-CDN style); put the API behind HTTPS if that matters to you.

## License

Parley is open source under the [Apache License 2.0](LICENSE). Copyright 2026 ParleyDev; see [NOTICE](NOTICE). The license does not grant rights to the Parley name or logo.
