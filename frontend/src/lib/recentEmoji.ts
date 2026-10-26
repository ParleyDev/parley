import { STORAGE_PREFIX } from './brand'

const KEY = `${STORAGE_PREFIX}recentEmoji`
const DEFAULT = ['❤️', '👍', '😂', '🔥', '👀', '🎉']

function load(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}

/** Remember an emoji was used (reactions, composer picker) so the hover bar can offer it. */
export function recordEmoji(e: string) {
  const m = load(); m[e] = (m[e] ?? 0) + 1
  try { localStorage.setItem(KEY, JSON.stringify(m)) } catch { /* ignore */ }
}

/** The three most-used emoji, padded with defaults. */
export function frequentEmoji(n = 3): string[] {
  const m = load()
  const top = Object.entries(m).sort((a, b) => b[1] - a[1]).map(([e]) => e)
  const out: string[] = []
  for (const e of [...top, ...DEFAULT]) { if (!out.includes(e)) out.push(e); if (out.length === n) break }
  return out
}

const FAV_KEY = `${STORAGE_PREFIX}favEmoji`

/** Favourite emoji (star them in the picker), in the order they were added. */
export function favoriteEmoji(): string[] {
  try { const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

export function toggleFavoriteEmoji(e: string): string[] {
  const cur = favoriteEmoji()
  const next = cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]
  try { localStorage.setItem(FAV_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  return next
}
