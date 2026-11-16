import { ChevronRight, ExternalLink } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { NO_FOLLOWS } from '../lib/communities'
import { linkHost, safeLink } from '../lib/communityPage'
import { anchorOf } from '../lib/anchor'
import { colorFor, initials, renderMarkdown } from '../lib/format'
import { useT } from '../lib/i18n'
import { relativeTime } from '../lib/ua'
import type { Channel, Community, CommunityManagers } from '../lib/types'
import { useStore } from '../store'
import Avatar from './Avatar'
import { chanIcon } from './ChannelSidebar'
import { MobileBack } from './HeaderBits'

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'failed' } | { state: 'ready'; community: Community }

/** A community's page in the main pane: who it is, what it is about, where to go in it and who looks after it. */
export default function CommunityPage({ guildId, slug }: { guildId: string; slug: string }) {
  const t = useT()
  const navigate = useNavigate()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [managers, setManagers] = useState<CommunityManagers | null>(null)
  const followed = useStore((s) => s.communityFollows[guildId]) ?? NO_FOLLOWS
  // The slim record the gateway keeps current: a change to it (rename, new description) refetches the full page, and
  // its removal means the community was deleted.
  const slim = useStore((s) => s.communities[guildId]?.find((c) => c.slug === slug))
  const [retry, setRetry] = useState(0)
  const seq = useRef(0)
  const seen = useRef<string | null>(null)

  useEffect(() => {
    const id = ++seq.current
    api.get<Community>(`/guilds/${guildId}/communities/${slug}`)
      .then((community) => { if (id === seq.current) setLoad({ state: 'ready', community }) })
      .catch((e) => { if (id === seq.current) setLoad({ state: e instanceof ApiError && e.status === 404 ? 'missing' : 'failed' }) })
    return () => { seq.current++ }
  }, [guildId, slug, slim, retry])

  // Another address: start over rather than showing the previous community while the next loads.
  useEffect(() => { setLoad({ state: 'loading' }); setManagers(null); seen.current = null }, [guildId, slug])

  // Deleted while open (the store drops it on COMMUNITY_DELETE).
  useEffect(() => {
    if (slim) seen.current = slim.id
    else if (seen.current) { seq.current++; setLoad({ state: 'missing' }) }
  }, [slim])

  const loadedId = load.state === 'ready' ? load.community.id : null
  useEffect(() => {
    if (!loadedId) return
    let live = true
    api.get<CommunityManagers>(`/guilds/${guildId}/communities/${slug}/managers`).then((m) => { if (live) setManagers(m) }).catch(() => { if (live) setManagers(null) })
    return () => { live = false }
  }, [guildId, slug, loadedId, slim])

  const goBack = useCallback(() => navigate(`/channels/${guildId}`), [guildId, navigate])

  if (load.state === 'missing') return <Missing onBack={goBack} />
  if (load.state === 'failed') return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-bg-2 p-8 text-center" data-community-failed>
      <p className="text-sm text-text-2">{t('Could not load this community.')}</p>
      <button type="button" className="btn-ghost" onClick={() => { setLoad({ state: 'loading' }); setRetry((n) => n + 1) }}>{t('Try again')}</button>
    </main>
  )
  if (load.state === 'loading') return <main className="flex-1 bg-bg-2" aria-busy="true" />
  const community = load.community
  const following = followed.includes(community.id)

  const toggleFollow = () => {
    const st = useStore.getState()
    // The store resolves a community by slug; make sure this one is known to it.
    if (!st.communities[guildId]?.some((x) => x.id === community.id)) st.upsertCommunity({ id: community.id, guild_id: community.guild_id, slug: community.slug, name: community.name, icon_url: community.icon_url, banner_url: community.banner_url, description: community.description, category_id: community.category_id })
    void st.followCommunity(guildId, community.slug, !following)
  }
  const followers = Math.max(0, community.follower_count + (following ? 1 : 0) - (community.following ? 1 : 0))

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-bg-2" data-community-page={community.slug}>
      <TopBar community={community} following={following} onFollow={toggleFollow} guildId={guildId} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Hero community={community} />
        <div className="mx-auto grid max-w-5xl gap-6 px-6 pb-10 pt-5 phone:px-4 wide:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <About text={community.about} />
            <Channels community={community} guildId={guildId} />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <Counts online={community.online_count} following={followers} />
            <Links links={community.links} />
            <Managers managers={managers} />
          </div>
        </div>
      </div>
    </main>
  )
}

function Missing({ onBack }: { onBack: () => void }) {
  const t = useT()
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-bg-2" data-community-missing>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 phone:px-2"><MobileBack /></header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="max-w-sm text-sm text-text-1">{t("This community no longer exists or you can't see it.")}</p>
        <button type="button" className="btn-primary" onClick={onBack} data-community-missing-back>{t('Back to the server')}</button>
      </div>
    </main>
  )
}

function Label({ children }: { children: string }) {
  return <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-2">{children}</h2>
}

