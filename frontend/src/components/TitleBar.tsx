import { ArrowDownToLine, ArrowLeft, ArrowRight, Compass, Copy, Inbox, Minus, ShieldCheck, Square, Users, X } from 'lucide-react'
import { useEffect, useState, type ReactNode, type MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { desktop } from '../lib/desktop'
import { useDesktopFrame, useTitleBarShown } from '../lib/titleBar'
import { RELEASES, useDesktopUpdate } from '../lib/desktopUpdate'
import { colorFor, initials } from '../lib/format'
import { dmName, isGroup } from '../lib/dm'
import { useT } from '../lib/i18n'
import Avatar from './Avatar'
import GroupIcon from './GroupIcon'
import InboxButton from './InboxButton'

/** History buttons can't know whether there is a page to go to outside Chromium (Navigation API); assume there is. */
const nav = (window as unknown as { navigation?: { canGoBack?: boolean; canGoForward?: boolean } }).navigation

/**
 * Discord's title bar: a slim strip across the top of every view on wide screens with back/forward, where you are
 * (the server, the DM or Friends) and the inbox. Paints nothing of its own so themes run through it. Settings →
 * Appearance → Show title bar; never on phones. In the frameless desktop app it is always there: it drags the window
 * (double-click maximises) and carries minimise/maximise/close, or leaves room for the macOS traffic lights.
 */
export default function TitleBar() {
  return useTitleBarShown() ? <Bar /> : null
}

/** Discord's green arrow: a desktop app update is downloaded (restart into it), or, for apps from before the updater,
 *  a newer one is out to download. */
export function UpdateButton() {
  const t = useT()
  const u = useDesktopUpdate()
  const cls = 'h-7 w-7 rounded-md flex items-center justify-center text-success hover:bg-white/10'
  if (u.kind === 'shell' && u.status.state === 'ready') {
    const tip = t('Restart to update to {version}', { version: u.status.version ?? '' })
    return <button type="button" onClick={() => void desktop.installUpdate().catch(() => {})} title={tip} aria-label={tip} className={cls} data-desktop-update="ready"><ArrowDownToLine size={18} /></button>
  }
  if (u.kind === 'download') {
    const tip = t('Parley {version} is out: download the new app', { version: u.version })
    return <a href={RELEASES} target="_blank" rel="noreferrer" title={tip} aria-label={tip} className={cls} data-desktop-update="download"><ArrowDownToLine size={18} /></a>
  }
  return null
}

/** Minimise, maximise/restore and close for the frameless desktop window (Windows, Linux). */
function WindowControls() {
  const t = useT()
  const [max, setMax] = useState(false)
  useEffect(() => {
    const sync = () => void desktop.window('state').then(setMax)
    sync(); window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])
  const btn = 'h-9 w-[46px] flex items-center justify-center text-text-1 hover:bg-white/10 hover:text-text-0'
  return (
    <div className="flex self-stretch -mr-2 ml-1" data-window-controls>
      <button type="button" onClick={() => void desktop.window('minimize')} title={t('Minimise')} aria-label={t('Minimise')} className={btn} data-window="minimize"><Minus size={16} /></button>
      <button type="button" onClick={() => void desktop.window('maximize').then(setMax)} title={max ? t('Restore') : t('Maximise')} aria-label={max ? t('Restore') : t('Maximise')} className={btn} data-window="maximize">{max ? <Copy size={13} className="-scale-x-100" /> : <Square size={13} />}</button>
      <button type="button" onClick={() => void desktop.window('close')} title={t('Close')} aria-label={t('Close')} className={`${btn} hover:!bg-[#e81123] hover:!text-white`} data-window="close"><X size={18} /></button>
    </div>
  )
}

function Bar() {
  const t = useT()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [, root, first, second] = pathname.split('/')
  const guild = useStore((s) => (first && first !== '@me' ? s.guilds[first] : undefined))
  const dm = useStore((s) => (first === '@me' && second && second !== 'requests' ? s.dms[second] : undefined))
  const users = useStore((s) => s.users)
  const notes = useStore((s) => s.notes)
  const frame = useDesktopFrame()
  // The bar's empty space drags the window; a double-click maximises, like a system title bar.
  const drag = (e: MouseEvent) => { if (frame && e.button === 0 && e.target === e.currentTarget) void desktop.window(e.detail === 2 ? 'maximize' : 'drag') }

  let icon: ReactNode = <Users size={16} />, title = t('Friends')
  if (guild) {
    icon = <span className="h-5 w-5 shrink-0 overflow-hidden rounded-md flex items-center justify-center text-[9px] font-bold text-white" style={{ background: guild.icon_url ? undefined : colorFor(guild.id) }}>{guild.icon_url ? <img src={guild.icon_url} alt="" className="h-full w-full object-cover" draggable={false} /> : initials(guild.name)}</span>
    title = guild.name
  } else if (dm) {
    const other = !isGroup(dm) && dm.recipients[0] ? { ...dm.recipients[0], ...users[dm.recipients[0].id] } : undefined
    icon = isGroup(dm) ? <GroupIcon dm={dm} size={20} /> : other ? <Avatar user={other} size={20} /> : null
    title = dmName(dm, users, notes)
  } else if (second === 'requests') {
    icon = <Inbox size={16} />; title = t('Message Requests')
  } else if (first === '@me' && second) {
    title = t('Direct Messages')
  }
  // Pages outside the chat (SplitLayout) name themselves.
  if (root === 'admin') { icon = <ShieldCheck size={16} />; title = t('Admin Console') }
  else if (root === 'discover') { icon = <Compass size={16} />; title = t('Discover') }
  const arrow = 'h-6 w-6 rounded-md flex items-center justify-center text-text-2 hover:bg-white/10 hover:text-text-0 disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <div onMouseDown={drag} className={`relative z-30 shrink-0 h-9 flex items-center px-2 text-sm select-none ${frame === 'mac' ? 'pl-[78px]' : ''}`} data-title-bar={frame ?? ''}>
      <div className="flex items-center gap-0.5">
        <button type="button" onClick={() => navigate(-1)} disabled={nav?.canGoBack === false} title={t('Back')} aria-label={t('Back')} className={arrow} data-title-back><ArrowLeft size={16} /></button>
        <button type="button" onClick={() => navigate(1)} disabled={nav?.canGoForward === false} title={t('Forward')} aria-label={t('Forward')} className={arrow} data-title-forward><ArrowRight size={16} /></button>
      </div>
      <div className="pointer-events-none absolute inset-x-28 inset-y-0 flex items-center justify-center gap-2 font-semibold text-text-0" data-title-bar-place>
        <span className="shrink-0 flex text-text-1">{icon}</span><span className="truncate" data-title-bar-name>{title}</span>
      </div>
      <div className="ml-auto flex items-center" data-title-bar-actions><UpdateButton /><InboxButton inTitleBar />{frame === 'custom' && <WindowControls />}</div>
    </div>
  )
}
