import { ImageIcon, LayoutGrid, List, MessageSquareText, Pin, Plus, Search } from 'lucide-react'
import Emoji from './Emoji'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Channel, ForumTag, ThreadInfo } from '../lib/types'
import { myChannelPerms, useStore } from '../store'
import { has, P } from '../lib/perms'
import { relativeTime } from '../lib/ua'
import { useT } from '../lib/i18n'

/** Main area of a forum channel: pinned-first post list with tag filter and sort, plus New Post. */
export default function ForumView({ channel }: { channel: Channel }) {
  const t = useT()
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
  const react = async (th: ThreadInfo) => {
    const emoji = channel.forum_default_reaction
    if (!emoji || !th.first_message_id) return
    try { await api.put(`/channels/${th.id}/messages/${th.first_message_id}/reactions/${encodeURIComponent(emoji)}`); pushToast(t('Reacted {emoji}', { emoji })) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const [archived, setArchived] = useState(false)
  const [ids, setIds] = useState<string[] | null>(null)
  const channelVersion = useStore((s) => s.channels[channel.id])
  useEffect(() => { api.get<ForumTag[]>(`/channels/${channel.id}/tags`).then(setTags).catch(() => setTags([])) }, [channel.id, channelVersion])
  useEffect(() => {
    let live = true
    const th = setTimeout(() => api.get<ThreadInfo[]>(`/channels/${channel.id}/threads?archived=${archived}&sort=${sort}${tag ? `&tag=${tag}` : ''}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`).then((l) => { if (!live) return; l.forEach(upsertThread); setIds(l.map((th) => th.id)) }).catch(() => setIds([])), q ? 250 : 0)
    return () => { live = false; clearTimeout(th) }
  }, [channel.id, tag, sort, archived, upsertThread, q])
  // New posts arrive as THREAD_UPDATE; show them without a refetch.
  const posts = Object.values(threads).filter((th) => th.parent_id === channel.id && (!!th.archived_at) === archived && (!tag || th.tags.includes(tag)) && (ids === null || ids.includes(th.id) || (!q.trim() && !ids.includes(th.id))))
    .sort((a, b) => (b.pinned_at ? 1 : 0) - (a.pinned_at ? 1 : 0) || (sort === 'created' ? b.created_at.localeCompare(a.created_at) : (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at)))
  const tagById = Object.fromEntries(tags.map((th) => [th.id, th]))
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 max-md:px-3" data-forum={channel.id}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {has(perms, P.SEND_MESSAGES) && <button type="button" className="btn-primary py-1.5" onClick={() => openModal({ kind: 'newPost', channelId: channel.id })} data-forum-new><Plus size={16} /> {t('New Post')}</button>}
        <select className="input w-auto py-1.5 text-sm" value={sort} onChange={(e) => setSort(e.target.value as 'activity' | 'created')} data-forum-sort>
          <option value="activity">{t('Latest activity')}</option>
          <option value="created">{t('Newest posts')}</option>
        </select>
        <button type="button" onClick={() => setArchived((a) => !a)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${archived ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-forum-archived>{archived ? t('Showing archived') : t('Archived')}</button>
        <span className="relative"><input className="input w-44 py-1.5 pl-7 text-sm" placeholder={t('Search posts')} value={q} onChange={(e) => setQ(e.target.value)} data-forum-search /><Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-2" /></span>
        <span className="flex rounded-md border border-line" data-forum-layout={layout}>
          <button type="button" onClick={() => setLayout('gallery')} title={t('Gallery')} className={`p-1.5 ${layout === 'gallery' ? 'bg-bg-4 text-text-0' : 'text-text-2'}`} data-forum-layout-pick="gallery"><LayoutGrid size={16} /></button>
          <button type="button" onClick={() => setLayout('list')} title={t('List')} className={`p-1.5 ${layout === 'list' ? 'bg-bg-4 text-text-0' : 'text-text-2'}`} data-forum-layout-pick="list"><List size={16} /></button>
        </span>
        {tags.length > 0 && <span className="h-5 w-px bg-line mx-1" />}
        {tags.map((th) => <button key={th.id} type="button" onClick={() => setTag(tag === th.id ? null : th.id)} className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tag === th.id ? 'border-accent bg-accent/20 text-text-0' : 'border-line text-text-1 hover:bg-bg-3'}`} data-forum-tag={th.id} aria-pressed={tag === th.id}>{th.emoji} {th.name}</button>)}
      </div>
      {channel.topic && (
        <div className="mb-4 rounded-xl border border-line bg-bg-1 px-4 py-3" data-forum-guidelines-view>
          <button type="button" onClick={() => setGuidelinesOpen((o) => !o)} className="text-xs font-bold uppercase tracking-wider text-text-2">{t('Post guidelines')} {guidelinesOpen ? '▾' : '▸'}</button>
          {guidelinesOpen && <p className="mt-1 whitespace-pre-wrap text-sm text-text-1">{channel.topic}</p>}
        </div>
      )}
      {ids === null && <p className="text-sm text-text-2">{t('Loading…')}</p>}
      {ids !== null && posts.length === 0 && <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-text-2" data-forum-empty><MessageSquareText size={28} className="mx-auto mb-2 text-text-2" />{archived ? t('No posts archived.') : t('No posts yet.')} {has(perms, P.SEND_MESSAGES) && !archived ? t('Start the first one!') : ''}</div>}
      {channel.media && layout === 'gallery' ? (
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]" data-media-grid>
          {posts.map((th) => (
            <button key={th.id} type="button" onClick={() => setOpenThread(th.id)} className="group relative aspect-square overflow-hidden rounded-xl border border-line bg-bg-1 text-left" data-forum-post={th.id} data-media-tile={th.id}>
              {th.cover_url ? (th.cover_type?.startsWith('video/') && !th.cover_url.includes('/thumb') ? <video src={th.cover_url} muted className="h-full w-full object-cover" /> : <img src={th.cover_url} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" data-media-cover />) : <span className="flex h-full items-center justify-center text-text-2"><ImageIcon size={32} /></span>}
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6 text-sm font-semibold text-white"><span className="line-clamp-2">{th.name}</span><span className="text-[11px] font-normal opacity-80">{th.message_count === 1 ? t('1 message') : t('{n} messages', { n: th.message_count })}</span></span>
              {th.pinned_at && <Pin size={14} className="absolute right-2 top-2 text-warn" />}
            </button>
          ))}
        </div>
      ) : (
      <div className={layout === 'list' ? 'flex flex-col gap-2' : 'grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]'}>
        {posts.map((th) => (
          <div key={th.id} role="button" tabIndex={0} onClick={() => setOpenThread(th.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenThread(th.id) }} className={`relative cursor-pointer rounded-xl border border-line bg-bg-1 text-left hover:border-text-2 flex flex-col gap-2 ${layout === 'list' ? 'p-3' : 'p-4 min-h-[120px]'}`} data-forum-post={th.id} data-forum-pinned={th.pinned_at ? '1' : '0'}>
            {channel.forum_default_reaction && th.first_message_id && <button type="button" onClick={(e) => { e.stopPropagation(); void react(th) }} className="absolute right-2 bottom-2 rounded-full border border-line bg-bg-2 px-2 py-0.5 text-sm hover:bg-bg-3" title={t('React with {emoji}', { emoji: channel.forum_default_reaction })} data-forum-react={th.id}><Emoji value={channel.forum_default_reaction} size={16} /></button>}
            <div className="flex items-start gap-2">
              <span className="font-semibold leading-tight break-words flex-1" data-forum-post-title>{th.name}</span>
              {th.pinned_at && <Pin size={14} className="text-warn shrink-0 mt-0.5" />}
            </div>
            {th.preview && <p className={`text-sm text-text-1 break-words ${layout === 'list' ? 'line-clamp-1' : 'line-clamp-3'}`}>{th.preview}</p>}
            {th.tags.length > 0 && <div className="flex flex-wrap gap-1">{th.tags.map((id) => tagById[id]).filter(Boolean).map((tg) => <span key={tg.id} className="rounded-full bg-bg-3 px-2 py-0.5 text-[11px] font-semibold text-text-1" data-forum-post-tag={tg.id}>{tg.emoji} {tg.name}</span>)}</div>}
            <div className="mt-auto flex items-center gap-2 text-xs text-text-2"><span>@{th.owner_username ?? t('unknown')}</span><span>·</span><span>{th.message_count === 1 ? t('1 message') : t('{n} messages', { n: th.message_count })}</span><span>·</span><span>{relativeTime(th.last_message_at ?? th.created_at)}</span></div>
          </div>
        ))}
      </div>
      )}
    </div>
  )
}
