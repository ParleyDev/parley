# Y99 — a Discord-style chat app

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

- Accounts: register, log in (JWT), profile (display name, bio, avatar upload), presence status (online / idle / dnd / invisible)
- Servers: create, rename, icon, delete, leave, kick (owner), invite links (`/invite/<code>`, optional max uses)
- Channels: text and voice, topics, rename, delete, unread indicators
- Voice: WebRTC mesh audio in voice channels (join from sidebar or channel view), mute / deafen, speaking indicators, participant list, auto-rejoin after socket reconnect
- Messages: real-time delivery, history with infinite scroll, edit, delete (author or owner), replies, reactions, markdown subset (bold, italic, strike, code, code blocks, quotes, links), typing indicators, read states, desktop notifications
- Direct messages: search any user, 1:1 DM channels with presence
- Live member list with online/offline grouping and user profile cards

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

## Voice (WebRTC)

Audio is peer-to-peer mesh: each participant keeps one `RTCPeerConnection` per other participant, so it suits small rooms (roughly up to 6-8 people). Signaling goes over the app WebSocket (`voice_join`, `voice_leave`, `voice_state`, `voice_signal` ops; `VOICE_STATE_UPDATE` / `VOICE_SIGNAL` events). The server only relays SDP/ICE between users in the same channel.

- Browsers require a secure context for microphone access: `localhost` works over HTTP, anything else (LAN IP, hostname) needs HTTPS. The frontend container serves HTTPS on port 3443 with a self-signed certificate generated at first start (set `TLS_HOSTNAME=your-host` for a matching CN; accept the browser warning once). To use a real certificate, place `cert.pem` and `key.pem` in the `certs` volume (`/etc/nginx/certs` inside the container). Without HTTPS the client reports "Microphone needs a secure context".
- Default ICE config is Google's public STUN. Users behind symmetric NATs need a TURN server; set `ICE_SERVERS` to a JSON array of `RTCIceServer` objects, e.g.
  `ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]'`
- Video and screen share are not implemented.

## Not included

Video / screen share, file attachments, roles/permissions beyond owner, friend requests, threads.
