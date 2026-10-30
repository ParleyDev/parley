import { ChevronDown, Headphones, HeadphoneOff, Mic, MicOff, Settings } from 'lucide-react'
import { voice } from '../lib/voice'
import { useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { profileCardStyle, profileColors } from '../lib/profileLook'
import { nameplateClass } from '../lib/cosmetics'
import { NameplateVideo } from './Nameplate'
import Avatar from './Avatar'
import DeviceMenu from './DeviceMenu'
import VoiceConnected from './VoiceConnected'
import StyledName from './StyledName'
import UserMenu, { statuses } from './UserMenu'
import { useT } from '../lib/i18n'
import { isPhone } from '../lib/swipe'

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
  const [devices, setDevices] = useState<'input' | 'output' | null>(null)
  const muted = useStore((s) => s.selfMute)
  const deaf = useStore((s) => s.selfDeaf)
  if (!user) return null

  // Your profile theme when you have one; otherwise the theme's raised surface, so light and colour themes fit too.
  const cardStyle = profileColors(user).themed ? profileCardStyle(user, 0.72) : { background: 'var(--color-bg-3)', borderColor: 'var(--color-line)' }
  const statusLabel = statuses().find((s) => s.v === user.status)?.label ?? t('Online')

  return (
    <div className="shrink-0 w-full min-w-0 p-2 pt-0" style={{ background: 'linear-gradient(90deg, var(--color-bg-0) 72px, var(--color-bg-1) 72px)' }} data-user-panel-bar>
      <VoiceConnected />
      <div className="relative h-[var(--dock-h)] rounded-lg border shadow-lg pl-2 pr-1.5 flex items-center gap-0.5" style={cardStyle} data-user-panel>
        {/* Your nameplate as the panel's background (Discord shows it here), playing while the panel is hovered. It sits
            at z 0 under the panel's content (z 1); no `isolate` on the panel, which would trap the menu's click-away
            backdrop inside it. */}
        {user.nameplate && <div className={`pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-lg ${nameplateClass(user.nameplate)}`} data-panel-nameplate={user.nameplate} aria-hidden><NameplateVideo value={user.nameplate} hoverRoot="[data-user-panel]" always /></div>}
        <button onClick={() => (isPhone() ? openModal({ kind: 'profile', userId: user.id }) : setOpen((o) => !o))} className="relative z-[1] flex items-center gap-2 min-w-0 flex-1 rounded-lg pl-1 pr-1 py-1 hover:bg-white/10 text-left" data-panel-self data-motion-row>
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
            <UserMenu onClose={() => setOpen(false)} />
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
    <span className={`relative z-[1] flex items-center rounded-lg shrink-0 ${menuOpen ? 'bg-white/10' : ''}`}>
      <button title={t(label)} onClick={onClick} className={`h-9 w-9 rounded-lg flex items-center justify-center hover:bg-white/10 ${active ? 'text-danger' : 'text-text-0'}`} data-control={label}>
        {children}
      </button>
      {onMenu && <button title={t('{label} options', { label: t(label.replace(/^Un/, '')) })} onClick={onMenu} className="h-9 w-3.5 -ml-1 rounded-r-lg flex items-center justify-center text-text-1 hover:text-text-0 phone:hidden" data-control-menu={label}><ChevronDown size={11} /></button>}
    </span>
  )
}

