# Explicit-image checks made by the server

Parley's explicit image filter runs in each member's own app. That keeps pictures on the device, but it means a
bot, an API client or a changed app is never checked, and pictures everyone sees (profile pictures, banners,
server icons, emoji and stickers) are not checked at all.

Connect a classifier and the server checks them itself. Parley ships the plumbing and no model: you run a small
service that says whether a picture is explicit.

## What is checked

- **Pictures everyone sees** (profile pictures, banners, server icons, emoji, stickers): always refused when the
  service says explicit. While the service cannot be reached they are refused too, unless you turn that off,
  because they are shown to everyone including people not confirmed as adults.
- **Attachments**: checked where the server's own **Explicit image filter** applies (Server Settings → Safety
  Setup: off, members without roles, or everyone). Never checked in an age-restricted channel or in direct
  messages. While the service is down they go through.

Pictures and videos up to 30 MB are sent. The service's answer is not stored.

## Setting it up

**Admin Console → Explicit Image Checks** (instance managers only): the service's address, an optional access
token, and **Send a test picture**.

Parley sends one request per picture or video:

```
POST <service address>
Authorization: Bearer <access token>      (only when a token is set)
Content-Type: <the file's type, e.g. image/png>
X-Parley-Surface: image | attachment | test

<the file's bytes>
```

The service answers `200` with JSON:

```json
{ "explicit": false }
```

Any other status, a timeout (20 seconds) or an unreadable answer counts as the service being unavailable.

Rules for the service:

- Answer `{ "explicit": false }` to the test picture (a single blank pixel, `X-Parley-Surface: test`).
- For an animation or a video, look at several frames and answer explicit only when at least two agree. One odd
  frame should not refuse a file.
- Do not keep the files it is sent, or log their content.
- Make it reachable only from the Parley backend (a private network, or the token).

## What this does not do

- It does not look for known abuse material; that is [known-material matching](media-matching.md), which runs on
  every upload regardless.
- It does not report or flag anyone. A refused picture is simply not stored.
- Calls and screen shares are not checked.
