import { useShallow } from 'zustand/react/shallow'
import { anchorOf } from '../lib/anchor'
import { CalendarDays, ChevronDown, ChevronsDownUp, ChevronsUpDown, Copy, Disc3, FolderPlus, Hash, MessageSquareText, HeadphoneOff, Link2, LogOut, MailCheck, MicOff, Pencil, Plus, Radio, Settings, Trash2, UserPlus, Video, Volume2, ShieldCheck, Lock } from 'lucide-react'
import ContextMenu, { useContextMenu, type MenuEntry } from './ContextMenu'
import { useUserMenu } from './UserContextMenu'
import Avatar from './Avatar'
import { useRef, useState, type DragEvent, useEffect } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { isUnread, myChannelPerms, myGuildPerms, showsMentions, showsUnread, useStore, voiceParticipants } from '../store'
import { notifEntries } from './NotifMenu'
import { mutedTarget } from '../lib/notify'
import { BellOff } from 'lucide-react'
import { has, P } from '../lib/perms'
import StyledName from './StyledName'
import { api } from '../lib/api'
import { getPrefs } from '../lib/prefs'
import type { Channel } from '../lib/types'
import { STORAGE_PREFIX } from '../lib/brand'
import { useT } from '../lib/i18n'

export default function ChannelSidebar({ guildId }: { guildId: string }) {
  const t = useT()
  const guild = useStore((s) => s.guilds[guildId])
  const channels = useStore((s) => s.channels)
  const readStates = useStore((s) => s.readStates)
  const lastMessageId = useStore((s) => s.lastMessageId)
  const user = useStore((s) => s.user)
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const removeGuild = useStore((s) => s.removeGuild)
  const setMobilePane = useStore((s) => s.setMobilePane)
  const navigate = useNavigate()
  const { channelId } = useParams()
  const [menu, setMenu] = useState(false)
  const markRead = useStore((s) => s.markRead)
  const allGuilds = useStore((s) => s.guilds)
  const voiceStates = useStore((s) => s.voiceStates)
  const mentionCounts = useStore((s) => s.mentionCounts)
  const notifSettings = useStore((s) => s.notifSettings)
  const dms = useStore((s) => s.dms)
  const ctx = useContextMenu()
  const userMenu = useUserMenu(guildId)
  const perms = useStore((s) => myGuildPerms(s, guildId))
  const chanPerms = useStore(useShallow((s) => Object.fromEntries(Object.values(s.channels).filter((c) => c.guild_id === guildId).map((c) => [c.id, myChannelPerms(s, c.id)])) as Record<string, number>))
  // Hooks stay above the early return so the hook count never changes (e.g. when the server vanishes).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}collapsed.${guildId}`) || '{}') } catch { return {} } })
  const toggleCollapsed = (id: string) => setCollapsed((c) => { const n = { ...c, [id]: !c[id] }; try { localStorage.setItem(`${STORAGE_PREFIX}collapsed.${guildId}`, JSON.stringify(n)) } catch { /* ignore */ } return n })
  // Drag and drop. One handler on the whole list works out a single insertion point from the pointer (see dropTarget),
  // so there are no overlapping per-row targets to flicker between and no gaps that mean something else.
  const [drag, setDrag] = useState<string | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  if (!guild) return null
  const isOwner = user?.id === guild.owner_id
  const canInvite = has(perms, P.CREATE_INVITE)
  const canManageGuild = has(perms, P.MANAGE_GUILD) || has(perms, P.MANAGE_ROLES)
  const canCreate = has(perms, P.MANAGE_CHANNELS)
  const canEditChannel = (id: string) => has(chanPerms[id] ?? 0, P.MANAGE_CHANNELS) || has(chanPerms[id] ?? 0, P.MANAGE_ROLES)
  const all = Object.values(channels).filter((c) => c.guild_id === guildId).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
  const categories = all.filter((c) => c.kind === 'category')
  const list = all.filter((c) => c.kind !== 'category' && c.kind !== 'thread')
  const catIds = new Set(categories.map((c) => c.id))
  const uncategorized = list.filter((c) => !c.parent_id || !catIds.has(c.parent_id))
  const childrenOf = (id: string) => list.filter((c) => c.parent_id === id)
  const persistOrder = async (ordered: { id: string; parent_id: string | null }[]) => {
    const items = ordered.map((c, i) => ({ id: c.id, position: i, parent_id: c.parent_id }))
    try { await api.patch(`/guilds/${guildId}/channels/positions`, { items }) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const persistCategoryOrder = async (orderedIds: string[]) => {
    useStore.setState((s) => ({ channels: { ...s.channels, ...Object.fromEntries(orderedIds.map((id, i) => [id, { ...s.channels[id], position: i }])) } }))
    try { await api.patch(`/guilds/${guildId}/channels/positions`, { items: orderedIds.map((id, i) => ({ id, position: i })) }) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  /** A dragged category lands before `beforeCat` (null = last). Unchanged orders are not saved. */
  const dropCategory = (beforeCat: string | null) => {
    if (!drag || drag === beforeCat) return
    const current = categories.map((c) => c.id)
    const ids = current.filter((id) => id !== drag)
    const i = beforeCat ? ids.indexOf(beforeCat) : -1
    ids.splice(i < 0 ? ids.length : i, 0, drag)
    if (ids.join() !== current.join()) persistCategoryOrder(ids)
  }
  /** A dragged channel lands in group `parent` (null = uncategorized) before channel `before` (null = last). */
  const dropChannel = (parent: string | null, before: string | null) => {
    if (!drag || drag === before) return
    if (!list.some((c) => c.id === drag)) return
    const groupOf = (c: Channel) => (c.parent_id && catIds.has(c.parent_id) ? c.parent_id : null)
    const rest = list.filter((c) => c.id !== drag)
    const ordered: { id: string; parent_id: string | null }[] = []
    for (const g of [null, ...categories.map((c) => c.id)]) {
      const placed = rest.filter((c) => groupOf(c) === g).map((c) => ({ id: c.id, parent_id: g }))
      if (g === parent) { const i = before ? placed.findIndex((c) => c.id === before) : -1; placed.splice(i < 0 ? placed.length : i, 0, { id: drag, parent_id: g }) }
      ordered.push(...placed)
    }
    const current = [null, ...categories.map((c) => c.id)].flatMap((g) => list.filter((c) => groupOf(c) === g).map((c) => `${c.id}:${g}`))
    if (ordered.map((c) => `${c.id}:${c.parent_id}`).join() === current.join()) return
    // Optimistic: apply positions locally, then persist.
    useStore.setState((s) => ({ channels: { ...s.channels, ...Object.fromEntries(ordered.map((c, i) => [c.id, { ...s.channels[c.id], position: i, parent_id: c.parent_id }])) } }))
    persistOrder(ordered)
  }
  const endDrag = () => { setDrag(null); setTarget(null) }
  const startDrag = (id: string) => (e: DragEvent<HTMLElement>) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; setDrag(id) }
  const dragProps = (c: Channel) => canCreate ? { draggable: true, onDragStart: startDrag(c.id), onDragEnd: endDrag } : {}
  const catDragProps = (catId: string) => canCreate ? { draggable: true, onDragStart: startDrag(catId), onDragEnd: endDrag } : {}
  const listDropProps = canCreate ? {
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!drag || !listRef.current) return
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'
      const t = dropTarget(listRef.current, e.clientY, drag, channels[drag]?.kind === 'category')
      if (t?.key !== target?.key) setTarget(t)
    },
    onDragLeave: (e: DragEvent<HTMLDivElement>) => { if (!listRef.current?.contains(e.relatedTarget as Node | null)) setTarget(null) },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      if (!drag || !listRef.current) return
      e.preventDefault()
      const t = dropTarget(listRef.current, e.clientY, drag, channels[drag]?.kind === 'category')
      if (t?.kind === 'category') dropCategory(t.before); else if (t) dropChannel(t.parent, t.before)
      endDrag()
    },
  } : {}
  // Collapse or expand every category at once (remembered per server, like single toggles).
  const setAllCollapsed = (on: boolean) => setCollapsed(() => {
    const n = Object.fromEntries(categories.map((c) => [c.id, on]))
    try { localStorage.setItem(`${STORAGE_PREFIX}collapsed.${guildId}`, JSON.stringify(n)) } catch { /* ignore */ }
    return n
  })
  const categoryMenu = (c: Channel): MenuEntry[] => {
    const unreadKids = childrenOf(c.id).filter((k) => isUnread({ readStates, lastMessageId }, k.id))
    return [
    { label: 'Mark As Read', icon: <MailCheck size={16} />, disabled: !unreadKids.length, onClick: () => { unreadKids.forEach((k) => markRead(k.id)) } },
    'sep',
    { label: collapsed[c.id] ? 'Expand Category' : 'Collapse Category', icon: <ChevronDown size={16} />, onClick: () => toggleCollapsed(c.id) },
    { label: 'Collapse All Categories', icon: <ChevronsDownUp size={16} />, onClick: () => setAllCollapsed(true) },
    { label: 'Expand All Categories', icon: <ChevronsUpDown size={16} />, onClick: () => setAllCollapsed(false) },
    'sep',
    ...notifEntries(c.id, 'Category', notifSettings, { serverDefault: true }),
    ...(canCreate ? ['sep' as const, { label: 'Create Channel', icon: <Plus size={16} />, onClick: () => openModal({ kind: 'createChannel', guildId, parentId: c.id }) }, { label: 'Edit Category', icon: <Pencil size={16} />, onClick: () => openModal({ kind: 'editCategory', channelId: c.id }) }, { label: 'Delete Category', icon: <Trash2 size={16} />, danger: true, onClick: () => openModal({ kind: 'confirm', title: `Delete '${c.name}'`, body: `The channels inside ${c.name} are kept and move to the top of the list.`, danger: true, confirmLabel: 'Delete Category', action: async () => { try { await api.delete(`/channels/${c.id}`) } catch (e) { pushToast((e as Error).message, 'error') } } }) }] : []),
    ...(getPrefs().developerMode ? ['sep' as const, { label: 'Copy Category ID', icon: <Copy size={16} />, onClick: () => copyText('Category ID', c.id) }] : []),
  ]
  }
  const row = (c: Channel) => (
    <div key={c.id} data-channel-item={c.id} data-channel-parent={c.parent_id && catIds.has(c.parent_id) ? c.parent_id : ''} className={drag === c.id ? 'opacity-40' : ''} {...dragProps(c)}>
      <ChannelRow to={`/channels/${guildId}/${c.id}`} icon={c.kind === 'voice' ? <Volume2 size={18} /> : c.kind === 'stage' ? <Radio size={18} /> : c.kind === 'studio' ? <Disc3 size={18} /> : c.kind === 'forum' ? <MessageSquareText size={18} /> : <Hash size={18} />} name={c.name} locked={!!c.e2ee} mentions={c.kind === 'text' && showsMentions({ channels, dms, notifSettings }, c.id) ? mentionCounts[c.id] ?? 0 : 0} muted={mutedTarget(notifSettings, c.id) || (!!c.parent_id && mutedTarget(notifSettings, c.parent_id))} onContextMenu={(e) => ctx.open(e, channelMenu(c))}
        unread={channelId !== c.id && showsUnread({ readStates, lastMessageId, channels, dms, notifSettings, guilds: allGuilds }, c.id)} onClick={() => setMobilePane('content')}
        count={c.user_limit ? `${Object.values(voiceStates).filter((v) => v.channel_id === c.id).length}/${c.user_limit}` : undefined}
        onSettings={canEditChannel(c.id) ? () => openModal({ kind: 'channelSettings', channelId: c.id }) : undefined} />
      {c.voice_status && <div className="ml-8 mr-2 -mt-0.5 mb-0.5 truncate text-xs text-text-2" title={c.voice_status} data-voice-status={c.id}>{c.voice_status}</div>}
      {(c.kind === 'voice' || c.kind === 'stage' || c.kind === 'studio') && <VoiceParticipants channelId={c.id} onUserMenu={(e, u) => ctx.open(e, userMenu(u, e.currentTarget.getBoundingClientRect()))} />}
    </div>
  )
  const copyText = async (label: string, t: string) => { try { await navigator.clipboard.writeText(t); pushToast(`${label} copied`) } catch { pushToast('Clipboard unavailable', 'error') } }
  const channelMenu = (c: { id: string; name: string }): MenuEntry[] => {
    const unread = isUnread({ readStates, lastMessageId }, c.id)
    const canEdit = canEditChannel(c.id)
    return [
      { label: 'Mark As Read', icon: <MailCheck size={16} />, disabled: !unread, onClick: () => markRead(c.id) },
      'sep',
      ...notifEntries(c.id, 'Channel', notifSettings, { serverDefault: true }),
      'sep',
      ...(canInvite ? [{ label: 'Invite People', icon: <UserPlus size={16} />, accent: true, onClick: () => openModal({ kind: 'invite', guildId }) }] : []),
      { label: 'Copy Link', icon: <Link2 size={16} />, onClick: () => copyText('Link', `${location.origin}/channels/${guildId}/${c.id}`) },
      ...(canEdit ? ['sep' as const, { label: 'Edit Channel', icon: <Settings size={16} />, onClick: () => openModal({ kind: 'channelSettings', channelId: c.id }) }] : []),
      ...(canEdit && list.length > 1 ? [{ label: 'Delete Channel', icon: <Trash2 size={16} />, danger: true, onClick: () => openModal({ kind: 'confirm', title: `Delete '${c.name}'`, body: `Are you sure you want to delete #${c.name}? This cannot be undone.`, danger: true, confirmLabel: 'Delete Channel', action: async () => { try { await api.delete(`/channels/${c.id}`) } catch (e) { pushToast((e as Error).message, 'error') } } }) }] : []),
      ...(getPrefs().developerMode ? ['sep' as const, { label: 'Copy Channel ID', icon: <Copy size={16} />, onClick: () => copyText('Channel ID', c.id) }] : []),
    ]
  }

  const leave = () => openModal({
    kind: 'confirm', title: `Leave '${guild.name}'`, body: `Are you sure you want to leave ${guild.name}? You won't be able to rejoin unless you are re-invited.`, danger: true, confirmLabel: 'Leave Server',
    action: async () => {
      try { await api.delete(`/guilds/${guildId}/members/@me`); removeGuild(guildId); navigate('/channels/@me') } catch (e) { pushToast((e as Error).message, 'error') }
    },
  })
  const del = () => openModal({
    kind: 'confirm', title: `Delete '${guild.name}'`, body: `Are you sure you want to delete ${guild.name}? This cannot be undone.`, danger: true, confirmLabel: 'Delete Server',
    action: async () => {
      try { await api.delete(`/guilds/${guildId}`); removeGuild(guildId); navigate('/channels/@me') } catch (e) { pushToast((e as Error).message, 'error') }
    },
  })

  return (
    <aside className="w-[var(--sidebar-w)] tab:w-[224px] max-md:w-auto max-md:flex-1 min-w-0 shrink-0 bg-bg-1 flex flex-col">
      <div className="relative">
        {guild.banner_url ? (
          <div className="relative h-[135px] bg-cover bg-center" style={{ backgroundImage: `url(${guild.banner_url})` }} data-guild-banner>
            <button onClick={() => setMenu((m) => !m)} className="absolute inset-x-0 top-0 h-12 px-4 flex items-center justify-between font-bold text-white text-left bg-gradient-to-b from-black/60 to-transparent hover:from-black/70 drop-shadow">
              <span className="truncate">{guild.name}</span>
              <ChevronDown size={18} className={`transition ${menu ? 'rotate-180' : ''}`} />
            </button>
          </div>
        ) : (
          <button onClick={() => setMenu((m) => !m)} className="h-12 w-full px-4 flex items-center justify-between font-bold border-b border-line hover:bg-bg-3 transition text-left">
            <span className="truncate">{guild.name}</span>
            <ChevronDown size={18} className={`text-text-1 transition ${menu ? 'rotate-180' : ''}`} />
          </button>
        )}
        {menu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
            <div className="pop absolute left-2 right-2 top-full mt-1 z-40 rounded-xl bg-bg-0 border border-line shadow-2xl p-1.5 text-sm" onClick={() => setMenu(false)}>
              {canInvite && <MenuItem icon={<UserPlus size={16} />} onClick={() => openModal({ kind: 'invite', guildId })} accent>{t('Invite People')}</MenuItem>}
              <MenuItem icon={<BellOff size={16} />} onClick={(e) => { setMenu(false); ctx.open(e as React.MouseEvent, notifEntries(guildId, 'Server', notifSettings, { suppress: true, fallback: allGuilds[guildId]?.default_notifications })) }}>{mutedTarget(notifSettings, guildId) ? 'Unmute / Notifications' : 'Mute / Notifications'}</MenuItem>
              <MenuItem icon={<ShieldCheck size={16} />} onClick={() => openModal({ kind: 'guildPrivacy', guildId })}>{t('Privacy Settings')}</MenuItem>
              {canManageGuild && <MenuItem icon={<Settings size={16} />} onClick={() => openModal({ kind: 'guildSettings', guildId })}>{t('Server Settings')}</MenuItem>}
              {canCreate && <MenuItem icon={<Plus size={16} />} onClick={() => openModal({ kind: 'createChannel', guildId })}>{t('Create Channel')}</MenuItem>}
              <div className="h-px bg-line my-1" />
              {isOwner
                ? <MenuItem icon={<Trash2 size={16} />} onClick={del} danger>{t('Delete Server')}</MenuItem>
                : <MenuItem icon={<LogOut size={16} />} onClick={leave} danger>{t('Leave Server')}</MenuItem>}
            </div>
          </>
        )}
      </div>

      <div ref={listRef} className="relative flex-1 overflow-y-auto px-2 pt-3 space-y-4" data-channel-list {...listDropProps}>
        {target?.line !== undefined && <div className="pointer-events-none absolute left-2 right-2 z-10 h-0.5 rounded-full bg-accent" style={{ top: target.line - 1 }} data-drop-line />}
        <EventsRow guildId={guildId} />
        <div className="space-y-0.5 min-h-2" data-channel-group="">
          {uncategorized.map(row)}
        </div>
        {categories.map((cat) => (
          <Category key={cat.id} label={cat.name} open={!collapsed[cat.id]} onToggle={() => toggleCollapsed(cat.id)} highlight={target?.kind === 'channel' && target.into === cat.id} dragging={drag === cat.id} dragProps={catDragProps(cat.id)} testid={cat.id}
            onAdd={canCreate ? () => openModal({ kind: 'createChannel', guildId, parentId: cat.id }) : undefined} onContextMenu={(e) => ctx.open(e, categoryMenu(cat))}>
            {childrenOf(cat.id).filter((c) => !collapsed[cat.id] || c.id === channelId || showsUnread({ readStates, lastMessageId, channels, dms, notifSettings, guilds: allGuilds }, c.id)).map(row)}
          </Category>
        ))}
        {canCreate && <div><button type="button" onClick={() => openModal({ kind: 'createChannel', guildId })} title="Create Channel" className="w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-text-2 hover:bg-bg-3 hover:text-text-1" data-create-category-hint><FolderPlus size={15} /> Create channel or category</button></div>}
      </div>
      {ctx.menu && <ContextMenu {...ctx.menu} onClose={ctx.close} />}
    </aside>
  )
}

