import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Hash, AtSign } from 'lucide-react'
import { useStore } from '../store'
import { sortedRoles, EMPTY_ROLES } from '../lib/perms'
import Avatar from './Avatar'

export interface MentionItem { kind: 'user' | 'role' | 'channel' | 'everyone' | 'here'; id: string; label: string; sub?: string; color?: string | null; avatar?: { id: string; display_name: string; avatar_url: string | null } }

/** The `@query` or `#query` at the caret (letters, digits, _ . - and spaces inside names). */
export function mentionAt(text: string, caret: number): { start: number; trigger: '@' | '#'; query: string } | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)([@#])([A-Za-z0-9_.\- ]{0,32})$/.exec(before)
  if (!m) return null
  if (m[3].includes('  ')) return null
  return { start: caret - m[3].length - 1, trigger: m[2] as '@' | '#', query: m[3] }
}

/** Candidates for a mention query: members (or DM recipients), roles, channels of the current place. */
export function useMentionItems(trigger: '@' | '#' | null, query: string, channelId: string, guildId: string | null): MentionItem[] {
  const members = useStore(useShallow((s) => (guildId ? Object.values(s.members[guildId] ?? {}) : [])))
  const dm = useStore((s) => s.dms[channelId])
  const me = useStore((s) => s.user)
  const users = useStore((s) => s.users)
  const roles = useStore((s) => (guildId ? s.roles[guildId] ?? EMPTY_ROLES : EMPTY_ROLES))
  const channels = useStore(useShallow((s) => (guildId ? Object.values(s.channels).filter((c) => c.guild_id === guildId && c.kind === 'text') : [])))
  return useMemo(() => {
    if (!trigger) return []
    const q = query.trim().toLowerCase()
    const hit = (s: string) => !q || s.toLowerCase().includes(q)
    const out: MentionItem[] = []
    if (trigger === '#') {
      for (const c of channels) if (hit(c.name)) out.push({ kind: 'channel', id: c.id, label: c.name })
      return out.slice(0, 10)
    }
    if (guildId) {
      for (const m of members) { const name = m.nickname || m.display_name; if (hit(name) || hit(m.username)) out.push({ kind: 'user', id: m.user_id, label: name, sub: `@${m.username}`, avatar: { id: m.user_id, display_name: m.display_name, avatar_url: m.avatar_url } }) }
      for (const r of sortedRoles(roles)) if (r.id !== guildId && hit(r.name)) out.push({ kind: 'role', id: r.id, label: r.name, color: r.color })
      if (hit('everyone')) out.push({ kind: 'everyone', id: 'everyone', label: 'everyone', sub: 'Notify everyone in this channel' })
      if (hit('here')) out.push({ kind: 'here', id: 'here', label: 'here', sub: 'Notify everyone online in this channel' })
    } else if (dm) {
      const people = [...dm.recipients.map((r) => users[r.id] ?? r), ...(me ? [me] : [])]
      for (const u of people) if (hit(u.display_name) || hit(u.username)) out.push({ kind: 'user', id: u.id, label: u.display_name, sub: `@${u.username}`, avatar: { id: u.id, display_name: u.display_name, avatar_url: u.avatar_url } })
    }
    return out.slice(0, 10)
  }, [trigger, query, members, dm, me, users, roles, channels, guildId])
}

/** Popup listing mention candidates above the composer. */
export default function MentionSuggest({ items, active, trigger, query, onPick, onHover, className = '' }: { items: MentionItem[]; active: number; trigger: '@' | '#'; query: string; onPick: (i: MentionItem) => void; onHover: (i: number) => void; className?: string }) {
  if (!items.length) return null
  return (
    <div className={`pop absolute z-40 rounded-lg bg-[#2b2d31] border border-white/10 shadow-2xl overflow-hidden ${className}`} role="listbox" data-mention-suggest={trigger}>
      <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-text-2 border-b border-white/5">{trigger === '#' ? 'Channels' : 'Members'} matching <span className="text-text-0">{trigger}{query}</span></div>
      <div className="p-1.5 max-h-[300px] overflow-y-auto">
        {items.map((it, i) => (
          <button key={it.kind + it.id} type="button" role="option" aria-selected={i === active} data-mention-option={`${it.kind}:${it.label}`}
            onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(it)} onMouseEnter={() => onHover(i)}
            className={`w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm ${i === active ? 'bg-white/10 text-text-0' : 'text-text-1'}`}>
            {it.kind === 'user' && it.avatar ? <Avatar user={it.avatar} size={22} /> : it.kind === 'channel' ? <Hash size={18} className="text-text-2" /> : <AtSign size={18} style={{ color: it.color ?? undefined }} className={it.color ? '' : 'text-text-2'} />}
            <span className="truncate font-medium" style={it.kind === 'role' && it.color ? { color: it.color } : undefined}>{it.kind === 'channel' ? '#' : '@'}{it.label}</span>
            {it.sub && <span className="ml-auto truncate text-xs text-text-2">{it.sub}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Turn `@Name` / `#channel` / `@Role` text back into wire tokens for the names the user actually picked. */
export function applyMentions(text: string, picked: Record<string, MentionItem>): string {
  let out = text
  // Longest names first so "@Bob Smith" wins over "@Bob".
  const names = Object.keys(picked).sort((a, b) => b.length - a.length)
  for (const name of names) {
    const it = picked[name]
    const token = it.kind === 'user' ? `<@${it.id}>` : it.kind === 'role' ? `<@&${it.id}>` : it.kind === 'channel' ? `<#${it.id}>` : `@${it.kind}`
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`(^|[^\\w<])${esc}(?![\\w-])`, 'g'), (_m, pre) => `${pre}${token}`)
  }
  return out
}
