import { APP_INITIAL } from '../lib/brand'
import { ArrowDown, ArrowUp, Compass, Copy, Folder, FolderInput, FolderMinus, FolderPlus, LogOut, MailCheck, Plus, Settings, Trash2, UserPlus } from 'lucide-react'
import { useState, type DragEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useMatch, useNavigate } from 'react-router-dom'
import { dmUnreadCount, guildMentions, guildUnread, isUnread, myGuildPerms, pendingCount, useStore } from '../store'
import { colorFor, initials } from '../lib/format'
import { has, P } from '../lib/perms'
import { api } from '../lib/api'
import { dissolveFolder, moveGuild, newFolderId, nudge, removeFromFolder, type DropTarget } from '../lib/layout'
import type { Guild, LayoutItem } from '../lib/types'
import ContextMenu, { useContextMenu, type MenuEntry } from './ContextMenu'
import { notifEntries } from './NotifMenu'
import { mutedTarget } from '../lib/notify'

type FolderItem = Extract<LayoutItem, { kind: 'folder' }>
const OPEN_KEY = 'parley.folderOpen'
/** Hover tooltips only make sense for pointers that can hover. */
export const canHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches
const loadOpen = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') } catch { return {} } }

/**
 * The server bar. Renders the user's layout (servers and folders), supports drag and drop
 * (reorder, drop onto a server to make a folder, drop into/out of folders) with context-menu
 * equivalents, and keeps the selection pill / unread stubs / portal tooltips.
 */
