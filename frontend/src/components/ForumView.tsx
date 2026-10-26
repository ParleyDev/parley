import { LayoutGrid, List, MessageSquareText, Pin, Plus, Search } from 'lucide-react'
import Emoji from './Emoji'
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
  const [sort, setSort] = useState<'activity' | 'created'>(channel.forum_sort === 'created' ? 'created' : 'activity')
  // Layout: the forum's default until you pick one (remembered per forum in this browser).
  const layoutKey = `parley.forumLayout.${channel.id}`
  const [layout, setLayoutState] = useState<'gallery' | 'list'>(() => { try { const v = localStorage.getItem(layoutKey); if (v === 'gallery' || v === 'list') return v } catch { /* ignore */ } return channel.forum_layout === 'list' ? 'list' : 'gallery' })
  const setLayout = (v: 'gallery' | 'list') => { setLayoutState(v); try { localStorage.setItem(layoutKey, v) } catch { /* ignore */ } }
  const [q, setQ] = useState('')
  const [guidelinesOpen, setGuidelinesOpen] = useState(true)
  const pushToast = useStore((s) => s.pushToast)
  const react = async (t: ThreadInfo) => {
    const emoji = channel.forum_default_reaction
    if (!emoji || !t.first_message_id) return
    try { await api.put(`/channels/${t.id}/messages/${t.first_message_id}/reactions/${encodeURIComponent(emoji)}`); pushToast(`Reacted ${emoji}`) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const [archived, setArchived] = useState(false)
  const [ids, setIds] = useState<string[] | null>(null)
  const channelVersion = useStore((s) => s.channels[channel.id])
  useEffect(() => { api.get<ForumTag[]>(`/channels/${channel.id}/tags`).then(setTags).catch(() => setTags([])) }, [channel.id, channelVersion])
  useEffect(() => {
    let live = true
    const t = setTimeout(() => api.get<ThreadInfo[]>(`/channels/${channel.id}/threads?archived=${archived}&sort=${sort}${tag ? `&tag=${tag}` : ''}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`).then((l) => { if (!live) return; l.forEach(upsertThread); setIds(l.map((t) => t.id)) }).catch(() => setIds([])), q ? 250 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [channel.id, tag, sort, archived, upsertThread, q])
  // New posts arrive as THREAD_UPDATE; show them without a refetch.
  const posts = Object.values(threads).filter((t) => t.parent_id === channel.id && (!!t.archived_at) === archived && (!tag || t.tags.includes(tag)) && (ids === null || ids.includes(t.id) || (!q.trim() && !ids.includes(t.id))))
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
        <span className="relative"><input className="input w-44 py-1.5 pl-7 text-sm" placeholder="Search posts" value={q} onChange={(e) => setQ(e.target.value)} data-forum-search /><Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-2" /></span>
        <span className="flex rounded-md border border-line" data-forum-layout={layout}>
          <button type="button" onClick={() => setLayout('gallery')} title="Gallery" className={`p-1.5 ${layout === 'gallery' ? 'bg-bg-4 text-text-0' : 'text-text-2'}`} data-forum-layout-pick="gallery"><LayoutGrid size={16} /></button>
          <button type="button" onClick={() => setLayout('list')} title="List" className={`p-1.5 ${layout === 'list' ? 'bg-bg-4 text-text-0' : 'text-text-2'}`} data-forum-layout-pick="list"><List size={16} /></button>
        </span>
        {tags.length > 0 && <span className="h-5 w-px bg-line mx-1" />}
        {tags.map((t) => <button key={t.id} type="button" onClick={() => setTag(tag === t.id ? null : t.id)} className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tag === t.id ? 'border-accent bg-accent/20 text-text-0' : 'border-line text-text-1 hover:bg-bg-3'}`} data-forum-tag={t.id} aria-pressed={tag === t.id}>{t.emoji} {t.name}</button>)}
      </div>
      {channel.topic && (
        <div className="mb-4 rounded-xl border border-line bg-bg-1 px-4 py-3" data-forum-guidelines-view>
          <button type="button" onClick={() => setGuidelinesOpen((o) => !o)} className="text-xs font-bold uppercase tracking-wider text-text-2">Post guidelines {guidelinesOpen ? '▾' : '▸'}</button>
          {guidelinesOpen && <p className="mt-1 whitespace-pre-wrap text-sm text-text-1">{channel.topic}</p>}
        </div>
      )}
      {ids === null && <p className="text-sm text-text-2">Loading…</p>}
      {ids !== null && posts.length === 0 && <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-text-2" data-forum-empty><MessageSquareText size={28} className="mx-auto mb-2 text-text-2" />No posts {archived ? 'archived' : 'yet'}. {has(perms, P.SEND_MESSAGES) && !archived ? 'Start the first one!' : ''}</div>}
      <div className={layout === 'list' ? 'flex flex-col gap-2' : 'grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]'}>
        {posts.map((t) => (
          <div key={t.id} role="button" tabIndex={0} onClick={() => setOpenThread(t.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenThread(t.id) }} className={`relative cursor-pointer rounded-xl border border-line bg-bg-1 text-left hover:border-text-2 flex flex-col gap-2 ${layout === 'list' ? 'p-3' : 'p-4 min-h-[120px]'}`} data-forum-post={t.id} data-forum-pinned={t.pinned_at ? '1' : '0'}>
            {channel.forum_default_reaction && t.first_message_id && <button type="button" onClick={(e) => { e.stopPropagation(); void react(t) }} className="absolute right-2 bottom-2 rounded-full border border-line bg-bg-2 px-2 py-0.5 text-sm hover:bg-bg-3" title={`React with ${channel.forum_default_reaction}`} data-forum-react={t.id}><Emoji value={channel.forum_default_reaction} size={16} /></button>}
            <div className="flex items-start gap-2">
              <span className="font-semibold leading-tight break-words flex-1" data-forum-post-title>{t.name}</span>
              {t.pinned_at && <Pin size={14} className="text-warn shrink-0 mt-0.5" />}
            </div>
            {t.preview && <p className={`text-sm text-text-1 break-words ${layout === 'list' ? 'line-clamp-1' : 'line-clamp-3'}`}>{t.preview}</p>}
            {t.tags.length > 0 && <div className="flex flex-wrap gap-1">{t.tags.map((id) => tagById[id]).filter(Boolean).map((tg) => <span key={tg.id} className="rounded-full bg-bg-3 px-2 py-0.5 text-[11px] font-semibold text-text-1" data-forum-post-tag={tg.id}>{tg.emoji} {tg.name}</span>)}</div>}
            <div className="mt-auto flex items-center gap-2 text-xs text-text-2"><span>@{t.owner_username ?? 'unknown'}</span><span>·</span><span>{t.message_count} message{t.message_count === 1 ? '' : 's'}</span><span>·</span><span>{relativeTime(t.last_message_at ?? t.created_at)}</span></div>
          </div>
        ))}
      </div>
    </div>
  )
}
