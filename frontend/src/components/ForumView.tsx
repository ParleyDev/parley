import { MessageSquareText, Pin, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Channel, ForumTag, ThreadInfo } from '../lib/types'
import { myChannelPerms, useStore } from '../store'
import { has, P } from '../lib/perms'
import { relativeTime } from '../lib/ua'

/** Main area of a forum channel: pinned-first post list with tag filter and sort, plus New Post. */
export default function ForumView({ channel }: { channel: Channel }) {
  const openModal = useStore((s) => s.openModal)
  const setOpenThread = useStore((s) => s.setOpenThread)
  const upsertThread = useStore((s) => s.upsertThread)
  const threads = useStore((s) => s.threads)
  const perms = useStore((s) => myChannelPerms(s, channel.id))
  const [tags, setTags] = useState<ForumTag[]>([])
  const [tag, setTag] = useState<string | null>(null)
  const [sort, setSort] = useState<'activity' | 'created'>('activity')
  const [archived, setArchived] = useState(false)
  const [ids, setIds] = useState<string[] | null>(null)
  const channelVersion = useStore((s) => s.channels[channel.id])
  useEffect(() => { api.get<ForumTag[]>(`/channels/${channel.id}/tags`).then(setTags).catch(() => setTags([])) }, [channel.id, channelVersion])
  useEffect(() => {
    let live = true
    api.get<ThreadInfo[]>(`/channels/${channel.id}/threads?archived=${archived}&sort=${sort}${tag ? `&tag=${tag}` : ''}`).then((l) => { if (!live) return; l.forEach(upsertThread); setIds(l.map((t) => t.id)) }).catch(() => setIds([]))
    return () => { live = false }
  }, [channel.id, tag, sort, archived, upsertThread])
  // New posts arrive as THREAD_UPDATE; show them without a refetch.
  const posts = Object.values(threads).filter((t) => t.parent_id === channel.id && (!!t.archived_at) === archived && (!tag || t.tags.includes(tag)) && (ids === null || ids.includes(t.id) || !ids.includes(t.id)))
    .sort((a, b) => (b.pinned_at ? 1 : 0) - (a.pinned_at ? 1 : 0) || (sort === 'created' ? b.created_at.localeCompare(a.created_at) : (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at)))
  const tagById = Object.fromEntries(tags.map((t) => [t.id, t]))
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 max-md:px-3" data-forum={channel.id}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {has(perms, P.SEND_MESSAGES) && <button type="button" className="btn-primary py-1.5" onClick={() => openModal({ kind: 'newPost', channelId: channel.id })} data-forum-new><Plus size={16} /> New Post</button>}
        <select className="input w-auto py-1.5 text-sm" value={sort} onChange={(e) => setSort(e.target.value as 'activity' | 'created')} data-forum-sort>
          <option value="activity">Latest activity</option>
          <option value="created">Newest posts</option>
        </select>
        <button type="button" onClick={() => setArchived((a) => !a)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${archived ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-forum-archived>{archived ? 'Showing archived' : 'Archived'}</button>
        {tags.length > 0 && <span className="h-5 w-px bg-line mx-1" />}
        {tags.map((t) => <button key={t.id} type="button" onClick={() => setTag(tag === t.id ? null : t.id)} className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tag === t.id ? 'border-accent bg-accent/20 text-text-0' : 'border-line text-text-1 hover:bg-bg-3'}`} data-forum-tag={t.id} aria-pressed={tag === t.id}>{t.emoji} {t.name}</button>)}
      </div>
      {ids === null && <p className="text-sm text-text-2">Loading…</p>}
      {ids !== null && posts.length === 0 && <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-text-2" data-forum-empty><MessageSquareText size={28} className="mx-auto mb-2 text-text-2" />No posts {archived ? 'archived' : 'yet'}. {has(perms, P.SEND_MESSAGES) && !archived ? 'Start the first one!' : ''}</div>}
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
        {posts.map((t) => (
          <button key={t.id} type="button" onClick={() => setOpenThread(t.id)} className="rounded-xl border border-line bg-bg-1 p-4 text-left hover:border-text-2 flex flex-col gap-2 min-h-[120px]" data-forum-post={t.id} data-forum-pinned={t.pinned_at ? '1' : '0'}>
            <div className="flex items-start gap-2">
              <span className="font-semibold leading-tight break-words flex-1" data-forum-post-title>{t.name}</span>
              {t.pinned_at && <Pin size={14} className="text-warn shrink-0 mt-0.5" />}
            </div>
            {t.preview && <p className="text-sm text-text-1 line-clamp-3 break-words">{t.preview}</p>}
            {t.tags.length > 0 && <div className="flex flex-wrap gap-1">{t.tags.map((id) => tagById[id]).filter(Boolean).map((tg) => <span key={tg.id} className="rounded-full bg-bg-3 px-2 py-0.5 text-[11px] font-semibold text-text-1" data-forum-post-tag={tg.id}>{tg.emoji} {tg.name}</span>)}</div>}
            <div className="mt-auto flex items-center gap-2 text-xs text-text-2"><span>@{t.owner_username ?? 'unknown'}</span><span>·</span><span>{t.message_count} message{t.message_count === 1 ? '' : 's'}</span><span>·</span><span>{relativeTime(t.last_message_at ?? t.created_at)}</span></div>
          </button>
        ))}
      </div>
    </div>
  )
}
