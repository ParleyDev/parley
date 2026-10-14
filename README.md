# Parley — a Discord-style chat app

Rust backend (axum + sqlx/Postgres + WebSockets) and a React/Vite/Tailwind frontend, packaged with Docker Compose.

## Run it

```bash
docker compose up --build
```

Open <http://localhost:3000>, register two accounts in two browsers, create a server, copy an invite link, join, chat.

| Service  | Port | Notes                                   |
|----------|------|-----------------------------------------|
| frontend | 3000 (HTTP), 3443 (HTTPS) | nginx serving the SPA, proxies /api, /ws |
| backend  | 18080 | axum REST + WebSocket                   |
| db       | —    | Postgres 16, volume `pgdata`            |

Set a real secret in production: `JWT_SECRET=... docker compose up`. Override host ports with `WEB_PORT=8081` (frontend, default 3000) and `API_PORT=...` (backend, default 18080).

## Features

- Accounts: register, log in (JWT), presence status (online / idle / dnd / invisible)
- Profiles (User Settings → Profiles, with live preview): avatar and banner uploads (resized in the browser), pronouns, a theme colour with optional second colour for a gradient that tints the whole profile card, an About Me that supports the same markdown as messages (bold, italic, underline, strike, code, quotes, links), and a name colour with optional gradient that styles your name in chat, DMs and lists
- Servers: create, rename, icon, delete, leave, kick, invite links (`/invite/<code>`, optional max uses)
- Roles & permissions (Server Settings → Roles / Members): Discord-style roles with colour (solid or two-colour gradient, applied to member names in chat and lists; the highest coloured role wins over a user's own name style), hoisting and a permission bitfield; role hierarchy (you can only edit, assign or kick below your highest role); per-channel allow/deny overwrites for roles and members, private channels, and a "Private channel" switch when creating one. Permissions are enforced server-side and the UI hides what you can't do. See *Permissions* below.
- Channels: text and voice, topics, rename, delete, unread indicators
- Voice & video: WebRTC mesh in voice channels (clicking a voice channel opens it; you join with the Join Voice button, like Discord), mute / deafen, camera, screen share, speaking indicators, focus view for a tile, participant list, auto-rejoin after socket reconnect
- Voice & Video settings (User Settings → Voice & Video): input / output / camera device pickers, input and output volume, mic test with level meter, voice activity or push-to-talk with a recordable key, automatic or manual input sensitivity, echo cancellation / noise suppression / auto gain toggles, camera preview. Settings persist in the browser and apply live mid-call.
- Voice channel chat: every voice channel has its own persistent text chat (the chat icon in the voice header), with unread markers on the channel row and the toggle
- Responsive layout: phones get one pane at a time (channel list ↔ chat / voice stage, member list as a sheet, voice chat as an overlay) with a back button in every header; tablets and desktops get the side-by-side layout
- Messages: real-time delivery, history with infinite scroll, edit, delete (author or owner), replies, reactions, markdown subset (bold, italic, strike, code, code blocks, quotes, links), typing indicators, read states, desktop notifications
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
GET   /users/@me/channels   POST /users/@me/channels {recipient_id}
GET   /guilds   POST /guilds   GET|PATCH|DELETE /guilds/:id
GET|POST /guilds/:id/channels   GET /guilds/:id/members
DELETE /guilds/:id/members/@me   DELETE /guilds/:id/members/:uid
GET|POST /guilds/:id/invites   GET|POST /invites/:code
GET|PATCH|DELETE /channels/:id
GET|POST /channels/:id/messages?before=&limit=
PATCH|DELETE /channels/:id/messages/:mid
PUT|DELETE /channels/:id/messages/:mid/reactions/:emoji
POST /channels/:id/typing   PUT /channels/:id/read {message_id}
GET  /ws?token=<jwt>   (events: READY, MESSAGE_CREATE/UPDATE/DELETE, REACTION_ADD/REMOVE,
      TYPING_START, PRESENCE_UPDATE, USER_UPDATE, GUILD_*, GUILD_MEMBER_*, CHANNEL_*, READ_STATE_UPDATE,
      VOICE_STATE_UPDATE, VOICE_SIGNAL, VOICE_ERROR)
      client ops: ping, typing, voice_join, voice_leave, voice_state, voice_signal
```

## Voice, video and screen share (WebRTC)

Media is peer-to-peer mesh: each participant keeps one `RTCPeerConnection` per other participant, so it suits small rooms (roughly up to 6-8 people for audio, fewer with everyone on camera; upload bandwidth scales with participant count). Each connection negotiates three fixed transceivers once (audio, camera, screen); toggling camera or screen share swaps the sender track with `replaceTrack`, so there is no renegotiation. Camera is capped at 720p / 1.5 Mbps and screen share at 3 Mbps per peer. Signaling goes over the app WebSocket (`voice_join`, `voice_leave`, `voice_state`, `voice_signal` ops; `VOICE_STATE_UPDATE` / `VOICE_SIGNAL` events). The server only relays SDP/ICE between users in the same channel.

- Browsers require a secure context for microphone access: `localhost` works over HTTP, anything else (LAN IP, hostname) needs HTTPS. The frontend container serves HTTPS on port 3443 with a self-signed certificate generated at first start (set `TLS_HOSTNAME=your-host` for a matching CN; accept the browser warning once). To use a real certificate, place `cert.pem` and `key.pem` in the `certs` volume (`/etc/nginx/certs` inside the container). Without HTTPS the client reports "Microphone needs a secure context".
- Default ICE config is Google's public STUN. Users behind symmetric NATs need a TURN server; set `ICE_SERVERS` to a JSON array of `RTCIceServer` objects, e.g.
  `ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]'`
