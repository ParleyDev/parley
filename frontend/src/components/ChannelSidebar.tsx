import { useShallow } from 'zustand/react/shallow'
import { anchorOf } from '../lib/anchor'
import { CalendarDays, ChevronDown, Copy, Disc3, FolderPlus, Hash, MessageSquareText, HeadphoneOff, Link2, LogOut, MailCheck, MicOff, Pencil, Plus, Radio, Settings, Trash2, UserPlus, Video, Volume2 } from 'lucide-react'
import ContextMenu, { useContextMenu, type MenuEntry } from './ContextMenu'
import { useUserMenu } from './UserContextMenu'
import Avatar from './Avatar'
import { useState, type DragEvent, useEffect } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { isUnread, myChannelPerms, myGuildPerms, showsMentions, showsUnread, useStore, voiceParticipants } from '../store'
import { notifEntries } from './NotifMenu'
import { mutedTarget } from '../lib/notify'
import { BellOff } from 'lucide-react'
import { has, P } from '../lib/perms'
import StyledName from './StyledName'
import { api } from '../lib/api'
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
  // Drag and drop: channels can be dropped on another channel (insert before it) or on a category header (append).
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
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
  /** A dragged category lands before `beforeCat` (null = at the end). */
  const dropCategory = (beforeCat: string | null) => {
    if (!drag || drag === beforeCat) return
    const ids = categories.map((c) => c.id).filter((id) => id !== drag)
    const i = beforeCat ? ids.indexOf(beforeCat) : -1
    ids.splice(i < 0 ? ids.length : i, 0, drag)
    persistCategoryOrder(ids)
  }
  const dropOn = (targetId: string | null, parent: string | null, where: 'before' | 'end') => {
    if (!drag || drag === targetId) return
    const moving = channels[drag]; if (!moving) return
    if (moving.kind === 'category') { dropCategory(parent); return }
    const rest = list.filter((c) => c.id !== drag)
    const ordered: { id: string; parent_id: string | null }[] = []
    const groups: (string | null)[] = [null, ...categories.map((c) => c.id)]
    for (const g of groups) {
      const members = rest.filter((c) => (g === null ? !c.parent_id || !catIds.has(c.parent_id) : c.parent_id === g))
      const placed = members.map((c) => ({ id: c.id, parent_id: g }))
      if (g === parent) {
        if (where === 'end' || !targetId) placed.push({ id: drag, parent_id: g })
        else { const i = placed.findIndex((c) => c.id === targetId); placed.splice(i < 0 ? placed.length : i, 0, { id: drag, parent_id: g }) }
      }
      ordered.push(...placed)
    }
    // Optimistic: apply positions locally, then persist.
    useStore.setState((s) => ({ channels: { ...s.channels, ...Object.fromEntries(ordered.map((c, i) => [c.id, { ...s.channels[c.id], position: i, parent_id: c.parent_id }])) } }))
    persistOrder(ordered)
  }
  const dragProps = (c: Channel) => canCreate ? {
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; setDrag(c.id) },
    onDragEnd: () => { setDrag(null); setOver(null) },
    onDragOver: (e: DragEvent<HTMLElement>) => { if (!drag || drag === c.id) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== c.id) setOver(c.id) },
    onDrop: (e: DragEvent<HTMLElement>) => { e.preventDefault(); dropOn(c.id, c.parent_id && catIds.has(c.parent_id) ? c.parent_id : null, 'before'); setDrag(null); setOver(null) },
  } : {}
  const catDropProps = (catId: string | null) => canCreate ? {
    onDragOver: (e: DragEvent<HTMLElement>) => { if (!drag || drag === catId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const key = `cat:${catId ?? 'none'}`; if (over !== key) setOver(key) },
    onDrop: (e: DragEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); dropOn(null, catId, 'end'); setDrag(null); setOver(null) },
  } : {}
  const catDragProps = (catId: string) => canCreate ? {
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => { e.dataTransfer.setData('text/plain', catId); e.dataTransfer.effectAllowed = 'move'; setDrag(catId) },
    onDragEnd: () => { setDrag(null); setOver(null) },
  } : {}
  const tailDropProps = canCreate ? {
    onDragOver: (e: DragEvent<HTMLElement>) => { if (!drag || channels[drag]?.kind !== 'category') return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== 'cat:end') setOver('cat:end') },
    onDrop: (e: DragEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); dropCategory(null); setDrag(null); setOver(null) },
  } : {}
  const categoryMenu = (c: Channel): MenuEntry[] => [
    { label: collapsed[c.id] ? 'Expand Category' : 'Collapse Category', icon: <ChevronDown size={16} />, onClick: () => toggleCollapsed(c.id) },
    ...(canCreate ? ['sep' as const, { label: 'Create Channel', icon: <Plus size={16} />, onClick: () => openModal({ kind: 'createChannel', guildId, parentId: c.id }) }, { label: 'Edit Category', icon: <Pencil size={16} />, onClick: () => openModal({ kind: 'editCategory', channelId: c.id }) }, { label: 'Delete Category', icon: <Trash2 size={16} />, danger: true, onClick: () => openModal({ kind: 'confirm', title: `Delete '${c.name}'`, body: `The channels inside ${c.name} are kept and move to the top of the list.`, danger: true, confirmLabel: 'Delete Category', action: async () => { try { await api.delete(`/channels/${c.id}`) } catch (e) { pushToast((e as Error).message, 'error') } } }) }] : []),
    'sep' as const,
    { label: 'Copy Category ID', icon: <Copy size={16} />, onClick: () => copyText('Category ID', c.id) },
  ]
  const row = (c: Channel) => (
    <div key={c.id} data-channel-item={c.id} data-channel-parent={c.parent_id ?? ''} className={`${drag === c.id ? 'opacity-40' : ''} ${over === c.id ? 'border-t-2 border-accent' : ''}`} {...dragProps(c)}>
      <ChannelRow to={`/channels/${guildId}/${c.id}`} icon={c.kind === 'voice' ? <Volume2 size={18} /> : c.kind === 'stage' ? <Radio size={18} /> : c.kind === 'studio' ? <Disc3 size={18} /> : c.kind === 'forum' ? <MessageSquareText size={18} /> : <Hash size={18} />} name={c.name} mentions={c.kind === 'text' && showsMentions({ channels, dms, notifSettings }, c.id) ? mentionCounts[c.id] ?? 0 : 0} muted={mutedTarget(notifSettings, c.id)} onContextMenu={(e) => ctx.open(e, channelMenu(c))}
        unread={channelId !== c.id && showsUnread({ readStates, lastMessageId, channels, dms, notifSettings }, c.id)} onClick={() => setMobilePane('content')}
        onSettings={canEditChannel(c.id) ? () => openModal({ kind: 'channelSettings', channelId: c.id }) : undefined} />
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
      'sep',
      { label: 'Copy Channel ID', icon: <Copy size={16} />, onClick: () => copyText('Channel ID', c.id) },
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
    <aside className="w-[272px] tab:w-[224px] max-md:w-auto max-md:flex-1 min-w-0 shrink-0 bg-bg-1 flex flex-col">
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
              <MenuItem icon={<BellOff size={16} />} onClick={(e) => { setMenu(false); ctx.open(e as React.MouseEvent, notifEntries(guildId, 'Server', notifSettings, { suppress: true })) }}>{mutedTarget(notifSettings, guildId) ? 'Unmute / Notifications' : 'Mute / Notifications'}</MenuItem>
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

      <div className="flex-1 overflow-y-auto px-2 pt-3 space-y-4" data-channel-list>
        <EventsRow guildId={guildId} />
        <div className={`space-y-0.5 min-h-2 rounded ${over === 'cat:none' ? 'ring-1 ring-accent' : ''}`} data-channel-group="" {...catDropProps(null)}>
          {uncategorized.map(row)}
        </div>
        {categories.map((cat) => (
          <Category key={cat.id} label={cat.name} open={!collapsed[cat.id]} onToggle={() => toggleCollapsed(cat.id)} highlight={over === `cat:${cat.id}`} dragging={drag === cat.id} dropProps={catDropProps(cat.id)} dragProps={catDragProps(cat.id)} testid={cat.id}
            onAdd={canCreate ? () => openModal({ kind: 'createChannel', guildId, parentId: cat.id }) : undefined} onContextMenu={(e) => ctx.open(e, categoryMenu(cat))}>
            {childrenOf(cat.id).filter((c) => !collapsed[cat.id] || c.id === channelId || showsUnread({ readStates, lastMessageId, channels, dms, notifSettings }, c.id)).map(row)}
          </Category>
        ))}
        {canCreate && <div className={`rounded ${over === 'cat:end' ? 'ring-1 ring-accent' : ''}`} {...tailDropProps}><button type="button" onClick={() => openModal({ kind: 'createChannel', guildId })} title="Create Channel" className="w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-text-2 hover:bg-bg-3 hover:text-text-1" data-create-category-hint><FolderPlus size={15} /> Create channel or category</button></div>}
      </div>
      {ctx.menu && <ContextMenu {...ctx.menu} onClose={ctx.close} />}
    </aside>
  )
}

