/* Parley service worker: an offline app shell, and browser push (notifications with Mark as Read / Reply).
 * Pages are network-first (a deploy shows up on the next load); hashed /assets/ files are cache-first. */
const SHELL = 'parley-shell-v1'
const ASSETS = 'parley-assets-v1'
const MAX_ASSETS = 400
const SKIP = /^\/(api|ws|mcp|oauth|\.well-known)(\/|$)|^\/version\.json$/

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])).catch(() => {}).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

async function trim() {
  const c = await caches.open(ASSETS)
  const keys = await c.keys()
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await c.delete(k)
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || SKIP.test(url.pathname)) return
  if (req.mode === 'navigate') {
    // Network first; offline, the cached shell boots and shows the client's own "reconnecting" state.
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put('/', copy)) } return r }).catch(() => caches.match('/', { cacheName: SHELL }).then((r) => r || Response.error())))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(ASSETS).then((c) => c.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { c.put(req, r.clone()); trim() } return r }))))
    return
  }
  if (/^\/(icons|brand|sounds|fonts)\//.test(url.pathname) || url.pathname === '/favicon.svg' || url.pathname === '/manifest.webmanifest') {
    // Stale while revalidate.
    e.respondWith(caches.open(SHELL).then((c) => c.match(req).then((hit) => { const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r }).catch(() => hit); return hit || net })))
  }
})

// The app icon badge: an open Parley window keeps it in step with unread mentions itself (lib/badge.ts), so the
// worker only counts its notifications while no window is open.
async function badge() {
  if ((await self.clients.matchAll({ type: 'window' })).length) return
  const n = (await self.registration.getNotifications()).length
  try { if (n > 0) await self.navigator.setAppBadge(n); else await self.navigator.clearAppBadge() } catch { /* unsupported */ }
}

self.addEventListener('push', (e) => {
  let p = {}
  try { p = e.data ? e.data.json() : {} } catch { p = { title: 'Parley', body: e.data ? e.data.text() : '' } }
  const d = p.data || {}
  const actions = p.action_token ? [{ action: 'reply', title: 'Reply', type: 'text', placeholder: 'Reply…' }, { action: 'read', title: 'Mark as Read' }] : []
  e.waitUntil((async () => {
    // A tab looking at this channel right now already shows the message.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (d.channel_id && wins.some((w) => w.visibilityState === 'visible' && w.focused && w.url.includes(d.channel_id))) return
    await self.registration.showNotification(p.title || 'Parley', {
      body: p.body || '', tag: p.tag || undefined, renotify: !!p.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
      timestamp: Date.now(), data: { ...d, action_token: p.action_token }, actions,
    })
    await badge()
  })())
})

function pathFor(d) {
  if (d.kind === 'friend_request') return '/channels/@me'
  if (d.channel_id) return `/channels/${d.guild_id || '@me'}/${d.channel_id}${d.message_id ? `/${d.message_id}` : ''}`
  return '/channels/@me'
}

async function act(d, body) {
  return fetch('/api/push/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: d.action_token, ...body }) })
}

async function closeChannel(cid) {
  for (const n of await self.registration.getNotifications()) if (n.data && n.data.channel_id === cid) n.close()
}

self.addEventListener('notificationclick', (e) => {
  const n = e.notification
  const d = n.data || {}
  n.close()
  e.waitUntil((async () => {
    if (e.action === 'read' && d.action_token) { await act(d, { action: 'read' }).catch(() => {}); await closeChannel(d.channel_id); return badge() }
    if (e.action === 'reply' && d.action_token && e.reply) {
      const r = await act(d, { action: 'reply', content: e.reply, message_id: d.message_id }).catch(() => null)
      if (r && r.ok) { await act(d, { action: 'read' }).catch(() => {}); await closeChannel(d.channel_id); return badge() }
    }
    await badge()
    const path = pathFor(d)
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const w = wins.find((c) => new URL(c.url).origin === self.location.origin)
    if (w) { w.postMessage({ type: 'parley-navigate', path }); return w.focus() }
    return self.clients.openWindow(path)
  })())
})

self.addEventListener('notificationclose', (e) => { e.waitUntil(badge()) })

// The page read a channel: drop its notifications here too.
self.addEventListener('message', (e) => {
  const m = e.data || {}
  if (m.type === 'parley-read' && m.channel_id) e.waitUntil(closeChannel(m.channel_id).then(badge))
})
