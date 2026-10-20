import { LogOut, MailCheck, Plus, Users } from 'lucide-react'
import GroupIcon from './GroupIcon'
import { dmName, isGroup } from '../lib/dm'
import { api } from '../lib/api'
import ContextMenu, { useContextMenu, type MenuEntry } from './ContextMenu'
import { useUserMenu } from './UserContextMenu'
import { NavLink } from 'react-router-dom'
import { isUnread, pendingCount, showsUnread, useStore } from '../store'
import { notifEntries } from './NotifMenu'
import { mutedTarget } from '../lib/notify'
import type { DmChannel } from '../lib/types'
import Avatar from './Avatar'
import StyledName from './StyledName'

export default function DmSidebar() {
  const dms = useStore((s) => s.dms)
  const users = useStore((s) => s.users)
  const notes = useStore((s) => s.notes)
  const readStates = useStore((s) => s.readStates)
  const lastMessageId = useStore((s) => s.lastMessageId)
  const openModal = useStore((s) => s.openModal)
  const setMobilePane = useStore((s) => s.setMobilePane)
  const pending = useStore(pendingCount)
  const markRead = useStore((s) => s.markRead)
  const notifSettings = useStore((s) => s.notifSettings)
  const channels = useStore((s) => s.channels)
  const ctx = useContextMenu()
  const userMenu = useUserMenu(null)
  const pushToast = useStore((s) => s.pushToast)
  const me = useStore((s) => s.user)
  const leave = (id: string, name: string) => openModal({ kind: 'confirm', title: `Leave '${name}'`, body: 'You will stop receiving messages from this group unless someone adds you back.', danger: true, confirmLabel: 'Leave Group',
    action: async () => { try { await api.delete(`/channels/${id}/recipients/${me?.id}`) } catch (e) { pushToast((e as Error).message, 'error') } } })
  const dmMenu = (d: DmChannel, other: { id: string; display_name: string } | undefined, e: React.MouseEvent<HTMLElement>): MenuEntry[] => [
    { label: 'Mark As Read', icon: <MailCheck size={16} />, disabled: !isUnread({ readStates, lastMessageId }, d.id), onClick: () => markRead(d.id) },
    'sep',
    ...notifEntries(d.id, 'Conversation', notifSettings),
    'sep',
    ...(isGroup(d)
      ? [{ label: 'Leave Group', icon: <LogOut size={16} />, danger: true, onClick: () => leave(d.id, dmName(d, users, notes)) }]
      : other ? userMenu(other, e.currentTarget.getBoundingClientRect()) : []),
  ]
  const list = Object.values(dms).sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at))

  return (
    <aside className="w-[272px] tab:w-[224px] max-md:w-auto max-md:flex-1 min-w-0 shrink-0 bg-bg-1 flex flex-col">
      <div className="h-12 px-2.5 flex items-center border-b border-line">
        <button onClick={() => openModal({ kind: 'newDm' })} className="w-full rounded-md bg-bg-0/60 px-2 py-1.5 text-left text-sm text-text-2 hover:text-text-1">Find or start a conversation</button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pt-2">
        <NavLink to="/channels/@me" end onClick={() => setMobilePane('content')} className={({ isActive }) => `flex items-center gap-3 rounded-md px-2 py-2 text-[15px] font-medium ${isActive ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3 hover:text-text-0'}`}>
          <Users size={20} /> Friends
          {pending > 0 && <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center">{pending}</span>}
        </NavLink>
        <div className="mt-4 mb-1 flex items-center justify-between px-2 text-[11px] font-bold uppercase tracking-wider text-text-2">
          <span>Direct Messages</span>
          <button onClick={() => openModal({ kind: 'newDm' })} title="Create DM" className="hover:text-text-0"><Plus size={16} /></button>
        </div>
        <div className="space-y-0.5">
          {list.map((d) => {
            const group = isGroup(d)
            const other = !group && d.recipients[0] ? { ...d.recipients[0], ...users[d.recipients[0].id] } : undefined
            const unread = showsUnread({ readStates, lastMessageId, channels, dms, notifSettings }, d.id)
            const muted = mutedTarget(notifSettings, d.id)
            return (
              <NavLink key={d.id} to={`/channels/@me/${d.id}`} onClick={() => setMobilePane('content')} onContextMenu={(e) => ctx.open(e, dmMenu(d, other, e))} data-dm-row={group ? d.id : other?.id} data-group-row={group ? d.id : undefined} data-muted={muted ? 'true' : undefined} className={({ isActive }) => `group flex items-center gap-3 rounded-md px-2 py-1.5 ${isActive ? 'bg-bg-4 text-text-0' : unread ? 'text-text-0 hover:bg-bg-3' : 'text-text-2 hover:bg-bg-3 hover:text-text-1'}`}>
                {group ? <GroupIcon dm={d} size={32} /> : other ? <Avatar user={other} size={32} presence /> : <div className="h-8 w-8 rounded-full bg-bg-4" />}
                {group ? (
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className={`block truncate text-[15px] ${unread ? 'font-semibold' : ''}`}>{dmName(d, users, notes)}</span>
                    <span className="block truncate text-xs text-text-2">{d.recipients.length + 1} Members</span>
                  </span>
                ) : other ? (
                  <span className="min-w-0 flex-1 leading-tight">
                    <StyledName userId={other.id} className={`block truncate text-[15px] ${unread ? 'font-semibold' : ''}`}>{other.display_name}</StyledName>
                    {other.custom_status && <span className="block truncate text-xs text-text-2" data-dm-status>{other.custom_status}</span>}
                  </span>
                ) : <span className="truncate text-[15px]">Unknown</span>}
                {unread && <span className="ml-auto h-2 w-2 rounded-full bg-white" />}
              </NavLink>
            )
          })}
          {list.length === 0 && <p className="px-2 py-4 text-sm text-text-2">No conversations yet. Start one!</p>}
        </div>
      </div>
      {ctx.menu && <ContextMenu {...ctx.menu} onClose={ctx.close} />}
    </aside>
  )
}