export default function GuildBar() {
  const layout = useStore((s) => s.guildLayout)
  const setLayout = useStore((s) => s.setGuildLayout)
  const guilds = useStore((s) => s.guilds)
  const channels = useStore((s) => s.channels)
  const readStates = useStore((s) => s.readStates)
  const lastMessageId = useStore((s) => s.lastMessageId)
  const dms = useStore((s) => s.dms)
  const notifSettings = useStore((s) => s.notifSettings)
  const openModal = useStore((s) => s.openModal)
  const guildId = useMatch('/channels/:guildId/*')?.params.guildId
  const pending = useStore(pendingCount)
  const dmUnread = dmUnreadCount({ readStates, lastMessageId, dms, channels, notifSettings }) + pending
  const ctx = useContextMenu()
  const guildMenu = useGuildMenu()
  const [open, setOpen] = useState<Record<string, boolean>>(loadOpen)
  const toggleFolder = (id: string) => setOpen((o) => { const n = { ...o, [id]: !o[id] }; try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)) } catch { /* ignore */ } return n })
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<{ key: string; zone: 'top' | 'mid' | 'bottom' } | null>(null)
  const unreadOf = (id: string) => guildId !== id && guildUnread({ readStates, lastMessageId, channels, dms, notifSettings }, id)
  const mentionCounts = useStore((s) => s.mentionCounts)
  const mentionsOf = (id: string) => guildMentions({ mentionCounts, channels, dms, notifSettings }, id)
  const mutedOf = (id: string) => mutedTarget(notifSettings, id)

  const zoneOf = (e: DragEvent<HTMLElement>): 'top' | 'mid' | 'bottom' => {
    const r = e.currentTarget.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height
    return y < 0.25 ? 'top' : y > 0.75 ? 'bottom' : 'mid'
  }
  const dragProps = (key: string, resolve: (zone: 'top' | 'mid' | 'bottom') => DropTarget | null) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const zone = zoneOf(e); if (over?.key !== key || over.zone !== zone) setOver({ key, zone }) },
    onDragLeave: () => { if (over?.key === key) setOver(null) },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      const id = drag ?? e.dataTransfer.getData('text/plain')
      const target = id ? resolve(zoneOf(e)) : null
      setDrag(null); setOver(null)
      if (id && target) setLayout(moveGuild(layout, id, target), true)
    },
  })
  const startDrag = (id: string) => (e: DragEvent<HTMLElement>) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; setDrag(id) }
  const endDrag = () => { setDrag(null); setOver(null) }
  const indicator = (key: string) => over?.key === key && drag ? over.zone : null

  const folderMenu = (f: FolderItem): MenuEntry[] => {
    const unread = f.guilds.flatMap((g) => Object.values(channels).filter((c) => c.guild_id === g && isUnread({ readStates, lastMessageId }, c.id)))
    const markRead = useStore.getState().markRead
    return [
      { label: 'Mark As Read', icon: <MailCheck size={16} />, disabled: unread.length === 0, onClick: () => unread.forEach((c) => markRead(c.id)) },
      'sep',
      { label: 'Folder Settings', icon: <Settings size={16} />, onClick: () => openModal({ kind: 'folderSettings', folderId: f.id }) },
      { label: 'Remove Folder', icon: <FolderMinus size={16} />, danger: true, onClick: () => setLayout(dissolveFolder(layout, f.id), true) },
    ]
  }
  const layoutMenu = (id: string): MenuEntry[] => {
    const inFolder = layout.find((it) => it.kind === 'folder' && it.guilds.includes(id)) as FolderItem | undefined
    const folders = layout.filter((it): it is FolderItem => it.kind === 'folder' && it.id !== inFolder?.id)
    const folderLabel = (f: FolderItem) => f.name || f.guilds.map((g) => guilds[g]?.name ?? '').filter(Boolean).slice(0, 2).join(', ')
    return [
      'sep',
      { label: 'Move Up', icon: <ArrowUp size={16} />, onClick: () => setLayout(nudge(layout, id, -1), true) },
      { label: 'Move Down', icon: <ArrowDown size={16} />, onClick: () => setLayout(nudge(layout, id, 1), true) },
      inFolder
        ? { label: 'Remove from Folder', icon: <FolderMinus size={16} />, onClick: () => setLayout(removeFromFolder(layout, id), true) }
        : { label: 'Add to Folder', icon: <FolderInput size={16} />, children: [
          ...folders.map((f) => ({ label: folderLabel(f) || 'Folder', icon: <Folder size={16} style={{ color: f.color ?? undefined }} />, onClick: () => setLayout(moveGuild(layout, id, { type: 'into', folderId: f.id }), true) })),
          { label: 'New Folder', icon: <FolderPlus size={16} />, onClick: () => { const fid = newFolderId(); setLayout(layout.map((it) => (it.kind === 'guild' && it.id === id ? { kind: 'folder', id: fid, name: '', color: null, guilds: [id] } as LayoutItem : it)), true); openModal({ kind: 'folderSettings', folderId: fid }) } },
        ] },
    ]
  }

  const renderGuild = (g: Guild, key: string, resolve: (zone: 'top' | 'mid' | 'bottom') => DropTarget | null, inFolder?: boolean) => {
    const active = guildId === g.id
    const ind = indicator(key)
    return (
      <div key={key} className="relative" {...dragProps(key, resolve)} data-layout-item={g.id}>
        {ind === 'top' && <span className="absolute -top-1.5 left-2 right-2 h-0.5 rounded bg-white" data-drop-line="before" />}
        {ind === 'bottom' && <span className="absolute -bottom-1.5 left-2 right-2 h-0.5 rounded bg-white" data-drop-line="after" />}
        <NavLink to={`/channels/${g.id}`} className={`group relative block ${drag === g.id ? 'opacity-40' : ''}`} draggable onDragStart={startDrag(g.id)} onDragEnd={endDrag}
          onContextMenu={(e) => ctx.open(e, [...guildMenu(g.id).slice(0, 2), ...notifEntries(g.id, 'Server', notifSettings, { suppress: true }), ...guildMenu(g.id).slice(2), ...layoutMenu(g.id)])} data-guild-icon={g.id} data-in-folder={inFolder ? 'true' : undefined} data-muted={mutedOf(g.id) ? 'true' : undefined}>
          <Pill active={active} unread={unreadOf(g.id)} tip={g.name}>
            <div className={`h-12 w-12 overflow-hidden flex items-center justify-center text-white font-semibold transition-all duration-200 rounded-2xl ${active ? '' : 'group-hover:rounded-xl'} ${!active && !unreadOf(g.id) ? 'opacity-80 group-hover:opacity-100' : ''} ${mutedOf(g.id) ? 'opacity-50' : ''} ${ind === 'mid' && !inFolder ? 'ring-2 ring-success' : ''}`}
              style={{ background: g.icon_url ? undefined : colorFor(g.id) }}>
              {g.icon_url ? <img src={g.icon_url} alt="" className="h-full w-full object-cover" draggable={false} /> : initials(g.name)}
            </div>
            {mentionsOf(g.id) > 0 && <span className="absolute -bottom-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center ring-[3px] ring-bg-0" data-guild-mentions={mentionsOf(g.id)}>{mentionsOf(g.id)}</span>}
          </Pill>
        </NavLink>
      </div>
    )
  }

  const renderFolder = (f: FolderItem) => {
    const members = f.guilds.map((g) => guilds[g]).filter((g): g is Guild => !!g)
    const isOpen = !!open[f.id]
    const anyActive = f.guilds.includes(guildId ?? '')
    const anyUnread = f.guilds.some(unreadOf)
    const tint = f.color ?? '#7d8394'
    const ind = indicator(f.id)
    const label = f.name || members.map((g) => g.name).join(', ')
    return (
      <div key={f.id} className={`relative rounded-2xl transition-colors ${isOpen ? 'bg-bg-3 py-1 -my-1' : ''}`} data-folder={f.id} data-folder-open={isOpen ? 'true' : 'false'}>
        {ind === 'top' && <span className="absolute -top-1.5 left-2 right-2 h-0.5 rounded bg-white z-10" data-drop-line="before" />}
        {ind === 'bottom' && !isOpen && <span className="absolute -bottom-1.5 left-2 right-2 h-0.5 rounded bg-white z-10" data-drop-line="after" />}
        <div {...dragProps(f.id, (zone) => (zone === 'top' ? { type: 'before', id: f.id } : zone === 'bottom' ? { type: 'after', id: f.id } : { type: 'into', folderId: f.id }))}>
          <button type="button" onClick={() => toggleFolder(f.id)} onContextMenu={(e) => ctx.open(e, folderMenu(f))} className="group relative block" data-folder-tile title={undefined}>
            <Pill active={!isOpen && anyActive} unread={!isOpen && anyUnread} tip={label}>
              <div className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-all duration-200 ${ind === 'mid' ? 'ring-2 ring-success' : ''} ${isOpen ? 'hover:bg-bg-4' : ''}`} style={{ background: isOpen ? undefined : `${tint}33` }}>
                {isOpen ? <Folder size={24} style={{ color: tint }} /> : (
                  <div className="grid grid-cols-2 gap-1 p-1.5">
                    {members.slice(0, 4).map((g) => (
                      <span key={g.id} className="h-4 w-4 rounded-full overflow-hidden flex items-center justify-center text-[8px] font-bold text-white" style={{ background: g.icon_url ? undefined : colorFor(g.id) }}>
                        {g.icon_url ? <img src={g.icon_url} alt="" className="h-full w-full object-cover" /> : initials(g.name).slice(0, 1)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Pill>
          </button>
        </div>
        {isOpen && (
          <div className="mt-2 flex flex-col items-center gap-2 pb-1" data-folder-contents>
            {members.map((g, i) => renderGuild(g, `${f.id}:${g.id}`, (zone) => ({ type: 'into', folderId: f.id, index: zone === 'top' ? i : i + 1 }), true))}
          </div>
        )}
      </div>
    )
  }

  return (
    <nav className="w-[72px] shrink-0 bg-bg-0 flex flex-col items-center py-3 gap-2 overflow-y-auto overflow-x-hidden" data-guild-bar>
      <NavLink to="/channels/@me" className={({ isActive }) => `group relative ${isActive ? 'active' : ''}`}>
        {({ isActive }) => (
          <Pill active={isActive} unread={dmUnread > 0} tip="Direct Messages">
            <div className={`h-12 w-12 flex items-center justify-center transition-all duration-200 rounded-2xl ${isActive ? 'bg-accent' : 'bg-bg-3 group-hover:bg-accent'}`}>
              <span className="font-extrabold text-white text-lg">{APP_INITIAL}</span>
            </div>
            {dmUnread > 0 && <span className="absolute -bottom-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center ring-[3px] ring-bg-0">{dmUnread}</span>}
          </Pill>
        )}
      </NavLink>
      <div className="h-0.5 w-8 rounded bg-bg-4 my-1" />

      {layout.map((it) => {
        if (it.kind === 'folder') return renderFolder(it)
        const g = guilds[it.id]
        if (!g) return null
        return renderGuild(g, g.id, (zone) => (zone === 'top' ? { type: 'before', id: g.id } : zone === 'bottom' ? { type: 'after', id: g.id } : { type: 'combine', guildId: g.id }))
      })}

      <button onClick={() => openModal({ kind: 'createGuild' })} className="group relative">
        <Pill tip="Add a Server">
          <div className="h-12 w-12 rounded-2xl bg-bg-3 text-success flex items-center justify-center transition-all duration-200 group-hover:bg-success group-hover:text-white"><Plus size={24} /></div>
        </Pill>
      </button>
      <NavLink to="/discover" className="group relative" data-discover-link>
        {({ isActive }) => (
          <Pill active={isActive} tip="Discover">
            <div className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-all duration-200 ${isActive ? 'bg-success text-white' : 'bg-bg-3 text-success group-hover:bg-success group-hover:text-white'}`}><Compass size={22} /></div>
          </Pill>
        )}
      </NavLink>
      {ctx.menu && <ContextMenu {...ctx.menu} onClose={ctx.close} label="Server" />}
    </nav>
  )
}