function MenuItem({ children, icon, onClick, danger, accent }: { children: React.ReactNode; icon: React.ReactNode; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; danger?: boolean; accent?: boolean }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center justify-between rounded-md px-2.5 py-2 hover:bg-accent hover:text-white ${danger ? 'text-danger' : accent ? 'text-accent' : 'text-text-1'}`}>
      <span>{children}</span>{icon}
    </button>
  )
}

function Category({ label, open, onToggle, onAdd, onContextMenu, highlight, dragging, dropProps, dragProps, testid, children }: { label: string; open: boolean; onToggle: () => void; onAdd?: () => void; onContextMenu?: (e: React.MouseEvent<HTMLElement>) => void; highlight?: boolean; dragging?: boolean; dropProps?: object; dragProps?: object; testid: string; children: React.ReactNode }) {
  return (
    <div data-category={testid} data-category-open={open ? '1' : '0'} className={`rounded ${highlight ? 'ring-1 ring-accent' : ''} ${dragging ? 'opacity-40' : ''}`} {...dropProps}>
      <div className="group flex items-center justify-between pr-1 text-[11px] font-bold uppercase tracking-wider text-text-2 hover:text-text-1" onContextMenu={onContextMenu} data-category-header {...dragProps}>
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
            {p.self_deaf ? <HeadphoneOff size={14} className="text-text-2" /> : p.self_mute ? <MicOff size={14} className="text-text-2" /> : null}
          </button>
        )
      })}
    </div>
  )
}

function ChannelRow({ to, icon, name, unread, mentions = 0, muted, onSettings, onClick, onContextMenu }: { to: string; icon: React.ReactNode; name: string; unread?: boolean; mentions?: number; muted?: boolean; onSettings?: () => void; onClick?: () => void; onContextMenu?: (e: React.MouseEvent<HTMLElement>) => void }) {
  return (
    <NavLink to={to} onClick={onClick} onContextMenu={onContextMenu} data-channel-row={name} data-muted={muted ? 'true' : undefined} className={({ isActive }) => `group relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[15px] ${isActive ? 'bg-bg-4 text-text-0' : unread ? 'text-text-0 hover:bg-bg-3' : 'text-text-2 hover:bg-bg-3 hover:text-text-1'} ${muted ? 'opacity-50' : ''}`}>
      {unread && <span className="absolute -left-2 top-1/2 -translate-y-1/2 h-2 w-1 rounded-r bg-white" />}
      <span className="text-text-2">{icon}</span>
      <span className={`truncate flex-1 ${unread ? 'font-semibold' : ''}`}>{name}</span>
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
