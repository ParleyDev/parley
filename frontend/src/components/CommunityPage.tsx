import { ChevronDown, ChevronRight, ChevronUp, ExternalLink, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { NO_FOLLOWS } from '../lib/communities'
import { communityPath, linkHost, moveChannel, safeLink } from '../lib/communityPage'
import { splashBackground } from '../lib/splash'
import { splitCrop } from '../lib/crop'
import { colorFor, initials, renderMarkdown } from '../lib/format'
import { useT } from '../lib/i18n'
import { relativeTime } from '../lib/ua'
import type { Channel, Community, CommunityManagers as ManagersData } from '../lib/types'
import { useStore } from '../store'
import { chanIcon } from './ChannelSidebar'
import { CropLayer } from './CropImg'
import CommunityManagers from './CommunityManagers'
import CommunityPageEdit from './CommunityPageEdit'
import { MobileBack } from './HeaderBits'

/** What the last fetch found, for one address (`key`); an answer for another address counts as still loading. */
type Loaded = { key: string } & ({ state: 'failed' } | { state: 'missing'; wasEditing: boolean } | { state: 'ready'; community: Community })

/** A community's page in the main pane: who it is, what it is about, where to go in it and who looks after it. */
export default function CommunityPage({ guildId, slug }: { guildId: string; slug: string }) {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const key = `${guildId}/${slug}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  // A page that moved to a new address (renamed) stays on screen while the new address loads.
  const renamed = useRef<{ from: string; to: string } | null>(null)
  const load = loaded && (loaded.key === key || (loaded.state === 'ready' && renamed.current?.to === key && renamed.current.from === loaded.key)) ? loaded : null
  const [managers, setManagers] = useState<ManagersData | null>(null)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState('')
  const followed = useStore((s) => s.communityFollows[guildId]) ?? NO_FOLLOWS
  // The slim record the gateway keeps current: a change to it (rename, new description) refetches the full page, and
  // its removal means the community was deleted.
  const slim = useStore((s) => s.communities[guildId]?.find((c) => c.slug === slug))
  const [knownId, setKnownId] = useState<string | null>(null)
  const byId = useStore((s) => (knownId ? s.communities[guildId]?.find((c) => c.id === knownId) : undefined))
  const category = load?.state === 'ready' ? load.community.category_id : null
  // A change to the category's own permission entries or to what is in it (a channel added or removed) refetches too.
  // Compared by content: any permission change or reorder elsewhere in the server replaces the record without touching this page.
  const allChannels = useStore((s) => s.channels)
  const categoryRec = category ? allChannels[category] : undefined
  const entriesSig = useMemo(() => JSON.stringify([...(categoryRec?.overwrites ?? [])].sort((a, b) => a.id.localeCompare(b.id)).map((o) => [o.id, o.kind, o.allow, o.deny])), [categoryRec?.overwrites])
  const slimSig = JSON.stringify(slim ?? null)
  const kids = useMemo(() => (category ? Object.values(allChannels).filter((c) => c.parent_id === category).map((c) => c.id).sort().join() : ''), [allChannels, category])
  const [retry, setRetry] = useState(0)
  const seq = useRef(0)
  const editingRef = useRef(false)
  editingRef.current = editing
  const editBtn = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)

  useEffect(() => {
    const id = ++seq.current
    api.get<Community>(`/guilds/${guildId}/communities/${slug}`)
      .then((community) => { if (id === seq.current) setLoaded({ key, state: 'ready', community }) })
      // A failed refetch (a network blip) keeps showing the page that is already loaded; only a 404 replaces it.
      .catch((e) => { if (id === seq.current) setLoaded((cur) => (e instanceof ApiError && e.status === 404 ? { key, state: 'missing', wasEditing: editingRef.current } : cur && cur.key === key && cur.state === 'ready' ? cur : { key, state: 'failed' })) })
    return () => { seq.current++ }
  }, [guildId, slug, key, slimSig, retry, entriesSig, kids]) // eslint-disable-line react-hooks/exhaustive-deps

  // Another address: forget the previous page's manager list and the editing state, unless this is the same community
  // moving to a new address (renamed), where the editor keeps their draft.
  useEffect(() => {
    if (load?.state === 'ready') return
    setManagers(null); setEditing(false); setNotice(''); setKnownId(null)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Deleted while open (the store drops it on COMMUNITY_DELETE); renamed elsewhere (follow it to the new address).
  useEffect(() => { if (slim) setKnownId(slim.id) }, [slim?.id, key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!knownId) return
    if (!byId) { seq.current++; setLoaded({ key, state: 'missing', wasEditing: editingRef.current }) }
    else if (byId.slug !== slug) {
      renamed.current = { from: key, to: `${guildId}/${byId.slug}` }
      navigate(communityPath(guildId, byId.slug), { replace: true })
    }
  }, [knownId, byId, key, slug, guildId, navigate])

  const loadedId = load?.state === 'ready' ? load.community.id : null
  const loadManagers = useCallback(() => {
    const url = `/guilds/${guildId}/communities/${slug}/managers`
    return api.get<ManagersData>(url).then(setManagers).catch(() => { /* keep what is shown */ })
  }, [guildId, slug])
  useEffect(() => {
    if (!loadedId) return
    let live = true
    api.get<ManagersData>(`/guilds/${guildId}/communities/${slug}/managers`).then((m) => { if (live) setManagers(m) }).catch(() => { if (live) setManagers(null) })
    return () => { live = false }
  }, [guildId, slug, loadedId, slimSig, entriesSig]) // eslint-disable-line react-hooks/exhaustive-deps

  // The member lost the right to edit while editing: leave edit mode and say why.
  const canEdit = load?.state === 'ready' && load.community.can_edit
  useEffect(() => { if (editing && load?.state === 'ready' && !canEdit) { setEditing(false); setNotice(t('You can no longer edit this page.')) } }, [editing, canEdit, load, t])

  // A page just created opens in edit mode (`?edit=1`); the parameter is consumed so a reload shows the page itself.
  const wantsEdit = new URLSearchParams(location.search).get('edit') === '1'
  useEffect(() => {
    if (!wantsEdit || load?.state !== 'ready') return
    if (canEdit) setEditing(true)
    navigate(communityPath(guildId, slug), { replace: true })
  }, [wantsEdit, load?.state, canEdit, guildId, slug, navigate])

  // Leaving edit mode returns focus to the Edit button.
  useEffect(() => { if (wasEditing.current && !editing) editBtn.current?.focus(); wasEditing.current = editing }, [editing])

  const goBack = useCallback(() => navigate(`/channels/${guildId}`), [guildId, navigate])

  if (load?.state === 'missing') return <Missing onBack={goBack} wasEditing={load.wasEditing} />
  if (load?.state === 'failed') return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-bg-2 p-8 text-center" data-community-failed>
      <p className="text-sm text-text-2">{t('Could not load this community.')}</p>
      <button type="button" className="btn-ghost" onClick={() => { setLoaded(null); setRetry((n) => n + 1) }}>{t('Try again')}</button>
    </main>
  )
  if (!load || load.state !== 'ready') return <main className="flex-1 bg-bg-2" aria-busy="true" />
  const community = load.community
  const following = followed.includes(community.id)

  const toggleFollow = () => {
    const st = useStore.getState()
    // The store resolves a community by slug; make sure this one is known to it.
    const added = !st.communities[guildId]?.some((x) => x.id === community.id)
    if (added) st.upsertCommunity({ id: community.id, guild_id: community.guild_id, slug: community.slug, name: community.name, icon_url: community.icon_url, banner_url: community.banner_url, description: community.description, category_id: community.category_id })
    // A community that could not be followed (gone meanwhile) must not stay in the store.
    void st.followCommunity(guildId, community.slug, !following).then((ok) => { if (!ok && added) useStore.getState().removeCommunity(guildId, community.id) })
  }
  const followers = Math.max(0, community.follower_count + (following ? 1 : 0) - (community.following ? 1 : 0))
  const channelsNode = (guard?: (go: () => void) => void) => <Channels community={community} guildId={guildId} guard={guard} reorder={editing && community.can_edit} />
  const managersBlock = <CommunityManagers community={community} guildId={guildId} managers={managers} onChanged={() => { void loadManagers() }} />

  if (editing && community.can_edit) {
    return (
      <CommunityPageEdit community={community} guildId={guildId} channels={channelsNode} managers={managersBlock} onClose={() => setEditing(false)}
        onSaved={(updated) => {
          renamed.current = { from: key, to: `${guildId}/${updated.slug}` }
          setLoaded({ key, state: 'ready', community: updated })
          setEditing(false)
          const st = useStore.getState()
          st.upsertCommunity({ id: updated.id, guild_id: updated.guild_id, slug: updated.slug, name: updated.name, icon_url: updated.icon_url, banner_url: updated.banner_url, description: updated.description, category_id: updated.category_id })
          if (updated.slug !== slug) navigate(communityPath(guildId, updated.slug), { replace: true })
        }} />
    )
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-bg-2" data-community-page={community.slug}>
      <TopBar editRef={editBtn} community={community} following={following} onFollow={toggleFollow} guildId={guildId} onEdit={community.can_edit ? () => { setNotice(''); setEditing(true) } : undefined} />
      {notice && <p className="border-b border-line bg-bg-1 px-4 py-2 text-sm text-text-1" role="status" data-community-notice>{notice}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Hero community={community} />
        <div className="mx-auto grid max-w-5xl gap-6 px-6 pb-10 pt-5 phone:px-4 wide:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <About text={community.about} />
            {channelsNode()}
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <Counts online={community.online_count} following={followers} />
            <Links links={community.links} />
            {managersBlock}
          </div>
        </div>
      </div>
    </main>
  )
}

function Missing({ onBack, wasEditing }: { onBack: () => void; wasEditing: boolean }) {
  const t = useT()
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-bg-2" data-community-missing>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 phone:px-2"><MobileBack /></header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="max-w-sm text-sm text-text-1">{t("This community no longer exists or you can't see it.")}</p>
        {wasEditing && <p className="max-w-sm text-sm text-text-2" role="status" data-community-missing-note>{t('This community was deleted while you were editing.')}</p>}
        <button type="button" className="btn-primary" onClick={onBack} data-community-missing-back>{t('Back to the server')}</button>
      </div>
    </main>
  )
}

function Label({ children }: { children: string }) {
  return <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-2">{children}</h2>
}

function TopBar({ community, following, onFollow, guildId, onEdit, editRef }: { editRef: React.RefObject<HTMLButtonElement | null>; community: Community; following: boolean; onFollow: () => void; guildId: string; onEdit?: () => void }) {
  const t = useT()
  const openModal = useStore((s) => s.openModal)
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 phone:px-2">
      <MobileBack />
      <button type="button" className="shrink-0 text-sm text-text-2 hover:text-text-0 phone:hidden" onClick={() => openModal({ kind: 'browseCommunities', guildId })}>{t('Communities')}</button>
      <ChevronRight size={14} className="shrink-0 text-text-2 phone:hidden" />
      <span className="min-w-0 flex-1 truncate font-bold">{community.name}</span>
      {onEdit && <button type="button" className="btn-ghost border border-line" ref={editRef} onClick={onEdit} data-community-edit>{t('Edit')}</button>}
      <button type="button" onClick={onFollow} aria-pressed={following} className={following ? 'btn-ghost border border-line' : 'btn-primary'} data-community-follow>{following ? t('Following') : t('Follow')}</button>
    </header>
  )
}

function Hero({ community }: { community: Community }) {
  const tint = colorFor(community.id)
  return (
    <div>
      <div className="relative isolate h-24 w-full bg-cover bg-center" style={community.banner_url && !splitCrop(community.banner_url).crop ? { backgroundImage: splashBackground(community.banner_url) } : community.banner_url ? undefined : { background: `linear-gradient(135deg, ${tint}, ${tint}55)` }} data-community-banner>
        <CropLayer url={community.banner_url} />
      </div>
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

function Channels({ community, guildId, guard, reorder }: { community: Community; guildId: string; guard?: (go: () => void) => void; reorder?: boolean }) {
  const t = useT()
  const channels = useStore((s) => s.channels)
  const messages = useStore((s) => s.messages)
  const setMobilePane = useStore((s) => s.setMobilePane)
  const pushToast = useStore((s) => s.pushToast)
  const navigate = useNavigate()
  const openModal = useStore((s) => s.openModal)
  // In stored order, so a move (ours or someone else's) shows as soon as the store has it.
  const rows = community.channel_ids.map((id) => channels[id]).filter((c): c is Channel => !!c)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
  const moving = useRef(false)
  // Immediate, not part of Save: applied locally at once and put back, with the server's message, when it is refused.
  const move = async (id: string, dir: -1 | 1) => {
    if (moving.current) return
    const plan = moveChannel(rows.map((r) => ({ id: r.id, position: r.position })), id, dir)
    if (!plan) return
    moving.current = true
    const stored = useStore.getState().channels
    const before = Object.fromEntries(plan.items.map((i) => [i.id, stored[i.id]]))
    useStore.setState((s) => ({ channels: { ...s.channels, ...Object.fromEntries(plan.items.map((i) => [i.id, { ...s.channels[i.id], position: i.position }])) } }))
    try { await api.patch(`/guilds/${guildId}/channels/positions`, { items: plan.items }) } catch (e) {
      useStore.setState((s) => ({ channels: { ...s.channels, ...before } }))
      pushToast((e as Error).message, 'error')
    } finally { moving.current = false }
  }
  if (!rows.length && !community.can_edit) return null
  return (
    <section>
      <Label>{t('Channels')}</Label>
      <div className="overflow-hidden rounded-xl border border-line bg-bg-1">
        {rows.map((c, i) => {
          const last = messages[c.id]?.at(-1)
          const preview = last?.content.trim().replace(/\s+/g, ' ')
          return (
            <div key={c.id} className="flex items-center border-b border-line last:border-b-0 hover:bg-bg-3">
              <button type="button" onClick={() => { const go = () => { setMobilePane('content'); navigate(`/channels/${guildId}/${c.id}`) }; if (guard) guard(go); else go() }}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left" data-community-channel={c.id}>
                <span className="shrink-0 text-text-2">{chanIcon(c)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.name}</span>
                  {preview && <span className="block truncate text-xs text-text-2">{preview}</span>}
                </span>
                {last && <span className="shrink-0 text-xs text-text-2">{relativeTime(last.created_at)}</span>}
              </button>
              {reorder && (
                <span className="flex shrink-0 items-center pr-1">
                  <button type="button" className="rounded p-1 text-text-2 hover:bg-bg-4 hover:text-text-0 disabled:opacity-30" disabled={i === 0} onClick={() => void move(c.id, -1)} aria-label={t('Move {name} up', { name: c.name })} title={t('Move up')} data-channel-up={c.id}><ChevronUp size={16} aria-hidden /></button>
                  <button type="button" className="rounded p-1 text-text-2 hover:bg-bg-4 hover:text-text-0 disabled:opacity-30" disabled={i === rows.length - 1} onClick={() => void move(c.id, 1)} aria-label={t('Move {name} down', { name: c.name })} title={t('Move down')} data-channel-down={c.id}><ChevronDown size={16} aria-hidden /></button>
                </span>
              )}
            </div>
          )
        })}
      </div>
      {community.can_edit && <button type="button" onClick={() => openModal({ kind: 'createChannel', guildId, parentId: community.category_id, stay: true })} className="mt-2 flex items-center gap-1 text-sm font-medium text-accent hover:underline" data-community-add-channel><Plus size={14} aria-hidden />{t('Add channel')}</button>}
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
