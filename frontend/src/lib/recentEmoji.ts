import { STORAGE_PREFIX } from './brand'

const KEY = `${STORAGE_PREFIX}recentEmoji`
const DEFAULT = ['❤️', '👍', '😂']

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
