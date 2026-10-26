import { Hash, MessageSquareText, Radio, Volume2, Disc3, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { dmName, isGroup } from '../../lib/dm'
import { colorFor, initials } from '../../lib/format'
import type { DmChannel } from '../../lib/types'
import { isUnread, useStore } from '../../store'
import Avatar from '../Avatar'
import GroupIcon from '../GroupIcon'

/** One place to jump to: a server channel, a DM or group, a friend without a DM yet, or a server. */
interface Hit { key: string; kind: 'channel' | 'voice' | 'dm' | 'friend' | 'guild'; label: string; sub?: string; go: () => void; icon: React.ReactNode; unread: boolean; mentions: number }

/** Prefixes, as in Discord: @ people, # text channels, ! voice channels, * servers. */
const PREFIX: Record<string, Hit['kind'][]> = { '@': ['dm', 'friend'], '#': ['channel'], '!': ['voice'], '*': ['guild'] }

/** How well `name` matches `q`: start of the name, start of a word, anywhere, then letters in order; 0 = no match. */
function score(name: string, q: string): number {
  if (!q) return 1
  const n = name.toLowerCase()
  if (n.startsWith(q)) return 100 - n.length / 100
  if (n.split(/[\s\-_]+/).some((w) => w.startsWith(q))) return 80 - n.length / 100
  if (n.includes(q)) return 60 - n.length / 100
  let i = 0
  for (const ch of n) { if (ch === q[i]) i++; if (i === q.length) return 30 - n.length / 100 }
  return 0
}

/** Quick Switcher (Ctrl+K): type to find any channel, conversation, friend or server and go there. */
export default function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const channels = useStore((s) => s.channels)
  const dms = useStore((s) => s.dms)
  const guilds = useStore((s) => s.guilds)
  const users = useStore((s) => s.users)
  const notes = useStore((s) => s.notes)
  const relationships = useStore((s) => s.relationships)
  const mentionCounts = useStore((s) => s.mentionCounts)
  const readStates = useStore((s) => s.readStates)
  const lastMessageId = useStore((s) => s.lastMessageId)
  const upsertChannel = useStore((s) => s.upsertChannel)
  const pushToast = useStore((s) => s.pushToast)
  const activeId = useStore((s) => s.activeChannelId)
  const [text, setText] = useState('')
  const [idx, setIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const all = useMemo<Hit[]>(() => {
    const out: Hit[] = []
    const go = (path: string) => () => { onClose(); navigate(path) }
    const unread = (id: string) => isUnread({ readStates, lastMessageId }, id)
    for (const c of Object.values(channels)) {
      if (!c.guild_id || c.kind === 'category' || c.kind === 'thread') continue
      const voice = c.kind === 'voice' || c.kind === 'stage' || c.kind === 'studio'
      const icon = c.kind === 'voice' ? <Volume2 size={18} /> : c.kind === 'stage' ? <Radio size={18} /> : c.kind === 'studio' ? <Disc3 size={18} /> : c.kind === 'forum' ? <MessageSquareText size={18} /> : <Hash size={18} />
      out.push({ key: c.id, kind: voice ? 'voice' : 'channel', label: c.name, sub: guilds[c.guild_id]?.name, go: go(`/channels/${c.guild_id}/${c.id}`), icon, unread: unread(c.id), mentions: mentionCounts[c.id] ?? 0 })
    }
    const withDm = new Set<string>()
    for (const d of Object.values(dms) as DmChannel[]) {
      if (d.request_state && d.request_state !== 'accepted') continue
      const group = isGroup(d)
      const other = !group ? d.recipients[0] : undefined
      if (other) withDm.add(other.id)
      out.push({ key: d.id, kind: 'dm', label: dmName(d, users, notes), sub: group ? `${d.recipients.length + 1} members` : other ? `@${other.username}` : undefined, go: go(`/channels/@me/${d.id}`),
        icon: group ? <GroupIcon dm={d} size={22} /> : other ? <Avatar user={users[other.id] ?? other} size={22} /> : <Users size={18} />, unread: unread(d.id), mentions: mentionCounts[d.id] ?? 0 })
    }
    for (const r of Object.values(relationships)) {
      if (r.kind !== 'friend' || withDm.has(r.user.id)) continue
      out.push({ key: `friend:${r.user.id}`, kind: 'friend', label: notes[r.user.id]?.nickname || r.user.display_name, sub: `@${r.user.username}`, icon: <Avatar user={r.user} size={22} />, unread: false, mentions: 0,
        go: async () => { onClose(); try { const c = await api.post<DmChannel>('/users/@me/channels', { recipient_id: r.user.id }); upsertChannel(c); navigate(`/channels/@me/${c.id}`) } catch (e) { pushToast((e as Error).message, 'error') } } })
    }
    for (const g of Object.values(guilds)) {
      out.push({ key: `guild:${g.id}`, kind: 'guild', label: g.name, sub: 'Server', go: go(`/channels/${g.id}`), unread: false, mentions: 0,
        icon: g.icon_url ? <img src={g.icon_url} alt="" className="h-[22px] w-[22px] rounded-md object-cover" /> : <span className="h-[22px] w-[22px] rounded-md text-[10px] font-bold text-white flex items-center justify-center" style={{ background: colorFor(g.id) }}>{initials(g.name)}</span> })
    }
    return out
  }, [channels, dms, guilds, users, notes, relationships, mentionCounts, readStates, lastMessageId, navigate, onClose, upsertChannel, pushToast])

  const prefix = PREFIX[text[0]]
  const q = (prefix ? text.slice(1) : text).trim().toLowerCase()
  const hits = useMemo(() => {
    const pool = all.filter((h) => (!prefix || prefix.includes(h.kind)) && h.key !== activeId)
    // With nothing typed: where something is waiting (mentions, then unread), then conversations.
    // With only a prefix: everything of that kind, A to Z.
    if (!q && prefix) return pool.sort((a, b) => b.mentions - a.mentions || a.label.localeCompare(b.label)).slice(0, 30)
    if (!q) return pool.filter((h) => h.mentions || h.unread || h.kind === 'dm').sort((a, b) => b.mentions - a.mentions || Number(b.unread) - Number(a.unread)).slice(0, 12)
    return pool.map((h) => ({ h, s: score(h.label, q) + (h.mentions ? 5 : h.unread ? 2 : 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 30).map((x) => x.h)
  }, [all, prefix, q, activeId])
  useEffect(() => setIdx(0), [text])
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-qs-index="${idx}"]`)?.scrollIntoView({ block: 'nearest' }) }, [idx])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); setIdx((i) => (hits.length ? (i + 1) % hits.length : 0)) }
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); setIdx((i) => (hits.length ? (i - 1 + hits.length) % hits.length : 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); hits[idx]?.go() }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-4 pt-[12vh] safe-pad" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} role="dialog" aria-modal aria-label="Quick switcher" data-quick-switcher>
      <div className="pop w-full max-w-xl rounded-xl border border-line bg-bg-1 p-4 shadow-2xl">
        <p className="mb-3 text-center text-sm font-semibold text-text-1">Search for servers, channels or DMs</p>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="Where would you like to go?" className="input h-12 text-lg" aria-label="Where would you like to go?" aria-activedescendant={hits[idx] ? `qs-${idx}` : undefined} data-qs-input />
        <div ref={listRef} className="mt-3 max-h-[50vh] overflow-y-auto" role="listbox" data-qs-results>
          {!q && hits.length > 0 && <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">{prefix ? 'Results' : 'Unread and recent'}</div>}
          {hits.map((h, i) => (
            <button key={h.key} id={`qs-${i}`} type="button" role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={h.go}
              className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left ${i === idx ? 'bg-bg-4 text-text-0' : 'text-text-1'}`} data-qs-index={i} data-qs-kind={h.kind} data-qs-key={h.key}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center text-text-2">{h.icon}</span>
              <span className={`min-w-0 truncate ${h.unread ? 'font-semibold text-text-0' : ''}`}>{h.label}</span>
              {h.sub && <span className="min-w-0 truncate text-xs text-text-2">{h.sub}</span>}
              {h.mentions > 0 && <span className="ml-auto min-w-4 h-4 shrink-0 rounded-full bg-danger px-1 text-[10px] font-bold text-white flex items-center justify-center">{h.mentions}</span>}
            </button>
          ))}
          {q && hits.length === 0 && <p className="px-2 py-6 text-center text-sm text-text-2">Nothing matches “{q}”.</p>}
        </div>
        <p className="mt-3 text-xs text-text-2">Start with <b>@</b> for people, <b>#</b> for text channels, <b>!</b> for voice channels or <b>*</b> for servers. ↑↓ to choose, Enter to go.</p>
      </div>
    </div>
  )
}
