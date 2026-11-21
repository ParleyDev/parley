import { STORAGE_PREFIX } from './brand'

/**
 * The call this browser was in, kept fresh while it lasts, so that after a reload or an app restart mid-call Parley
 * can offer to rejoin (never rejoin by itself: the member may have closed the window to get out).
 */
const KEY = `${STORAGE_PREFIX}lastCall`
/** After this long nobody is waiting for you to come back. */
export const RESTORE_MS = 5 * 60_000

export function rememberCall(channelId: string | null, now = Date.now()) {
  try { if (channelId) localStorage.setItem(KEY, JSON.stringify({ channelId, at: now })); else localStorage.removeItem(KEY) } catch { /* private mode */ }
}

export function recallCall(now = Date.now()): { channelId: string; at: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { channelId?: unknown; at?: unknown } | null
    if (!v || typeof v.channelId !== 'string' || typeof v.at !== 'number') return null
    if (now - v.at > RESTORE_MS || v.at > now + 60_000) { localStorage.removeItem(KEY); return null }
    return { channelId: v.channelId, at: v.at }
  } catch { return null }
}
