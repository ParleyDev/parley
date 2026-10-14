import type { Emoji } from './types'

/** The quick-pick grid used by the composer and the profile popout's message box. */
export const QUICK_EMOJI = ['😀', '😂', '😍', '🔥', '👍', '🎉', '😢', '🤔', '👀', '❤️', '🚀', '✨', '💯', '🙏', '😎', '🥳']

/** A unicode emoji with its CLDR shortcode plus Discord/GitHub-style aliases (`smile`, `joy`, `+1`…). */
export interface UnicodeEmoji { emoji: string; slug: string; aliases: string[] }
export interface EmojiGroup { name: string; emojis: UnicodeEmoji[] }

let groupsPromise: Promise<EmojiGroup[]> | null = null
let groupsCache: EmojiGroup[] | null = null

/** The full unicode set (≈1,900 emoji in 9 groups), loaded on first use as its own chunk. */
export function loadEmojiGroups(): Promise<EmojiGroup[]> {
  if (!groupsPromise) {
    groupsPromise = Promise.all([import('../data/emoji.json'), import('../data/emojiAliases.json')]).then(([m, a]) => {
      const raw = (m.default ?? m) as { n: string; e: [string, string][] }[]
      const aliases = (a.default ?? a) as Record<string, string[]>
      groupsCache = raw.map((g) => ({ name: g.n, emojis: g.e.map(([emoji, slug]) => ({ emoji, slug, aliases: aliases[emoji] ?? [] })) }))
      return groupsCache
    })
  }
  return groupsPromise
}
export const emojiGroupsSync = () => groupsCache

/** Custom emoji tokens as they appear in message text and reaction keys: `<:name:id>` / `<a:name:id>`. */
const CUSTOM_RE = /^<(a?):([A-Za-z0-9_]{2,32}):([0-9a-f-]{36})>$/
export const CUSTOM_TOKEN_SRC = '<a?:[A-Za-z0-9_]{2,32}:[0-9a-f-]{36}>'

export function parseCustom(token: string): { animated: boolean; name: string; id: string } | null {
  const m = CUSTOM_RE.exec(token)
  return m ? { animated: m[1] === 'a', name: m[2], id: m[3] } : null
}
export const customToken = (e: Pick<Emoji, 'id' | 'name' | 'animated'>) => `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`
export const customUrl = (id: string) => `/api/images/${id}`

const PICTO_SRC = '(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator})(?:\\uFE0F|\\u20E3|\\p{Emoji_Modifier}|\\u200D(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator}))*'
const ONLY_EMOJI_RE = new RegExp(`^(?:\\s|${PICTO_SRC}|${CUSTOM_TOKEN_SRC})+$`, 'u')
const COUNT_RE = new RegExp(`${PICTO_SRC}|${CUSTOM_TOKEN_SRC}`, 'gu')

/** Discord shows up to 30 emoji with nothing else as "jumbo" (large) emoji. */
export function isJumbo(content: string): boolean {
  if (!content.trim() || !ONLY_EMOJI_RE.test(content)) return false
  const n = content.match(COUNT_RE)?.length ?? 0
  return n > 0 && n <= 30
}

export type EmojiMatch = { kind: 'custom'; emoji: Emoji; name: string } | { kind: 'unicode'; emoji: UnicodeEmoji; name: string }

/** Search unicode + custom emoji by shortcode; `name` is the shortcode (slug or alias) that matched. */
export function searchEmoji(q: string, groups: EmojiGroup[], custom: Emoji[], limit = 60): EmojiMatch[] {
  const needle = q.trim().toLowerCase().replace(/^:|:$/g, '').replace(/\s+/g, '_')
  if (!needle) return []
  const starts: EmojiMatch[] = [], contains: EmojiMatch[] = []
  for (const e of custom) {
    const n = e.name.toLowerCase()
    if (n.startsWith(needle)) starts.push({ kind: 'custom', emoji: e, name: e.name }); else if (n.includes(needle)) contains.push({ kind: 'custom', emoji: e, name: e.name })
  }
  outer: for (const g of groups) for (const e of g.emojis) {
    // Prefer the slug, then any alias, as the name shown for the match.
    const names = [e.slug, ...e.aliases]
    const pre = names.find((n) => n.startsWith(needle))
    if (pre) starts.push({ kind: 'unicode', emoji: e, name: pre })
    else { const sub = names.find((n) => n.includes(needle)); if (sub) contains.push({ kind: 'unicode', emoji: e, name: sub }) }
    if (starts.length >= limit) break outer
  }
  // Exact name first, then shorter shortcodes (`:fi` → fire before firefighter); custom emoji keep their place.
  const rank = (r: EmojiMatch) => (r.kind === 'custom' ? 0 : r.name === needle ? 1 : 1 + r.name.length)
  starts.sort((a, b) => rank(a) - rank(b))
  return [...starts, ...contains].slice(0, limit)
}
