import { APP_INITIAL } from '../lib/brand'
import { Compass, Copy, LogOut, MailCheck, Plus, Settings, Trash2, UserPlus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useMatch, useNavigate } from 'react-router-dom'
import { dmUnreadCount, guildUnread, isUnread, myGuildPerms, pendingCount, useStore } from '../store'
import { colorFor, initials } from '../lib/format'
import { has, P } from '../lib/perms'
import { api } from '../lib/api'
import ContextMenu, { useContextMenu, type MenuEntry } from './ContextMenu'

export default function GuildBar() {
  const guildOrder = useStore((s) => s.guildOrder)
  const guilds = useStore((s) => s.guilds)
  const channels = useStore((s) => s.channels)
  const readStates = useStore((s) => s.readStates)
  const lastMessageId = useStore((s) => s.lastMessageId)
  const dms = useStore((s) => s.dms)
  const openModal = useStore((s) => s.openModal)
  // The bar sits outside the `:guildId` route, so read the id from the URL directly.
  const guildId = useMatch('/channels/:guildId/*')?.params.guildId
  const pending = useStore(pendingCount)
  const dmUnread = dmUnreadCount({ readStates, lastMessageId, dms }) + pending
  const ctx = useContextMenu()
  const guildMenu = useGuildMenu()

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

      {guildOrder.map((id) => {
        const g = guilds[id]
        if (!g) return null
        const active = guildId === id
        const unread = !active && guildUnread({ readStates, lastMessageId, channels }, id)
        return (
          <NavLink key={id} to={`/channels/${id}`} className="group relative" onContextMenu={(e) => ctx.open(e, guildMenu(id))} data-guild-icon={id}>
            <Pill active={active} unread={unread} tip={g.name}>
              <div className={`h-12 w-12 overflow-hidden flex items-center justify-center text-white font-semibold transition-all duration-200 rounded-2xl ${active ? '' : 'group-hover:rounded-xl'} ${!active && !unread ? 'opacity-80 group-hover:opacity-100' : ''}`}
                style={{ background: g.icon_url ? undefined : colorFor(id) }}>
                {g.icon_url ? <img src={g.icon_url} alt="" className="h-full w-full object-cover" draggable={false} /> : initials(g.name)}
              </div>
            </Pill>
          </NavLink>
        )
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
  return (
    <div className="relative flex items-center" onMouseEnter={(e) => setRect(e.currentTarget.getBoundingClientRect())} onMouseLeave={() => setRect(null)}>
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