function TopBar({ community, following, onFollow, guildId }: { community: Community; following: boolean; onFollow: () => void; guildId: string }) {
  const t = useT()
  const openModal = useStore((s) => s.openModal)
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 phone:px-2">
      <MobileBack />
      <button type="button" className="shrink-0 text-sm text-text-2 hover:text-text-0 phone:hidden" onClick={() => openModal({ kind: 'browseCommunities', guildId })}>{t('Communities')}</button>
      <ChevronRight size={14} className="shrink-0 text-text-2 phone:hidden" />
      <span className="min-w-0 flex-1 truncate font-bold">{community.name}</span>
      <button type="button" onClick={onFollow} aria-pressed={following} className={following ? 'btn-ghost border border-line' : 'btn-primary'} data-community-follow>{following ? t('Following') : t('Follow')}</button>
    </header>
  )
}

function Hero({ community }: { community: Community }) {
  const tint = colorFor(community.id)
  return (
    <div>
      <div className="h-24 w-full bg-cover bg-center" style={community.banner_url ? { backgroundImage: `url("${community.banner_url}")` } : { background: `linear-gradient(135deg, ${tint}, ${tint}55)` }} data-community-banner />
      <div className="mx-auto flex max-w-5xl items-end gap-4 px-6 phone:px-4">
        <div className="-mt-8 shrink-0">
          {community.icon_url
            ? <img src={community.icon_url} alt="" className="h-16 w-16 rounded-2xl border-4 border-bg-2 object-cover" />
            : <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-4 border-bg-2 text-xl font-bold text-white" style={{ background: tint }}>{initials(community.name)}</div>}
        </div>
        <div className="min-w-0 pt-2">
          <h1 className="truncate text-2xl font-bold leading-tight">{community.name}</h1>
          {community.description && <p className="text-sm text-text-2">{community.description}</p>}
        </div>
      </div>
    </div>
  )
}

function About({ text }: { text: string }) {
  const t = useT()
  if (!text.trim()) return null
  return (
    <section>
      <Label>{t('About')}</Label>
      <div className="break-words text-[15px] text-text-1" data-community-about>{renderMarkdown(text)}</div>
    </section>
  )
}

function Channels({ community, guildId }: { community: Community; guildId: string }) {
  const t = useT()
  const channels = useStore((s) => s.channels)
  const messages = useStore((s) => s.messages)
  const setMobilePane = useStore((s) => s.setMobilePane)
  const navigate = useNavigate()
  const rows = community.channel_ids.map((id) => channels[id]).filter((c): c is Channel => !!c)
  if (!rows.length) return null
  return (
    <section>
      <Label>{t('Channels')}</Label>
      <div className="overflow-hidden rounded-xl border border-line bg-bg-1">
        {rows.map((c) => {
          const last = messages[c.id]?.at(-1)
          const preview = last?.content.trim().replace(/\s+/g, ' ')
          return (
            <button key={c.id} type="button" onClick={() => { setMobilePane('content'); navigate(`/channels/${guildId}/${c.id}`) }}
              className="flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-bg-3" data-community-channel={c.id}>
              <span className="shrink-0 text-text-2">{chanIcon(c)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.name}</span>
                {preview && <span className="block truncate text-xs text-text-2">{preview}</span>}
              </span>
              {last && <span className="shrink-0 text-xs text-text-2">{relativeTime(last.created_at)}</span>}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function Counts({ online, following }: { online: number; following: number }) {
  const t = useT()
  return (
    <p className="flex items-center gap-1.5 text-sm text-text-1" data-community-counts>
      <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden />
      {t('{online} online · {following} following', { online, following })}
    </p>
  )
}

function Links({ links }: { links: Community['links'] }) {
  const t = useT()
  const safe = links.map((l) => ({ ...l, href: safeLink(l.url) })).filter((l): l is { label: string; url: string; href: string } => !!l.href)
  if (!safe.length) return null
  return (
    <section>
      <Label>{t('Links')}</Label>
      <ul className="flex flex-col gap-1.5">
        {safe.map((l, i) => (
          <li key={i} className="min-w-0">
            <a href={l.href} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-baseline gap-1.5 text-sm hover:underline" data-community-link>
              <span className="truncate font-medium text-accent">{l.label}</span>
              <ExternalLink size={12} className="shrink-0 self-center text-text-2" aria-hidden />
              <span className="truncate text-xs text-text-2">{linkHost(l.href)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Managers({ managers }: { managers: CommunityManagers | null }) {
  const t = useT()
  const openModal = useStore((s) => s.openModal)
  if (!managers || (!managers.members.length && !managers.roles.length)) return null
  return (
    <section data-community-managers>
      <Label>{t('Looked after by')}</Label>
      <ul className="flex flex-col gap-1">
        {managers.members.map((m) => (
          <li key={m.id}>
            <button type="button" data-motion-row onClick={(e) => openModal({ kind: 'profile', userId: m.id, anchor: anchorOf(e) })} className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-bg-3" data-community-manager={m.id}>
              <Avatar user={m} size={24} />
              <span className="min-w-0 truncate text-sm font-medium">{m.display_name}</span>
            </button>
          </li>
        ))}
        {managers.roles.map((r) => (
          <li key={r.id} className="truncate px-1 py-1 text-sm font-medium" style={r.color ? { color: r.color } : undefined} data-community-manager-role={r.id}>{r.name}</li>
        ))}
      </ul>
    </section>
  )
}