/** Right-click menu for a server icon: Mark As Read, Invite People, Server Settings, Leave / Delete, Copy Server ID. */
export function useGuildMenu() {
  const me = useStore((s) => s.user)
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const removeGuild = useStore((s) => s.removeGuild)
  const markRead = useStore((s) => s.markRead)
  const navigate = useNavigate()
  const store = useStore
  return (guildId: string): MenuEntry[] => {
    const s = store.getState()
    const g = s.guilds[guildId]
    if (!g) return []
    const perms = myGuildPerms(s, guildId)
    const isOwner = me?.id === g.owner_id
    const unreadChannels = Object.values(s.channels).filter((c) => c.guild_id === guildId && isUnread(s, c.id))
    const act = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { pushToast((e as Error).message, 'error') } }
    const leave = () => openModal({ kind: 'confirm', title: `Leave '${g.name}'`, body: `Are you sure you want to leave ${g.name}? You won't be able to rejoin unless you are re-invited.`, danger: true, confirmLabel: 'Leave Server',
      action: () => act(async () => { await api.delete(`/guilds/${guildId}/members/@me`); removeGuild(guildId); navigate('/channels/@me') }) })
    const del = () => openModal({ kind: 'confirm', title: `Delete '${g.name}'`, body: `Are you sure you want to delete ${g.name}? This cannot be undone.`, danger: true, confirmLabel: 'Delete Server',
      action: () => act(async () => { await api.delete(`/guilds/${guildId}`); removeGuild(guildId); navigate('/channels/@me') }) })
    return [
      { label: 'Mark As Read', icon: <MailCheck size={16} />, disabled: unreadChannels.length === 0, onClick: () => unreadChannels.forEach((c) => markRead(c.id)) },
      'sep',
      ...(has(perms, P.CREATE_INVITE) ? [{ label: 'Invite People', icon: <UserPlus size={16} />, accent: true, onClick: () => openModal({ kind: 'invite', guildId }) }] : []),
      ...(has(perms, P.MANAGE_GUILD) || has(perms, P.MANAGE_ROLES) ? [{ label: 'Server Settings', icon: <Settings size={16} />, onClick: () => openModal({ kind: 'guildSettings', guildId }) }] : []),
      ...(has(perms, P.MANAGE_CHANNELS) ? [{ label: 'Create Channel', icon: <Plus size={16} />, onClick: () => openModal({ kind: 'createChannel', guildId }) }] : []),
      'sep',
      isOwner ? { label: 'Delete Server', icon: <Trash2 size={16} />, danger: true, onClick: del } : { label: 'Leave Server', icon: <LogOut size={16} />, danger: true, onClick: leave },
      'sep',
      { label: 'Copy Server ID', icon: <Copy size={16} />, onClick: () => act(async () => { await navigator.clipboard.writeText(guildId); pushToast('Server ID copied') }) },
    ]
  }
}

