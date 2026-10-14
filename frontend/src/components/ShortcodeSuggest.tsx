import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { customToken, loadEmojiGroups, searchEmoji, type EmojiGroup } from '../lib/emoji'
import { useStore } from '../store'
import Emoji from './Emoji'

export interface Suggestion { token: string; label: string }

/** The `:query` at the caret, if the user is typing a shortcode (2+ chars, at a word start). */
export function shortcodeAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = /(^|\s):([A-Za-z0-9_+-]{2,32})$/.exec(before)
  if (!m) return null
  return { start: caret - m[2].length - 1, query: m[2] }
}

/** Compute suggestions for a shortcode query from unicode + custom emoji (current server first). */
export function useShortcodeSuggestions(query: string | null, guildId: string | null | undefined, limit = 10): Suggestion[] {
  const [groups, setGroups] = useState<EmojiGroup[] | null>(null)
  useEffect(() => { if (query !== null && !groups) loadEmojiGroups().then(setGroups) }, [query, groups])
  const custom = useStore(useShallow((s) => {
    const ids = guildId ? [guildId, ...s.guildOrder.filter((g) => g !== guildId)] : s.guildOrder
    return ids.flatMap((g) => s.emojis[g] ?? [])
  }))
  return useMemo(() => {
    if (query === null || !groups) return []
    return searchEmoji(query, groups, custom, limit).map((r) => r.kind === 'custom' ? { token: customToken(r.emoji), label: `:${r.emoji.name}:` } : { token: r.emoji.emoji, label: `:${r.emoji.slug}:` })
  }, [query, groups, custom, limit])
}

/** Discord-style popup above the composer listing emoji whose shortcode matches what is being typed. */
export default function ShortcodeSuggest({ query, items, active, onPick, onHover, className = '' }: { query: string; items: Suggestion[]; active: number; onPick: (s: Suggestion) => void; onHover: (i: number) => void; className?: string }) {
  if (!items.length) return null
  return (
    <div className={`pop absolute z-40 rounded-lg bg-[#2b2d31] border border-white/10 shadow-2xl overflow-hidden ${className}`} role="listbox" data-shortcode-suggest>
      <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-text-2 border-b border-white/5">Emoji matching <span className="text-text-0">:{query}</span></div>
      <div className="p-1.5 max-h-[300px] overflow-y-auto">
        {items.map((s, i) => (
          <button key={s.token} type="button" role="option" aria-selected={i === active} data-suggestion={s.label}
            onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(s)} onMouseEnter={() => onHover(i)}
            className={`w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm ${i === active ? 'bg-white/10 text-text-0' : 'text-text-1'}`}>
            <Emoji value={s.token} size={22} /><span className="truncate">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
