import { ChevronDown, Clock, Headphones, HeadphoneOff, Mic, MicOff, Settings, ShieldCheck, Smile } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { voice } from '../lib/voice'
import { useState, type ReactNode } from 'react'
import { useStore } from '../store'
import type { PrivateUser } from '../lib/types'
import { api } from '../lib/api'
import { colorFor } from '../lib/format'
import Avatar from './Avatar'
import DeviceMenu from './DeviceMenu'
import VoiceConnected from './VoiceConnected'
import StyledName from './StyledName'
import AccountSwitcher from './AccountSwitcher'
import { t as tr, useT } from '../lib/i18n'

const statusDurations = () => [
  { label: tr('For 15 minutes'), secs: 15 * 60 }, { label: tr('For 1 hour'), secs: 3600 }, { label: tr('For 8 hours'), secs: 8 * 3600 },
  { label: tr('For 24 hours'), secs: 86400 }, { label: tr('For 3 days'), secs: 3 * 86400 },
]

const statuses = (): { v: string; label: string; color: string }[] => [
  { v: 'online', label: tr('Online'), color: '#3ccf7d' },
  { v: 'idle', label: tr('Idle'), color: '#f6b53d' },
  { v: 'dnd', label: tr('Do Not Disturb'), color: '#f0506e' },
  { v: 'invisible', label: tr('Invisible'), color: '#7d8394' },
]

/**
 * The self card at the bottom of the sidebar, Discord-style: a floating rounded panel tinted
 * with your profile theme, a 40px avatar, name + status, then mute / deafen (each with a device
 * dropdown) and settings.
 */
