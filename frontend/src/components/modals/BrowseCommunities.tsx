import { Search, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { NO_FOLLOWS } from '../../lib/communities'
import { colorFor, initials } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { Community } from '../../lib/types'
import { useStore } from '../../store'
import Modal from '../Modal'

const PAGE = 50
interface Page { items: Community[]; next: string | null }

/** Browse a server's communities (most active first), search them, follow or unfollow, and open one. */
export default function BrowseCommunitiesModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const t = useT()
  const navigate = useNavigate()
  const guild = useStore((s) => s.guilds[guildId])
  const channels = useStore((s) => s.channels)
  const followed = useStore((s) => s.communityFollows[guildId]) ?? NO_FOLLOWS
  const pushToast = useStore((s) => s.pushToast)
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [items, setItems] = useState<Community[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  // Bumped by every new search and on unmount: an answer for an older search never replaces a newer one.
  const seq = useRef(0)

  useEffect(() => { const h = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(h) }, [q])

  const url = (after?: string | null) => `/guilds/${guildId}/communities?${new URLSearchParams({ sort: 'activity', limit: String(PAGE), ...(dq ? { q: dq } : {}), ...(after ? { after } : {}) })}`
  useEffect(() => {
    const id = ++seq.current
    setBusy(true); setFailed(false)
    api.get<Page>(url())
      .then((r) => { if (id === seq.current) { setItems(r.items); setNext(r.next); setLoaded(true) } })
      // The cards on screen answer an older query: drop them rather than leave them under this one.
      .catch(() => { if (id === seq.current) { setItems([]); setNext(null); setFailed(true) } })
      .finally(() => { if (id === seq.current) setBusy(false) })
    return () => { seq.current++ }
  }, [guildId, dq, retry]) // eslint-disable-line react-hooks/exhaustive-deps

  const more = async () => {
    const id = seq.current
    setBusy(true)
    try {
      const r = await api.get<Page>(url(next))
      if (id === seq.current) { setItems((cur) => [...cur, ...r.items.filter((c) => !cur.some((x) => x.id === c.id))]); setNext(r.next) }
    } catch (e) { if (id === seq.current) pushToast((e as Error).message, 'error') }
    if (id === seq.current) setBusy(false)
  }

  const toggle = (c: Community, following: boolean) => {
    const st = useStore.getState()
    // The store resolves a community by slug; make sure this one is known to it.
    const added = !st.communities[guildId]?.some((x) => x.id === c.id)
    if (added) st.upsertCommunity({ id: c.id, guild_id: c.guild_id, slug: c.slug, name: c.name, icon_url: c.icon_url, description: c.description, category_id: c.category_id })
    // A community that is gone (deleted meanwhile) must not stay in the store, or the sidebar's count is inflated.
    void st.followCommunity(guildId, c.slug, following).then((ok) => { if (!ok && added) useStore.getState().removeCommunity(guildId, c.id) })
  }
  // The first viewable text channel, else whatever the member can view first.
  const firstChannel = (c: Community) => c.channel_ids.find((id) => channels[id]?.kind === 'text') ?? c.channel_ids[0]
  const open = (c: Community) => { const ch = firstChannel(c); if (!ch) return; onClose(); navigate(`/channels/${guildId}/${ch}`) }

  if (!guild) return null
  return (
    <Modal title="Browse Communities" subtitle={guild.name} onClose={onClose} width="max-w-3xl">
      <div data-browse-communities-modal>
        <div className="relative mb-3">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-2" />
          <input className="input pl-9" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search communities')} aria-label={t('Search communities')} maxLength={100} data-community-search />
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {failed && <p className="py-8 text-center text-sm text-text-2" data-community-load-failed>{t("Couldn't load communities")} <button type="button" className="btn-ghost" onClick={() => setRetry((n) => n + 1)} data-community-retry>{t('Try again')}</button></p>}
          {loaded && !failed && items.length === 0 && <p className="py-8 text-center text-sm text-text-2" data-community-empty>{t('No communities match')}</p>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {items.map((c) => {
              const following = followed.includes(c.id)
              const empty = c.channel_ids.length === 0
              return (
                <div key={c.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-bg-1 p-3.5" data-community-card={c.slug}>
                  <button type="button" disabled={empty} onClick={() => open(c)} className="flex min-w-0 flex-1 flex-col gap-2 rounded-md text-left enabled:hover:opacity-90 disabled:cursor-default" data-community-open>
                    <span className="flex items-center gap-2.5 font-semibold">
                      {c.icon_url
                        ? <img src={c.icon_url} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
                        : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: colorFor(c.id) }}>{initials(c.name)}</span>}
                      <span className="min-w-0 truncate">{c.name}</span>
                    </span>
                    {c.description && <span className="line-clamp-3 text-[13px] text-text-1">{c.description}</span>}
                    {empty && <span className="text-xs italic text-text-2">{t('No channels yet')}</span>}
                  </button>
                  <div className="mt-auto flex items-center justify-between gap-2 text-xs text-text-2">
                    <span className="flex min-w-0 items-center gap-1 truncate"><Users size={12} className="shrink-0" />{t('{online} online · {following} following', { online: c.online_count, following: Math.max(0, c.follower_count + (following ? 1 : 0) - (c.following ? 1 : 0)) })}</span>
                    <button type="button" onClick={() => toggle(c, !following)} aria-pressed={following} className={`shrink-0 rounded-md px-2.5 py-1 font-semibold ${following ? 'border border-line text-text-2 hover:text-text-0' : 'bg-bg-3 text-text-0 hover:bg-bg-4'}`} data-community-follow-btn>{following ? t('Following') : t('Follow')}</button>
                  </div>
                </div>
              )
            })}
          </div>
          {next && <div className="mt-3 flex justify-center"><button type="button" className="btn-ghost" onClick={more} disabled={busy} data-community-more>{t('Load more')}</button></div>}
        </div>
      </div>
    </Modal>
  )
}
