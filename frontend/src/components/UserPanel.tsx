import { Check, ChevronDown, Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Settings, Signal, Smile } from 'lucide-react'
import { voice } from '../lib/voice'
import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { api } from '../lib/api'
import { colorFor } from '../lib/format'
import { dmName } from '../lib/dm'
import Avatar from './Avatar'
import StyledName from './StyledName'

const STATUSES: { v: string; label: string; color: string }[] = [
  { v: 'online', label: 'Online', color: '#3ccf7d' },
  { v: 'idle', label: 'Idle', color: '#f6b53d' },
  { v: 'dnd', label: 'Do Not Disturb', color: '#f0506e' },
  { v: 'invisible', label: 'Invisible', color: '#7d8394' },
]

/**
 * The self card at the bottom of the sidebar, Discord-style: a floating rounded panel tinted
 * with your profile theme, a 40px avatar, name + status, then mute / deafen (each with a device
 * dropdown) and settings.
 */
export default function UserPanel() {
  const user = useStore((s) => s.user)
  const openModal = useStore((s) => s.openModal)
  const [open, setOpen] = useState(false)
  const [devices, setDevices] = useState<'input' | 'output' | null>(null)
  const muted = useStore((s) => s.selfMute)
  const deaf = useStore((s) => s.selfDeaf)
  const myVoice = useStore((s) => s.myVoiceChannelId)
  const connecting = useStore((s) => s.voiceConnecting)
  const voiceChannel = useStore((s) => (s.myVoiceChannelId ? s.channels[s.myVoiceChannelId] : undefined))
  const voiceGuild = useStore((s) => (voiceChannel?.guild_id ? s.guilds[voiceChannel.guild_id] : undefined))
  const voiceDm = useStore((s) => { const d = s.myVoiceChannelId ? s.dms[s.myVoiceChannelId] : undefined; return d ? dmName(d, s.users) : undefined })
  const pttMode = useStore((s) => s.voiceSettings.inputMode === 'ptt')
  const pttHeld = useStore((s) => s.pttHeld)
  if (!user) return null

  const setStatus = async (v: string) => {
    setOpen(false)
    try { await api.patch('/users/@me', { status: v }) } catch { /* ignore */ }
  }
  const themed = !!user.theme_primary
  const primary = user.theme_primary ?? colorFor(user.id)
  const cardStyle = themed
    ? { background: `linear-gradient(rgba(17,18,20,0.72), rgba(17,18,20,0.72)), linear-gradient(135deg, ${primary}, ${user.theme_accent ?? primary})`, borderColor: 'rgba(255,255,255,0.08)' }
    : { background: '#232428', borderColor: 'rgba(255,255,255,0.06)' }
  const statusLabel = STATUSES.find((s) => s.v === user.status)?.label ?? 'Online'

  return (
    <div className="shrink-0 w-full min-w-0 p-2 pt-0" style={{ background: 'linear-gradient(90deg, var(--color-bg-0) 72px, var(--color-bg-1) 72px)' }} data-user-panel-bar>
      {myVoice && (
        <div className="mb-2 rounded-xl bg-bg-0/60 border border-line px-3 py-2 flex items-center gap-2" data-voice-connected>
          <Signal size={16} className={connecting ? 'text-warn' : 'text-success'} />
          <div className="min-w-0 flex-1">
            <div className={`text-xs font-bold ${connecting ? 'text-warn' : 'text-success'}`}>{connecting ? 'Connecting…' : 'Voice Connected'}</div>
            <div className="text-[11px] text-text-2 truncate">{voiceDm ? `${voiceDm} / Direct Message` : `${voiceChannel?.name ?? 'Voice'}${voiceGuild ? ` / ${voiceGuild.name}` : ''}`}</div>
          </div>
          {pttMode && <span title="Push to talk" className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${pttHeld ? 'bg-success text-black' : 'bg-bg-3 text-text-2'}`}>PTT</span>}
          <button title="Voice Settings" onClick={() => openModal({ kind: 'userSettings', tab: 'voice' })} className="h-8 w-8 rounded-md flex items-center justify-center text-text-1 hover:bg-bg-3 hover:text-text-0"><Settings size={16} /></button>
          <button title="Disconnect" onClick={() => voice.leave()} className="h-8 w-8 rounded-md flex items-center justify-center text-text-1 hover:bg-bg-3 hover:text-danger"><PhoneOff size={18} /></button>
        </div>
      )}
      <div className="relative rounded-xl border shadow-lg pl-2 pr-1.5 py-1.5 flex items-center gap-0.5" style={cardStyle} data-user-panel>
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 flex-1 rounded-lg pl-1 pr-1 py-1 hover:bg-white/10 text-left" data-panel-self>
          <span className="rounded-full ring-2 ring-black/20"><Avatar user={user} size={40} presence /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-bold truncate leading-5"><StyledName userId={user.id}>{user.display_name}</StyledName></div>
            <div className="text-[13px] text-text-1 truncate leading-4" data-panel-status>{user.custom_status || statusLabel}</div>
          </div>
        </button>
        <ControlBtn label={muted ? 'Unmute' : 'Mute'} onClick={() => voice.setMute(!muted)} active={muted} onMenu={() => setDevices((d) => (d === 'input' ? null : 'input'))} menuOpen={devices === 'input'}>{muted ? <MicOff size={20} /> : <Mic size={20} />}</ControlBtn>
        <ControlBtn label={deaf ? 'Undeafen' : 'Deafen'} onClick={() => voice.setDeaf(!deaf)} active={deaf} onMenu={() => setDevices((d) => (d === 'output' ? null : 'output'))} menuOpen={devices === 'output'}>{deaf ? <HeadphoneOff size={20} /> : <Headphones size={20} />}</ControlBtn>
        <ControlBtn label="User Settings" onClick={() => openModal({ kind: 'userSettings' })}><Settings size={20} /></ControlBtn>

        {devices && <DeviceMenu kind={devices} onClose={() => setDevices(null)} onSettings={() => { setDevices(null); openModal({ kind: 'userSettings', tab: 'voice' }) }} />}
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <div className="pop absolute bottom-full left-0 mb-2 z-40 w-60 rounded-xl bg-bg-0 border border-line shadow-2xl p-2">
              <div className="flex items-center gap-3 p-2 mb-1">
                <Avatar user={user} size={40} presence />
                <div className="min-w-0"><div className="font-bold truncate">{user.display_name}</div><div className="text-xs text-text-2 truncate">@{user.username}</div></div>
              </div>
              <div className="h-px bg-line my-1" />
              <button onClick={() => { setOpen(false); openModal({ kind: 'customStatus' }) }} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-1 hover:bg-accent hover:text-white" data-set-status><Smile size={14} /> {user.custom_status ? 'Edit custom status' : 'Set a custom status'}</button>
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

/** A 36px control; with `onMenu` a slim chevron beside it opens the device picker (Discord's mic/headphone dropdowns). */
function ControlBtn({ children, label, onClick, active, onMenu, menuOpen }: { children: ReactNode; label: string; onClick: () => void; active?: boolean; onMenu?: () => void; menuOpen?: boolean }) {
  return (
    <span className={`flex items-center rounded-lg shrink-0 ${menuOpen ? 'bg-white/10' : ''}`}>
      <button title={label} onClick={onClick} className={`h-9 w-9 rounded-lg flex items-center justify-center hover:bg-white/10 ${active ? 'text-danger' : 'text-text-0'}`} data-control={label}>
        {children}
      </button>
      {onMenu && <button title={`${label.replace(/^Un/, '')} options`} onClick={onMenu} className="h-9 w-3.5 -ml-1 rounded-r-lg flex items-center justify-center text-text-1 hover:text-text-0" data-control-menu={label}><ChevronDown size={11} /></button>}
    </span>
  )
}

/** Input / output device picker, mirroring the Voice & Video settings. */
function DeviceMenu({ kind, onClose, onSettings }: { kind: 'input' | 'output'; onClose: () => void; onSettings: () => void }) {
  const settings = useStore((s) => s.voiceSettings)
  const update = useStore((s) => s.updateVoiceSettings)
  const [list, setList] = useState<MediaDeviceInfo[] | null>(null)
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) { setList([]); return }
    navigator.mediaDevices.enumerateDevices().then((ds) => setList(ds.filter((d) => d.kind === (kind === 'input' ? 'audioinput' : 'audiooutput')))).catch(() => setList([]))
  }, [kind])
  const current = kind === 'input' ? settings.inputDeviceId : settings.outputDeviceId
  const pick = (id: string) => { update(kind === 'input' ? { inputDeviceId: id } : { outputDeviceId: id }); onClose() }
  const title = kind === 'input' ? 'Input Device' : 'Output Device'
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="pop absolute bottom-full right-0 mb-2 z-40 w-64 rounded-xl bg-bg-0 border border-line shadow-2xl p-2" data-device-menu={kind}>
        <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-text-2">{title}</div>
        {list === null && <div className="px-2 py-1.5 text-sm text-text-2">Looking for devices…</div>}
        {list && [{ deviceId: '', label: 'Default' } as Pick<MediaDeviceInfo, 'deviceId' | 'label'>, ...list.filter((d) => d.deviceId !== 'default' && d.deviceId !== '')].map((d, i) => (
          <button key={d.deviceId || 'default'} onClick={() => pick(d.deviceId)} className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left hover:bg-accent hover:text-white ${current === d.deviceId ? 'text-text-0' : 'text-text-1'}`} data-device-option>
            <span className="w-4 shrink-0">{current === d.deviceId && <Check size={14} />}</span><span className="truncate">{d.label || (i === 0 ? 'Default' : `${kind === 'input' ? 'Microphone' : 'Speakers'} ${i}`)}</span>
          </button>
        ))}
        <div className="h-px bg-line my-1" />
        <button onClick={onSettings} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-1 hover:bg-accent hover:text-white"><Settings size={14} /> Voice Settings</button>
      </div>
    </>
  )
}
