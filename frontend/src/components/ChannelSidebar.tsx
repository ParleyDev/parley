import { ChevronDown, Hash, LogOut, Plus, Settings, Trash2, UserPlus, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { isUnread, useStore } from '../store'
import UserPanel from './UserPanel'
import { api } from '../lib/api'

export default function ChannelSidebar({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const channels = useStore((s) => s.channels)
  const readStates = useStore((s) => s.readStates)
  const lastMessageId = useStore((s) => s.lastMessageId)
  const user = useStore((s) => s.user)
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const removeGuild = useStore((s) => s.removeGuild)
  const navigate = useNavigate()
  const { channelId } = useParams()
  const [menu, setMenu] = useState(false)
  if (!guild) return null
  const isOwner = user?.id === guild.owner_id
  const list = Object.values(channels).filter((c) => c.guild_id === guildId).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
  const text = list.filter((c) => c.kind === 'text')
  const voice = list.filter((c) => c.kind === 'voice')

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
    <aside className="w-60 shrink-0 bg-bg-1 flex flex-col">
      <div className="relative">
        <button onClick={() => setMenu((m) => !m)} className="h-12 w-full px-4 flex items-center justify-between font-bold border-b border-line hover:bg-bg-3 transition text-left">
          <span className="truncate">{guild.name}</span>
          <ChevronDown size={18} className={`text-text-1 transition ${menu ? 'rotate-180' : ''}`} />
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
            <div className="pop absolute left-2 right-2 top-full mt-1 z-40 rounded-xl bg-bg-0 border border-line shadow-2xl p-1.5 text-sm" onClick={() => setMenu(false)}>
              <MenuItem icon={<UserPlus size={16} />} onClick={() => openModal({ kind: 'invite', guildId })} accent>Invite People</MenuItem>
              {isOwner && <MenuItem icon={<Settings size={16} />} onClick={() => openModal({ kind: 'guildSettings', guildId })}>Server Settings</MenuItem>}
              <MenuItem icon={<Plus size={16} />} onClick={() => openModal({ kind: 'createChannel', guildId })}>Create Channel</MenuItem>
              <div className="h-px bg-line my-1" />
              {isOwner
                ? <MenuItem icon={<Trash2 size={16} />} onClick={del} danger>Delete Server</MenuItem>
                : <MenuItem icon={<LogOut size={16} />} onClick={leave} danger>Leave Server</MenuItem>}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pt-3 space-y-4">
        <Category label="Text Channels" onAdd={() => openModal({ kind: 'createChannel', guildId })}>
          {text.map((c) => (
            <ChannelRow key={c.id} to={`/channels/${guildId}/${c.id}`} icon={<Hash size={18} />} name={c.name}
              unread={channelId !== c.id && isUnread({ readStates, lastMessageId }, c.id)}
              onSettings={() => openModal({ kind: 'channelSettings', channelId: c.id })} />
          ))}
        </Category>
        {voice.length > 0 && (
          <Category label="Voice Channels" onAdd={() => openModal({ kind: 'createChannel', guildId })}>
            {voice.map((c) => (
              <ChannelRow key={c.id} to={`/channels/${guildId}/${c.id}`} icon={<Volume2 size={18} />} name={c.name}
                onSettings={() => openModal({ kind: 'channelSettings', channelId: c.id })} />
            ))}
          </Category>
        )}
      </div>
      <UserPanel />
    </aside>
  )
}

function MenuItem({ children, icon, onClick, danger, accent }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void; danger?: boolean; accent?: boolean }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center justify-between rounded-md px-2.5 py-2 hover:bg-accent hover:text-white ${danger ? 'text-danger' : accent ? 'text-accent' : 'text-text-1'}`}>
      <span>{children}</span>{icon}
    </button>
  )
}

function Category({ label, onAdd, children }: { label: string; onAdd: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <div className="group flex items-center justify-between pr-1 text-[11px] font-bold uppercase tracking-wider text-text-2 hover:text-text-1">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-0.5 py-1 pl-0.5">
          <ChevronDown size={12} className={`transition ${open ? '' : '-rotate-90'}`} />{label}
        </button>
        <button onClick={onAdd} title="Create Channel" className="opacity-0 group-hover:opacity-100 hover:text-text-0"><Plus size={16} /></button>
      </div>
      {open && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </div>
  )
}

function ChannelRow({ to, icon, name, unread, onSettings }: { to: string; icon: React.ReactNode; name: string; unread?: boolean; onSettings: () => void }) {
  return (
    <NavLink to={to} className={({ isActive }) => `group relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[15px] ${isActive ? 'bg-bg-4 text-text-0' : unread ? 'text-text-0 hover:bg-bg-3' : 'text-text-2 hover:bg-bg-3 hover:text-text-1'}`}>
      {unread && <span className="absolute -left-2 top-1/2 -translate-y-1/2 h-2 w-1 rounded-r bg-white" />}
      <span className="text-text-2">{icon}</span>
      <span className={`truncate flex-1 ${unread ? 'font-semibold' : ''}`}>{name}</span>
      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSettings() }} className="opacity-0 group-hover:opacity-100 text-text-2 hover:text-text-0" title="Edit Channel"><Settings size={14} /></button>
    </NavLink>
  )
}
