import { Capacitor, registerPlugin } from '@capacitor/core'
import { desktop, desktopBridge } from './desktop'
import { isNative } from './native'
import { useStore, messageRequests, pendingCount } from '../store'
import { getNotifPrefs } from './notifPrefs'
import { APP_NAME } from './brand'
import { dmName, isGroup } from './dm'

/**
 * Unread badge: the number of things waiting for you (unread mentions, friend requests, message requests)
 * drawn onto the tab icon and, where the browser supports it, the installed app's icon.
 */
let base: string | null = null
let last = -1
let img: HTMLImageElement | null = null

function link(): HTMLLinkElement | null { return document.querySelector('link[rel="icon"]') }

export function badgeCount(): number {
  const s = useStore.getState()
  const mentions = Object.values(s.mentionCounts).reduce((a, b) => a + b, 0)
  return mentions + pendingCount(s) + messageRequests(s).length
}

function draw(n: number) {
  const el = link()
  if (!el) return
  if (base === null) base = el.href
  if (n <= 0) { el.href = base; return }
  const paint = () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64
    const ctx = c.getContext('2d'); if (!ctx) return
    if (img && img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, 64, 64)
    const label = n > 99 ? '99+' : String(n)
    ctx.font = 'bold 28px system-ui, sans-serif'
    const w = Math.max(30, ctx.measureText(label).width + 14)
    ctx.fillStyle = '#ed4245'
    ctx.beginPath(); ctx.roundRect(64 - w, 28, w, 34, 17); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(label, 64 - w / 2, 46)
    el.href = c.toDataURL('image/png')
  }
  if (!img) { img = new Image(); img.src = base; img.onload = paint; img.onerror = paint }
  paint()
}

/** The iOS app's icon number while it's open (ios/App/App/ParleyBadgePlugin.swift); pushes set it while it's closed. */
const ParleyBadge = registerPlugin<{ set(o: { count: number }): Promise<void> }>('ParleyBadge')

/**
 * The count as a small PNG for the Windows taskbar button's overlay: a red disc with the number in white ("9+" past
 * nine, which is all that reads at 16 pixels).
 */
export async function overlayPng(n: number): Promise<Uint8Array | undefined> {
  if (n <= 0) return undefined
  const c = document.createElement('canvas'); c.width = 32; c.height = 32
  const ctx = c.getContext('2d'); if (!ctx) return undefined
  ctx.fillStyle = '#ed4245'
  ctx.beginPath(); ctx.arc(16, 16, 16, 0, Math.PI * 2); ctx.fill()
  const label = n > 9 ? '9+' : String(n)
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = `bold ${label.length > 1 ? 17 : 22}px "Segoe UI", system-ui, sans-serif`
  ctx.fillText(label, 16, 17)
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined
}

/** The tab title: the unread count, then where you are, e.g. "(3) #general | My Server | Parley". */
let lastTitle = ''
export function pageTitle(n: number): string {
  const s = useStore.getState()
  const id = s.activeChannelId
  const ch = id ? s.channels[id] : undefined
  const dm = id ? s.dms[id] : undefined
  const where = ch ? [`#${ch.name}`, ch.guild_id ? s.guilds[ch.guild_id]?.name : undefined].filter(Boolean).join(' | ')
    : dm ? (isGroup(dm) ? dmName(dm, s.users, s.notes) : `@${dmName(dm, s.users, s.notes)}`)
    : ''
  return `${n > 0 ? `(${n > 99 ? '99+' : n}) ` : ''}${where ? `${where} | ` : ''}${APP_NAME}`
}

function apply() {
  const n = getNotifPrefs().badge ? badgeCount() : 0
  const title = useStore.getState().token ? pageTitle(n) : APP_NAME
  if (title !== lastTitle) { lastTitle = title; document.title = title }
  if (n === last) return
  last = n
  draw(n)
  // Drawing is asynchronous: only the newest count reaches the shell, or a quick 1 → 0 could land as 1.
  if (desktopBridge()) { const mine = ++drawing; void overlayPng(n).then((png) => { if (mine === drawing) desktop.badge(n, png) }) }
  if (isNative() && Capacitor.getPlatform() === 'ios') ParleyBadge.set({ count: n }).catch(() => {})
  try {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (n > 0) nav.setAppBadge?.(n).catch(() => {}); else nav.clearAppBadge?.().catch(() => {})
  } catch { /* ignore */ }
}

let started = false
let drawing = 0
/** Start keeping the badge in sync with the store (idempotent). */
export function initBadge() {
  if (started || typeof document === 'undefined') return
  started = true
  apply()
  useStore.subscribe(apply)
}
/** Re-evaluate after a preference change. */
export function refreshBadge() { last = -1; apply() }