/**
 * Where a drop at `y` lands. Channels: in a category when over its header; otherwise before the first visible row
 * (of any group) whose middle is below the pointer, or at the end of the group the pointer is under. Categories:
 * before the first category header whose middle is below the pointer, else last. `line` is the indicator's offset
 * from the top of the list's content; `key` changes only when the outcome does.
 */
type DropTarget =
  | { kind: 'channel'; parent: string | null; before: string | null; into?: string; line?: number; key: string }
  | { kind: 'category'; before: string | null; line: number; key: string }

function dropTarget(list: HTMLElement, y: number, dragId: string, dragCategory: boolean): DropTarget | null {
  const top = list.getBoundingClientRect().top - list.scrollTop
  const at = (px: number) => Math.round(px - top)
  if (dragCategory) {
    const blocks = [...list.querySelectorAll<HTMLElement>('[data-category]')].filter((b) => b.dataset.category !== dragId)
    for (const b of blocks) {
      const h = (b.querySelector('[data-category-header]') ?? b).getBoundingClientRect()
      if (y < h.top + h.height / 2) return { kind: 'category', before: b.dataset.category!, line: at(b.getBoundingClientRect().top) - 6, key: `c:${b.dataset.category}` }
    }
    const last = blocks.at(-1)
    return { kind: 'category', before: null, line: last ? at(last.getBoundingClientRect().bottom) + 6 : 0, key: 'c:end' }
  }
  let group: string | null = null, below = list.querySelector('[data-channel-group]')?.getBoundingClientRect().top ?? 0
  for (const el of list.querySelectorAll<HTMLElement>('[data-channel-item], [data-category-header]')) {
    const r = el.getBoundingClientRect()
    if (el.hasAttribute('data-category-header')) {
      const cat = el.closest<HTMLElement>('[data-category]')!.dataset.category!
      if (y < r.top) return { kind: 'channel', parent: group, before: null, line: at(below) + 1, key: `g:${group}:end` }
      if (y <= r.bottom) return { kind: 'channel', parent: cat, before: null, into: cat, key: `in:${cat}` }
      group = cat; below = r.bottom
      continue
    }
    if (el.dataset.channelItem === dragId) { below = r.bottom; continue }
    if (y < r.top + r.height / 2) return { kind: 'channel', parent: el.dataset.channelParent || null, before: el.dataset.channelItem!, line: at(r.top) - 1, key: `b:${el.dataset.channelItem}` }
    below = r.bottom
  }
  return { kind: 'channel', parent: group, before: null, line: at(below) + 1, key: `g:${group}:end` }
}

