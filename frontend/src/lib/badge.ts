import { useStore, messageRequests, pendingCount } from '../store'
import { getNotifPrefs } from './notifPrefs'

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

function apply() {
  const n = getNotifPrefs().badge ? badgeCount() : 0
  if (n === last) return
  last = n
  draw(n)
  try {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (n > 0) nav.setAppBadge?.(n).catch(() => {}); else nav.clearAppBadge?.().catch(() => {})
  } catch { /* ignore */ }
}

let started = false
/** Start keeping the badge in sync with the store (idempotent). */
export function initBadge() {
  if (started || typeof document === 'undefined') return
  started = true
  apply()
  useStore.subscribe(apply)
}
/** Re-evaluate after a preference change. */
export function refreshBadge() { last = -1; apply() }