export default function UserPanel() {
  const t = useT()
  const user = useStore((s) => s.user)
  const openModal = useStore((s) => s.openModal)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const [devices, setDevices] = useState<'input' | 'output' | null>(null)
  const muted = useStore((s) => s.selfMute)
  const deaf = useStore((s) => s.selfDeaf)
  const [durations, setDurations] = useState<string | null>(null)
  if (!user) return null

  // Idle, Do Not Disturb and Invisible can be set for a while, then go back to Online (Discord's durations).
  const setStatus = async (v: string, forSecs?: number) => {
    setOpen(false); setDurations(null)
    try {
      // Keep the returned account (it carries status_expires_at, which the public USER_UPDATE leaves out).
      const u = await api.patch<PrivateUser>('/users/@me', { status: v, ...(forSecs ? { status_for_secs: forSecs } : {}) })
      const st = useStore.getState(); if (st.token) st.setAuth(st.token, u)
    } catch { /* ignore */ }
  }
  const until = user.status !== 'online' && user.status_expires_at && new Date(user.status_expires_at).getTime() > Date.now()
    ? new Date(user.status_expires_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null
  const themed = !!user.theme_primary
  const primary = user.theme_primary ?? colorFor(user.id)
  const cardStyle = themed
    ? { background: `linear-gradient(rgba(17,18,20,0.72), rgba(17,18,20,0.72)), linear-gradient(135deg, ${primary}, ${user.theme_accent ?? primary})`, borderColor: 'rgba(255,255,255,0.08)' }
    : { background: '#232428', borderColor: 'rgba(255,255,255,0.06)' }
  const statusLabel = statuses().find((s) => s.v === user.status)?.label ?? t('Online')

  return (
    <div className="shrink-0 w-full min-w-0 p-2 pt-0" style={{ background: 'linear-gradient(90deg, var(--color-bg-0) 72px, var(--color-bg-1) 72px)' }} data-user-panel-bar>
      <VoiceConnected />
      <div className="relative rounded-xl border shadow-lg pl-2 pr-1.5 py-1.5 flex items-center gap-0.5" style={cardStyle} data-user-panel>
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 flex-1 rounded-lg pl-1 pr-1 py-1 hover:bg-white/10 text-left" data-panel-self data-motion-row>
          <span className="rounded-full ring-2 ring-black/20"><Avatar user={user} size={40} presence /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-bold truncate leading-5"><StyledName userId={user.id}>{user.display_name}</StyledName></div>
            <div className="text-[13px] text-text-1 truncate leading-4" data-panel-status>{user.custom_status || statusLabel}</div>
          </div>
        </button>
        <ControlBtn label={muted ? 'Unmute' : 'Mute'} onClick={() => voice.setMute(!muted)} active={muted} onMenu={() => setDevices((d) => (d === 'input' ? null : 'input'))} menuOpen={devices === 'input'}>{muted ? <MicOff size={20} /> : <Mic size={20} />}</ControlBtn>
        <ControlBtn label={deaf ? 'Undeafen' : 'Deafen'} onClick={() => voice.setDeaf(!deaf)} active={deaf} onMenu={() => setDevices((d) => (d === 'output' ? null : 'output'))} menuOpen={devices === 'output'}>{deaf ? <HeadphoneOff size={20} /> : <Headphones size={20} />}</ControlBtn>
        <ControlBtn label={t('User Settings')} onClick={() => openModal({ kind: 'userSettings' })}><Settings size={20} /></ControlBtn>

        {devices && <DeviceMenu kind={devices} onClose={() => setDevices(null)} />}
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <div className="pop absolute bottom-full left-0 mb-2 z-40 w-60 rounded-xl bg-bg-0 border border-line shadow-2xl p-2">
              <div className="flex items-center gap-3 p-2 mb-1">
                <Avatar user={user} size={40} presence />
                <div className="min-w-0"><div className="font-bold truncate">{user.display_name}</div><div className="text-xs text-text-2 truncate">@{user.username}</div></div>
              </div>
              <div className="h-px bg-line my-1" />
              <button onClick={() => { setOpen(false); openModal({ kind: 'customStatus' }) }} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-1 hover:bg-accent hover:text-white" data-set-status><Smile size={14} /> {user.custom_status ? t('Edit custom status') : t('Set a custom status')}</button>
              {user.is_admin && <button onClick={() => { setOpen(false); navigate('/admin') }} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-success hover:bg-accent hover:text-white" data-admin-console><ShieldCheck size={14} /> {t('Admin Console')}</button>}
              <div className="h-px bg-line my-1" />
              {statuses().map((s) => (
                <div key={s.v}>
                  <div className="flex items-center">
                    <button onClick={() => setStatus(s.v)} className={`min-w-0 flex-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-white ${user.status === s.v ? 'text-text-0' : 'text-text-1'}`} data-status-option={s.v}>
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                      <span className="truncate">{s.label}</span>
                      {user.status === s.v && until && <span className="ml-auto shrink-0 text-[11px] text-text-2" data-status-until>{t('until {when}', { when: until })}</span>}
                    </button>
                    {s.v !== 'online' && <button type="button" onClick={() => setDurations(durations === s.v ? null : s.v)} className="shrink-0 rounded-md p-1.5 text-text-2 hover:bg-bg-3 hover:text-text-0" title={t('{status} for a while', { status: s.label })} aria-label={t('{status} for a while', { status: s.label })} aria-expanded={durations === s.v} data-status-durations={s.v}><Clock size={14} /></button>}
                  </div>
                  {durations === s.v && (
                    <div className="ml-6 mb-1 space-y-0.5" data-status-duration-list={s.v}>
                      {statusDurations().map((d) => <button key={d.secs} type="button" onClick={() => setStatus(s.v, d.secs)} className="w-full rounded-md px-2 py-1 text-left text-xs text-text-1 hover:bg-accent hover:text-white" data-status-for={d.secs}>{d.label}</button>)}
                    </div>
                  )}
                </div>
              ))}
              <div className="h-px bg-line my-1" />
              <div className="px-2 pt-1 pb-0.5 text-[11px] font-bold uppercase tracking-wide text-text-2">{t('Switch account')}</div>
              <AccountSwitcher />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** A 36px control; with `onMenu` a slim chevron beside it opens the device picker (Discord's mic/headphone dropdowns). */
function ControlBtn({ children, label, onClick, active, onMenu, menuOpen }: { children: ReactNode; label: string; onClick: () => void; active?: boolean; onMenu?: () => void; menuOpen?: boolean }) {
  const t = useT()
  return (
    <span className={`flex items-center rounded-lg shrink-0 ${menuOpen ? 'bg-white/10' : ''}`}>
      <button title={t(label)} onClick={onClick} className={`h-9 w-9 rounded-lg flex items-center justify-center hover:bg-white/10 ${active ? 'text-danger' : 'text-text-0'}`} data-control={label}>
        {children}
      </button>
      {onMenu && <button title={t('{label} options', { label: t(label.replace(/^Un/, '')) })} onClick={onMenu} className="h-9 w-3.5 -ml-1 rounded-r-lg flex items-center justify-center text-text-1 hover:text-text-0" data-control-menu={label}><ChevronDown size={11} /></button>}
    </span>
  )
}