function MenuItem({ children, icon, onClick, danger, accent }: { children: React.ReactNode; icon: React.ReactNode; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; danger?: boolean; accent?: boolean }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center justify-between rounded-md px-2.5 py-2 hover:bg-accent hover:text-white ${danger ? 'text-danger' : accent ? 'text-accent' : 'text-text-1'}`}>
      <span>{children}</span>{icon}
    </button>
  )
}

function Category({ label, open, onToggle, onAdd, onContextMenu, highlight, dragging, dragProps, testid, children }: { label: string; open: boolean; onToggle: () => void; onAdd?: () => void; onContextMenu?: (e: React.MouseEvent<HTMLElement>) => void; highlight?: boolean; dragging?: boolean; dragProps?: object; testid: string; children: React.ReactNode }) {
  return (
    <div data-category={testid} data-category-open={open ? '1' : '0'} className={dragging ? 'opacity-40' : ''}>
      <div className={`group flex items-center justify-between rounded pr-1 ${highlight ? 'bg-accent/20 text-text-0 ring-1 ring-accent' : ''} text-[11px] font-bold uppercase tracking-wider text-text-2 hover:text-text-1`} onContextMenu={onContextMenu} data-category-header {...dragProps}>
        <button onClick={onToggle} className="flex items-center gap-0.5 py-1 pl-0.5 min-w-0" data-category-toggle>
          <ChevronDown size={12} className={`shrink-0 transition ${open ? '' : '-rotate-90'}`} /><span className="truncate">{label}</span>
        </button>
        {onAdd && <button onClick={onAdd} title="Create Channel" className="opacity-0 group-hover:opacity-100 max-md:opacity-100 hover:text-text-0" data-category-add><Plus size={16} /></button>}
      </div>
      <div className="mt-0.5 space-y-0.5 min-h-1">{children}</div>
    </div>
  )
}

function VoiceParticipants({ channelId, onUserMenu }: { channelId: string; onUserMenu: (e: React.MouseEvent<HTMLElement>, u: { id: string; display_name: string; nickname?: string | null }) => void }) {
  const participants = useStore(useShallow((s) => voiceParticipants(s, channelId)))
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.user)
  const speaking = useStore((s) => s.speaking)
  const openModal = useStore((s) => s.openModal)
  const guildId = useStore((s) => s.channels[channelId]?.guild_id ?? '')
  const members = useStore((s) => s.members[guildId])
  if (!participants.length) return null
  return (
    <div className="ml-7 mr-1 mb-1 space-y-0.5">
      {participants.map((p) => {
        const u = users[p.user_id] ?? (me?.id === p.user_id ? me : undefined)
        if (!u) return null
        return (
          <button key={p.user_id} onClick={(e) => openModal({ kind: 'profile', userId: p.user_id, anchor: anchorOf(e) })} onContextMenu={(e) => onUserMenu(e, { id: u.id, display_name: u.display_name, nickname: members?.[p.user_id]?.nickname })} className="w-full flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-text-1 hover:bg-bg-3 hover:text-text-0 text-left">
            <span className={`rounded-full ${speaking[p.user_id] ? 'ring-2 ring-success' : ''}`}><Avatar user={u} size={22} /></span>
            <StyledName userId={p.user_id} guildId={guildId} className="truncate flex-1">{members?.[p.user_id]?.nickname ?? u.display_name}</StyledName>
            {p.self_stream && <span className="rounded bg-danger px-1 text-[9px] font-extrabold text-white">LIVE</span>}
            {p.self_video && <Video size={14} className="text-text-2" />}
            {/* A moderator's server deafen or mute shows in red; your own choices in grey. */}
            {p.deaf ? <HeadphoneOff size={14} className="text-danger" aria-label="Server deafened" data-server-deaf />
              : p.self_deaf ? <HeadphoneOff size={14} className="text-text-2" />
              : p.mute ? <MicOff size={14} className="text-danger" aria-label="Server muted" data-server-mute />
              : p.self_mute ? <MicOff size={14} className="text-text-2" /> : null}
          </button>
        )
      })}
    </div>
  )
}

function ChannelRow({ to, icon, name, unread, mentions = 0, muted, locked, count, onSettings, onClick, onContextMenu }: { to: string; icon: React.ReactNode; name: string; unread?: boolean; mentions?: number; muted?: boolean; locked?: boolean; count?: string; onSettings?: () => void; onClick?: () => void; onContextMenu?: (e: React.MouseEvent<HTMLElement>) => void }) {
  return (
    <NavLink to={to} onClick={onClick} onContextMenu={onContextMenu} data-channel-row={name} data-muted={muted ? 'true' : undefined} className={({ isActive }) => `group relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[15px] ${isActive ? 'bg-bg-4 text-text-0' : unread ? 'text-text-0 hover:bg-bg-3' : 'text-text-2 hover:bg-bg-3 hover:text-text-1'} ${muted ? 'opacity-50' : ''}`}>
      {unread && <span className="absolute -left-2 top-1/2 -translate-y-1/2 h-2 w-1 rounded-r bg-white" />}
      <span className="text-text-2">{icon}</span>
      <span className={`truncate flex-1 ${unread ? 'font-semibold' : ''}`}>{name}</span>
      {count && <span className="shrink-0 rounded bg-bg-0/70 px-1 text-[10px] font-semibold tabular-nums text-text-2" title="People in the channel / its limit" data-user-limit>{count}</span>}
      {locked && <Lock size={12} className="text-text-2 shrink-0" aria-label="End-to-end encrypted calls" data-e2ee-icon />}
      {muted && <BellOff size={13} className="text-text-2 shrink-0" data-muted-icon />}
      {mentions > 0 && <span className="min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center" data-mention-badge={mentions}>{mentions}</span>}
      {onSettings && <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSettings() }} className="opacity-0 group-hover:opacity-100 max-md:opacity-100 text-text-2 hover:text-text-0" title="Edit Channel"><Settings size={14} /></button>}
    </NavLink>
  )
}


/** "Events" entry above the channels: upcoming count, opens the events modal. */
function EventsRow({ guildId }: { guildId: string }) {
  const t = useT()
  const events = useStore((s) => s.events[guildId])
  const loadEvents = useStore((s) => s.loadEvents)
  const openModal = useStore((s) => s.openModal)
  useEffect(() => { if (!events) loadEvents(guildId) }, [guildId, events, loadEvents])
  const n = events?.length ?? 0
  const live = events?.some((e) => new Date(e.starts_at).getTime() <= Date.now()) ?? false
  return (
    <button type="button" onClick={() => openModal({ kind: 'events', guildId })} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[15px] font-medium text-text-1 hover:bg-bg-3 hover:text-text-0" data-events-row data-events-count={n}>
      <CalendarDays size={18} className={live ? 'text-success' : 'text-text-2'} /><span className="flex-1 text-left">{t('Events')}</span>
      {n > 0 && <span className={`rounded-full px-1.5 text-[11px] font-bold ${live ? 'bg-success text-black' : 'bg-bg-4 text-text-1'}`}>{n}</span>}
    </button>
  )
}
