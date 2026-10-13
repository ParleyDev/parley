import { Headphones, Mic, Settings } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../store'
import Avatar from './Avatar'
import { api } from '../lib/api'

const STATUSES: { v: string; label: string; color: string }[] = [
  { v: 'online', label: 'Online', color: '#3ccf7d' },
  { v: 'idle', label: 'Idle', color: '#f6b53d' },
  { v: 'dnd', label: 'Do Not Disturb', color: '#f0506e' },
  { v: 'invisible', label: 'Invisible', color: '#7d8394' },
]

export default function UserPanel() {
  const user = useStore((s) => s.user)
  const openModal = useStore((s) => s.openModal)
  const [open, setOpen] = useState(false)
  const [muted, setMuted] = useState(false)
  const [deaf, setDeaf] = useState(false)
  if (!user) return null

  const setStatus = async (v: string) => {
    setOpen(false)
    try { await api.patch('/users/@me', { status: v }) } catch { /* ignore */ }
  }

  return (
    <div className="relative shrink-0 bg-bg-0/60 px-2 py-1.5 flex items-center gap-1">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 flex-1 rounded-md px-1 py-1 hover:bg-bg-3 text-left">
        <Avatar user={user} size={32} presence />
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate leading-tight">{user.display_name}</div>
          <div className="text-[11px] text-text-2 truncate leading-tight">{STATUSES.find((s) => s.v === user.status)?.label ?? 'Online'}</div>
        </div>
      </button>
      <IconBtn label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted((m) => !m)} active={muted}><Mic size={18} /></IconBtn>
      <IconBtn label={deaf ? 'Undeafen' : 'Deafen'} onClick={() => setDeaf((d) => !d)} active={deaf}><Headphones size={18} /></IconBtn>
      <IconBtn label="User Settings" onClick={() => openModal({ kind: 'userSettings' })}><Settings size={18} /></IconBtn>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="pop absolute bottom-full left-2 mb-2 z-40 w-56 rounded-xl bg-bg-0 border border-line shadow-2xl p-2">
            <div className="flex items-center gap-3 p-2 mb-1">
              <Avatar user={user} size={40} presence />
              <div className="min-w-0"><div className="font-bold truncate">{user.display_name}</div><div className="text-xs text-text-2 truncate">@{user.username}</div></div>
            </div>
            <div className="h-px bg-line my-1" />
            {STATUSES.map((s) => (
              <button key={s.v} onClick={() => setStatus(s.v)} className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-white ${user.status === s.v ? 'text-text-0' : 'text-text-1'}`}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function IconBtn({ children, label, onClick, active }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button title={label} onClick={onClick} className={`relative h-8 w-8 rounded-md flex items-center justify-center hover:bg-bg-3 ${active ? 'text-danger' : 'text-text-1 hover:text-text-0'}`}>
      {children}
      {active && <span className="absolute left-1/2 top-1/2 h-[2px] w-6 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-danger rounded" />}
    </button>
  )
}
