import { useMemo } from 'react'
import { useStore } from '../store'
import type { Channel, DmChannel } from '../lib/types'

const KEYS: { key: string; hint: string }[] = [
  { key: 'from:', hint: 'user' }, { key: 'mentions:', hint: 'user' }, { key: 'in:', hint: 'channel' }, { key: 'has:', hint: 'link, image, file, poll…' },
  { key: 'before:', hint: 'date' }, { key: 'during:', hint: 'date' }, { key: 'after:', hint: 'date' }, { key: 'pinned:', hint: 'true' },
]
const HAS = ['link', 'embed', 'image', 'video', 'file', 'sticker', 'poll', 'sound']
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10) }

/** Suggestions for the search box's last word: filter names, then people, channels, `has:` kinds or dates. */
export function useSearchSuggestions(query: string, channel: Channel | DmChannel): { label: string; detail?: string; value: string }[] {
  const members = useStore((s) => (channel.guild_id ? s.members[channel.guild_id] : undefined))
  const channels = useStore((s) => s.channels)
  return useMemo(() => {
    const last = query.split(/\s+/).pop() ?? ''
    const m = /^(\w+):(.*)$/.exec(last)
    if (!m) {
      if (!last && query) return []
      return KEYS.filter((k) => k.key.startsWith(last.toLowerCase())).map((k) => ({ label: k.key, detail: k.hint, value: k.key }))
    }
    const [, key, v] = m, lv = v.toLowerCase()
    if (key === 'from' || key === 'mentions') {
      const people = channel.guild_id ? Object.values(members ?? {}).map((x) => ({ username: x.username, name: x.nickname ?? x.display_name })) : (channel as DmChannel).recipients.map((r) => ({ username: r.username, name: r.display_name }))
      return people.filter((p) => p.username.toLowerCase().startsWith(lv) || p.name.toLowerCase().startsWith(lv)).slice(0, 8).map((p) => ({ label: p.name, detail: `@${p.username}`, value: `${key}:${p.username}` }))
    }
    if (key === 'in' && channel.guild_id) return Object.values(channels).filter((c) => c.guild_id === channel.guild_id && (c.kind === 'text' || c.kind === 'voice') && c.name.toLowerCase().startsWith(lv)).slice(0, 8).map((c) => ({ label: `#${c.name}`, value: `in:${c.name}` }))
    if (key === 'has') return HAS.filter((h) => h.startsWith(lv)).map((h) => ({ label: h, value: `has:${h}` }))
    if (key === 'before' || key === 'after' || key === 'during') return [{ label: 'today', detail: day(0), value: `${key}:${day(0)}` }, { label: 'yesterday', detail: day(-1), value: `${key}:${day(-1)}` }, { label: 'a week ago', detail: day(-7), value: `${key}:${day(-7)}` }].filter((d) => d.detail.startsWith(v) || !v)
    if (key === 'pinned') return [{ label: 'true', value: 'pinned:true' }]
    return []
  }, [query, channel, members, channels])
}

/** Replace the last word of the query with a suggestion (a filter name keeps the cursor after the colon). */
export const applySuggestion = (query: string, value: string) => { const parts = query.split(/(\s+)/); parts[parts.length - 1] = value; return parts.join('') + (value.endsWith(':') ? '' : ' ') }
