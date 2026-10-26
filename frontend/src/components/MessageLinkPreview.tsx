import { Hash, MessageSquare } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { Message } from '../lib/types'
import { useStore } from '../store'
import Avatar from './Avatar'
import { jumpToMessageAsync } from './ChatView'
import { publicOrigin } from './InviteCard'

export interface MessageLink { guildId: string | null; channelId: string; messageId: string }

const ID = '[0-9a-f-]{36}'

/** Links to messages on this instance in a message body (at most three): `/channels/<guild|@me>/<channel>?message=<id>` or `…/<channel>/<id>`. */
export function messageLinks(content: string): MessageLink[] {
  if (!content || !content.includes('/channels/')) return []
  const origins = Array.from(new Set([location.origin, publicOrigin()])).map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(?:${origins.join('|')})/channels/(@me|${ID})/(${ID})(?:\\?message=|/)(${ID})`, 'gi')
  const out: MessageLink[] = []
  for (const m of content.matchAll(re)) if (!out.some((l) => l.messageId === m[3])) out.push({ guildId: m[1] === '@me' ? null : m[1], channelId: m[2], messageId: m[3] })
  return out.slice(0, 3)
}

const cache = new Map<string, Promise<Message | null>>()

/** A quote card for a linked message: who wrote it, where, and the start of it; click to jump there. */
export default function MessageLinkPreview({ link }: { link: MessageLink }) {
  const [m, setM] = useState<Message | null | undefined>(undefined)
  const channel = useStore((s) => s.channels[link.channelId] ?? s.dms[link.channelId])
  const guild = useStore((s) => (link.guildId ? s.guilds[link.guildId] : undefined))
  const navigate = useNavigate()
  useEffect(() => {
    let live = true
    let p = cache.get(link.messageId)
    if (!p) { p = api.get<Message>(`/channels/${link.channelId}/messages/${link.messageId}`).catch(() => null); cache.set(link.messageId, p) }
    p.then((x) => { if (live) setM(x) })
    return () => { live = false }
  }, [link.channelId, link.messageId])
  if (!m) return null
  const where = channel?.guild_id ? `#${channel.name}${guild ? ` · ${guild.name}` : ''}` : 'Direct Message'
  const text = m.content || (m.attachments?.length ? `${m.attachments.length} attachment${m.attachments.length === 1 ? '' : 's'}` : m.poll ? `Poll: ${m.poll.question}` : '')
  const go = () => {
    navigate(`/channels/${link.guildId ?? '@me'}/${link.channelId}`)
    void jumpToMessageAsync(link.channelId, link.messageId)
  }
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); go() }} className="mt-1 flex w-full max-w-[520px] overflow-hidden rounded-lg border border-line bg-bg-1 text-left hover:border-text-2" data-message-link={link.messageId}>
      <span className="w-1 shrink-0 bg-text-2/50" aria-hidden />
      <span className="min-w-0 flex-1 p-3">
        <span className="flex items-center gap-1 text-[11px] text-text-2">{channel?.guild_id ? <Hash size={11} /> : <MessageSquare size={11} />}<span className="truncate">{where}</span></span>
        <span className="mt-1 flex items-center gap-2">
          <Avatar user={m.author} size={20} />
          <span className="font-semibold text-sm truncate" data-message-link-author>{m.author.display_name}</span>
          <span className="text-[11px] text-text-2 shrink-0">{new Date(m.created_at).toLocaleDateString()}</span>
        </span>
        {text && <span className="mt-1 block text-sm text-text-1 line-clamp-3 break-words whitespace-pre-wrap" data-message-link-text>{text}</span>}
      </span>
    </button>
  )
}
