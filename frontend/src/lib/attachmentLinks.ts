// Attachment links are signed by the server and run out after a day or two, so a copied link does not stay good
// for ever. A conversation left open for longer than that would be left holding dead links (pictures not yet
// scrolled to, files not yet downloaded), so the app trades them for fresh ones shortly before they expire.
import { api } from './api'
import { useStore } from '../store'
import type { Attachment, Message } from './types'

/** When a signed attachment link stops working (ms since the epoch); 0 for an attachment link with no signature. */
export function linkExpiry(url: string): number | null {
  if (!url.startsWith('/api/attachments/')) return null
  const ex = /[?&]ex=([0-9a-f]+)/.exec(url)?.[1]
  return ex ? parseInt(ex, 16) * 1000 : 0
}

/** Links are replaced once they have less than this left. */
const MARGIN = 3 * 3600_000
const stale = (a: Attachment, now: number) => { const ex = linkExpiry(a.url); return ex !== null && ex - now < MARGIN }

interface Fresh { id: string; url: string; thumb_url: string | null }
let busy = false

/** Replace the links of loaded messages' attachments that are about to run out. Returns how many were replaced. */
export async function refreshAttachmentLinks(now = Date.now()): Promise<number> {
  if (busy) return 0
  const ids = new Set<string>()
  for (const list of Object.values(useStore.getState().messages)) for (const m of list) {
    for (const a of m.attachments ?? []) if (stale(a, now)) ids.add(a.id)
    for (const a of m.referenced?.attachments ?? []) if (stale(a, now)) ids.add(a.id)
  }
  if (!ids.size) return 0
  busy = true
  try {
    const fresh = new Map<string, Fresh>()
    const all = [...ids]
    for (let i = 0; i < all.length; i += 500) for (const f of await api.post<Fresh[]>('/attachments/urls', { ids: all.slice(i, i + 500) })) fresh.set(f.id, f)
    if (!fresh.size) return 0
    const swap = (a: Attachment): Attachment => { const f = fresh.get(a.id); return f ? { ...a, url: f.url, thumb_url: f.thumb_url ?? undefined } : a }
    const touched = (list?: Attachment[]) => !!list?.some((a) => fresh.has(a.id))
    useStore.setState((s) => {
      const messages: Record<string, Message[]> = {}
      for (const [cid, list] of Object.entries(s.messages)) {
        messages[cid] = list.some((m) => touched(m.attachments) || touched(m.referenced?.attachments))
          ? list.map((m) => (touched(m.attachments) || touched(m.referenced?.attachments) ? { ...m, attachments: m.attachments?.map(swap), referenced: m.referenced && m.referenced.attachments ? { ...m.referenced, attachments: m.referenced.attachments.map(swap) } : m.referenced } : m))
          : list
      }
      return { messages }
    })
    return fresh.size
  } catch { return 0 } finally { busy = false }
}

let started = false
/** Keep loaded conversations' attachment links fresh: every quarter of an hour, and when the app comes back into view. */
export function startAttachmentLinkRefresh() {
  if (started) return
  started = true
  setInterval(() => void refreshAttachmentLinks(), 15 * 60_000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshAttachmentLinks() })
}
