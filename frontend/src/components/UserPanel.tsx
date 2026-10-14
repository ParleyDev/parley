import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Settings, Signal } from 'lucide-react'
import { voice } from '../lib/voice'
import { useState } from 'react'
import { useStore } from '../store'
import Avatar from './Avatar'
import StyledName from './StyledName'
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
  const muted = useStore((s) => s.selfMute)
  const deaf = useStore((s) => s.selfDeaf)
  const myVoice = useStore((s) => s.myVoiceChannelId)
  const connecting = useStore((s) => s.voiceConnecting)
  const voiceChannel = useStore((s) => (s.myVoiceChannelId ? s.channels[s.myVoiceChannelId] : undefined))
  const voiceGuild = useStore((s) => (voiceChannel?.guild_id ? s.guilds[voiceChannel.guild_id] : undefined))
  const pttMode = useStore((s) => s.voiceSettings.inputMode === 'ptt')
  const pttHeld = useStore((s) => s.pttHeld)
  if (!user) return null

  const setStatus = async (v: string) => {
    setOpen(false)
    try { await api.patch('/users/@me', { status: v }) } catch { /* ignore */ }
  }

  return (
    <div className="shrink-0">
      {myVoice && (
        <div className="bg-bg-0/40 border-t border-line px-3 py-2 flex items-center gap-2">
          <Signal size={16} className={connecting ? 'text-warn' : 'text-success'} />
          <div className="min-w-0 flex-1">
            <div className={`text-xs font-bold ${connecting ? 'text-warn' : 'text-success'}`}>{connecting ? 'Connecting…' : 'Voice Connected'}</div>
            <div className="text-[11px] text-text-2 truncate">{voiceChannel?.name ?? 'Voice'}{voiceGuild ? ` / ${voiceGuild.name}` : ''}</div>
          </div>
          {pttMode && <span title="Push to talk" className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${pttHeld ? 'bg-success text-black' : 'bg-bg-3 text-text-2'}`}>PTT</span>}
          <button title="Voice Settings" onClick={() => openModal({ kind: 'userSettings', tab: 'voice' })} className="h-8 w-8 rounded-md flex items-center justify-center text-text-1 hover:bg-bg-3 hover:text-text-0"><Settings size={16} /></button>
          <button title="Disconnect" onClick={() => voice.leave()} className="h-8 w-8 rounded-md flex items-center justify-center text-text-1 hover:bg-bg-3 hover:text-danger"><PhoneOff size={18} /></button>
        </div>
      )}
    <div className="relative bg-bg-0/60 px-2 py-1.5 flex items-center gap-1">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 flex-1 rounded-md px-1 py-1 hover:bg-bg-3 text-left">
        <Avatar user={user} size={32} presence />
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate leading-tight"><StyledName userId={user.id}>{user.display_name}</StyledName></div>
          <div className="text-[11px] text-text-2 truncate leading-tight">{STATUSES.find((s) => s.v === user.status)?.label ?? 'Online'}</div>
        </div>
      </button>
      <IconBtn label={muted ? 'Unmute' : 'Mute'} onClick={() => voice.setMute(!muted)} active={muted}>{muted ? <MicOff size={18} /> : <Mic size={18} />}</IconBtn>
      <IconBtn label={deaf ? 'Undeafen' : 'Deafen'} onClick={() => voice.setDeaf(!deaf)} active={deaf}>{deaf ? <HeadphoneOff size={18} /> : <Headphones size={18} />}</IconBtn>
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
    </div>
  )
}

function IconBtn({ children, label, onClick, active }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button title={label} onClick={onClick} className={`relative h-8 w-8 rounded-md flex items-center justify-center hover:bg-bg-3 ${active ? 'text-danger' : 'text-text-1 hover:text-text-0'}`}>
      {children}
    </button>
  )
}