- Screen share captures video only (no system audio).
- The microphone is routed through Web Audio (device → input gain → voice gate → outgoing track). Input volume and the voice-activity / push-to-talk gate therefore affect what peers hear, and switching input device never needs a renegotiation.
- Output device selection uses `setSinkId`, available in Chromium browsers and recent Firefox; the picker is disabled elsewhere.
- Push-to-talk only works while the browser tab has focus, since web pages cannot read global hotkeys.

## Permissions

Bits mirror Discord's values: Create Invite, Kick Members, Administrator, Manage Channels, Manage Server, Add Reactions, Video (camera/screen), View Channels, Send Messages, Manage Messages, Connect, Speak, Change Nickname, Manage Nicknames, Manage Roles. `GET /api/permissions` lists them.

- Every server has an `@everyone` role whose id equals the server id. New servers give it invite, reactions, video, view, send, connect, speak and nickname.
- Effective permissions = `@everyone` | member's roles; the owner and anyone with Administrator get everything. Channel overwrites then apply in order: `@everyone`, the member's roles (aggregated), the member. No View Channel means no permissions at all in that channel, and the server does not send that channel (or its messages, typing, voice states) to that user.
- Hierarchy: a member may only create/edit/delete roles, assign roles, set overwrites or kick when the target role or member sits below their own highest role; the owner outranks all. A manager can only grant or revoke permission bits they themselves hold.
- Voice: no Connect blocks joining (and evicts you if revoked mid-call), no Speak marks you `suppress`ed so your client keeps its mic gate closed (shown as "Muted by server"), no Video drops camera and screen share.
- Endpoints: `GET/POST /guilds/:id/roles`, `PATCH/DELETE /guilds/:id/roles/:rid` (`position` reorders), `PATCH /guilds/:id/members/:uid` (`roles`, `nickname`), `PUT/DELETE /channels/:id/permissions/:target` (`{kind: role|member, allow, deny}`). Events: `ROLE_UPDATE`, `ROLE_DELETE`, `ROLES_SYNC`, `GUILD_MEMBER_UPDATE`, plus `CHANNEL_CREATE`/`CHANNEL_DELETE`/`CHANNEL_UPDATE` sent per user as visibility changes.

## Attachments

Files are uploaded first (`POST /api/channels/:id/attachments`, multipart field `file`) and then referenced by `attachment_ids` in `POST /api/channels/:id/messages`; a message may have empty content if it has attachments. Uploads that are never attached are swept after an hour. Files live on disk under `UPLOAD_DIR` (the `uploads` volume in compose) and metadata in the `attachments` table; deleting a message deletes its files.

The content type is sniffed from magic bytes, not trusted from the client. Only known image/video/audio/PDF/text types are served `inline`; everything else is `Content-Disposition: attachment` with `nosniff` and a restrictive CSP, so an uploaded HTML or SVG file can never run in the app's origin. Files are served without authentication at `/api/attachments/<uuid-v4>/<name>` so `<img>` tags work, relying on the unguessable id (Discord-CDN style); put the API behind HTTPS if that matters to you.

## Not included

Bans, ownership transfer, threads, an SFU for large calls.
