import { CalendarDays, Flame, MessagesSquare, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { relativeTime } from '../../lib/ua'
import type { GuildEvent } from '../../lib/types'
import { useStore } from '../../store'
import Avatar from '../Avatar'
import Modal from '../Modal'
import { useT } from '../../lib/i18n'

interface Feed {
  top_messages: { id: string; channel_id: string; content: string; author: { id: string; display_name: string; avatar_url: string | null }; created_at: string; reactions: number }[]
  busy_threads: { id: string; parent_id: string | null; name: string; messages: number }[]
  new_members: { id: string; display_name: string; avatar_url: string | null; joined_at: string }[]
  events: GuildEvent[]
}

/** Server activity: this week's most-reacted messages, busy threads, upcoming events and newcomers. */
export default function ActivityModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const t = useT()
  const guild = useStore((s) => s.guilds[guildId])
  const channels = useStore((s) => s.channels)
  const openModal = useStore((s) => s.openModal)
  const setOpenThread = useStore((s) => s.setOpenThread)
  const navigate = useNavigate()
  const [feed, setFeed] = useState<Feed | null>(null)
  useEffect(() => { api.get<Feed>(`/guilds/${guildId}/activity`).then(setFeed).catch(() => setFeed({ top_messages: [], busy_threads: [], new_members: [], events: [] })) }, [guildId])
  const go = (cid: string, mid?: string) => { onClose(); navigate(`/channels/${guildId}/${cid}${mid ? `?message=${mid}` : ''}`) }
  const head = (icon: React.ReactNode, label: string) => <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-2">{icon}{label}</h3>
  return (
    <Modal title={t('Server Activity')} subtitle={guild?.name} onClose={onClose} width="max-w-lg">
      {!feed ? <p className="text-sm text-text-2">{t('Loading…')}</p> : (
        <div className="space-y-5" data-activity>
          <section data-activity-top>
            {head(<Flame size={13} />, t('Popular this week'))}
            {feed.top_messages.length === 0 ? <p className="text-sm text-text-2">{t('No reactions this week yet.')}</p> : feed.top_messages.map((m) => (
              <button key={m.id} type="button" onClick={() => go(m.channel_id, m.id)} className="mb-1.5 flex w-full items-start gap-2 rounded-lg border border-line bg-bg-1 p-2 text-left hover:bg-bg-3" data-activity-message={m.id}>
                <Avatar user={m.author} size={28} />
                <span className="min-w-0 flex-1"><span className="text-sm font-semibold">{m.author.display_name}</span> <span className="text-xs text-text-2">{t('in #{channel} · {when}', { channel: channels[m.channel_id]?.name ?? t('channel'), when: relativeTime(m.created_at) })}</span><span className="line-clamp-2 block text-sm text-text-1">{m.content || <i>{t('Attachment')}</i>}</span></span>
                <span className="shrink-0 rounded-full bg-bg-3 px-2 py-0.5 text-xs" title={t('Reactions')}>{m.reactions} ❤</span>
              </button>
            ))}
          </section>
          {feed.busy_threads.length > 0 && (
            <section data-activity-threads>
              {head(<MessagesSquare size={13} />, t('Busy threads'))}
              {feed.busy_threads.map((th) => <button key={th.id} type="button" onClick={() => { if (th.parent_id) go(th.parent_id); setOpenThread(th.id) }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-3" data-activity-thread={th.id}><span className="flex-1 truncate">{th.name}</span><span className="text-xs text-text-2">{t('{n} new', { n: th.messages })}</span></button>)}
            </section>
          )}
          {feed.events.length > 0 && (
            <section data-activity-events>
              {head(<CalendarDays size={13} />, t('Coming up'))}
              {feed.events.map((e) => <button key={e.id} type="button" onClick={() => openModal({ kind: 'events', guildId })} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-3"><span className="flex-1 truncate font-medium">{e.name}</span><span className="text-xs text-text-2">{e.status === 'active' ? t('Now') : new Date(e.starts_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span></button>)}
            </section>
          )}
          <section data-activity-members>
            {head(<UserPlus size={13} />, t('New members'))}
            <div className="flex flex-wrap gap-2">{feed.new_members.map((u) => <button key={u.id} type="button" onClick={(ev) => openModal({ kind: 'profile', userId: u.id, anchor: { x: ev.currentTarget.getBoundingClientRect().left, y: ev.currentTarget.getBoundingClientRect().top, w: 0, h: 0 } })} className="flex items-center gap-1.5 rounded-full bg-bg-3 py-0.5 pl-0.5 pr-2 text-xs hover:bg-bg-4" title={t('Joined {when}', { when: relativeTime(u.joined_at) })}><Avatar user={u} size={20} />{u.display_name}</button>)}</div>
          </section>
        </div>
      )}
    </Modal>
  )
}
