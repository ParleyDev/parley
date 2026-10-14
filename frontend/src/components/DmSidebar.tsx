import { MailCheck, Plus, Users } from 'lucide-react'
import ContextMenu, { useContextMenu, type MenuEntry } from './ContextMenu'
import { useUserMenu } from './UserContextMenu'
import { NavLink } from 'react-router-dom'
import { isUnread, pendingCount, useStore } from '../store'
import Avatar from './Avatar'
import UserPanel from './UserPanel'
import StyledName from './StyledName'

export default function DmSidebar() {
  const dms = useStore((s) => s.dms)
  const users = useStore((s) => s.users)
  const readStates = useStore((s) => s.readStates)
  const lastMessageId = useStore((s) => s.lastMessageId)
  const openModal = useStore((s) => s.openModal)
  const setMobilePane = useStore((s) => s.setMobilePane)
  const pending = useStore(pendingCount)
  const markRead = useStore((s) => s.markRead)
  const ctx = useContextMenu()
  const userMenu = useUserMenu(null)
  const dmMenu = (id: string, other: { id: string; display_name: string } | undefined, e: React.MouseEvent<HTMLElement>): MenuEntry[] => [
    { label: 'Mark As Read', icon: <MailCheck size={16} />, disabled: !isUnread({ readStates, lastMessageId }, id), onClick: () => markRead(id) },
    'sep',
    ...(other ? userMenu(other, e.currentTarget.getBoundingClientRect()) : []),
  ]
  const list = Object.values(dms).sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at))

  return (
    <aside className="w-60 max-md:w-auto max-md:flex-1 min-w-0 shrink-0 bg-bg-1 flex flex-col">
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
            const other = d.recipients[0] ? { ...d.recipients[0], ...users[d.recipients[0].id] } : undefined
            const unread = isUnread({ readStates, lastMessageId }, d.id)
            return (
              <NavLink key={d.id} to={`/channels/@me/${d.id}`} onClick={() => setMobilePane('content')} onContextMenu={(e) => ctx.open(e, dmMenu(d.id, other, e))} data-dm-row={other?.id} className={({ isActive }) => `group flex items-center gap-3 rounded-md px-2 py-1.5 ${isActive ? 'bg-bg-4 text-text-0' : unread ? 'text-text-0 hover:bg-bg-3' : 'text-text-2 hover:bg-bg-3 hover:text-text-1'}`}>
                {other ? <Avatar user={other} size={32} presence /> : <div className="h-8 w-8 rounded-full bg-bg-4" />}
                {other ? (
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
      <UserPanel />
      {ctx.menu && <ContextMenu {...ctx.menu} onClose={ctx.close} />}
    </aside>
  )
}
