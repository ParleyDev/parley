import { useSyncExternalStore } from 'react'
import { api } from './api'
import { appNavigate, isDesktop, isNative } from './native'

/**
 * The installable web app: service worker (offline shell + browser push), the install prompt, and this browser's
 * push subscription. Not used inside the native or desktop shells, which have their own notifications.
 */
const usable = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !isNative() && !isDesktop() && window.isSecureContext

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let installEvent: BIP | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Once at boot. */
export function initPwa() {
  if (!usable()) return
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e as BIP; emit() })
  window.addEventListener('appinstalled', () => { installEvent = null; emit() })
  navigator.serviceWorker.addEventListener('message', (e) => { const m = e.data as { type?: string; path?: string }; if (m?.type === 'parley-navigate' && m.path) appNavigate(m.path) })
  void navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('service worker', e))
}

/** Can the browser offer "Install app" right now (Chromium only; Safari uses Share → Add to Home Screen)? */
export const useInstallable = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => !!installEvent)
export async function promptInstall() { const e = installEvent; if (!e) return; await e.prompt(); await e.userChoice.catch(() => null); installEvent = null; emit() }
export const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

export const pushSupported = () => usable() && 'PushManager' in window && typeof Notification !== 'undefined'

const b64 = (s: string) => { const p = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(p), (c) => c.charCodeAt(0)) }

async function reg() { return navigator.serviceWorker.ready }

/** Is this browser subscribed (to anyone's account on this server)? */
export async function pushSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false
  try { return !!(await (await reg()).pushManager.getSubscription()) } catch { return false }
}

/** Ask for permission, subscribe and register the subscription with this session. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false
  if ((await Notification.requestPermission()) !== 'granted') return false
  const { public_key } = await api.get<{ public_key: string }>('/push/web/key')
  const r = await reg()
  let sub = await r.pushManager.getSubscription()
  // A subscription made with another server key (key rotated) can't be reused.
  const want = b64(public_key)
  const have = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null
  if (sub && (!have || have.length !== want.length || have.some((b, i) => b !== want[i]))) { await sub.unsubscribe(); sub = null }
  if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want })
  await api.put('/users/@me/web-push', sub.toJSON())
  try { localStorage.setItem('parley.webPush', '1') } catch { /* ignore */ }
  return true
}

/** Stop pushes to this browser (and tell the server). */
export async function disablePush() {
  try { localStorage.removeItem('parley.webPush') } catch { /* ignore */ }
  if (!pushSupported()) return
  try {
    const sub = await (await reg()).pushManager.getSubscription()
    if (!sub) return
    await api.delete('/users/@me/web-push', { endpoint: sub.endpoint }).catch(() => {})
    await sub.unsubscribe()
  } catch { /* ignore */ }
}

/** After login: re-send an existing subscription so it follows the current session. */
export async function refreshPush() {
  try { if (localStorage.getItem('parley.webPush') !== '1') return } catch { return }
  if (!pushSupported() || Notification.permission !== 'granted') return
  try { const sub = await (await reg()).pushManager.getSubscription(); if (sub) await api.put('/users/@me/web-push', sub.toJSON()) } catch { /* ignore */ }
}

/** A channel was read (here or on another device): clear its notifications from this browser. */
export function clearChannelNotifications(channelId: string) {
  if (!usable() || !navigator.serviceWorker.controller) return
  navigator.serviceWorker.controller.postMessage({ type: 'parley-read', channel_id: channelId })
}