/**
 * The white indicator pill at the nav's edge (Discord: tall when selected, a stub when unread,
 * medium on hover) plus a tooltip rendered in a portal so it never widens the nav.
 */
function Pill({ active, unread, tip, children }: { active?: boolean; unread?: boolean; tip: string; children: ReactNode }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  // Touch screens fire synthetic mouseenter on tap and never mouseleave, which would pin the tooltip.
  return (
    <div className="relative flex items-center" onMouseEnter={(e) => { if (canHover()) setRect(e.currentTarget.getBoundingClientRect()) }} onMouseLeave={() => setRect(null)} onTouchStart={() => setRect(null)} onClick={() => setRect(null)}>
      <span data-pill={active ? 'active' : unread ? 'unread' : 'none'} className={`absolute -left-3 w-1 rounded-r-full bg-white transition-all duration-200 ${active ? 'h-10' : unread ? 'h-2 group-hover:h-5' : 'h-0 group-hover:h-5'}`} />
      {children}
      {rect && createPortal(
        <span role="tooltip" className="pointer-events-none fixed z-[150] whitespace-nowrap rounded-lg bg-bg-0 border border-line px-3 py-1.5 text-sm font-semibold text-text-0 shadow-xl pop" style={{ left: rect.right + 14, top: rect.top + rect.height / 2, transform: 'translateY(-50%)' }} data-guild-tip>
          {tip}
        </span>,
        document.body,
      )}
    </div>
  )
}
